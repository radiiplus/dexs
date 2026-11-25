const assert = require('node:assert/strict');
const { Contract, ContractFactory, JsonRpcProvider, keccak256, solidityPacked } = require('ethers');
const solc = require('solc');

const FORK_RPC = process.env.FORK_RPC_URL || 'http://127.0.0.1:8545';
const POOL_SAMPLE = '0x1445f32d1a74872ba41f3d8cf4022e9996120b31';
const FACTORY = '0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865';
const POOL_DEPLOYER = '0x41ff9aa7e16b8b1a8a8dc4f0efacd93d02d071c9';
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const FEE = 100;
const LOWER = -887272;
const UPPER = 887272;
const LIQUIDITY = 1n << 100n;
const UINT128_MASK = (1n << 128n) - 1n;
const WETH_ABI = [
  'function deposit() payable',
  'function transfer(address to, uint256 value) returns (bool)',
];

const HARNESS_SOURCE = `
pragma solidity =0.7.6;

interface IERC20Test {
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IPancakePoolTest {
    function mint(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes calldata data)
        external returns (uint256 amount0, uint256 amount1);
    function burn(int24 tickLower, int24 tickUpper, uint128 amount)
        external returns (uint256 amount0, uint256 amount1);
    function collect(address recipient, int24 tickLower, int24 tickUpper, uint128 amount0Requested, uint128 amount1Requested)
        external returns (uint128 amount0, uint128 amount1);
}

contract TestToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract PositionHarness {
    address public immutable pool;
    address public immutable token0;
    address public immutable token1;
    constructor(address pool_, address token0_, address token1_) {
        pool = pool_;
        token0 = token0_;
        token1 = token1_;
    }
    function mintPosition(int24 lower, int24 upper, uint128 liquidity) external {
        IPancakePoolTest(pool).mint(address(this), lower, upper, liquidity, '');
    }
    function pancakeV3MintCallback(uint256 amount0, uint256 amount1, bytes calldata) external {
        require(msg.sender == pool, 'pool only');
        if (amount0 != 0) IERC20Test(token0).transfer(pool, amount0);
        if (amount1 != 0) IERC20Test(token1).transfer(pool, amount1);
    }
    function burnPosition(int24 lower, int24 upper, uint128 liquidity) external {
        IPancakePoolTest(pool).burn(lower, upper, liquidity);
    }
    function collectAll(int24 lower, int24 upper) external {
        IPancakePoolTest(pool).collect(msg.sender, lower, upper, uint128(-1), uint128(-1));
    }
}
`;

async function fetchVerified(address) {
  let response;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    response = await fetch(`https://eth.blockscout.com/api/v2/smart-contracts/${address}`);
    if (response.ok) return response.json();
    if (response.status < 500) break;
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw new Error(`Blockscout source request failed: ${response.status}`);
}

function compileVerified(metadata) {
  const sources = { [metadata.file_path]: { content: metadata.source_code } };
  for (const entry of metadata.additional_sources || []) {
    sources[entry.file_path] = { content: entry.source_code };
  }
  const settings = JSON.parse(JSON.stringify(metadata.compiler_settings));
  settings.outputSelection = {
    '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] },
  };
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings })));
  const errors = (output.errors || []).filter((entry) => entry.severity === 'error');
  assert.deepEqual(errors, [], errors.map((entry) => entry.formattedMessage).join('\n'));
  return output.contracts[metadata.file_path][metadata.name];
}

function assertRuntimeMatches(compiled, verifiedRuntime) {
  const expected = compiled.evm.deployedBytecode.object.toLowerCase();
  const actual = verifiedRuntime.slice(2).toLowerCase();
  assert.equal(actual.length, expected.length, 'runtime bytecode length differs');
  const immutableNibbles = new Set();
  for (const locations of Object.values(compiled.evm.deployedBytecode.immutableReferences || {})) {
    for (const { start, length } of locations) {
      for (let index = start * 2; index < (start + length) * 2; index += 1) immutableNibbles.add(index);
    }
  }
  let mismatches = 0;
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== expected[index] && !immutableNibbles.has(index)) mismatches += 1;
  }
  assert.equal(mismatches, 0, `source/runtime mismatch outside immutable slots: ${mismatches} nibbles`);
}

function compileHarness() {
  const input = {
    language: 'Solidity',
    sources: { 'Harness.sol': { content: HARNESS_SOURCE } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'istanbul',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((entry) => entry.severity === 'error');
  assert.deepEqual(errors, [], errors.map((entry) => entry.formattedMessage).join('\n'));
  return output.contracts['Harness.sol'];
}

async function main() {
  assert.match(solc.version(), /^0\.7\.6\+/);
  const provider = new JsonRpcProvider(FORK_RPC);
  const network = await provider.getNetwork();
  assert.equal(network.chainId, 1n, 'connect this test to a local Ethereum mainnet fork');

  const metadata = await fetchVerified(POOL_SAMPLE);
  assert.equal(metadata.name, 'PancakeV3Pool');
  const actualSampleRuntime = await provider.send('eth_getCode', [POOL_SAMPLE, 'latest']);
  assert.equal(actualSampleRuntime.toLowerCase(), metadata.deployed_bytecode.toLowerCase());
  const poolArtifact = compileVerified(metadata);
  assertRuntimeMatches(poolArtifact, actualSampleRuntime);
  const factoryMetadata = await fetchVerified(FACTORY);
  const factoryRuntime = await provider.send('eth_getCode', [FACTORY, 'latest']);
  assertRuntimeMatches(compileVerified(factoryMetadata), factoryRuntime);
  const deployerMetadata = await fetchVerified(POOL_DEPLOYER);
  const deployerRuntime = await provider.send('eth_getCode', [POOL_DEPLOYER, 'latest']);
  assertRuntimeMatches(compileVerified(deployerMetadata), deployerRuntime);
  console.log('PASS: sampled pool, factory, and pool-deployer runtimes match verified source and compiler settings.');

  const factory = new Contract(FACTORY, factoryMetadata.abi, await provider.getSigner(0));
  assert.equal(await factory.feeAmountTickSpacing(FEE), 1n);

  const artifacts = compileHarness();
  const signer = await provider.getSigner(0);
  const deploy = async (name, args = []) => {
    const artifact = artifacts[name];
    const contract = await new ContractFactory(artifact.abi, `0x${artifact.evm.bytecode.object}`, signer).deploy(...args);
    await contract.waitForDeployment();
    return contract;
  };

  const token = await deploy('TestToken');
  const tokenAddress = await token.getAddress();
  const createTx = await factory.createPool(tokenAddress, WETH, FEE);
  await createTx.wait();
  const poolAddress = await factory.getPool(tokenAddress, WETH, FEE);
  assert.notEqual(poolAddress, '0x0000000000000000000000000000000000000000');
  const pool = new Contract(poolAddress, metadata.abi, signer);
  const token0 = await pool.token0();
  const token1 = await pool.token1();
  assert.equal(token0.toLowerCase(), (tokenAddress.toLowerCase() < WETH.toLowerCase() ? tokenAddress : WETH).toLowerCase());
  const syntheticIsToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
  const minSqrtPrice = 4295128739n;
  const maxSqrtPrice = 1461446703485210103287273052203988822378723970342n;
  const sqrtPriceX96 = syntheticIsToken0 ? minSqrtPrice : maxSqrtPrice - 1n;
  await (await pool.initialize(sqrtPriceX96)).wait();

  const harness = await deploy('PositionHarness', [poolAddress, token0, token1]);
  const harnessAddress = await harness.getAddress();
  await (await token.mint(harnessAddress, 1n << 200n)).wait();
  if (!syntheticIsToken0) {
    const weth = new Contract(WETH, WETH_ABI, signer);
    const seed = 10n ** 18n;
    await (await weth.deposit({ value: seed })).wait();
    await (await weth.transfer(harnessAddress, seed)).wait();
  }
  await provider.send('evm_increaseTime', [1]);
  await provider.send('evm_mine', []);
  try {
    await harness.mintPosition.staticCall(LOWER, UPPER, LIQUIDITY);
  } catch (error) {
    console.error('mint simulation revert', { tokenAddress, token0, token1, poolAddress, harnessAddress, syntheticIsToken0, short: error.shortMessage, reason: error.reason, data: error.data });
    throw error;
  }
  await (await harness.mintPosition(LOWER, UPPER, LIQUIDITY)).wait();
  assert.equal(await pool.maxLiquidityPerTick() > LIQUIDITY, true, 'test liquidity must be below deployed tick cap');

  const burnTx = await harness.burnPosition(LOWER, UPPER, LIQUIDITY);
  const burnReceipt = await burnTx.wait();
  const burnEvent = burnReceipt.logs.map((log) => {
    try { return pool.interface.parseLog(log); } catch { return null; }
  }).find((entry) => entry && entry.name === 'Burn');
  assert.ok(burnEvent, 'pool Burn event missing');
  const fullPrincipal = syntheticIsToken0 ? burnEvent.args.amount0 : burnEvent.args.amount1;
  assert.ok(fullPrincipal > (1n << 128n), `expected principal > uint128, got ${fullPrincipal}`);

  const positionKey = keccak256(solidityPacked(['address', 'int24', 'int24'], [harnessAddress, LOWER, UPPER]));
  const position = await pool.positions(positionKey);
  const recordedOwed = syntheticIsToken0 ? position.tokensOwed0 : position.tokensOwed1;
  assert.equal(recordedOwed, fullPrincipal & UINT128_MASK, 'owed field should equal the truncated principal');

  const beforeCollect = await new Contract(tokenAddress, artifacts.TestToken.abi, signer).balanceOf(poolAddress);
  const collectTx = await harness.collectAll(LOWER, UPPER);
  const collectReceipt = await collectTx.wait();
  const collectEvent = collectReceipt.logs.map((log) => {
    try { return pool.interface.parseLog(log); } catch { return null; }
  }).find((entry) => entry && entry.name === 'Collect');
  assert.ok(collectEvent, 'pool Collect event missing');
  const collected = syntheticIsToken0 ? collectEvent.args.amount0 : collectEvent.args.amount1;
  const afterCollect = await new Contract(tokenAddress, artifacts.TestToken.abi, signer).balanceOf(poolAddress);
  assert.equal(collected, recordedOwed);
  assert.ok(afterCollect > 0n && afterCollect < beforeCollect);
  assert.equal(beforeCollect - afterCollect, collected);

  console.log('PASS: on-chain Pancake V3 pool code reproduces principal narrowing on a local fork.');
  console.log(JSON.stringify({
    forkBlock: await provider.send('eth_blockNumber', []),
    poolAddress,
    syntheticTokenIsToken0: syntheticIsToken0,
    liquidity: LIQUIDITY.toString(),
    tickLiquidityCap: (await pool.maxLiquidityPerTick()).toString(),
    fullPrincipal: fullPrincipal.toString(),
    recordedAndCollected: collected.toString(),
    strandedPoolBalance: afterCollect.toString(),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

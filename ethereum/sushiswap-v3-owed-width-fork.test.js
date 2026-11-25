const assert = require('node:assert/strict');
const path = require('node:path');
const solc = require('solc');
const ganache = require('ganache');
const {
  BrowserProvider,
  Contract,
  ContractFactory,
  keccak256,
  solidityPacked,
} = require('ethers');

const FORK_RPC_URL = process.env.FORK_RPC_URL || 'https://ethereum-rpc.publicnode.com';
const FORK_BLOCK = process.env.FORK_BLOCK ? Number(process.env.FORK_BLOCK) : undefined;
const POOL_SAMPLE = '0x769db46f39c42ee7ad5f71f4167c47edd281e767';
const FACTORY = '0xbACEB8eC6b9355Dfc0269C18bac9d6E2Bdc29C4F';
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const FEE = 3000;
const LOWER = -887220;
const UPPER = 887220;
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

interface IV3PoolTest {
    function initialize(uint160 sqrtPriceX96) external;
    function mint(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes calldata data)
        external returns (uint256 amount0, uint256 amount1);
    function burn(int24 tickLower, int24 tickUpper, uint128 amount)
        external returns (uint256 amount0, uint256 amount1);
    function collect(address recipient, int24 tickLower, int24 tickUpper, uint128 amount0Requested, uint128 amount1Requested)
        external returns (uint128 amount0, uint128 amount1);
}

contract TestToken {
    mapping(address => uint256) public balanceOf;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
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
    function mintPosition(int24 lower, int24 upper, uint128 amount) external {
        IV3PoolTest(pool).mint(address(this), lower, upper, amount, '');
    }
    function uniswapV3MintCallback(uint256 amount0, uint256 amount1, bytes calldata) external {
        require(msg.sender == pool, 'pool only');
        if (amount0 != 0) IERC20Test(token0).transfer(pool, amount0);
        if (amount1 != 0) IERC20Test(token1).transfer(pool, amount1);
    }
    function burnPosition(int24 lower, int24 upper, uint128 amount) external {
        IV3PoolTest(pool).burn(lower, upper, amount);
    }
    function collectAll(int24 lower, int24 upper) external {
        IV3PoolTest(pool).collect(msg.sender, lower, upper, uint128(-1), uint128(-1));
    }
}`;

async function fetchSourcify(address) {
  const response = await fetch(`https://sourcify.dev/server/v2/contract/1/${address}?fields=sources,metadata`);
  assert.equal(response.status, 200, `Sourcify request failed for ${address}`);
  return response.json();
}

function compileVerified(verified) {
  assert.equal(verified.match, 'match');
  assert.equal(verified.runtimeMatch, 'match');
  const metadata = verified.metadata;
  const settings = JSON.parse(JSON.stringify(metadata.settings));
  const [file, name] = Object.entries(metadata.settings.compilationTarget)[0];
  const sources = {};
  const pending = [file];
  while (pending.length > 0) {
    const sourcePath = pending.pop();
    if (sources[sourcePath]) continue;
    const source = verified.sources[sourcePath];
    assert.ok(source?.content, `missing verified source ${sourcePath}`);
    sources[sourcePath] = { content: source.content };
    for (const match of source.content.matchAll(/import\s+(?:[^"']*from\s+)?["']([^"']+)["']\s*;/g)) {
      const imported = match[1].startsWith('.')
        ? path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), match[1]))
        : match[1];
      if (verified.sources[imported] && !sources[imported]) pending.push(imported);
    }
  }
  delete settings.compilationTarget;
  settings.outputSelection = { [file]: { [name]: ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } };
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings })));
  const errors = (output.errors || []).filter((entry) => entry.severity === 'error');
  assert.deepEqual(errors, [], errors.map((entry) => entry.formattedMessage).join('\n'));
  return output.contracts[file][name];
}

function assertRuntimeMatches(compiled, runtime) {
  const expected = compiled.evm.deployedBytecode.object.toLowerCase();
  const actual = runtime.slice(2).toLowerCase();
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
      optimizer: { enabled: true, runs: 800 },
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
  const forkOptions = { url: FORK_RPC_URL };
  if (FORK_BLOCK !== undefined) forkOptions.blockNumber = FORK_BLOCK;
  const fork = ganache.provider({
    chain: { chainId: 1 },
    fork: forkOptions,
    logging: { quiet: true },
  });

  try {
    const provider = new BrowserProvider(fork);
    assert.equal((await provider.getNetwork()).chainId, 1n);
    const forkBaseBlock = await provider.getBlockNumber();
    const poolVerified = await fetchSourcify(POOL_SAMPLE);
    const factoryVerified = await fetchSourcify(FACTORY);
    const poolRuntime = await provider.send('eth_getCode', [POOL_SAMPLE, 'latest']);
    const factoryRuntime = await provider.send('eth_getCode', [FACTORY, 'latest']);
    assertRuntimeMatches(compileVerified(poolVerified), poolRuntime);
    assertRuntimeMatches(compileVerified(factoryVerified), factoryRuntime);

    const signer = await provider.getSigner(0);
    const factory = new Contract(FACTORY, factoryVerified.metadata.output.abi, signer);
    assert.equal(await factory.feeAmountTickSpacing(FEE), 60n);
    const artifacts = compileHarness();
    const deploy = async (name, args = []) => {
      const artifact = artifacts[name];
      const contract = await new ContractFactory(
        artifact.abi,
        `0x${artifact.evm.bytecode.object}`,
        signer,
      ).deploy(...args);
      await contract.waitForDeployment();
      return contract;
    };

    const token = await deploy('TestToken');
    const tokenAddress = await token.getAddress();
    await (await factory.createPool(tokenAddress, WETH, FEE)).wait();
    const poolAddress = await factory.getPool(tokenAddress, WETH, FEE);
    assert.notEqual(poolAddress, '0x0000000000000000000000000000000000000000');

    const poolArtifact = compileVerified(poolVerified);
    const poolRuntimeCreated = await provider.send('eth_getCode', [poolAddress, 'latest']);
    assertRuntimeMatches(poolArtifact, poolRuntimeCreated);
    const pool = new Contract(poolAddress, poolArtifact.abi, signer);
    const token0 = await pool.token0();
    const token1 = await pool.token1();
    assert.equal(token0.toLowerCase(), (tokenAddress.toLowerCase() < WETH.toLowerCase() ? tokenAddress : WETH).toLowerCase());
    const syntheticIsToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
    const minSqrtPrice = 4295128739n;
    const maxSqrtPrice = 1461446703485210103287273052203988822378723970342n;
    await (await pool.initialize(syntheticIsToken0 ? minSqrtPrice : maxSqrtPrice - 1n)).wait();

    const harness = await deploy('PositionHarness', [poolAddress, token0, token1]);
    const harnessAddress = await harness.getAddress();
    await (await token.mint(harnessAddress, 1n << 200n)).wait();
    if (!syntheticIsToken0) {
      const weth = new Contract(WETH, WETH_ABI, signer);
      const seed = 10n ** 18n;
      await (await weth.deposit({ value: seed })).wait();
      await (await weth.transfer(harnessAddress, seed)).wait();
    }

    try {
      await harness.mintPosition.staticCall(LOWER, UPPER, LIQUIDITY);
    } catch (error) {
      console.error('mint simulation failed', { token0, token1, syntheticIsToken0, short: error.shortMessage, data: error.data, reason: error.reason });
      throw error;
    }
    const mintReceipt = await (await harness.mintPosition(LOWER, UPPER, LIQUIDITY, { gasLimit: 5_000_000 })).wait();
    assert.ok(mintReceipt.status === 1);
    const liquidityCap = await pool.maxLiquidityPerTick();
    assert.ok(LIQUIDITY < liquidityCap, 'position is below maxLiquidityPerTick');

    const burnReceipt = await (await harness.burnPosition(LOWER, UPPER, LIQUIDITY, { gasLimit: 5_000_000 })).wait();
    const burnEvent = burnReceipt.logs.map((log) => {
      try { return pool.interface.parseLog(log); } catch { return null; }
    }).find((entry) => entry && entry.name === 'Burn');
    assert.ok(burnEvent, 'Burn event missing');
    const fullPrincipal = syntheticIsToken0 ? burnEvent.args.amount0 : burnEvent.args.amount1;
    assert.ok(fullPrincipal > (1n << 128n), `expected principal > uint128, got ${fullPrincipal}`);

    const positionKey = keccak256(solidityPacked(['address', 'int24', 'int24'], [harnessAddress, LOWER, UPPER]));
    const position = await pool.positions(positionKey);
    const recordedOwed = syntheticIsToken0 ? position.tokensOwed0 : position.tokensOwed1;
    assert.equal(position.liquidity, 0n, 'position must be fully burned');
    assert.equal(recordedOwed, fullPrincipal & UINT128_MASK);

    const tokenContract = new Contract(tokenAddress, ['function balanceOf(address) view returns(uint256)'], signer);
    const beforeCollect = await tokenContract.balanceOf(poolAddress);
    const collectReceipt = await (await harness.collectAll(LOWER, UPPER, { gasLimit: 5_000_000 })).wait();
    const collectEvent = collectReceipt.logs.map((log) => {
      try { return pool.interface.parseLog(log); } catch { return null; }
    }).find((entry) => entry && entry.name === 'Collect');
    assert.ok(collectEvent, 'Collect event missing');
    const collected = syntheticIsToken0 ? collectEvent.args.amount0 : collectEvent.args.amount1;
    const strandedBalance = await tokenContract.balanceOf(poolAddress);
    assert.equal(collected, recordedOwed);
    assert.equal(beforeCollect - strandedBalance, collected);
    assert.ok(strandedBalance >= fullPrincipal - recordedOwed);
    assert.ok(strandedBalance - (fullPrincipal - recordedOwed) <= 1n, 'only rounding dust may exceed the truncated claim');
    assert.ok(strandedBalance > 0n);

    console.log(JSON.stringify({
      requestedForkBlock: FORK_BLOCK ?? 'latest',
      forkBaseBlock,
      localHead: await provider.getBlockNumber(),
      sourceRuntimeMatch: 'Sourcify runtime match plus local Solidity 0.7.6 recompilation for pool and factory',
      sourceCommit: '21dfbed6b5e343559a14a7825e3d2f3be2611d8a',
      samplePool: POOL_SAMPLE,
      factory: FACTORY,
      createdPool: poolAddress,
      syntheticTokenIsToken0: syntheticIsToken0,
      liquidity: LIQUIDITY.toString(),
      maxLiquidityPerTick: liquidityCap.toString(),
      fullPrincipal: fullPrincipal.toString(),
      recordedAndCollected: collected.toString(),
      strandedPrincipal: strandedBalance.toString(),
      publicTransactions: 0,
    }, null, 2));
  } finally {
    await fork.disconnect();
  }
}

main().catch((error) => {
  console.error(error.stack || error.shortMessage || error.message || String(error));
  process.exitCode = 1;
});

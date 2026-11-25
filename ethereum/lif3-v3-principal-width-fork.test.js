const assert = require('node:assert/strict');
const solc = require('solc');
const ganache = require('ganache');
const { BrowserProvider, Contract, ContractFactory, keccak256, solidityPacked } = require('ethers');

const FORK_RPC_URL = process.env.FORK_RPC_URL || 'https://ethereum-rpc.publicnode.com';
const FORK_BLOCK = process.env.FORK_BLOCK ? Number(process.env.FORK_BLOCK) : undefined;
const FACTORY = '0x129538ee65a692fa041e107921d716c31d186803';
const SAMPLE_POOL = '0xa70e93c5eb55a88b191a732e14189ad3d2df38f2';
const GECKO_URL = 'https://api.geckoterminal.com/api/v2/networks/eth/dexes/lif3-ethereum/pools?page=1';
const FEE = 3000;
const LOWER = -887220;
const UPPER = 887220;
const LIQUIDITY = 1n << 100n;
const UINT128_MASK = (1n << 128n) - 1n;

const HARNESS_SOURCE = `
pragma solidity =0.7.6;
interface IERC20Test { function transfer(address to, uint256 amount) external returns (bool); }
interface IV3PoolTest {
    function initialize(uint160 sqrtPriceX96) external;
    function mint(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes calldata data)
        external returns (uint256 amount0, uint256 amount1);
    function burn(int24 tickLower, int24 tickUpper, uint128 amount) external returns (uint256 amount0, uint256 amount1);
    function collect(address recipient, int24 tickLower, int24 tickUpper, uint128 amount0Requested, uint128 amount1Requested)
        external returns (uint128 amount0, uint128 amount1);
}
contract TestToken {
    mapping(address => uint256) public balanceOf;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount; balanceOf[to] += amount; return true;
    }
}
contract PositionHarness {
    address public immutable pool; address public immutable token0; address public immutable token1;
    constructor(address p, address a, address b) { pool = p; token0 = a; token1 = b; }
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

async function fetchWithRetry(url) {
  let response;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    response = await fetch(url);
    if (![500, 502, 503, 504].includes(response.status)) return response;
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  return response;
}

async function fetchVerified(address) {
  const response = await fetchWithRetry(`https://eth.blockscout.com/api/v2/smart-contracts/${address}`);
  assert.equal(response.status, 200, `Blockscout request failed for ${address}`);
  const record = await response.json();
  assert.equal(record.is_verified, true);
  return record;
}

function compileExplorerSource(record, contractName) {
  assert.equal(record.compiler_version, '0.7.6+commit.7338295f');
  const settings = JSON.parse(JSON.stringify(record.compiler_settings));
  settings.outputSelection = { [record.file_path]: { [contractName]: ['abi', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } };
  const input = {
    language: 'Solidity',
    sources: { [record.file_path]: { content: record.source_code } },
    settings,
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((entry) => entry.severity === 'error');
  assert.deepEqual(errors, [], errors.map((entry) => entry.formattedMessage).join('\n'));
  return output.contracts[record.file_path][contractName];
}

function stripMetadata(bytecode) {
  const metadataBytes = Number.parseInt(bytecode.slice(-4), 16);
  return bytecode.slice(0, bytecode.length - (metadataBytes + 2) * 2);
}

function assertRuntimeMatches(artifact, deployedRuntime) {
  const expected = stripMetadata(artifact.evm.deployedBytecode.object.toLowerCase());
  const actual = stripMetadata(deployedRuntime.slice(2).toLowerCase());
  assert.equal(actual.length, expected.length, 'runtime length differs outside metadata');
  const immutableNibbles = new Set();
  for (const locations of Object.values(artifact.evm.deployedBytecode.immutableReferences || {})) {
    for (const { start, length } of locations) {
      for (let index = start * 2; index < (start + length) * 2; index += 1) immutableNibbles.add(index);
    }
  }
  for (let index = 0; index < actual.length; index += 1) {
    if (!immutableNibbles.has(index)) assert.equal(actual[index], expected[index], `runtime mismatch at nibble ${index}`);
  }
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
  const fork = ganache.provider({
    chain: { chainId: 1 },
    fork: { url: FORK_RPC_URL, ...(FORK_BLOCK === undefined ? {} : { blockNumber: FORK_BLOCK }) },
    logging: { quiet: true },
  });

  try {
    const provider = new BrowserProvider(fork);
    const forkBaseBlock = await provider.getBlockNumber();
    const signer = await provider.getSigner(0);
    const [poolRecord, factoryRecord, geckoResponse] = await Promise.all([
      fetchVerified(SAMPLE_POOL), fetchVerified(FACTORY), fetchWithRetry(GECKO_URL),
    ]);
    assert.equal(geckoResponse.status, 200);
    const gecko = await geckoResponse.json();
    const poolArtifact = compileExplorerSource(poolRecord, 'Lif3V3Pool');
    assertRuntimeMatches(poolArtifact, await provider.send('eth_getCode', [SAMPLE_POOL, 'latest']));

    const factory = new Contract(FACTORY, [
      'function feeAmountTickSpacing(uint24) view returns (int24)',
      'function createPool(address,address,uint24) returns (address)',
      'function getPool(address,address,uint24) view returns (address)',
    ], signer);
    assert.equal(await factory.feeAmountTickSpacing(FEE), 60n);
    const indexedPools = [];
    for (const entry of gecko.data) {
      const pool = new Contract(entry.attributes.address, [
        'function factory() view returns (address)', 'function token0() view returns (address)',
        'function token1() view returns (address)', 'function fee() view returns (uint24)',
      ], provider);
      const [poolFactory, token0, token1, fee] = await Promise.all([
        pool.factory(), pool.token0(), pool.token1(), pool.fee(),
      ]);
      assert.equal(poolFactory.toLowerCase(), FACTORY.toLowerCase());
      assert.equal((await factory.getPool(token0, token1, fee)).toLowerCase(), entry.attributes.address.toLowerCase());
      indexedPools.push({ address: entry.attributes.address, name: entry.attributes.name, fee: Number(fee) });
    }

    const harnessArtifacts = compileHarness();
    const deploy = async (name, args = []) => {
      const artifact = harnessArtifacts[name];
      const contract = await new ContractFactory(artifact.abi, `0x${artifact.evm.bytecode.object}`, signer)
        .deploy(...args);
      await contract.waitForDeployment();
      return contract;
    };
    const tokenA = await deploy('TestToken');
    const tokenB = await deploy('TestToken');
    await (await factory.createPool(await tokenA.getAddress(), await tokenB.getAddress(), FEE)).wait();
    const poolAddress = await factory.getPool(await tokenA.getAddress(), await tokenB.getAddress(), FEE);
    assert.notEqual(poolAddress, '0x0000000000000000000000000000000000000000');
    assertRuntimeMatches(poolArtifact, await provider.send('eth_getCode', [poolAddress, 'latest']));
    const pool = new Contract(poolAddress, [
      'function initialize(uint160 sqrtPriceX96)', 'function token0() view returns (address)',
      'function maxLiquidityPerTick() view returns (uint128)',
      'function positions(bytes32) view returns (uint128,uint256,uint256,uint128,uint128)',
      'event Burn(address indexed owner,int24 indexed tickLower,int24 indexed tickUpper,uint128 amount,uint256 amount0,uint256 amount1)',
      'event Collect(address indexed owner,address recipient,int24 indexed tickLower,int24 indexed tickUpper,uint128 amount0,uint128 amount1)',
    ], signer);
    const token0 = await pool.token0();
    const token0IsA = token0.toLowerCase() === (await tokenA.getAddress()).toLowerCase();
    const syntheticToken0 = token0IsA ? tokenA : tokenB;
    const syntheticToken1 = token0IsA ? tokenB : tokenA;
    const minimumSqrtPrice = 4295128739n;
    const maximumSqrtPrice = 1461446703485210103287273052203988822378723970342n;
    await (await pool.initialize(token0IsA ? minimumSqrtPrice : maximumSqrtPrice - 1n)).wait();

    const harness = await deploy('PositionHarness', [poolAddress, token0, token0IsA ? await tokenB.getAddress() : await tokenA.getAddress()]);
    const harnessAddress = await harness.getAddress();
    await (await syntheticToken0.mint(harnessAddress, 1n << 200n)).wait();
    await (await syntheticToken1.mint(harnessAddress, 1n << 200n)).wait();
    await (await harness.mintPosition(LOWER, UPPER, LIQUIDITY, { gasLimit: 5_000_000 })).wait();
    const maxLiquidityPerTick = await pool.maxLiquidityPerTick();
    assert.ok(LIQUIDITY < maxLiquidityPerTick);

    const burnReceipt = await (await harness.burnPosition(LOWER, UPPER, LIQUIDITY, { gasLimit: 5_000_000 })).wait();
    const burnEvent = burnReceipt.logs.map((log) => {
      try { return pool.interface.parseLog(log); } catch { return null; }
    }).find((entry) => entry && entry.name === 'Burn');
    assert.ok(burnEvent);
    const targetIsToken0 = token0.toLowerCase() === (await syntheticToken0.getAddress()).toLowerCase();
    const principal = targetIsToken0 ? burnEvent.args.amount0 : burnEvent.args.amount1;
    const positionKey = keccak256(solidityPacked(['address', 'int24', 'int24'], [harnessAddress, LOWER, UPPER]));
    const position = await pool.positions(positionKey);
    const owed = targetIsToken0 ? position[3] : position[4];
    assert.ok(principal > (1n << 128n));
    assert.equal(position[0], 0n);
    assert.equal(owed, principal & UINT128_MASK);

    const trackedToken = targetIsToken0 ? syntheticToken0 : syntheticToken1;
    const balanceBeforeCollect = await trackedToken.balanceOf(poolAddress);
    const collectReceipt = await (await harness.collectAll(LOWER, UPPER, { gasLimit: 5_000_000 })).wait();
    const collectEvent = collectReceipt.logs.map((log) => {
      try { return pool.interface.parseLog(log); } catch { return null; }
    }).find((entry) => entry && entry.name === 'Collect');
    assert.ok(collectEvent);
    const collected = targetIsToken0 ? collectEvent.args.amount0 : collectEvent.args.amount1;
    const stranded = await trackedToken.balanceOf(poolAddress);
    assert.equal(collected, owed);
    assert.equal(balanceBeforeCollect - stranded, collected);
    assert.ok(stranded >= principal - owed);
    assert.ok(stranded - (principal - owed) <= 1n);

    console.log(JSON.stringify({
      forkBaseBlock,
      factory: FACTORY,
      sourceRuntimeMatch: 'exact outside immutable references and metadata for the sample pool',
      sourceStatus: { poolPartial: poolRecord.is_partially_verified, factoryPartial: factoryRecord.is_partially_verified },
      indexedPools,
      syntheticPool: poolAddress,
      fee: FEE,
      tickSpacing: 60,
      liquidity: LIQUIDITY.toString(),
      maxLiquidityPerTick: maxLiquidityPerTick.toString(),
      principalReturnedByBurn: principal.toString(),
      amountRecordedAndCollected: collected.toString(),
      principalRemainingInPool: stranded.toString(),
      transactionCountOnPublicChain: 0,
    }, null, 2));
  } finally {
    await fork.disconnect();
  }
}

main().catch((error) => {
  console.error(error.stack || error.shortMessage || error.message || String(error));
  process.exitCode = 1;
});

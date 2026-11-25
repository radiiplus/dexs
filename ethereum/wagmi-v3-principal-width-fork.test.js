const assert = require('node:assert/strict');
const solc = require('solc');
const ganache = require('ganache');
const { BrowserProvider, Contract, ContractFactory, keccak256, solidityPacked } = require('ethers');

const FORK_RPC_URL = process.env.FORK_RPC_URL || 'https://ethereum-rpc.publicnode.com';
const FORK_BLOCK = process.env.FORK_BLOCK ? Number(process.env.FORK_BLOCK) : undefined;
const FACTORY = '0xb9a14ee1cd3417f3acc988f61650895151abde24';
const SAMPLE_POOL = '0x42e73578f175884455ee020af59ca5c355ed2278';
const GECKO_URL = 'https://api.geckoterminal.com/api/v2/networks/eth/dexes/wagmi-ethereum/pools?page=1';
const FEE = 500;
const LOWER = -887220;
const UPPER = 887220;
const LIQUIDITY = 1n << 100n;
const UINT128_MASK = (1n << 128n) - 1n;

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
  const fork = ganache.provider({
    chain: { chainId: 1 },
    fork: { url: FORK_RPC_URL, ...(FORK_BLOCK === undefined ? {} : { blockNumber: FORK_BLOCK }) },
    logging: { quiet: true },
  });

  try {
    const provider = new BrowserProvider(fork);
    const forkBaseBlock = await provider.getBlockNumber();
    const signer = await provider.getSigner(0);
    const [geckoResponse] = await Promise.all([fetch(GECKO_URL)]);
    assert.equal(geckoResponse.status, 200);
    const gecko = await geckoResponse.json();
    const factory = new Contract(FACTORY, [
      'function feeAmountTickSpacing(uint24) view returns (int24)',
      'function createPool(address,address,uint24) returns (address)',
      'function getPool(address,address,uint24) view returns (address)',
    ], signer);
    assert.equal(await factory.feeAmountTickSpacing(FEE), 10n);

    const listedPools = [];
    for (const entry of gecko.data) {
      const listedPool = new Contract(entry.attributes.address, [
        'function factory() view returns (address)',
        'function token0() view returns (address)',
        'function token1() view returns (address)',
        'function fee() view returns (uint24)',
      ], provider);
      const [poolFactory, token0, token1, fee] = await Promise.all([
        listedPool.factory(), listedPool.token0(), listedPool.token1(), listedPool.fee(),
      ]);
      assert.equal(poolFactory.toLowerCase(), FACTORY.toLowerCase());
      assert.equal((await factory.getPool(token0, token1, fee)).toLowerCase(), entry.attributes.address.toLowerCase());
      listedPools.push({ address: entry.attributes.address, name: entry.attributes.name, fee: Number(fee) });
    }

    const artifacts = compileHarness();
    const deploy = async (name, args = []) => {
      const artifact = artifacts[name];
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

    const pool = new Contract(poolAddress, [
      'function initialize(uint160 sqrtPriceX96)',
      'function token0() view returns (address)',
      'function token1() view returns (address)',
      'function maxLiquidityPerTick() view returns (uint128)',
      'function positions(bytes32) view returns (uint128,uint256,uint256,uint128,uint128)',
      'event Burn(address indexed owner,int24 indexed tickLower,int24 indexed tickUpper,uint128 amount,uint256 amount0,uint256 amount1)',
      'event Collect(address indexed owner,address recipient,int24 indexed tickLower,int24 indexed tickUpper,uint128 amount0,uint128 amount1)',
    ], signer);
    const token0 = await pool.token0();
    const token1 = await pool.token1();
    const syntheticToken0 = (await tokenA.getAddress()).toLowerCase() === token0.toLowerCase()
      ? tokenA : tokenB;
    const syntheticToken1 = syntheticToken0 === tokenA ? tokenB : tokenA;
    const sampleRuntime = await provider.send('eth_getCode', [SAMPLE_POOL, 'latest']);
    const createdRuntime = await provider.send('eth_getCode', [poolAddress, 'latest']);
    assert.equal(sampleRuntime.length, createdRuntime.length, 'factory-created pool runtime size differs from sample');

    const minimumSqrtPrice = 4295128739n;
    const maximumSqrtPrice = 1461446703485210103287273052203988822378723970342n;
    await (await pool.initialize(token0.toLowerCase() === (await tokenA.getAddress()).toLowerCase()
      ? minimumSqrtPrice : maximumSqrtPrice - 1n)).wait();

    const harness = await deploy('PositionHarness', [poolAddress, token0, token1]);
    const harnessAddress = await harness.getAddress();
    await (await syntheticToken0.mint(harnessAddress, 1n << 200n)).wait();
    await (await syntheticToken1.mint(harnessAddress, 1n << 200n)).wait();
    await (await harness.mintPosition(LOWER, UPPER, LIQUIDITY, { gasLimit: 5_000_000 })).wait();
    assert.ok(LIQUIDITY < await pool.maxLiquidityPerTick());

    const burnReceipt = await (await harness.burnPosition(LOWER, UPPER, LIQUIDITY, { gasLimit: 5_000_000 })).wait();
    const burnEvent = burnReceipt.logs.map((log) => {
      try { return pool.interface.parseLog(log); } catch { return null; }
    }).find((entry) => entry && entry.name === 'Burn');
    assert.ok(burnEvent);
    const fullPrincipal = token0.toLowerCase() === (await syntheticToken0.getAddress()).toLowerCase()
      ? burnEvent.args.amount0 : burnEvent.args.amount1;
    const positionKey = keccak256(solidityPacked(['address', 'int24', 'int24'], [harnessAddress, LOWER, UPPER]));
    const position = await pool.positions(positionKey);
    const recordedOwed = token0.toLowerCase() === (await syntheticToken0.getAddress()).toLowerCase()
      ? position[3] : position[4];
    assert.ok(fullPrincipal > (1n << 128n), `burn principal ${fullPrincipal} did not cross uint128; token0=${token0}; tokenA=${await tokenA.getAddress()}; tokenB=${await tokenB.getAddress()}; amount0=${burnEvent.args.amount0}; amount1=${burnEvent.args.amount1}`);
    assert.equal(position[0], 0n);
    assert.equal(recordedOwed, fullPrincipal & UINT128_MASK);

    const trackedToken = token0.toLowerCase() === (await syntheticToken0.getAddress()).toLowerCase()
      ? syntheticToken0 : syntheticToken1;
    const balanceBeforeCollect = await trackedToken.balanceOf(poolAddress);
    const collectReceipt = await (await harness.collectAll(LOWER, UPPER, { gasLimit: 5_000_000 })).wait();
    const collectEvent = collectReceipt.logs.map((log) => {
      try { return pool.interface.parseLog(log); } catch { return null; }
    }).find((entry) => entry && entry.name === 'Collect');
    assert.ok(collectEvent);
    const collected = token0.toLowerCase() === (await syntheticToken0.getAddress()).toLowerCase()
      ? collectEvent.args.amount0 : collectEvent.args.amount1;
    const stranded = await trackedToken.balanceOf(poolAddress);
    assert.equal(collected, recordedOwed);
    assert.equal(balanceBeforeCollect - stranded, collected);
    assert.ok(stranded >= fullPrincipal - recordedOwed);
    assert.ok(stranded - (fullPrincipal - recordedOwed) <= 1n);

    console.log(JSON.stringify({
      forkBaseBlock,
      factory: FACTORY,
      samplePool: SAMPLE_POOL,
      geckoTerminalPools: listedPools,
      allGeckoPoolsRegistered: true,
      syntheticPool: poolAddress,
      fee: FEE,
      tickSpacing: 10,
      runtimeBytes: (createdRuntime.length - 2) / 2,
      liquidity: LIQUIDITY.toString(),
      maxLiquidityPerTick: (await pool.maxLiquidityPerTick()).toString(),
      principalReturnedByBurn: fullPrincipal.toString(),
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

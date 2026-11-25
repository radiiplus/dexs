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
const POOL_SAMPLE = '0x831bf48183b999fde45294b14b55199072f0801b';
const FACTORY = '0x70Fe4a44EA505cFa3A57b95cF2862D4fd5F0f687';
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const FEE_TIER = 500;
const LOWER = -887270;
const UPPER = 887270;
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

interface ISolidlyPoolTest {
    function initialize(uint160 sqrtPriceX96) external;
    function mint(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes calldata data)
        external returns (uint256 amount0, uint256 amount1);
    function burn(int24 tickLower, int24 tickUpper, uint128 amount)
        external returns (uint256 amount0, uint256 amount1);
    function collect(address recipient, int24 tickLower, int24 tickUpper, uint128 amount0Requested, uint128 amount1Requested)
        external returns (uint128 amount0, uint128 amount1);
    function flash(address recipient, uint256 amount0, uint256 amount1, bytes calldata data) external;
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
    uint256 private _flashAmount0;
    uint256 private _flashAmount1;
    constructor(address pool_, address token0_, address token1_) {
        pool = pool_;
        token0 = token0_;
        token1 = token1_;
    }
    function mintPosition(int24 lower, int24 upper, uint128 amount) external {
        ISolidlyPoolTest(pool).mint(address(this), lower, upper, amount, '');
    }
    function solidlyV3MintCallback(uint256 amount0, uint256 amount1, bytes calldata) external {
        require(msg.sender == pool, 'pool only');
        if (amount0 != 0) IERC20Test(token0).transfer(pool, amount0);
        if (amount1 != 0) IERC20Test(token1).transfer(pool, amount1);
    }
    function burnPosition(int24 lower, int24 upper, uint128 amount) external {
        ISolidlyPoolTest(pool).burn(lower, upper, amount);
    }
    function collectAll(int24 lower, int24 upper) external {
        ISolidlyPoolTest(pool).collect(msg.sender, lower, upper, uint128(-1), uint128(-1));
    }
    function flash(uint256 amount0, uint256 amount1) external {
        _flashAmount0 = amount0;
        _flashAmount1 = amount1;
        ISolidlyPoolTest(pool).flash(address(this), amount0, amount1, '');
        _flashAmount0 = 0;
        _flashAmount1 = 0;
    }
    function solidlyV3FlashCallback(uint256 fee0, uint256 fee1, bytes calldata) external {
        require(msg.sender == pool, 'pool only');
        if (_flashAmount0 + fee0 != 0) IERC20Test(token0).transfer(pool, _flashAmount0 + fee0);
        if (_flashAmount1 + fee1 != 0) IERC20Test(token1).transfer(pool, _flashAmount1 + fee1);
    }
}
`;

const TICK_MATH_HARNESS = `
pragma solidity =0.7.6;
import '../libraries/TickMath.sol';
contract TickMathHarness {
    function sqrtRatioAtTick(int24 tick) external pure returns (uint160) {
        return TickMath.getSqrtRatioAtTick(tick);
    }
}`;

async function fetchVerified(address) {
  const response = await fetch(`https://sourcify.dev/server/v2/contract/1/${address}?fields=sources,metadata`);
  assert.equal(response.status, 200, `Sourcify request failed for ${address}`);
  return response.json();
}

function compileVerified(verified) {
  assert.equal(verified.match, 'match');
  assert.equal(verified.runtimeMatch, 'match');
  const metadata = verified.metadata;
  const [file, name] = Object.entries(metadata.settings.compilationTarget)[0];
  const settings = JSON.parse(JSON.stringify(metadata.settings));
  delete settings.compilationTarget;
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

function compileHarness(verified) {
  const input = {
    language: 'Solidity',
    sources: {
      'Harness.sol': { content: HARNESS_SOURCE },
      'contracts/test/TickMathHarness.sol': { content: TICK_MATH_HARNESS },
      'contracts/libraries/TickMath.sol': verified.sources['contracts/libraries/TickMath.sol'],
    },
    settings: {
      optimizer: { enabled: true, runs: 800 },
      evmVersion: 'istanbul',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((entry) => entry.severity === 'error');
  assert.deepEqual(errors, [], errors.map((entry) => entry.formattedMessage).join('\n'));
  return {
    ...output.contracts['Harness.sol'],
    TickMathHarness: output.contracts['contracts/test/TickMathHarness.sol'].TickMathHarness,
  };
}

async function main() {
  assert.match(solc.version(), /^0\.7\.6\+/);
  const forkOptions = { url: FORK_RPC_URL };
  if (FORK_BLOCK !== undefined) forkOptions.blockNumber = FORK_BLOCK;
  const fork = ganache.provider({ chain: { chainId: 1 }, fork: forkOptions, logging: { quiet: true } });

  try {
    const provider = new BrowserProvider(fork);
    assert.equal((await provider.getNetwork()).chainId, 1n);
    const forkBaseBlock = await provider.getBlockNumber();
    const poolVerified = await fetchVerified(POOL_SAMPLE);
    const factoryVerified = await fetchVerified(FACTORY);
    const poolArtifact = compileVerified(poolVerified);
    const factoryArtifact = compileVerified(factoryVerified);
    const poolRuntime = await provider.send('eth_getCode', [POOL_SAMPLE, 'latest']);
    const factoryRuntime = await provider.send('eth_getCode', [FACTORY, 'latest']);
    assertRuntimeMatches(poolArtifact, poolRuntime);
    assertRuntimeMatches(factoryArtifact, factoryRuntime);

    const signer = await provider.getSigner(0);
    const factory = new Contract(FACTORY, factoryArtifact.abi, signer);
    assert.equal(await factory.feeAmountTickSpacing(FEE_TIER), 10n);
    const artifacts = compileHarness(poolVerified);
    const deploy = async (name, args = []) => {
      const artifact = artifacts[name];
      const contract = await new ContractFactory(artifact.abi, `0x${artifact.evm.bytecode.object}`, signer).deploy(...args);
      await contract.waitForDeployment();
      return contract;
    };

    const tickMath = await deploy('TickMathHarness');
    const token = await deploy('TestToken');
    const tokenAddress = await token.getAddress();
    await (await factory.createPool(tokenAddress, WETH, FEE_TIER)).wait();
    const poolAddress = await factory.getPool(tokenAddress, WETH, 10);
    assert.notEqual(poolAddress, '0x0000000000000000000000000000000000000000');
    assertRuntimeMatches(poolArtifact, await provider.send('eth_getCode', [poolAddress, 'latest']));
    const pool = new Contract(poolAddress, poolArtifact.abi, signer);
    const token0 = await pool.token0();
    const token1 = await pool.token1();
    assert.equal(token0.toLowerCase(), (tokenAddress.toLowerCase() < WETH.toLowerCase() ? tokenAddress : WETH).toLowerCase());
    const syntheticIsToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
    const initialTick = syntheticIsToken0 ? LOWER : UPPER - 1;
    const initialSqrtPrice = await tickMath.sqrtRatioAtTick(initialTick);
    await (await pool.initialize(initialSqrtPrice)).wait();

    const harness = await deploy('PositionHarness', [poolAddress, token0, token1]);
    const harnessAddress = await harness.getAddress();
    await (await token.mint(harnessAddress, 1n << 200n)).wait();
    if (!syntheticIsToken0) {
      const weth = new Contract(WETH, WETH_ABI, signer);
      await (await weth.deposit({ value: 10n ** 18n })).wait();
      await (await weth.transfer(harnessAddress, 10n ** 18n)).wait();
    }
    await (await harness.mintPosition(LOWER, UPPER, LIQUIDITY, { gasLimit: 5_000_000 })).wait();
    const liquidityCap = await pool.maxLiquidityPerTick();
    assert.ok(LIQUIDITY < liquidityCap);

    const burnReceipt = await (await harness.burnPosition(LOWER, UPPER, LIQUIDITY, { gasLimit: 5_000_000 })).wait();
    const burnEvent = burnReceipt.logs.map((log) => {
      try { return pool.interface.parseLog(log); } catch { return null; }
    }).find((entry) => entry && entry.name === 'Burn');
    assert.ok(burnEvent);
    const fullPrincipal = syntheticIsToken0 ? burnEvent.args.amount0 : burnEvent.args.amount1;
    assert.ok(fullPrincipal > (1n << 128n));
    const positionKey = keccak256(solidityPacked(['address', 'int24', 'int24'], [harnessAddress, LOWER, UPPER]));
    let position = await pool.positions(positionKey);
    const recordedOwed = syntheticIsToken0 ? position.tokensOwed0 : position.tokensOwed1;
    assert.equal(position.liquidity, 0n);
    assert.equal(recordedOwed, fullPrincipal & UINT128_MASK);

    const tokenContract = new Contract(tokenAddress, ['function balanceOf(address) view returns(uint256)'], signer);
    await (await harness.collectAll(LOWER, UPPER, { gasLimit: 5_000_000 })).wait();
    let strandedAfterBurn = await tokenContract.balanceOf(poolAddress);
    assert.ok(strandedAfterBurn >= fullPrincipal - recordedOwed);
    assert.ok(strandedAfterBurn - (fullPrincipal - recordedOwed) <= 1n);

    // Refill the position after the full burn so flash() has nonzero active liquidity.
    const remainingLiquidity = LIQUIDITY / 2n;
    await (await harness.mintPosition(LOWER, UPPER, remainingLiquidity, { gasLimit: 5_000_000 })).wait();
    const feeTier = await pool.slot0();
    const fee = BigInt(feeTier.fee);
    const borrowAmount = 1n << 139n;
    const flashAmount0 = syntheticIsToken0 ? borrowAmount : 0n;
    const flashAmount1 = syntheticIsToken0 ? 0n : borrowAmount;
    const expectedFee = (borrowAmount * fee + 999_999n) / 1_000_000n;
    assert.ok(expectedFee > UINT128_MASK, 'test fee must exceed uint128');
    const poolFeesBefore = await pool.poolFees();
    const flashReceipt = await (await harness.flash(flashAmount0, flashAmount1, { gasLimit: 5_000_000 })).wait();
    const flashEvent = flashReceipt.logs.map((log) => {
      try { return pool.interface.parseLog(log); } catch { return null; }
    }).find((entry) => entry && entry.name === 'Flash');
    assert.ok(flashEvent, 'Flash event missing');
    const paid = syntheticIsToken0 ? flashEvent.args.paid0 : flashEvent.args.paid1;
    assert.equal(paid, expectedFee);
    const poolFeesAfter = await pool.poolFees();
    const storedFee = syntheticIsToken0 ? poolFeesAfter.token0 : poolFeesAfter.token1;
    const priorFee = syntheticIsToken0 ? poolFeesBefore.token0 : poolFeesBefore.token1;
    assert.equal(storedFee, (priorFee + (expectedFee & UINT128_MASK)) & UINT128_MASK);
    assert.ok(storedFee < expectedFee, 'fee ledger must lose high bits');

    console.log(JSON.stringify({
      requestedForkBlock: FORK_BLOCK ?? 'latest',
      forkBaseBlock,
      localHead: await provider.getBlockNumber(),
      sourceRuntimeMatch: 'Sourcify runtime match plus local Solidity 0.7.6 recompilation for pool and factory',
      samplePool: POOL_SAMPLE,
      factory: FACTORY,
      createdPool: poolAddress,
      tickSpacing: Number(await pool.tickSpacing()),
      initialPoolFee: fee.toString(),
      liquidity: LIQUIDITY.toString(),
      maxLiquidityPerTick: liquidityCap.toString(),
      burnPrincipal: fullPrincipal.toString(),
      burnClaimed: recordedOwed.toString(),
      strandedAfterBurn: strandedAfterBurn.toString(),
      flashBorrowAmount: borrowAmount.toString(),
      flashFeePaid: paid.toString(),
      protocolFeeRecorded: storedFee.toString(),
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

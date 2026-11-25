const assert = require('node:assert/strict');
const { BrowserProvider, Contract, keccak256 } = require('ethers');
const ganache = require('ganache');

const FORK_RPC_URL = process.env.FORK_RPC_URL || 'https://ethereum-rpc.publicnode.com';
const FACTORY_ADDRESS = '0x7de800467afce442019884f51a4a1b9143a34fac';
const PREFERRED_PAIR = '0x7aea467e10e2871cd82f620cc1d51b3e284840c1';
const FACTORY_ABI = [
  'function allPairsLength() view returns (uint256)',
  'function allPairs(uint256) view returns (address)',
  'function feeTo() view returns (address)',
];
const PAIR_ABI = [
  'function factory() view returns (address)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112,uint112,uint32)',
  'function kLast() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function mintFee()',
];
const TOKEN_ABI = ['function balanceOf(address) view returns (uint256)'];

function sqrt(value) {
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  return x;
}

async function mapLimit(values, limit, task) {
  const results = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await task(values[index], index);
    }
  }));
  return results;
}

async function main() {
  const fork = ganache.provider({
    chain: { chainId: 1 },
    fork: { url: FORK_RPC_URL },
    logging: { quiet: true },
  });

  try {
    const provider = new BrowserProvider(fork);
    const signer = await provider.getSigner();
    const factory = new Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
    const forkHead = await provider.getBlockNumber();
    const [pairCount, feeTo] = await Promise.all([factory.allPairsLength(), factory.feeTo()]);
    assert.notEqual(feeTo, '0x0000000000000000000000000000000000000000');

    const addresses = await Promise.all(
      Array.from({ length: Number(pairCount) }, (_, i) => factory.allPairs(i)),
    );
    const inspected = await mapLimit(addresses, 10, async (address) => {
      const pair = new Contract(address, PAIR_ABI, provider);
      const [code, pairFactory, reserves, kLast] = await Promise.all([
        provider.send('eth_getCode', [address, 'latest']),
        pair.factory(),
        pair.getReserves(),
        pair.kLast(),
      ]);
      assert.equal(pairFactory.toLowerCase(), FACTORY_ADDRESS);
      const reserveProduct = BigInt(reserves[0]) * BigInt(reserves[1]);
      const lastProduct = BigInt(kLast);
      return {
        address,
        codeHash: keccak256(code),
        pair,
        reserves,
        kLast: lastProduct,
        hasPendingGrowth: lastProduct > 0n && sqrt(reserveProduct) > sqrt(lastProduct),
      };
    });

    const runtimeHashes = new Set(inspected.map((entry) => entry.codeHash));
    assert.equal(runtimeHashes.size, 1, 'factory pair runtime family changed');
    const preferred = inspected.find((entry) => entry.address.toLowerCase() === PREFERRED_PAIR);
    const target = preferred?.hasPendingGrowth ? preferred : inspected.find((entry) => entry.hasPendingGrowth);
    assert.ok(target, 'no factory pair currently has uncheckpointed fee growth');

    const pair = target.pair.connect(signer);
    const token0 = new Contract(await pair.token0(), TOKEN_ABI, provider);
    const token1 = new Contract(await pair.token1(), TOKEN_ABI, provider);
    const snapshot = await provider.send('evm_snapshot', []);
    try {
      const [supplyBefore, feeToBefore, token0Before, token1Before] = await Promise.all([
        pair.totalSupply(),
        pair.balanceOf(feeTo),
        token0.balanceOf(target.address),
        token1.balanceOf(target.address),
      ]);
      const reserve0Before = BigInt(target.reserves[0]);
      const reserve1Before = BigInt(target.reserves[1]);
      const kLastBefore = target.kLast;
      const minted = [];

      for (let i = 0; i < 3; i += 1) {
        const tx = await pair.mintFee();
        await tx.wait();
        const [supply, feeToBalance] = await Promise.all([
          pair.totalSupply(),
          pair.balanceOf(feeTo),
        ]);
        minted.push({
          supply: BigInt(supply),
          feeToBalance: BigInt(feeToBalance),
          delta: BigInt(supply) - (i === 0 ? BigInt(supplyBefore) : minted[i - 1].supply),
        });
        assert.equal(await pair.kLast(), kLastBefore, 'mintFee advanced the fee baseline');
        const reserves = await pair.getReserves();
        assert.equal(BigInt(reserves[0]), reserve0Before);
        assert.equal(BigInt(reserves[1]), reserve1Before);
        assert.equal(await token0.balanceOf(target.address), token0Before);
        assert.equal(await token1.balanceOf(target.address), token1Before);
      }

      assert.ok(minted.every((entry) => entry.delta > 0n));
      assert.ok(minted[1].delta > minted[0].delta);
      assert.ok(minted[2].delta > minted[1].delta);
      assert.equal(minted[2].feeToBalance - BigInt(feeToBefore), minted.reduce((sum, entry) => sum + entry.delta, 0n));

      console.log(JSON.stringify({
        forkHead,
        factory: FACTORY_ADDRESS,
        registeredPairs: Number(pairCount),
        runtimeHash: [...runtimeHashes][0],
        pendingGrowthPairs: inspected.filter((entry) => entry.hasPendingGrowth).length,
        testedPair: target.address,
        feeTo,
        kLast: kLastBefore.toString(),
        reserve0: reserve0Before.toString(),
        reserve1: reserve1Before.toString(),
        initialSupply: BigInt(supplyBefore).toString(),
        feeToInitialBalance: BigInt(feeToBefore).toString(),
        feeToMintDeltas: minted.map((entry) => entry.delta.toString()),
        finalFeeToBalance: minted[2].feeToBalance.toString(),
        tokenBalancesAndReservesChanged: false,
      }, null, 2));
    } finally {
      await provider.send('evm_revert', [snapshot]);
    }
  } finally {
    await fork.disconnect();
  }
}

main().catch((error) => {
  console.error(error.shortMessage || error.message || String(error));
  process.exitCode = 1;
});

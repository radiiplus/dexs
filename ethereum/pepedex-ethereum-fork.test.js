const assert = require('node:assert/strict');
const { BrowserProvider, Contract, keccak256 } = require('ethers');
const ganache = require('ganache');

const FORK_RPC_URL = process.env.FORK_RPC_URL || 'https://ethereum-rpc.publicnode.com';
const FORK_BLOCK = process.env.FORK_BLOCK ? Number(process.env.FORK_BLOCK) : undefined;
const FACTORY = '0x460b2005b3318982feada99f7ebf13e1d6f6effe';
const EXPECTED_PAIR_COUNT = 26;
const EXPECTED_RUNTIME_HASH = '0x2d77086e6d9382618bb332dd3fcd18467527e647cd8eca69bfd9889820dfe436';

const FACTORY_ABI = [
  'function allPairsLength() view returns (uint256)',
  'function allPairs(uint256) view returns (address)',
  'function feeTo() view returns (address)',
  'function feeToSetter() view returns (address)',
];
const PAIR_ABI = [
  'function factory() view returns (address)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112,uint112,uint32)',
];
const TOKEN_ABI = ['function balanceOf(address) view returns (uint256)'];

async function main() {
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
    const localHead = await provider.getBlockNumber();
    if (FORK_BLOCK !== undefined) {
      assert.ok(localHead === FORK_BLOCK || localHead === FORK_BLOCK + 1);
    }

    const factory = new Contract(FACTORY, FACTORY_ABI, provider);
    const [pairCount, feeTo, feeToSetter] = await Promise.all([
      factory.allPairsLength(),
      factory.feeTo(),
      factory.feeToSetter(),
    ]);
    assert.equal(Number(pairCount), EXPECTED_PAIR_COUNT);
    assert.notEqual(feeTo, '0x0000000000000000000000000000000000000000');
    assert.equal(feeTo.toLowerCase(), feeToSetter.toLowerCase());

    const runtimeHashes = new Set();
    const reserveDrift = [];
    for (let i = 0; i < EXPECTED_PAIR_COUNT; i += 1) {
      const address = await factory.allPairs(i);
      const pair = new Contract(address, PAIR_ABI, provider);
      const [code, pairFactory, token0, token1, reserves] = await Promise.all([
        provider.send('eth_getCode', [address, 'latest']),
        pair.factory(),
        pair.token0(),
        pair.token1(),
        pair.getReserves(),
      ]);

      assert.notEqual(code, '0x', `${address} has no runtime code`);
      runtimeHashes.add(keccak256(code));
      assert.equal(pairFactory.toLowerCase(), FACTORY);
      assert.ok(token0.toLowerCase() < token1.toLowerCase(), `${address} token ordering`);

      const [balance0, balance1] = await Promise.all([
        new Contract(token0, TOKEN_ABI, provider).balanceOf(address),
        new Contract(token1, TOKEN_ABI, provider).balanceOf(address),
      ]);
      const reserve0 = BigInt(reserves[0]);
      const reserve1 = BigInt(reserves[1]);
      if (balance0 !== reserve0 || balance1 !== reserve1) {
        reserveDrift.push({
          pair: address,
          delta0: (BigInt(balance0) - reserve0).toString(),
          delta1: (BigInt(balance1) - reserve1).toString(),
        });
      }
    }

    assert.deepEqual([...runtimeHashes], [EXPECTED_RUNTIME_HASH]);
    console.log(JSON.stringify({
      requestedForkBlock: FORK_BLOCK ?? 'latest',
      localHead,
      factory: FACTORY,
      pairCount: Number(pairCount),
      activeFeeTo: feeTo,
      sharedRuntimeHash: EXPECTED_RUNTIME_HASH,
      reserveDrift,
      transactionCount: 0,
    }, null, 2));
  } finally {
    await fork.disconnect();
  }
}

main().catch((error) => {
  console.error(error.shortMessage || error.message || String(error));
  process.exitCode = 1;
});

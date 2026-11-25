const assert = require('node:assert/strict');
const path = require('node:path');
const solc = require('solc');
const ganache = require('ganache');
const { BrowserProvider, Contract, keccak256 } = require('ethers');

const FORK_RPC_URL = process.env.FORK_RPC_URL || 'https://ethereum-rpc.publicnode.com';
const FORK_BLOCK = process.env.FORK_BLOCK ? Number(process.env.FORK_BLOCK) : undefined;
const FACTORY_ADDRESS = '0xcBAE5C3f8259181EB7E2309BC4c72fDF02dD56D8';
const SAMPLE_PAIR = '0xe0533126c4013e2f5bcf44a2c84a396219be2d9d';
const GECKO_POOLS_URL = 'https://api.geckoterminal.com/api/v2/networks/eth/dexes/9inch-ethereum/pools?page=1';

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

async function fetchVerified(address) {
  const response = await fetch(`https://sourcify.dev/server/v2/contract/1/${address}?fields=sources,metadata`);
  assert.equal(response.status, 200, `Sourcify request failed for ${address}`);
  return response.json();
}

function compileVerified(verified) {
  assert.equal(verified.match, 'exact_match');
  assert.equal(verified.runtimeMatch, 'exact_match');
  const [file, name] = Object.entries(verified.metadata.settings.compilationTarget)[0];
  const settings = JSON.parse(JSON.stringify(verified.metadata.settings));
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
  settings.outputSelection = { [file]: { [name]: ['abi', 'evm.deployedBytecode.object'] } };
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings })));
  const errors = (output.errors || []).filter((entry) => entry.severity === 'error');
  assert.deepEqual(errors, [], errors.map((entry) => entry.formattedMessage).join('\n'));
  return output.contracts[file][name];
}

async function main() {
  assert.match(solc.version(), /^0\.8\.19\+/);
  const forkOptions = { url: FORK_RPC_URL };
  if (FORK_BLOCK !== undefined) forkOptions.blockNumber = FORK_BLOCK;
  const fork = ganache.provider({ chain: { chainId: 1 }, fork: forkOptions, logging: { quiet: true } });

  try {
    const provider = new BrowserProvider(fork);
    const forkBaseBlock = await provider.getBlockNumber();
    const [factoryVerified, pairVerified, geckoResponse] = await Promise.all([
      fetchVerified(FACTORY_ADDRESS),
      fetchVerified(SAMPLE_PAIR),
      fetch(GECKO_POOLS_URL),
    ]);
    assert.equal(geckoResponse.status, 200);
    const geckoPools = await geckoResponse.json();
    const factoryArtifact = compileVerified(factoryVerified);
    const pairArtifact = compileVerified(pairVerified);
    const factoryRuntime = await provider.send('eth_getCode', [FACTORY_ADDRESS, 'latest']);
    const sampleRuntime = await provider.send('eth_getCode', [SAMPLE_PAIR, 'latest']);
    assert.equal(keccak256(factoryRuntime), keccak256(`0x${factoryArtifact.evm.deployedBytecode.object}`));
    assert.equal(keccak256(sampleRuntime), keccak256(`0x${pairArtifact.evm.deployedBytecode.object}`));

    const factory = new Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
    const [pairCount, feeTo, feeToSetter] = await Promise.all([
      factory.allPairsLength(), factory.feeTo(), factory.feeToSetter(),
    ]);
    const registered = new Set();
    const runtimeHashes = new Set();
    const reserveDrift = [];

    for (let i = 0n; i < pairCount; i += 1n) {
      const address = await factory.allPairs(i);
      registered.add(address.toLowerCase());
      const pair = new Contract(address, PAIR_ABI, provider);
      const [code, pairFactory, token0, token1, reserves] = await Promise.all([
        provider.send('eth_getCode', [address, 'latest']),
        pair.factory(),
        pair.token0(),
        pair.token1(),
        pair.getReserves(),
      ]);
      assert.notEqual(code, '0x', `pair ${address} has no bytecode`);
      assert.equal(pairFactory.toLowerCase(), FACTORY_ADDRESS.toLowerCase());
      assert.ok(token0.toLowerCase() < token1.toLowerCase(), `token ordering ${address}`);
      runtimeHashes.add(keccak256(code));

      const [balance0, balance1] = await Promise.all([
        new Contract(token0, TOKEN_ABI, provider).balanceOf(address),
        new Contract(token1, TOKEN_ABI, provider).balanceOf(address),
      ]);
      if (balance0 !== BigInt(reserves[0]) || balance1 !== BigInt(reserves[1])) {
        reserveDrift.push({
          pair: address,
          delta0: (balance0 - BigInt(reserves[0])).toString(),
          delta1: (balance1 - BigInt(reserves[1])).toString(),
        });
      }
    }

    const geckoAddresses = geckoPools.data.map((entry) => entry.attributes.address.toLowerCase());
    const unregisteredGeckoPools = geckoAddresses.filter((address) => !registered.has(address));
    assert.deepEqual(unregisteredGeckoPools, []);
    assert.ok(registered.has(SAMPLE_PAIR.toLowerCase()));

    console.log(JSON.stringify({
      requestedForkBlock: FORK_BLOCK ?? 'latest',
      forkBaseBlock,
      factory: FACTORY_ADDRESS,
      factoryPairs: Number(pairCount),
      geckoTerminalPageOnePools: geckoAddresses.length,
      feeTo,
      feeToSetter,
      factoryRuntimeHash: keccak256(factoryRuntime),
      pairRuntimeHashes: [...runtimeHashes],
      reserveDrift,
      geckoPoolsAllRegistered: unregisteredGeckoPools.length === 0,
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

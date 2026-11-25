const assert = require('node:assert/strict');
const solc = require('solc');
const ganache = require('ganache');
const { BrowserProvider, Contract, keccak256 } = require('ethers');

const FACTORY = '0xd36aba9ec96523b0a89886c76065852adfe2eb39';
const GECKO_URL = 'https://api.geckoterminal.com/api/v2/networks/eth/dexes/justmoney-ethereum/pools?page=1';
const BLOCKSCOUT_URL = `https://eth.blockscout.com/api/v2/smart-contracts/${FACTORY}`;
const RPC_URL = process.env.FORK_RPC_URL || 'https://ethereum-rpc.publicnode.com';

const FACTORY_ABI = [
  'function allPairsLength() view returns (uint256)',
  'function allPairs(uint256) view returns (address)',
  'function feeTo() view returns (address)',
  'function owner() view returns (address)',
  'function INIT_CODE_PAIR_HASH() view returns (bytes32)',
];
const PAIR_ABI = [
  'function factory() view returns (address)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112,uint112,uint32)',
];
const TOKEN_ABI = ['function balanceOf(address) view returns (uint256)'];

function withoutCborMetadata(bytecode) {
  const body = bytecode.slice(2);
  const metadataBytes = Number.parseInt(body.slice(-4), 16);
  return body.slice(0, body.length - (metadataBytes + 2) * 2);
}

async function main() {
  assert.match(solc.version(), /^0\.5\.17\+/);
  const fork = ganache.provider({
    chain: { chainId: 1 },
    fork: { url: RPC_URL },
    logging: { quiet: true },
  });

  try {
    const provider = new BrowserProvider(fork);
    const forkBlock = await provider.getBlockNumber();
    const [sourceResponse, geckoResponse] = await Promise.all([
      fetch(BLOCKSCOUT_URL),
      fetch(GECKO_URL),
    ]);
    assert.equal(sourceResponse.status, 200);
    assert.equal(geckoResponse.status, 200);
    const [sourceRecord, gecko] = await Promise.all([sourceResponse.json(), geckoResponse.json()]);
    assert.equal(sourceRecord.is_verified, true);
    assert.equal(sourceRecord.compiler_version, '0.5.17+commit.d19bba13');

    const input = {
      language: 'Solidity',
      sources: { 'JMSwapFactory.sol': { content: sourceRecord.source_code } },
      settings: {
        optimizer: { enabled: sourceRecord.optimization_enabled, runs: sourceRecord.optimization_runs },
        evmVersion: sourceRecord.evm_version,
        outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
      },
    };
    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    const errors = (output.errors || []).filter((entry) => entry.severity === 'error');
    assert.deepEqual(errors, [], errors.map((entry) => entry.formattedMessage).join('\n'));
    const artifacts = output.contracts['JMSwapFactory.sol'];
    const factoryArtifact = artifacts.JMSwapFactory;
    const pairArtifact = artifacts.Pair;

    const factory = new Contract(FACTORY, FACTORY_ABI, provider);
    const [factoryCode, pairCount, feeTo, owner, initCodeHash] = await Promise.all([
      provider.send('eth_getCode', [FACTORY, 'latest']),
      factory.allPairsLength(),
      factory.feeTo(),
      factory.owner(),
      factory.INIT_CODE_PAIR_HASH(),
    ]);
    const compiledPairRuntime = `0x${pairArtifact.evm.deployedBytecode.object}`;
    const compiledPairInitHash = keccak256(`0x${pairArtifact.evm.bytecode.object}`);

    const registered = new Set();
    const runtimeHashes = new Set();
    const reserveDrift = [];
    for (let index = 0n; index < pairCount; index += 1n) {
      const address = await factory.allPairs(index);
      registered.add(address.toLowerCase());
      const pair = new Contract(address, PAIR_ABI, provider);
      const [code, pairFactory, token0, token1, reserves] = await Promise.all([
        provider.send('eth_getCode', [address, 'latest']),
        pair.factory(),
        pair.token0(),
        pair.token1(),
        pair.getReserves(),
      ]);
      assert.notEqual(code, '0x');
      assert.equal(withoutCborMetadata(code), withoutCborMetadata(compiledPairRuntime));
      assert.equal(pairFactory.toLowerCase(), FACTORY.toLowerCase());
      assert.ok(token0.toLowerCase() < token1.toLowerCase());
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

    const geckoAddresses = gecko.data.map((entry) => entry.attributes.address.toLowerCase());
    const unregisteredGeckoPools = geckoAddresses.filter((address) => !registered.has(address));
    assert.deepEqual(unregisteredGeckoPools, []);
    assert.deepEqual(reserveDrift, []);
    assert.equal(runtimeHashes.size, 1);

    console.log(JSON.stringify({
      requestedForkBlock: 'latest',
      forkBlock,
      factory: FACTORY,
      pairExecutableRuntimeMatch: true,
      sourceVerificationStatus: 'partial source match; executable pair runtime matches after removing CBOR metadata',
      compiler: solc.version(),
      pairCount: Number(pairCount),
      geckoTerminalPageOnePools: geckoAddresses.length,
      allGeckoPoolsRegistered: true,
      feeTo,
      owner,
      factoryRuntimeHash: keccak256(factoryCode),
      factoryCompiledRuntimeHash: keccak256(`0x${factoryArtifact.evm.deployedBytecode.object}`),
      onchainPairCreationHash: initCodeHash,
      locallyCompiledPairCreationHash: compiledPairInitHash,
      pairRuntimeHash: [...runtimeHashes][0],
      reserveDrift,
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

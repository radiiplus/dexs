const assert = require('node:assert/strict');
const solc = require('solc');
const ganache = require('ganache');
const { BrowserProvider, Contract, keccak256 } = require('ethers');

const RPC_URL = process.env.FORK_RPC_URL || 'https://ethereum-rpc.publicnode.com';
const FACTORY = '0xc78fd8021fb191501e6be7c1da4beafb1b81cf8c';
const SAMPLE_POOL = '0xdb57a7ce7806d8de54fcba1ec2df230757c3bf67';
const GECKO_URL = 'https://api.geckoterminal.com/api/v2/networks/eth/dexes/bitswap/pools?page=1';
const MODULES = [
  ['swapX2YModule', '0x7FC805B9773A22c091Fe548380E2dE61A07478e5'],
  ['swapY2XModule', '0x178BE577715Cc0E83b33467D9B4A009f1cD7b052'],
  ['liquidityModule', '0x07F389E36F76a2c0af7D109fEc739571C96473E4'],
  ['limitOrderModule', '0xf887bAADd85C630e8E6f211d72C69400870eaC31'],
  ['flashModule', '0xf8F1CD5943396C5C49Eb278A171Ad9AA6A2013e5'],
];

function stripMetadata(bytecode) {
  const metadataBytes = Number.parseInt(bytecode.slice(-4), 16);
  return bytecode.slice(0, bytecode.length - (metadataBytes + 2) * 2);
}

async function main() {
  assert.match(solc.version(), /^0\.8\.4\+/);
  const fork = ganache.provider({ chain: { chainId: 1 }, fork: { url: RPC_URL }, logging: { quiet: true } });
  try {
    const provider = new BrowserProvider(fork);
    const forkBlock = await provider.getBlockNumber();
    const [sourceResponse, geckoResponse] = await Promise.all([
      fetch(`https://eth.blockscout.com/api/v2/smart-contracts/${SAMPLE_POOL}`),
      fetch(GECKO_URL),
    ]);
    assert.equal(sourceResponse.status, 200);
    assert.equal(geckoResponse.status, 200);
    const [sourceRecord, gecko] = await Promise.all([sourceResponse.json(), geckoResponse.json()]);
    assert.equal(sourceRecord.name, 'iZiSwapPool');
    assert.equal(sourceRecord.compiler_version, 'v0.8.4+commit.c7e474f2');
    assert.equal(sourceRecord.is_verified, true);

    const settings = JSON.parse(JSON.stringify(sourceRecord.compiler_settings));
    settings.outputSelection = { [sourceRecord.file_path]: { iZiSwapPool: ['abi', 'evm.deployedBytecode.object'] } };
    const compilation = JSON.parse(solc.compile(JSON.stringify({
      language: 'Solidity',
      sources: { [sourceRecord.file_path]: { content: sourceRecord.source_code } },
      settings,
    })));
    const errors = (compilation.errors || []).filter((entry) => entry.severity === 'error');
    assert.deepEqual(errors, [], errors.map((entry) => entry.formattedMessage).join('\n'));
    const poolArtifact = compilation.contracts[sourceRecord.file_path].iZiSwapPool;
    const deployedPoolCode = await provider.send('eth_getCode', [SAMPLE_POOL, 'latest']);
    assert.equal(stripMetadata(deployedPoolCode.slice(2)), stripMetadata(poolArtifact.evm.deployedBytecode.object));

    const factory = new Contract(FACTORY, [
      'function owner() view returns(address)',
      'function chargeReceiver() view returns(address)',
      'function defaultFeeChargePercent() view returns(uint24)',
      'function fee2pointDelta(uint24) view returns(int24)',
      'function pool(address,address,uint24) view returns(address)',
      'function swapX2YModule() view returns(address)',
      'function swapY2XModule() view returns(address)',
      'function liquidityModule() view returns(address)',
      'function limitOrderModule() view returns(address)',
      'function flashModule() view returns(address)',
    ], provider);
    const pool = new Contract(SAMPLE_POOL, poolArtifact.abi, provider);
    const [poolFactory, tokenX, tokenY, fee, pointDelta, poolFeeShare, totalFeeX, totalFeeY, state,
      owner, chargeReceiver, defaultFeeChargePercent, mappedPool] = await Promise.all([
      pool.factory(), pool.tokenX(), pool.tokenY(), pool.fee(), pool.pointDelta(), pool.feeChargePercent(),
      pool.totalFeeXCharged(), pool.totalFeeYCharged(), pool.state(), factory.owner(), factory.chargeReceiver(),
      factory.defaultFeeChargePercent(), factory.pool(await pool.tokenX(), await pool.tokenY(), await pool.fee()),
    ]);
    assert.equal(poolFactory.toLowerCase(), FACTORY.toLowerCase());
    assert.equal(mappedPool.toLowerCase(), SAMPLE_POOL.toLowerCase());
    assert.equal(pointDelta, await factory.fee2pointDelta(fee));
    assert.equal(gecko.data.length, 1);
    assert.equal(gecko.data[0].attributes.address.toLowerCase(), SAMPLE_POOL.toLowerCase());

    const moduleState = await Promise.all(MODULES.map(async ([name, address]) => {
      const code = await provider.send('eth_getCode', [address, 'latest']);
      assert.notEqual(code, '0x', `${name} has no code`);
      return { name, address, runtimeBytes: (code.length - 2) / 2, runtimeHash: keccak256(code) };
    }));

    const tokenAbi = ['function balanceOf(address) view returns(uint256)'];
    const [balanceX, balanceY] = await Promise.all([
      new Contract(tokenX, tokenAbi, provider).balanceOf(SAMPLE_POOL),
      new Contract(tokenY, tokenAbi, provider).balanceOf(SAMPLE_POOL),
    ]);
    console.log(JSON.stringify({
      forkBlock,
      geckoDexId: 'bitswap',
      implementation: 'iZiSwapPool',
      factory: FACTORY,
      samplePool: SAMPLE_POOL,
      sourceRuntimeMatch: true,
      sourcePartialFlag: sourceRecord.is_partially_verified,
      tokenX,
      tokenY,
      fee,
      pointDelta,
      currentState: state,
      tokenBalanceX: balanceX.toString(),
      tokenBalanceY: balanceY.toString(),
      poolFeeChargePercent: poolFeeShare,
      accruedFeeChargeX: totalFeeX.toString(),
      accruedFeeChargeY: totalFeeY.toString(),
      factoryOwner: owner,
      chargeReceiver,
      factoryDefaultFeeChargePercent: defaultFeeChargePercent,
      modules: moduleState,
      transactionCountOnPublicChain: 0,
    }, (key, value) => typeof value === 'bigint' ? value.toString() : value, 2));
  } finally {
    await fork.disconnect();
  }
}

main().catch((error) => {
  console.error(error.stack || error.shortMessage || error.message || String(error));
  process.exitCode = 1;
});

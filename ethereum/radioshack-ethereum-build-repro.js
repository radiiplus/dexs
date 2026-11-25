const fs = require('node:fs')
const path = require('node:path')
const solc = require(process.env.SOLC_PATH || 'solc')
const ganache = require('ganache')
const { BrowserProvider, ContractFactory, keccak256 } = require('ethers')
const assert = require('node:assert/strict')

const sourcePath = process.env.RADIOSHACK_CORE_PATH
if (!sourcePath) throw new Error('Set RADIOSHACK_CORE_PATH to the RadioShack contracts checkout')

const sourceFiles = [
  'contracts/uniswapv2/UniswapV2Pair.sol',
  'contracts/uniswapv2/UniswapV2Factory.sol',
  'contracts/uniswapv2/UniswapV2ERC20.sol',
  'contracts/uniswapv2/libraries/Math.sol',
  'contracts/uniswapv2/libraries/UQ112x112.sol',
  'contracts/uniswapv2/libraries/SafeMath.sol',
  'contracts/uniswapv2/libraries/UniswapV2Library.sol',
  'contracts/uniswapv2/interfaces/IERC20.sol',
  'contracts/uniswapv2/interfaces/IUniswapV2Factory.sol',
  'contracts/uniswapv2/interfaces/IUniswapV2Pair.sol',
  'contracts/uniswapv2/interfaces/IUniswapV2Callee.sol',
]
const sources = Object.fromEntries(sourceFiles.map((file) => [
  file,
  { content: fs.readFileSync(path.join(sourcePath, file), 'utf8') },
]))
sources['contracts/uniswapv2/PairForHarness.sol'] = {
  content: `
// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.6.12;
import './libraries/UniswapV2Library.sol';
contract PairForHarness {
    function pairFor(address factory, address tokenA, address tokenB) external pure returns (address) {
        return UniswapV2Library.pairFor(factory, tokenA, tokenB);
    }
}
`,
}

const compilerInput = {
  language: 'Solidity',
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'istanbul',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
}
const output = JSON.parse(solc.compile(JSON.stringify(compilerInput)))
const errors = (output.errors || []).filter((error) => error.severity === 'error')
if (errors.length) throw new Error(errors.map((error) => error.formattedMessage).join('\n'))
const artifact = (file, name) => output.contracts[file][name]

async function main() {
  const chain = ganache.provider({ logging: { quiet: true } })
  try {
    const provider = new BrowserProvider(chain)
    const signer = await provider.getSigner()
    const factoryArtifact = artifact('contracts/uniswapv2/UniswapV2Factory.sol', 'UniswapV2Factory')
    const factory = await new ContractFactory(
      factoryArtifact.abi,
      `0x${factoryArtifact.evm.bytecode.object}`,
      signer,
    ).deploy(await signer.getAddress())
    await factory.waitForDeployment()

    const helperArtifact = artifact('contracts/uniswapv2/PairForHarness.sol', 'PairForHarness')
    const helper = await new ContractFactory(
      helperArtifact.abi,
      `0x${helperArtifact.evm.bytecode.object}`,
      signer,
    ).deploy()
    await helper.waitForDeployment()

    const tokenA = '0x1000000000000000000000000000000000000000'
    const tokenB = '0x2000000000000000000000000000000000000000'
    await (await factory.createPair(tokenA, tokenB)).wait()
    const factoryPair = await factory.getPair(tokenA, tokenB)
    const routerPair = await helper.pairFor(await factory.getAddress(), tokenA, tokenB)
    const pairCodeHash = await factory.pairCodeHash()

    assert.notEqual(factoryPair.toLowerCase(), routerPair.toLowerCase())
    assert.equal(await provider.getCode(routerPair), '0x')
    assert.equal(pairCodeHash, '0xe3ca8827db2112e6ab21beef01e667ee20a02ec2adbf5793b38581bd2830e85e')
    console.log(JSON.stringify({
      compiler: solc.version(),
      localChain: 'ephemeral Ganache',
      pairCodeHash,
      routerInitCodeHash: '0x3eef69365a159891ca18b545ccaf0d6aca9b22c988b8deb7a3e4fa2fc2418596',
      factoryPair,
      routerPredictedPair: routerPair,
      predictedPairHasCode: false,
      configuredBuildMismatch: true,
    }, null, 2))
  } finally {
    await chain.disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

const fs = require('node:fs')
const path = require('node:path')
const solc = require('solc')
const ganache = require('ganache')
const { BrowserProvider, ContractFactory } = require('ethers')
const assert = require('node:assert/strict')

const corePath = process.env.CONCAVE_CORE_PATH
if (!corePath) throw new Error('Set CONCAVE_CORE_PATH to the Concave core checkout')

const libraryPath = path.join(corePath, 'src/amm/libraries/GemswapLibrary.sol')
const librarySource = fs.readFileSync(libraryPath, 'utf8')
const harnessSource = `
// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;
import "src/amm/libraries/GemswapLibrary.sol";
contract Harness {
    function quote(uint256 amountOut, uint256 reserveIn, uint256 reserveOut)
        external pure returns (uint256)
    {
        return GemswapLibrary.getAmountIn(amountOut, reserveIn, reserveOut);
    }
}
`

const compilerInput = {
  language: 'Solidity',
  sources: {
    'src/amm/libraries/GemswapLibrary.sol': { content: librarySource },
    'Harness.sol': { content: harnessSource },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
}
const output = JSON.parse(solc.compile(JSON.stringify(compilerInput)))
const errors = (output.errors || []).filter((error) => error.severity === 'error')
if (errors.length) throw new Error(errors.map((error) => error.formattedMessage).join('\n'))

async function main() {
  const chain = ganache.provider({ logging: { quiet: true } })
  try {
    const provider = new BrowserProvider(chain)
    const signer = await provider.getSigner()
    const artifact = output.contracts['Harness.sol'].Harness
    const harness = await new ContractFactory(artifact.abi, `0x${artifact.evm.bytecode.object}`, signer).deploy()
    await harness.waitForDeployment()

    const reserveIn = 1_000_000n
    const reserveOut = 10_000_000n
    const amountOut = 1_000n
    const sourceQuote = await harness.quote(amountOut, reserveIn, reserveOut)
    const correctQuote =
      (reserveIn * amountOut * 10_000n) / ((reserveOut - amountOut) * 9_975n) + 1n
    assert.equal(sourceQuote, 400_000_001n)
    assert.equal(correctQuote, 101n)

    const fee = 25n
    const adjustedInput = (reserveIn + sourceQuote) * 10_000n - sourceQuote * fee
    const adjustedOutput = (reserveOut - amountOut) * 10_000n
    const oldK = reserveIn * reserveOut * 10_000n ** 2n
    assert(adjustedInput * adjustedOutput >= oldK)

    await assert.rejects(harness.quote.staticCall(1_003n, reserveIn, reserveOut))
    console.log(JSON.stringify({
      localChain: 'ephemeral Ganache',
      reserves: [reserveIn.toString(), reserveOut.toString()],
      amountOut: amountOut.toString(),
      sourceQuote: sourceQuote.toString(),
      correctQuote: correctQuote.toString(),
      excessInputRetainedByPair: (sourceQuote - correctQuote).toString(),
      pairInvariantAcceptsOverquote: adjustedInput * adjustedOutput >= oldK,
      underflowBoundaryOutput: '1003',
      underflowReverts: true,
    }, null, 2))
  } finally {
    await chain.disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

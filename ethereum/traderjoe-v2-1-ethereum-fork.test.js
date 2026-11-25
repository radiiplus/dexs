const assert = require('node:assert/strict');
const solc = require('solc');
const ganache = require('ganache');
const {
  BrowserProvider,
  Contract,
  ContractFactory,
  keccak256,
} = require('ethers');

const FORK_RPC_URL = process.env.FORK_RPC_URL || 'https://ethereum-rpc.publicnode.com';
const FORK_BLOCK = process.env.FORK_BLOCK ? Number(process.env.FORK_BLOCK) : undefined;
const FACTORY = '0xDC8d77b69155c7E68A95a4fb0f06a71FF90B943a';
const GECKO_PAIR = '0x47b1cec2d2370e11b049c73ab6732f03e920c71a';
const IMPLEMENTATION = '0x7f89d5e94d6bd0351426e113fde9ef9ea678c186';

const FACTORY_ABI = [
  'function getNumberOfLBPairs() view returns (uint256)',
  'function getLBPairAtIndex(uint256) view returns (address)',
  'function getLBPairImplementation() view returns (address)',
  'function getFlashLoanFee() view returns (uint256)',
];
const PAIR_ABI = [
  'function getFactory() view returns (address)',
  'function getTokenX() view returns (address)',
  'function getTokenY() view returns (address)',
  'function getBinStep() view returns (uint16)',
  'function getReserves() view returns (uint128,uint128)',
  'function getProtocolFees() view returns (uint128,uint128)',
  'function flashLoan(address,bytes32,bytes)',
];
const TOKEN_ABI = ['function balanceOf(address) view returns (uint256)'];

const callbackSource = `
pragma solidity 0.8.10;
interface ILBPair {
    function flashLoan(address receiver, bytes32 amounts, bytes calldata data) external;
}
contract NoRepayCallback {
    function start(address pair, bytes32 amounts) external {
        ILBPair(pair).flashLoan(address(this), amounts, "");
    }
    function LBFlashLoanCallback(address, address, address, bytes32, bytes32, bytes calldata)
        external pure returns (bytes32)
    {
        return keccak256("LBPair.onFlashLoan");
    }
}`;

function compileCallback() {
  const input = {
    language: 'Solidity',
    sources: { 'NoRepayCallback.sol': { content: callbackSource } },
    settings: {
      optimizer: { enabled: true, runs: 800 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((entry) => entry.severity === 'error');
  assert.deepEqual(errors, []);
  return output.contracts['NoRepayCallback.sol'].NoRepayCallback;
}

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
    const localHead = await provider.getBlockNumber();
    const factory = new Contract(FACTORY, FACTORY_ABI, provider);
    const [pairCount, implementation, fee] = await Promise.all([
      factory.getNumberOfLBPairs(),
      factory.getLBPairImplementation(),
      factory.getFlashLoanFee(),
    ]);

    assert.equal(implementation.toLowerCase(), IMPLEMENTATION);
    assert.ok(pairCount > 0n);

    const reserveDrift = [];
    const runtimeHashes = new Set();
    let geckoPoolSeen = false;
    for (let i = 0n; i < pairCount; i += 1n) {
      const address = await factory.getLBPairAtIndex(i);
      const pair = new Contract(address, PAIR_ABI, provider);
      const [code, pairFactory, tokenX, tokenY, binStep, reserves, protocolFees] = await Promise.all([
        provider.send('eth_getCode', [address, 'latest']),
        pair.getFactory(),
        pair.getTokenX(),
        pair.getTokenY(),
        pair.getBinStep(),
        pair.getReserves(),
        pair.getProtocolFees(),
      ]);
      assert.notEqual(code, '0x', `pair ${address} has no bytecode`);
      assert.equal(pairFactory.toLowerCase(), FACTORY.toLowerCase());
      assert.ok(code.toLowerCase().includes(IMPLEMENTATION.slice(2)), `pair ${address} does not embed the implementation`);
      runtimeHashes.add(keccak256(code));
      if (address.toLowerCase() === GECKO_PAIR.toLowerCase()) geckoPoolSeen = true;

      const [balanceX, balanceY] = await Promise.all([
        new Contract(tokenX, TOKEN_ABI, provider).balanceOf(address),
        new Contract(tokenY, TOKEN_ABI, provider).balanceOf(address),
      ]);
      const expectedX = BigInt(reserves[0]) + BigInt(protocolFees[0]);
      const expectedY = BigInt(reserves[1]) + BigInt(protocolFees[1]);
      if (balanceX !== expectedX || balanceY !== expectedY) {
        reserveDrift.push({
          pair: address,
          deltaX: (balanceX - expectedX).toString(),
          deltaY: (balanceY - expectedY).toString(),
        });
      }
    }
    assert.ok(geckoPoolSeen, 'GeckoTerminal pair must be registered in the V2.1.1 factory');

    const pair = new Contract(GECKO_PAIR, PAIR_ABI, provider);
    const [tokenX, tokenY, binStep, reservesBefore, protocolFeesBefore] = await Promise.all([
      pair.getTokenX(), pair.getTokenY(), pair.getBinStep(), pair.getReserves(), pair.getProtocolFees(),
    ]);
    const tokenXContract = new Contract(tokenX, TOKEN_ABI, provider);
    const tokenYContract = new Contract(tokenY, TOKEN_ABI, provider);
    const before = await Promise.all([
      tokenXContract.balanceOf(GECKO_PAIR),
      tokenYContract.balanceOf(GECKO_PAIR),
    ]);

    const callbackArtifact = compileCallback();
    const signer = await provider.getSigner(0);
    const callback = await new ContractFactory(
      callbackArtifact.abi,
      `0x${callbackArtifact.evm.bytecode.object}`,
      signer,
    ).deploy();
    await callback.waitForDeployment();

    // A callback that returns the required success marker but keeps the loan must revert,
    // including the token transfers and any attempted accounting updates.
    const borrowAmountX = 1_000_000n;
    const amounts = `0x${borrowAmountX.toString(16).padStart(64, '0')}`;
    await assert.rejects(callback.start(GECKO_PAIR, amounts));

    const [reservesAfter, protocolFeesAfter, balancesAfter] = await Promise.all([
      pair.getReserves(),
      pair.getProtocolFees(),
      Promise.all([
        tokenXContract.balanceOf(GECKO_PAIR),
        tokenYContract.balanceOf(GECKO_PAIR),
      ]),
    ]);
    assert.deepEqual(reservesAfter.map(String), reservesBefore.map(String));
    assert.deepEqual(protocolFeesAfter.map(String), protocolFeesBefore.map(String));
    assert.deepEqual(balancesAfter.map(String), before.map(String));

    console.log(JSON.stringify({
      requestedForkBlock: FORK_BLOCK ?? 'latest',
      localHead,
      factory: FACTORY,
      factoryPairs: Number(pairCount),
      implementation,
      implementationRuntimeHash: keccak256(await provider.send('eth_getCode', [IMPLEMENTATION, 'latest'])),
      pairRuntimeHashes: [...runtimeHashes],
      flashLoanFee: fee.toString(),
      geckoPair: GECKO_PAIR,
      tokenX,
      tokenY,
      binStep: Number(binStep),
      geckoPairTrackedReserves: reservesBefore.map(String),
      geckoPairProtocolFees: protocolFeesBefore.map(String),
      trackedReservePlusProtocolFeesMatchBalances: reserveDrift.length === 0,
      reserveDrift,
      underpaidFlashLoanRevertedAndRolledBack: true,
      transactionCountOnPublicChain: 0,
    }, null, 2));
  } finally {
    await fork.disconnect();
  }
}

main().catch((error) => {
  console.error(error.shortMessage || error.message || String(error));
  process.exitCode = 1;
});

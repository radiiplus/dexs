# RadioShack Swap (Ethereum) Evidence Ledger

## Scope and target identity

- Chain: Ethereum mainnet, GeckoTerminal network `eth`.
- GeckoTerminal DEX ID: `radioshack_ethereum`; sampled pools include `0x2a79a0e0c226a58eeb99c5704d72d49177cc7516` (`RADIO / WETH`) and `0x44b5d8d7c0a93fe769a30d92b9a1e5500b3e9897` (`BUILD / RADIO`).
- Source repository: `https://github.com/radioshackswap/contracts`, commit `7471dc1af839fadc55d2752dfb6ccd20b2112ff0` (2022-02-27), Solidity `0.6.12`.
- SDK repository: `https://github.com/radioshackswap/sdk2`, commit `f61a8627cb020fbee2fa28546bd82d3109f3243c` (2022-11-16). `src/chains.ts:110-115` lists Ethereum RADIO token `0x7a5d3A9Dcd33cb8D527f7b5F96EB4Fef43d55636`, factory `0x91fAe1bc94A9793708fbc66aDcb59087C46dEe10`, and router `0x3e445e3280C5747a188DB8d0aB7762838A50E4ff`; `src/constants.ts:23-28` pins init code hash `0x3eef69365a159891ca18b545ccaf0d6aca9b22c988b8deb7a3e4fa2fc2418596`.
- Source files: [`UniswapV2Factory.sol`](https://github.com/radioshackswap/contracts/blob/7471dc1af839fadc55d2752dfb6ccd20b2112ff0/contracts/uniswapv2/UniswapV2Factory.sol), [`UniswapV2Pair.sol`](https://github.com/radioshackswap/contracts/blob/7471dc1af839fadc55d2752dfb6ccd20b2112ff0/contracts/uniswapv2/UniswapV2Pair.sol), [`UniswapV2Router02.sol`](https://github.com/radioshackswap/contracts/blob/7471dc1af839fadc55d2752dfb6ccd20b2112ff0/contracts/uniswapv2/UniswapV2Router02.sol), [`UniswapV2Library.sol`](https://github.com/radioshackswap/contracts/blob/7471dc1af839fadc55d2752dfb6ccd20b2112ff0/contracts/uniswapv2/libraries/UniswapV2Library.sol), [`chains.ts`](https://github.com/radioshackswap/sdk2/blob/f61a8627cb020fbee2fa28546bd82d3109f3243c/src/chains.ts), and [`constants.ts`](https://github.com/radioshackswap/sdk2/blob/f61a8627cb020fbee2fa28546bd82d3109f3243c/src/constants.ts).
- Read-only deployment attribution: GeckoTerminal's RADIO/WETH pool `factory()` returns the SDK's factory; that factory's `getPair(RADIO,WETH)` returns the sampled pool; the SDK router's `factory()` returns the same factory. The factory's `pairCodeHash()` returns `0x3eef...8596`, matching both its router source and SDK constant. Blockscout reports the factory/router sources as verified and partially verified under solc `0.6.12`, optimizer enabled with 200 runs, Istanbul EVM. These were static reads only, not vulnerability tests or state-changing calls.
- Source/deployment attribution is strong for the deployed factory/router family, but exact full runtime bytecode comparison was not performed. The source repository's local build output does not reproduce the deployed pair init hash under its apparent settings; that discrepancy is addressed below.

## Architecture and execution map

- `UniswapV2Factory` controls `feeTo`, `feeToSetter`, and `migrator`; creates sorted token pairs with CREATE2 from `type(UniswapV2Pair).creationCode`; stores both token ordering mappings and all-pairs enumeration; exposes `pairCodeHash()` as the hash of pair creation code.
- `UniswapV2Pair` owns token addresses, reserves, cumulative prices, `kLast`, LP ERC-20 state and lock. `mint`/`burn` account from actual balances; `_mintFee` accounts protocol liquidity on liquidity changes; `swap` transfers output, invokes optional flash callback, measures actual inputs and checks fee-adjusted K; `skim` transfers only balance surplus and `sync` adopts actual balances as reserves.
- `UniswapV2Router02` derives pool addresses through `UniswapV2Library.pairFor` and implements add/remove liquidity, exact-in/exact-out swaps, WETH handling, permit methods, and fee-on-transfer token routes. The library computes swap fees at 0.1% (`999/1000`), matching the pair's adjusted K formula; the RadioShack SDK uses the same coefficient.
- The pair's initial mint has an optional migrator path. If the factory owner sets a nonzero migrator, ordinary first mint is blocked while the configured migrator may supply `desiredLiquidity`; factory admin authority is therefore in scope for first-liquidity migration behavior.

## Entry points and state transitions reviewed

- Factory: `createPair`, `getPair`, `pairCodeHash`, `setFeeTo`, `setMigrator`, `setFeeToSetter`.
- Pair: `initialize`, LP ERC-20 `transfer`/`transferFrom`/`permit`, `mint`, `burn`, `swap`/flash callback, `skim`, `sync`.
- Router: add/remove liquidity and ETH variants, permit wrappers, exact-in/exact-out token and ETH swaps, supporting-fee-on-transfer swaps, quote/path helpers.
- Library: sorted token derivation, CREATE2 pair derivation, reserve ordering, amount in/out math, multi-hop paths.

## Critical invariant catalogue

- Factory pair mapping, CREATE2 salt, and router/library pair derivation must resolve to the same pair for sorted tokens.
- Reserves are the last synchronized pair balances; minting uses balance deltas; burning distributes actual balances pro rata to LP supply after any protocol LP fee mint.
- Swaps require positive measured input and `balance0Adjusted * balance1Adjusted >= reserve0 * reserve1 * 1000^2`, with one unit of fee per 1000 input units.
- On success, pair reserve state and cumulative price state update atomically; callback failure or invariant failure rolls back output transfers and state.
- `skim` only exposes excess balance over reserves; `sync` explicitly reconciles reserves to current token balances.
- Protocol fees are LP tokens computed from growth in `sqrt(k)` when `feeTo` is set; turning fee accounting off clears `kLast` at the next liquidity transition.

## Findings

No confirmed invariant violation was identified in the reviewed deployed Ethereum source family.

### Rejected hypothesis: factory/router CREATE2 init-code hash mismatch

- Candidate evidence: local compilation of the checked-in source with solc `0.6.12`, optimizer 200, EVM Istanbul yields pair creation-code hash `0xe3ca8827db2112e6ab21beef01e667ee20a02ec2adbf5793b38581bd2830e85e`, while `UniswapV2Library.pairFor` hardcodes `0x3eef...8596` (`contracts/uniswapv2/libraries/UniswapV2Library.sol:20-27`). Factory `createPair` deploys `type(UniswapV2Pair).creationCode` (`contracts/uniswapv2/UniswapV2Factory.sol:26-45`).
- Local build reproduction: [radioshack-ethereum-build-repro.js](./radioshack-ethereum-build-repro.js) compiles the checked-in factory, pair, and library, deploys them to ephemeral Ganache, creates a pair, and compares the factory result with the library's predicted address. It passes with different addresses and no code at the router-predicted address. This demonstrates a source/build configuration mismatch for that locally compiled artifact combination.
- Deployment evidence disproves applying that mismatch to the GeckoTerminal Ethereum deployment: the sampled pool's factory is `0x91fa...ee10`; that factory's read-only `pairCodeHash()` returns `0x3eef...8596`, exactly the router/SDK constant; factory `getPair(RADIO,WETH)` returns the sampled pool; and the published router's `factory()` is the same address. The deployed router's verified source also contains the same hash constant.
- Disposition: not a confirmed defect in the reviewed deployed source family. The checked-in source compiles to a different init hash under the repo configuration, so a future redeployment from that build needs the router constant regenerated and integration tests run. No remediation to the observed deployed pair accounting is proposed based on this candidate.

## Validation and limitations

- Local ephemeral Ganache reproduction completed with exact configured source build: compiler hash `e3ca...e85e`; factory pair and library-predicted pair differ; predicted address has no code.
- Read-only deployment attribution calls completed for pair `factory()`, factory `pairCodeHash()`, factory `getPair(RADIO,WETH)`, and router `factory()`. No transaction was sent and no public deployment was used to test behavior.
- The repository's `test/` directory covers RadioToken and RadioStaking, not AMM pair/router accounting. No AMM regression suite was available in the cloned source repository.
- Independent reviewer confirmed the local source/build mismatch and its router impact, while noting that deployment applicability requires exact compiled artifact attribution. The on-chain getter and pool/router references resolve that uncertainty for the current GeckoTerminal Ethereum deployment.
- No separate confirmed accounting defect was found in fee, liquidity, swap, callback, reserve, or rollback paths reviewed.

## Rejected/expected behaviors

- Permissionless `skim` and `sync` match standard V2 behavior: balance surplus can be collected, or explicitly synchronized into reserves. No reserve-backed LP value can be skimmed without a balance surplus.
- The 0.1% fee and protocol fee mint at liquidity events are deliberate implementation behavior, not a mismatch with the RadioShack SDK.
- Factory migrator control can gate first mint and define initial liquidity only while configured. It is owner-controlled state and part of the migration mechanism; no unauthorized caller bypass was found in the reviewed source.

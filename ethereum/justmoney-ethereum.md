# JustMoney V2 (Ethereum) Evidence Ledger

## Target and Source Attribution

- Chain: Ethereum mainnet. GeckoTerminal DEX ID: `justmoney-ethereum`.
- The 2026-11-25 GeckoTerminal first page lists 11 pools. All 11 map to factory `0xd36aba9ec96523b0a89886c76065852adfe2eb39`; the factory currently reports 15 total pairs.
- Sample pool: PNDC/WETH `0x54bfd4fa6dde7ce96140728b126af72702e4b354`. The factory is a non-proxy `JMSwapFactory`, compiler Solidity `0.5.17+commit.d19bba13`, optimizer 200, Istanbul EVM.
- Blockscout's verified source bundle includes `Pair`, `JMSwapFactory`, and their dependencies at [`factory source and deployment`](https://eth.blockscout.com/address/0xd36aba9ec96523b0a89886c76065852adfe2eb39?tab=contract). No matching public source repository was attributed during this pass.
- The source service marks the factory `is_verified=true` but `is_partially_verified=true`. Recompiling with the recorded compiler settings produces a Pair runtime whose executable section matches the deployed pair runtime after stripping CBOR metadata. The full factory runtime hash and the factory's `INIT_CODE_PAIR_HASH` do not match this local compilation, so a complete factory bytecode identity claim is not made. All 15 deployed pairs share the same runtime hash `0x571903095b4ceafd0993f55004c2d9a25ed3a25f95274e3e47530c7938cce28c` and match the compiled Pair executable section.
- Factory state at local fork block `26,492,389`: owner `0x0aaBf298983cc98579514622d3633A160Ce6e8d6`; protocol fee recipient `0x0a48d21f2CB0bed86edC1b78E32545A35C193bB2`.

## Architecture and Execution Map

- `JMSwapFactory.createPair` sorts token addresses, deploys `Pair` with CREATE2, initializes it, records both directions in `getPair`, and appends it to `allPairs`. Owner and moderator paths can update `feeTo` and the stored router address; only the owner can change the owner or moderator set.
- Each `Pair` is a V2-style LP token and constant-product pool. Its externally reachable state-changing paths are `initialize` (factory-only), `mint`, `burn`, `swap`, `skim`, and `sync`. The five operational paths use the pair lock. There is no public standalone protocol-fee mint function.
- `mint` measures token balances above reserves, mints fee shares if enabled, calculates liquidity, updates reserves, then checkpoints `kLast`. `burn` mints any fee shares first, burns LP shares held by the pair, transfers pro-rata underlying balances, updates reserves, and checkpoints `kLast`.
- `swap` transfers output before an optional `ICallee.call` callback, measures final balances, infers inputs, checks the 0.3%-fee-adjusted constant-product invariant, then stores reserves. `skim` transfers balance surplus over reserves; `sync` sets reserves to actual balances.

## Critical Invariants

- Successful swaps satisfy `(balance0 * 1000 - amount0In * 3) * (balance1 * 1000 - amount1In * 3) >= reserve0 * reserve1 * 1000^2` after callback settlement.
- Reserve updates must equal observed token balances and fit in `uint112`; any out-of-range balance reverts before narrowing.
- LP minting and burning must reflect the measured balance delta and the LP shares actually held by the pair.
- When protocol fees are enabled, fee shares represent one sixth of growth in `sqrt(k)` since `kLast`; a successful mint or burn advances the checkpoint so the same growth is not charged again.
- `skim` may remove only balance surplus and `sync` may incorporate a donation into reserves. Neither operation changes LP supply or bypasses the pair lock.

## Findings

No confirmed implementation defect was identified in the reviewed factory/pair source and current pair state. This is a scoped source and state assessment, not a claim that every router, token, or third-party integration is safe.

## Rejected Hypotheses

- **Repeated public protocol-fee minting:** disproven for this implementation. `_mintFee` is private and called only from `mint` and `burn`; each path updates `kLast` after updating reserves when fees are on. The factory ABI and verified source contain no external `mintFee` entry point.
- **Flash callback settlement bypass:** not indicated by the state machine. The callback executes under the pair lock, and both token balances are read afterward before the adjusted product check. An underpayment does not reach `_update`; the transaction reverts atomically.
- **Unaccounted reserve drift in currently registered pools:** not observed in the latest-fork sweep. For all 15 pairs, token balances equaled stored reserves at the sampled block.
- **Pair source/build mismatch:** no executable-section mismatch was observed for the deployed Pair family. Metadata differs, and the partial factory verification plus mismatching factory/init-code hashes leave full factory identity unresolved; this is an attribution limit, not a demonstrated behavioral defect.

## Isolated Validation and Limits

- `justmoney-ethereum-fork.test.js` forks Ethereum at latest state (block `26,492,389`), compiles the explorer-published bundle with Solidity 0.5.17, compares the executable Pair runtime, enumerates all 15 pairs, checks that all 11 GeckoTerminal page-one listings are registered, and compares each pair's token balances with stored reserves. Result: pass; one pair runtime family, no reserve drift, no public-chain transactions.
- The test did not submit local state-changing transactions because no credible invariant violation survived source and state review. Router deployment attribution and integrator behavior were not established, and no conclusions are transferred to JustMoney deployments on other chains.

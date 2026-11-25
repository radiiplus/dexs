# 9inch DEX (Ethereum) Evidence Ledger

## Target and Source Attribution

- Chain: Ethereum mainnet; GeckoTerminal DEX ID `9inch-ethereum`.
- GeckoTerminal returned 20 pools on its first page on 2026-11-25. Sample: 9INCH/WETH pair `0xe0533126c4013e2f5bcf44a2c84a396219be2d9d`, factory `0xcBAE5C3f8259181EB7E2309BC4c72fDF02dD56D8`.
- The factory reports 77 registered pairs. At local fork block `26,492,347`, all 20 GeckoTerminal-listed pairs were among those 77 factory entries. All 77 pair instances shared one runtime hash `0xae70832ee576a2f2f46134450f5781b1d3d973449afb26c19f35140a0f245cc5`.
- Sourcify marks both the sampled pair and factory `exact_match` for runtime. They use Solidity `0.8.19+commit.7dd6d404`, optimizer enabled for 999,999 runs, EVM Paris, and IPFS metadata. The regression test independently recompiles both verified source bundles with those settings and exactly matches their deployed runtime bytecode.
- Verified deployed source is available as [NineInchPair source and metadata](https://sourcify.dev/server/v2/contract/1/0xe0533126c4013e2f5bcf44a2c84a396219be2d9d?fields=sources,metadata) and [NineInchFactory source and metadata](https://sourcify.dev/server/v2/contract/1/0xcBAE5C3f8259181EB7E2309BC4c72fDF02dD56D8?fields=sources,metadata). Relevant source paths include `contracts/swap/NineInchPair.sol`, `contracts/swap/NineInchFactory.sol`, `contracts/swap/NineInchERC20.sol`, `contracts/libraries/Math.sol`, `contracts/libraries/SafeMath.sol`, and `contracts/libraries/UQ112x112.sol`. No matching public source repository was identified, so the reviewed implementation is attributed to Sourcify's exact-matched deployment source.
- The factory's current `feeTo` is `0xEe591146A6E6eA55db3F7ed236887A25FA406826`; `feeToSetter` is `0x6D5FC6Ac6e753f68d4F64cc7b605D925Cf642D5e`. Factory source gates fee-recipient changes to `feeToSetter`.

## Architecture and Execution Map

- `NineInchFactory.createPair` sorts token addresses, rejects duplicates, deploys a pair, calls pair initialization in the same transaction, and records the pair and both token-order lookup keys. The factory stores an enumerable `allPairs` list, `feeTo`, and `feeToSetter`.
- `NineInchPair` is a V2 constant-product pool with LP ERC-20 shares, `uint112` reserves, a 32-bit timestamp, cumulative prices, and `kLast` for protocol-fee growth. `initialize` is factory-only and sets token addresses once.
- `mint` measures deposits as token balance minus reserves, calls private `_mintFee`, calculates LP shares, updates reserves, and checkpoints `kLast` when protocol fees are enabled. Initial liquidity permanently locks `MINIMUM_LIQUIDITY` shares.
- `burn` redeems LP shares held by the pair pro rata against actual token balances, transfers both assets, rereads balances, updates reserves, and refreshes `kLast` when fees are on.
- `swap` transfers outputs optimistically and optionally calls `nineInchCallee` under the pair lock. It derives actual inputs from post-callback balances, enforces the adjusted constant-product invariant with fee coefficient 29/10,000 (0.29%), then updates reserves and cumulative prices.
- `skim` transfers only actual balances above stored reserves. `sync` updates stored reserves to actual balances. Both execute under the same pair lock.
- `_mintFee` is private and is called from `mint` and `burn`; the protocol LP share uses the growth in `sqrt(k)` relative to `kLast`. `kLast` is refreshed after the liquidity operation.

## Critical Invariants

- Stored reserves must equal the balances observed by `_update` after completed mint, burn, swap, or sync operations; reserve updates reject balances above `uint112.max`.
- Minted LP shares must correspond to measured deposits, and burned LP shares must redeem no more than the caller's pro-rata balance claim.
- For swaps, output transfers and any callback must settle against actual post-callback inputs. Adjusted balances must satisfy the fee-adjusted product check before reserves are updated.
- `skim` may transfer only positive surplus above reserves; `sync` may adopt current balances as the new reserves but may not itself transfer pool assets.
- A given `kLast` growth interval should be charged for protocol LP shares once; fee LP issuance should occur only through successful liquidity events that also checkpoint `kLast`.
- Callback reverts and all failed balance/product checks must revert the full transaction, including optimistic transfers and storage updates.

## Findings

No confirmed implementation defect was identified in the reviewed Ethereum factory/pair family. No severity is assigned. The result is limited to the verified core factory and pair source, the 77 registered pairs at the fork snapshot, and the execution paths reviewed here.

## Rejected Hypotheses

- **A user can front-run pair initialization:** disproven by source. Pair initialization requires `msg.sender == factory`, and factory creation and initialization occur atomically in one transaction.
- **A public fee-mint function repeats protocol LP dilution against stale `kLast`:** disproven by source. There is no external `mintFee`; `_mintFee` is private and reached only in `mint` and `burn`, both of which update `kLast` after reserve changes when fees are enabled.
- **`skim` can transfer reserve-backed funds:** disproven by its `balance - reserve` calculation. The fork sweep found no deficit or surplus for all 77 pairs at the checked state.
- **A flash-swap callback can keep outputs without repayment:** disproven for a single pair by post-callback input derivation and the adjusted product check under the pair lock; failed checks revert the output transfers.
- **A donation or manipulated balance can overflow reserve storage after settlement:** source requires both balances to fit `uint112` in `_update`, and the entire operation reverts if a completed state update exceeds this range.
- **The protocol fee is accidentally double-charged:** not supported by the call graph. `_mintFee` is private, runs before mint/burn share calculations, and `kLast` is refreshed after the operation.

## Isolated Validation and Limits

- `9inch-ethereum-fork.test.js` forked Ethereum locally at block `26,492,347`. It recompiled the exact-matched pair and factory sources with Solidity 0.8.19 settings, enumerated all 77 factory pairs, verified factory identity, token sorting and a shared pair runtime hash, and compared actual token balances with reserves. All 77 reconciled with zero drift; all 20 GeckoTerminal first-page entries were factory pairs. Result: pass; no public transaction was sent.
- The test and report do not establish router deployment attribution, nonstandard token behavior outside the listed pairs, governance compromise, or external oracle/integrator safety. No speculative economic scenario is promoted to a finding.

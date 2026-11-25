# ApeSwap (Ethereum) Evidence Ledger

## Target and source

- Chain: Ethereum mainnet; GeckoTerminal DEX ID `apeswap_ethereum`.
- Sample pool: `0x8e4c56e78e8888cebf85e30f13c9a1b3a67889d6` (BTCBR/WETH). A read-only `factory()` call returned `0xbae5dc9b19004883d0377419fef3c2c8832d7d7b`, matching ApeSwap's Ethereum factory. Blockscout reports `ApePair`, Solidity 0.5.16, optimizer enabled, partially verified source.
- Core source: `ApeSwapFinance/apeswap-swap-core`, commit `77ad9637fd0a6b3f7066c90cbb9780a1518acb3d` (2023-03-03). Periphery source: `ApeSwapFinance/apeswap-swap-periphery`, commit `1bde4de06ff38c24599b0bd8b7d1bd72927511ae`. Exact deployed bytecode-to-commit attribution and router deployment attribution were not established. No public deployment was modified.

## Architecture and execution map

- `ApeFactory` creates sorted-token pairs with CREATE2, records both pair lookup directions, and controls `feeTo` and `feeToSetter`. `ApePair` is a V2-style LP ERC-20 with `uint112` reserves, timestamped cumulative prices, `kLast`, and a lock around mint, burn, swap, skim and sync.
- `ApePair.swap` transfers requested outputs optimistically, optionally invokes `apeCall`, reads final token balances, derives actual inputs, applies the 0.2% fee invariant, and updates reserves. A failed settlement/invariant check reverts the whole swap.
- Mint and burn use observed balances, total LP supply and any protocol LP shares from `_mintFee`. `kLast` is updated after mint/burn when fee collection is on and cleared when it is off. `skim` transfers balance excess; `sync` reconciles reserves and rejects balances above `uint112`.
- Periphery `ApeLibrary` computes deterministic pair addresses and exact-input/output path amounts. Its 998/1000 coefficient matches the core pair's `amountIn * 2` deduction from a 1000 scale.

## Critical invariants

- Successful swaps satisfy the fee-adjusted constant-product invariant and commit reserves equal to final pair balances.
- LP mint/burn and protocol fee minting preserve proportional ownership and account for growth in `sqrt(k)` once, with `kLast` representing the post-liquidity-event reserves.
- Callback settlement remains atomic under the pair lock; no output persists unless the invariant passes.
- Router pair-address derivation and fee math match the deployed core implementation.
- Reserve values never truncate: `_update` rejects any token balance above the `uint112` storage range.

## Findings

No confirmed implementation defect was identified in the reviewed core and periphery paths.

## Candidate checks and rejected hypotheses

- **Protocol-fee formula appears inconsistent with its `1/6th` comment:** the implementation uses `(rootK / 3) + rootKLast` in the denominator, which is not the standard Uniswap-V2 formula. The pair test explicitly labels its current expected mint as a 0.15% protocol fee and retains the 0.05% scenario as commented historical values. With the core's 0.2% swap fee, this confirms the active formula implements the intended three-quarters protocol share of fee growth; the stale one-sixth comment is not treated as a defect.
- **Router/core fee mismatch:** disconfirmed. Core uses `1000 * balance - 2 * amountIn`; `ApeLibrary.getAmountOut/getAmountIn` use 998/1000.
- **Timestamp arithmetic wrap:** `uint32` elapsed-time subtraction and cumulative price wrapping follow V2 oracle arithmetic; no token reserve discrepancy results.
- **Balance/reserve mismatch:** mint, burn, swap, skim and sync use actual token balances, with explicit reserve overflow rejection. No compositional loss path was found.

## Isolated validation and limitations

- Using temporary Node 16.20.1, `yarn test` compiled the contracts and passed all 32 upstream tests, including pair swaps, reserve/oracle transitions, LP mint/burn, `feeTo` on/off, and factory configuration.
- No dedicated new regression test was needed because no credible defect candidate remained. Tests use synthetic assets and a local Waffle provider.
- This conclusion applies to the inspected Ethereum ApeSwap V2-style pair family. Partial source verification and exact runtime-to-commit/router matching remain limitations; other chains or ApeSwap variants require separate validation.

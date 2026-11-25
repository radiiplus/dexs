# Pepedex (Ethereum) Evidence Ledger

## Target and Source

- Chain: Ethereum mainnet; GeckoTerminal DEX ID `pepedex`.
- GeckoTerminal returned six indexed pools on 2026-11-25. The Pepedex factory itself reports 26 created pairs; all 26 currently have nonzero reserves. The six GeckoTerminal listings are a subset of the factory registry.
- The six indexed pairs and all 26 factory pairs report factory `0x460b2005b3318982feada99f7ebf13e1d6f6effe`; all 26 runtime bytecodes are 8,992 bytes and byte-identical at the latest-state local fork head `26,492,116` (Keccak-256 `0x2d77086e6d9382618bb332dd3fcd18467527e647cd8eca69bfd9889820dfe436`).
- The factory is verified as `PepeDexFactory`, Solidity `0.5.16`, exact runtime and creation matches in Sourcify. Its verified source is [PepeDexFactory.sol](https://repo.sourcify.dev/1/0x460b2005b3318982feada99f7ebf13e1d6f6effe). A sampled pair, `0x54c4c936911dcd4755f6007987c50b4cdb448174`, is matched (not exact-matched) by Sourcify as `PepeDexPair`, Solidity `0.5.16`; its source is [PepeDexFactoryETHV1.sol](https://repo.sourcify.dev/1/0x54c4c936911dcd4755f6007987c50b4cdb448174). The six GeckoTerminal pools and full factory registry share the same deployed runtime, but exact source-to-runtime attribution for the pair is not claimed.
- The public [Pepemon DAO contracts repository](https://github.com/pepemon-dao/contracts) contains PPDEX token sources, not the AMM pair/factory implementation. No DEX source repository was found. The available pair/factory evidence is from Sourcify's verified on-chain submissions.
- The factory's `feeTo` and `feeToSetter` both resolve to `0x579733a299cf192df9d2624701f1819a29c8bf58`, a GnosisSafeProxy resolving to the canonical GnosisSafe implementation `0xd9db270c1b5e3bd161e8c8503c55ceabee709552`. This is a governance trust boundary, not a permissionless pair path. The originally advertised router address is incomplete in the discoverable reference and was not independently attributed; router-specific behavior is excluded.

## Architecture and Execution Map

- `PepeDexFactory` stores the bidirectional token-pair mapping, the `allPairs` registry, `feeTo`, and `feeToSetter`. `createPair` rejects identical/zero tokens and duplicates, sorts token addresses, deploys the pair with CREATE2, calls `initialize`, then records both mapping directions and emits `PairCreated`.
- `PepeDexPair` is a V2-style constant-product pool with LP ERC-20/permit, two `uint112` reserves, a `uint32` timestamp, cumulative prices, `kLast`, and a `lock` modifier. The factory is stored by the pair constructor; only that factory may initialize token addresses.
- Entry points: LP `approve`, `transfer`, `transferFrom`, and `permit`; pair `mint`, `burn`, `swap`, `skim`, and `sync`; factory `createPair`, `setFeeTo`, and `setFeeToSetter`. There are no owner-only pair withdrawals or arbitrary pair-token transfer functions.
- `mint` derives deposits from `balanceOf(pair) - reserve`, mints LP shares against actual balances, then updates reserves. `burn` uses the LP balance held by the pair and actual token balances for pro-rata redemption, transfers both assets, rereads balances, and updates reserves. Both call `_mintFee` before calculating LP amounts.
- `swap` optimistically transfers outputs, optionally invokes `PepeDexCall` while the pair lock is held, reads final balances, derives actual inputs, enforces nonzero input and the fee-adjusted product invariant, then updates reserves and emits `Swap`. The fee adjustment is `amountIn * 25` against a `10,000` denominator, i.e. a 0.25% swap fee.
- `_mintFee` consults the factory's current fee recipient. When enabled and `kLast` is nonzero, it mints protocol LP shares using `8 * (sqrt(k) - sqrt(kLast)) / (17 * sqrt(k) + 8 * sqrt(kLast))`; with fees disabled it clears `kLast`. The source comment identifies the intended `8/25` growth share.
- `skim` transfers only positive balance surplus above reserves; `sync` updates reserves to observed balances and cumulative prices. A surplus can be captured by any caller through `skim`, which is standard V2 behavior and does not transfer reserve-backed value.

## Critical Invariants

- After a successful swap, both adjusted token balances must preserve `k`: `(balance0 * 10,000 - amount0In * 25) * (balance1 * 10,000 - amount1In * 25) >= reserve0 * reserve1 * 10,000^2`.
- Reserves are the last synchronized pool balances; deposits and swaps measure actual balances rather than trusting router-supplied amounts. `mint`, `burn`, and `swap` update reserve state only after their value movement and validation complete.
- LP ownership is the ERC-20 total supply; initial liquidity permanently locks 1,000 raw LP units at zero address. Protocol-fee LP dilution is minted only from growth in `sqrt(k)` when factory fee collection is enabled.
- Pair lock spans token transfers and the external swap callback. A callback cannot reenter the same pair's state-changing entry points before settlement completes.
- `skim` can recover only balance above reserve, while `sync` can recognize any current token balance as reserve. Negative rebases or unusual token behavior can cause the standard V2 `skim` subtraction to revert until balances are reconciled; no such case was observed across the reviewed factory set at the pinned block.

## Assessment

**No confirmed implementation defect found in the reviewed Pepedex factory/pair runtime family.** Source analysis found no permissionless path to transfer reserve-backed balances without satisfying the adjusted product check or burning LP shares. Pair accounting uses observed token balances for deposits, swaps, and burns; the callback is protected by the pair lock; factory pair registration sorts tokens and prevents duplicates.

At local fork head `26,492,116`, the factory listed 26 pairs, all 26 had nonzero reserves, and all shared one runtime hash. The local-fork characterization found one positive balance surplus: pair `0x6c2d4a2635c236c583124b297fb7c613ff5ab618`, token0 `0x755f0a971f2a3bb2aede78db2cd34170c08b7a41` (SDDOGS), had `8,017,127,425,027,090,535` raw units above reserve0; token1 equaled reserve1. This is an ordinary donation/surplus accepted by the design, recoverable by `skim`, and not a reserve-accounting defect. No negative reserve drift was observed in this snapshot.

The factory's protocol-fee recipient is currently nonzero, so the protocol LP-mint path is active. The formula differs from canonical Uniswap V2's 1/6 growth-share formula but is internally consistent with Pepedex's explicit `8/25` source comment and 0.25% swap-fee design. No evidence establishes that this configured policy violates Pepedex's intended fee split; it is not reported as a defect.

## Rejected Hypotheses

- **Permissionless `skim` drains reserves:** disproven by the source subtraction against stored reserves; only positive surplus is transferred.
- **Flash callback bypasses settlement:** disproven for a single pair. `lock` remains held through callback, actual post-callback balances determine input, and the adjusted product check runs before reserve updates.
- **Fee-on transfer or unusual token behavior invalidates accounting:** no general conclusion is made for arbitrary tokens. The implementation uses actual balances for settlement; no concrete violation was found among the 26 registered pairs at the pinned snapshot.
- **Protocol-fee formula is an accidental copy/paste error:** unsubstantiated. The numerator/denominator is unusual relative to Uniswap V2, but the source explicitly documents the chosen share and the invariant impact is dilution policy, not reserve extraction.
- **GeckoTerminal's six pools are the full protocol registry:** false; the verified factory's `allPairsLength()` is 26. The on-chain factory enumeration was used for code-family coverage.

## Isolated Validation and Limits

- `pepedex-ethereum-fork.test.js` forked the provider's latest Ethereum state in local Ganache and performed read-only assertions over all 26 factory pairs: factory identity, token ordering, common runtime hash, fee recipient, reserve values, and token balances. Result: pass at local fork head `26,492,116`; 26/26 active pairs, one shared runtime, one positive surplus, zero public transactions.
- The test supports pinning `FORK_BLOCK` when an archive-enabled RPC is available. Node `v24.22.2` used the JavaScript Ganache fallback because the optional µWS native binary is unavailable; behavior passed.
- No live deployment was mutated. No speculative token-cashout, oracle-consumer, or router finding is inferred. Router source and exact deployment attribution remain unverified.

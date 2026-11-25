# X7 Finance Xchange (Ethereum) Evidence Ledger

## Target and Source

- Chain: Ethereum mainnet; GeckoTerminal DEX ID `x7-finance` (Xchange AMM).
- GeckoTerminal returned 16 pool listings on 2026-11-25. The Xchange factory `0x7de800467afce442019884f51a4a1b9143a34fac` reports 141 registered pairs; all 16 listed pools are members of that factory. At block `0x1943d00`, all 141 pair contracts had code and shared a single 18,075-byte runtime family. Ninety-five had `sqrt(reserve0 * reserve1) > sqrt(kLast)` while the factory fee recipient was nonzero.
- Sourcify identifies the factory as `XchangeFactory` and the sampled PNDC/WETH pair `0x7aea467e10e2871cd82f620cc1d51b3e284840c1` as `XchangePair`, Solidity `0.8.15`; both report a `match`, not an exact match. The pair runtime hash observed in the GeckoTerminal set is `0x63b0c10fac87b2bb33247699dff60d90cb8d703de9caa1d1d72eb4aebd221d9a`.
- The public [X7 Finance monorepo](https://github.com/x7finance/monorepo/tree/99132819ff3cd4fb2bac0169489a2dcd2a0e3c4d) is pinned at `99132819ff3cd4fb2bac0169489a2dcd2a0e3c4d`. Relevant files: [`XchangeFactory.sol`](https://github.com/x7finance/monorepo/blob/99132819ff3cd4fb2bac0169489a2dcd2a0e3c4d/packages/contracts/src/contracts/source/XchangeFactory.sol), [`XchangePair.sol`](https://github.com/x7finance/monorepo/blob/99132819ff3cd4fb2bac0169489a2dcd2a0e3c4d/packages/contracts/src/contracts/source/XchangePair.sol), [`XchangeRouter.sol`](https://github.com/x7finance/monorepo/blob/99132819ff3cd4fb2bac0169489a2dcd2a0e3c4d/packages/contracts/src/contracts/source/XchangeRouter.sol), and [`XchangeRouterWithDiscounts.sol`](https://github.com/x7finance/monorepo/blob/99132819ff3cd4fb2bac0169489a2dcd2a0e3c4d/packages/contracts/src/contracts/source/XchangeRouterWithDiscounts.sol). The Sourcify source body for `_mintFee` matches the repository implementation; exact full-runtime identity is not claimed.
- The factory's current `feeTo` is `0x64403fe09272acc690176a5245e715a57261da28` (an EOA at the observed state); `owner` is `0x7000a09c425ABf5173FF458dF1370C25d1C58105`. The factory also controls a discount authority, trusted callers, and failsafe liquidators. Current `hasMinimums` is false and both token minimums are zero in all 16 GeckoTerminal-listed pools.
- Router source exists in the public repository, but its deployment address was not attributed to the factory during this pass. The confirmed finding is on the pair's direct public entry point and does not depend on the router.

## Architecture and Execution Map

- `XchangeFactory` sorts token addresses, prevents duplicate pairs, deploys pairs with CREATE2, initializes the pair, and records bidirectional pair/token mappings. The owner sets `feeTo`, `discountAuthority`, trusted principals, and failsafe liquidators.
- `XchangePair` is an extended V2 constant-product pair: LP ERC-20 with permit, `uint112` reserves, cumulative prices, `kLast`, public `mint`, `burn`, `swap`, `swapWithDiscount`, `skim`, `sync`, and `mintFee`; trusted-only `setMinimumBalance`, `withdrawTokensAgainstMinimumBalance`, and `syncSafe`; failsafe-liquidator-only `mustBurn`.
- Regular `swap` uses fee parameter 200 with denominator 100,000, i.e. 0.2%. `swapWithDiscount` uses the discount authority for untrusted callers and caps that fee at 200; trusted callers may supply a fee override that is also capped at 200. Both paths measure balances after the optional Uniswap V2 callback, enforce the adjusted product invariant, and update reserves under `lock`.
- `mint` and `burn` call `_mintFee` before share calculations, then update `kLast` after reserve updates when fee collection is enabled. `mintFee()` is an additional external path that calls `_mintFee` directly.
- `mustBurn` uses reserve-based pro-rata amounts and gas-capped token transfers, then updates reserves from observed balances. It is gated by the factory's failsafe-liquidator list. Minimum-balance management and withdrawals are gated by the trusted list; these roles are administrative boundaries, not public pair entry points.

## Critical Invariants

- After a successful swap, actual balances after the callback must satisfy the fee-adjusted product check: `(balance0 * 100000 - amount0In * fee) * (balance1 * 100000 - amount1In * fee) >= reserve0 * reserve1 * 100000^2`.
- Deposits, withdrawals, and swaps must reconcile to actual token balances before reserve updates. LP ownership is represented by total supply; `burn` must redeem only LP units held by the pair.
- A given reserve-growth interval from `kLast` may be charged the documented protocol fee once. Once fee LP shares are minted for that interval, the checkpoint must advance, or the same growth is counted again against a larger `totalSupply`.
- Pair locking must cover callback settlement and balance reconciliation. Privileged minimum-balance and failsafe paths must preserve their configured token floors and are analyzed with their factory authorization conditions.

## Findings

### Medium: public `mintFee()` repeatedly mints against the same `kLast` growth

Status: **Confirmed on deployed-bytecode behavior in a local Ethereum fork.** The finding concerns LP dilution to the configured fee recipient; the caller receives no LP tokens and no attacker cash-out was demonstrated.

At [`XchangePair.sol#L345-L348`](https://github.com/x7finance/monorepo/blob/99132819ff3cd4fb2bac0169489a2dcd2a0e3c4d/packages/contracts/src/contracts/source/XchangePair.sol#L345-L348), public `mintFee()` reads reserves and invokes `_mintFee` without authorization, the pair lock, or a `kLast` update. [`_mintFee` at lines 506-515](https://github.com/x7finance/monorepo/blob/99132819ff3cd4fb2bac0169489a2dcd2a0e3c4d/packages/contracts/src/contracts/source/XchangePair.sol#L506) computes protocol LP issuance from `totalSupply`, `sqrt(reserve0 * reserve1)`, and `sqrt(kLast)`, then mints the result to `feeTo`. Unlike `mint` and `burn`, the standalone entry point does not advance `kLast` to the current reserve product after minting.

The intended one-time fee basis is clear in the source comment at line 501: protocol LP issuance is “equivalent to 1/2th of the growth in sqrt(k).” For `mint` and `burn`, `kLast` is refreshed after `_mintFee`. For public `mintFee`, the baseline remains fixed. Repeating the valid call therefore reuses the same growth interval while `totalSupply` includes the LP shares minted by previous calls. Each call mints a larger amount and transfers additional pool ownership to `feeTo`, diluting existing LPs without changing either token reserve or `kLast`.

Local fork reproduction used PNDC/WETH pair `0x7aea467e10e2871cd82f620cc1d51b3e284840c1` at local head `26,492,184`. Before the calls, `sqrt(k)` was `1,085,320,583,508,851,873,057`, `sqrt(kLast)` was `1,022,599,628,398,133,160,186`, total LP supply was `1,022,599,628,398,133,146,906`, and feeTo held zero LP units. Three calls from an ordinary local signer minted `30,427,349,681,785,367,665`, then `31,332,712,428,795,079,266`, then `32,265,014,153,846,938,850` LP units to feeTo. The cumulative feeTo balance became `94,025,076,264,385,140,781`; `kLast`, reserves, and both underlying token balances stayed unchanged. No flash loan or LP capital was required.

The same runtime family covers all 141 pairs in the factory; the state sweep found 95 pairs with fee collection enabled and positive uncheckpointed growth at block `0x1943d00`. The 16 GeckoTerminal-listed pools all had pending growth in the earlier state snapshot. A caller can repeatedly trigger the overmint, but value is credited to `feeTo`, not to the caller. The code creates an LP-ownership transfer beyond the source's stated fee share; it does not establish direct attacker profit or an unauthorized transfer to the caller.

Remediation: make `mintFee` internal and collect only through `mint`/`burn`, or advance `kLast` to the current reserve product after the standalone collection when fees are on. Apply the pair lock to this state-changing entry point and add a regression asserting a second call with unchanged reserves and `kLast` mints zero.

## Rejected Hypotheses

- **`swapWithDiscount` lets an untrusted caller choose a zero fee:** disproven by source. Untrusted callers' supplied override is ignored; the discount authority's fee is read and capped at 200. The ordinary `swap` path uses 200.
- **Permissionless `skim` can transfer reserve-backed balances:** disproven by source's balance-minus-reserve calculation; only surplus is transferable.
- **`mustBurn` is a public LP confiscation path:** disproven by the factory `isFailsafeLiquidator(msg.sender)` guard. Its transfer-failure behavior is a privileged emergency design assumption; no bypass was identified.
- **Minimum-balance withdrawals are public:** disproven by `isTrusted(msg.sender)`. No minimums were configured in the 16 GeckoTerminal-listed pairs at the observed state.
- **The fee formula itself is unintended:** not established. The source explicitly describes a one-half growth share. The defect is repeated charging of the same checkpoint interval, not the stated rate.

## Isolated Validation and Limits

- `x7-finance-mintfee-regression.test.js` forks Ethereum locally, enumerates the factory pairs, confirms one runtime family, finds a pair with pending fee growth, and invokes `mintFee()` three times under snapshots. Result: pass; each call increased `feeTo` LP balance, the later mint deltas grew, while `kLast`, reserves, and token balances remained fixed. The snapshot is reverted and no public transaction is sent.
- Node `v24.22.2` runs Ganache through its JavaScript fallback because the optional µWS binary is unavailable. The same local-fork setup passed for the Pepedex characterization.
- Router deployment attribution, discount-authority implementation behavior, and privileged X7 lending/failsafe integrations are not promoted into findings here. No conclusion is transferred to X7's similarly named deployments on other chains or its separate lending contracts.

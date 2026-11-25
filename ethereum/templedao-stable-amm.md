# Ethereum / TempleDAO Stable AMM

## Scope and target identity

- Chain: Ethereum mainnet.
- DEX: TempleDAO Stable AMM, custom router and a V2-derived pair.
- Current official docs list `TEMPLE_V2_PAIR` at `0x6021444f1706f15465bEe85463BCc7d7cC17Fc03` and `TEMPLE Stable AMM Router` at `0x98257c876ace5009e7b97843f8c71b3ae795c71e`. The Temple repo's Ethereum deployment table maps those same addresses, and retains generated ABIs for `TempleUniswapV2Pair` and `TempleStableAMMRouter`.
- The source repo is [TempleDAO/temple](https://github.com/TempleDAO/temple). Its current head during this review was `b264a7e5e90a4c7a8b7255cca1c4dbed6e01d235` (2026-11-02). AMM Solidity sources were later removed as deprecated. The latest source commit before removal is `bd0c84d1dbed586c5a977af1e9b54e661b8abcb9` (2025-05-26), specifically `protocol/contracts/amm/TempleStableAMMRouter.sol`, `TempleUniswapV2Pair.sol`, and `TreasuryIV.sol`.
- Router compiler pragma: `^0.8.4`; pair compiler: exact `0.5.16`. Historical Hardhat config enabled optimizer with 999,999 runs for those compilers.
- Deployment linkage is plausible but not bytecode-confirmed: docs and repository deployment table agree on addresses, router ABI remains in the repo, and the deployment helper labels these contracts. The mainnet deployment script comments out pair/router deployment and attaches to existing addresses. Etherscan source retrieval did not provide usable verified source in this review. Findings below are therefore about archived source, not a claim that currently deployed bytecode has been independently matched.
- This is a source-based review. No transaction, live state mutation, or live deployment test was performed.

## Architecture and execution map

`TempleStableAMMRouter` stores a stable-token-to-pair mapping, TEMPLE token, treasury IV source, and a separately configured defense stable. Owner-only setters change all four trust roots (`addPair`, `setTreasury`, `setDefendStable`). User entry points are `addLiquidity`, `removeLiquidity`, `swapExactStableForTemple`, and `swapExactTempleForStable`; quote helpers expose swap estimates. `withdraw` lets the owner transfer router-held ERC20 or ETH balances.

`TempleUniswapV2Pair` is a V2-style LP token and reserve pair. It fixes token addresses in its constructor, stores `uint112` reserves and cumulative prices, and tracks a single `router` address configured by the pair owner. `mint`, `burn`, `skim`, and `sync` use the conventional V2 balance/reserve model. `swap` alone is router-gated, guarded by the pair lock, performs optional callback execution, checks the adjusted constant-product invariant, and then syncs reserves. The archived source's constructor and tests establish token0 as TEMPLE and token1 as stable for the associated pair.

`TreasuryIV` stores owner-configured numerator/denominator values `(frax, temple)`. On sells, the router compares the pair's 0.5%-fee AMM quote with `amountIn * frax / temple`. If the IV amount is larger, it burns the seller's TEMPLE and pays the configured `defendStable`; otherwise it transfers TEMPLE into the pair and calls pair swap.

## Entry points and state transitions

| Entry point | State/value flow |
|---|---|
| `addPair`, `setTreasury`, `setDefendStable` | Owner changes pair lookup, IV source, or defense payout token. No user funds move. |
| `addLiquidity` | Validates deadline, supported pair, and desired amounts >= minima. Computes proportional amounts from reserves, transfers TEMPLE and selected stable directly to pair, calls `mint(to)`. Pair LP supply increases from balance deltas; reserves sync to balances. |
| `removeLiquidity` | Transfers caller LP to pair, calls `burn(to)`, checks both minima. Pair burns its full LP balance and transfers each asset pro rata; any failed minimum reverts the whole transaction. |
| `swapExactStableForTemple` | Quotes using reserves and 0.5% fee, enforces output minimum, transfers stable input to pair, calls `swap` for TEMPLE output. Pair checks invariant against observed balances and syncs. |
| `swapExactTempleForStable` | Computes AMM and IV output. Above IV, transfers TEMPLE to pair and swaps stable out. Below IV, burns caller TEMPLE and transfers `defendStable` held by router. Both branches enforce output minimum. |
| Pair `mint` / `burn` | Permissionless V2 low-level routines; account from live token balances and supply. `burn` consumes the pair's entire held LP balance. |
| Pair `swap` | Router-only, lock-protected; optimistic output/callback, infer input from post-callback balances, enforce adjusted K, update reserves. |
| Pair `skim` / `sync` | Permissionless V2 surplus collection / reserve synchronization. |
| Router `withdraw` | Owner-only sweep of assets held by router, including defense reserves. |

## Critical invariants

1. After every completed pair action, stored reserves equal observed token balances, except for deliberate surplus between actions that can be skimmed or synchronized.
2. Swap output must satisfy the pair's adjusted constant-product invariant using observed input, not router-supplied accounting.
3. LP issuance is bounded by actual balance deltas; LP burns distribute against actual pair balances and total supply.
4. Liquidity-add and remove minima are checked before successful completion; a failed check atomically rolls back token and LP transfers.
5. For an AMM-path swap, router quote output must not exceed what the pair invariant permits. Router quote uses a 0.5% fee while pair K checks deduct 0.3%, so the quote is conservative; the difference is retained in reserves for LPs.
6. A below-IV sale intentionally exchanges burned TEMPLE for the configured defense stable, drawing only from router-held defense inventory; it does not alter pair reserves.
7. Ownership/configuration changes affect trust assumptions: owner controls supported pairs, IV source, defense token, and router-held reserves.

## Findings

No confirmed invariant violation was found in the archived implementation. No candidate reached the threshold for a regression PoC.

Deployment status: source-to-address matching remains unverified. This review does not assert that the archived source is the exact runtime bytecode at the currently documented addresses.

## Rejected hypotheses and expected behavior

- **Slippage minima bypass on add liquidity:** the 2022 PeckShield report identified that the earlier router could skip a minimum check in one ratio branch. In the recovered `TempleStableAMMRouter`, `addLiquidity` now first requires both desired values to be at least their minima, then `_addLiquidity` validates the selected proportional side. The old finding is not present in this source. The report states its issue was fixed.
- **Different quote and pair fees:** `getAmountOut` applies 995/1000 (0.5%), while pair K applies the usual 997/1000 adjusted input (0.3%). The router therefore asks the pair to pay less output than the K check permits. This leaves the fee difference in the pool and does not violate the reserve, LP, or swap invariant.
- **Defense token differs from selected pool stable:** this is intentional. The router has a separate `defendStable` setting, and the local suite explicitly checks that below-IV TEMPLE sales pay the configured token even when a different stable-token pair was selected.
- **Permissionless `skim` and `sync`:** these are expected V2 pair operations. `skim` only transfers balance above reserves; `sync` sets reserves to balances. Neither creates a deficit in the reserve accounting model.
- **Admin can change pair/IV/defense settings or withdraw router-held funds:** this is a privileged trust assumption represented by explicit owner-only functions, not an unprivileged accounting exploit.
- **Fee-on-transfer or rebasing assets:** no support guarantee was established for such tokens. The listed configured assets are intended to be standard ERC20s; this assessment does not treat unsupported token semantics as a defect.

## Controlled validation

- Historical detached checkout: `bd0c84d1` in `/tmp/gecko-audit-temple-historical`.
- Command: `NODE_ENV=test yarn hardhat test test/amm_test.ts`.
- Result: 16 passing. Tests exercise stable-to-TEMPLE swaps, above-IV and below-IV TEMPLE sells, defense-token selection, add/remove liquidity, minimum checks, deadlines, and owner-only configuration.
- The tests ran on Hardhat's local in-memory EVM with synthetic ERC20s; no live network endpoint or real asset was used.
- Independent source review by a second reviewer found no confirmed accounting or state invariant defect and agreed the fee difference and configured defense payout are expected behavior.

## Remediation / follow-up

No code fix is recommended from this source review. Preserve the add-liquidity guard that checks both desired amounts against minima. For a deployment-specific conclusion, match the public runtime bytecode for the documented router and pair addresses to verified build artifacts (including compiler and optimizer settings).

## Evidence references

- [TempleDAO contracts documentation](https://docs.templedao.link/technical-reference/contracts) lists the Ethereum pair, router, AMM ops, and whitelist addresses.
- [TempleDAO source repository](https://github.com/TempleDAO/temple).
- [Archived router at reviewed commit](https://github.com/TempleDAO/temple/blob/bd0c84d1dbed586c5a977af1e9b54e661b8abcb9/protocol/contracts/amm/TempleStableAMMRouter.sol).
- [Archived pair at reviewed commit](https://github.com/TempleDAO/temple/blob/bd0c84d1dbed586c5a977af1e9b54e661b8abcb9/protocol/contracts/amm/TempleUniswapV2Pair.sol).
- [Archived AMM test suite](https://github.com/TempleDAO/temple/blob/bd0c84d1dbed586c5a977af1e9b54e661b8abcb9/protocol/test/amm_test.ts).
- [PeckShield TempleDAO audit, 2022-04-28](https://4060857351-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2F-McG7st47-ZST4fx_Lnt%2Fuploads%2F1HhIaiNGlUh6Tf0DzITf%2F2022-04-28-PeckShield-Audit-TempleAMM.pdf?alt=media&token=5409a0cb-146c-4414-8624-dbb7e05eecbc), finding PVE-003 and remediation status at report lines 369-427.

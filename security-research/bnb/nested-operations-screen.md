# BNB Chain: Nested-Operation Screen

Status: source-level screening; no deployed-bytecode match or local fork reproduction yet.

## Candidate field

Registry snapshot queried 2026-11-27:

- DeFiLlama lists PancakeSwap AMM, PancakeSwap AMM V3, PancakeSwap Infinity, Lista DEX, DODO, THENA, Wombat, and other BNB (`Binance` in the API) DEX deployments. Lending entries include Venus Core, Aave V3, Lista Lending, Morpho Blue, Euler V2, and smaller markets.
- GeckoTerminal's BNB network DEX registry includes PancakeSwap V2/V3/Infinity, Uniswap V2/V3/V4, THENA, Biswap, and many long-tail venues. Its active-pool page returned PancakeSwap V3, Infinity, and Uniswap pools among the highest displayed volume pools at query time.

Sources: [DeFiLlama protocol API](https://api.llama.fi/protocols), [GeckoTerminal BNB DEX API](https://api.geckoterminal.com/api/v2/networks/bsc/dexes), [GeckoTerminal BNB pools API](https://api.geckoterminal.com/api/v2/networks/bsc/pools).

## Selected intersection: Lista V3 collateral + Moolah lending

This is the strongest native-operation candidate found in the first BNB pass because the DEX position is itself an accepted lending collateral type, and liquidation can redeem that position and swap its legs before repaying debt. Lista's docs describe the smart-lending flow and LP-position collateral; the official source repositories are `lista-dao/lista-v3` and `lista-dao/moolah`.

Source snapshots inspected:

- `lista-v3`: `db4e6906871b54000b67ffffac377150c53c1c20` (2026-10-09)
- `moolah`: `09ab8531bad692c9227e18edc5b6079f85a5cf45` (2026-11-26)

These are repository commits, not proof that any current BNB proxy resolves to these implementations.

## Accepted and rejected input ranges

### V3Provider deposit and withdrawal

Accepted deposit path (`src/provider/v3/V3Provider.sol`):

- `marketParams.collateralToken` must equal the provider share token; the market must be registered; `onBehalf` must be nonzero.
- When deposits are gated, both caller and beneficiary must be allowlisted.
- Native BNB is accepted only when one pool leg is the configured wrapped-native token. If `msg.value > 0`, it replaces the desired amount on that leg.
- At least one input amount must be nonzero. First deposit mints against fair-price valuation. Later deposits use the live position composition, consume the pro-rata fraction, enforce `amount0Min`, `amount1Min`, and `minShares`, then park accepted tokens as idle inventory.
- Unused inputs are refunded after shares are minted and supplied as Moolah collateral. The provider's `receive()` rejects native coin from senders other than the adapter or wrapped-native token.
- The one-token ERC-4626 `deposit`, `mint`, `withdraw`, and `redeem` entry points intentionally revert with `StandardEntryDisabled`.

Withdrawal paths require nonzero shares and receiver, caller authorization for the account, and Moolah health validation. V3 share redemption additionally checks each leg's minimum output. Delisted or disallowed users retain withdrawal/redeem paths; the whitelist gates new positions and reassignment to another receiver.

Relevant source: [V3Provider.sol](https://github.com/lista-dao/moolah/blob/09ab8531bad692c9227e18edc5b6079f85a5cf45/src/provider/v3/V3Provider.sol).

### Moolah liquidation and callback path

- Liquidation accepts exactly one of `seizedAssets` or `repaidShares`; it accrues interest and requires the borrower to be unhealthy at the selected collateral price.
- The selected seizure/repaid amount is derived using the configured liquidation-incentive factor. Debt and collateral state are updated before collateral transfer and before the optional `onMoolahLiquidate` callback.
- The callback is invoked on the liquidator only when liquidation `data` is nonempty. Moolah's liquidation entry point is `nonReentrant`; the V3 provider and V3 liquidator also guard their relevant write paths.
- The V3 liquidator adds separate role and whitelist gates for market, provider, swap pair/spender, and token paths. Its flash-liquidation callback redeems provider shares, optionally swaps the legs, approves the debt token, and returns control for Moolah to collect repayment.

Relevant source: [Moolah.sol](https://github.com/lista-dao/moolah/blob/09ab8531bad692c9227e18edc5b6079f85a5cf45/src/moolah/Moolah.sol), [V3Liquidator.sol](https://github.com/lista-dao/moolah/blob/09ab8531bad692c9227e18edc5b6079f85a5cf45/src/liquidator/V3Liquidator.sol).

## Guard/error intersection examined

### Biswap V3 legacy-pool incident screen

SlowMist's incident database reports that an old BiswapPoolV3 pool on BNB Chain lost approximately $51,000 on 2026-11-25 due to a liquidity-accounting flaw in `burn()`. DeFiLlama independently records the event as an incorrect-share/accounting incident. This makes Biswap a stronger follow-up target than a quote-only candidate, but this note does not reproduce the event or establish current exposure.

The invariant at issue is that a position's active-liquidity contribution must be removed whenever its liquidity is burned, even if token amounts returned at the current price round to zero. A withdrawal payout being zero does not imply the state transition is zero. If active liquidity remains recorded after the position accounting is removed, subsequent swaps can rely on liquidity that is no longer backed by the position's tokens. This is a confirmed incident report, not an independent finding from source/bytecode review in this pass.

Scope remains bounded to the reported legacy BiswapPoolV3 pool. The GeckoTerminal pools examined in this pass were Biswap V2 pairs; they do not establish that current Biswap V3 pools use the affected implementation. Next defensive checks are to identify active Biswap V3 pool implementations and versions, compare deployed runtime hashes to the reported legacy code family, and establish whether any remaining pools share the affected burn transition. Do not infer that V2 pairs or all Biswap V3 pools are affected from this incident alone.

Sources: [SlowMist incident record](https://hacked.slowmist.io/?c=ETH+DApp), [DeFiLlama Biswap incident record](https://defillama.com/protocol/biswap).

### THENA V2 stable-pool quote and execution surface

Source snapshot: `ThenafiBNB/THENA-Contracts` commit `f5bc742e1ff16c8be308a271a6a4a0e8f9e06453` (2023-06-16). GeckoTerminal's BNB registry exposes THENA V2 and THENA Fusion separately. At query time, the THENA V2 USDT/USDC pool `0x1b9a1120a17617d8ec4dc80b921a9a1c50caef7d` showed about $12.6k reserve and $35.4k 24-hour volume; GeckoTerminal reports both BSC bridged tokens at 18 decimals. This is market activity context, not proof that this pool uses the reviewed stable-pair implementation or that its bytecode matches this repository.

`contracts/APIHelper/TradeHelper.sol:getAmountInStable` normalizes `amountOut` and both reserves using the respective token decimals, then converts the normalized input delta back into raw input units using `decimalsOut`. That final conversion should use `decimalsIn`. For a stable pool with unlike token decimals, the estimate is scaled by `10^(decimalsOut-decimalsIn)` relative to the same normalized input; e.g. an 18-decimal input and 6-decimal output makes the result 10^12 too small, while the reverse direction makes it 10^12 too large. `getAmountIn` can then select this misquoted stable route over the volatile quote because it chooses the numerically smaller input.

The capitalization path is incomplete. `RouterV2` has exact-input swap entry points, while the amount-in helper is only a view quote and there is no matching exact-output swap entry point in this source snapshot. A frontend or integration that turns the returned estimate into an exact-input order could mis-size the trade; a meaningful `amountOutMin` should make underfilled execution revert. A permissive minimum can let a user receive less value than intended, but the quote bug alone does not redirect the shortfall to a particular attacker. The high-quote direction can also make a client overstate required input, but exact-input execution returns output for the input actually sent; no direct transfer of the quoted maximum was found.

Current classification: source-confirmed decimal-conversion defect in an off-chain-facing quote helper; deployment linkage, mismatched-decimal stable-pool exposure, actual caller dataflow, and settlement-positive loss remain unverified. The active USDT/USDC pool checked in this pass has matching 18-decimal tokens and does not exercise the mismatch. Do not infer that every THENA pool has the issue's preconditions.

Sources: [TradeHelper.sol](https://github.com/ThenafiBNB/THENA-Contracts/blob/f5bc742e1ff16c8be308a271a6a4a0e8f9e06453/contracts/APIHelper/TradeHelper.sol), [RouterV2.sol](https://github.com/ThenafiBNB/THENA-Contracts/blob/f5bc742e1ff16c8be308a271a6a4a0e8f9e06453/contracts/RouterV2.sol), [GeckoTerminal THENA pools](https://api.geckoterminal.com/api/v2/networks/bsc/dexes/thena/pools), [GeckoTerminal USDT/USDC pool](https://api.geckoterminal.com/api/v2/networks/bsc/pools/0x1b9a1120a17617d8ec4dc80b921a9a1c50caef7d?include=base_token,quote_token).

### Regression-described composition, mitigated in inspected source

An earlier V3Provider deposit sequence sent an unused WBNB refund to the depositor before minting the new shares. A native-BNB receive callback could then read adapter NAV after liquidity had increased while `totalSupply` was still old, and reenter Moolah borrowing against pre-existing collateral during that inconsistent price window. The Moolah borrow path was not yet entered by the outer deposit, so its lock did not protect this callback window.

The current source sends first-deposit adapter refunds to the provider, mints and supplies shares, then forwards the refund. Its regression `test/provider/V3ProviderReentrancyPoC.t.sol` asserts that the price observed during the callback equals the settled price and that the position remains healthy. The test comments describe the old ordering and claim a pre-fix reproduction, but I have not executed the regression or independently reproduced the historical revision. This is therefore a source-documented prior candidate with an apparent current mitigation, not a confirmed live or historical finding from this pass.

Source/test: [V3Provider.sol](https://github.com/lista-dao/moolah/blob/09ab8531bad692c9227e18edc5b6079f85a5cf45/src/provider/v3/V3Provider.sol), [V3ProviderReentrancyPoC.t.sol](https://github.com/lista-dao/moolah/blob/09ab8531bad692c9227e18edc5b6079f85a5cf45/test/provider/V3ProviderReentrancyPoC.t.sol).

### Current V3 deposit composition boundary

Subsequent deposits bind to the spot composition while the share oracle uses a manipulation-resistant fair composition. The source calls this out and bounds the depositor's exposure with per-leg consumed-amount floors and a share floor. The existing spot-credit test says the residual is tolerance-bounded and records a self-financed manipulation cycle as unprofitable in its synthetic test setup. This is expected behavior under the chosen policy, not a confirmed issue. It leaves a concrete integration boundary to measure: whether live clients consistently use fresh previews and meaningful nonzero minima. A zero floor disables that protection by design.

Source/test: [V3ProviderSpotCreditTest.sol](https://github.com/lista-dao/moolah/blob/09ab8531bad692c9227e18edc5b6079f85a5cf45/test/provider/V3ProviderSpotCredit.t.sol).

### Other inspected range mismatch: Pancake Infinity CL and Bin quoters

The signedness issue exists in both quote directions and in both Infinity pool families, but their input guards differ:

| Layer | CL path | Bin path |
|---|---|---|
| Hook return | CL validates the hook response selector/length and prevents the before-swap specified delta from crossing the swap-mode sign. A valid after-swap unspecified delta can still make the trader's net output negative. | Bin has the same hook-return/delta model and permits a valid hook-adjusted net output to be negative. |
| Exact-input quoter input | Casts `uint128` to `int128`, then negates. Amounts `>= 2^127` change signed interpretation before the swap. | Calls `safeInt128()` before negation, rejecting values `>= 2^127`. This closes CL's input high-bit case in Bin. |
| Exact-input quoter output | Casts signed output `int128` directly to `uint128`; negative output wraps into the high unsigned range. | Same direct signed-to-unsigned cast; same negative-output wrap. |
| Exact-output quoter | Widens through `uint256` to `int256`, so the requested `uint128` is not reinterpreted as negative. It then negates the computed input as `int128` and casts to `uint128`; a positive input-side net delta can wrap. Negating `int128.min` reverts first. | Calls `safeInt128()` on the requested amount, then uses the same unchecked signed-input negation and `uint128` cast. The requested high-bit amount is rejected, but the computed positive input-side delta can still wrap. |
| Router execution | Uses checked signed-to-unsigned casts for input/output and enforces slippage and exact-output constraints. | Uses checked signed-to-unsigned casts for input/output and enforces slippage/maximum-input constraints. |
| Quote revert parser | Shared `QuoterRevert`: checks only `QuoteSwap` selector, not exact revert-data length. | Same parser. Hook failures are wrapped by the core hook caller before reaching it, so this pass did not find a way for a hook to forge a raw quote error through the callback boundary. |

The union is: (1) CL-only high-bit input reinterpretation, and (2) shared signed hook-delta reinterpretation in both quote directions and both pool families. The multihop intersection splits by implementation: CL casts the wrapped `uint128` back to `int128` unchecked, so the next hop can change encoded swap mode; Bin calls `safeInt128()` and rejects the same high-bit intermediate instead. The validation layers inspect different properties: callback shape, swap-mode preservation, signed pool-delta bounds, quote error selector, then router-side positivity and slippage. No one quoter check enforces all of those invariants together.

This is a source-confirmed quote inconsistency, but the absence of a direct Lista call is not evidence that no loss path exists. The relevant consumers include route builders, execution routers, vaults, and keepers; these must be followed separately.

### Capitalization paths and current evidence

1. **Route selection.** Pancake's developer integration guidance identifies its Routing API and Smart Router SDK as the paths for Infinity CL/Bin routes, and documents the Universal Router as the execution layer. This establishes a real quote-to-route consumer category. The published Infinity SDK example loads candidate pools and calls `InfinityRouter.getBestTrade`; it does not show a call to the affected `CLQuoter`/`BinQuoter`. The public guidance therefore does not establish that their malformed return reaches Pancake's route selection. That source linkage remains open.
2. **Same-state execution.** If the same hook-adjusted delta that becomes negative in the quoter is encountered by the standard router, its checked signed-to-unsigned conversion rejects it before settlement. The malformed high quote therefore points to a failed execution or unusable route in this direct case, not a proven transfer of pool funds. For exact-output quotes, a positive net input delta can wrap to a large `uint128`, while the router's checked conversion likewise rejects a positive input delta. The oversized maximum-input bound alone does not make the router transfer that maximum; actual settlement follows measured deltas.
3. **Quote-as-accounting input.** A separate vault, liquidation service, zap, or aggregator could turn the quote into a loss only if it treats the returned unsigned number as a credit, entitlement, collateral value, or settlement amount without independently checking the final token balance deltas. No such BNB consumer has been identified in this pass. Lista's liquidator is not that consumer: it takes externally supplied swap calldata and checks measured loan-token proceeds against repayment.
4. **Quote/execution context mismatch.** A hook or route provider could make quote and execution observe different caller context, hook data, pool state, or route composition. That is a distinct candidate from the signed cast itself. Any such case must show that execution still settles successfully and that measured value leaves a counterparty worse off; a bad quote or reverted swap by itself is not that proof.

The next evidence needed is a source-level call graph from Pancake's public route builders and any BNB vault/liquidator integrations to their quote source, followed by a local synthetic test of the specific quote-to-execution invariant. A malformed quote can still affect route ranking or make a transaction revert, but those outcomes alone do not establish a transfer loss. Until downstream accounting or a successful quote/execution divergence is demonstrated, classify this as a source-confirmed quote inconsistency with an unlinked consumer category, not as either a confirmed loss or a disproven loss path. Hook revert-data spoofing was also screened: hook failures are wrapped by the core hook caller before reaching `QuoterRevert.parseQuoteAmount`, so a hook cannot simply return its own `QuoteSwap`-selector revert as a valid quote.

Sources: [CLQuoter.sol](https://github.com/pancakeswap/infinity-periphery/blob/56a7a4f5076d57d5ed90c38a00421ecbac0d649c/src/pool-cl/lens/CLQuoter.sol), [CLRouterBase.sol](https://github.com/pancakeswap/infinity-periphery/blob/56a7a4f5076d57d5ed90c38a00421ecbac0d649c/src/pool-cl/CLRouterBase.sol), [BinQuoter.sol](https://github.com/pancakeswap/infinity-periphery/blob/56a7a4f5076d57d5ed90c38a00421ecbac0d649c/src/pool-bin/lens/BinQuoter.sol), [BinRouterBase.sol](https://github.com/pancakeswap/infinity-periphery/blob/56a7a4f5076d57d5ed90c38a00421ecbac0d649c/src/pool-bin/BinRouterBase.sol), [InfinityRouter.sol](https://github.com/pancakeswap/infinity-periphery/blob/main/src/InfinityRouter.sol), [Pancake Infinity SDK example](https://github.com/pancakeswap/smart-router-example/blob/master/src/InfinityRouterExample.tsx), [Pancake integration guidance](https://github.com/pancakeswap/pancakeswap-ai/blob/main/packages/plugins/pancakeswap-driver/skills/swap-integration/SKILL.md), [Hooks.sol](https://github.com/pancakeswap/infinity-core/blob/3c5ef1be1f71442d8bc60cc6fd11f9c677b714df/src/libraries/Hooks.sol).

## Assessment and next checks

- No current profitable loop is confirmed from this pass.
- The Lista refund/reentrancy composition is documented in a source regression and appears mitigated in the inspected source tree; neither the regression nor the historical pre-fix version has been executed here.
- The Infinity quoter mismatch has a documented route-builder consumer category, but no verified dataflow from the affected on-chain quoter into those builders and no downstream BNB settlement-loss consumer has yet been linked.
- The most useful next step is deployment linkage for Lista's live provider, adapter, oracle, Moolah, and liquidator, followed by a local BNB fork replay of the historical callback sequence and the live liquidation callback against synthetic positions. Re-read manager/BOT roles, market and pair whitelists, collateral provider registration, and implementation addresses at the fork block before interpreting results.
- Do not transfer the historical pre-fix result to current deployments without matching proxy implementation bytecode and configuration. Do not transfer the Infinity quoter observation to another hook implementation without checking the hook's permitted deltas and the consuming route.

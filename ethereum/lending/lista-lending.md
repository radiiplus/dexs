# Lista Lending — Ethereum Evidence Ledger

## Assessment status

**In progress. No findings classified.** This entry records target attribution and source identity only; market configuration, accounting paths, composition, and candidate validation are still being reviewed. Do not treat this preliminary ledger as a clean bill of health.

## Target attribution

- DeFiLlama entry: `lista-lending`, category `Lending`, chains include Ethereum. At the 2026-11-25 catalog read, global TVL was approximately `$754.1m`; this does not establish Ethereum-specific exposure.
- Official Lista Ethereum deployment registry lists Moolah at [`0xf820fB4680712CD7263a0D3D024D5b5aEA82Fd70`](https://etherscan.io/address/0xf820fB4680712CD7263a0D3D024D5b5aEA82Fd70), an EIP-1967 proxy. Blockscout resolved implementation [`0xD7C983093065E0169e955c44ab8370110231D3cf`](https://etherscan.io/address/0xD7C983093065E0169e955c44ab8370110231D3cf).
- The official Ethereum registry also lists MoolahVaults, IRMs, Liquidator/PublicLiquidator, timelocks, a lending fee recipient, oracle/validator components, market factory, providers, and liquidation helpers. Their active relationships and Ethereum market coverage remain to be enumerated before drawing conclusions.
- Official registry: [Lista Lending Ethereum contracts](https://docs.bsc.lista.org/for-developer/lista-lending/smart-contract/smart-contract-ethereum). Source repository: [`lista-dao/moolah`](https://github.com/lista-dao/moolah), inspected at current checkout `402a34a948f907a776337972a83eb5a45ea51877`.

## Source/runtime identity work completed

- The active implementation's explorer-verified main source is `src/moolah/Moolah.sol`, compiler Solidity `0.8.28`, optimizer 200, Paris EVM, `viaIR=true`, with linked `PriceLib` address `0x0dc5e31653cbdcaf0dec9e80fbc942456221953f`.
- Explorer-verified `Moolah.sol` is byte-for-byte identical to [`lista-dao/moolah` commit `48a920a86d87fd2b454f1e191b032b41ac9d258b`](https://github.com/lista-dao/moolah/blob/48a920a86d87fd2b454f1e191b032b41ac9d258b/src/moolah/Moolah.sol), dated 2025-11-27. Current repository HEAD has since changed and is not used as a substitute for the deployed version.
- Recompilation of the explorer source bundle with the reported compiler settings produced a 24,307-byte runtime, the same length as deployed code. After excluding immutable and linked-library reference regions, remaining differences were confined to the trailing CBOR metadata. The linked-library bytes still need a direct address/value check before the final source/runtime identity statement.

## Work remaining

Resolve live Moolah market IDs and active parameters at a pinned Ethereum block; map vaults, IRMs, fee routing, liquidators, brokers/providers, oracles, and timelock permissions; reconstruct supply/withdraw/borrow/repay/liquidate/flash-loan accounting; evaluate sequence and callback invariants; and run isolated fork reproduction only if a credible candidate emerges. The legacy BNB implementation and BNB state are outside this Ethereum ledger.

## DEX/Lending Composition Screen (Ethereum)

Read-only screen at Ethereum block `26,505,358` found four borrowed Moolah markets using Lista `V3SmartLP` collateral. These are exact DEX-to-lending joins, not inferred from token names alone:

| Collateral provider | Underlying pair and managed V3 pool | Loan token | Borrowed amount (raw units) | Moolah provider mapping |
|---|---|---|---:|---|
| `0x40279429cc520d3f89e9ba5b9e36b4bd58b34e7a` | USDC/USDT; pool `0xdCF7612fcA2093a607e797238f47f804eCa25728`; NFT 1, ticks `-7..20` | USDT | `170038502233` | Provider maps to collateral token |
| same | same | USDC | `367553234789` | Provider maps to collateral token |
| `0x8c7a157d2026215a8e6a97621d0db519194155fd` | USDe/USDT; pool `0x5B326A9C17Fe5502339EdEdd7A55Cc7bf29fd217`; NFT 3, ticks `-276353..-276304` | USDT | `33642511` | Provider maps to collateral token |
| same | same | USDC | `415103788` | Provider maps to collateral token |

The collateral addresses are ERC-1967 proxies whose verified implementations are `StableV3Provider`; their adapters are separate proxies named `StableV3DexAdapter`. The provider is the ERC-4626 share token, Moolah is the configured collateral holder, and the adapter owns the concentrated-liquidity position. The position/oracle/accounting boundary therefore spans Moolah, the provider, the adapter, the V3 pool, and the resilient token-price oracle. Sources: [USDC/USDT provider](https://eth.blockscout.com/address/0x40279429cc520d3f89e9ba5b9e36b4bd58b34e7a#code), [USDe/USDT provider](https://eth.blockscout.com/address/0x8c7a157d2026215a8e6a97621d0db519194155fd#code), [USDC/USDT pool](https://eth.blockscout.com/address/0xdCF7612fcA2093a607e797238f47f804eCa25728#code), [USDe/USDT pool](https://eth.blockscout.com/address/0x5B326A9C17Fe5502339EdEdd7A55Cc7bf29fd217#code).

### Candidate disposition: no public liquidation payout at the sampled state

The tempting composition is a DEX-backed collateral-share impairment followed by a Moolah liquidation bonus. The implementation and live authorization state stop that route:

- Moolah's `liquidate` checks `liquidationWhitelist[id]`; for all four markets the only listed caller was `0x2B4A0E205f17F32fA88d850Eb728bebCAEffcC2F`, the verified `V3Liquidator` proxy. The public-liquidator proxy is not on that list.
- `V3Liquidator.liquidate` and `flashLiquidate` both have `onlyRole(BOT)`. The relevant manager gates are enabled: all four `marketWhitelist[id]` reads and both `v3Providers[provider]` reads were true. The `BOT` role had exactly one member, EOA `0x08E83A96F4dA5DecC0e6E9084dDe049A3E84ca04`; no contract forwarder was found in the role set. An arbitrary caller cannot invoke either liquidation entry point.
- Moolah calls the provider liquidation hook, transfers collateral, invokes the liquidator callback, and pulls repayment inside one EVM transaction. A failed role, market, redemption, swap, or repayment check reverts the whole transaction; nesting calls does not bypass the explicit caller checks.
- `V3Provider` transfers are restricted to Moolah. The share token is not freely transferable into an unrelated lender or settlement contract, and `redeemShares` can redeem only shares held by its caller.

The smart-provider integration is a real market overlap, but its liquidation payout is keeper/role controlled at this state. The screen did not identify a permissionless DEX mutation that changes the provider's share accounting, nor a public liquidation route. **Do not count this as a vulnerability or profitable loop.** Reopen if the market whitelist, Moolah liquidator list, provider implementation, or collateral valuation path changes. This is a state-specific composition screen, not completion of the full Lista implementation review.

### Spot-composition / fair-value intersection review

The accepted operation domains are asymmetric by design: the two-token provider deposit accepts a live-composition basket (including a single leg when the managed position is one-sided), while the Moolah collateral oracle values the position using the adapter's fair price. Standard single-asset ERC-4626 `deposit`, `mint`, `withdraw`, and `redeem` entry points reject; the provider-specific two-token methods are the supported route. The DEX adapter separately rejects untracked donations from reported NAV by storing idle inventory explicitly and checking `idleTokenX <= balanceOf(adapter)` when crediting it.

For an already initialized provider, `V3ProviderLib.quoteDeposit` derives `frac` from the current `positionAmountsAt(spotSqrtPriceX96())`, mints `frac * totalSupply` shares rounded down, and consumes each corresponding token amount rounded up. Those tokens are parked as tracked idle inventory. On redemption, the provider burns shares before external transfers; the adapter first collects pending fees into idle, then removes the same `shares / totalSupply` fraction of position liquidity and idle inventory. At an unchanged spot, this makes the deposit and redemption fractions agree; integer dust is left with existing holders. `amount0Min`, `amount1Min`, and `minShares` bound the depositor's chosen execution tolerance. A caller that supplies loose or zero floors retains ordinary transaction-ordering/slippage exposure, but that does not grant another caller a balance credit or transfer from existing holders.

The first-deposit path is separate: it initializes the position at pool spot but calculates opening shares from the position's composition at the fair price. There are no prior share holders to dilute in that transition; the caller's add-liquidity amount floors and optional `minShares` bound its opening execution. For an initialized position, the fair-price mark is the minimum intrinsic token value under the same token oracle prices: the concentrated-position amount/value function is minimized when the pool price equals the external fair ratio and rises as spot moves away. The fair mark therefore does not create an over-credit that can be captured by redeeming at a manipulated spot; this conclusion depends on the two oracle prices being valid and aligned to the adapter's fair-price construction. This is the key intersection result: spot can change the basket delivered on exit, while the fair mark prevents that change from becoming a permissionless collateral overvaluation under the model's oracle assumptions.

Evidence: deployed implementation source [`StableV3Provider` / `V3Provider`](https://eth.blockscout.com/address/0xDFB4e70c850F77BEF4A632412E5E46AD81aA9eeb#code), especially the deposit, withdrawal, redemption, `totalAssets`, and disabled ERC-4626 entry points; deployed adapter implementation [`StableV3DexAdapter`](https://eth.blockscout.com/address/0x739eef86619668521783C4F65c66B40D7E4c144b#code), especially `creditIdle`, `removeLiquidity`, and `positionAmountsAt`; and the linked `V3ProviderLib` source bundle on the provider implementation page, especially `quoteDeposit` and its stated fair-value lower-bound argument. This review rejected the apparent spot/fair basis mismatch as a theft/accounting loop. It does not validate oracle correctness, an extreme depeg, off-chain keeper behavior, or the private BOT liquidation path; those remain distinct market/configuration questions.

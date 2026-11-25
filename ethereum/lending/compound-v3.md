# Compound V3 (Comet) — Ethereum USDC Market Evidence Ledger

## Assessment status

**Analyzed, no confirmed implementation defect identified** in the Ethereum USDC-base Comet market at the pinned state below. This is one market, not a conclusion about every Compound V3 market or chain. No credible candidate warranted a mutating local-fork test; no live deployment was modified.

## Target and implementation identity

- Protocol/catalog identity: Compound V3 (`compound-v3`), Ethereum USDC base market.
- Market proxy: [`0xc3d688B66703497DAA19211EEdff47f25384cdc3`](https://etherscan.io/address/0xc3d688B66703497DAA19211EEdff47f25384cdc3).
- Active implementation at block `26,492,773`: [`0x0b07565a8ef48170e15918b251ebd95109b23255`](https://etherscan.io/address/0x0b07565a8ef48170e15918b251ebd95109b23255), `CometWithExtendedAssetList`, reached through the EIP-1967 implementation slot. The older implementation address shown in some deployment material is not the active implementation at this snapshot.
- Active verified source bundle was obtained from Blockscout: 142 Solidity sources, compiler `0.8.15`, London EVM, optimizer enabled with 1 run, `viaIR=true`, no link libraries. Recompiling with active immutable values substituted produced an exact executable-runtime match: 18,599 bytes, 70 immutable references matched; only trailing CBOR metadata differed.
- Public source repository: [`compound-finance/comet`](https://github.com/compound-finance/comet), pinned review checkout commit [`f766f51583c23acc33b2a7824654ef2029a96804`](https://github.com/compound-finance/comet/tree/f766f51583c23acc33b2a7824654ef2029a96804). Its deployment directory includes historical artifacts; current asset configuration was read from the active chain and not inferred from that older JSON.
- The proxy is administered through Compound's Comet proxy/configurator system. The implementation embeds immutable governor, pause guardian, token, oracle, rate, and accounting parameters; runtime matching used those active immutable values. Configuration-changing and upgrade paths are privileged. This assessment does not treat governance compromise or malicious upgrades as permissionless implementation defects.

## Pinned state and configuration

State observations are pinned to Ethereum block `26,492,793` unless a block is stated otherwise. Calls were read-only.

- Base token: USDC (`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`); `baseScale = 1,000,000`; `baseBorrowMin = 100,000,000` raw units ($100); `targetReserves = 20,000,000,000,000` raw units ($20m).
- Governor: `0x6d903f6003cca6255D85CcA4D3B5E5146dC33925`; pause guardian: `0xbbf3f1421D886E9b2c5D716B5192aC998af2012c`; USDC price feed: `0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6`.
- The live implementation reported 13 collateral assets. Current live parameters, in asset-list order, were read from `getAssetInfo`; they are not copied from the historical deployment artifact:

| Asset | Borrow CF | Liquidation CF | Liquidation factor | Supply cap (raw units) |
|---|---:|---:|---:|---:|
| COMP | 0.50 | 0.70 | 0.75 | 100,000e18 |
| WBTC | 0.80 | 0.85 | 0.90 | 1e12 |
| WETH | 0.825 | 0.88 | 0.93 | 500,000e18 |
| UNI | 0.68 | 0.74 | 0.83 | 364,691e18 |
| LINK | 0.73 | 0.79 | 0.83 | 585,990e18 |
| wstETH | 0.82 | 0.86 | 0.91 | 75,000e18 |
| cbBTC | 0.80 | 0.85 | 0.90 | 90,000,000,000 |
| tBTC | 0 | 0.85 | 0.90 | 0 |
| weETH | 0.75 | 0.80 | 0.90 | 12,000e18 |
| deUSD | 0 | approximately 0 | 0.92 | 0 |
| sdeUSD | 0 | approximately 0 | 0.92 | 0 |
| rsETH | 0 | 0.90 | 0.95 | 0 |
| USDe | 0 | 0.94 | 0.96 | 0 |

Zero borrow CF prevents those assets from supporting new borrowing; zero supply caps prevent new supplies. Existing balances can persist. Nonzero liquidation factors and liquidation CFs on disabled assets do not create borrowing power.

At the same block, `totalSupplyBase = 357,568,911,739,192`, `totalBorrowBase = 297,402,122,014,676`, Comet USDC cash was `68,860,271,914,562`, and `getReserves()` returned `8,693,482,190,046`. The equality `cash - totalSupplyBasePresentValue + totalBorrowBasePresentValue = reserves` held exactly. Utilization was about 0.8317335. For each collateral asset, token balance held by Comet was at least its recorded aggregate user collateral; observed excesses were nonnegative, including a large sdeUSD surplus consistent with donation or rebasing behavior. A surplus is not a shortfall or an accounting deficit.

## Architecture and reachable state transitions

The market is a transparent proxy to a monolithic Comet implementation, with an extension delegate and an asset-list contract. Core storage includes aggregate supply/borrow indices, aggregate base principal totals, pause flags, per-asset collateral totals, per-user signed base principal and asset bitmap, per-user collateral balances, operator permissions, and nonces.

- `supply` / `supplyTo`: base supply repays debt first and then creates supply principal; collateral supply measures actual balance delta, increases user and aggregate collateral, checks the configured supply cap, and updates the asset bitmap.
- `withdraw` / `withdrawTo` / `withdrawFrom`: base withdrawal accrues interest, updates principal and aggregate supply/borrow, enforces minimum debt and borrow collateralization before transferring out. Collateral withdrawal decrements user and aggregate accounting, updates the bitmap, checks borrow collateralization, then transfers out.
- `transfer` / `transferFrom` and asset variants: base transfers can cross between supply and debt positions; aggregate totals follow the source/destination principal transitions. Collateral transfers move the user balance and bitmap without moving ERC-20 custody and reject a source account that becomes undercollateralized.
- `absorb`: permissionless when not paused; accrues interest, checks each account against liquidation CF, removes its recorded collateral, values collateral using liquidation factors, reduces/clears debt and accounts any deficit against protocol reserves. Absorbed collateral remains protocol-held and unaccounted as user collateral until sold or otherwise managed.
- `buyCollateral`: when reserves are below target, accepts base tokens, quotes collateral from configured oracle prices and the liquidation/storefront discount, enforces a minimum output and available collateral reserves, then transfers collateral. The function is nonreentrant.
- `withdrawReserves`: governor-only and bounded by nonnegative `getReserves()`.
- `pause`: governor or pause guardian sets supply, transfer, withdrawal, absorb, and buy flags. Other privileged paths update configuration or implementation; they are outside permissionless attack scope.
- External token transfer-in uses balance deltas, rejects failed or malformed ERC-20 return data, and collateral accounting uses the received amount. Transfer-out checks success. All configured market tokens and feeds remain external dependencies; token/oracle governance and compromised feeds are not assessed as implementation defects.

## Invariant catalogue and results

1. **Base custody and debt/supply accounting:** at a current index, `cash - presentValue(totalSupplyBase) + presentValue(totalBorrowBase)` equals protocol reserves. Deposit, repayment, borrow, withdrawal, absorb, and reserve withdrawal update the principal aggregates in the corresponding direction. The pinned state reconciled exactly.
2. **Collateral custody:** per asset, Comet-held balance must cover `totalsCollateral[asset].totalSupplyAsset`; the difference is protocol collateral reserve. Supply measures received tokens; withdraw/absorb reduce both user and aggregate accounting before transfer or internal disposition. Snapshot balances had no negative reserve.
3. **Borrow solvency:** a negative base principal is permitted only if oracle-valued collateral weighted by borrow CF covers debt. Liquidation uses the larger liquidation CF threshold; liquidation-factor discounts govern debt write-down/absorb and sale economics. The separate thresholds create a safety band, not inconsistent accounting.
4. **Asset membership:** the user bitmap is set on zero-to-nonzero collateral and cleared on nonzero-to-zero transitions, including extended-list offsets. The active list contains 13 assets, within the implementation's 24-entry bitmap representation.
5. **Atomic settlement:** state changes precede token outflow, but any failed external transfer reverts the entire EVM transaction. Supply measures actual input, and the market's nonreentrant modifiers guard state-changing paths that call token contracts.
6. **Reserve sale and reserve withdrawal:** `buyCollateral` cannot sell more than collateral surplus; reserve withdrawal cannot exceed base reserves. The storefront quote discounts based on the asset liquidation factor and applies the configured price feeds.

## Candidate review and rejected hypotheses

- **Collateral withdrawal omits interest accrual:** source comments explicitly rely on `borrowCollateralFactor < liquidateCollateralFactor`. Solvency checks use the current debt view and borrow CF, while the gap to liquidation CF gives an additional margin against index change. No path was established where the omission permits an account to pass the borrow-CF check and become immediately liquidatable solely due to skipped accrual. Classified as expected design, not a finding.
- **Collateral transfer omits interest accrual:** same margin and view-based debt treatment; a transfer cannot lower recorded aggregate collateral or increase base debt. No invariant violation identified.
- **`buyCollateral` reserve check occurs before base-token transfer:** the active USDC base token does not provide an arbitrary callback path, and the function is nonreentrant. No way was identified for the same call to alter reserves between check and settlement through the configured market assets.
- **Token callback / reentrancy:** supply, transfer, withdrawal, and collateral buy paths use the implementation's shared nonreentrancy flag. The active asset list was reviewed; no concrete callback token path bypassing this guard was found. A malicious token or compromised listing/configuration is privileged/environmental scope.
- **Absorb has no `nonReentrant` modifier:** absorb performs oracle reads and internal storage transitions but no token transfer or arbitrary state-changing callback. Oracle interfaces are invoked as view calls; a state-changing reentry cannot be made from a static context. No reentrancy candidate was substantiated.
- **Disabled assets retain liquidation parameters or collateral balances:** zero borrow CF and zero cap constrain new exposure; existing balances can remain and liquidation settings can remain relevant for cleanup. This is not by itself a solvency or custody violation.
- **sdeUSD balance exceeds recorded collateral:** excess is correctly reflected as protocol collateral reserve; no deficit or user claim over the surplus was observed.
- **Reserve arithmetic:** pinned `getReserves()` exactly reconciled with cash and indexed base liabilities. No deficit was reproduced or observed.

## Findings, severity, and validation

- Confirmed implementation defects: **0**.
- Reproduced invariant violations: **0**.
- Plausible unverified candidates: **0**.
- Local fork mutation: **not run** because source review and pinned state checks produced no credible candidate to validate. No live deployment was written to.

## Scope limits

This ledger covers the Ethereum USDC-base market implementation and a single pinned block for state characterization. It does not cover other Comet markets, other chains, account-specific adversarial sequences, governance compromise, oracle failure/manipulation outside the configured feed contract's own logic, token-level defects, front-end/integrator behavior, or historical states. A clean result here does not generalize to those scopes.

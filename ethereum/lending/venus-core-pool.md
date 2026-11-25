# Venus Core Pool — Ethereum Evidence Ledger

## Assessment status

**Analyzed, no confirmed implementation defect identified** in the Ethereum Core Pool at the pinned state below. Scope is the Ethereum Core Comptroller and its 23 registered vToken markets. Ethereum legacy Isolated Pools are explicitly excluded; Venus deployments on other chains have different implementations and are not covered. No credible candidate warranted a mutating local-fork test, and no live deployment was modified.

## Target and implementation identity

- DeFiLlama catalog entry `venus-core-pool` identifies Ethereum among its supported chains. Its global TVL observation during this review was about `$898.9m`; that number is prioritization context, not Ethereum-specific exposure or deployment proof.
- Ethereum Core Comptroller proxy: [`0x687a01ecF6d3907658f7A7c714749fAC32336D1B`](https://etherscan.io/address/0x687a01ecF6d3907658f7A7c714749fAC32336D1B). It is a BeaconProxy using Comptroller beacon [`0xAE2C3F21896c02510aA187BdA0791cDA77083708`](https://etherscan.io/address/0xAE2C3F21896c02510aA187BdA0791cDA77083708); at block `26,492,845` the beacon returned implementation [`0xC910F2B196C516253e88b2097ba5D7d5fC9fa84e`](https://etherscan.io/address/0xC910F2B196C516253e88b2097ba5D7d5fC9fa84e).
- All 23 markets use BeaconProxy vTokens through VToken beacon [`0xfc08aADC7a1A93857f6296C3fb78aBA1d286533a`](https://etherscan.io/address/0xfc08aADC7a1A93857f6296C3fb78aBA1d286533a), which returned implementation [`0x33bE30B31f07c8a2bfb705FBcE55E983c47ba864`](https://etherscan.io/address/0x33bE30B31f07c8a2bfb705FBcE55E983c47ba864). Default proxy admin: [`0x567e4cc5e085d09f66f836fa8279f38b4e5866b9`](https://etherscan.io/address/0x567e4cc5e085d09f66f836fa8279f38b4e5866b9).
- Venus documentation identifies the Ethereum deployment architecture as BeaconProxy Comptroller plus BeaconProxy VToken, and points to `isolated-pools` as its source repository. The pinned source checkout is [`VenusProtocol/isolated-pools` v4.4.0, commit `943e7db1855c8ab4a09104f1d09e2b2db0506b95`](https://github.com/VenusProtocol/isolated-pools/tree/943e7db1855c8ab4a09104f1d09e2b2db0506b95). Relevant files: [`Comptroller.sol`](https://github.com/VenusProtocol/isolated-pools/blob/943e7db1855c8ab4a09104f1d09e2b2db0506b95/contracts/Comptroller.sol), [`VToken.sol`](https://github.com/VenusProtocol/isolated-pools/blob/943e7db1855c8ab4a09104f1d09e2b2db0506b95/contracts/VToken.sol), [`ComptrollerStorage.sol`](https://github.com/VenusProtocol/isolated-pools/blob/943e7db1855c8ab4a09104f1d09e2b2db0506b95/contracts/ComptrollerStorage.sol), and [`VTokenInterfaces.sol`](https://github.com/VenusProtocol/isolated-pools/blob/943e7db1855c8ab4a09104f1d09e2b2db0506b95/contracts/VTokenInterfaces.sol).
- Explorer-verified source for the active Comptroller and VToken implementations was fully verified under Solidity `0.8.25`, optimizer 200, Paris EVM, no linked libraries. The two implementation source files were byte-for-byte identical to the pinned repository files. Compiling each verified source bundle and comparing with deployed runtime at block `26,492,845` matched all non-immutable bytes (Comptroller: 23,835 bytes, 2 immutable references; VToken: 20,424 bytes, 4 immutable references). Immutable reference regions were excluded from the equality comparison; this is not a full immutable-substituted byte-for-byte comparison.
- Current Ethereum Core market addresses and chain-specific architecture are documented in the [Venus deployment registry](https://docs-v4.venus.io/deployed-contracts/markets). Legacy Ethereum Curve, Ethena, and Liquid Staked ETH pool contracts are marked exit-only there and were not included in this Core Pool review.

## Pinned state

Read-only calls were made against Ethereum block `26,492,839` for market configuration and cash reconciliation; proxy/beacon runtime identity was checked at block `26,492,845`. The registry returned 23 markets, all with `isListed = true`. Fourteen markets had at least one action paused. Paused action codes below follow the deployed source enum: `MINT=0`, `REDEEM=1`, `BORROW=2`, `REPAY=3`, `SEIZE=4`, `LIQUIDATE=5`, `TRANSFER=6`, `ENTER_MARKET=7`, `EXIT_MARKET=8`.

| Market | Collateral factor | Liquidation threshold | Supply cap (raw) | Borrow cap (raw) | Paused actions |
|---|---:|---:|---:|---:|---|
| vWBTC_Core | 75% | 80% | 6,500,000,000 | 5,200,000,000 | — |
| vWETH_Core | 75% | 80% | 2,100e18 | 1,600e18 | — |
| vUSDC_Core | 78% | 80% | 5,000,000,000,000 | 4,000,000,000,000 | — |
| vUSDT_Core | 78% | 80% | 5,000,000,000,000 | 4,000,000,000,000 | — |
| vcrvUSD_Core | 0% | 80% | 5,000,000e18 | 4,000,000e18 | — |
| vDAI_Core | 0% | 77% | 5,000,000e18 | 4,000,000e18 | — |
| vTUSD_Core | 0% | 0% | 0 | 0 | MINT, BORROW |
| vFRAX_Core | 0% | 0% | 0 | 0 | MINT, BORROW, ENTER_MARKET |
| vsFRAX_Core | 0% | 0% | 0 | 0 | MINT, BORROW, ENTER_MARKET |
| vEIGEN_Core | 0% | 0% | 5,000,000e18 | 4,000,000e18 | BORROW |
| veBTC_Core | 0% | 72% | 0 | 0 | MINT, BORROW |
| vLBTC_Core | 73.5% | 78.5% | 6,500,000,000 | 0 | BORROW |
| vUSDS_Core | 73% | 75% | 5,000,000e18 | 4,000,000e18 | — |
| vsUSDS_Core | 73% | 75% | 4,500,000e18 | 0 | BORROW |
| vBAL_Core | 0% | 0% | 0 | 0 | MINT, BORROW |
| vyvUSDC-1_Core | 0% | 0% | 0 | 0 | MINT, BORROW, ENTER_MARKET |
| vyvUSDT-1_Core | 0% | 0% | 0 | 0 | MINT, BORROW, ENTER_MARKET |
| vyvUSDS-1_Core | 0% | 0% | 0 | 0 | MINT, BORROW, ENTER_MARKET |
| vyvWETH-1_Core | 0% | 0% | 0 | 0 | MINT, BORROW, ENTER_MARKET |
| vweETHs_Core | 70% | 75% | 2,000e18 | 0 | BORROW |
| vsUSDe_Core | 72% | 75% | 4,000,000e18 | 0 | BORROW |
| vUSDe_Core | 0% | 75% | 5,000,000e18 | 4,000,000e18 | — |
| vtBTC_Core | 75% | 78% | 65e18 | 52e18 | — |

Caps are shown in raw underlying units; `e18` is notation for multiplying by 10^18, not a decimal normalization across assets. Zero collateral factors and zero caps limit new borrowing/supply, but do not erase existing balances or by themselves imply an accounting defect. The source explicitly separates borrow collateral factor from liquidation threshold.

At the same pinned state, the Comptroller reported a 50% close factor, 110% liquidation incentive, `$100` minimum collateral threshold for ordinary liquidation, and a 100-iteration loop limit. The oracle and PoolRegistry addresses were read from the proxy. Across all 23 vTokens, `internalCash` exactly equaled the corresponding underlying token's `balanceOf(vToken)` at that block. This includes inactive/paused markets. The vUSDC market had nonzero tracked bad debt and borrow balances; bad debt is explicitly represented in VToken accounting and is not counted as ordinary borrower debt.

## Architecture and execution map

The Comptroller stores market listing, borrow collateral factors, liquidation thresholds, market membership, caps, pauses, oracle, reward distributors, and liquidation parameters. Each vToken stores ERC-20 supply balances, account borrow principal/index, aggregate borrows, reserves, `internalCash`, and bad debt. Each user enables collateral through `enterMarkets`; it is the Comptroller membership bitmap/list that determines which supplied vTokens count in liquidity checks.

- **Mint/supply:** `VToken.mint` accrues interest, calls `Comptroller.preMintHook`, checks same-block freshness, receives underlying through `_doTransferIn` (which uses actual balance delta), mints vTokens at the exchange rate, then runs verification hooks.
- **Redeem/transfer:** redeem accrues interest, checks Comptroller pause, membership and hypothetical liquidity, checks cash net of reserves, burns vTokens before transfer-out. vToken transfers run a Comptroller liquidity hook before changing user balances.
- **Borrow/repay:** borrow accrues interest, has the Comptroller update oracle prices and enforce listing, pause, borrow cap, and hypothetical account liquidity; it writes borrower and aggregate debt before sending cash. Repay measures actual received underlying, updates borrower/aggregate borrows, and runs reward/verification hooks. `borrowBehalf` and `repayBorrowBehalf` require an approved delegate.
- **Liquidation:** regular liquidation accrues both markets, refreshes user prices, requires shortfall, enforces the close factor and minimum collateral threshold, receives repayment, computes seize amount from price, liquidation incentive, and collateral exchange rate, then seizes collateral. Comptroller checks both market membership and matching Comptroller/pool identity. A separate pool-level `liquidateAccount` is for small collateralized accounts and verifies all borrower markets have zero debt after its order list.
- **Bad-debt healing:** permissionless `healAccount` is restricted to underwater accounts at or below the minimum collateral threshold and computes a repayment fraction from collateral, debt, and liquidation incentive; it seizes remaining collateral and forgives unpaid debt into per-market `badDebt`. This is an explicit loss-resolution mechanism, not a hidden borrow-accounting mutation.
- **Interest and reserves:** VToken accrual updates borrow index, aggregate borrows, and reserves; `internalCash` changes on actual measured transfers in and requested transfers out. Exchange rate uses cash, borrows, bad debt, reserves, and vToken supply. Reserve reductions are capped by stored reserves/cash and routed through the protocol share reserve. `syncCash()` is access-controlled and documented as a migration initializer, not a permissionless reconciliation function.
- **Administration:** beacon upgrades are privileged through DefaultProxyAdmin; market configuration, oracle, caps, pause controls, rate models, and access control are governance/AccessControlManager controlled. No conclusion here treats trusted-admin compromise as a permissionless defect.

## Critical invariants and assessment

1. **Underlying custody:** tracked `internalCash` must not exceed actual underlying balance absent an in-flight operation. At the pinned block, all 23 markets had exact equality. `_doTransferIn` records actual received balance delta; `_doTransferOut` decrements internal cash and a failed safe transfer reverts atomically.
2. **Market assets and liabilities:** exchange rate consistently derives from `internalCash + totalBorrows + badDebt - totalReserves` divided by vToken total supply. Borrow/repay, interest accrual, reserve movement, and bad-debt recovery update the corresponding side. Bad debt is tracked separately from `totalBorrows`, included in valuation and borrow-cap checks, and has an explicit reserve recovery callback.
3. **Account solvency:** borrowing and vToken transfer use borrow collateral factors; liquidation eligibility uses liquidation thresholds, with thresholds configured no lower than borrow factors. Borrowing also checks market listing, price availability, caps, and pause state.
4. **Liquidation settlement:** repayment is measured as actual received amount; seize value uses the same actual repayment, configured oracle prices, liquidation incentive, and collateral exchange rate. Seize hooks enforce collateral membership and same-pool identity. Transaction reverts roll back repayment and any preceding state changes if later seizure fails.
5. **Membership and pauses:** only listed markets can be entered or used in policy hooks; market-specific action pauses are checked at the associated stage. `healAccount` and batch liquidation explicitly handle accounts too small for standard liquidation instead of silently bypassing the regular threshold.

## Hypotheses reviewed and disposition

- **Underlying balance versus internal cash drift:** no drift was observed in 23 markets at the pinned block. Transfer-in accounting uses actual balance delta, and outgoing cash accounting is decremented before external transfer with transaction rollback on failure. Donations or rebases could create a surplus or deficit after the snapshot; this review did not classify such an unobserved future token behavior as a defect.
- **Bad debt could be borrowed against or disappear from solvency accounting:** borrow caps include `totalBorrows + borrowAmount + badDebt`; exchange-rate math explicitly carries bad debt; healing is an explicit path that transfers unpaid amounts into bad-debt accounting. No unauthorized debt removal or reserve-backed transfer was found.
- **`healAccount` rounding could seize collateral without repaying debt:** per-market repayment is floored from the global recovery fraction. Rounding can leave dust recorded as bad debt, but it does not increase the fraction above collateral/debt economics or let the caller redirect collateral beyond the borrower's supplied vTokens. No material invariant violation was established.
- **`liquidateAccount` bypasses close factor:** this is an intentional small-account batch path. It is bounded by minimum collateral, verifies shortfall and collateral sufficiency, and checks that every borrow is zero after the supplied liquidation orders. Insolvent small accounts are routed to `healAccount` instead.
- **Different collateral and liquidation factors:** the gap is intentional and checked by source configuration validation. It supports conservative borrowing while defining a separate liquidation threshold; it does not produce two conflicting debt ledgers.
- **`borrowBehalf` has no top-level reentrancy modifier:** unlike direct `borrow`, the delegate entry point does not set the vToken guard itself. It requires an existing user authorization and transfers the underlying only after recording the new debt. The configured Ethereum underlying set was checked; no callback-capable token path that could exploit this difference was established. Liquidation wrappers enter an internal function with the vToken reentrancy guard. This remains an implementation assumption tied to the listed asset set, not a general claim that any arbitrary underlying would be safe.
- **Beacon proxy/source mismatch:** both active beacon implementations resolve to fully verified sources. The active implementation source files match the pinned repository exactly, and compiled non-immutable runtime bytes match deployed code. Immutable regions were not substituted for the independent equality check, as stated above.

## Findings and validation

- Confirmed implementation defects: **0**.
- Reproduced invariant violations: **0**.
- Plausible unverified candidates: **0**.
- Fork mutation: **not performed** because no credible candidate remained after source/runtime and pinned-state checks. No live deployment was written to.

## Scope limits

This is one Ethereum Core Pool snapshot and the shared active implementation, not a review of the legacy Ethereum exit-only pools, other chains, other Venus products, all token/oracle internals, governance security, integrator behavior, or every historical market configuration. Configuration and beacon implementation can change; conclusions are tied to the stated addresses, source version, and observation blocks.

# Morpho Blue (Ethereum) Evidence Ledger

## Status and Scope

Status: **analyzed**. This ledger covers the Ethereum Morpho Blue singleton and its core market accounting. It does not cover Morpho Vaults, MetaMorpho curators, isolated periphery products, other chains, or individual external oracle and token implementations except where they are direct market dependencies.

## Target and Source Attribution

- Chain: Ethereum mainnet, chain ID 1. Snapshot: block `26,492,661` (2026-11-25 UTC).
- DeFiLlama catalog entry: `morpho-blue`, category Lending. Its global TVL and Ethereum TVL are prioritization data and are not used as deployment attribution.
- Official deployment documentation lists the Ethereum singleton at [`0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`](https://docs.morpho.org/developers/contracts/addresses/). The active singleton is immutable, not a proxy. The Adaptive Curve IRM used in synthetic-market validation is `0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC`.
- The official [`morpho-blue` repository](https://github.com/morpho-org/morpho-blue) was checked at commit `f8631a27a2ee76ccd63abb945014d31d9efb0aca` (2026-11-25). The singleton source is `src/Morpho.sol`, Solidity `0.8.19`.
- Blockscout reports verified, complete source for the deployed singleton, with compiler `0.8.19+commit.7dd6d404`, Paris EVM, optimizer 999999, `viaIR: true`, and no metadata bytecode hash. The fetched runtime is 15,623 bytes with Keccak-256 `0xfa259fa317198f88f5fa3c119f06c066295dbcd47d715e0a30e1bcf94c02ef8c`. The 14-file published source bundle recompiled with those settings; after replacing two immutable references with deployed values, the compiled runtime matched on-chain runtime exactly (zero compiler errors and warnings).
- Relevant implementation files: [`Morpho.sol`](https://github.com/morpho-org/morpho-blue/blob/f8631a27a2ee76ccd63abb945014d31d9efb0aca/src/Morpho.sol), [`IMorpho.sol`](https://github.com/morpho-org/morpho-blue/blob/f8631a27a2ee76ccd63abb945014d31d9efb0aca/src/interfaces/IMorpho.sol), [`SharesMathLib.sol`](https://github.com/morpho-org/morpho-blue/blob/f8631a27a2ee76ccd63abb945014d31d9efb0aca/src/libraries/SharesMathLib.sol), and [`MathLib.sol`](https://github.com/morpho-org/morpho-blue/blob/f8631a27a2ee76ccd63abb945014d31d9efb0aca/src/libraries/MathLib.sol).
- At the snapshot, the contract owner was `0xcBa28b38103307Ec8dA98377ffF9816C164f9AFa`; fee recipient was zero. The singleton has no owner-controlled upgrade path. Owner controls enabling future IRMs/LLTVs and fee parameters, but cannot disable existing IRMs or LLTVs.
- The enabled Adaptive Curve IRM and LLTV values `0.77`, `0.86`, `0.915`, and `0.945` were confirmed by calls to the deployed singleton. `0.80` was not enabled. These checks establish only configuration at the recorded state.

## Architecture and Execution Map

- Morpho is a permissionless singleton. A market is keyed by `keccak256(abi.encode(loanToken, collateralToken, oracle, irm, lltv))`; anyone can create a market when its IRM and LLTV are enabled. The singleton stores market totals and positions; loan and collateral tokens, oracle, and IRM are external dependencies.
- `Market` stores `uint128` total supply assets/shares, total borrow assets/shares, last update, and fee. A `Position` stores `uint256` supply shares and `uint128` borrow shares and collateral. Events expose market and position transitions, while `market()` and `position()` expose current accounting.
- Supply: accrue interest, convert asset input to supply shares rounded down (or shares to assets rounded up), update position and market totals, call the optional supply callback, then pull loan tokens.
- Withdraw: accrue, convert assets to shares rounded up (or shares to assets rounded down), debit supply claims, require total borrow assets not to exceed total supply assets, then transfer loan tokens.
- Borrow: accrue, convert assets to borrow shares rounded up (or shares to assets rounded down), increase borrower and market debt, check collateral health using the external oracle, check market liquidity, then transfer loan tokens.
- Repay: accrue, convert asset input to shares rounded down (or share input to assets rounded up), debit borrower and market shares, floor-subtract the asset total, call the optional repay callback, then pull loan tokens. A share repayment can request one more asset unit than current aggregate borrow assets; the implementation explicitly documents and handles this with `zeroFloorSub`.
- Collateral supply increments the collateral position before callback and transfer. Collateral withdrawal accrues, reduces collateral, checks health, and transfers collateral. Liquidation accrues, computes debt and collateral conversions, updates borrower and market debt/collateral, handles bad debt if collateral is exhausted, transfers collateral, invokes the optional callback, then pulls repayment tokens.
- `flashLoan` transfers any token balance held by the singleton, invokes the callback, then pulls the same amount. It does not change market ledgers. Failure to repay reverts the full transaction.
- `accrueInterest` is permissionless. `_accrueInterest` calls the market IRM, adds interest to both total borrow and supply assets, mints fee shares when configured, and updates `lastUpdate`.
- Authorization and signature entrypoints allow delegated position management. The market ID and supplied parameters must match; token, IRM, and oracle assumptions documented by `IMorpho` are part of each market's security boundary.

## Critical Invariants

- For each market, supplier claims and borrower liabilities must reconcile with token assets held by the singleton, subject to documented virtual shares/assets and rounding. `totalBorrowAssets <= totalSupplyAssets` is required before lender withdrawals and new borrows.
- Position shares must convert against the same aggregate share/asset totals used by the market, with conservative rounding: supply shares floor, withdrawal shares ceil, borrow shares ceil, and repay shares floor (or repayment assets ceil for share input).
- A borrow must be collateralized under the market's external oracle and LLTV after new debt is recorded; a collateral withdrawal must preserve the same condition.
- Repayment must reduce both borrower and market borrow shares. If rounded repayment assets exceed aggregate borrow assets by one, the aggregate is floored at zero; residual shares still represent claims and must not be treated as erased debt.
- Every callback path must finish with the required token transfer or revert atomically. Flash loans must return the exact principal before transaction completion.
- Market parameters, external dependencies, and market ID must remain consistent across every operation; the singleton does not validate token behavior, oracle correctness, or IRM liveness.

## Entry-Point Inventory

- Market configuration: `createMarket`, `setFee`, `setFeeRecipient`, `enableIrm`, `enableLltv`, `setOwner`.
- Loan-side operations: `supply`, `withdraw`, `borrow`, `repay`, and `flashLoan`.
- Collateral/debt operations: `supplyCollateral`, `withdrawCollateral`, `liquidate`.
- Position authorization: `setAuthorization`, `setAuthorizationWithSig`, `incrementNonce`.
- Interest and views: `accrueInterest`, `market`, `position`, `idToMarketParams`, `extSloads`, and owner/configuration getters.
- External callbacks: supply, repay, collateral supply, liquidation, and flash-loan callbacks. Token transfers occur after accounting updates in supply/repay/collateral-supply paths; failed transfer or callback reverts those state changes.

## Findings

No confirmed implementation defect was established in the deployed singleton's reviewed accounting paths. One documented liveness risk remains unverified at the full failure boundary:

- **The documented low-borrow-share-price boundary can inflate borrow shares; terminal borrow-overflow behavior remains unverified.** `IMorpho.sol` explicitly warns that markets with fewer than `1e4` borrowed asset units can have their borrow-share price decreased by manipulation until `totalBorrowShares` becomes large enough that a new borrow's `uint128` conversion overflows. In `repay`, a share input is converted to assets rounded up, the selected shares are removed, and total borrow assets are `zeroFloorSub`tracted. A one-unit repayment can therefore reduce a tiny aggregate borrow-asset total to zero while leaving many shares; a subsequent one-unit borrow prices new shares against that near-zero asset total. The market-level impact and practical threshold depend on collateralization, token precision, initial debt distribution, and IRM behavior.
- Local validation used a Ganache fork pinned to Ethereum block `26,492,659`, the deployed singleton bytecode, synthetic loan/collateral tokens, and a synthetic oracle. A market was created with the deployed Adaptive Curve IRM and enabled LLTV `0.77`. Repeated one-share repay / one-raw-unit borrow operations increased aggregate borrow shares from `1,000,000` to `14,999,985` over three completed cycles. The next attempted borrow reverted while aggregate borrow assets were zero. The run did not reach `uint128` overflow, and the exact reverting guard was not isolated; therefore this validates share distortion only, not the documented terminal overflow condition.
- A separate zero-IRM synthetic run did not reach the cycle because its initial borrow reverted during setup. It is not used as evidence of a defect. No market using real assets was modified, and no public-chain transaction was sent.

Classification: **plausible but unverified liveness risk, explicitly documented by the implementation interface**. It is not counted as a confirmed finding. Severity is not assigned until a reproducible end-to-end transition establishes who can trigger the terminal state, whether it blocks third-party borrowing, and how existing debt can restore liveness.

## Rejected or Unconfirmed Hypotheses

- **Virtual shares alone permit free borrowing:** not established. The `1e6` virtual shares and one virtual asset mitigate empty-market share inflation; a concrete token flow and health check must still be satisfied.
- **Repayment rounding immediately erases all debt:** false as stated. The aggregate asset total can floor to zero while borrow shares remain, but those shares still participate in borrower debt conversion and subsequent borrow pricing.
- **The low-share-price warning is a confirmed market-wide DoS:** unverified. The source documents a potential overflow, but local validation stopped at 14,999,985 shares and did not establish the overflow threshold or impact on other operations.
- **External token/oracle/IRM assumptions are singleton defects:** not established. `IMorpho` explicitly requires exact-transfer, non-reentrant tokens, a correctly scaled oracle with constrained price movement, and a non-reentrant, non-reverting IRM. Violations are market integration/dependency risks and require separate assessment.
- **Permissionless flash loans bypass market accounting:** not established. The flash-loan path borrows only the singleton's present token balance and pulls the same amount back before transaction completion; it does not update market position or totals.

## Validation and Limits

- Deployed address and configuration reads were performed at block `26,492,661`; source/runtime compilation matched the active singleton after deployed immutable substitution.
- Local operation-sequence validation used the active Ethereum singleton on a local Ganache fork. Synthetic assets and oracle were deployed locally. The partial share-inflation result is reproducible; the terminal overflow candidate is not.
- No real token market was used for mutating validation. No live transactions were submitted.
- Reviewed `Morpho.sol` and core math/transfer libraries for market creation, supply, withdrawal, borrow, repay, collateral, liquidation, flash loan, authorization, and interest accrual. The local fork did not exhaustively test liquidation, callback reentrancy, or every token/IRM/oracle composition.
- The ledger does not audit curator vaults or downstream integrators. Oracle quality, token issuer controls, governance key security, and IRM availability remain external dependencies.

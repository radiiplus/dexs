# SparkLend (Ethereum) Evidence Ledger

## Status and Scope

Status: **analyzed**. Scope is SparkLend's Ethereum Pool proxy and its deployed core accounting paths, including bridge mint/backing and flash loans. This does not cover Spark Vaults, the PSM, cross-chain bridge adapters themselves, other chains, or every external oracle, token, and rate strategy.

## Target and Source Attribution

- Chain: Ethereum mainnet, chain ID 1. Snapshot: block `26,492,717` (2026-11-25 UTC).
- DeFiLlama catalog entry: `sparklend`, category Lending. Catalog values are only queue metadata.
- Spark's official [address registry](https://github.com/sparkdotfi/spark-address-registry/blob/4cb40459c100e6dfe4aaf787be0dcc6c51ce1228/src/SparkLend.sol) and [SparkLend documentation](https://docs.spark.finance/dev/sparklend/core-contracts/pooladdressesprovider) identify Pool proxy `0xC13e21B648A5Ee794902342038FF3aDAB66BE987`, PoolAddressesProvider `0x02C3eA4e34C0cBd694D2adFa2c690EECbC1793eE`, PoolConfigurator `0x542DBa469bdE58FAeE189ffB60C6b49CE60E0738`, price oracle `0x8105f69D9C41644c6A0803fDA7D03Aa70996cFD9`, and ACL Manager `0xdA135Cd78A086025BcdC87B038a1C462032b510C`. Provider reads at the snapshot returned the same Pool, Configurator, oracle, and ACL Manager.
- The proxy's EIP-1967 implementation slot points to `0x5aE329203E00f76891094DcfedD5Aca082a50e1b`; the provider-controlled proxy admin is `0x02C3eA4e34C0cBd694D2adFa2c690EECbC1793eE`. The official registry lists the same implementation.
- The active implementation is Solidity `0.8.10`, London EVM, optimizer 100,000 runs, with seven linked logic libraries. Blockscout marks the source verified but partially verified. Its 46-file source bundle compiled with the published settings to the same runtime length (21,754 bytes); after substituting the 15 immutable references, executable bytes matched. The remaining byte difference is in the trailing CBOR metadata hash. This is a normalized executable-bytecode match, not a byte-for-byte metadata match.
- The public [`sparkdotfi/sparklend-v1-core`](https://github.com/sparkdotfi/sparklend-v1-core/tree/19379b1ea206c3059ef81d2f4f79d84340956e08) repository was checked at commit `19379b1ea206c3059ef81d2f4f79d84340956e08` (2026-10-20). It is not the exact active Pool source: public `Pool.sol` has `POOL_REVISION = 0x5` and catches failed permits, while the deployed explorer source has revision `0x4` and directly invokes `permit`. Do not attribute the current deployment to the public repository head. The active Pool source is the [Blockscout-verified implementation bundle](https://eth.blockscout.com/address/0x5aE329203E00f76891094DcfedD5Aca082a50e1b?tab=contract), whose source path is `lib/sparklend-v1-core/contracts/protocol/pool/Pool.sol`.
- The official address registry lists linked logic libraries: BorrowLogic `0x68fB4530e156ED17cB849D19102892B7AF8cbeef`, BridgeLogic `0x813C6C11ac19e7E8aA4148d5C6EDF31a4a160867`, EModeLogic `0xC814B56BAaeE8574C169Cc0226C97466dab68c95`, FlashLoanLogic `0xCC3037F5aef5831730A9AcB1739D0562117314C0`, LiquidationLogic `0xC0816EFC31779C697B18B3B68f1DfBeDe313e1fA`, PoolLogic `0xD072fF8184E873a938cb15B20f2Ad5Cc1a02D8bf`, and SupplyLogic `0x4c83d30CE4D0f92A867C2006B33d9b102D29F707`.
- At the snapshot, the provider's reserve list had 20 entries: 20 active, 5 frozen, 12 borrowing-enabled, and 14 collateral-enabled. No reserve had nonzero unbacked aToken accounting. The Pool reported zero total and protocol flash-loan premium and zero bridge protocol fee at this snapshot. These are time-specific settings, not permanent protocol properties.

## Architecture and Execution Map

- The Pool proxy delegates to the active implementation; the PoolAddressesProvider supplies Pool, Configurator, oracle, and ACL dependencies. PoolConfigurator handles authorized reserve/risk configuration. ACLManager separates Pool admin and bridge roles.
- Each reserve stores configuration, liquidity and variable-debt indexes, accrued treasury claims, unbacked amount, isolation-mode debt, rates, and aToken/debt-token addresses. The aToken holds underlying liquidity and represents supplier claims; stable and variable debt tokens represent borrower liabilities.
- Supply and permit-supply update reserve state, validate the reserve and caps, update rates/accounting, mint scaled aTokens, and transfer the requested underlying amount. The deployed revision-4 permit path calls token `permit` directly; a failed permit reverts the transaction. The public revision-5 `try/catch` behavior is not active at this snapshot.
- Withdrawal computes scaled aToken burn, updates rates, burns supplier claims, transfers underlying, and validates the post-withdraw health factor and collateral bitmap.
- Borrow updates indexes, validates reserve flags, caps, rate mode, collateral/health, and liquidity, mints stable or variable debt, updates isolation-mode debt as applicable, updates rates, transfers underlying, and validates health again.
- Repayment calculates actual debt and payment, burns the selected debt token, updates rates and isolation debt, then either transfers underlying to the aToken or burns the caller's aTokens. The aToken path checks post-action health when the caller's collateral remains enabled.
- Liquidation updates debt/collateral state, applies close-factor and collateral/bonus/protocol-fee calculations, burns debt, transfers collateral, and handles bad debt when collateral is exhausted.
- FlashLoanLogic validates assets, transfers liquidity to the receiver, runs its callback, then pulls principal plus premium and updates indexes/rates. In `flashLoan`, any nonzero debt mode reaches an explicit `FLASHLOAN_INTO_BORROW_DEPRECATED` revert after the callback; transaction atomicity rolls back callback and transfer effects. `flashLoanSimple` always settles principal plus premium.
- Spark bridge path: `mintUnbacked` and `backUnbacked` are Pool entrypoints restricted by ACLManager's bridge role. `mintUnbacked` increments `unbacked`, enforces the reserve mint cap, updates rates, and mints aTokens without moving underlying. `backUnbacked` caps the amount that clears unbacked to the recorded outstanding amount, accounts the passed fee, updates the liquidity index and rates, and transfers backing plus fee from the authorized bridge.
- Additional reviewed paths include eMode, isolation mode, position-manager logic, reserve initialization/configuration, treasury accrual, reserve freeze/pause, and bridge protocol-fee configuration.

## Critical Invariants

- aToken and debt-token scaled balances must reconcile with indexed supplier claims and borrower liabilities; a reserve's outstanding unbacked amount must represent exactly those aTokens minted without underlying backing.
- Bridge minting must be role-restricted and capped; backing may reduce unbacked only by the lesser of requested backing and outstanding unbacked, while all transferred backing and fee must be reflected in cash/rate accounting.
- Borrow/repay and liquidation must move debt tokens and underlying consistently, update isolation-mode totals, and keep collateral flags and health-factor decisions aligned with indexed balances.
- Flash-loan repayment must collect principal and premium before successful transaction completion; debt-mode fallback must not leave a callback's transfers or state changes committed after its explicit revert.
- Reserve configuration, provider pointers, linked logic, and token addresses must remain consistent across the proxy's active implementation and execution paths.

## Entry-Point Inventory

- User paths: `supply`, `supplyWithPermit`, `withdraw`, `borrow`, `repay`, `repayWithPermit`, `repayWithATokens`, `swapBorrowRateMode`, `rebalanceStableBorrowRate`, `setUserUseReserveAsCollateral`, `setUserEMode`, `liquidationCall`, `flashLoan`, and `flashLoanSimple`.
- Bridge paths: `mintUnbacked` and `backUnbacked` (bridge-role only).
- Token callback path: `finalizeTransfer`, restricted to the reserve's configured aToken, validates collateral transfer consequences.
- Admin paths: Configurator-gated reserve initialization/configuration and Pool premium/bridge-fee settings; ACL-managed bridge and admin roles; provider-controlled implementation and address changes.
- Read paths: reserve/user data, reserve list, configuration, indexes, caps, deficits, bridge fee, and flash-loan premiums.

## Findings

No confirmed implementation defect was established in the active revision-4 Pool, linked logic flows reviewed, or sampled reserve state.

- All bridge mint/backing transitions were traced. `mintUnbacked` requires the bridge role, enforces `unbacked <= unbackedMintCap * 10**decimals`, and makes the accounting increment and aToken mint atomically. `backUnbacked` clears at most outstanding unbacked, adds only `backingAmount + fee` to liquidity/rate accounting, pulls that same amount, and reverts atomically on transfer failure. No nonzero outstanding unbacked reserve amount was observed at block `26,492,717`.
- The flash-loan legacy debt-mode branch is intentionally disabled. It invokes the receiver callback before the mode check, but the subsequent revert rolls back the entire transaction, including the underlying transfer and callback effects. This was assessed from source and EVM transaction rollback semantics; no live transaction was sent.
- `validateUseAsCollateral` returns false when reserve LTV is zero. Thus an asset with a nonzero liquidation threshold but zero LTV cannot be newly enabled as borrowing collateral through this path. This avoids treating a zero-LTV balance as borrowing capacity.
- The reserve snapshot was heterogeneous; all 20 were active, 5 frozen, 12 borrowing-enabled, and 14 collateral-enabled. Frozen means some new actions are restricted, while existing balances remain subject to withdraw/repay/liquidation paths; reserve membership alone does not imply a user operation is available.
- Underlying token transfer-tax, rebase, callback, and issuer-upgrade behavior remain token-specific assumptions. The Pool accounts nominal amounts and relies on supported assets moving the requested amounts.

## Rejected Hypotheses

- **Unbacked aTokens are permissionlessly mintable:** disproven by `onlyBridge` and the ACLManager bridge-role check; reserve cap validation also applies.
- **A bridge can clear more unbacked than exists:** disproven by `backingAmount = min(amount, reserve.unbacked)` followed by a matching decrement and input transfer for backing plus explicit fee.
- **Flashloan debt mode leaves a debt position without settlement:** disproven in the deployed flow; it reverts after callback, rolling the full transaction back.
- **Zero-LTV reserves can still be enabled as collateral:** disproven in the reviewed validation helper, which returns false for LTV zero.
- **Current public repository head is the active Pool source:** disproven by the revision constant and `supplyWithPermit` control-flow difference. The active explorer source bundle was used for deployed execution claims.
- **Reserve cash must equal aToken total supply at a snapshot:** not a valid invariant by itself; supplier claims include accrued interest and reserve cash can be reduced by outstanding debt. Reconciliation requires debt, indexes, treasury accrual, unbacked, and reserve cash together.

## Validation and Limits

- Read-only RPC verified provider addresses and proxy implementation slot at block `26,492,698`; reserve/configuration, unbacked, and fee snapshots were read at block `26,492,717`.
- The 21,754-byte deployed Pool implementation and 46-source Blockscout bundle were compiled with the published Solidity/settings. Linked library addresses were supplied, deployed immutables substituted, and executable runtime bytes matched; only trailing metadata differed. Public repository head was separately compared and found to have a different Pool revision and permit behavior.
- Reviewed the deployed source flows for supply/withdraw, borrow/repay, aToken transfer validation, liquidation, flashloan settlement, bridge mint/backing, reserve indexes/treasury, isolation/eMode, and configuration authorization. No candidate required a state-mutating fork regression. No live transaction was submitted.
- External oracle correctness/freshness, cross-chain bridge adapter security, governance authorization, each reserve token's semantics, and downstream integrators are outside this ledger's confirmed-finding scope.

# Sui / Scallop Lending: flash-loan composition screen

## Scope and source identity

- Chain: Sui.
- Protocol surface: Scallop Lending reserve and flash-loan flow.
- Repository: [scallop-io/sui-lending-protocol](https://github.com/scallop-io/sui-lending-protocol), retrieved at commit `334e93a1232a1d9417466080ae24491be3f7b27c` (2026-03-05).
- `contracts/protocol/Move.toml` declares `published-at = 0xde5c09ad171544aa3724dc67216668c80e754860f419136a68d78504eb2e2805`; this is source metadata, not an independent bytecode match. The retrieved `main` commit and remote `mainnet` branch both resolved to `334e93a1232a1d9417466080ae24491be3f7b27c`. Deployment linkage and current upgraded package mapping remain unverified.
- This is implementation-source analysis only. No live deployment calls or state mutation were performed.

## Architecture and state transitions

- `Market` contains the reserve `BalanceBag`, per-asset `BalanceSheet` (`cash`, `debt`, `revenue`, market-coin supply), interest/risk configuration, and fee tables.
- `flash_loan::borrow_flash_loan<T>` checks protocol version, the market whitelist, and that the base asset is active, then splits the requested amount from the reserve bag and returns both a `Coin<T>` and a non-droppable `FlashLoan<T>` receipt (`sources/user/flash_loan.move:55-101`; `sources/market/reserve.move:276-309`).
- The reserve split during flash borrowing does not change the cash/debt sheet. The receipt carries loan amount and fee.
- `flash_loan::repay_flash_loan<T>` returns any excess to the transaction sender, then sends the remaining coin and receipt to the market (`sources/user/flash_loan.move:112-142`). The reserve requires repayment of at least principal plus fee, adds only the retained fee to cash and revenue, and joins the repayment coin into the bag (`sources/market/reserve.move:312-329`).
- An unconsumed `FlashLoan<T>` has no `drop` ability, so a successful PTB must consume it through repayment; a failed command rolls back the transaction's earlier state changes.
- Ordinary supply, redeem, and borrow paths also mutate the same `Market`: supply increases cash and the bag, redeem decreases cash and splits the bag, and borrow decreases cash/increases debt before splitting the bag (`sources/market/reserve.move:157-189, 211-266`; `sources/market/market.move:302-326`).

## Invariants screened

- At completed transaction boundaries, reserve bag value should reconcile to accounting cash, adjusted for outstanding borrow debt and protocol revenue according to the reserve's balance-sheet convention.
- Flash-loan principal is not debt recorded in `BalanceSheet`; its temporary absence from the bag must be restored before the receipt can be consumed.
- Flash-loan fee retained in the reserve must equal the fee encoded in the receipt; excess repayment is refunded and is not reserve revenue.
- Intermediate operations must not allow total withdrawals beyond the actual bag balance, even while the cash sheet still includes the flash-loaned principal.

## Candidate composition and result

**Status: screened and not confirmed as a defect.** The apparent discrepancy is that borrowing a flash loan reduces the actual bag while leaving `BalanceSheet.cash` unchanged. A subsequent ordinary borrow or redeem can pass a cash-sheet check using this stale intermediate cash figure. However, those paths then split the actual bag. If combined withdrawals exceed available bag value, the split aborts and Sui rolls back the PTB; if the split succeeds, final balance-sheet and bag deltas reconcile after principal repayment and fee credit. Supply before repayment likewise increments both physical reserve value and cash accounting. No sequence in the reviewed paths was found that converts the temporary difference into an under-collateralized completed state.

The receipt is type-bound to `T`, and repayment requires principal plus the receipt's fee. The public wrapper refunds excess before the market receives the coin. The reserve's repayment method is `public(friend)` and only the market calls it, so an external caller cannot consume a receipt while bypassing the user-level wrapper's refund behavior.

## Local validation

- The source compiles with Sui CLI `1.66.2`.
- The focused upstream `flash_loan_test` and `flash_loan_on_inactive_base_asset_failed_test` both fail in the test VM with `MISSING_DEPENDENCY` rooted in `std::vector` (VM verifier error 2017). The full package suite shows the same failure across unrelated tests, so this is a test framework/dependency compatibility failure and not evidence of a flash-loan invariant violation.
- No custom regression is classified as reproduced. The source-level composition was checked against the split/join and accounting transitions above; bytecode matching and a compatible local Move test runner remain open validation items.

## Other observations and rejected paths

- Nonzero flash-loan fees intentionally round up by one base unit: `floor(amount * fee_rate / 10000) + 1`; fee rate is admin-capped at 10000 (`sources/market/reserve.move:285-309`; `sources/app/app.move:438-447`). Small-loan over-rounding is an explicit minimum-fee policy, not evidence of value loss.
- The repayment event records the input coin amount before any excess refund (`sources/user/flash_loan.move:122-128`), whereas the reserve retains only principal plus the fee. This can make event `amount` differ from net reserve inflow when a caller overpays; it is an observability/indexing discrepancy, not a reserve-accounting defect.
- Repayment does not repeat the active-asset check. That preserves the ability to repay if an asset is disabled after borrowing and does not weaken the receipt's principal-plus-fee check.
- No exploitable nested-operation chain or positive settlement loop was established.

## Sources

- [Scallop source repository](https://github.com/scallop-io/sui-lending-protocol)
- [Flash-loan module](https://github.com/scallop-io/sui-lending-protocol/blob/main/contracts/protocol/sources/user/flash_loan.move)
- [Reserve accounting module](https://github.com/scallop-io/sui-lending-protocol/blob/main/contracts/protocol/sources/market/reserve.move)
- [Flash-loan tests](https://github.com/scallop-io/sui-lending-protocol/blob/main/contracts/protocol/sources/test/test_cases/flash_loan_test.move)

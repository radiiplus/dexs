# Sui / DeepBook V3: fee-settlement screen

## Scope and source identity

- Chain: Sui mainnet, source package `deepbook`.
- Upstream: [MystenLabs/deepbookv3](https://github.com/MystenLabs/deepbookv3), inspected at commit [`3230fcd`](https://github.com/MystenLabs/deepbookv3/commit/3230fcd35a1bb74544115694e37a16f5f6842466), dated 2026-11-13.
- The repository's `packages/deepbook/Published.toml` records mainnet package `0xbca0cefe720330e7bb4f2283438b68de6a0e656688db4ac90d61e71fe6151fe8`, version 9; source constant `CURRENT_VERSION` is also 9. This is source repository metadata, not an independent on-chain bytecode match.
- Architecture: shared `Pool` contains the order book, trading state, and typed-asset `Vault`; shared `BalanceManager` holds trader funds across pools. `TradeProof` authorizes the pool's balance-manager operations. A normal fill updates maker accounts, computes taker/maker obligations, and then settles against the vault.

## Candidate finding: spot referral reward is charged on top of the full taker fee

**Status:** Confirmed in the inspected source's accounting path; not reproduced in a local Move test and not independently matched against deployed bytecode in this pass. The extra debit is a source-confirmed state transition. A delegated-cap holder capturing that debit is a conditional loss scenario, not permissionless access to unrelated users' managers.

### Intended invariant

The DeepBook spot referral documentation says a portion of the trader's fees is allocated to the referrer. The spot referral design should therefore preserve:

`trader debit for fee = protocol fee + referral portion carved out of that protocol fee`

It should not increase the total debit by the referral portion after the full fee has already been settled.

### Source path

1. `OrderInfo::calculate_partial_fill_balances` computes `paid_fees` and adds the entire taker fee to `owed_balances` (`packages/deepbook/sources/book/order_info.move`, lines 318-352).
2. `State::process_create` returns those full obligations (`packages/deepbook/sources/state/state.move`, lines 156-178); `Pool::place_order_int` passes them to `Vault::settle_balance_manager` before referral processing (`packages/deepbook/sources/pool.move`, lines 2033-2053).
3. `Vault::settle_balance_manager` withdraws `balances_in - balances_out` from the trader's balance manager and joins it to the pool vault (`packages/deepbook/sources/vault/vault.move`, lines 78-100).
4. `Pool::process_referral_fees` then calculates `math::mul(order_info.paid_fees(), multiplier)` and performs a second `withdraw_with_proof` from that same balance manager into the referral reward balance (`packages/deepbook/sources/pool.move`, lines 2058-2101).

For the source test's 0.1 multiplier and `paid_fees = 150,000,000`, the protocol fee is first included in settlement and the referral bucket then receives another `15,000,000` from the balance manager. The test checks the referral bucket's increment but does not assert the trader's before/after balance (`packages/deepbook/tests/pool_tests.move`, `test_process_order_referral_ok`, around lines 4300-4335). The same test later exercises a 10x multiplier, which the inspected source accepts; public docs differ on the advertised maximum, so deployment configuration and docs version need confirmation before attaching a maximum-impact figure.

### Evidence and interpretation

- Official DeepBook spot referral docs describe rewards as a portion of trading fees allocated to the referrer: [Referrals](https://www.docs.sui.io/onchain-finance/deepbook/deepbookv3/contract-information/referral).
- DeepBook's Predict design distinguishes a different builder-code fee as an add-on and describes spot referrals as paid out of spot trading fees: [Predict design](https://www.docs.sui.io/onchain-finance/deepbook/deepbook-predict/design).
- Source directly shows full-fee vault settlement followed by a further balance-manager withdrawal. This composition is sufficient to establish the additional debit in source semantics, assuming no hidden compensating balance update (none appears in this path).
- Since the referral association is installed through `set_balance_manager_referral` and requires the manager's `TradeCap`, the referral is attached by the owner or an authorized trader-cap holder. The path does not let an arbitrary caller select a victim's referral or withdraw from an unrelated manager.
- The capability composition matters for integrations: the manager owner can mint and delegate a `TradeCap`; its holder can generate trade proofs and can also call `set_balance_manager_referral` with that cap. Since `mint_referral` is permissionless, the holder can create a referral it owns, attach it to the manager, and route the extra source-level debit there while making authorized trades. If the owner intended the cap to authorize execution only, that is a concrete principal-loss path through an over-broad capability plus the extra-charge accounting. It remains conditional on the owner having delegated the cap and on the manager holding enough balance for the second debit.
- Sui's PTB model makes the low-balance edge fail atomically: a failed second withdrawal rolls back the trade and fee settlement. This prevents partial execution, but does not undo the extra debit on a successful transaction. No callback or reentrancy assumption is needed for this composition.
- DeepBook's direct `swap_exact_quantity` creates a fresh temporary manager, so this referral state does not carry into that helper. The persistent-manager path `swap_exact_quantity_with_manager` calls `place_market_order`, so it shares the referral processing path; integrations using it must account for the same additional debit.

### Impact boundary

The manager loses an additional `paid_fees × multiplier` in the fee currency whenever the referral is active and the manager has sufficient remaining funds. The referral recipient receives that amount. A cap holder that sets a referral they control can capture the excess when the manager owner delegated this authority without intending referral management. If funds are insufficient for the second withdrawal, the Move transaction aborts atomically, so the trade and first settlement roll back. This is a conditional delegated-authority loss, not a permissionless drain or pool insolvency claim.

### Follow-up verification

- Add a local Move regression comparing the balance-manager debit with and without an attached referral, at zero, default, and maximum source-accepted multipliers; assert manager, vault, and referral balances. Include a delegated `TradeCap` setting a referral it owns, then executing a trade, plus an insufficient-balance case to establish full rollback.
- Check current mainnet package bytecode/module version and verify the pool's allowed-version state before asserting live exposure.
- Resolve the documentation/source maximum mismatch and confirm whether the higher source-accepted multiplier remains enabled in the published version.
- Remediation: allocate the referral share from the fee already received by the vault (or reduce the trader's fee obligation by the referral share) so protocol plus referral credits equal the single amount charged.

## Other DeepBook paths screened

- Flash loans return a `FlashLoan` hot-potato containing pool ID, asset type, and exact borrowed quantity. Return functions check all three and consume the object. No source-level fee omission was treated as a defect: the interface explicitly requires same-transaction exact-amount return, and a transaction cannot complete while the hot-potato remains unconsumed.
- Permissionless settled-balance withdrawal requires all owed amounts to be zero and at least one settled amount to exist. The funds are deposited into the specified `BalanceManager`; this path does not provide a caller-selected recipient.
- Quote helpers omit some execution-specific adjustments (including user stake discounts and/or EWMA penalty paths); swap functions retain minimum-output checks and Sui transaction rollback. This pass did not establish a settlement loss from that estimate/execution difference.

## Sources

- [DeepBook V3 upstream source, pinned commit](https://github.com/MystenLabs/deepbookv3/tree/3230fcd35a1bb74544115694e37a16f5f6842466/packages/deepbook)
- [DeepBook V3 mainnet package metadata](https://github.com/MystenLabs/deepbookv3/blob/3230fcd35a1bb74544115694e37a16f5f6842466/packages/deepbook/Published.toml)
- [DeepBook V3 design](https://www.docs.sui.io/onchain-finance/deepbook/deepbookv3/design)
- [DeepBook V3 referral documentation](https://www.docs.sui.io/onchain-finance/deepbook/deepbookv3/contract-information/referral)
- [Sui PTB atomicity](https://www.docs.sui.io/develop/transactions/ptbs/)
- [Sui capability-based access control guidance](https://www.docs.sui.io/develop/write-move/move-best-practices)

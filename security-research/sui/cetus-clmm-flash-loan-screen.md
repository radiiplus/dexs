# Sui / Cetus CLMM: flash-loan composition screen

## Scope and source identity

- Chain: Sui mainnet.
- Protocol surface: Cetus CLMM v15 flash loans, partner fees, and adjacent pool accounting.
- Source: [Cetus contracts tag `clmm-v15`](https://github.com/CetusProtocol/cetus-contracts/tree/clmm-v15), checkout commit `f7f62b49b74cf4da948c325f210638d73cdefac7`.
- `Published.toml` maps v15 to published package `0x260693ec785a6e6c9d81d58c7d2ff72f1288ae0fa6a9725abe05a6478b11f084`, original package ID `0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb`.
- The source README says the package was published on mainnet and source-verified with Sui CLI 1.74.1. It recorded `GlobalConfig.package_version = 14` on 2026-09-18. A read-only GraphQL query during this review returned `package_version = 15` for the official global config object, so v15 is activated according to the protocol version gate. Sui CLI 1.74.1 `verify-source` succeeded for the v15 address in `Published.toml`. A direct exact-object query showed v15's `pool` bytecode has the same zero-liquidity branch as the tagged source. A package-lineage query initially resolved to v16; that newer package was not used for the v15 conclusions.
- No live transaction was submitted. The only on-chain query was a read-only config lookup.

## Architecture and operation map

- `Pool<A,B>` owns token `Balance`s, active liquidity, current square-root price and tick, global fee-growth accumulators, protocol-fee counters, tick/position state, and reward state (`sources/pool.move`).
- `flash_loan` and `flash_loan_with_partner` require the current package version and the pool's flash-loan status flag. They return borrowed balances and a non-droppable `FlashLoanReceipt` bound to the pool ID, side, amount, fee, and partner split (`pool.move:1507-1540, 2767-2834`).
- The v15 bytecode checks tick-bitmap availability before the package version and pool flash-loan status. Its internal path rejects a pending add-liquidity state, a zero amount, or a principal larger than the selected token balance (`pool` module disassembly; source `pool.move:2767-2786`).
- The fee is calculated with ceil rounding from the pool fee tier. The protocol share is rounded up; an active LP share is credited through Q64 fee growth; a partner split is floored from the protocol share (`pool.move:2794-2808, 3017-3037`).
- Repayment checks the matching pool ID, side, exact principal plus fee, and, for partner loans, partner ID. It returns the LP/protocol remainder to pool reserves and the referral share to the partner (`pool.move:1548-1621`).
- Regular repayment rejects a nonzero partner referral. Partner repayment requires the same partner ID. In either path, the selected token balance must equal `amount + fee_amount`, and the other side must be zero and is destroyed. Wrong pool, underpayment, overpayment, wrong side, and the wrong repayment variant abort (`pool.move:1548-1621`).
- `flash_swap` is a different operation: it changes price and swap state, then returns output with a swap-payment receipt. Its repayment path requires the receipt's exact input amount. It also settles reward state at the current timestamp (`pool.move:1181-1325, 2674-2760`). A flash loan itself does not move the pool price.

## Invariants screened

- Principal leaves the pool only temporarily and must be restored with the fee before the receipt is consumed.
- Total fee allocation should reconcile: `fee = LP allocation + protocol allocation + partner allocation`.
- A fee amount assigned to a claim counter or position accumulator must be backed by the corresponding pool balance.
- A zero-liquidity condition must have a defined destination for the non-protocol fee share; that share should not silently become unowned pool balance unless this is an intentional policy.
- Failed repayment or wrong-receipt paths must abort the entire PTB, rolling back earlier pool mutations.

## Accepted and rejected input ranges

- Accepted loan principal: `1 <= amount <= balance(selected token)`. The bytecode splits exactly `amount` from that token balance and returns a zero balance of the other type.
- Fee: `ceil(amount * pool_fee_rate / 1,000,000)`. The fee is recorded in the receipt before the borrowed balance is returned.
- Accepted ordinary repayment: same pool ID, same borrowed side, and exactly `principal + fee`; other side must be zero. Partner repayment additionally requires the same partner ID and splits the receipt's referral amount to that partner.
- Rejected cases: unsupported package version, disabled flash-loan flag, unavailable tick bitmap, pending add-liquidity state, zero amount, amount above available balance, wrong pool or side, wrong repayment amount, nonzero opposite-side balance, nonzero partner fee through ordinary repayment, or mismatched partner.
- Combined PTB calls can run between borrow and repayment, but every loan receipt must be consumed. A second loan sees the already-reduced pool balance; it cannot borrow against the first loan's outstanding amount a second time. A failed later call rolls back the entire PTB.
- The specific intersection producing the reproduced allocation gap is `active liquidity = 0` while the selected token reserve is positive and flash loans are enabled. The requested principal still leaves exactly as requested; the issue is where the fee is credited, not excess output.
- `flash_swap` is a separate operation that mutates pool price and has a separate input-payment receipt. It is the surface to assess for price-sensitive composition; its behavior should not be conflated with `flash_loan`.

## Reproduced accounting edge: zero active liquidity

**Status:** The unassigned-fee behavior is reproduced locally. It is not yet a confirmed exploitable vulnerability or an attacker-profit path.

In `update_fee_growth`, Cetus computes the protocol share and LP remainder, but returns the protocol share immediately when `pool.liquidity == 0`, without increasing either global LP fee-growth accumulator (`pool.move:3017-3037`). The flash-loan receipt still requires repayment of the full fee; repayment increases the pool's token balance by that full fee, while only the protocol share is recorded in `fee_protocol_coin_*` (`pool.move:1548-1575, 2767-2834`).

The isolated Move regression used a synthetic pool with 10,000 units of each token, zero active liquidity, a 10,000/1,000,000 pool fee rate, and a 2,000/10,000 protocol share. A 1,000-unit loan accrued a 10-unit fee. After repayment, the test observed:

- pool token-A balance increased by 10;
- protocol fee counter increased by 2;
- both LP fee-growth accumulators remained zero.

Thus 8 units remain in the pool balance without a protocol-fee counter or LP fee-growth claim. The source review found no permissionless arbitrary-balance sweep: protocol collection withdraws only the tracked protocol counter (`pool.move:3047-3065`), and position fee collection pays amounts derived from recorded position fee accounting (`pool.move:908-958`). The legacy governance surplus-withdrawal entry point aborts (`pool.move:1763-1779`). No direct attacker claim or loss extraction was demonstrated.

This may be an accounting/policy gap if the intended policy promises the LP portion of flash-loan fees even when no liquidity is active. If fees are intended to accrue only to liquidity active at the fee event, the behavior may be intentional, although the retained remainder is still unassigned. Source docs do not settle that policy question.

## Composition assessment

- Sui PTBs can compose the borrow, other Move calls, and repayment atomically, but a successful transaction must consume the receipt; failed checks roll back the entire transaction.
- Partner math conserves the fee: partner referral is a fraction of the protocol share, and repayment sends that fraction to the partner while returning the rest to the pool. Partner rates are constrained below 10,000/10,000 (`partner.move:160-190, 270-305`).
- The `flash_loan` method does not change price or active liquidity. It cannot by itself create the price movement used by a price-sensitive downstream consumer. `flash_swap` does change price, but charges and records swap economics through a separate receipt path; no composed loss was established here.
- Other reviewed boundaries: zero amount is rejected; borrow amount is bounded by the pool's current token balance; receipt pool ID and repayment amount are checked; non-partner repayment rejects a nonzero referral fee; pause state is checked independently for the flash-loan operation.
- A successful loan near the `u64` limit could overflow `amount + fee_amount` during repayment and abort, but atomic rollback makes this a failed extreme-range operation rather than a persistent accounting loss.

## Local validation

- Sui CLI 1.74.1 was downloaded from the official Mysten Labs release and its SHA-256 matched the release API digest: `f6ea1f0d0bd61dcb8a3630b3e764c5373ee24e0992a87c1087858b1ec4af0481`.
- `sui client verify-source` succeeded for the exact v15 package address in `Published.toml`. I fetched v15's exact immutable package object and disassembled its `pool` module; the deployed guard and fee-allocation logic match the tagged source.
- Upstream flash-loan tests passed: `test_flash_loan`, `test_flash_loan_with_partner`, and both status-disabled cases (4 passed).
- Four focused synthetic tests passed in the temporary checkout: zero-active-liquidity allocation, principal above reserves, short repayment, and two sequential loans exceeding remaining reserves. They were added only under `/tmp/sui-cetus-contracts`; no upstream source or test file was changed.
- Total filtered run: 8 flash-loan tests passed, 0 failed.
- The reproduced effect is an accounting allocation gap. The test does not show a claim path, an attacker profit, or a currently affected pool.

## Sources

- [Cetus CLMM v15 README and deployment notes](https://github.com/CetusProtocol/cetus-contracts/blob/clmm-v15/packages/cetus_clmm/README.md)
- [Cetus pool source](https://github.com/CetusProtocol/cetus-contracts/blob/clmm-v15/packages/cetus_clmm/sources/pool.move)
- [Cetus partner source](https://github.com/CetusProtocol/cetus-contracts/blob/clmm-v15/packages/cetus_clmm/sources/partner.move)
- [Cetus flash-loan tests](https://github.com/CetusProtocol/cetus-contracts/blob/clmm-v15/packages/cetus_clmm/tests/pool_tests.move)
- [Sui GraphQL RPC documentation](https://www.docs.sui.io/develop/accessing-data/graphql/query-with-graphql)

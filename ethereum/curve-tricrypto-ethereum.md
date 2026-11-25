# Curve Tricrypto (Legacy, Ethereum) Evidence Ledger

## Target and source

- Chain: Ethereum mainnet; GeckoTerminal DEX ID `curve`.
- Sample pool: `0xd51a44d3fae010294c616388b506acda1bfaae46` (USDT/WBTC/WETH). Blockscout reports Vyper `0.2.12+commit.2c6842c`, partial source verification, and the source header `Pool for USDT/BTC/ETH or similar`.
- Public source repository: [`curvefi/curve-crypto-contract`](https://github.com/curvefi/curve-crypto-contract/tree/b7c6f49ea14d4e20ef3de601b03b508edcef765a), historical commit `b7c6f49ea14d4e20ef3de601b03b508edcef765a` (2021-08-13); the relevant [`CurveCryptoSwap.vy`](https://github.com/curvefi/curve-crypto-contract/blob/b7c6f49ea14d4e20ef3de601b03b508edcef765a/contracts/tricrypto/CurveCryptoSwap.vy) declares Vyper 0.2.12. Later repository revisions use Vyper 0.3.x and are not interchangeable. The deployed source/compiler family aligns with this historical file; exact runtime-to-commit bytecode matching was not performed. See the [verified sample pool source](https://eth.blockscout.com/address/0xd51a44d3fae010294c616388b506acda1bfaae46#code). No state-changing public interaction was performed.
- This ledger concerns the legacy three-coin CryptoSwap implementation only. StableSwap, crvUSD pools, Tricrypto-NG and other Curve pool families require separate source and invariant ledgers.

## Architecture and execution map

- The pool stores token balances, invariant `D`, packed price scales/oracles, cached virtual price, profit snapshots, ramped `A/gamma`, fee parameters, and kill/admin state. Pool and math/view/LP-token contracts are separate; the deployed pool source has fixed implementation/token/coin addresses substituted at compile time.
- `exchange` transfers input, updates internal balances and solves the CryptoSwap invariant, applies fees, checks minimum output, updates price/oracle and profit state, then transfers output. The external lock guards token interactions and state changes.
- `add_liquidity` transfers requested coins, computes invariant growth and imbalance fees, mints LP shares, and refreshes `D`/virtual price/profit state. Proportional `remove_liquidity` burns LP shares and pays each coin by pro-rata internal balance. `remove_liquidity_one_coin` computes a single-coin exit, burns LP shares, updates the state, then pays the chosen coin.
- `_claim_admin_fees` intentionally reads actual token balances ("Gulp"), recomputes `D` and virtual price, and mints fee shares from recognized profit to the configured receiver. This is also the admin fee claim entry path.
- Admin entry points ramp/stop `A` and `gamma`, commit/apply/revert parameters and ownership, change fee receiver, and kill/unkill the pool. They do not provide a public arbitrary balance withdrawal.

## Critical invariants

- Internal `balances[i]` are the pool's accounting balances; token balance changes must be synchronized through supported operations or the intentional fee-claim gulp path. Outbound transfers must not exceed the corresponding accounted balances.
- LP total supply and `D`/virtual price must move consistently across imbalanced deposits, proportional exits, single-coin exits and fee-share minting. Fees retained in the pool must not be counted as user claims twice.
- Swaps must preserve the configured CryptoSwap invariant after fees, respect coin-index bounds, and atomically reconcile input, output and updated oracle/price state.
- Fee claims must not mint more shares than the profit share allows; parameter ramps and delayed updates must remain within approved bounds.
- External token calls are guarded against reentrancy, and revert must roll back all accounting and transfer effects.

## Findings

No confirmed implementation defect was identified in the reviewed pool paths. The principal accounting paths use a dedicated internal balance array and update it alongside transfer, LP mint/burn, `D`, virtual price and oracle changes. The public interface is limited to the three fixed coins; token behavior is therefore specific to this deployment and should not be generalized to arbitrary ERC-20s.

## Candidate checks and rejected hypotheses

- **Direct token transfers desynchronize balances:** `_claim_admin_fees` explicitly gulps actual token balances and recomputes `D`/virtual price; this is a documented recovery/accounting path rather than a silent mismatch. A direct donation can alter LP accounting when gulped, but no unauthorized caller controls the fee receiver or claims the donated assets as an unbacked personal withdrawal.
- **Proportional withdrawal burns more shares than value removed:** `remove_liquidity` deliberately computes the payout with `_amount - 1` while burning `_amount`, assigning the one-unit rounding difference to remaining LPs. `D` is reduced using the same payout fraction; this favors remaining LPs by design and does not create an unpaid claim for the withdrawing user.
- **Token transfer return values are unchecked:** the fixed pool coins include USDT-style no-return behavior, so the interface intentionally does not require a boolean return. The pool still relies on the configured token addresses behaving as expected; arbitrary false-returning or fee-on-transfer token behavior is outside this pool's fixed-token configuration.
- **Price/oracle updates and ramped parameters:** reviewed `tweak_price`, ramp start/stop and pool state transitions for obvious stale-state or range mismatch. No invariant violation was established from source inspection alone.

## Validation and limitations

- The repository includes tricrypto stateful, deposit/withdraw, exchange, oracle, admin-fee, ramp and multiprecision tests at the historical source revision. They were not run: the available environment has Python 3.14 without pytest, while the repository pins an older Brownie/Vyper toolchain. No local reproduction is claimed.
- Source review used the deployed verified source metadata and matching historical repository compiler-era source. Exact deployed runtime matching, current pool state, and external router/zap integrations were not assessed. No live contract was used for vulnerability testing.

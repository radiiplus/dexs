# Defi Swap (Crypto.com, Ethereum) Evidence Ledger

## Target and source

- Chain: Ethereum mainnet; GeckoTerminal DEX ID `defi_swap`.
- Sample pool: USDC/WETH at `0x3aa370aacf4cb08c7e1e7aa8e8ff9418d73c7e0f`. Read-only `factory()` returned `0x9deb29c9a4c7a88a3c0257393b7f3335338d9a9d`, matching the Crypto.com DeFi Swap factory address listed in public ecosystem references. Blockscout identifies it as `CroDefiSwapPair` with partial verification; its ABI and Solidity source metadata align with the core repository's pair family.
- Core source: [`crypto-com/swap-contracts-core`](https://github.com/crypto-com/swap-contracts-core/tree/846f472cf8f057e1dc99c5d73f4b242a5ef41a51), commit `846f472cf8f057e1dc99c5d73f4b242a5ef41a51` (2022-08-05); relevant [`CroDefiSwapPair.sol`](https://github.com/crypto-com/swap-contracts-core/blob/846f472cf8f057e1dc99c5d73f4b242a5ef41a51/contracts/CroDefiSwapPair.sol) and [`CroDefiSwapFactory.sol`](https://github.com/crypto-com/swap-contracts-core/blob/846f472cf8f057e1dc99c5d73f4b242a5ef41a51/contracts/CroDefiSwapFactory.sol) use Solidity 0.5.16. Periphery source: [`crypto-com/swap-contracts-periphery`](https://github.com/crypto-com/swap-contracts-periphery/tree/19d1d60cac1ce8f25ac87a14b796a481d15d13a9), commit `19d1d60cac1ce8f25ac87a14b796a481d15d13a9` (2022-07-26); relevant [`CroDefiSwapRouter02.sol`](https://github.com/crypto-com/swap-contracts-periphery/blob/19d1d60cac1ce8f25ac87a14b796a481d15d13a9/contracts/CroDefiSwapRouter02.sol) uses Solidity 0.6.6. Exact deployed runtime matching and router address attribution were not established. Verified explorer source is available for the [sample pool](https://eth.blockscout.com/address/0x3aa370aacf4cb08c7e1e7aa8e8ff9418d73c7e0f#code) and [factory](https://eth.blockscout.com/address/0x9deb29c9a4c7a88a3c0257393b7f3335338d9a9d#code). No public deployment was modified.

## Architecture and execution map

- `CroDefiSwapFactory` creates deterministic pair contracts, maps both token orders to each pair, and owns fee configuration (`feeSetter`, `totalFeeBasisPoint`, `feeToBasisPoint`, `feeTo`). `CroDefiSwapPair` is an ERC-20 LP token with `uint112` reserves, cumulative prices, `kLast`, and a lock around mint, burn, swap, skim and sync.
- Pair swaps optimistically transfer output, optionally invoke `croDefiSwapCall`, read final token balances, infer actual input, enforce the fee-adjusted constant-product invariant, and update reserves. Reversion rolls back optimistic transfers and callback effects within the transaction.
- Pair mint/burn use observed balances and LP supply. `_mintFee` may mint protocol LP shares based on `sqrt(k)` growth; `kLast` is synchronized after liquidity changes. `skim` transfers balance excess over reserves; `sync` makes balances the new reserves, subject to the `uint112` limit.
- `CroDefiSwapRouter02` creates/fetches pairs, transfers input, computes paths through the library, and routes outputs. The callback interface exists on the pair but the regular router uses pre-funded pair swaps. V1 migration code is separate and was not included in the V2 pool accounting assessment.

## Invariant catalogue and reviewed paths

- A successful swap's final balances must satisfy the fee-adjusted `k` invariant against pre-swap reserves; reserve writes must equal the resulting balances and fit `uint112`.
- LP mint/burn must issue or redeem shares against balances in proportion to total supply, after any protocol-fee mint. `kLast` must represent post-liquidity-event reserves when fees are enabled.
- Pair output and callback execution must be atomic with settlement; a callback cannot make an unpaid output persist.
- Router-computed amounts, fee configuration, and core-pair fee validation must agree for exact input/output and multi-hop routes.
- Factory pair ordering, CREATE2 address derivation and periphery pair init-code hash must refer to the same pair implementation.

## Findings

No confirmed implementation defect was identified in the reviewed core and router execution paths. Swap accounting applies the factory's configured total fee to inferred actual input; output transfers/callbacks are covered by the final balance invariant and pair lock. Fee-on-transfer inputs are measured from actual balance changes, and reserve overflow is rejected by `_update` rather than silently truncated.

## Candidate checks and rejected hypotheses

- Factory constructor does not enforce `totalFeeBasisPoint <= MAX_EVER_ALLOWED_TOTAL_FEE_BASIS_POINT`, while its setter does. This is an initialization/configuration bound discrepancy, but only the factory deployer sets the constructor value; the sampled factory configuration is 30 total bps and 5 protocol bps, both within the 50-bps cap. No public user-controlled path was found to increase fee beyond the setter limit, so this was not classified as a permissionless invariant defect.
- `setFeeToBasisPoint` checks `_feeToBasisPoint >= 0` on an unsigned integer, which is tautological. The meaningful upper bound against `totalFeeBasisPoint` is present, so this does not permit a negative or excessive protocol share.
- `uint32` timestamp subtraction in `_update` wraps at the 2^32 timestamp boundary. This is intentional V2 cumulative-price arithmetic, with elapsed time represented modulo 2^32; it is not an accounting loss in token reserves.
- The `uint112` reserve bound is explicit in `_update`; mint/swap/sync revert rather than committing a truncated reserve value.
- A special `amountIn`/fee rounding mismatch was not found: pair computes actual input and validates adjusted balances, while periphery library amount formulas use the same `totalFeeBasisPoint` from the factory.

## Isolated validation and limitations

- Installed the source repository's dependencies with Node 16.20.1 and successfully compiled contracts through Waffle.
- The upstream Mocha suite did not complete: all three suite fixtures failed before test cases with `merkle-patricia-tree`'s `Callback was already called` error under the old `ethereum-waffle`/provider stack (0 passing, 3 fixture failures). This appears to be test-environment setup, so no regression results are claimed.
- Findings are scoped to the inspected source family. The pool is only partially verified, and exact runtime bytecode/source commit attribution plus deployed router configuration remain unverified.

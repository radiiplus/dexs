# Ethereum / Uniswap V2 Evidence Ledger

## Status and scope

- Chain: Ethereum, selected from the first `eth` entry returned by GeckoTerminal's `/api/v2/networks` endpoint on 2026-11-25.
- DEX: Uniswap V2, first entry returned by `/api/v2/networks/eth/dexes`.
- Scope: canonical Uniswap V2 pair/factory core and Router02 periphery source plus upstream local test suites. This is not a deployment-specific review. No public deployment was called or tested.
- Core source: `Uniswap/v2-core`, commit `6a9e7c97860676e0992f22a49665760444c1cdf5`, package version `1.0.1`, Solidity `0.5.16`.
- Periphery source: `Uniswap/v2-periphery`, commit `ed24991304291297c3b4a52818d02f46a17aa9a2`, package version `1.1.0-beta.0`, Router02 Solidity `0.6.6`. Its package pins `@uniswap/v2-core` `1.0.0` and tests use local v1 artifacts. The exact published `1.0.0` artifact was not byte-for-byte compared with the checked core `1.0.1` source.
- Direct source files: [`UniswapV2Factory.sol`](https://github.com/Uniswap/v2-core/blob/6a9e7c97860676e0992f22a49665760444c1cdf5/contracts/UniswapV2Factory.sol), [`UniswapV2Pair.sol`](https://github.com/Uniswap/v2-core/blob/6a9e7c97860676e0992f22a49665760444c1cdf5/contracts/UniswapV2Pair.sol), [`UniswapV2ERC20.sol`](https://github.com/Uniswap/v2-core/blob/6a9e7c97860676e0992f22a49665760444c1cdf5/contracts/UniswapV2ERC20.sol), [`UniswapV2Router02.sol`](https://github.com/Uniswap/v2-periphery/blob/ed24991304291297c3b4a52818d02f46a17aa9a2/contracts/UniswapV2Router02.sol), and [`UniswapV2Library.sol`](https://github.com/Uniswap/v2-periphery/blob/ed24991304291297c3b4a52818d02f46a17aa9a2/contracts/libraries/UniswapV2Library.sol).
- Architecture: factory-created CREATE2 pairs and a stateless Router02; neither pair nor router is a proxy in these repositories. Deployments, factory/router addresses, periphery constructor arguments, and deployed bytecode were not verified.

## Architecture and execution map

- `UniswapV2Factory.createPair` sorts token addresses, deploys a pair with CREATE2, initializes its token addresses once, and records both token-order mappings. Factory governance only changes `feeTo` and `feeToSetter` (`contracts/UniswapV2Factory.sol:15-48`).
- `UniswapV2Pair` stores token identities, `uint112` reserves, a wrapping `uint32` timestamp, cumulative prices, `kLast`, LP ERC-20 state, and a mutex (`contracts/UniswapV2Pair.sol:11-36`). The pair is the accounting authority; token balances are sampled at settlement boundaries.
- Router02 adds/removes liquidity, transfers user inputs, wraps/unwraps WETH, computes reserve-based quotes, and sequences pair swaps (`contracts/UniswapV2Router02.sol:33-209, 212-400`). The router does not custody LP accounting. It calls pair functions directly and pair callbacks occur only on direct `swap` calls with nonempty data.
- `UniswapV2ERC20` implements LP shares, allowances, and EIP-2612-style permit with a chain-specific EIP-712 domain (`contracts/UniswapV2ERC20.sol:10-97`).
- Pair lock protects `mint`, `burn`, `swap`, `skim`, and `sync`; a callback cannot reenter those state-changing pair paths. Token calls and callbacks occur inside the locked operation and transaction rollback reverts prior transfers/state on failure (`UniswapV2Pair.sol:31-36, 134-200`).

## Entry-point and transition inventory

- `createPair`: deploy and register a unique sorted token pair.
- `mint(to)`: read actual balances, derive deposited deltas over reserves, mint protocol fee shares if enabled, mint LP shares, then update reserves and fee baseline.
- `burn(to)`: read balances and LP shares held by the pair, mint protocol fee shares if applicable, burn pair-held LP shares, transfer pro-rata underlying amounts, reread balances, then update reserves and fee baseline.
- `swap(amount0Out, amount1Out, to, data)`: enforce nonzero output and reserve bounds; optimistically transfer outputs; optionally callback; derive actual inputs from final balances; require at least one input and fee-adjusted `k` preservation; update reserves.
- `skim(to)`: transfer balance excess over reserves without changing reserves. It reverts on a deficit due to checked subtraction.
- `sync()`: set reserves to current token balances and update cumulative prices.
- LP `transfer`, `transferFrom`, `approve`, `permit`: update share ownership/authorization; these do not change pool reserves.
- Router liquidity entrypoints: calculate optimal ratio, transfer tokens/WETH to the pair, call `mint`; removal transfers LP shares to the pair, calls `burn`, checks minimum outputs, and optionally unwraps WETH.
- Router standard swap entrypoints: calculate amounts from reserves, transfer input to the first pair, then route pair-to-pair outputs. Exact-input/exact-output variants enforce minimum output/maximum input and deadline.
- Router fee-on-transfer swap variants: derive each hop's actual input from pair balance minus reserve and check recipient balance delta on final output. These variants account for taxed transfer behavior on swaps, not all arbitrary token semantics.

## Critical invariants reviewed

1. At successful settlement, stored reserves equal the pair's observed token balances, each fitting `uint112`; otherwise `_update` reverts (`UniswapV2Pair.sol:73-86`).
2. A swap's post-transfer balances satisfy `(balance0*1000 - amount0In*3) * (balance1*1000 - amount1In*3) >= reserve0*reserve1*1000^2`; output is bounded by reserves and actual input is derived after callbacks (`UniswapV2Pair.sol:159-186`).
3. LP shares minted/burned represent proportional ownership of the balances sampled at the liquidity operation; first mint permanently locks `MINIMUM_LIQUIDITY` (`UniswapV2Pair.sol:110-157`).
4. Protocol fee shares are minted against growth in `sqrt(k)` from `kLast`, and the fee baseline is advanced on liquidity events when fee collection is on (`UniswapV2Pair.sol:89-108, 128-129, 142-154`).
5. A reverting transfer, callback, postcondition, or minimum-output check rolls the whole transaction back, so intermediate optimistic transfers do not settle without the pair invariant passing.
6. Reserves and externally visible balances may intentionally differ between transactions after direct transfers, rebases, or other token-side changes; `skim` extracts positive excess and `sync` adopts observed balances. These states are not equivalent to a settled swap or liquidity mint.

## Findings

No confirmed implementation defects found in the reviewed canonical core and Router02 paths. No candidate was sufficiently credible to warrant a custom regression test. Findings are not deployment-specific and do not generalize to forks.

### Rejected hypotheses / expected behavior

- **Direct token donations make reserves stale:** expected. `skim` and `sync` explicitly expose two reconciliation choices. A donation can be skimmed before synchronization or incorporated into reserves; this is not an unaccounted LP claim.
- **Balance deficit after a negative rebase blocks `skim`:** expected checked-subtraction behavior; `sync` can reconcile to current balances if token calls remain functional. Any resulting loss originates in token balance change, not an internal reserve subtraction bypass.
- **Flash callback observes optimistic outputs:** intended. The pair remains locked, calculates actual input from post-callback balances, and enforces the fee-adjusted product before committing reserves.
- **Fee-on-transfer token input differs from router quote:** standard Router02 swap variants assume nominal transfers; explicit supporting variants use observed deltas. Unsupported token behavior is an integration limitation, not a demonstrated canonical accounting defect.
- **Fee setting can change between liquidity events:** `kLast` is a growth baseline and is cleared when `_mintFee` next observes fees off; no fee-share inconsistency was demonstrated in reviewed transitions.
- **LP minimum shares are held at zero address:** intentional permanent-liquidity lock, not claimable supply.

## Validation

- Core upstream suite: 32 passing using Node `12.22.12`, Waffle local `MockProvider`, and the repository's Solidity `0.5.16` compiler configuration.
- Periphery upstream suite: 116 passing using Node `12.22.12`, Waffle local `MockProvider`, and the repository's Solidity `0.6.6` compiler configuration. Includes Router01/Router02, fee-on-transfer paths, flash swap examples, and oracle examples.
- Under the environment's default Node `24.22.2` and Node `22.23.4`, the legacy Waffle MockProvider setup failed before test cases with `Callback was already called`. The upstream suites ran successfully under Node 12. No repository files were changed; source and tests are in temporary clones.
- No live deployment interaction, transaction broadcast, or real-asset test was performed.
- Independent review of pair accounting, lock/callback behavior, fee baseline transitions, router hop accounting, and rollback behavior found no confirmed defect in the same source scope. This was a second source review, not an independent deployment or formal verification.

## Remediation

No code remediation is indicated by this review. For deployment-specific assurance, next verify Ethereum factory/router addresses, constructor values, pair runtime bytecode/init-code hash, and whether the GeckoTerminal `uniswap_v2` index entry maps to these canonical implementations rather than a fork.

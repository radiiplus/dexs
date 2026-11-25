# Ethereum / Uniswap V3 Evidence Ledger

## Status and scope

- Chain: Ethereum. This is the third DEX in GeckoTerminal's `/api/v2/networks/eth/dexes` listing.
- DEX: Uniswap V3, reviewed from official `Uniswap/v3-core` commit `5ea68a77cb541c6b3812df783be71ba8c081e25f` and `Uniswap/v3-periphery` commit `24ccf014fe7f81d74a14c1689d6fdf123f280e45`.
- Versions: core package `1.0.1`; periphery `1.4.4`; Solidity `0.7.6`, optimizer 800 runs, metadata bytecode hash disabled in core config.
- Scope: factory/pool state machine and relevant periphery Router/NonfungiblePositionManager source. No deployment address or deployed bytecode was verified; neither repo's checked source path is a proxy implementation.
- Core and periphery upstream test environments were installed in isolated temporary clones. A targeted core regression test and a separate Hardhat local reproduction were run with synthetic tokens only.

## Architecture and execution map

- `UniswapV3Factory` owns fee-tier/tick-spacing configuration, pool creation, and pool owner controls. Pools are CREATE2 deployed with immutable factory, sorted token addresses, fee, and tick spacing.
- `UniswapV3Pool` is the accounting authority: current square-root price/tick, active liquidity, initialized ticks and bitmap, per-position liquidity/fee growth/owed balances, global fee growth, protocol fee balances, and oracle observations (`contracts/UniswapV3Pool.sol:36-99`).
- Pool `mint`, `swap`, and `flash` optimistically update state or send assets, invoke caller callbacks, then verify the pool's token balances increased by required amounts. A lock spans all these interactions (`contracts/UniswapV3Pool.sol:100-124, 457-543, 596-790, 791-835`).
- Pool `burn` reduces position liquidity and records principal as owed; `collect` transfers at most the position's recorded owed amounts. Direct pool positions are keyed by caller plus tick range (`contracts/libraries/Position.sol:30-36`).
- `NonfungiblePositionManager` wraps pool positions as ERC-721 positions and mirrors liquidity, fee-growth checkpoints, and owed amounts. Decrease records principal/fees, collect reconciles fee growth and transfers owed tokens, and NFT burn requires zero liquidity and zero owed tokens (`contracts/NonfungiblePositionManager.sol:128-182, 257-382`).
- `SwapRouter` executes exact-input/exact-output paths via authenticated callbacks; intermediate exact-input outputs are held by the router, and exact-output swaps recurse through callbacks and reset the cached input amount after completion (`contracts/SwapRouter.sol:43-242`).

## Entry-point and transition inventory

- Factory: owner fee-tier enablement, `createPool`, pool lookup/enumeration, and owner transfer.
- Pool: `initialize`; observation reads/growth; `mint`, `burn`, `collect`; exact-input/exact-output `swap`; callback-settled `flash`; owner-only protocol fee configuration and collection.
- Router: exact-input and exact-output single/multi-hop swaps, callback payment, deadline and amount bounds; periphery payment helpers can unwrap WETH, sweep tokens, or refund native currency within their authorized call flow.
- NFT position manager: `mint`, `increaseLiquidity`, `decreaseLiquidity`, `collect`, NFT permit/transfer/approval, and burn-after-clear. On increase/decrease it settles the pool position's fee-growth delta against the position's pre-transition liquidity, then updates the NFT's liquidity/checkpoint.
- Settlement/rollback: failed callbacks, underpayment, slippage bounds, and failed token transfer revert the complete transaction, including intermediate optimistic token movement and storage writes.

## Critical invariants reviewed

1. Pool liquidity and tick net/gross liquidity transitions stay within `uint128` and each tick's precomputed max; `slot0.tick` and square-root price are updated consistently on initialized tick crossing.
2. Swap steps satisfy the requested amount and price limit while fee-adjusted input/output settlement is verified from post-callback balances.
3. Mint principal is paid in full before it remains committed; burn principal and accrued fees must become claimable owed balances; collect cannot transfer beyond those claims.
4. Fee growth checkpoints are settled against liquidity owned before a mint/burn delta, and NFT manager checkpoints track the corresponding pool position.
5. Protocol fee collection is bounded by recorded token amounts and owner-gated; flash loans require repayment plus the fee before the lock releases.
6. A successful full liquidity decrease followed by collect should not leave user principal in the pool without an owner claim.

## Findings

### Low severity: valid principal burn truncates owed amount to uint128

- Classification: confirmed implementation defect; reproduced invariant violation in isolated local tests. No live deployment claim is made.
- Locations: `contracts/UniswapV3Pool.sol:517-542`, especially `:532-539`; owed fields are `uint128` in `contracts/libraries/Position.sol:13-22`. The NFT path repeats the cast at `contracts/NonfungiblePositionManager.sol:273-303`.
- Preconditions: a position's valid tick range, liquidity, and current price produce a principal amount above `2^128-1` for one token; the caller burns that liquidity in a single operation.
- Before: the owner has a valid position and the pool holds its funded principal. In the reproduction, fee tier 500 (spacing 10), range `[-887270, 887270]`, and liquidity `2^100` were accepted; this is below the per-tick maximum.
- Execution: `burn` calculates full-width `uint256 amount0/amount1` via `SqrtPriceMath`, then adds `uint128(amount)` to `Position.Info.tokensOwed0/1`. Solidity 0.7 truncates the cast modulo `2^128`; no bound rejects an amount outside the owed field's range. The NFT manager also casts returned principal to `uint128` when updating its own claim.
- After: liquidity is zero, but the owed amount represents only the low 128 bits. `collect` can pay only that truncated amount. The rest remains in the pool without a position claim; the core pool has no general surplus withdrawal path.
- Reproduction values (raw token0 units): mint liquidity `1267650600228229401496703205376` (`2^100`); burn returns `23380809169431068449021845734085661901842707912683`; owed and collected are only `272362842312717300310295094291819403243`; after collect, pool retains `23380809169158705606709128433775366807550888509441` token0 units with zero position liquidity.
- Root cause: accepted amount range is `uint256`, while the accounting claim is `uint128`, without a checked narrowing conversion or a bounded burn amount.
- Remediation: prevent principal claims from exceeding representable owed storage, or store owed principal in a wider type. A checked cast alone would revert and prevent this burn; any API-level split strategy must ensure a caller can withdraw accrued amounts between bounded burns and still unwind all liquidity.
- Impact: the affected LP can permanently lose the unrecorded portion of their own principal. No third-party extraction path was demonstrated. This is a narrow extreme-price/high-raw-unit boundary, so severity is low.

## Validation and independent review

- Upstream V3 core suite: `959 passing`, `20 pending`. Installed with Node `12.22.12`; compilation succeeded. The suite was run before adding the targeted regression test.
- Targeted regression: `test/PrincipalOwedWidthBoundary.spec.ts`, 1 passing. It mints max-valid one-tick liquidity at `MIN_SQRT_RATIO`, burns fully, asserts the principal exceeds uint128, checks owed modulo `2^128`, and verifies unclaimable pool balance remains after collect.
- Independent reproduction: `scripts/repro-burn-uint128.js` ran on local Hardhat and reproduced the before/after amounts recorded above.
- Upstream periphery tests: Solidity compilation succeeded, but the suite did not start because TypeScript could not resolve generated `../typechain` imports in `test/Base64.spec.ts`. No periphery test cases ran. The core pool accounting defect is directly reproduced; the NFT manager's matching cast was source-reviewed, not separately exercised end-to-end.
- Independent reviewer separately verified the range/liquidity bounds, the narrowing cast, and the local state transition. No confirmed defect was found in the reviewed swap callback settlement, flash accounting, fee checkpoints, or NFT ownership authorization paths.
- No live deployment interaction, transaction broadcast, or real-asset test was performed.

## Rejected hypotheses / expected behavior

- **Maximum liquidity per tick bounds amount owed to uint128:** disproven. It bounds gross liquidity, not the token amount represented by liquidity at an extreme square-root price. The local valid `2^100` case is below the fee-500 max tick liquidity and still exceeds uint128 principal.
- **NFT manager bookkeeping prevents the pool truncation:** disproven in source; `decreaseLiquidity` repeats the narrowing cast after calling pool `burn`.
- **Fee growth accrued after a liquidity transition is misattributed:** the reviewed manager computes the delta against old position liquidity before applying the transition; no violation reproduced.
- **Optimistic swap/flash transfers can settle without repayment:** callbacks execute while the pool lock is held and balance checks revert the complete operation when payment is short.

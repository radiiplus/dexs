# SushiSwap V3 (Ethereum) Evidence Ledger

## Target and Source Attribution

- Chain: Ethereum mainnet; GeckoTerminal DEX ID `sushiswap-v3-ethereum`.
- GeckoTerminal listed 20 pools on its first page on 2026-11-25. The largest sampled listing was DAI/WETH 0.3%, pool `0x769db46f39c42ee7ad5f71f4167c47edd281e767`, with about $7.45M reserve value and $1.27M 24-hour volume at the observation time.
- The sampled pool reports factory `0xbACEB8eC6b9355Dfc0269C18bac9d6E2Bdc29C4F`, token0 DAI, token1 WETH, fee 3,000 (0.3%), and tick spacing 60. Its runtime is 22,142 bytes with hash `0x957f91dfedc5212406213ae74485bd614a848cb7c729be6f9c38ed935be1f360`; deployment-specific immutables are checked separately from shared implementation bytes.
- Sourcify marks both the sampled pool and factory `match` for runtime. The compiler is Solidity `0.7.6+commit.7338295f`, optimizer 800 runs, EVM Istanbul, metadata bytecode hash disabled. Compiling the verified pool and factory sources with those settings reproduced each runtime outside the pool's immutable argument slots.
- The verified pool and factory source contents are byte-for-byte equal to the public [SushiSwap V3 core repository](https://github.com/sushiswap/v3-core/tree/21dfbed6b5e343559a14a7825e3d2f3be2611d8a) at commit `21dfbed6b5e343559a14a7825e3d2f3be2611d8a` (normalized for line endings). Relevant files: [`UniswapV3Factory.sol`](https://github.com/sushiswap/v3-core/blob/21dfbed6b5e343559a14a7825e3d2f3be2611d8a/contracts/UniswapV3Factory.sol), [`UniswapV3Pool.sol`](https://github.com/sushiswap/v3-core/blob/21dfbed6b5e343559a14a7825e3d2f3be2611d8a/contracts/UniswapV3Pool.sol), [`Position.sol`](https://github.com/sushiswap/v3-core/blob/21dfbed6b5e343559a14a7825e3d2f3be2611d8a/contracts/libraries/Position.sol), [`Tick.sol`](https://github.com/sushiswap/v3-core/blob/21dfbed6b5e343559a14a7825e3d2f3be2611d8a/contracts/libraries/Tick.sol), and [`FullMath.sol`](https://github.com/sushiswap/v3-core/blob/21dfbed6b5e343559a14a7825e3d2f3be2611d8a/contracts/libraries/FullMath.sol).
- This ledger covers the SushiSwap V3 core factory and pools only. SushiSwap V2 is a separate implementation with its own ledger. Router/NFT-manager deployment attribution and integrator use are not included in this assessment.

## Architecture and Execution Map

- `UniswapV3Factory` owns fee-tier/tick-spacing configuration, sorts token addresses, creates pools, stores both token-order lookup keys, and controls the factory owner. Pool creation deploys the pool implementation with immutable factory, tokens, fee and spacing values.
- `UniswapV3Pool` stores `slot0` price/tick/oracle/lock state, active liquidity, initialized ticks and tick bitmap, positions keyed by caller and tick range, global fee growth, protocol fee balances, and oracle observations.
- `initialize` sets the initial price once. `mint` updates position/tick liquidity and invokes the caller's mint callback, then checks actual pool balances cover required amounts. `burn` removes liquidity for the caller's position and converts principal amounts into position `tokensOwed`. `collect` pays no more than those stored owed amounts.
- `swap` walks initialized ticks, changes price/liquidity and fee-growth state under the pool lock, transfers output, calls the swap callback for input payment, and verifies the input token balance increased by the required amount before unlocking.
- `flash` transfers requested amounts under the same lock, invokes the callback, requires pre-flash balances plus rounded-up fees, and allocates paid fees between LP fee growth and protocol fee balances. `setFeeProtocol` and `collectProtocol` are factory-owner-gated.

## Critical Invariants

- Liquidity removed from a position must become a fully recorded, collectible principal claim; position liquidity can reach zero only after the associated principal is represented in owed accounting.
- Fee-growth checkpoints are computed against the position's liquidity before each mint/burn transition, and accumulated fee claims must remain representable until collection.
- Mint, swap, and flash callback operations must finish with the required token payments based on actual post-callback balances. Reverts must roll back transfers and the associated tick, position, fee, and price state.
- Swap price and tick transitions must agree with active liquidity changes and initialized tick net liquidity; protocol fees must be bounded by the collected swap/flash fees.
- `collect` must transfer at most the position's recorded owed balances. This makes the width of `tokensOwed` a critical upstream bound on how much principal `burn` may accept.

## Findings

### Low: burn principal is narrowed to uint128 before it becomes collectible

Status: **Confirmed in the source/runtime and reproduced on a local fork using the deployed Sushi factory and pool bytecode.** No exploitation or public-chain transaction was performed. No live position in an indexed real-token pool was shown to cross this boundary.

In [`UniswapV3Pool.sol` `burn`](https://github.com/sushiswap/v3-core/blob/21dfbed6b5e343559a14a7825e3d2f3be2611d8a/contracts/UniswapV3Pool.sol#L517-L543), the pool calculates principal returns as `uint256` values, then adds `uint128(amount0)` and `uint128(amount1)` to the position's owed fields. In Solidity 0.7.6 the cast truncates high bits. [`Position.Info`](https://github.com/sushiswap/v3-core/blob/21dfbed6b5e343559a14a7825e3d2f3be2611d8a/contracts/libraries/Position.sol#L15-L27) stores both claims as `uint128`, and [`collect`](https://github.com/sushiswap/v3-core/blob/21dfbed6b5e343559a14a7825e3d2f3be2611d8a/contracts/UniswapV3Pool.sol#L490-L515) caps transfers at those stored fields. The returned `uint256` burn amounts do not provide an alternative claim path.

The violated invariant is that fully burned position liquidity must retain a claim for all principal returned by the pool's burn calculation. The implementation accepts a `uint128` liquidity amount whose extreme-price raw token output can exceed `type(uint128).max`, but its owed storage and cast silently narrow that amount. After full burn, the LP position can have zero liquidity while only the low 128 bits are collectable. There is no general pool `skim` or surplus withdrawal function for the stranded difference.

The local fork test used the deployed factory to create a new local pool with a synthetic high-supply token, initialized near the minimum square-root price, then minted and burned `2^100` liquidity across the valid full tick range. The pool's tick spacing was 60 and `maxLiquidityPerTick` was `11,505,743,598,341,114,571,880,798,222,544,994`, so the position was below the configured per-tick cap. Burn returned `23,322,433,066,825,155,941,180,678,901,280,398,067,255,600,096,860` token0 units. The position stored and collected `241,505,722,945,880,744,600,311,766,032,696,092,252`; `23,322,433,066,583,650,218,234,798,156,680,086,301,222,904,004,609` token0 units remained after collect while position liquidity was zero. The stranded balance was one raw unit above the exact cast-discarded principal, consistent with normal mint/burn rounding dust.

The triggering burn is submitted by the position owner, so this is value destruction for that LP, not an arbitrary third-party seizure. Its practical reach depends on token raw-unit scale, price, and available liquidity. The synthetic-token result confirms the source boundary but does not establish current losses or a real-token position at risk among GeckoTerminal's listed pools.

Remediation: cap each principal amount before adding it to `tokensOwed` and require users to collect/split burns before the claim would exceed `uint128`, or widen owed-principal accounting. A checked cast prevents silent loss but would revert an otherwise valid burn; wrappers must also preserve a feasible multi-step unwind.

## Rejected Hypotheses

- **Per-tick maximum liquidity bounds principal output to uint128:** disproven by the local factory-created position; `2^100` liquidity was below `maxLiquidityPerTick` but the raw token0 output exceeded uint128 at the extreme price.
- **`burn` return values allow collecting the unrecorded amount:** disproven by state flow. `burn` returns `uint256`, but does not transfer principal; `collect` reads only `tokensOwed0/1`.
- **The local test exercised a handcrafted pool instead of deployed logic:** disproven. It created the pool through the forked Sushi V3 factory; the factory and existing sample pool were Sourcify runtime matches, recompiled from verified source, and the newly created pool matched that compiled runtime outside immutable fields.
- **Flash callback underpayment can persist state:** no bypass identified in reviewed code. `mint`, `swap`, and `flash` check post-callback balances while locked, so failed settlement reverts.

## Isolated Validation and Limits

- `sushiswap-v3-owed-width-fork.test.js` forked latest Ethereum state locally at block `26,492,276`, verified and recompiled the sampled pool and factory under Solidity 0.7.6 settings, and compared their runtime bytecode. It then created a pool through the forked factory and reproduced the principal narrowing with synthetic assets. Result: pass; the uncollectible amount remained in the local pool after full burn and collect.
- The pool used for reproduction was created only on the local fork; all assets were synthetic except a small local WETH seed where needed. No transaction was sent to Ethereum mainnet.
- Node `v24.22.2` used Ganache's JavaScript fallback because the optional µWS binary is unavailable. Deployment exposure at the extreme amount boundary for current real-token pools and any NFT-manager wrapper behavior remain outside this reproduction.

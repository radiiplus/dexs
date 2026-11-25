# WAGMI V3 (Ethereum) Evidence Ledger

## Target and Source Attribution

- Chain: Ethereum mainnet; GeckoTerminal DEX ID `wagmi-ethereum`.
- The 2026-11-25 GeckoTerminal page lists eight pools. All eight resolve through WAGMI factory `0xb9a14ee1cd3417f3acc988f61650895151abde24`; fee tiers in the set are 500, 3,000, and 10,000.
- The official [WAGMI contracts table](https://docs.popsicle.finance/wagmi-1/our-tech/contracts) identifies the Ethereum `UniswapV3Factory` at that address and lists the router and associated periphery contracts.
- The factory has fully verified Blockscout source, compiler Solidity `0.7.6+commit.7338295f`, optimizer 700. The pool runtime itself is not verified by Blockscout or Sourcify. The public [Popsicle-Finance/uniswap-v3-core repository](https://github.com/Popsicle-Finance/uniswap-v3-core/tree/b2c5555d696428c40c4b236069b3528b2317f3c1) at commit `b2c5555d696428c40c4b236069b3528b2317f3c1` contains the V3 pool and position logic reviewed here: [`UniswapV3Pool.sol`](https://github.com/Popsicle-Finance/uniswap-v3-core/blob/b2c5555d696428c40c4b236069b3528b2317f3c1/contracts/UniswapV3Pool.sol#L528) and [`Position.sol`](https://github.com/Popsicle-Finance/uniswap-v3-core/blob/b2c5555d696428c40c4b236069b3528b2317f3c1/contracts/libraries/Position.sol#L15).
- Recompiling the repository pool with the factory's compiler version and optimizer setting gives equal runtime length after metadata removal. Five nibbles remain different outside immutable slots, so exact pool-source/runtime identity is not claimed. The local regression below exercises pools created by the deployed factory on a fork and confirms the behavior against its actual factory-selected pool bytecode.
- Sample GeckoTerminal pool: WETH/USDT 0.05%, `0x42e73578f175884455ee020af59ca5c355ed2278`. The local reproduction uses a newly created synthetic pool; it does not alter this or any other public pool.

## Architecture and Execution Map

- The verified `UniswapV3Factory` validates fee tiers, maps token pairs and fees to pools, and deploys each pool through its configured deployer. The public factory documentation names the router and NFT position manager as separate periphery entry points.
- A pool stores `uint128` active liquidity, tick and price state, fee growth, protocol fees, and positions keyed by owner and tick range. `mint` calls the position owner's mint callback to collect owed tokens; `burn` removes liquidity and returns principal amounts; `collect` transfers the position's recorded `tokensOwed` amounts. Swaps use a callback settlement path and verify token deltas before committing state.
- The accounting boundary is between `burn`'s `uint256` principal return values and the position's `uint128 tokensOwed0/1` fields. The periphery position manager and custom position owners ultimately rely on `collect` to withdraw amounts credited by the pool.

## Critical Invariants

- Removing a position's liquidity must convert all principal returned by the pool into a collectible claim, subject only to documented rounding.
- Position liquidity can reach zero only after all principal and accrued fees are either transferred or preserved in a claim the owner can collect.
- Mint callbacks must pay the amount computed for the position before the pool commits liquidity and tick changes.
- Swap and flash callbacks must settle all token deltas before the pool unlocks or accepts the next operation.
- Protocol fee counters, LP fee growth, and token balances must not disagree in a way that makes pool-held value ownerless.

## Findings

### Low: burn principal is narrowed before it becomes collectible

Status: **Confirmed implementation behavior and reproduced on a local Ethereum fork using a pool created by the deployed WAGMI factory.** Exact pool source/runtime identity remains partially unresolved as described above. No present-day public-pool loss at the demonstrated scale is claimed.

The repository's `UniswapV3Pool.burn` receives `uint256 amount0/amount1` from principal calculation and adds `uint128(amount0)` and `uint128(amount1)` to the position's owed fields. `Position.Info.tokensOwed0/1` and the values returned by `collect` are `uint128`. A principal amount above `2^128 - 1` therefore records only the low 128 bits. The liquidity is still removed, and `collect` can transfer no more than the narrowed claim; the excess remains in the pool without a live position claim.

The local fork test used the deployed WAGMI factory at block `26,492,419` to create a new pool for two synthetic tokens at fee 500 and tick spacing 10. The test initialized the pool at an extreme price and minted `2^100` liquidity, below `maxLiquidityPerTick = 1917569901783203986719870431555990`. After burning the full position, the pool emitted principal of `23322433066825155941180678901280398067255600096860` raw units, but the position recorded and collected `241505722945880744600311766032696092252`. The position's liquidity became zero; `23322433066583650218234798156680086301222904004609` units remained in the pool after collection, with at most one raw unit attributable to rounding.

This demonstrates permanent principal stranding for an individual position when the returned amount exceeds the owed-field width. Reaching the boundary requires extreme raw token balances; the eight GeckoTerminal-listed pools are not shown to approach it, and this review did not establish a live pool or position with such balances. No flash loan is needed for the accounting failure, and no real token or live pool was used in reproduction.

Remediation: keep principal claims full-width or explicitly reject any burn whose principal cannot be represented before changing position liquidity. Add a regression around `2^128 - 1` and `2^128` for both token sides.

## Rejected Hypotheses

- **Per-tick liquidity cap blocks the boundary:** disproven. The reproduced `2^100` liquidity is below the fee-500 pool's per-tick cap; the limit applies to liquidity, not raw token principal.
- **The V3 pool can use `skim` to return unclaimed principal:** disproven. The pool has no V2-style skim or sync entry point, and collection uses the position's recorded owed fields.
- **The observed remainder is only rounding:** disproven. It exceeds the one-unit rounding tolerance and equals the principal minus the narrowed claim, subject to that rounding bound.
- **The finding transfers to other V3 forks automatically:** not assumed. It is based on the WAGMI factory-created fork pool and the independently reviewed Popsicle core source; no conclusion is transferred to another DEX or chain.

## Isolated Validation and Limits

- `wagmi-v3-principal-width-fork.test.js` forks Ethereum latest, verifies all eight GeckoTerminal pools resolve to the deployed WAGMI factory, creates a synthetic fee-500 pool through that factory, mints and fully burns a high-principal position, then collects the recorded claim. Result: pass at fork block `26,492,419`; the exact amounts are reported above. No public transaction was sent.
- The repo/build comparison has five unmatched nibbles outside immutable slots after metadata removal. The local reproduction establishes the deployed factory's pool behavior, but exact byte-for-byte source attribution remains an open verification item. No source-level conclusion is treated as a demonstrated real-pool loss.

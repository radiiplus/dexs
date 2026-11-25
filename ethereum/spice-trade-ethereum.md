# Spice Trade (Ethereum)

## Target and source attribution

- GeckoTerminal identifier: `spice_trade_ethereum`.
- Sampled pool: USDS/USDC at `0x09e1aa056712de237468239314723bbcae548e20`.
- Read-only pool metadata identifies the pool as Spice Trade and its LP token as STLP. `token0`, `token1`, and `factory` calls returned USDS (`0x45fdb1b92a649fb6a64ef1511d3ba5bf60044838`), USDC (`0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`), and factory `0x71bcc0bf974aae8cc55d033c17d50486fc77e3ae`. The factory's `getPair(USDS, USDC)` returned the sampled pool.
- Verified factory: `UniswapV2Factory` at `0x71bcc0bf974aae8cc55d033c17d50486fc77e3ae`, Solidity 0.6.12, optimizer 200. Its verified source includes `UniswapV2Pair.sol` and deploys `type(UniswapV2Pair).creationCode` with CREATE2.
- Verified router: `UniswapV2Router02` at `0x3018234c038d524147ff47148baa8381306f28cf`, Solidity 0.6.12, optimizer 200. Its `factory()` getter returns the factory above and `WETH()` returns canonical Ethereum WETH.
- The project's public source repository is [`spicetradeai/contracts`](https://github.com/spicetradeai/contracts/tree/9cd821b51613b42a660cef72e9c0504885699019), commit `9cd821b51613b42a660cef72e9c0504885699019` (2022-05-01). It contains the collateralized stablecoin system (including [`contracts/Pool.sol`](https://github.com/spicetradeai/contracts/blob/9cd821b51613b42a660cef72e9c0504885699019/contracts/Pool.sol)) but does not contain the DEX router, factory, or pair implementation. The AMM source evidence is therefore the verified explorer source linked below, not a claim that those AMM files exist in the GitHub repository.
- The pair is not independently marked source-verified by Blockscout. Attribution to the verified pair source is supported by the pair's reported factory creator, the factory's mapping returning this pair, and the verified factory's CREATE2 deployment of its embedded `UniswapV2Pair` creation code. The router's compiled pair-init-code hash derives this sampled address from the factory and token addresses. This is an implementation attribution based on public metadata and source; no state-changing call was made.

## Architecture and state transitions

- The factory sorts token addresses, rejects duplicate pairs, deploys and initializes the pair with CREATE2, records both token orderings, and assigns the current `defaultFee` to the new pair. `feeTo`, `feeToSetter`, the default fee, and individual pair fees are factory state.
- The router computes deterministic pair addresses, obtains reserves, quotes exact-input or exact-output routes, transfers input, and invokes each pair's `swap`. It has fee-on-transfer token paths that measure actual pair input and verify the recipient's output balance delta.
- Each pair stores ERC-20 LP supply, `uint112` reserves, cumulative prices, `kLast`, and a lock. `mint`/`burn` use token balance deltas or observed balances; `swap` optimistically transfers outputs, supports the Uniswap V2 callback, then validates adjusted balances against the reserve product before reserve synchronization. `skim` transfers balances above reserves and `sync` adopts current balances.
- On a pool creation, the factory sets a per-pair fee. At the time of the read-only configuration check, `defaultFee` and this pair's fee were both `2` against a `1000` denominator (0.2%); `feeTo` was nonzero. The factory owner can change these values within `MAX_FEE = 50` (5%). These values are a snapshot, not a guarantee about future configuration.

## Entry points and invariants reviewed

- Factory: `createPair`, `setFeeTo`, `setFeeToSetter`, `setDefaultFee`, `setFeeForPair`, `setFeeForPairs`, and pair enumeration/hash views.
- Router: liquidity add/remove paths, exact-input and exact-output token/ETH swaps, fee-on-transfer variants, and amount quote helpers.
- Pair: `initialize`, LP `mint`/`burn`, `swap` and callback settlement, `skim`, `sync`, and LP token operations.
- Invariants: successful mint/burn operations reconcile LP claims to balances; pair reserves match balances after completed settlement; every swap satisfies the factory-configured fee-adjusted constant-product bound; router quotes and pair settlement use the same fee basis; reserve values fit `uint112`; callback execution cannot reenter the same pair's locked state transition; failed checks roll back token transfers and storage changes.

## Findings

No confirmed implementation defect was identified in the reviewed factory, router, and pair paths. This conclusion is limited to the source attributed above and the sampled Ethereum deployment family; it does not imply a review of Spice Trade's separate collateral/oracle/token system or all possible tokens.

### Rejected hypothesis: unusual protocol-fee fraction

The pair computes protocol LP minting with denominator `rootK / 5 + rootKLast`, while a common Uniswap V2 implementation uses `rootK * 5 + rootKLast`. The source comment explicitly says this implementation intends to mint liquidity equivalent to five-sixths of `sqrt(k)` growth. Algebraically, for growth `delta = rootK - rootKLast`, the minted share of post-mint LP supply is `delta / (rootK / 5 + rootKLast + delta) = 5 * delta / (6 * rootK)`, matching that source comment. This is an intentionally different fee split in the reviewed implementation; no specification in the checked repository contradicts it, so the difference alone is not reported as a defect.

Other reviewed boundaries did not produce a credible candidate: fee inputs are bounded to 50/1000, the router and pair read the same per-pair fee, exact-output math rounds required input upward, balance deltas drive pair input accounting, and the pair rejects reserve overflow rather than truncating it.

## Validation and limitations

- No custom regression test was run because no credible defect candidate remained. The source repository's test suite exercises the stablecoin `Pool`, not this DEX pair; its Hardhat configuration also forks Polygon, so it was not invoked as a local Ethereum AMM regression suite.
- Read-only Ethereum RPC calls checked pool token ordering, factory linkage and `getPair` mapping, factory/router linkage, current fee configuration, and a router `getAmountsOut` quote for the sample pool. No live swap, transfer, deployment, or vulnerability test was performed.
- Public explorer source pages: [factory and embedded pair source](https://eth.blockscout.com/address/0x71bcc0bf974aae8cc55d033c17d50486fc77e3ae#code), [router source](https://eth.blockscout.com/address/0x3018234c038d524147ff47148baa8381306f28cf#code), and [sample pool](https://eth.blockscout.com/address/0x09e1aa056712de237468239314723bbcae548e20).
- GeckoTerminal pool record: [USDS/USDC](https://www.geckoterminal.com/eth/pools/0x09e1aa056712de237468239314723bbcae548e20).

# Solidly (Ethereum)

## Target and source attribution

- GeckoTerminal identifier: `solidlydex` on Ethereum.
- Sampled pool: LUSD/WETH at `0x6d7824c5b5b385d1dd8d56c543a0be2eaf140974`, a `SolidlyChildProxy`. Read-only calls report LUSD/WETH, `stable=false`, factory `0x777de5Fe8117cAAA7B44f396E93a401Cf5c9D4d6`, and pair `feeRatio=2000` (2000 / 1,000,000 = 0.2%). Factory `isPair` and `poolFees(sample)` agree. The GeckoTerminal top pools sampled also use this factory family.
- The pair is a child proxy. Its current `interfaceAddress` is `0x60f5a27DB4d7Fa8d88E2429B04d60459b6c87698` (`BaseV2PairInterface`) and `subImplementationAddress` is `0x95c605ef51f57d11312c5aa56b4ee7aa59224cf0` (`BaseV2Pair`). The root factory proxy currently reports implementation/interface `0x98743c29fb8c3a61492e2e776c0647e4d5e1f365`, logic `0x32fdf6916401b10ba6130d28d50b2200b680e410` (`BaseV2Factory`), and `governanceIsKilled=false`. Proxy implementation pointers are mutable by governance; these are deployment snapshots, not immutable guarantees.
- Verified deployment sources: [sample child proxy](https://eth.blockscout.com/address/0x6d7824c5b5b385d1dd8d56c543a0be2eaf140974#code), [pair interface](https://eth.blockscout.com/address/0x60f5a27DB4d7Fa8d88E2429B04d60459b6c87698#code), [pair implementation source file `contracts/SolidlyV2/BaseV2-core.sol`](https://eth.blockscout.com/address/0x95c605ef51f57d11312c5aa56b4ee7aa59224cf0#code), [root factory proxy](https://eth.blockscout.com/address/0x777de5Fe8117cAAA7B44f396E93a401Cf5c9D4d6#code), and [factory implementation source](https://eth.blockscout.com/address/0x32fdf6916401b10ba6130d28d50b2200b680e410#code). Verified source metadata reports Solidity `0.8.11`, optimizer enabled with 200 runs. The factory implementation and pair implementation are partially verified with proxy support sources; source claims are limited to the surfaced verified files and read-only pointer state.
- No matching public GitHub repository for this deployed Solidly V2 implementation was identified. The public [`velodrome-finance/solidly`](https://github.com/velodrome-finance/solidly) repository contains Base V1 code and is not attributed to this Ethereum V2 implementation. The assessment therefore uses the verified deployment sources above; no repository commit identity is claimed.
- The sample's factory currently reports `stableFees=200` (0.02%), `volatileFees=2000` (0.2%), `maxFees=30000` (3%), and `isPaused=false`. The sample is volatile and its cached pair fee matches the factory's current fee. These are read-only configuration observations at review time.

## Architecture and execution map

- `BaseV2Factory.createPair` sorts token addresses, rejects zero/equal/duplicate inputs, and uses `(token0, token1, stable)` as the pair identity and CREATE2 salt. It deploys a child proxy, initializes it, records both token orderings, and marks the pair registered. A pair's initializer sets the stable/volatile mode, token decimals/scaling, factory, fee escrow child proxy, LP metadata, and cached fee ratio.
- Pair interaction is direct at the core. A router may provide convenience methods, but no router deployment/source was attributed to this GeckoTerminal Ethereum factory. The factory exposes `isPair`, `getPair`, and fee configuration; the pair exposes LP ERC-20/permit operations, reserves, quote/oracle views, `mint`, `burn`, `swap`, `skim`, `sync`, `syncFees`, and `claimFees`.
- `swap` is lock-protected. It transfers requested output, optionally calls the recipient's flash-swap hook, measures final token balances to infer actual inputs, transfers each input's fee to the pair-specific fee escrow, reads balances again, checks the selected invariant, and updates reserves and cumulative observations. Volatile pairs use `x*y`; stable pairs use decimal-normalized `x^3*y + x*y^3` math and iterative `_get_y` quoting.
- `getAmountOut` removes `floor(amountIn * feeRatio / 1,000,000)` before applying the same volatile or stable quote function. During settlement, the pair removes the same rounded fraction of measured input before checking the invariant. The factory routes fees to per-pair fee contracts; a pair can claim them only to the registered gauge fee distributor or the general fee destination.
- `mint` computes LP shares from balance deltas and locks minimum liquidity at the zero address; `burn` distributes the pair's observed balances pro rata to LP tokens held by the pair. `skim` transfers balances above reserves; `sync` adopts balances. Fee configuration is factory-controlled: stable/volatile defaults and pool-specific fees are bounded by `maxFees`; pair `syncFees()` is public and refreshes its cached fee from the factory.

## Entry points and invariants reviewed

- Root factory proxy and implementation: pair creation/lookup, pool-specific fee updates, stable/volatile fee updates, fee maximum, operator permissions, pause state, fee-distributor/voter links, and proxy governance/implementation pointers.
- Pair child proxy/interface/implementation: initialization, LP transfer/permit, mint/burn, volatile and stable swaps, optional callback, fee escrow accrual/claim, sync/skim, reserve update, cumulative-price and observation functions, fee synchronization, and proxy implementation pointers.
- Invariants: LP shares remain proportional to observed pool balances on mint/burn; completed swaps satisfy the mode-specific invariant using balances after the same fee basis used by quotes; pair reserves equal observed balances after `_update`; protocol fees leave reserves and accrue in the pair-specific escrow; observation accumulators use pre-update reserves over elapsed time; failed callback, fee transfer, or invariant validation rolls back the whole swap.

## Findings

No confirmed implementation defect was identified in the verified pair/factory paths reviewed for the sampled Solidly V2 family.

### Rejected hypothesis: quote fee and settlement fee differ

The quote path subtracts `amountIn * feeRatio / 1e6` using integer floor. Settlement derives input from post-callback balance deltas, transfers that same floored fee fraction from the pair to the escrow, and checks `K` using the resulting balances. The sampled pair's cached fee equals `factory.poolFees(sample)` at review time. The two paths use the same fee rounding and basis; no quote/settlement mismatch was established.

### Rejected hypothesis: stable and volatile curves are inconsistent

The pair stores an explicit `stable` mode. Volatile pools use `x*y`; stable pools normalize each token's raw reserve using its decimal scaling factor and use `x^3*y + x*y^3`. The quote helper selects the matching math based on the same stored mode, while swap settlement checks `_k` with that mode. This is an intentional two-curve design rather than an invariant mismatch.

### Rejected hypothesis: factory fee changes leave permanent stale pair fees

Each pair caches `feeRatio`, so changing factory-wide stable/volatile fee settings does not iterate over all pairs. The pair exposes permissionless `syncFees()` to read the current factory `poolFees`; pool-specific fee updates also call `syncFees()` immediately. The sample pair is synchronized to its current factory fee. No specification requiring a global setting change to synchronously update every pool was found, so the cache mechanism alone is not reported as a defect.

Other reviewed boundaries did not yield a credible candidate: callbacks occur under the pair lock and input is measured after callback completion; output must be less than actual reserves; the factory keeps stable and volatile pairs separate; duplicate pair creation is blocked; and fee configuration setters restrict newly configured fees below the bounded maximum.

## Validation and limitations

- No custom regression test was written or run because no credible invariant violation remained. No matching public GitHub source repository or test suite was found for this V2 deployment family.
- Read-only Ethereum calls checked sample token order, stable mode, pair factory, proxy implementation pointers, pair registration, current fee ratio, factory fee settings, and pause state. No state-changing call was made to a public deployment.
- The verified implementation is governance-upgradeable. Conclusions describe the source and proxy pointers observed during this review; a later authorized pointer change could alter implementation behavior. Governance centralization itself is not classified as a contract defect.
- GeckoTerminal records: [LUSD/WETH pool](https://www.geckoterminal.com/eth/pools/0x6d7824c5b5b385d1dd8d56c543a0be2eaf140974) and [Solidly Ethereum pools](https://www.geckoterminal.com/eth/solidlydex/pools).

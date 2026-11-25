# KyberSwap Classic (Ethereum)

## Target and source attribution

- GeckoTerminal identifier: `kyberswap_classic_ethereum`.
- Sampled pool: WBTC/USDT at `0xd343d5dba2fba55eef58189619c05e33cab95ca1`. Its verified `DMMPool` source and read-only getters identify token0 WBTC, token1 USDT, and factory `0x833e4083b7ae46cea85695c4f7ed25cdad8886de`. The verified factory reports the sampled pool for that token pair. Other top GeckoTerminal pools inspected use the same DMMFactory family.
- The DMMFactory and sampled DMMPool are verified on Ethereum Blockscout. Both report Solidity `0.6.12`, optimizer enabled with `999999` runs, matching the repository settings. This is the DMM/DMMPool deployment family listed under KyberSwap Classic; findings from KyberSwap Elastic or the separate KSPool family are not applied here.
- Public source repository: [`KyberNetwork/ks-classic-sc`](https://github.com/KyberNetwork/ks-classic-sc/tree/e557b57d7e4ead84caa2ec039aef280584148116), reviewed commit `e557b57d7e4ead84caa2ec039aef280584148116`.
- Relevant source files at that commit: [`DMMFactory.sol`](https://github.com/KyberNetwork/ks-classic-sc/blob/e557b57d7e4ead84caa2ec039aef280584148116/contracts/DMMFactory.sol), [`DMMPool.sol`](https://github.com/KyberNetwork/ks-classic-sc/blob/e557b57d7e4ead84caa2ec039aef280584148116/contracts/DMMPool.sol), [`VolumeTrendRecorder.sol`](https://github.com/KyberNetwork/ks-classic-sc/blob/e557b57d7e4ead84caa2ec039aef280584148116/contracts/VolumeTrendRecorder.sol), [`FeeFomula.sol`](https://github.com/KyberNetwork/ks-classic-sc/blob/e557b57d7e4ead84caa2ec039aef280584148116/contracts/libraries/FeeFomula.sol), [`MathExt.sol`](https://github.com/KyberNetwork/ks-classic-sc/blob/e557b57d7e4ead84caa2ec039aef280584148116/contracts/libraries/MathExt.sol), [`DMMLibrary.sol`](https://github.com/KyberNetwork/ks-classic-sc/blob/e557b57d7e4ead84caa2ec039aef280584148116/contracts/libraries/DMMLibrary.sol), and [`DMMRouter02.sol`](https://github.com/KyberNetwork/ks-classic-sc/blob/e557b57d7e4ead84caa2ec039aef280584148116/contracts/periphery/DMMRouter02.sol). Relevant repository tests include [`dmmPool.js`](https://github.com/KyberNetwork/ks-classic-sc/blob/e557b57d7e4ead84caa2ec039aef280584148116/test/dmmPool.js) and [`volumeTrendRecorder.js`](https://github.com/KyberNetwork/ks-classic-sc/blob/e557b57d7e4ead84caa2ec039aef280584148116/test/volumeTrendRecorder.js).
- Deployment source pages: [sample pool](https://eth.blockscout.com/address/0xd343d5dba2fba55eef58189619c05e33cab95ca1#code) and [factory](https://eth.blockscout.com/address/0x833e4083b7ae46cea85695c4f7ed25cdad8886de#code). I did not establish a deployed `DMMRouter02` address whose factory getter points to this DMMFactory; the router source paths below are assessed as repository implementation, not attributed to a specific live router address. The verified pool and factory are the deployment-specific anchors. No bytecode was changed or deployed.

## Architecture and execution map

- `DMMFactory.createPool` sorts token addresses, requires `ampBps >= 10000`, creates a fresh `DMMPool`, initializes its token pair and amplification, and records it in both token-order mappings and the enumerable pool set. It allows at most one unamplified pool per pair and additional amplified pools.
- `DMMPool` holds LP token supply, actual reserves, amplified virtual reserves, `kLast`, and `VolumeTrendRecorder` state. `mint` accounts token balance deltas and mints proportional LP shares; `burn` pays a pro-rata share of observed balances; `swap` transfers output before optional callback, measures post-callback balances, calculates actual inputs, checks the fee-adjusted invariant, then updates reserves; `skim` removes balance surplus and `sync` adopts balances into reserves.
- `DMMRouter02` validates that each pool is registered with its immutable factory, reads pool trade information for quotes, transfers input, and calls each pool's `swap`. It includes exact-input/output, ETH/WETH, and fee-on-transfer-token routes. The source's quote library uses amplified virtual reserves for price impact and checks output against actual reserves.
- Per-pool swap fee is computed from the volume trend and `ampBps`. `VolumeTrendRecorder` accumulates volume within the current block without changing the current EMA ratio; on a later block, it incorporates the completed block's volume into short and long EMAs. `FeeFomula` maps the ratio to the dynamic fee, and `DMMPool.getFinalFee` scales that base fee for higher amplification.
- At mint, burn, and sync, `_mintFee` may mint protocol LP shares based on growth in the virtual-reserve product since `kLast`, subject to factory `feeTo` and `governmentFeeBps` configuration. Factory fee configuration is restricted to `feeToSetter`, and `governmentFeeBps` is bounded to `1..1999`.

## Entry points and invariants reviewed

- Factory: pool creation, fee configuration, fee-setter rotation, pair lookup, and pool enumeration.
- Pool: initialization, LP transfer/permit, mint, burn, swap/callback, skim, sync, trade-info view, and reserve updates.
- Router/library: liquidity add/remove paths; exact-input and exact-output swaps; ETH/WETH wrappers; fee-on-transfer routes; pool/path validation; amount quotes; rounding and reserve bounds.
- Fee state: per-block volume recording, skipped-block EMA decay, fee curve boundaries, amplification scaling, protocol fee minting, and fee-off `kLast` reset.
- Invariants: successful swaps satisfy the fee-adjusted product bound using the same dynamic fee basis used for their quote; actual and virtual reserves move by the same settled token deltas; balances and reserves reconcile after pool state updates; LP mint/burn tracks proportional underlying claims; protocol shares reflect only growth since the last liquidity checkpoint; callback failure rolls back output transfers and state; reserve casts reject values beyond `uint112`.

## Findings

No confirmed implementation defect was identified in the reviewed DMM factory, pool, dynamic-fee accounting, or router/library source paths. This is a source-level assessment of the identified DMM deployment family, not a claim that every Classic pool, token, or router deployment has identical bytecode or current configuration.

### Rejected hypothesis: same-block volume makes quotes stale

`DMMPool.getTradeInfo()` calculates its fee from `getRFactor(block.number)`. During `swap`, `recordNewUpdatedVolume` accumulates same-block volume but returns the ratio derived from the existing EMAs. Thus multiple swaps in one block use the same fee; the accumulated volume changes EMA state only when a later block records a trade. The router's pre-swap quote and the pool's settlement use that same per-block fee. Repository tests in `test/volumeTrendRecorder.js` explicitly check same-block accumulation and the next-block EMA update. The behavior is consistent with the documented state transition, so it is not a stale-quote defect.

Other reviewed boundaries did not yield a credible candidate: exact-output quotes round input up; output is bounded by actual reserves; callback settlement is measured from final balances; fee-on-transfer routes compute input from balance deltas; amplification is a `uint32` and virtual reserve writes are checked against `uint112`; and fee-configuration values are bounded by the factory.

## Validation and limitations

- No custom regression test was written or run because no credible invariant violation remained. The repository's DMM pool, fee, and volume-recorder tests were inspected as supporting behavioral evidence; the complete suite was not run.
- Read-only Blockscout metadata and pool/factory getters were used to establish the sample's token ordering, factory link, pair mapping, compiler, and optimizer settings. No state-changing calls were made to public deployments.
- The repository contains both DMM and KS pool families. This report is scoped to the GeckoTerminal sample set's DMMFactory/DMMPool family and does not assess KSFactory/KSPool routes, KyberSwap Elastic, oracle integrations, aggregator routing, or unrelated tokens.
- GeckoTerminal record: [WBTC/USDT pool](https://www.geckoterminal.com/eth/pools/0xd343d5dba2fba55eef58189619c05e33cab95ca1).

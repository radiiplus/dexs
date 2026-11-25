# SaitaSwap (Ethereum) Evidence Ledger

## Target and source attribution

- GeckoTerminal identifier: `saitaswap-ethereum`. Sample pool: WETH/USDT at `0xe31dbc4e38b6099b03ca617206d16b446f657901`. Read-only `factory()` returns `0x25393bb68c89a894b5e20fa3fc3b3b34f843c672`; sorted tokens are WETH `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` and USDT `0xdAC17F958D2ee523a2206206994597C13D831ec7`.
- The sample's factory (`SaitaSwapFactory`) and pair (`SaitaSwapPair`) are verified on Blockscout. Pair source compiles with Solidity `0.5.16`, optimizer enabled with 100 runs; the factory also reports Solidity `0.5.16`. The factory deploys `type(SaitaSwapPair).creationCode` with CREATE2 and embeds its init-code hash. No public GitHub source repository for this Ethereum implementation was identified; verified explorer source is the implementation evidence.
- Exact deployed source links: [sample pair source](https://eth.blockscout.com/address/0xe31dbc4e38b6099b03ca617206d16b446f657901#code), [factory source](https://eth.blockscout.com/address/0x25393bb68c89a894b5e20fa3fc3b3b34f843c672#code), and [GeckoTerminal pool listing](https://www.geckoterminal.com/eth/saitaswap-ethereum/pools). Pair compiler-input sources include `SaitaSwapERC20.sol`, the pair/factory/callback interfaces, SafeMath, Math, and UQ112x112.
- A verified contract labeled “SaitaSwap Router 2” at `0x0c17e776cd218252adfca8d4e761d3fe757e9778` was not attributed to this sample: its read-only `factory()` returns `0x35113a300ca0d7621374890abfeac30e88f214b1`, not the sample factory, and its library uses init-code hash `0x49d9...`, while the sample factory's `INIT_CODE_PAIR_HASH()` is `0xce30...`. That separate router/factory family is excluded from this report. No source-level router conclusion is transferred from it.
- A CREATE2 derivation using the sample factory, sorted WETH/USDT, and the factory-reported pair init hash yields the sampled pair address. Read-only getters at review time report factory `feeTo = 0xabe6fd21403c5f6134fd316a155720c378f20c65`, `allPairsLength = 17`, pair fee numerator `2`, denominator `1000`, and nonzero `kLast`. These are state snapshots, not protocol-wide guarantees.

## Architecture and execution map

- `SaitaSwapFactory.createPair` rejects identical/zero/duplicate tokens, sorts token addresses, deploys a pair with CREATE2 using the sorted-token hash salt, initializes the pair, and records both lookup orders. `feeTo` and `feeToSetter` are managed by the current `feeToSetter`; factory has no proxy.
- `SaitaSwapPair` is an LP ERC-20 with permit, immutable factory identity set by constructor, one-time-by-caller initialization restricted to that factory, `uint112` reserves, timestamped cumulative prices, `kLast`, and a lock around `mint`, `burn`, `swap`, `skim`, and `sync`. The pair source includes its token and math dependencies in verified compiler input.
- `mint` measures balance deltas, optionally mints protocol LP shares from `sqrt(k)` growth, computes LP shares from balances and supply, then updates reserves and `kLast`. `burn` takes LP tokens held by the pair, optionally mints protocol fee shares, distributes current token balances pro rata, transfers both assets, then updates reserves and `kLast`.
- `swap` transfers outputs optimistically, invokes `SaitaSwapCall` when callback data is nonempty, measures both final balances, infers each input, enforces the fee-adjusted constant-product product, and updates reserves. The pair charges `2/1000` (0.2%) on measured input. `skim` transfers balances above reserves; `sync` adopts actual balances.
- The linked router for this exact factory was not identified. Core pair transitions and factory deployment/accounting are analyzed directly; route-level quote and callback conclusions are limited to pair behavior and do not claim coverage of an unrelated router deployment.

## Invariants reviewed

- Successful `_update` requires each token balance to fit `uint112` and writes the exact measured balances as reserves. `skim` only transfers balance excess; `sync` explicitly converts balance deltas into reserves.
- LP supply changes match either initial geometric-mean minting, proportional deposits at current reserves, pro-rata burns at current balances, or the protocol fee formula documented in `_mintFee` as minting liquidity equivalent to growth in `sqrt(k)`. Fee-off transitions clear `kLast`.
- For swaps, inferred input equals final balance above `reserve - output`; both adjusted balances subtract the same `2/1000` fee, and the adjusted product must be at least old `reserve0 * reserve1`. All callback, transfer, invariant and reserve-update steps are atomic under the pair lock.
- Cumulative prices accrue using pre-update reserves over elapsed time, with uint32 timestamp wrap behavior used by this Uniswap V2-derived implementation.

## Findings

No confirmed implementation defect was identified in the verified sample factory/pair family.

### Rejected hypotheses

- **Swap fee basis differs between quote and settlement:** the router deployment considered during source discovery is not linked to this factory and is excluded. In the pair source itself, measured input is reduced by `2/1000`; the invariant scales both balances and the old product by `1000^2`, matching that fee basis. The factory's init-code hash also maps to the sampled pair.
- **Protocol LP fee formula is presumed to match Uniswap V2's one-sixth fee:** this pair's `_mintFee` instead comments that it mints liquidity equivalent to the full `sqrt(k)` growth and divides by `rootKLast`. No SaitaSwap specification was found requiring the Uniswap one-sixth coefficient; this is an intentional source-level protocol difference, not enough evidence to classify a defect.
- **Pair can be reinitialized by an arbitrary caller:** `initialize` has no separate boolean guard, but only the fixed factory address can call it. The factory exposes initialization only as part of CREATE2 pair creation and does not expose a later pair reinitialization path.
- **Callback can reenter a reserve-changing function:** callback execution occurs under the pair's lock; reentry into the locked pair transitions reverts, and a failed callback/invariant check rolls the entire operation back.

## Validation and limitations

- No local regression was written because no credible invariant violation remained. Read-only calls established the sample's factory/token linkage, reserves, fee parameters, `kLast`, factory fee state, pair count, and CREATE2 address derivation. No public state-changing calls were made.
- This report covers verified Ethereum factory and pair sources only. A router source was found but did not match the sampled factory or pair init-code hash and is explicitly out of scope. Other SaitaSwap chains, pools, token-specific behavior, farms, staking and reward contracts were not assessed.
- GeckoTerminal records: [sample WETH/USDT pool](https://www.geckoterminal.com/eth/pools/0xe31dbc4e38b6099b03ca617206d16b446f657901) and [SaitaSwap Ethereum pools](https://www.geckoterminal.com/eth/saitaswap-ethereum/pools).

# Verse DEX (Ethereum)

## Target and source attribution

- GeckoTerminal identifier: `verse`.
- Sampled pool: USDC/WETH at `0x6e1fbeeaba87bae1100d95f8340dc27ad7c8427b`.
- The sample is an EIP-1167 minimal clone. Read-only calls return USDC (`0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`) and WETH (`0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2`), with factory `0xee3e9e46e34a27dc755a63e2849c9913ee1a06e2`.
- The verified `SwapsFactory` source at that address sets `cloneTarget` to `0x7290367aa694703220516a35e68e3d339ee7d193`. The sample's clone implementation metadata points to that exact `SwapsPair` implementation. The factory's `getPair(USDC, WETH)` returns the sample.
- Factory and implementation compile with Solidity 0.8.14, optimizer enabled for 200 runs. The factory deploys the pair implementation once and then creates deterministic minimal clones, initializing each clone in the same transaction.
- No public GitHub repository containing these DEX contracts was found in the Bitcoin.com Verse GitHub organization or source searches. The primary implementation evidence is the explorer-verified source: [factory](https://eth.blockscout.com/address/0xee3e9e46e34a27dc755a63e2849c9913ee1a06e2#code) and [pair implementation](https://eth.blockscout.com/address/0x7290367aa694703220516a35e68e3d339ee7d193#code). The [sample clone](https://eth.blockscout.com/address/0x6e1fbeeaba87bae1100d95f8340dc27ad7c8427b#code) is separately explorer-verified and linked to the implementation. This source availability limitation is explicit; no GitHub source attribution is inferred.
- A separate Verse router source/repository was not identified. This report therefore assesses the verified factory and pair implementation, not an unverified router or third-party aggregator. The pair supports the standard mint/burn/swap interface and the optional `swapsCall` callback.

## Architecture and execution map

- `SwapsFactory` initializes `feeTo` and `feeToSetter` to the nonzero constructor argument, deploys one `SwapsPair` implementation, and stores it as immutable `cloneTarget`. `createPair` sorts tokens, rejects equal/zero/duplicate pairs, creates an EIP-1167 clone with token-pair salt, initializes it, records both mapping directions, and appends it to `allPairs`.
- `SwapsPair` has LP ERC-20 state and permit, factory/token addresses, two `uint112` reserves, timestamp and cumulative prices, `kLast`, and a pair-local lock. `initialize` sets the token addresses and factory once. Mint/burn measure current token balances; swaps transfer outputs optimistically, optionally call `swapsCall`, measure balances, enforce the 0.3%-fee adjusted product bound, then update reserves. `sync` adopts current balances. `skim` transfers balance excess above reserves to the factory's current `feeTo` address.
- The pair protocol fee is represented by LP shares minted on mint/burn based on `sqrt(k)` growth. The factory does not allow `feeTo` or `feeToSetter` to be set to zero; the current read-only getters return the same nonzero address for both fields.

## Entry points and invariants reviewed

- Factory: `createPair`, `getPair`, `allPairs`, `allPairsLength`, `setFeeTo`, and `setFeeToSetter`.
- Pair: one-time `initialize`, LP transfer/approval/permit, `mint`, `burn`, `swap`/callback settlement, `skim`, `sync`, reserve views, and cumulative-price state.
- Invariants: only the factory initializes a clone, and only once; successful mint/burn/swap updates reserves to observed post-settlement token balances; LP shares are proportional to balances after any protocol LP mint; swaps satisfy the 0.3% fee-adjusted product inequality; token balances/reserves fit the `uint112` storage boundary; callback reentry into the same pair is blocked; revert paths roll back token transfers and state.

## Findings

No confirmed implementation defect was identified in the verified factory and pair implementation. This conclusion does not cover the separately sourced router, aggregator routing, or other Verse protocol components.

### Expected behavior: `skim` directs surplus to the protocol recipient

Unlike canonical Uniswap V2's caller-selected `skim(to)`, this implementation exposes `skim()` without a recipient and transfers all balance excess to the factory's configured `feeTo`. This makes unsolicited surplus unrecoverable by the party that transferred it, but the implementation explicitly selects the protocol fee recipient for this path and no checked specification establishes a user recovery entitlement. It is not reported as a defect absent evidence that the surplus is owed to a particular user.

### Rejected hypotheses

- **Clone initialization can be front-run:** factory creation and clone initialization occur atomically in `createPair`; the implementation also rejects a second initialization once `factory` is nonzero.
- **Protocol-fee LP accounting is mis-scaled:** `_mintFee` uses the standard 1/6-of-`sqrt(k)`-growth formula and is applied before mint/burn calculations. `kLast` is refreshed after both liquidity transitions.
- **Reentrant callback can bypass reserve checks:** `swap` holds the pair lock across output transfers, callback, balance reads, invariant validation, and `_update`.
- **Reserve overflow is silently truncated:** `_update` rejects balances above `type(uint112).max` before casting.

## Validation and limitations

- No custom regression test was run because no credible defect candidate remained. The DEX source was obtained from explorer verification rather than a source repository with a local test suite.
- Read-only Ethereum calls confirmed clone token/factory links, factory implementation target, factory pair mapping, and nonzero fee recipient configuration. No live swap, transfer, deployment, or vulnerability test was performed.
- Explorer sources: [factory](https://eth.blockscout.com/address/0xee3e9e46e34a27dc755a63e2849c9913ee1a06e2#code), [pair implementation](https://eth.blockscout.com/address/0x7290367aa694703220516a35e68e3d339ee7d193#code), and [sample pair clone](https://eth.blockscout.com/address/0x6e1fbeeaba87bae1100d95f8340dc27ad7c8427b#code).
- GeckoTerminal pool record: [USDC/WETH](https://www.geckoterminal.com/eth/pools/0x6e1fbeeaba87bae1100d95f8340dc27ad7c8427b).

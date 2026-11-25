# Elk Finance (Ethereum) Evidence Ledger

## Scope and target identity

- Chain: Ethereum mainnet, GeckoTerminal network `eth`.
- GeckoTerminal DEX ID: `elk_finance_ethereum`; sampled pool `0xa27e5775317f3f301b5b08babcde0a20feae7f09` (`ELK / WETH`).
- Public source: `https://github.com/elkfinance/exchange-contracts`, commit `78a554d4aa7de35c5c80d4964e5088860ad64c3a` (2021-11-01). Core is Solidity 0.5.16; router is Solidity 0.6.6.
- Official Ethereum address docs list V2 factory `0x6511eBA915fC1b94b2364289CCa2b27AE5898d80`, router `0xb5e9F6C58f548CeE53257304e287b23757eFFCA1`, and known pairs including ELK/WETH `0xA27E5775317F3f301B5b08BabCdE0a20FEAE7f09` and WETH/USDT `0xfa2048b1008039ca629747353791baef47e25456`.
- Blockscout identifies the factory source as `ElkFactory`, verified with solc 0.5.16, optimizer enabled, 1,000 runs. Router source is verified with solc 0.6.6, optimizer enabled, 1,000 runs. Pair source is partially verified and reports solc 0.5.16, optimizer 1,000 runs. No state-changing live interaction was performed.
- This ledger covers the `elk_finance_ethereum` V2 AMM entry. Elk's separate V3 deployment is not mixed into this analysis.

## Architecture and execution map

- `ElkFactory` controls `feeTo` and `feeToSetter`, creates sorted pairs with CREATE2 using `ElkPair` creation code and token-pair salt, stores both token-order mappings, and enumerates pairs.
- `ElkPair` owns token addresses, reserves, cumulative prices, `kLast`, LP ERC-20 state and lock. `mint` and `burn` use live token balances; `_mintFee` mints protocol LP tokens when `feeTo` is active; `swap` supports an optional `elkCall` callback and validates fee-adjusted K before reserve synchronization; `skim` transfers excess balance and `sync` adopts current balances.
- `ElkRouter` uses `ElkLibrary.pairFor` throughout add/remove liquidity and token/ETH swap paths. It supports exact-input, exact-output, permit, WETH and fee-on-transfer-token paths. Exact-output paths use `getAmountsIn`, enforce `amountInMax` (or `msg.value` for ETH input), and use one-unit round-up in the library formula.
- `ElkLibrary` derives pairs from a fixed init-code hash and implements 0.3% swap math (`997/1000`). The pair invariant uses `amountIn * 3` over 1,000, also a 0.3% fee. `CalculateElkPairHash` returns the actual creation-code hash under its compiler settings.

## Entry points and state transitions reviewed

- Factory: `createPair`, `getPair`, `allPairs`, `setFeeTo`, `setFeeToSetter`.
- Pair: `initialize`, ERC-20 LP transfer/approval/permit, `mint`, `burn`, `swap`/flash callback, `skim`, `sync`.
- Router: add/remove liquidity and ETH variants, permit variants, exact-in/exact-out token and ETH swaps, fee-on-transfer swap variants, quote helpers.
- Library: sort/pair derivation, reserves, quote, amount in/out and multihop paths.

## Critical invariant catalogue

- Factory `getPair`, CREATE2 deployment address, and `ElkLibrary.pairFor` must identify the same pair for sorted token addresses.
- Pair reserves track last synchronized balances. Minting consumes balance deltas; burning distributes actual pair balances pro rata after any protocol fee mint.
- For each swap, measured actual inputs and outputs must satisfy `(balance0*1000 - amount0In*3) * (balance1*1000 - amount1In*3) >= reserve0*reserve1*1000^2`.
- Successful mint/burn/swap state updates are atomic with token transfers; failed callbacks, transfers or K checks revert the entire transaction.
- Protocol fee shares are minted from growth in `sqrt(k)` during mint/burn operations; disabling fees clears `kLast` at the next liquidity event.
- `skim` only transfers balance surplus over reserves; `sync` deliberately reconciles reserves to actual balances.

## Findings

No confirmed invariant violation was identified in the reviewed V2 source and deployment family.

### Rejected hypothesis: pair init-code hash mismatch

- The source repository's Hardhat config leaves the 0.5.16 optimizer disabled, which compiles `ElkPair` creation code to hash `0xa8eb2ef53d85c7288b3df6827c59c419da1afc4fe8a2ab86a06ae2cdfc3dc937`; this differs from `ElkLibrary.pairFor`'s constant `0x84845e7ccb283dec564acfcd3d9287a491dec6d675705545a2ab8be22ad78f31` (`contracts/elk-periphery/libraries/ElkLibrary.sol:18-27`).
- The verified Ethereum deployments use optimizer enabled with 1,000 runs. Recompiling the exact checked-in `ElkPair` source with those settings produces `0x84845e7ccb283dec564acfcd3d9287a491dec6d675705545a2ab8be22ad78f31`, matching the library constant.
- Independent CREATE2 calculations with that constant and the documented Ethereum factory reproduce both the documented WETH/USDT pool `0xfa2048...e25456` and ELK/WETH pool `0xa27e...7f09` exactly.
- Disposition: no deployed factory/router/pool mismatch is demonstrated. The repository's default local core compilation settings do not reproduce the deployment's optimizer settings, so future builds should use the verified production settings and keep the pair-hash regression check in CI.

## Validation and limitations

- Local source hash comparison: completed with solc 0.5.16 both unoptimized and optimized at 1,000 runs. The optimized creation hash matches the library constant.
- Pair address derivation: local CREATE2 calculations match official documented addresses for two Ethereum pairs.
- Blockscout verified-source/compiler metadata was used to establish deployment compiler settings. No public transaction was sent; no live pool operation was tested.
- The repository does not provide an AMM-specific local test suite in the checked-out commit; therefore no project-owned pair/router regression tests were run.
- No credible financial accounting candidate remained after checking the pair balance/reserve transitions, protocol fee minting, swap fee math, output bounds, router exact-output calculations, callbacks, and transaction rollback.

## Rejected/expected behaviors

- Permissionless `skim` and `sync` are standard V2 functions and only affect balance surplus or explicitly reconcile reserves; no reserve-backed LP value is transferred by `skim`.
- Protocol LP minting is the standard Uniswap V2 growth-in-`sqrt(k)` fee share and occurs on mint/burn as designed.
- Core and library fee math are consistent at 0.3%; exact-output calculation uses `(reserveOut - amountOut) * 997` and rounds required input upward by one.

# Swapr (Ethereum) Evidence Ledger

## Scope and target identity

- Chain: Ethereum mainnet, GeckoTerminal network `eth`.
- GeckoTerminal DEX ID: `swapr_ethereum` (API order 7 at review time).
- Protocol family: DXswap/Uniswap V2 style constant-product AMM with configurable per-pair swap fees and a protocol fee receiver.
- Source repositories reviewed:
  - Core: `https://github.com/levelkdev/dxswap-core`, router dependency pinned by the periphery lockfile to commit `c83a3a2b76c2cee9b896e8eacc121054cc2ecd4a` (Solidity 0.5.16).
  - Periphery: `https://github.com/levelkdev/dxswap-periphery`, source snapshot commit `acc65194b23a856091ee7772af80057eca29b9f2` (Solidity 0.6.6).
- GeckoTerminal lists the protocol and Ethereum pools. Swapr DXdocs publish factory `0xd34971BaB6E5E356fd250715F5dE0492BB070452` and router `0xb9960d9bca016e9748be75dd52f02188b9d0829f`. Etherscan labels the router source as verified. The source/repository-to-runtime mapping was not established cryptographically during this review, so findings and conclusions here apply to the reviewed source snapshots and do not assert that these exact commits are deployed.
- Compiler/build settings for the pinned core artifact: Solidity 0.5.16; router repository declares Solidity 0.6.6 for periphery. The router's lockfile resolves core to the 2020 commit above; later core branch code is not interchangeable for source identity.

## Architecture and execution map

- `DXswapFactory.createPair` sorts token addresses, hashes the packed pair, deploys `DXswapPair` with CREATE2, initializes token addresses, and records both token orderings. Factory administration controls `feeTo`, protocol fee denominator, and each pair's swap fee.
- `DXswapPair` owns reserves, LP ERC-20 supply, cumulative prices, `kLast`, fee setting, and a lock. `mint`/`burn` measure actual ERC-20 balances against stored reserves; `swap` optimistically sends outputs, invokes the optional callback, then measures final balances and enforces the fee-adjusted K invariant. `skim` transfers balance excess; `sync` adopts balances as reserves.
- `DXswapRouter02` handles add/remove liquidity, token and ETH swaps, exact-in/exact-out paths, and fee-on-transfer token swap paths. It uses `DXswapLibrary.pairFor` for pair addressing and uses the pair's live `swapFee` for quotes and fee-on-transfer execution.
- `DXswapMigrator` exits a Uniswap V1 exchange and adds received assets through Router01; transaction rollback covers all steps if the later add or minimum checks fail.
- `DXswapFeeReceiver` uses CREATE2 pair derivation to aggregate protocol fees. `DXswapFeeSetter` delegates/configures per-pair fee authority.

## Entry points and state transitions reviewed

- Factory: `createPair`, `setFeeTo`, `setFeeToSetter`, `setProtocolFee`, `setSwapFee`.
- Pair: `initialize`, `setSwapFee`, `mint`, `burn`, `swap`, `skim`, `sync`; ERC-20 transfer/approval/permit and flash callback paths.
- Router: add/remove liquidity variants, permit variants, exact input/output swap variants, ETH/WETH variants, supporting-fee-on-transfer variants, quote and amount helpers.
- Migrator: `migrate` (V1 LP transfer/burn, underlying token approval and router deposit, unused-asset refunds).
- Fee receiver/setter: fee aggregation and administrative transitions.

## Invariant catalogue

- Pair stored reserves are updated only after successful state-changing operations and are reconciled to post-transfer balances by `_update`; transaction reverts roll back transfers and state if K/minimum/deadline checks fail.
- A mint uses balance deltas over reserves and mints LP shares proportionally to both assets, with permanently locked minimum liquidity at initial mint. A burn distributes actual balances pro rata to LP supply after protocol fee minting.
- A swap requires positive output below reserves and positive measured input. After the callback and output transfers, fee-adjusted balances must satisfy `K_after >= K_before` using fee units over 10,000.
- Protocol fees are represented by LP tokens minted on liquidity events according to growth in `sqrt(k)` when `feeTo` is enabled; disabling fees clears `kLast` on the next mint/burn.
- Router quotes and execution both use each pair's configured swap fee. Exact-output paths add one unit after division to avoid underpayment from integer truncation.
- `skim` can take only balance surplus over reserves; `sync` explicitly changes reserves to current balances. These are standard permissionless V2 semantics.

## Findings

No confirmed or locally reproduced invariant violation was identified in the reviewed source snapshots.

### Disproven hypothesis: router CREATE2 init-code hash mismatch

- Router source: `contracts/libraries/DXswapLibrary.sol:18-25` hardcodes `d0d9bad4e674acbddd29729f10773af2aee1e9dee499c51bdf5ea12210740304`.
- Core factory: pinned commit `contracts/DXswapFactory.sol:24-38` deploys the creation code of `DXswapPair` with salt `keccak256(token0 || token1)`.
- Evidence: keccak256 of `build/DXswapPair.json` creation bytecode read directly from exact core commit `c83a3a2b76c2cee9b896e8eacc121054cc2ecd4a` is `0xd0d9bad4e674acbddd29729f10773af2aee1e9dee499c51bdf5ea12210740304`, exactly matching the router constant. Core `DXswapFactory.spec.ts` independently derives the expected CREATE2 pair address from that pair artifact and checks both token orderings and the factory mapping.
- Disposition: the suspected source mismatch came from comparing the router against a later core revision; the dependency lock resolves the older matching artifact. It is not a defect for the pinned source combination.

## Validation and limitations

- Exact pinned artifact hash comparison passed as described above.
- Repository unit suite was not run. `npm ci` rejected the repository's npm lockfile because it is out of sync with `package.json` (`dxswap-core`, `ethereumjs-abi`, and missing transitive entries). A Yarn frozen-lockfile install did not leave a usable `node_modules`; `yarn test` consequently stopped before compilation because `rimraf` was unavailable. No tracked files were changed by these install attempts.
- The repository includes pair and factory unit tests covering reserve updates, mint/burn, swaps, protocol fees, and CREATE2 deployment, but their execution result is not claimed here.
- No public deployment was called to execute transactions or test behavior. Deployment addresses and contract labels are identification context only.

## Rejected/expected behaviors

- `skim` and `sync` allow anyone to choose surplus handling or synchronize donated/rebasing balances. These are deliberate V2 pair interfaces; no unauthorized transfer from reserve-accounted LP claims was demonstrated.
- The admin may change pair fees within the protocol's accepted range. This changes future swap pricing by design; router paths query the pair's current fee rather than assuming a fixed fee.
- Reentrancy through token transfers or flash callbacks is bounded by the pair lock for `mint`, `burn`, `swap`, `skim`, and `sync`; external failure reverts the transaction.

## Remediation

No remediation is recommended based on the reviewed source evidence. For stronger deployment attribution, compare verified router/pair creation bytecode and compiler metadata at the published addresses against the pinned source artifacts before treating this source conclusion as deployment-specific.

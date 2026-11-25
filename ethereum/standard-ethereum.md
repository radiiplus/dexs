# Ethereum / Standard Protocol AMM

## Scope and target identity

- Chain: Ethereum mainnet.
- GeckoTerminal DEX ID: `standard_ethereum` (display name `Standard (Ethereum)`). Its pool list includes WETH/USDT and STND/WETH examples.
- Repository: [standarddotim/standard-evm](https://github.com/standarddotim/standard-evm), checkout commit `86aaa3213ce12e08dd30ae0f2d9f05b9df22aa4c`.
- The repo's `test-book.json` maps Ethereum mainnet `UniswapV2Factory` to `0x53AC1d1FA4F9F6c604B8B198cE29A50d28cbA893` and `UniswapV2Router02` to `0x6C78D71ce7300343e3633E0c45D6c7A79fEe4650`. The AMM deploy task builds these sources and explicitly tells the deployer to update the library hash using the factory-computed pair hash. GeckoTerminal groups pools under `standard_ethereum`, consistent with this DEX. However, the sampled WETH/USDT pool was not independently linked to this factory, and deployed runtime bytecode was not retrieved. The source defect is confirmed; applicability to those live addresses remains unverified.
- Core source: `contracts/uniswapv2/UniswapV2Factory.sol`, `UniswapV2Pair.sol`, `UniswapV2Router02.sol`, `UniswapV2ERC20.sol`, and libraries. Solidity `0.6.12`; optimizer enabled at 99,999 runs in `hardhat.config.ts`. The source README says this is a Uniswap V2-derived AMM with protocol fee shares and a flash-swap guard.
- No live deployment was used for tests or state mutation. Regression tests ran against synthetic tokens and contracts in local Hardhat.

## Architecture and execution map

`UniswapV2Factory.createPair` sorts token addresses, deploys `UniswapV2Pair` with CREATE2 using `keccak256(abi.encodePacked(token0, token1))` as salt, initializes tokens, and stores both pair lookup directions. Factory owner (`feeToSetter`) controls fee recipients, migrator, and setter transfer.

`UniswapV2Router02` stores immutable factory and WETH addresses. Liquidity methods call factory to create missing pairs, transfer input assets to a pair, and call `mint`; removal transfers LP tokens to the pair and calls `burn`. Swap methods use `UniswapV2Library` to derive pair addresses, quote input/output paths, transfer input, and call pair swaps. Both standard and fee-on-transfer token paths exist; ETH paths wrap/unwrap WETH.

`UniswapV2Pair` holds the LP token and reserve accounting. `mint` uses balance deltas, `burn` redeems the LP balance held by the pair pro rata against token balances, and `swap` performs optimistic transfers/callbacks followed by an adjusted-K check and reserve update. `skim` and `sync` expose the usual surplus/reconciliation operations. Pair-level fee-on logic is evaluated during mint/burn and can mint LP tokens to configured fee, pool, and treasury destinations. A privileged migrator may determine initial LP issuance for an empty pool.

`FlashSwapGuard` is a separate modifier that reads `pair.lastUpdate()` and rejects use in a block where pair state changed. The pair updates `lastUpdate` in `_update`; this guard is not wired into the factory, pair, or router entry points in the checked repository.

## Entry points and state transitions

| Entry point | State/value flow |
|---|---|
| Factory `createPair` | CREATE2 deploys pair, initializes token ordering, records lookup, emits `PairCreated`. |
| Factory setters | Owner controls `feeTo`, `poolTo`, `treasuryTo`, `migrator`, and `feeToSetter`. |
| Router `addLiquidity` / `addLiquidityETH` | Creates pair if needed, computes proportional deposits from reserves, transfers tokens/WETH, calls pair `mint`. |
| Router `removeLiquidity` variants | Transfers LP to pair, calls `burn`, checks minimum outputs; failures revert atomically. |
| Router exact-input / exact-output swap variants | Quotes all path legs, transfers input to first pair, routes outputs pair-to-pair, enforces user input/output limits. |
| Router fee-on-transfer swap variants | Pair input is inferred from actual balance minus reserves; final output minimum is checked against recipient balance delta. |
| Pair `mint` / `burn` | Updates fee LP accounting, issues or burns LP against observed token balances, synchronizes reserves. |
| Pair `swap` | Lock-protected optimistic transfer and optional callback; infers input from balances; enforces adjusted K; syncs reserves. |
| Pair `skim` / `sync` | Permissionlessly transfers surplus over reserves or sets reserves to current token balances. |

## Critical invariants

1. A router-derived pair address must equal the address created by the configured factory for the same sorted tokens and salt.
2. For completed pair actions, reserves must equal pair token balances, apart from surplus deliberately left between actions.
3. Swap output is bounded by the adjusted constant-product check over observed input and output.
4. LP minting is based on actual token balance deltas and supply; burning redeems against actual balances and total supply, including fee LP minted first.
5. Router minimums, maximum input limits, and deadlines must be applied before successful settlement; any later failure rolls back all transfers and reserve changes.
6. Fee recipient LP issuance may dilute existing holders only by the formula's calculated protocol share; integer division dust remains unminted rather than being assigned as unbacked claims.

## Ranked findings

### M1. Router CREATE2 pair hash does not match the factory's pair creation code

**Status:** Confirmed defect in checked source composition and reproduced locally. Deployment applicability is unverified.

**Evidence:** `contracts/uniswapv2/UniswapV2Factory.sol:33-35` returns `keccak256(type(UniswapV2Pair).creationCode)` as `pairCodeHash`; lines 48-53 deploy that exact `UniswapV2Pair` creation code with CREATE2. Under the repo's configured Solidity 0.6.12 optimizer settings, that hash is `0xfcbdcf18d4b85cdfffe7bf479554910c01aa1c5382acfdbabf4a10c21c2b3810`. In contrast, `contracts/uniswapv2/libraries/UniswapV2Library.sol:19-27` hardcodes `0x8bcf059a21f224a4f11cd79db7af2336bcfa78b32a21860b32ec9c4d5c203c9c` for `pairFor`.

**Path and invariant:** Router liquidity methods create/look up a pair through the factory (`UniswapV2Router02.sol:42-50`) but later derive its address through `pairFor` (`:109-113`). Router quotes and swap paths also derive pair addresses using `pairFor` (library `:30-35`; router exact-input paths `:368-393`, fee-on-transfer paths `:543-579`). Because the hashes differ, for a given factory and token salt the computed router address differs from the factory-created pair.

**Observed local outcome:** Regression test `test/amm-hash-repro.js` deploys the source factory, tokens, and router on local Hardhat. It asserts the factory hash equals `0xfcbd…3810`, derives the library address with `0x8bcf…3c9c`, and confirms it differs from `factory.getPair`. `router.addLiquidity` then reverts because the router attempts to read reserves / mint at the wrong address. Transaction rollback also reverts the attempted pair creation when made through router. Existing factory-created pools are likewise unreachable through router quote/swap paths in this exact composition.

**Impact:** Standard router liquidity and swap entry points are unusable when compiled/deployed with this pair code and stale library constant. Direct calls to factory-created pairs may remain possible, subject to pair invariant and token transfers, but do not repair router usability.

**Remediation:** Derive router pair addresses from a factory-provided canonical pair mapping (`getPair`) or regenerate the constant from the exact pair creation bytecode and enforce a build-time equality test between `factory.pairCodeHash()` and the library constant. Re-run integration tests for create, add/remove liquidity, and swap paths after any pair bytecode/compiler/optimizer change.

## Rejected or unverified hypotheses

- **Fee-on-transfer WETH output sweeps router balance:** `swapExactTokensForETHSupportingFeeOnTransferTokens` unwraps `IERC20(WETH).balanceOf(address(this))` in full (`UniswapV2Router02.sol:634-655`). A prior direct WETH transfer to the router could be paid to a later caller. The repository has no per-sender accounting or stated recovery right for direct transfers, and this pattern also appears in canonical V2 router designs. This is recorded as unverified donation handling, not a confirmed defect.
- **Fee destinations are inconsistently controlled:** `_mintFee` gates all recipient minting on nonzero `feeTo`; `pool` and `treasury` toggles further split the calculated fee share. `treasury` is nested under `poolOn`, so enabling treasury alone does not mint to treasury. This is owner-controlled configuration behavior; no unauthorized value path was established.
- **Permissionless pair `skim`/`sync`:** expected V2 mechanics. `skim` only transfers balances above reserves; `sync` updates reserve state to actual balances.
- **Pair's `lastUpdate` and `FlashSwapGuard`:** the field is written on every pair `_update`, and the separate modifier rejects same-block use. The guard is not applied to core DEX paths in this repository. No downstream deployment using the guard was established, so this is not reported as a core pair defect.
- **Migrator initial-liquidity branch:** privileged factory setter controls the migrator, and the branch rejects zero and max liquidity. This trust assumption was not treated as an unprivileged accounting defect.

## Controlled validation

- Build: `npx -y -p node@18 node ./node_modules/hardhat/internal/cli/cli.js compile` with a local test mnemonic only; 190 Solidity files compiled successfully. The repo's configured Node range is 14/16/18; Node 18 was used ephemerally and global Node was not changed.
- Regression: `MNEMONIC='test test test test test test test test test test test junk' npx -y -p node@18 node ./node_modules/hardhat/internal/cli/cli.js test test/amm-hash-repro.js`.
- Result: 1 passing. Test file is in `/tmp/gecko-audit-standard-ethereum/test/amm-hash-repro.js`; it is a local test artifact, not committed into the project.
- No live deployment interactions or real assets were used.
- Independent reviewer separately recomputed the creation-code hash from the compiled Pair artifact, confirmed the mismatch and router impact, and agreed that runtime/deployment matching remains unverified. The reviewer also confirmed the unverified classification for WETH donation handling.

## Evidence references

- [GeckoTerminal Standard (Ethereum) page](https://www.geckoterminal.com/eth/standard_ethereum/pools) identifies the DEX ID and displayed pools.
- [Standard Protocol EVM repository](https://github.com/standarddotim/standard-evm) describes its AMM as Uniswap V2-derived and includes the Ethereum factory/router address table.
- The relevant checked source is in the repository paths listed above at commit `86aaa3213ce12e08dd30ae0f2d9f05b9df22aa4c`.

# Ethereum / ShibaSwap V1 Evidence Ledger

## Status and scope

- Chain: Ethereum. This is the fourth DEX in GeckoTerminal's `/api/v2/networks/eth/dexes` listing.
- Protocol version: ShibaSwap V1. Current official docs describe V1 as the Ethereum constant-product AMM; the same docs say V2 is based on V3-style concentrated liquidity but its source is not publicly available.
- Source examined: public `SHIBA-st-x/shibaswap-contracts` repo, commit `4fbdbc90d7fece21a5c3ac12f7b68aab8487808d`. Core declares Solidity `0.5.16`, optimizer 200; periphery declares Solidity `0.6.6`, optimizer 200.
- Provenance limitation: the repository contains Pancake-derived `PancakePair`/`ShibaFactory`/`ShibaRouter` code, its periphery package references different core package names, and its router deployment script hardcodes factory `0xF056...` while official documentation lists two conflicting Ethereum factory addresses. No verified mapping from this repo to GeckoTerminal's indexed Ethereum ShibaSwap contracts was established. Findings below are source-composition results, not claims about a live deployment.
- No deployment calls or chain state queries were made. Source was compiled locally only.

## Architecture and execution map

- `ShibaFactory` deploys CREATE2 pair contracts from `PancakePair.creationCode`, initializes their token pair, and records both token orderings (`core/contracts/ShibaFactory.sol:27-42`). Factory owner controls `feeTo`, `feeToSetter`, and the `locked` boolean (`:44-57`).
- `PancakePair` stores two `uint112` reserves, timestamp/cumulative prices, LP ERC-20 supply, and `kLast`. It handles LP mint/burn, optimistic swap with optional `pancakeCall`, `skim`, and `sync`; state-changing operations use a pair-local reentrancy lock (`core/contracts/PancakePair.sol:30-36, 110-201`).
- `ShibaRouter` wraps the pair interface with liquidity operations, WETH handling, multi-hop swap paths, exact-input/exact-output calculations, and fee-on-transfer swap paths (`periphery/contracts/ShibaRouter.sol:33-453`). All router swap variants check `factory.locked()` before proceeding.
- LP token state and permit are implemented in `PancakeERC20.sol`. Router arithmetic and deterministic address prediction are in `PancakeLibrary.sol`.

## Entry-point and transition inventory

- Factory: `createPair`, `setFeeTo`, `setFeeToSetter`, `setLocked`, and pair enumeration.
- Pair: `initialize`, `mint`, `burn`, `swap`/`pancakeCall`, `skim`, `sync`, and LP token transfer/approval/permit.
- Router liquidity paths: add/remove token-token and token-ETH liquidity, permit-based removals, fee-on-transfer ETH removal.
- Router swap paths: exact-input and exact-output token-token/token-ETH/ETH-token; fee-on-transfer variants; quote and amount calculation views.
- Settlement: pair swap derives actual input from post-callback token balances and checks fee-adjusted constant product before `_update`; router calls that fail pair invariants or output minima revert atomically.

## Critical invariants reviewed

1. Pair reserves equal observed token balances after successful mint, burn, swap, or sync and fit `uint112`.
2. Swap post-state satisfies the 0.3% fee-adjusted product check using actual inputs observed after transfers/callbacks.
3. LP shares minted and burned correspond to pro-rata token balances, with minimum first-mint liquidity locked at zero address.
4. `kLast` fee baseline is updated on liquidity events, and factory fee recipient transitions are reflected by `_mintFee`.
5. Router deterministic pair addresses must match the pair bytecode actually deployed by the configured factory; otherwise routing, quote, and liquidity settlement paths target a different address.
6. The factory `locked` flag is read by all Router swap entrypoints; whether it is intended as a global protocol pause or router-only gate is not specified in the checked source/docs.

## Findings

### Medium confidence: router's CREATE2 pair hash does not match the checked factory pair bytecode

- Classification: confirmed mismatch in the checked source composition under its declared core compiler settings; actual Ethereum deployment applicability unverified.
- Locations: `core/contracts/ShibaFactory.sol:7, 32-36` computes/deploys from `type(PancakePair).creationCode`; `periphery/contracts/libraries/PancakeLibrary.sol:18-28` embeds `0x58941f97d310583d065b71bcccf7dbed4759de8fa9e8b11f136e6611c16b5324` in `pairFor`.
- Validation: compiling this repository's `PancakePair` with Solidity `0.5.16`, optimizer enabled with 200 runs (the checked core Truffle config) produced init-code hash `0xdf8ba7cb2028280dddde40dd77f404b803e7cc35df12ccc7601a85c01a477f90`. This differs from the periphery constant. Repro script: `/tmp/gecko-audit-shibaswap/check-pair-hash.js`.
- State/impact if these source components are deployed together: for the same factory and sorted token pair, CREATE2 addresses computed with those different init-code hashes are distinct. Factory `createPair` deploys at the source-derived address, while router `pairFor` computes the constant-derived address. Router lookups and amounts views call `getReserves` at the wrong address; add/remove/swap paths likewise target that incorrect address and should revert or fail settlement. This is a functional integration failure, not a demonstrated loss of user funds; reverting calls roll back.
- Root cause: hard-coded library metadata was not kept synchronized with the pair implementation used by the factory.
- Remediation: derive the constant from the exact pair creation bytecode in the same build, and add a build/test assertion that `keccak256(PancakePair.creationCode) == PancakeLibrary`'s configured hash. Better, use a verified factory-provided hash if compatibility/security tradeoffs permit.
- Deployment limitation: the source repository's package/deploy scripts do not establish that this exact factory/router pair is the code behind GeckoTerminal's Ethereum ShibaSwap listing. Treat this as confirmed source defect with deployment impact unverified.

## Plausible risk, not a confirmed finding

- The factory owner can toggle `locked`; all nine Router swap entrypoints reject when it is true (`ShibaRouter.sol:224-409`), but `PancakePair.swap` never reads that flag (`PancakePair.sol:159-186`). A direct pair caller can transfer input and call `swap` while router calls are gated. Factory migration initializes `locked = true` (`core/migrations/2_deploy_contracts.js`). This demonstrates a router-gate bypass, but the source/docs do not establish whether `locked` is promised as a protocol-wide emergency pause or only disables routed swaps. No confirmed security invariant violation is assigned without that intent.

## Rejected hypotheses / expected behavior

- **Protocol fee formula's 3x factors are an arithmetic mismatch:** not supported. The formula algebraically cancels to `totalSupply * (rootK - rootKLast) / (rootK + rootKLast)`, matching its local comment describing a 3/6 share. No accounting defect was demonstrated from that formula alone.
- **Direct donations/rebases desynchronize reserves:** pair `skim` and `sync` provide explicit surplus extraction/reconciliation paths; this is expected balance/reserve behavior.
- **Callback can bypass swap settlement:** callback executes under pair lock, after optimistic output, and final balances are checked against the adjusted invariant before reserves update.

## Validation

- Compiled the checked pair with its declared Solidity/optimizer settings and compared its creation-code hash to the router library constant; mismatch reproduced locally.
- No source repository test suite for core/periphery was present; no full local EVM transaction regression was run for the hash mismatch. Its deterministic address divergence follows directly from CREATE2's hash input.
- Independent source review confirmed the hash mismatch and found no pair reserve/LP/protocol-fee defect in the reviewed paths. It independently classified the lock bypass as intent-dependent.
- No live deployment interaction, transaction broadcast, or real-asset test was performed.

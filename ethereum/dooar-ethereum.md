# DOOAR V2 (Ethereum) Evidence Ledger

## Target and implementation identity

- Chain: Ethereum mainnet; GeckoTerminal DEX ID `dooar_ethereum`.
- Sample pool: USDC/WETH `0x9c2dc3d5ffcecf61312c5f4c00660695b32fb3d1`. Its read-only `factory()` call returns `0x1e895bfe59e3a5103e8b7da3897d1f2391476f3c`; `token0/token1` are USDC and WETH.
- Verified router: `0x53e0e51b5ed9202110d7ecd637a4581db8b9879f`, contract `DooarSwapV2Router02`, Solidity 0.6.6, optimizer enabled with 999999 runs; constructor arguments are the factory above and WETH. The router is partially verified and exposes source for its library imports. No public GitHub source repository for the EVM pair/factory was identified during this pass; the pair and factory have no verified source in the queried explorer API. Therefore source-level conclusions apply to the verified router and library, while core-pair behavior is deployment-independent bytecode/source-unverified.
- The router library's CREATE2 init-code hash is `0x8810cdfaaaa2c6c56fdebd83b2c9e7cc71e3ef06ec0c62e029c6476ff05136da`. Computing the CREATE2 address for the factory and USDC/WETH salt reproduces the GeckoTerminal pool address exactly. This verifies router/factory/pool family attribution, not pair source semantics.
- No public deployment was modified or used for state-changing testing.

## Architecture and execution map

- The factory interface exposes pair lookup/creation and the pair interface exposes reserves, LP mint/burn, swap, skim and sync. The verified router implements V2-style liquidity and swap entry points and obtains pair addresses through the checked library hash.
- Router add-liquidity creates a missing pair through the factory, computes reserve-proportional amounts, transfers both tokens and invokes pair `mint`. Remove-liquidity transfers LP shares to the pair and invokes `burn`.
- Exact-input/output swaps calculate path amounts via the library, transfer input to the first pair, route output through subsequent pair addresses, and apply deadline and minimum/maximum checks. Fee-on-transfer variants derive actual input from each pair's balance delta and check the final recipient balance.
- The verified library charges 1%: `amountInWithFee = amountIn * 99`, scaled against 100. Router/pair creation code is internally address-consistent for the sampled pool.

## Critical invariants

- Router amount quotes and pair swap invariant must use the same 99/100 fee factor.
- A successful pair swap must settle input against output atomically and leave reserves consistent with final token balances; router slippage bounds must apply to final recipient deltas where transfer taxes are supported.
- Add/remove-liquidity amounts and LP shares must be derived from the actual pair balances and reserves.
- CREATE2 pair derivation must remain consistent with factory-created pair code and token ordering.
- Reverts at any later hop or minimum/maximum check must roll back all prior-hop state and transfers in the transaction.

## Findings

No confirmed defect was identified in the reviewed router/library paths. The verified source uses the same 99/100 fee coefficient for exact-input and exact-output calculations, derives pair addresses using the hash that reproduces the sampled pool, and checks the recipient's output delta in fee-on-transfer exact-input paths.

## Candidate checks and rejected hypotheses

- **Factory/router/pair init-code hash mismatch:** disproven for the sampled Ethereum pool. CREATE2 derivation from verified router source matches the actual pool address exactly.
- **Incorrect swap fee quote:** not found in the verified router library. It consistently applies the 1% fee factor; no contrary pair source was available to establish a mismatch.
- **Supporting fee-on-transfer ETH output sweeps router WETH balance:** the router reads its full WETH balance before unwrapping in the standard supporting-fee-on-transfer path. This is a familiar donation-handling pattern; no evidence establishes a per-user WETH claim or protocol-owned balance that would make a direct donation an unauthorized withdrawal. Not promoted.
- **Core pair accounting defect:** unverified. Pair/factory source is unavailable in this evidence set, so no source-level claim or finding is made about their internal implementation.

## Validation and limitations

- Read-only metadata and factory/token getter calls verified the sampled pool attribution; CREATE2 derivation was independently recomputed from the verified router source hash.
- No isolated regression suite was run because the core pair/factory source and an attributable local build/test repository were not located. Router quote methods were source-reviewed; no live swap, mint, burn or vulnerability test was attempted.
- This ledger is limited to the DOOAR V2 Ethereum deployment family. DOOAR variants on other chains and V3 pools require separate analysis.

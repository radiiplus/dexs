# Ethereum Lending Research

## Scope and Queue

The queue is based on DeFiLlama's public `https://api.llama.fi/protocols` catalog, filtered to entries whose category is `Lending` and whose chain list contains `Ethereum`. The query returned 168 entries on 2026-11-25. TVL is a prioritization aid only; each review covers the Ethereum implementation and its Ethereum state, not the protocol's other chains. Retired, migrated, or non-contract entries will be marked as attribution/deployment checks rather than counted as completed implementation reviews.

Priority is currently ordered by the catalog's global TVL field, then adjusted when Ethereum deployment identity or implementation scope warrants it. Current starting order:

1. [Aave V3](aave-v3.md) - analyzed
2. [Morpho Blue](morpho-blue.md) - analyzed
3. [SparkLend](sparklend.md) - analyzed
4. [Maple](maple.md) - analyzed
5. [Compound V3](compound-v3.md) - analyzed (Ethereum USDC market)
6. [Venus Core Pool](venus-core-pool.md) - analyzed (Ethereum Core Pool)
7. [Lista Lending](lista-lending.md) - in progress (Ethereum Moolah market and vault system)
8. Aave V4 (`aave-v4`) - queued
9. Fluid Lending (`fluid-lending`) - queued
10. Aave Horizon RWA (`aave-horizon-rwa`) - queued
11. Euler V2 (`euler-v2`) - queued
12. Morpho Midnight (`morpho-midnight`) - queued
13. Cooler Loans (`cooler-loans`) - queued
14. cap (`cap`) - queued
15. Dolomite (`dolomite`) - queued
16. Curve LlamaLend - queued
17. Aave V2 - queued
18. Compound V2 - queued

Progress: 6 complete, 1 in progress, 161 not started. Recheck the DeFiLlama catalog before each batch because membership, chain attribution, and ranking can change. The catalog's TVL and name are not evidence that a deployment is active or controlled by the protocol team. Publish the lending batch after 10 completed protocol analyses.

## Evidence Standard

Each protocol gets its own Ethereum ledger. Record repository and version, verified source and bytecode identity, proxies and implementations, active configuration, execution/state map, accounting invariants, local-fork validation for credible candidates, rejected hypotheses, and open scope. No live deployment writes or real-asset exploit demonstrations are in scope.

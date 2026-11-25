# Lista Lending — Ethereum Evidence Ledger

## Assessment status

**In progress. No findings classified.** This entry records target attribution and source identity only; market configuration, accounting paths, composition, and candidate validation are still being reviewed. Do not treat this preliminary ledger as a clean bill of health.

## Target attribution

- DeFiLlama entry: `lista-lending`, category `Lending`, chains include Ethereum. At the 2026-11-25 catalog read, global TVL was approximately `$754.1m`; this does not establish Ethereum-specific exposure.
- Official Lista Ethereum deployment registry lists Moolah at [`0xf820fB4680712CD7263a0D3D024D5b5aEA82Fd70`](https://etherscan.io/address/0xf820fB4680712CD7263a0D3D024D5b5aEA82Fd70), an EIP-1967 proxy. Blockscout resolved implementation [`0xD7C983093065E0169e955c44ab8370110231D3cf`](https://etherscan.io/address/0xD7C983093065E0169e955c44ab8370110231D3cf).
- The official Ethereum registry also lists MoolahVaults, IRMs, Liquidator/PublicLiquidator, timelocks, a lending fee recipient, oracle/validator components, market factory, providers, and liquidation helpers. Their active relationships and Ethereum market coverage remain to be enumerated before drawing conclusions.
- Official registry: [Lista Lending Ethereum contracts](https://docs.bsc.lista.org/for-developer/lista-lending/smart-contract/smart-contract-ethereum). Source repository: [`lista-dao/moolah`](https://github.com/lista-dao/moolah), inspected at current checkout `402a34a948f907a776337972a83eb5a45ea51877`.

## Source/runtime identity work completed

- The active implementation's explorer-verified main source is `src/moolah/Moolah.sol`, compiler Solidity `0.8.28`, optimizer 200, Paris EVM, `viaIR=true`, with linked `PriceLib` address `0x0dc5e31653cbdcaf0dec9e80fbc942456221953f`.
- Explorer-verified `Moolah.sol` is byte-for-byte identical to [`lista-dao/moolah` commit `48a920a86d87fd2b454f1e191b032b41ac9d258b`](https://github.com/lista-dao/moolah/blob/48a920a86d87fd2b454f1e191b032b41ac9d258b/src/moolah/Moolah.sol), dated 2025-11-27. Current repository HEAD has since changed and is not used as a substitute for the deployed version.
- Recompilation of the explorer source bundle with the reported compiler settings produced a 24,307-byte runtime, the same length as deployed code. After excluding immutable and linked-library reference regions, remaining differences were confined to the trailing CBOR metadata. The linked-library bytes still need a direct address/value check before the final source/runtime identity statement.

## Work remaining

Resolve live Moolah market IDs and active parameters at a pinned Ethereum block; map vaults, IRMs, fee routing, liquidators, brokers/providers, oracles, and timelock permissions; reconstruct supply/withdraw/borrow/repay/liquidate/flash-loan accounting; evaluate sequence and callback invariants; and run isolated fork reproduction only if a credible candidate emerges. The legacy BNB implementation and BNB state are outside this Ethereum ledger.

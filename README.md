# DEX Security Research

Independent, source-led security reviews of decentralized exchange implementations. Each report is scoped to one chain and protocol. Deployment assumptions and local reproduction status are stated per report.

## Progress

- Chain: Ethereum
- Reports complete: 28
- GeckoTerminal Ethereum DEXes remaining at the initial review baseline: 52
- Confirmed source-level defects: 7
- Locally reproduced findings: 6
- Additional unverified candidate: 1 (FraxSwap V2 amount narrowing)
- Next scheduled commit and push: after 10 more DEX analyses

Severity is assigned only where the report contains an explicit severity assessment. Source-level confirmation does not by itself establish deployment exposure or present-day financial impact.

## Ethereum Reports

- [Antfarm](ethereum/antfarm-ethereum.md)
- [ApeSwap](ethereum/apeswap-ethereum.md)
- [Balancer V2](ethereum/balancer-v2-ethereum.md)
- [Concave](ethereum/concave-ethereum.md)
- [Curve Tricrypto](ethereum/curve-tricrypto-ethereum.md)
- [DefiSwap](ethereum/defi-swap-ethereum.md)
- [DOOAR](ethereum/dooar-ethereum.md)
- [ELK Finance](ethereum/elk-finance-ethereum.md)
- [FraxSwap V2](ethereum/fraxswap-v2-ethereum.md)
- [Integral Size](ethereum/integral-size-ethereum.md)
- [KyberSwap Elastic](ethereum/kyberswap-elastic-ethereum.md)
- [KyberSwap Classic](ethereum/kyberswap-classic-ethereum.md)
- [PancakeSwap V2](ethereum/pancakeswap-v2-ethereum.md)
- [PancakeSwap V3](ethereum/pancakeswap-v3-ethereum.md)
- [RadioShack](ethereum/radioshack-ethereum.md)
- [SakeSwap](ethereum/sakeswap-ethereum.md)
- [Spice Trade](ethereum/spice-trade-ethereum.md)
- [ShibaSwap](ethereum/shibaswap-v1.md)
- [SmarDex](ethereum/smardex-ethereum.md)
- [Solidly](ethereum/solidly-ethereum.md)
- [Standard](ethereum/standard-ethereum.md)
- [SushiSwap V2](ethereum/sushiswap-v2.md)
- [Swapr](ethereum/swapr-ethereum.md)
- [TempleDAO Stable AMM](ethereum/templedao-stable-amm.md)
- [Uniswap V2](ethereum/uniswap-v2.md)
- [Uniswap V3](ethereum/uniswap-v3.md)
- [Unicly](ethereum/unicly-ethereum.md)
- [Verse](ethereum/verse-ethereum.md)

## Deferred Target Attribution

- [SafeMoonSwap Ethereum](ethereum/safemoon-ethereum-target-status.md): no pool is currently listed; no Ethereum DEX deployment/source was attributed. Not counted as analyzed.
- [Source index](SOURCE-INDEX.md) lists the repositories and exact source file URLs used for every completed review. Reports for deployments without an accessible matching repository cite their verified explorer source files and disclose the attribution limit.

Regression and reproduction artifacts are stored under `ethereum/` alongside their corresponding report. Antfarm's isolated max-fee regression is `ethereum/antfarm-maxfee-regression.test.js`.

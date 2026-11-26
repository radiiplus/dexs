# DEX Security Research

Independent, source-led security reviews of decentralized exchange implementations. Each report is scoped to one chain and protocol. Deployment assumptions and local reproduction status are stated per report.

## Progress

- Chain: Ethereum
- Reports complete: 41
- GeckoTerminal Ethereum DEXes not yet analyzed from the initial baseline: 33
- Confirmed implementation defects / unauthorized issuance behaviors: 16
- Locally reproduced findings: 15
- Additional unverified candidate: 1 (FraxSwap V2 amount narrowing)
- Next scheduled commit and push: after 10 subsequent DEX analyses

Severity is assigned only where the report contains an explicit severity assessment. Source-level confirmation does not by itself establish deployment exposure or present-day financial impact.

## Ethereum Reports

- [Antfarm](ethereum/antfarm-ethereum.md)
- [ApeSwap](ethereum/apeswap-ethereum.md)
- [9inch DEX](ethereum/9inch-ethereum.md)
- [Balancer V2](ethereum/balancer-v2-ethereum.md)
- [Bitswap (iZiSwap pool)](ethereum/bitswap-iziswap-ethereum.md)
- [Concave](ethereum/concave-ethereum.md)
- [Curve Tricrypto](ethereum/curve-tricrypto-ethereum.md)
- [Composability claims validation](ethereum/composability-claims-validation.md): independent validation of the eight supplied cross-protocol chains.
- [Ethereum composability search](ethereum/composability-search.md): cross-protocol discrepancy-to-payout graph, current state checks, and rejected synthesis candidates.
- [DefiSwap](ethereum/defi-swap-ethereum.md)
- [DOOAR](ethereum/dooar-ethereum.md)
- [ELK Finance](ethereum/elk-finance-ethereum.md)
- [FraxSwap V2](ethereum/fraxswap-v2-ethereum.md)
- [Integral Size](ethereum/integral-size-ethereum.md)
- [JustMoney V2](ethereum/justmoney-ethereum.md)
- [KyberSwap Elastic](ethereum/kyberswap-elastic-ethereum.md)
- [LIF3 V3](ethereum/lif3-v3-ethereum.md)
- [KyberSwap Classic](ethereum/kyberswap-classic-ethereum.md)
- [PancakeSwap V2](ethereum/pancakeswap-v2-ethereum.md)
- [PancakeSwap V3](ethereum/pancakeswap-v3-ethereum.md)
- [Pepedex](ethereum/pepedex-ethereum.md)
- [RadioShack](ethereum/radioshack-ethereum.md)
- [SakeSwap](ethereum/sakeswap-ethereum.md)
- [SaitaSwap](ethereum/saitaswap-ethereum.md)
- [SashimiSwap](ethereum/sashimiswap-ethereum.md)
- [Spice Trade](ethereum/spice-trade-ethereum.md)
- [ShibaSwap](ethereum/shibaswap-v1.md)
- [SmarDex](ethereum/smardex-ethereum.md)
- [Solidly](ethereum/solidly-ethereum.md)
- [Solidly V3](ethereum/solidly-v3-ethereum.md)
- [Standard](ethereum/standard-ethereum.md)
- [SushiSwap V2](ethereum/sushiswap-v2.md)
- [SushiSwap V3](ethereum/sushiswap-v3-ethereum.md)
- [Trader Joe Liquidity Book V2.1](ethereum/traderjoe-v2-1-ethereum.md)
- [Swapr](ethereum/swapr-ethereum.md)
- [TempleDAO Stable AMM](ethereum/templedao-stable-amm.md)
- [Uniswap V2](ethereum/uniswap-v2.md)
- [Uniswap V3](ethereum/uniswap-v3.md)
- [Unicly](ethereum/unicly-ethereum.md)
- [Verse](ethereum/verse-ethereum.md)
- [WAGMI V3](ethereum/wagmi-v3-ethereum.md)
- [WhiteSwap](ethereum/whiteswap-ethereum.md)
- [X7 Finance Xchange](ethereum/x7-finance-ethereum.md)

## Cross-Chain Research

- [Cross-chain research options](cross-chain-options.md): chain and protocol screening with a local Jupiter Lend/JLP fork model. The JLP liquidation path remains unclosed and no profit or confirmed defect is claimed.

## Deferred Target Attribution

- [SafeMoonSwap Ethereum](ethereum/safemoon-ethereum-target-status.md): no pool is currently listed; no Ethereum DEX deployment/source was attributed. Not counted as analyzed.
- [DegenSwap Ethereum](ethereum/degenswap-ethereum-target-status.md): the Ethereum DEX endpoint currently returns no pools and no Ethereum implementation was attributable. Not counted as analyzed.
- [Dex on Crypto Ethereum](ethereum/dex-on-crypto-ethereum-target-status.md): the Ethereum DEX endpoint currently returns no pools and no Ethereum implementation was attributable. Not counted as analyzed.
- [HopeSwap Ethereum](ethereum/hopeswap-ethereum-target-status.md): the Ethereum DEX endpoint currently returns no pools and no Ethereum implementation was attributable. Not counted as analyzed.
- [Surge Protocol Ethereum](ethereum/surge-protocol-eth-target-status.md): the Ethereum DEX endpoint currently returns no pools and no Ethereum implementation was attributable. Not counted as analyzed.
- [Source index](SOURCE-INDEX.md) lists the repositories and exact source file URLs used for every completed review. Reports for deployments without an accessible matching repository cite their verified explorer source files and disclose the attribution limit.

## Lending Research

- [Ethereum lending index](ethereum/lending/README.md): DeFiLlama Ethereum Lending universe and protocol queue (168 entries observed 2026-11-25).
- [Aave V3](ethereum/lending/aave-v3.md): analyzed; Ethereum deployment only.
- [Morpho Blue](ethereum/lending/morpho-blue.md): analyzed; Ethereum singleton only, with a documented but unverified low-borrow-share liveness risk.
- [SparkLend](ethereum/lending/sparklend.md): analyzed; Ethereum Pool revision 4, including Spark bridge paths.
- [Maple](ethereum/lending/maple.md): analyzed on Ethereum through the syrupUSDC Pool, its PoolManager, withdrawal queue, and open-term loan accounting.
- [Compound V3](ethereum/lending/compound-v3.md): analyzed on Ethereum through the USDC-base Comet market and its active extended-asset-list implementation.
- [Venus Core Pool](ethereum/lending/venus-core-pool.md): analyzed on Ethereum through its active beacon-based Comptroller and 23 vToken markets.

Regression and reproduction artifacts are stored under `ethereum/` alongside their corresponding report. 9inch's exact-source 77-pair accounting sweep is `ethereum/9inch-ethereum-fork.test.js`; Antfarm's isolated max-fee regression is `ethereum/antfarm-maxfee-regression.test.js`; Bitswap's iZiSwap source-runtime and fork-state check is `ethereum/bitswap-iziswap-ethereum-fork.test.js`; Ethervista's latest-state boundary characterization is `ethereum/ethervista-k-boundary-fork-test.js`; JustMoney's partial-source 15-pair balance/reserve sweep is `ethereum/justmoney-ethereum-fork.test.js`; LIF3 V3's source-matched factory-created pool principal-width reproduction is `ethereum/lif3-v3-principal-width-fork.test.js`; Pepedex's 26-pair fork characterization is `ethereum/pepedex-ethereum-fork.test.js`; SakeSwap's deployed-bytecode pool sweep and flash-swap regression is `ethereum/sakeswap-gecko-pools-fork.test.js`; Solidly V3's verified-source burn and flash-fee width regression is `ethereum/solidly-v3-ethereum-fork.test.js`; SushiSwap V3's verified-runtime principal-width regression is `ethereum/sushiswap-v3-owed-width-fork.test.js`; Trader Joe V2.1's 15-pair accounting and underpaid-flash-loan rollback check is `ethereum/traderjoe-v2-1-ethereum-fork.test.js`; WAGMI V3's factory-created pool principal-width reproduction is `ethereum/wagmi-v3-principal-width-fork.test.js`; X7's factory-wide repeatable fee-mint regression is `ethereum/x7-finance-mintfee-regression.test.js`, with a pinned seven-call second-pair Anvil regression in `ethereum/xchange-mintfee-fork-test.js`.

# Unicly (Ethereum)

## Target and source attribution

- GeckoTerminal identifier: `unicly`.
- Sampled pool: USDC/WETH at `0x1cf74bebb1974ecd077a308e07b5ef012a49aa98`.
- The verified pair source identifies `UnicSwapV2Pair`; read-only calls returned USDC as `token0`, WETH as `token1`, and factory `0xbacc776b231c571a7e6ab7bc2c8a099e07153377`. The factory's `getPair(USDC, WETH)` returned the sampled pool.
- Verified router: `UnicSwapV2Router02` at `0xe6e90bc9f3b95cdb69f48c7bfdd0ede1386b135a`; read-only getters return that same factory and canonical WETH.
- Deployment-independent source repository: [`uniclyNFT/unicly-core`](https://github.com/uniclyNFT/unicly-core/tree/0bc5a62a311bfdba1521b7dd0e59dd1a9f633956), commit `0bc5a62a311bfdba1521b7dd0e59dd1a9f633956` (2021-10-12). The DEX files are [`UnicSwapV2Factory.sol`](https://github.com/uniclyNFT/unicly-core/blob/0bc5a62a311bfdba1521b7dd0e59dd1a9f633956/contracts/UnicSwap/UnicSwapV2Factory.sol), [`UnicSwapV2Pair.sol`](https://github.com/uniclyNFT/unicly-core/blob/0bc5a62a311bfdba1521b7dd0e59dd1a9f633956/contracts/UnicSwap/UnicSwapV2Pair.sol), [`UnicSwapV2Router02.sol`](https://github.com/uniclyNFT/unicly-core/blob/0bc5a62a311bfdba1521b7dd0e59dd1a9f633956/contracts/UnicSwap/UnicSwapV2Router02.sol), and [`UnicSwapV2Library.sol`](https://github.com/uniclyNFT/unicly-core/blob/0bc5a62a311bfdba1521b7dd0e59dd1a9f633956/contracts/UnicSwap/libraries/UnicSwapV2Library.sol). Solidity 0.6.12 is pinned in the repository's Waffle configuration and package dependencies.
- The deployment's pair, factory, and router are marked source-verified on Blockscout. The router's CREATE2 init-code hash derives the sampled pool address from the factory and sorted token addresses. Read-only router `getAmountsOut` for WETH/USDC returned successfully.

## Architecture and execution map

- `UnicSwapV2Factory.createPair` sorts token addresses, rejects duplicates and zero address, deploys `UnicSwapV2Pair` with CREATE2, calls its factory-only `initialize`, and records both token orders. The factory controls `feeTo` and `feeToSetter`; the pair's swap fee is fixed at 0.3% in pair code.
- The router creates missing pairs for liquidity additions, transfers assets, and calls pair `mint`; liquidity removal transfers LP tokens to the pair and calls `burn`. Swap methods quote paths from reserves, transfer input to the first pair, and chain pair `swap` calls. ETH paths wrap/unwrap WETH and refund unused ETH for exact-output trades.
- `UnicSwapV2Pair` holds LP ERC-20 balances and permit nonces, two `uint112` reserves, cumulative prices, `kLast`, and a lock. `mint` and `burn` use observed balances; `swap` performs optimistic transfers and optional `unicSwapV2Call`, measures final balances, checks the 0.3%-adjusted constant-product invariant, and synchronizes reserves. `skim` transfers excess balances; `sync` adopts actual balances.
- The repository also contains `Zap.sol`, an owner-configured helper that routes tokens through UnicSwap/Sushi routers and deposits resulting LP tokens in the Unicly vault. Its swap-and-deposit balance and route construction paths were reviewed at source level. The NFT vault, farm, and collateral-independent Unicly business contracts are separate components and are not included in this AMM assessment.

## Entry points and invariants reviewed

- Factory: pair creation, pair lookup/enumeration, and fee-recipient administration.
- Router: liquidity add/remove, permit-assisted removal, token/ETH exact-input and exact-output swaps, and amount quotes. Fee-on-transfer swap helpers are present only as commented-out source; the active standard routes do not promise support for taxed transfer tokens.
- Pair: initialization, LP transfer/approval/permit, mint, burn, swap/callback, skim, and sync.
- Zap: user entrypoints `zapInTokenAndDeposit` and `zapInAndDeposit`, route conversion, LP minting, vault deposit, and owner route/recovery controls.
- Invariants: reserves match token balances after successful settlement; the fee-adjusted product check protects each swap; LP issuance/redemption corresponds to underlying balances after protocol fee minting; protocol fee shares are minted only when `feeTo` is nonzero and are accounted for before liquidity mint/burn; reserve values cannot silently truncate past `uint112`; the pair lock contains callback execution; failed operations revert their transfers and storage changes.

## Findings

No confirmed implementation defect was identified in the reviewed UnicSwap factory, pair, router, or Zap paths. This finding status is limited to the source snapshot and sampled Ethereum deployment family.

### Expected behavior: transfer-tax tokens on standard router paths

The active exact-input router functions transfer the nominal amount calculated by the router. If an input token taxes that transfer, the pair observes less input and its invariant check can revert. The fee-on-transfer-aware swap helper implementations are commented out. That is a compatibility limit with atomic rollback, not an accounting loss in the reviewed path.

### Rejected hypotheses

- **Pair initialization can be called repeatedly:** `initialize` requires `msg.sender == factory`; the factory exposes no pair reinitialization method. The constructor fixes `factory` to the deploying factory.
- **Protocol-fee minting is inconsistent with LP ownership:** the pair uses the standard `totalSupply * (sqrt(k) - sqrt(kLast)) / (5 * sqrt(k) + sqrt(kLast))` form and updates `kLast` after mint/burn when fees are on; when fees are off, the next mint/burn clears stale `kLast`.
- **Zap routes or residual balances create a demonstrated claimant mismatch:** the user entrypoints derive the destination LP from the farm pool configuration and deposit LP credited by the vault for `msg.sender`. Whole-contract LP balances can include unsolicited donations or residual dust, but no source-backed prior-user entitlement was found that would turn that behavior into an unauthorized claim or loss.

## Validation and limitations

- No custom regression test was run because no credible defect candidate remained. The repository's checked-in test suite exercises other protocol contracts; it has no dedicated UnicSwap pair/router test file.
- Read-only Ethereum calls confirmed the sampled pair's token/factory links, the factory pair mapping, router factory/WETH values, nonzero `feeTo`, and successful `getAmountsOut` path resolution. No live swap, transfer, deployment, or vulnerability test was performed.
- Explorer source: [sample pair](https://eth.blockscout.com/address/0x1cf74bebb1974ecd077a308e07b5ef012a49aa98#code), [factory](https://eth.blockscout.com/address/0xbacc776b231c571a7e6ab7bc2c8a099e07153377#code), and [router](https://eth.blockscout.com/address/0xe6e90bc9f3b95cdb69f48c7bfdd0ede1386b135a#code).
- GeckoTerminal pool record: [USDC/WETH](https://www.geckoterminal.com/eth/pools/0x1cf74bebb1974ecd077a308e07b5ef012a49aa98).

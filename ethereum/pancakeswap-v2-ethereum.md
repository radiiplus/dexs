# PancakeSwap V2 (Ethereum)

## Target and source attribution

- GeckoTerminal identifier: `pancakeswap_ethereum`.
- Sampled pool: USDC/WETH at `0x2e8135be71230c6b1b4045696d41c09db0414226`.
- The verified `PancakePair` reports USDC/WETH and factory `0x1097053fd2ea711dad45caccc45eff7548fcb362`. The verified factory's `getPair(USDC, WETH)` returns the sampled pool.
- Verified factory: `PancakeFactory` at `0x1097053fd2ea711dad45caccc45eff7548fcb362`. Verified router: `PancakeRouter` at `0xeff92a263d31888d860bd50809a8d171709b7b1c`; its `factory()` getter matches and `WETH()` returns canonical Ethereum WETH.
- Factory, pair, and router explorer metadata identify Solidity 0.5.16 or 0.6.6 as applicable, with optimization enabled for 99,999 runs. Pair and factory are verified at the deployed addresses. The router's CREATE2 init-code hash derives the sampled pair address when combined with the factory and sorted token addresses.
- Official deployment documentation is in [`pancakeswap/pancake-developer`](https://github.com/pancakeswap/pancake-developer/tree/c7a9ae547c0ddaa15b439172291d51594a384e78): [`V2 addresses`](https://github.com/pancakeswap/pancake-developer/blob/c7a9ae547c0ddaa15b439172291d51594a384e78/docs/pages/contracts/v2/addresses.md) and [`Router V2 reference`](https://github.com/pancakeswap/pancake-developer/blob/c7a9ae547c0ddaa15b439172291d51594a384e78/docs/pages/contracts/v2/router-v2.md). The documentation points to `pancakeswap/pancake-contracts` for the source, but that repository is no longer publicly resolvable. Exact deployment source is therefore cited from the verified explorer pages below.
- The reachable historical [`pancakeswap/pancake-swap-periphery`](https://github.com/pancakeswap/pancake-swap-periphery/tree/d769a6d136b74fde82502ec2f9334acc1afc0732) includes [`PancakeRouter.sol`](https://github.com/pancakeswap/pancake-swap-periphery/blob/d769a6d136b74fde82502ec2f9334acc1afc0732/contracts/PancakeRouter.sol) and [`PancakeLibrary.sol`](https://github.com/pancakeswap/pancake-swap-periphery/blob/d769a6d136b74fde82502ec2f9334acc1afc0732/contracts/libraries/PancakeLibrary.sol), but its quote coefficient is 998/1000. That is not the router source deployed for this Ethereum V2 instance: the verified deployed router uses 9975/10000 and derives the sampled pool address. The historical repository is not used as deployment attribution.

## Architecture and execution map

- `PancakeFactory.createPair` sorts tokens, rejects identical/zero/duplicate pairs, deploys `PancakePair` using CREATE2, initializes the pair, writes both lookup directions, and appends it to `allPairs`. The factory owner controls `feeTo` and `feeToSetter`.
- `PancakeRouter` creates pairs for liquidity additions, routes add/remove liquidity, wraps/unwraps WETH, and executes exact-input/exact-output token and ETH swaps. Its fee-on-transfer paths measure actual pair input or recipient output delta. The verified deployed router's amount formulas use 9975/10000, matching the pair invariant's 25/10000 deduction.
- `PancakePair` stores LP ERC-20/permit state, `uint112` reserves, cumulative prices, `kLast`, and a reentrancy lock. Mint/burn use observed balances and protocol LP minting; swaps optimistically transfer output, optionally call `pancakeCall`, measure settled balances, enforce the adjusted product check, then update reserves. `skim(to)` transfers excess balances; `sync` reconciles reserves to actual balances.
- Factory fee state is mutable by `feeToSetter`. In the read-only configuration snapshot, `feeTo` and `feeToSetter` were nonzero. Pair swap fee is fixed in pair source at 0.25%.

## Entry points and invariants reviewed

- Factory: pair creation, lookup/enumeration, `setFeeTo`, and `setFeeToSetter`.
- Router: add/remove liquidity, permit-assisted removal, exact-input/output token/ETH swaps, fee-on-transfer variants, and quote paths.
- Pair: initialization, ERC-20 transfer/permit, mint, burn, swap/callback, skim, sync, and cumulative-price updates.
- Invariants: reserve values match observed balances after successful state transitions; swaps satisfy the 0.25%-adjusted K inequality; router quote math matches pair settlement math; LP claims track pro-rata underlying balances after protocol fee shares; protocol LP is minted from `sqrt(k)` growth at mint/burn; reserves cannot silently truncate above `uint112`; callback execution stays inside the pair lock; failed settlement rolls back transfers and state.

## Findings

No confirmed implementation defect was identified in the verified Ethereum V2 factory, pair, and router paths.

### Rejected hypothesis: protocol fee share is inconsistent with swap fee

The pair mints protocol LP as `totalSupply * (rootK - rootKLast) * 8 / (rootK * 17 + rootKLast * 8)`. This represents 8/25 of `sqrt(k)` growth for the fee recipient. Combined with the 0.25% swap charge and 0.17% left in pool reserves, this matches PancakeSwap's documented V2 fee split: 0.17% to LPs and 0.08% to the protocol. The protocol portion's later distribution is outside this pair/factory/router scope. The source formula and documented intent align, so the unusual 8/25 coefficient is not a finding.

Other reviewed boundaries did not produce a credible candidate: exact-output input math rounds upward, pair balances are measured after callback, fee-on-transfer paths use deltas, reserve overflow reverts before casts, and factory-created pairs use the same init-code hash as router derivation.

## Validation and limitations

- No custom regression test was run because no credible defect candidate remained. The deleted core source repository prevents a local build from the original core source; the deployed factory, pair, and router are independently source-verified.
- Read-only Ethereum calls confirmed pool/factory/router links, fee recipient configuration, pair lookup, and CREATE2 derivation. No live swap, transfer, deployment, or vulnerability test was performed.
- Verified deployed sources: [factory](https://eth.blockscout.com/address/0x1097053fd2ea711dad45caccc45eff7548fcb362#code), [sample pair](https://eth.blockscout.com/address/0x2e8135be71230c6b1b4045696d41c09db0414226#code), and [router](https://eth.blockscout.com/address/0xeff92a263d31888d860bd50809a8d171709b7b1c#code).
- GeckoTerminal pool record: [USDC/WETH](https://www.geckoterminal.com/eth/pools/0x2e8135be71230c6b1b4045696d41c09db0414226).
- PancakeSwap's current documentation describes the 0.25% V2 fee breakdown in its [trading fee reference](https://docs.pancakeswap.finance/trade/pancakeswap-exchange/trade) and [liquidity-pool fee reference](https://docs.pancakeswap.finance/earn/pancakeswap-pools).

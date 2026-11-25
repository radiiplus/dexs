# Composability Claims Validation (Ethereum)

This note evaluates the eight cross-protocol chains proposed for the Ethereum evidence corpus. A behavior reproduced on a local fork is distinguished from source-only behavior and from a complete, economically exploitable chain. Fork transactions were sent only to local Ganache state; no public deployment was mutated.

## Summary

| Claim | Deployment/source check | Validation | Disposition |
|---|---|---|---|
| Pancake V3 burn principal narrowing | Sample pool, factory, and pool deployer match verified runtime outside immutable references | Reproduced on fork with token ordered both ways | Confirmed accounting defect; principal remains stranded, not extracted |
| Temple IV treasury branch | Historical source inspected; deployment linkage and current router inventory not established | No deployed-bytecode or economic-state reproduction | Plausible conditional treasury exposure; not a demonstrated drain |
| FraxSwap oversized TWAMM order | Fork runtime equals explorer bytecode; available source build differs by 29 bytes | No local regression | Source candidate only; permanent freeze/recovery claim unverified |
| SakeSwap `dealSlippageWithIn` plus `skim` | Fork runtime equals explorer bytecode; available source build differs by 61 bytes | Reproduced on sampled deployed pair bytecode | Confirmed unauthorized SST issuance; present value impact unverified |
| Antfarm oracle reselection | Factory runtime exact; sampled pair runtimes match outside immutable references | Read-only candidate-pool inspection; no execution regression | Plausible capital-backed cross-block candidate, unverified |
| Balancer composable stable exploit | Different pool family from reviewed weighted sample | Official postmortem cross-check | Scope gap is real; supplied amount and read-only-reentrancy chain are inaccurate |
| Concave exact-output quote as contract drain | Source/local arithmetic reproduction; deployed runtime not matched | No identified victim caller or local fork chain | Quote defect is supported; JIT-LP drain is conditional and unproven |
| SushiRoll migration / reserve manipulation | Source-level review only; deployment runtime not matched | No deployed-bytecode fork reproduction | Loss and attacker-profit claims remain unverified and caller-dependent |

## Per-Claim Evidence

### A. PancakeSwap V3 principal narrowing

The sampled pool, factory, and pool deployer were compiled from Blockscout verified inputs using the published compiler settings and matched the forked runtime outside immutable slots. The fork regression created a synthetic-token pool through the deployed factory and pool-deployer code, minted and burned `2^100` liquidity below the tick cap, then collected the position's `uint128` owed amount. Two runs covered both token orderings. In one, principal was `23383147255763361652596368835263821157990861465632` raw units and the position recorded/collected `336459673127891212220047737287230973984`; the rest stayed in the pool. This confirms the inherited narrowing behavior for the sampled implementation. It demonstrates loss of a position's claim, not a transfer to the caller; the proposed vault/NAV arbitrage remains hypothetical. See [Pancake V3 report](pancakeswap-v3-ethereum.md) and [fork regression](pancakeswap-v3-owed-width-fork.test.js).

### B. TempleDAO administered-IV branch

The source branch burns TEMPLE and transfers `defendStable` from router inventory when the IV quote beats the AMM quote. That can be a standing administered-price buy order if the configured IV exceeds TEMPLE's attainable acquisition price after price impact and fees. The supplied example assumes a persistent IV premium and available router inventory; neither was established against matched deployed runtime or current chain state. The archived AMM's deployment linkage remains unverified. Classify as a conditional treasury exposure, not a confirmed exploit.

### C. FraxSwap oversized TWAMM order

The sampled pair's fork runtime equals Blockscout's deployed-bytecode field. Compiling the explorer's flattened source with its listed Solidity 0.8.15, London, and optimizer settings differs by 29 bytes outside immutable references, so exact source attribution is unresolved. The repository source narrows escrow to `uint112` while deriving the sale rate from the full-width amount, which can make virtual execution underflow for `2^112 + r`. The local fork did not reproduce the state transition. Cancellation also runs virtual execution first, so an underflow can block cancellation; however, the pause escape is privileged (`onlyOwnerOrFactory`), requires the factory's global pause, and is one-way. A successful oversized order would require real token supply/balance and lock capital across execution time. Keep as a source-level candidate until a matching-runtime regression establishes the order, cancellation, and pause transitions.

### D. SakeSwap helper plus `skim`

At fork block `26,491,876`, all 28 GeckoTerminal pool addresses shared the same deployed runtime hash. Twenty-six had nonzero reserves; all 26 minted SST when the actual `dealSlippageWithOut` entry point was called at one-quarter of output reserves, with token balances and reserves unchanged. The WETH-funded `dealSlippageWithIn` path minted SST in 17 active WETH pools; `skim` recovered the donation in 16, while NUX/WETH's `skim` reverted because NUX returns false for a zero-value transfer. A local Uniswap V2 flash swap funded the WETH/USDT helper call, recovered the donation, and repaid the provider, paying a `0.000150451354062187 WETH` fee. The fork runtime equals Blockscout's reported bytecode; available source compiles to a runtime differing by 61 non-immutable bytes, so exact repository-source identity remains unresolved. No current monetary value for SST was established. See [SakeSwap report](sakeswap-ethereum.md) and [pool-sweep/flash regression](sakeswap-gecko-pools-fork.test.js).

### E. Antfarm permissionless oracle reselection

Factory source and runtime match exactly; sampled `AntfarmPair` and `AntfarmAtfPair` runtimes match verified source outside constructor immutables. The source allows anyone to call `updateOracle`, but selection is limited to fee-10 ATF pairs for the victim pair's two tokens and chooses the largest ATF `reserve0`. The sampled DAI/MKR pair currently has a DAI/ATF candidate at `reserve0 = 3,955` raw ATF units and no MKR/ATF candidate. Creating a competing MKR/ATF pool is permissionless, but its one-hour price average and reserve ranking require a cross-block, capital-backed setup. No fork test has yet shown a switch, resulting fee delta, or net attacker value. The original claim describes a credible candidate, not a demonstrated fee-oracle hijack. See [Antfarm report](antfarm-ethereum.md).

### F. Balancer V2 incident and scope

The reviewed Balancer report covers the Vault and `WeightedPool2Tokens`, while the real incident affected Composable Stable Pools. Balancer's [Nov. 18, 2025 postmortem](https://medium.com/balancer-protocol/nov-3-exploit-post-mortem-51dcbeb6b020) attributes the incident to exact-output StableMath rounding combined with rate providers and low liquidity; composable BPT swaps enabled the low-liquidity state. It states $94.8M stolen and $121.1M total losses across five chains, and says Weighted Pools were unaffected. This validates the need for a separate CSP review, not a finding in the weighted implementation. The supplied $128M/six-chain figure and proposed transient-`getInvariant()` read-only-reentrancy path are not the mechanism described in the official postmortem.

### G. Concave exact-output overquote

The source formula and arithmetic harness support a serious exact-output quote defect. They do not establish that a live contract pays the overquote. A JIT-LP capture chain needs a specific caller with permissive `amountInMax`, a route to the affected pair, and an ability to capture the retained excess after the swap. No such victim caller or deployed runtime match was identified. Report the quote defect separately from any contract/treasury drain scenario.

### H. SushiRoll migration and generic `skim` consumers

The migration concern is based on repository source; deployed runtime identity and a live migration caller were not established. The proposed reserve manipulation needs a particular victim migration transaction and an exact accounting trace showing which tokens are refunded versus left behind. It remains unverified. Likewise, the generic claim that an integrator reads inflated `balanceOf(pair)` before the attacker calls `skim` has no identified consumer or transaction sequence. Atomicity does not make the donation itself a loss: a concrete consumer must use that transient balance to issue value before the donation is reclaimed. Treat both as investigation leads, not findings.

## Overall Assessment

The supplied analysis found two strong additions that reproduce on sampled deployed bytecode: Pancake V3 principal narrowing and SakeSwap `dealSlippageWithIn` issuance followed by donation recovery. Antfarm oracle reselection is a source/runtime-supported candidate that still needs a local state-transition regression and impact proof. FraxSwap, Temple, Concave, and SushiRoll need source/runtime or caller/deployment linkage before the proposed cross-contract financial chains should be presented as confirmed. Balancer's real incident is relevant evidence for the excluded pool family, not for the weighted sample already reviewed.

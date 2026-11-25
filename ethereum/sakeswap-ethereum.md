# SakeSwap (Ethereum) Evidence Ledger

## Target and source

- Chain: Ethereum mainnet; GeckoTerminal DEX ID `sakeswap`.
- Sample pool: WETH/USDT `0xe2e5aca8e483a4c057892ee1f03bebc9bfa1f9c2`. Read-only `factory()` returned `0x75e48C954594d64ef9613AeEF97Ad85370F13807`, matching the SakeSwap Ethereum factory. Blockscout reports `SakeSwapPair`, Solidity 0.6.12, optimizer enabled.
- Public repository: `Sakeswap/sakeswap-protocol`, commit `094dd1d3b6cbd1f9cdfeb9a9888a14b923880af5` (2021-04-28). The deployed pair/router are partially verified; source names and compiler metadata align, but exact runtime-to-commit matching was not performed. The checked-out library's pair init-code hash differs from the verified Ethereum router's embedded hash; the router's verified source uses the deployment's matching hash, and a read-only `getAmountsOut` call succeeded. No live state-changing or exploit-shaped call was made.

## Architecture and execution map

- `SakeSwapFactory` creates sorted-token `SakeSwapPair` instances with CREATE2 and controls fee recipient, migrator and fee setter. `SakeSwapPair` stores LP shares, token reserves, cumulative prices, virtual-price state and a per-pair `SakeSwapSlippageToken` (`SST`) created at pair initialization.
- Normal `swap` uses the V2 constant-product invariant with a 0.3% fee, transfers output before optional callback, measures final balances, validates adjusted balances, and updates reserves under the pair lock. Mint/burn use observed balances and update `kLast`; `skim` and `sync` reconcile excess or actual balances.
- The router uses standard V2 amount quoting and routes swaps through pair addresses. For single-hop trades it calls `dealSlippageWithIn/Out` before the core pair `swap`, optionally minting SST to the user. The router call and later swap are transaction-atomic, but the pair functions are also public external entry points.
- `SakeSwapSlippageToken.mint` is restricted to its owner pair. `STokenMaster` accepts pool LP tokens and SST and distributes SAKE according to configured pool allocation and emissions.

## Critical invariants

- SST rewards should correspond to a completed swap and its calculated slippage; arbitrary quote inputs must not independently create transferable reward supply.
- A successful swap must preserve the fee-adjusted K invariant and leave pair reserves equal to observed balances.
- SST issuance, recipient and calculated amount must use the same direction, token units and settled swap amounts as the router's execution.
- LP mint/burn and protocol fee accounting must preserve ownership claims; oracle and virtual-price state must correspond to completed swaps.
- Router pair derivation, factory pair creation code and verified Ethereum deployment bytecode must agree.

## Findings

### Low: public exact-output slippage helper mints SST without swap settlement

Status: **Confirmed source defect and reproduced locally. Present-day financial loss from the minted SST is not established.**

At `contracts/sakeswap/SakeSwapPair.sol:388-415`, `dealSlippageWithOut` is `external lock`; it has no router/caller authorization and does not transfer input, check an input balance delta, or execute `swap`. With `ifmint == true`, it computes `amountInReal - amountInPool` and calls `stoken.mint(to, mintAmount)` at lines 410-414. The router normally calls this helper before funding the pair and then proceeds to transfer input and swap (`SakeSwapRouter.sol:351-367`), relying on transaction rollback to bind helper minting to the eventual swap. A direct caller bypasses that composition entirely.

The intended invariant is that SST issuance represents the slippage reward from a successful swap. In the isolated regression, a synthetic user calls `dealSlippageWithOut([token0, token1], reserve1 / 2, user, true)` without any token transfer or swap. The call mints SST while both pair token balances and both reserves remain unchanged. The pair's SST contract only permits its owner pair to mint, so the pair entry point is the relevant authorization boundary.

Deployment evidence establishes that `STokenMaster` pool 0 accepts SST `0xf220b808807bc66062fd6eaddff846268a5d4b30`, which is the `stoken()` of its registered SakeSwap LP pair `0xac10f17627cd6bc22719ceebf1fc524c9cfdc255`; this pool has a nonzero allocation. However, read-only state at Ethereum block `0x19438a8` showed `STokenMaster.endBlock = 0xa92842`, so its SAKE emissions had ended. I did not establish a current market price or a live extraction path. Therefore this is reported as unauthorized reward-token issuance, not as demonstrated current SAKE theft or reserve loss.

Remediation: restrict slippage minting to the configured router or move the mint into the settlement path after the pair has verified a completed swap. Validate the output/input direction and derive the SST amount from settled deltas. Add tests that direct helper calls cannot mint, while single-hop exact-input and exact-output router swaps still mint the expected reward atomically.

## Rejected candidates

- **Router pair-code-hash mismatch:** the public repository's `SakeSwapLibrary` contains a different hash from the README's Ethereum pair hash, but the deployed verified Ethereum router source embeds the hash that derives the sampled deployed pair. A read-only router quote succeeded; no deployed router mismatch finding is supported.
- **Core fee versus router quote mismatch:** the pair applies 997/1000 and the library uses the same factor.
- **Farmable SST implies current extraction:** the farm configuration accepts the pair's SST, but its configured reward end block predates the observed chain block. No present SAKE reward extraction was demonstrated.
- **SST amount direction/decimal conversion:** source contains orientation-dependent conversions that warrant targeted review, but no user-value loss or violated token-denomination invariant was established in this pass. Not promoted to a finding.

## Isolated validation and limitations

- `sakeswap-free-mint-regression.test.js` was run against the source contracts on local Ganache 7.9.2 with Solidity 0.6.12 and temporary Node 16.20.1. Result: 1 passing. It asserts SST recipient balance increases while pair token balances and reserves do not change.
- The regression does not establish an external value for newly minted SST. The Ethereum farm configuration was read only; no live farm deposit, reward claim, swap, or mint was attempted.
- No conclusion is transferred to SakeSwap on BSC or another chain; periphery hashes and deployed implementations differ by network.

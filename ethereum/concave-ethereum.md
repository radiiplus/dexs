# Concave Gemswap (Ethereum) Evidence Ledger

## Scope and target identity

- Chain: Ethereum mainnet, GeckoTerminal network `eth`.
- GeckoTerminal DEX ID: `concave`; sampled pool `0x91a795615100ff5d479caf4098a688066138cfaa` (`pCNV / DAI`).
- Public source: `https://github.com/ConcaveFi/concave-core`, reviewed commit `9bd1ce0c8e17b215197227f838d68a7d87807a67` (2023-03-21). Concave's frontend repository `ConcaveFi/concave-frontend`, commit `267bfde0775e9daef88564bfdc0aa58c3e4da244`, publishes the Ethereum factory/router addresses and the Gemswap SDK.
- Frontend constants list factory `0x066a5cb7ddc6d55384e2f6ca13d5dd2cd2685cbd` and router `0x0a3e1c20b5384eb97d2ccff9a96bc91f0c77e7db` (`libs/core/src/constants/addresses.ts:68-85`). SDK lists pCNV/DAI pair `0x91a795615100ff5d479caf4098a688066138cfaa` in `apps/cave/components/PCNV/whitelist.json:359` and the pair address cache (`libs/gemswap-sdk/src/fetcher.ts:25-34`). These are source/frontend identification claims; deployment runtime bytecode was not matched to the reviewed commit.
- Solidity source pragma is `>=0.8.0`; local regression compiled using solc 0.8.24. `foundry.toml` configures the source and dependencies but no Gemswap-specific test directory or protocol regression suite was present in this checkout.

## Architecture and execution map

- `GemswapFactory` owns pool-type configuration. `newPoolType` records an implementation; `allowPoolType` enables it. `createPair` sorts tokens, requires an enabled pool type, deploys an EIP-1167 clone with CREATE2 using sorted tokens and pool type in the salt, initializes it with a 25 bps fee, and records both token orders. The two-argument factory/router integration uses pool type 1.
- `GemswapPair` is clone implementation code with per-clone token addresses, swap fee, reserves, cumulative prices, LP supply and reentrancy status. It exposes `initialize`, `mint`, `burn`, `swap` (including Uniswap V2 callback), `skim`, and `sync`. Token balances are read at each value transition; successful mint/burn/swap operations update reserves afterward.
- `GemswapRouter` stores immutable factory, pair implementation, and WETH addresses. It routes add/remove liquidity, native ETH wrapping/unwrapping, exact-input and exact-output swaps, EIP-2612/permit-allowed paths, and fee-on-transfer-token paths. Most pair addresses are reconstructed by `GemswapLibrary.pairFor`; exact-output operations call `getAmountsIn`, transfer the returned input to the first pair, then swap the requested output. They do not refund unused excess input.
- `GemswapLibrary` implements CREATE2 clone addressing, reserve ordering, 25 bps output math, and chained exact-in/exact-out calculations. Frontend `Pair.getInputAmount` separately calculates an exact-output quote with 0.3% fee math, which is more conservative than the pair's 0.25% fee but uses the usual `(reserveOut - amountOut) * feeDenominator` denominator. This means frontend and contract exact-output calculations disagree materially because the contract expression is defective.
- No protocol fee minting or treasury fee accounting is present in the pair implementation reviewed. The LP invariant is enforced directly by the pair's fee-adjusted K check.

## Entry points and state transitions reviewed

- Factory: `createPair` overloads, `getPair` overloads, pool type creation and allowlisting.
- Pair: `initialize`, `mint`, `burn`, `swap`, `skim`, `sync`, LP ERC-20 transfer/approval/permit.
- Router: add and remove liquidity variants; exact-input and exact-output token/ETH swaps; permit wrappers; supporting-fee-on-transfer paths; exposed quote helpers.
- Library: CREATE2 prediction, pair lookup, reserve selection, `getAmountOut`, `getAmountIn`, and multi-hop path loops.

## Critical invariant catalogue

- LP minting uses actual token balance minus stored reserve; after share mint, reserves are synchronized to balances. First mint locks 10,000 LP units at address zero and requires nonzero remaining liquidity.
- LP burning consumes LP units transferred to the pair and distributes actual token balances pro rata to total supply; transfers and reserve updates are atomic.
- Pair swaps measure actual input after output transfers/callbacks. For fee `f=25` over `D=10,000`, the pair requires `(balance0*D - amount0In*f) * (balance1*D - amount1In*f) >= reserve0*reserve1*D^2` before reserve synchronization.
- Router exact-output paths should transfer the minimum input satisfying the pair invariant for the requested output and honor the caller's `amountInMax`; a slippage allowance should bound any excess.
- `skim` transfers only balances above reserves; `sync` deliberately adopts current balances as reserves. Both are permissionless V2-style operations.
- Pair lock is set during clone initialization and surrounds mint, burn, swap, skim and sync. Failed external token/callback operations revert the whole transaction.

## Findings

### M-01: Exact-output quote subtracts a fee-scaled output from the reserve

- Severity: Medium. Confirmed source defect with local EVM reproduction; deployment applicability unverified.
- Location: `src/amm/libraries/GemswapLibrary.sol:88-94`, specifically line 93. Exact-output router paths use this function at `src/amm/GemswapRouter.sol:292-308`, `326-347`, and `371-386`; the public quote helper also delegates to it at `579-585`.
- Intended formula for a 25 bps fee is `reserveIn * amountOut * 10_000 / ((reserveOut - amountOut) * 9_975) + 1`. Source instead uses `reserveOut - amountOut * 9_975`.
- With reserves `reserveIn=1,000,000`, `reserveOut=10,000,000`, and requested output `1,000`, the source helper returned `400,000,001`; the correct minimum input is `101`. The amount is inflated by about 3,960,396 times. Since the router transfers the full calculated amount and does not refund excess, a caller using a permissive `amountInMax` transfers the excess into the pair. For this example, `399,999,900` extra units remain in pool balances/reserves after the swap.
- A local evaluation of the pair's exact fee-adjusted K condition accepts this overquote: adjusted K is about 399.96 times the pre-swap K. Thus the pair does not roll back the overpayment as an invalid swap. More commonly, a UI-derived near-minimum `amountInMax` causes the router's `EXCESSIVE_INPUT_AMOUNT` check to revert. The error also makes checked subtraction revert whenever `amountOut * 9,975 >= reserveOut`, approximately at requested outputs of 0.010025% of output reserves or higher. This breaks exact-output operations for that range.
- Reproduction: [concave-exact-output-regression.js](./concave-exact-output-regression.js) compiles the repository's actual `GemswapLibrary.sol` into a small harness and calls it on an ephemeral Ganache chain. It asserts the `400000001` versus `101` result, checks that the pair's source K expression accepts the excess, and asserts revert at output `1003` for the same reserves. Run with solc, ethers, and ganache installed and `CONCAVE_CORE_PATH` set to the checkout path.
- Root cause: operator precedence / incorrect placement of the fee multiplier in the denominator. Exact-in and pair swap math use fee scaled by 10,000; exact-out did not preserve the required product `(reserveOut - amountOut) * feeFactor`.
- Remediation: compute `(reserveOut - amountOut) * (BIPS_DIVISOR - 25)` with checked arithmetic, retain the final `+1`, and add boundary and stateful router tests asserting minimum input, `amountInMax` behavior, pair K acceptance, and absence of retained excess.

## Validation and limitations

- Local EVM regression result: passed. `sourceQuote=400000001`, `correctQuote=101`, `excessInputRetainedByPair=399999900`, pair adjusted-K condition true, checked underflow at requested output 1,003.
- This reproduction deploys and calls the actual library source in a fresh local Ganache instance. The pair invariant acceptance is evaluated from the exact pair expression against the resulting input/output values; the full factory-clone-router-pair flow was not deployed as an integration fixture.
- No project-owned Gemswap test suite was found in this source checkout. No test or transaction was run against a public deployment.
- Independent reviewer separately confirmed the formula defect, checked boundary and exact-output consequences. No live execution was performed.
- Deployment applicability remains unverified because the reviewed source and frontend address constants were not bytecode-matched to the published Ethereum contracts.

## Rejected hypotheses and expected behavior

- Pair swap allows `baseAmountOut == reserve0` while rejecting `quoteAmountOut == reserve1`; this asymmetry is not independently exploitable because measured input and the fee-adjusted K condition still require enough replacement value. It is not reported as a defect.
- Pair `initialize` has no caller restriction, but each clone is created and initialized atomically inside factory `createPair`; a pre-created clone cannot be initialized by an outsider between those steps, and initialized clones have `swapFee=25`, satisfying its one-time sentinel.
- SDK swap quotes use 0.3% (`997/1000`) while the pair uses 0.25% (`9975/10000`), which is conservative for exact-input estimates. The SDK's initial LP minimum is also 1,000 while the pair locks 10,000. These cause estimate mismatches but do not by themselves create a reserve-accounting defect; the exact-output library formula above is the material user-value issue.
- `swapExactTokensForETHSupportingFeeOnTransferTokens` reads the router's entire WETH balance rather than a call-local delta before unwrapping. This resembles the standard V2 supporting-fee path and can expose accidentally stranded WETH to a future caller; no evidence established that such a balance is intended user-owned accounting, so it is not classified as a confirmed finding.

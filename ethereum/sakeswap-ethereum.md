# SakeSwap (Ethereum) Evidence Ledger

## Target and source

- Chain: Ethereum mainnet; GeckoTerminal DEX ID `sakeswap`.
- GeckoTerminal snapshot on 2026-11-25: 28 Ethereum pools across pages 1-2. All 28 addresses return the same 15,968-byte runtime hash `0x7e7907605e4c2a33f9688a9e6757bef447af6b66d2da0cb94d44730242f304c8` on the local fork. Twenty-six had nonzero reserves; SRM/WETH and YFI/WETH were empty.
- Sample pool: WETH/USDT `0xe2e5aca8e483a4c057892ee1f03bebc9bfa1f9c2`. Read-only `factory()` returned `0x75e48C954594d64ef9613AeEF97Ad85370F13807`, matching the SakeSwap Ethereum factory. Blockscout reports `SakeSwapPair`, Solidity 0.6.12, optimizer enabled.
- Public repository: [`Sakeswap/sakeswap-protocol`](https://github.com/Sakeswap/sakeswap-protocol/tree/094dd1d3b6cbd1f9cdfeb9a9888a14b923880af5), commit `094dd1d3b6cbd1f9cdfeb9a9888a14b923880af5` (2021-04-28). Relevant files are [`SakeSwapPair.sol`](https://github.com/Sakeswap/sakeswap-protocol/blob/094dd1d3b6cbd1f9cdfeb9a9888a14b923880af5/contracts/sakeswap/SakeSwapPair.sol), [`SakeSwapFactory.sol`](https://github.com/Sakeswap/sakeswap-protocol/blob/094dd1d3b6cbd1f9cdfeb9a9888a14b923880af5/contracts/sakeswap/SakeSwapFactory.sol), and [`SakeSwapRouter.sol`](https://github.com/Sakeswap/sakeswap-protocol/blob/094dd1d3b6cbd1f9cdfeb9a9888a14b923880af5/contracts/sakeswap/SakeSwapRouter.sol). The deployed pair is partially verified. Its forked runtime exactly equals the Blockscout-reported deployed bytecode, but compiling the available pair source with explorer compiler settings leaves 61 non-immutable bytes different, so exact source-to-runtime identity is unresolved. The checked-out library's pair init-code hash differs from the verified Ethereum router's embedded hash; the router's verified source uses the deployment's matching hash, and a read-only `getAmountsOut` call succeeded. Verified source pages: [sample pair](https://eth.blockscout.com/address/0xe2e5aca8e483a4c057892ee1f03bebc9bfa1f9c2#code), [factory](https://eth.blockscout.com/address/0x75e48c954594d64ef9613aeef97ad85370f13807#code). Fork tests were run only against a local Ethereum fork; no transaction was sent to the public deployment.

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

Status: **Confirmed deployed-bytecode behavior across all 26 active GeckoTerminal pools on a local fork. Present-day financial loss from the minted SST is not established. Exact repository-source attribution remains unresolved.**

At `contracts/sakeswap/SakeSwapPair.sol:388-415`, `dealSlippageWithOut` is `external lock`; it has no router/caller authorization and does not transfer input, check an input balance delta, or execute `swap`. With `ifmint == true`, it computes `amountInReal - amountInPool` and calls `stoken.mint(to, mintAmount)` at lines 410-414. The router normally calls this helper before funding the pair and then proceeds to transfer input and swap (`SakeSwapRouter.sol:351-367`), relying on transaction rollback to bind helper minting to the eventual swap. A direct caller bypasses that composition entirely.

The intended invariant is that SST issuance represents the slippage reward from a successful swap. In [sakeswap-gecko-pools-fork.test.js](sakeswap-gecko-pools-fork.test.js), the local fork iterates every listed pool, tests a valid output equal to one quarter of the output reserve, and calls the actual pair runtime directly without input transfer or swap. All 26 active pools minted SST; both token balances and reserves were asserted unchanged for every call. The two empty pools were skipped. All 28 forked pool runtimes had the same hash, and the sampled WETH/USDT runtime equals Blockscout's deployed-bytecode field. The pair-owned SST minter therefore exposes an unguarded issuance entry point in the deployed runtime family.

### Low: exact-input slippage helper mints SST against a recoverable donation

Status: **Confirmed behavior in 17 active WETH pools on a local fork; 16 donation/skim cycles recovered the input, while NUX/WETH minted SST but `skim` reverted due to the NUX token's zero-transfer behavior. Financial impact is unverified.**

The public `dealSlippageWithIn(address[] path,uint256 amountIn,address to,bool ifmint)` path checks that the pair has at least `amountIn` excess input balance, then computes and mints the difference between its pool and market output quotes when `ifmint` is true. It does not perform a swap or consume that excess. The check binds the helper to a temporary balance surplus, not to completed settlement. Since `skim(to)` is permissionless and returns balances above reserves, a caller can donate input, invoke the minting helper, and recover the donation without changing reserves.

The multi-pool regression donates 5% of each active WETH reserve, calls the helper with the WETH input path, and then calls `skim`, all inside an isolated fork snapshot. Seventeen active WETH pools minted SST. Sixteen returned the full donation and retained their prior reserves. NUX/WETH minted `42,490,693,888,295` raw SST, but `skim` reverted with `SakeSwap: TRANSFER_FAILED`; a read-only call from the pair address established that NUX returns `false` for `transfer(recipient, 0)`. This is a token-compatibility limitation in the recovery step, not a failure of the SST mint path. The sampled runtime equals Blockscout's deployed-bytecode field; compiling the available pair source with explorer settings differs by 61 non-immutable bytes, so exact source-to-runtime attribution remains unresolved. These tests establish unauthorized issuance, but not a current cash-out or reward profit path.

Remediation: authorize the configured router or mint only after the pair has completed and validated the corresponding swap. A balance-surplus check alone is insufficient when the surplus is recoverable through `skim`.

### Current GeckoTerminal pool sweep

The pool set below was retrieved from GeckoTerminal immediately before the local fork run. `WithOut` is raw SST minted for `amountOut = outputReserve / 4`; `WithIn` is raw SST minted for a donation equal to 5% of the WETH reserve, followed by the `skim` result. Values are raw token units.

| Pool | Pair | `WithOut` SST | `WithIn` SST / donation result |
|---|---|---:|---|
| SAKE/WETH | [0xac10…c255](https://www.geckoterminal.com/eth/pools/0xac10f17627cd6bc22719ceebf1fc524c9cfdc255) | 19895562556177578 | 563424464528670 / recovered 11901525521105427 |
| WETH/USDT | [0xe2e5…1f9c2](https://www.geckoterminal.com/eth/pools/0xe2e5aca8e483a4c057892ee1f03bebc9bfa1f9c2) | 196136773 | 5554417 / recovered 71327888095896271 |
| DAI/WETH | [0x2ad9…c242](https://www.geckoterminal.com/eth/pools/0x2ad95483ac838e2884563ad278e933fba96bc242) | 64278329867370716 | 1820304577166906 / recovered 38451296926661162 |
| USDC/WETH | [0x3ed1…11cc](https://www.geckoterminal.com/eth/pools/0x3ed1b76c68f6fd1c645e1e596cec0c77f56711cc) | 23018275126042405 | 651856683330062 / recovered 13769531885116266 |
| GRAP/WETH | [0x0979…4d84](https://www.geckoterminal.com/eth/pools/0x0979d0ed1cfbcbe5468c635103be6557c27a4d84) | 595313744933350484376372 | 16858750639422128312227 / recovered 25121100362931 |
| COMP/WETH | [0xc134…5c50](https://www.geckoterminal.com/eth/pools/0xc134922a5d9117dbb97904b61fcbe04b803b5c50) | 6700039532078690 | 189739102627697 / recovered 4007963648089473 |
| SRM/WETH | [0xddaa…1153](https://www.geckoterminal.com/eth/pools/0xddaaa6f959d43fa06ab2bf14c2ed02f5f8ba1153) | empty reserves | skipped |
| LINK/WETH | [0xca3d…6e7b](https://www.geckoterminal.com/eth/pools/0xca3d6a94759cb675f0ac10a76fc0da6ee6bf6e7b) | 28610850813946008 | 810233601288741 / recovered 17115010956902502 |
| FEI/WETH | [0x0294…949b](https://www.geckoterminal.com/eth/pools/0x029431f348957a788482384ee85ac86b746f949b) | 1 | WETH reserve dust / skipped |
| YFI/WETH | [0x89ba…838d9](https://www.geckoterminal.com/eth/pools/0x89ba27e73c929ebef87c9ff4b43052012ea838d9) | empty reserves | skipped |
| TPT/WETH | [0xe291…fa8e](https://www.geckoterminal.com/eth/pools/0xe291b2a982289f0aa01d0c96c916a9f37b11fa8e) | 35785189387953517 | 1013404453413965 / recovered 21406700253884514 |
| WBTC/WETH | [0x3c51…845b](https://www.geckoterminal.com/eth/pools/0x3c51608d44fcbfff701beb590f0ad65bbebf845b) | 1241298485762722 | 35181377065705 / recovered 742291519341876 |
| SAKE/USDT | [0x5b25…2db8](https://www.geckoterminal.com/eth/pools/0x5b255e213bcce0fa8ad2948e3d7a6f6e76472db8) | 8169966 | not WETH paired |
| QUSD/WETH | [0xe1ab…1e2d](https://www.geckoterminal.com/eth/pools/0xe1ab8a2e0c647b2f6d564ad64a248766b92f1e2d) | 5352792443341346 | 151586274959904 / recovered 3202040439606793 |
| WPRCY/USDT | [0x5f12…f213](https://www.geckoterminal.com/eth/pools/0x5f1243bce6290487b76af1d744110c0f3f7bf213) | 34825323 | not WETH paired |
| ECAT/WETH | [0x7948…056a](https://www.geckoterminal.com/eth/pools/0x7948f0fce3a46d8f3c40bcf4c06a357bae74056a) | 4165726534748388 | 117969634464279 / recovered 2491937613086486 |
| SAKE/USDC | [0xec69…f575](https://www.geckoterminal.com/eth/pools/0xec694c829cc192667cdaa6c7639ef362f3cbf575) | 2348787 | not WETH paired |
| FRONT/USDT | [0xaded…992c](https://www.geckoterminal.com/eth/pools/0xaded74c1a6f2983310f8d64e6c12ce33a015992c) | 274138606757425022326 | not WETH paired |
| SAKE/CMX | [0x62e3…b8c1](https://www.geckoterminal.com/eth/pools/0x62e346bab5e81b188d034f8c9c85c5067455b8c1) | 53890392 | not WETH paired |
| EQL/WETH | [0xa650…1e86](https://www.geckoterminal.com/eth/pools/0xa650b56015736a22dd19c176901fa42d13a71e86) | 2702839638620745 | 76541991300663 / recovered 1616838671822930 |
| WPRCY/WETH | [0xabf1…98a8](https://www.geckoterminal.com/eth/pools/0xabf181b7db0eaa8d51fd253e955b4f69844b98a8) | 595608698 | 16867104 / recovered 12423147679163 |
| RAZOR/WETH | [0x1381…f5cf](https://www.geckoterminal.com/eth/pools/0x1381acf100be5013385353d9a8a25a0cf5c47bff) | 8410213314164 | 238169688327 / recovered 5030989604533 |
| LINK/USDT | [0x290b…ff03](https://www.geckoterminal.com/eth/pools/0x290b0b8be2a5f2846dbd25a09752346670fcff03) | 148320 | not WETH paired |
| LINA/WETH | [0x84f0…81a6](https://www.geckoterminal.com/eth/pools/0x84f0fe1b2efde597ee0f5fe50a47582c135381a6) | 79914752251231 | 2263114016904 / recovered 47805004796686 |
| FRONT/WETH | [0x7af5…d258](https://www.geckoterminal.com/eth/pools/0x7af54337b42a4fb7295b7f29c72c983fbd02d258) | 121976769524582266836 | 3454272572603653894 / recovered 383963159091392 |
| SAKE/UNI | [0x8397…c2f2](https://www.geckoterminal.com/eth/pools/0x83970b5570e4cb5fc5e21ef9b9f3c4f8a129c2f2) | 113370009482070822 | not WETH paired |
| SAKE/TPT | [0x39cf…4b0a](https://www.geckoterminal.com/eth/pools/0x39cfd2c50eae891389e96fd3f5ef505ff9e34b0a) | 2788778 | not WETH paired |
| NUX/WETH | [0x5df1…d2a2](https://www.geckoterminal.com/eth/pools/0x5df16c3efb9e3cf990974aa23c5e8b1fd38fd2a2) | 1500425188347433 | 42490693888295 / `skim` reverted |

### Flash-Swap Composition

The local fork's Uniswap V2 factory `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f` returned WETH/USDT pair `0x0d4a11d5EEaaC28EC3F61d100daF4d40471f1852`. A local borrower borrowed `0.05 WETH`, transferred it to SakeSwap's WETH/USDT pair, called `dealSlippageWithIn`, recovered the donation with `skim`, and repaid the Uniswap pair in its `uniswapV2Call`. The sequence minted `2,768,663` raw SST and paid `150,451,354,062,187` wei WETH in flash-swap fee. It completed atomically on the local fork. No redemption or other current value for SST was established, so this demonstrates capital-efficient issuance, not profitable exploitation.

Read-only state at Ethereum block `26,491,940` showed `STokenMaster` `0x3a417237364FBE95955eDf0B7351dc9c44E59FC7` has one pool: LP token `0xac10f17627cd6bc22719ceebf1fc524c9cfdc255`, SST `0xf220b808807bc66062fd6eaddff846268a5d4b30`, allocation 200, and `withdrawSwitch = true`. Its `endBlock` is `11,085,890`, below the observed current block; `getMultiplier(endBlock, currentBlock)` returns zero. The source still permits deposits after the end block, and withdrawals are enabled, but new deposits earn no SAKE under the observed state; withdrawals charge the configured 1% fee. I did not make a live deposit or withdrawal. A read-only DexScreener query found no indexed Ethereum trading pairs for the 28 SST tokens from the GeckoTerminal pool set. A direct GeckoTerminal check for the sample SST `0xf220b808807bc66062fd6eaddff846268a5d4b30` returned 404 from its token endpoint and an empty result from pool search. In a batch check of all 28 SST addresses, five returned empty search results and 23 were rate-limited (HTTP 429), with no positive matches; GeckoTerminal coverage of the full set is therefore incomplete. These index results are not proof that no secondary market or private value path exists. The precise conclusion is that unauthorized SST issuance is confirmed, while a present-day reward or market cash-out path was not established; current SAKE theft or reserve loss was not demonstrated.

Remediation: restrict slippage minting to the configured router or move the mint into the settlement path after the pair has verified a completed swap. Validate the output/input direction and derive the SST amount from settled deltas. Add tests that direct helper calls cannot mint, while single-hop exact-input and exact-output router swaps still mint the expected reward atomically.

## Rejected candidates

- **Router pair-code-hash mismatch:** the public repository's `SakeSwapLibrary` contains a different hash from the README's Ethereum pair hash, but the deployed verified Ethereum router source embeds the hash that derives the sampled deployed pair. A read-only router quote succeeded; no deployed router mismatch finding is supported.
- **Core fee versus router quote mismatch:** the pair applies 997/1000 and the library uses the same factor.
- **Farmable SST implies current extraction:** the farm configuration accepts the pair's SST, but its configured reward end block predates the observed chain block. No present SAKE reward extraction was demonstrated.
- **SST amount direction/decimal conversion:** source contains orientation-dependent conversions that warrant targeted review, but no user-value loss or violated token-denomination invariant was established in this pass. Not promoted to a finding.

## Isolated validation and limitations

- `sakeswap-free-mint-regression.test.js` was run against the source contracts on local Ganache 7.9.2 with Solidity 0.6.12 and temporary Node 16.20.1. Result: 1 passing. It asserts SST recipient balance increases while pair token balances and reserves do not change.
- `sakeswap-within-skim-fork.test.js` passed on local Ethereum fork blocks `0x1943b3a` and `0x1943b99` against the sampled deployed pair runtime. The helper minted `113,821` raw SST, `skim` recovered the full `0.01 WETH` donation, and reserves did not change.
- `sakeswap-gecko-pools-fork.test.js` passed against a latest-state fork at block `26,491,876` (2026-11-25). It queried all 28 GeckoTerminal pools, confirmed one shared runtime hash, reproduced `dealSlippageWithOut` on all 26 active pairs with token balances and reserves unchanged, tested `dealSlippageWithIn` on active WETH pools, and ran the Uniswap V2 flash-swap callback sequence. The test wraps each pool case and the flash sequence in an EVM snapshot/revert; no public deployment was changed.
- The regression does not establish an external value for newly minted SST. The Ethereum farm configuration was read only; no live farm deposit, reward claim, swap, or mint was attempted.
- No conclusion is transferred to SakeSwap on BSC or another chain; periphery hashes and deployed implementations differ by network.

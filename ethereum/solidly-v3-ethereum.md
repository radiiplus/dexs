# Solidly V3 (Ethereum) Evidence Ledger

## Target and Source Attribution

- Chain: Ethereum mainnet; GeckoTerminal DEX ID `solidly-v3`.
- GeckoTerminal returned seven Ethereum pools on 2026-11-25. All seven sampled pool contracts report factory `0x70Fe4a44EA505cFa3A57b95cF2862D4fd5F0f687`. The largest listed pool was USDC/WETH `0x831bf48183b999fde45294b14b55199072f0801b`, shown at roughly $2,066 reserve value in the on-chain/API observation window.
- The sample pool reports token0 USDC, token1 WETH, tickSpacing 10, active liquidity `15,028,427,859,651`, and current slot0 fee 300 (0.03%). The factory maps fee tier 500 to tick spacing 10. The sample runtime is 21,061 bytes, hash `0x4b1e324f95ab37ec2a986530d3b5d5e438a62ac3fa53b4f34453bfedf87f23e2`.
- Sourcify marks the sample pool and factory `match` for runtime. They use Solidity `0.7.6+commit.7338295f`, optimizer 800 runs, EVM Istanbul, and no metadata bytecode hash. The regression test recompiles both verified sources with these settings and matches runtime bytecode outside immutable slots. The factory-created synthetic pool also matches the sample pool runtime outside immutable values.
- The deployed-source bundles are available from [Sourcify pool source and metadata](https://sourcify.dev/server/v2/contract/1/0x831bf48183b999fde45294b14b55199072f0801b?fields=sources,metadata) and [Sourcify factory source and metadata](https://sourcify.dev/server/v2/contract/1/0x70Fe4a44EA505cFa3A57b95cF2862D4fd5F0f687?fields=sources,metadata). Relevant paths are `contracts/SolidlyV3Pool.sol`, `contracts/SolidlyV3Factory.sol`, `contracts/libraries/Position.sol`, `contracts/libraries/Validation.sol`, and `contracts/libraries/SwapMath.sol`. The official [Solidly contract-address documentation](https://docs.solidly.com/resources/contract-addresses.html) attributes the current factory address. The SolidlyLabs GitHub organization lists documentation, analytics and audits but no matching public V3 core source repository; this ledger therefore attributes code to the Sourcify-verified deployment source, not to the old V2 repository.
- The factory's current owner is `0x2A007e518481D94176F21EF83F4441e1d4A4F5b7`, and its fee collector is `0x6207801cF58eC8Ff24D59dBb8fc25E4A20989aE7`. The factory controls fee tiers, fee setters, and fee collection. Pool `setFee` is permissioned through `isFeeSetter` and caps its slot0 fee at 100,000 (10%).
- Scope is the current Ethereum Solidly V3 factory/pool family. The Solidly V2 ledger and deployments on other chains are separate and are not used to infer behavior here.

## Architecture and Execution Map

- `SolidlyV3Factory.createPool` sorts token addresses, maps the requested fee tier to tick spacing, deploys the pool through its deployer, and records both token-order lookup keys. The factory manages owner, fee collector, fee setter membership, and fee-tier configuration.
- `SolidlyV3Pool` stores immutable factory/tokens/tick spacing/max liquidity per tick; `slot0` price, tick, dynamic fee and lock; active liquidity; ticks and bitmap; caller-keyed positions; and protocol `poolFees` in two `uint128` fields.
- `mint` updates position/tick liquidity, invokes the caller's mint callback, and checks that token balances increased by required amounts. `_burn` removes position liquidity, computes principal as `uint256`, and credits it to position `tokensOwed0/1`; `collect` pays only those `uint128` balances. `burnAndCollect` composes the same `_burn` then `_collect`, so it does not avoid the owed-width boundary.
- `swap` walks ticks and computes full-width amounts/fees, then its payment callback must increase the input token balance by the required amount before the lock is released. Per-step fees are narrowed into `SwapState.poolFee` (`uint128`) and then added to `poolFees` (`uint128`). `quoteSwap` duplicates this calculation for views.
- `flash` requires active liquidity, transfers principal, calls the receiver, checks post-callback balances against prior balances plus rounded-up fees, then records paid amounts as protocol `poolFees`. `collectProtocol` is restricted to the factory's fee collector and pays at most the stored `uint128` values.
- Factory-authorized `setFee` can update a pool's current slot0 fee. The oracle/price state determines swap execution; neither fee changes nor fee collection bypass the callback settlement checks.

## Critical Invariants

- Full-width principal returned by `_burn` must remain fully represented in the position's collectible owed balances. A position must not reach zero liquidity while a portion of its principal claim has been silently discarded.
- Callback-settled mint/swap/flash operations must compare actual balances against the amount owed before committing tick, price, liquidity, or fee accounting. Failed settlement must revert token transfers and all nested pool state.
- Protocol fee balances must equal fees collected by swap/flash paths, subject to explicit and enforced width limits. Fee collection must not be able to withdraw more than the tracked claim, and excess fees must not become unreachable due to silent narrowing.
- Tick liquidity must remain within `maxLiquidityPerTick`; pool active liquidity and tick net liquidity must stay consistent as positions are minted and burned.
- Factory fee-tier spacing, pool slot0 fee, and `SwapMath` fee calculations must compose so every accepted fee/payment amount is represented in the final accounting width.

## Findings

### Low: burn truncates full-width principal before crediting collectible claims

Status: **Confirmed in Sourcify-matched pool bytecode and reproduced on a local fork using a pool created by the deployed factory.** The triggering LP is the position owner; this is permanent LP value loss, not an unauthorized third-party seizure.

`SolidlyV3Pool._burn` returns each principal amount as `uint256` but adds `uint128(amount0)` and `uint128(amount1)` to `Position.Info.tokensOwed0/1`, which are `uint128`. Solidity 0.7.6 truncates the high bits. `collect` caps transfers at the stored owed values. `burnAndCollect` calls the same `_burn` before `_collect`, so the combined helper also collects only the narrowed claim. The pool has no general surplus-withdrawal path for the difference.

The local fork created a tickSpacing-10 pool via the deployed factory, initialized it at a valid range edge, and minted/burned `2^100` liquidity using a synthetic token. This liquidity was below `maxLiquidityPerTick` (`1,917,569,901,783,203,986,719,870,431,555,990`). Burn returned `23,380,809,169,431,068,449,021,845,734,085,661,901,842,707,912,683` raw token0 units; only `272,362,842,312,717,300,310,295,094,291,819,403,243` became collectible. After collecting, `23,380,809,169,158,705,606,709,128,433,775,366,807,550,888,509,441` units remained while the position had zero liquidity. One-unit differences from the exact lost-claim amount are normal mint/burn rounding dust.

The boundary is only reachable where raw principal exceeds `uint128`, such as extreme prices combined with high-raw-unit supply. This synthetic reproduction establishes the implementation behavior but not a live real-token position at risk in the seven indexed pools.

Remediation: reject burns whose principal cannot fit the owed fields, or widen owed-principal storage. A checked cast prevents silent loss but would revert the burn; wrappers should allow users to collect/split withdrawals before an owed claim crosses the limit.

### Low: swap and flash protocol fees silently narrow into uint128 accounting

Status: **Confirmed from matched source and reproduced on a local fork in the flash path.** Swap-path narrowing is source-confirmed but was not separately executed in the regression.

In `_swapBase`, each full-width `step.feeAmount` is cast to `uint128` while accumulating `SwapState.poolFee`, then the resulting value is added to `poolFees.token0/1`. In `flash`, the full-width `paid0/paid1` values are likewise cast to `uint128` before addition to `poolFees`. The source comment says overflow is acceptable if fees are collected and reset before `uint128.max`, but neither flash repayment nor swap amount bounds prevent one valid transaction from producing a fee above that width.

The local fork borrowed `2^139` raw synthetic token0 units at a 500/1,000,000 pool fee and repaid principal plus the required fee. The `Flash` event reported `348,449,143,727,040,986,586,495,598,010,130,648,531` fee units, while `poolFees.token0` increased only by the low 128 bits: `8,166,776,806,102,523,123,120,990,578,362,437,075`. The difference is exactly `2^128` raw units. `collectProtocol` reads only `poolFees`, so it cannot claim the discarded high bits; the corresponding tokens remain in the pool without a fee claim.

This is a protocol-fee accounting loss under extreme raw-unit inputs. It does not let the borrower keep the flash principal or skip the required fee payment. The test used synthetic assets and does not establish a current real-token pool able to cross the threshold.

Remediation: use checked casts and reject fee amounts above the representable remainder, widen fee accounting, or split/claim fees before accepting a payment that can overflow. Enforce any cumulative-bound assumption at the point where each individual swap/flash amount is validated.

## Rejected Hypotheses

- **Flash callback can retain principal or avoid the required fee:** not supported. The callback runs under the pool lock; the pool checks post-callback token balances against `balanceBefore + fee` and reverts otherwise.
- **`burnAndCollect` bypasses the principal-width issue:** disproven by its direct call to `_burn` followed by `_collect`; it uses the same truncated owed fields.
- **The per-tick liquidity cap prevents principal above uint128:** disproven by the valid synthetic position below `maxLiquidityPerTick` that produced principal above uint128.
- **Factory fee setters are permissionless:** disproven by `setFee` checking `factory.isFeeSetter(msg.sender)`. No bypass was identified.
- **The V2 Solidly repository represents this pool:** disproven by separate V3 contract names, runtime bytecode, and Sourcify-verified V3 source. The old V2 source was not used.

## Isolated Validation and Limits

- `solidly-v3-ethereum-fork.test.js` forked Ethereum locally at base block `26,492,330`. It recompiled the Sourcify-verified pool and factory with Solidity 0.7.6, matched deployed runtimes, created a synthetic pool through the deployed factory and confirmed the new pool runtime matched outside immutable arguments.
- The regression reproduced both defects using a synthetic high-supply token: full burn left principal after collection, and a successful locally repaid flash loan emitted a fee larger than `uint128` while the pool fee ledger recorded only low bits. No transaction was sent to the public chain.
- Ganache used its JavaScript fallback because its optional µWS binary is unavailable for Node `v24.22.2`. No live loss or specific real-token exploitability is claimed. Swap-path fee narrowing was not independently reproduced; wrapper/integrator deployment attribution and real-token extreme boundaries remain unreviewed.

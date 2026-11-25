# KyberSwap Elastic (Ethereum) Evidence Ledger

## Scope and target identity

- Chain: Ethereum mainnet; GeckoTerminal DEX ID `kyberswap_elastic`.
- Sampled GeckoTerminal pool: `0xb80c46e90757eeca5d47d11041ad2cb70df528ad` (FTX Token / WETH, 2%). Its Blockscout verified contract is named `Pool`, compiler Solidity `0.8.9`, optimizer enabled with 500 runs.
- Public source repository: [`KyberNetwork/ks-elastic-sc`](https://github.com/KyberNetwork/ks-elastic-sc/tree/4ab08c0a60f74809f731bdd333076e32d05f1d17), checkout commit `4ab08c0a60f74809f731bdd333076e32d05f1d17`. Relevant files include [`Pool.sol`](https://github.com/KyberNetwork/ks-elastic-sc/blob/4ab08c0a60f74809f731bdd333076e32d05f1d17/contracts/Pool.sol), [`Factory.sol`](https://github.com/KyberNetwork/ks-elastic-sc/blob/4ab08c0a60f74809f731bdd333076e32d05f1d17/contracts/Factory.sol), and [`Router.sol`](https://github.com/KyberNetwork/ks-elastic-sc/blob/4ab08c0a60f74809f731bdd333076e32d05f1d17/contracts/periphery/Router.sol). The source is KyberSwap Elastic smart-contract v2; its architecture and verified pool metadata match the target contract family. The deployed factory address listed in the repository README is `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a`. Verified source pages: [sample pool](https://eth.blockscout.com/address/0xb80c46e90757eeca5d47d11041ad2cb70df528ad#code), [factory](https://eth.blockscout.com/address/0x5f1dddbf348ac2fbe22a163e30f99f9ece3dd50a#code).
- The deployed pool's contract name and compiler settings align with this source family; an exact deployed runtime-bytecode-to-commit match was not established. Findings below are source-level unless explicitly described as locally reproduced. No state-changing public-deployment interaction was performed.
- This ledger covers the Ethereum Elastic concentrated-liquidity pools and their factory, router and position manager. KyberSwap Classic and deployments on other chains are excluded.

## Architecture and execution map

- `Factory` (`contracts/Factory.sol`) initializes CREATE2 pool deployment parameters, creates pools for sorted token pairs and fee tiers, and controls fee tiers, NFT position-manager authorization and government-fee configuration. Pools use the factory's pool oracle.
- `Pool` (`contracts/Pool.sol`) combines concentrated base liquidity (`baseL`) with swap-fee reinvestment liquidity (`reinvestL`). It stores price/tick state, initialized tick/position state, global fee growth and an ERC-20 reinvestment token supply. Pool actions are guarded by the storage lock.
- `PoolTicksState` (`contracts/PoolTicksState.sol`) maintains per-tick gross/net liquidity, fee-growth and seconds-per-liquidity outside values, the initialized tick linked list, and each manager's aggregate owner/tick position.
- `SwapMath`, `QtyDeltaMath`, `LiqDeltaMath`, `ReinvestmentMath`, `FullMath` and `TickMath` calculate per-step input/output, fees folded into reinvestment liquidity, price movement, liquidity changes and tick transitions.
- `Router` (`contracts/periphery/Router.sol`) runs exact-input and exact-output single/multi-hop swaps. It validates the callback caller against the deterministic factory-derived pool address and transfers input tokens in the pool callback.
- `BasePositionManager` (`contracts/periphery/BasePositionManager.sol`) represents user positions as ERC-721s. It escrows pool reinvestment tokens earned by positions, tracks `rTokenOwed` and `feeGrowthInsideLast`, and lets authorized NFT holders remove liquidity or burn accrued reinvestment tokens.
- `Pool.swap` updates price, liquidity, fee state and tick state before transferring output and invoking the input callback. It verifies payment by measuring pool balances afterward; an unpaid callback reverts the entire transaction, including prior storage changes and transfers.
- `Pool.flash` transfers tokens, invokes a callback, checks both balances against pre-loan balance plus the configured fee, and forwards all paid surplus to the configured fee recipient.

## Entry points and state transitions reviewed

- Factory: `createPool`, fee-tier updates, NFT manager whitelist, government-fee updates and configuration-master transfer.
- Pool: `unlockPool`, `mint`, `burn`, `burnRTokens`, `swap`, `flash`, `tweakPosZeroLiq`, oracle/position/tick state views.
- Router: exact-input and exact-output, single-hop and multi-hop swaps; authenticated `swapCallback` settlement.
- Position manager: pool creation/unlock, NFT mint, liquidity increase/decrease, fee-growth synchronization, reinvestment-token redemption, NFT burn and token transfer helpers.
- Supporting math: tick traversal, position/tick fee growth, reinvestment supply synchronization and rounding boundaries in `computeSwapStep`.

## Critical invariants

- A successful swap's token deltas, price, current/nearest ticks, base liquidity, reinvestment liquidity, reinvestment-token supply and fee-growth state must correspond to the same completed sequence of swap steps.
- For each swap step, exact-input or exact-output mode must consume the specified amount or stop at the price limit consistently; equality at a tick boundary must not leave price and tick state out of sync.
- Crossing an initialized tick must update its fee/time outside values and base liquidity exactly once, in the correct direction; reinvestment-fee token accounting must be synchronized to the pre-crossing base liquidity.
- Position fee growth is accrued only over the position's active liquidity and only since its last snapshot. Updating liquidity must not transfer historical fees to newly added liquidity or erase fees already earned by removed liquidity.
- Reinvestment-token supply and `reinvestL/reinvestLLast` determine claims on accumulated swap fees; logical burns, fee minting and user redemption must keep the outstanding claims backed by pool-held reinvestment tokens and underlying pool balances.
- A swap or flash operation must not commit an asset outflow unless its required callback payment is observed; any failure must roll back the entire outer pool operation.
- Router callbacks must only settle calls from the expected pool and charge the input source according to the returned pool deltas. Exact-output multi-hop amounts and input caps must remain consistent through recursion.

## Findings

No confirmed invariant violation was identified in the reviewed source paths.

The independent reviewer reached the same conclusion for swap/reinvestment-liquidity/tick crossing and position-manager settlement. No candidate issue was promoted based on the historical-looking test name or unusual reinvestment behavior alone.

## Candidate checks and rejected hypotheses

- Tick-boundary synchronization: `Pool_with_attack.spec.ts` performs repeated swaps around adjacent ticks and asserts `currentTick == nearestCurrentTick`. The targeted local test passed both scenarios. The test also shows base liquidity changing in sync with tick crossings while reinvestment liquidity remains in pool state. This source/test sequence did not establish an inconsistent final tick state.
- Exact-input equality handling: `SwapMath.computeSwapStep` now uses `usedAmount > specifiedAmount` for exact-input truncation. At equality, the target price is selected and the input amount is consumed exactly; this is consistent with exact-output equality handling. The new-branch and four directional/mode unit tests pass. The historical source change from `>=` to `>` is consistent with the tested tick-boundary behavior, not a current defect.
- Reinvestment fee accounting: swap steps increase `reinvestL`; crossing a tick computes claimable reinvestment tokens against cached `reinvestLLast`, the active `baseL`, and current token supply; fee growth is distributed to active positions and any government portion is separately minted. Position updates synchronize fee growth before changing liquidity. No over-issuance or unbacked redemption sequence was reproduced in the reviewed mint/burn/swap tests.
- Swap callback and rollback: pool state changes and output transfers precede the callback, but the pool lock remains held and the post-callback balance check enforces payment. A failed callback reverts the whole transaction. Tests cover insufficient callback payment and confirm revert behavior.
- Flash settlement: paid balances are checked against pre-flash balances and required fees before any surplus is transferred to `feeTo`. Tests cover underpayment, overpayment and fee-recipient behavior.
- Public `BasePositionManager.addLiquidity` is not guarded by NFT ownership, but the caller supplies and pays the assets while resulting liquidity is added to the selected position; this is a permissionless contribution, not a demonstrated loss of the caller's pre-existing assets or unauthorized withdrawal.

## Isolated validation

- Compiler: local Hardhat compilation succeeded for Solidity 0.8.9. Pool artifacts were built in the repository's configured local test environment; the optimizer report for the pool contract is 500 runs. Compiler warnings included code-size warnings for test/deployment artifacts and variable shadowing in a mock oracle; neither was used as a security finding.
- Attack-focused sequence test: `test/Pool_with_attack.spec.ts` passed, 2 tests.
- Pool state/accounting suite: `test/Pool.spec.ts` passed, 137 tests, covering initialization, liquidity, position fees, swaps, tick crossings, reinvestment-token burning, oracle writes, callback rollback and flash settlement.
- Swap-math suite: `test/libraries/SwapMath.spec.ts` passed, 9 tests, including all four swap directions/modes and the compute-step boundary branch.
- Tests used local Hardhat deployments and synthetic test tokens. A temporary Node `16.20.1` runtime was used for this legacy dependency set; system Node remains `24.22.2`. No live deployment was used for testing.
- Repository tests establish behavior for the current source checkout, not that every deployed pool has identical runtime code or configuration. The pool source was identified by verified contract metadata and compiler settings, but exact bytecode-to-commit attribution remains open.

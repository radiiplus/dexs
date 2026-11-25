# Bitswap Ethereum Pool (iZiSwap Architecture) Evidence Ledger

## Target and Source Attribution

- Chain: Ethereum mainnet; GeckoTerminal DEX ID `bitswap`. Its current first page contains one pool, WETH/USDT 0.3%, `0xdb57a7ce7806d8de54fcba1ec2df230757c3bf67`.
- The pool identifies as `iZiSwapPool`, created by factory `0xc78fd8021fb191501e6be7c1da4beafb1b81cf8c`. This report follows the deployed pool/factory identity; the GeckoTerminal label is not treated as source attribution.
- Blockscout publishes verified pool source for Solidity `0.8.4+commit.c7e474f2`, optimizer 10. Recompilation matched deployed pool runtime exactly after stripping CBOR metadata. The factory and pool are both marked as partial matches by Blockscout, so factory bytecode identity is not claimed.
- The public [iZiSwap core repository](https://github.com/izumiFinance/iZiSwap-core/tree/3fe21eba6e39d6e362d399b54a6719244eb89929) was reviewed at commit `3fe21eba6e39d6e362d399b54a6719244eb89929`. Relevant source files include [`iZiSwapPool.sol`](https://github.com/izumiFinance/iZiSwap-core/blob/3fe21eba6e39d6e362d399b54a6719244eb89929/contracts/iZiSwapPool.sol), [`iZiSwapFactory.sol`](https://github.com/izumiFinance/iZiSwap-core/blob/3fe21eba6e39d6e362d399b54a6719244eb89929/contracts/iZiSwapFactory.sol), [`liquidity.sol`](https://github.com/izumiFinance/iZiSwap-core/blob/3fe21eba6e39d6e362d399b54a6719244eb89929/contracts/liquidity.sol), [`limitOrder.sol`](https://github.com/izumiFinance/iZiSwap-core/blob/3fe21eba6e39d6e362d399b54a6719244eb89929/contracts/limitOrder.sol), [`swapX2Y.sol`](https://github.com/izumiFinance/iZiSwap-core/blob/3fe21eba6e39d6e362d399b54a6719244eb89929/contracts/swapX2Y.sol), [`swapY2X.sol`](https://github.com/izumiFinance/iZiSwap-core/blob/3fe21eba6e39d6e362d399b54a6719244eb89929/contracts/swapY2X.sol), and [`flash.sol`](https://github.com/izumiFinance/iZiSwap-core/blob/3fe21eba6e39d6e362d399b54a6719244eb89929/contracts/flash.sol).
- Five delegate modules are fixed in the factory and copied into each pool's storage at construction. The current factory returns swap modules `0x7FC805B9773A22c091Fe548380E2dE61A07478e5` and `0x178BE577715Cc0E83b33467D9B4A009f1cD7b052`, liquidity module `0x07F389E36F76a2c0af7D109fEc739571C96473E4`, limit-order module `0xf887bAADd85C630e8E6f211d72C69400870eaC31`, and flash module `0xf8F1CD5943396C5C49Eb278A171Ad9AA6A2013e5`.
- Local recompilation of the pinned repository matched the pool and four module runtimes (both swap modules, limit-order, and flash) after metadata removal. The liquidity module is not verified by the explorer and its deployed runtime does not match that repository build; its source identity and accounting behavior remain unresolved. This prevents a complete conclusion on mint, burn, and liquidity collection.

## Architecture and Execution Map

- The factory creates pools for token pair, fee, and point spacing. The factory owner can enable fee tiers, change the charge receiver, and change the default fraction of fees charged to the protocol. The module addresses are constructor-set in the reviewed factory source; that source exposes no module replacement functions.
- `iZiSwapPool` stores tokens, fee/point parameters, price state, liquidity and limit-order storage, fee-growth counters, and protocol fee counters. Public liquidity, limit-order, swap, and flash entry points check `noDelegateCall`, set the pool lock, and `delegatecall` their respective module. The module runs against pool storage and emits results through the pool wrapper.
- Swaps use discretized concentrated liquidity and may cross limit orders. Mint callbacks pay token deltas. Flash loans require active liquidity, transfer no more than current balances, invoke the callback, and require pre-loan balances plus the fee after callback. Limit-order operations maintain user earnings and escrow state in `UserEarn` and `LimitOrder` storage.
- `collectFeeCharged` is limited to the factory's `chargeReceiver`; it transfers the accumulated charged-fee balances and then clears the counters. `modifyFeeChargePercent` is limited to the factory owner and bounds the percentage to 0..100.

## Critical Invariants

- Every liquidity and limit-order claim must be backed by pool token balances and remain attributable to an owner until collected or assigned.
- The pool lock must cover module delegatecalls and token callbacks; unsuccessful module calls must revert the whole operation, including callback transfers and storage updates.
- A swap's actual token deltas, LP fee growth, protocol charged-fee counters, and limit-order earnings must reconcile after all traversed points and callbacks.
- A flash loan must return at least the requested fee on each side, with protocol-charged amounts and LP fee growth partitioning the payment without double-counting.
- Module storage layout and selectors must match the pool wrapper because delegatecall shares the pool's storage and preserves the external caller.

## Findings

No confirmed defect was identified in the pool source/runtime or in the source-matched swap, limit-order, and flash modules during this pass. This is not a complete accounting sign-off: the deployed liquidity module is a material unresolved component, so mint/burn/collect behavior cannot be cleared from the public repository source alone.

## Rejected Hypotheses

- **Permissionless protocol-fee withdrawal:** disproven for the pool wrapper. `collectFeeCharged` requires the factory's current `chargeReceiver`; the fee percentage setter requires the factory owner and bounds the value.
- **Flash overpayment creates unaccounted value:** not indicated in the matched flash source. Paid amounts are partitioned between the charged-fee counter and fee-growth accumulator, and callback failure or insufficient repayment reverts atomically. The deployed flash module runtime matches the pinned repository build.
- **Reentrant callback changes pool state mid-settlement:** not indicated in the exact pool runtime. The wrapper holds `state.locked` around each delegatecall path; nested state-changing entry points use the same lock.
- **Liquidity accounting is sound because the public repository implementation is sound:** not accepted. The deployed liquidity module has no verified source and differs from the pinned public repository runtime, so no conclusion is transferred across that mismatch.

## Current Fork State and Validation Limits

- `bitswap-iziswap-ethereum-fork.test.js` forks Ethereum at latest block `26,492,480`, recompiles the explorer-published pool, checks its runtime, verifies the single GeckoTerminal listing maps to the factory, reads factory/fee/module state, and confirms all five module addresses contain code. No public-chain transactions were sent.
- At the sampled block, pool fee was 3,000, point spacing 60, pool fee-charge percentage 50, accrued charged fees were `61390619406006627` tokenX units and `153350103` tokenY units, and token balances were `1906632767982144127` tokenX and `1380323192` tokenY. Current active liquidity read as zero; this alone does not imply insolvency because limit-order inventory can remain in pool balances.
- The highest-priority follow-up is source or disassembly attribution for the deployed liquidity module. Until that is resolved, the assessment does not claim all relevant value paths have been cleared.

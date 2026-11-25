# Integral SIZE (Ethereum) Evidence Ledger

## Scope and target identity

- Chain: Ethereum mainnet; GeckoTerminal DEX ID `integral_size` (GeckoTerminal's page-1 Ethereum DEX listing places this after Elk Finance).
- Classification: Integral SIZE's `TwapPair` / factory AMM with delayed trade, liquidity and limit-order components. No findings are transferred from other Integral chains or products.
- Public source: `https://github.com/IntegralHQ/Integral-SIZE-Smart-Contracts`, commit `91d8803b1732dfe675e25754332f1078945dcc89` (2024-04-02). Source uses Solidity 0.7.6; repository Hardhat settings enable optimizer at 200 runs.
- The repository `deployments.json` and official docs identify the Ethereum factory as `0xC480b33eE5229DE3FbDFAD1D2DCD3F3BAD0C56c6`; this matches the verified `TwapFactory` metadata (solc 0.7.6, optimizer 200) from Blockscout. Docs list the Ethereum relayer proxy `0xd17b3c9784510E33cD5B87b490E79253BcD81e2E`, and documented pairs include WETH/USDC `0x2fe16Dd18bba26e457B7dD2080d5674312b026a2`.
- GeckoTerminal's DEX-pools endpoint returned an empty `data` array during this review. Pool-specific selection therefore uses the official deployment list; no individual live pool state was queried or changed.
- Scope covers source architecture associated with the Ethereum V2 AMM, including the relayer, delayed orders, pair and oracle logic. Other Integral deployments and unrelated token/staking systems are excluded.

## Architecture and execution map

- `TwapFactory` (`contracts/TwapFactory.sol`) creates sorted-token `TwapPair` contracts with CREATE2 and maps both token orderings. Owner-only methods configure pair fee rates, oracle, authorized trader, fee collection and LP withdrawal.
- `TwapPair` (`contracts/TwapPair.sol`) stores LP ERC-20 supply, token addresses, oracle/trader addresses, reserves and fee balances (the latter two in `Reserves`). Only the configured trader or factory can mint, burn, swap or sync. Pair lock covers token transfers and oracle calls.
- `Reserves` (`contracts/libraries/Reserves.sol`) records `reserve0/1` separately from `fee0/1`; pair token balances should reconcile as reserve plus accrued fee. `syncReserves` rescales fees when token balances change, while `getBalances` clamps recorded fees to extant balances.
- `TwapOracle` and `TwapOracleV3` implement price-based execution and quote functions. The oracle selected by each pair determines how the supplied price data is interpreted. The Ethereum deployment configuration includes V3 oracle entries; no V2/V3 conclusions are combined.
- `TwapRelayer` (`contracts/TwapRelayer.sol`, behind a proxy) quotes and immediately settles user trades against its inventory, then submits a corresponding delayed order to `TwapDelay`. It applies a conservative spot/TWAP price choice, pair enablement, swap fee and token balance limits.
- `TwapDelay` (`contracts/TwapDelay.sol`) serializes deposits, withdrawals, sells and buys. `Orders` converts deposited amounts into token shares and stores a digest; execution verifies the digest and next order ID, performs the operation in a bounded self-call, and refunds escrowed assets if execution fails.
- `TokenShares` (`contracts/libraries/TokenShares.sol`) represents rebasing-token escrow as shares, measures actual transfer deltas for deposits, and converts shares back against current token balance. WETH and configured non-rebasing assets use 1:1 amounts.
- `ExecutionHelper`, `AddLiquidity` and `WithdrawHelper` implement delayed pair operations. `TwapLimitOrder` is a separate order-submission workflow using the same delayed settlement system; its queue and refunds were reviewed for cross-contract share effects.
- `TwapFactoryGovernor` routes owner-controlled configuration, fee collection and fee distribution. Pair fees are first synchronized, collected, and then distributed; collection itself is not callable by arbitrary users.

## Entry points and state transitions reviewed

- Factory/governor: pair creation, fee/oracle/trader configuration, collect/distribute fees, LP and token withdrawals.
- Pair: one-time initialization; LP transfer/permit; `mint`, `burn`, `swap`, `sync`, `collect`; exact input/output quote helpers and deposit-balancing quotes.
- Relayer: `sell`, `buy`, quote and pool-state helpers, price lookups, owner withdrawal/wrap operations, and rebalancer execution paths.
- Delay: `deposit`, `withdraw`, `sell`, `buy`, privileged `relayerSell`, sequential `execute`, cancellation, retry-refund, and pair sync.
- Limit orders: enqueue, validate, execute/submit, cancellation and retry-refund.
- Libraries/oracles: amount/share conversion, add/remove liquidity, fee accrual, swap price math, order digest and FIFO transitions.

## Critical invariants

- Pair balances reconcile to reserves plus accrued fees; a swap excludes fees from LP reserves and records them separately. `sync`, fee collection and mint/burn must preserve that decomposition.
- Pair minting issues LP supply only for measured balances in excess of reserves; burning distributes the pair's fee-adjusted balances pro rata against pre-burn total supply.
- Each swap uses the pair's selected oracle and fee to ensure the post-operation reserves are consistent with the designated price; output must be bounded by the available reserve and any failed downstream call must roll back the entire pair transition.
- Delayed escrow shares represent claims on the delay's token balance. Share reduction and token transfer must either both commit on successful execution or both revert before the failure-refund path uses the original share claim.
- Each queued order digest binds its execution fields. The queue advances in order; canceled or executed orders cannot be replayed to consume another user's escrow.
- Failed delayed operations retain/refund the original token or LP claim; a failed refund remains retryable and must not silently erase the claim.
- Relayer immediate settlement and delayed rebalancing must debit/credit matching assets, with exact-input/output amount limits, fee calculations, WETH handling and refunds balanced across both calls.

## Findings

No confirmed implementation defect was identified in the reviewed Ethereum source paths.

An independent reviewer separately examined delayed queue and token-share accounting, and then pair reserve/fee and oracle accounting. The review agreed that no candidate with a demonstrated invariant violation remained.

## Candidate checks and rejected hypotheses

- Delayed execution rollback: the outer execution path increments the FIFO cursor before a bounded self-call. A failed self-call rolls back its token-share, token-transfer, pair and oracle effects; the outer frame then refunds the original escrow shares or LP amount. If that refund fails, the order is retained as retryable rather than forgotten (`TwapDelay.sol:247-337`, `TwapDelay.sol:339-425`). This ordering did not create a double debit or lost claim in the analyzed paths.
- Rebasing-token share conversion: the library uses actual balance deltas on deposit and current balance divided proportionally by total shares on withdrawal (`TokenShares.sol:29-57`, `TokenShares.sol:60-123`). The reviewed success/failure sequence did not reveal share creation or destruction without the corresponding asset movement. This conclusion concerns the implemented accounting model and assumes the token follows the relevant ERC-20 balance/transfer interface.
- Pair fee/reserve synchronization: `syncReserves` adjusts fee balances proportionally to observed token balance changes and sets reserves to the balance remainder; `getBalances` caps fees at available balances. Swap paths add input-side and oracle-implied output-side fees before updating reserves, and mint/burn use the fee-adjusted balances (`Reserves.sol:29-70`, `TwapPair.sol:123-244`). No user-controlled path was found that could collect another party's reserve-backed value through `skim`-like behavior; the pair has no public skim entry point.
- Oracle amount math: pair execution and quote helpers use the same fee scale and oracle functions for both token directions. Quote rounding in the exact-input/output helpers was reviewed against swap-side balance updates; no concrete extraction or underpayment sequence was established.
- Limit-order submission: token-share redemption and the downstream `TwapDelay` enqueue happen within a self-call. If enqueue fails, the share change is rolled back before the outer failure/refund state transition. Failed refunds remain retryable (`TwapLimitOrder.sol:208-244`, `TwapLimitOrder.sol:286-344`).
- Privileged owner, factory and rebalancer controls are trust assumptions documented by the source architecture, not permissionless invariant defects.

## Validation and limitations

- Source/deployment identity check: repository factory address agrees with official Ethereum docs; verified-source metadata for that address reports `TwapFactory`, solc `0.7.6+commit.7338295f`, optimizer enabled with 200 runs.
- Independent source review: completed for delayed queue/share accounting and separately for pair reserves/fees and oracle execution. No live transactions or state-changing deployment interactions were performed.
- Regression tests: none were added because no credible candidate invariant violation was identified. This checkout contains no test directory or tracked test files; `npm test -- --reporter dot` could not start because `mocha` is not installed. The package declares Node `^16.20.1`; the available runtime is Node `v24.22.2`, and no global Node change was made.
- GeckoTerminal's Integral SIZE pool endpoint returned an empty page. Analysis is source and deployment-list based rather than a claim about current live pool state. Proxy implementation state and each pool's deployed runtime were not independently bytecode-matched to this repository commit, so source-to-runtime attribution beyond the verified factory metadata remains a limitation.

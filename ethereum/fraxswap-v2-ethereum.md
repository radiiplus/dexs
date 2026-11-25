# Fraxswap V2 (Ethereum) Evidence Ledger

## Target and source

- Chain: Ethereum mainnet; GeckoTerminal DEX ID `fraxswap_ethereum`.
- Sample pools `0x0fe046a9027d8ce9a909f0c93ea2ddcfd8090f87` and `0x31351bf3fba544863fbff44ddc27ba880916a199` return the same factory, `0x43eC799eAdd63848443E2347C49f5f52e8Fe0F6f`, through read-only `factory()` calls. This is the V2 factory listed in Frax documentation. V1 is explicitly deprecated and excluded.
- Public repository: [`FraxFinance/frax-solidity`](https://github.com/FraxFinance/frax-solidity/tree/2702e7e147212b85a28e198a7eba1c3bab9119db), inspected commit `2702e7e147212b85a28e198a7eba1c3bab9119db` (2026-11-02). Relevant files are [`FraxswapPair.sol`](https://github.com/FraxFinance/frax-solidity/blob/2702e7e147212b85a28e198a7eba1c3bab9119db/src/hardhat/contracts/Fraxswap/core/FraxswapPair.sol), [`FraxswapFactory.sol`](https://github.com/FraxFinance/frax-solidity/blob/2702e7e147212b85a28e198a7eba1c3bab9119db/src/hardhat/contracts/Fraxswap/core/FraxswapFactory.sol), and [`FraxswapRouter.sol`](https://github.com/FraxFinance/frax-solidity/blob/2702e7e147212b85a28e198a7eba1c3bab9119db/src/hardhat/contracts/Fraxswap/periphery/FraxswapRouter.sol). The target pair's fork runtime equals the Blockscout deployed-bytecode field. Compiling the explorer's flattened verified source with Solidity 0.8.15, London EVM, and its listed optimizer settings differs by 29 bytes outside immutable ranges, so exact source attribution is unresolved. Verified deployment source: [sample pair A](https://eth.blockscout.com/address/0x0fe046a9027d8ce9a909f0c93ea2ddcfd8090f87#code), [factory](https://eth.blockscout.com/address/0x43ec799eadd63848443e2347c49f5f52e8fe0f6f#code). No state-changing calls were made to public deployments.

## Architecture and execution map

- `FraxswapFactory` deploys pairs and controls global pause/fee administration. Each `FraxswapPair` combines Uniswap-V2-style LP reserves with `LongTermOrdersLib` order-pool state and separate `uint112` TWAMM reserves.
- Normal swaps, mint, burn, sync and selected administration execute pending virtual orders through `execVirtualOrders`; pair operations use the pair lock. LT order entry transfers the input token, records a sale rate and expiry in `LongTermOrders`, and increments the matching TWAMM reserve.
- `executeVirtualOrdersInternal` loads AMM/TWAMM reserves, runs virtual trades and expiries in `LongTermOrders`, then writes new reserve values back. Cancellation and proceeds withdrawal remove TWAMM accounting and transfer order claims. The pair's ERC-20 transfers and virtual-order state changes are transaction-atomic on revert.

## Invariant catalogue and reviewed paths

- For each token, pair balance must cover LP reserve plus TWAMM escrow and other explicitly accounted claims. Virtual sales move value from TWAMM escrow through AMM pricing; output and unsold-input claims must remain backed.
- Per-order sale-rate and reward-factor state must sum to the pool's active order claims. Expiry or cancellation must remove the order rate once, while paying the remaining input and earned output.
- Pair reserves and TWAMM reserves are stored as `uint112`; transfer amounts, sale rates and order amounts use `uint256`. All conversions at their boundaries require explicit range validation or a proof that values are in range.
- Reviewed entry paths include both LT swap directions, virtual-order execution, cancellation, proceeds withdrawal, pause behavior, and standard pair reserve/swap accounting. A broad full-repository regression suite was not run.

## Findings

### Candidate: LT order amount narrows into TWAMM reserve without a bound check

Status: **Plausible source-level defect; not locally reproduced; deployment-specific exploitability unverified.**

In `FraxswapPair.sol:412-428`, `transferAmountIn` measures and returns a `uint256`; the entry path adds `uint112(amount0)` (or `uint112(amount1)`) to the stored TWAMM reserve and checks only `reserve + truncatedTWAMMReserve <= uint112.max`. It then passes the original full-width amount to `performLongTermSwap`. `LongTermOrders.sol:119-136` derives and records the sale rate from that full-width amount. Therefore an amount above `uint112.max` can be represented differently by the order schedule and the pair's escrow ledger.

The intended invariant is that pair-held order input is fully represented by `twammReserveN` and by active order amounts. With `amount = 2^112 + r`, the pair records only `r` but schedules sales against `2^112 + r`. During later virtual execution, `executeVirtualTradesAndOrderExpiries` applies the full scheduled sell amount to the smaller tracked reserve (`LongTermOrders.sol:204-227`); this can underflow and revert when the virtual trade executes. Pair operations that execute stale TWAMM state may then revert until the problematic order can be resolved, while cancel/withdraw paths also subtract narrowed amounts (`FraxswapPair.sol:434-457`).

The source does not reject the oversized transfer before recording the order. Whether the amount is attainable for a specific listed pool depends on the paired ERC-20 supply/balance and deployed pair implementation; those token constraints were not established here. Do not treat this as a confirmed deployed loss or lock until the exact pair/token context and isolated reproduction are verified. Remediation: reject `amount > type(uint112).max - twammReserveN` (and ensure the LP reserve headroom check cannot overflow) before mutating order state, and range-check all later reserve casts.

## Rejected candidate

- **Pause then cancel strands order-owned input:** disproven. Pausing deliberately stops virtual execution (`FraxswapPair.sol:473-476`) and freezes `lastVirtualOrderTimestamp`; cancellation calculates unsold input at that last executed time (`LongTermOrders.sol:416-433`). Since no virtual sales occurred during the frozen interval, this amount remains escrowed and is refundable. The order is removed and the refund corresponds to the unexecuted input; this behavior is consistent with a pause that freezes TWAMM time.

## Validation and limitations

- The repository's normal Hardhat configuration is not self-contained: it validates numerous absent RPC URL and mnemonic environment variables even for compilation. A Node 16.20.1 runtime was obtained through `npx` as authorized, but compilation stopped at config validation (`HH8`); no contract regression test was completed. `npm ci --ignore-scripts --no-audit --no-fund` installed dependencies in the temporary source checkout. System Node remains 24.22.2.
- No on-chain test or transaction was performed. The reserve-width candidate needs an isolated regression test using a synthetic ERC-20 with supply above `2^112`, a local pair, and an elapsed TWAMM interval. This ledger does not infer identical behavior for other chains or Fraxswap versions.

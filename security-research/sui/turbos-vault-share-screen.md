# Sui / Turbos Liquidity Vault: share-weighting screen

## Scope and source identity

- Chain: Sui mainnet.
- Protocol surface: Turbos Liquidity Vault, which wraps Turbos CLMM positions, plus the pinned CLMM dependency.
- Vault source: [`turbos-liquidity-vault-public` revision `5a2996c`](https://github.com/turbos-finance/turbos-liquidity-vault-public/tree/5a2996c38c7be786ec3cf943a7b3f5358b17b79d), mainnet package version 8 at `0x0ca0dbe2da5ea7c7b0d0d0796e7918413f9328c4e4bf72e2f6bcd8bf3c993c45`.
- CLMM dependency: [`turbos-clmm-public` revision `df4e892`](https://github.com/turbos-finance/turbos-clmm-public/tree/df4e892dfb970fa6919e589709554fde3fc5fa80).
- The public vault repository records a 2026-09-29 source verification against deployed modules and the CLMM link, with qualifications for missing Sui system package linkage metadata on the then-used verifier. I inspected the pinned sources; I did not independently repeat bytecode verification.
- Market relevance: DeFiLlama currently tracks Turbos as an active Sui DEX; its Sui page reports approximately $2.12m TVL and $27.73m 7-day DEX volume at the time retrieved. These aggregate figures do not establish the value or reward status of any particular vault strategy.

## Architecture and value transitions

- Each user `Vault` is an owned object. A shared `Strategy` records its CLMM pool, effective range, users' position metadata, total reward shares, idle asset balances, and protocol fee balances.
- `vault::deposit` receives assets into the user's vault account, mints or increases the vault's base/limit CLMM positions, stores the pool `sqrt_price`, and recalculates that vault's reward share.
- `vault::withdraw_v2` collects CLMM fees, decreases a percentage of the user's position liquidity, returns the proportional idle balances, charges the configured management fee, updates the stored liquidity/price, and recalculates that vault's reward share.
- `vault::rebalance_with_fee` is gated by an `OperatorCap` and a configured role. It collects the positions' fees, removes/recreates or increases CLMM positions, optionally takes a rebalance fee from the vault's assets, then updates the vault's price and reward share.
- `rewarder::strategy_rewards_settle` accrues a strategy allocation using the current stored strategy share. `vault::collect_reward` settles the strategy accumulator, credits the vault according to its stored share and reward debt, then withdraws the reward balance.

## Candidate: one vault's reward share can remain valued at a transient CLMM price

**Status:** The snapshot behavior is confirmed in source. A cross-operation reward-share distortion is plausible but unverified. There is no reproduced reward transfer or profitability result in this pass.

### Intended invariant

For an incentive pool allocated pro rata to vault shares, the share weight used to accrue future rewards should reflect the intended valuation point consistently across vaults. A transient pool price should not let one vault retain a temporary valuation after the pool price changes, unless the strategy explicitly defines shares as frozen at each vault's last interaction.

### Source path

1. `vault::deposit` reads `pool::get_pool_sqrt_price(clmm_pool)` into a local `sqrt_price` and later persists it through `update_vault_info_with_tick_range` (`sources/vault.move`, lines 551-552 and 640-654).
2. The deposit then calls `update_strategy_reward_info` (`sources/vault.move`, lines 656-661). That function derives only this vault's new share by calling `calculate_position_share` with the stored `sqrt_price`, then replaces `old_share` with `new_share` in `strategy.total_share` (`sources/vault.move`, lines 1614-1680).
3. The share calculation converts the CLMM position's token amounts using the stored square-root price (`sources/vault.move`, lines 1685-1723).
4. A later CLMM swap changes the pool price but does not itself update the vault's stored `sqrt_price` or share. The rewarder accrues using strategy total share (`sources/rewarder.move`, lines 207-229 and 260-281), and vault claims use the share/debt recorded in `VaultInfo` (`sources/vault.move`, lines 1782-1815 and 1918-1959).
5. The pinned CLMM contains price-mutating swap and flash-swap operations (`sources/pool.move`, around lines 517-654). Sui PTBs sequence calls and apply effects atomically; this makes a price-change/deposit/price-restore ordering worth testing locally, but this pass did not confirm a particular PTB composition or cost.

### Why this could transfer value

If a vault's share is increased by a temporary price snapshot and remains recorded after the CLMM price is restored, it may receive a larger fraction of subsequent strategy emissions. Those rewards come from the strategy's finite reward allocation, so other vaults in the same strategy could receive less. The share update first settles rewards accrued under the old total share; the new weight does not earn rewards retroactively. The candidate therefore concerns only later emissions while the cached weight persists.

### Limits and counter-hypotheses

- A vault owner must own/control the vault object to deposit or withdraw. Strategy rebalance and some reward collection paths require the configured operator capability. This is not a permissionless arbitrary-vault mutation.
- A temporary CLMM price change has a market cost. Turbos flash-swap receipts require repayment in the same transaction; they provide temporary liquidity, not a free price change.
- Price-dependent shares may be intentionally snapshots taken at each user action. If so, price movement between actions is an expected accounting rule rather than a defect. Confirm the documented share model and fairness policy before classifying this as a bug.
- Strategy status, reward blacklist membership, each vault's tick ranges, actual reward emission, and update ordering affect whether a measurable transfer exists.
- No claim is made that current strategies have active incentives, that deployed package state retains this exact behavior, or that the candidate is profitable after price impact and transaction costs.

## Validation gate

A local Move regression should compare control and composed operation orderings using synthetic coins and reward emissions. It should record (a) pool price before/after, (b) each vault's stored `sqrt_price` and share, (c) `strategy.total_share`, (d) rewarder accumulator/debt, and (e) final reward balances after the same elapsed interval. Include a control where every vault is revalued at the restored price. Before any live-impact conclusion, identify active strategies and reward schedules and verify the deployed package/module linkage independently.

## Screened paths without a finding

- Fractional withdrawal floors liquidity and idle-balance payouts, then updates the remaining liquidity/share. The inspected path did not show a direct accounting surplus from rounding; a regression would be required to test accumulated dust across repeated withdrawals.
- Rebalance fees are taken by an operator-gated path from the vault's idle balances after liquidity has been collected; the helper caps its take at available balance. No unauthorized caller payout was established.
- The old `withdraw` and public `rebalance` wrappers in this published source revision abort; the active router exposes `withdraw_v2` and `rebalance`, with the latter delegating to the operator-gated `vault::rebalance_with_fee`. The aborting wrappers were not treated as a vulnerability.

## Sources

- [Turbos Liquidity Vault source and deployment metadata](https://github.com/turbos-finance/turbos-liquidity-vault-public/tree/5a2996c38c7be786ec3cf943a7b3f5358b17b79d)
- [Turbos CLMM source dependency](https://github.com/turbos-finance/turbos-clmm-public/tree/df4e892dfb970fa6919e589709554fde3fc5fa80)
- [Sui PTB atomicity and command sequencing](https://www.docs.sui.io/develop/transactions/ptbs/)
- [Turbos on DeFiLlama](https://defillama.com/protocol/turbos)

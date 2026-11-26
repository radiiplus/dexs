# Jupiter Lend Smart Vaults (Solana)

**Review date:** 2026-11-26
**Status:** exploratory native-functionality composition review; no confirmed defect or profitable loop
**Chain scope:** Solana mainnet program versions forked locally in Surfpool 1.8.0
**Assessment boundary:** local simulations and synthetic token balances only; no live transaction was submitted.

## Target and source attribution

Jupiter Lend's Vaults program exposes ordinary T1 operations and DEX-integrated smart-vault operations. The relevant mainnet program IDs are Vaults `jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi`, DEX `jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd`, Liquidity `jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC`, and Oracle `jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc`.

The public [Jupiter Lend repository](https://github.com/jup-ag/jupiter-lend/tree/7960a14) provides the Vaults and DEX IDLs and an integration SDK. The exercised SDK was `@jup-ag/lend` 0.4.0. The public [Fluid Solana source snapshot](https://github.com/Instadapp/fluid-solana-programs/tree/626b177f235224bc5d074d39439cd2558f542886/programs/vaults) includes Vaults T1 operations, but not the deployed `operate_dex`, `liquidate_dex`, `rebalance_dex` handlers or the DEX program implementation. Consequently, IDL/SDK observations and deployed-bytecode behavior are distinguished below from source-verified claims.

Exact references: [Vaults IDL](https://github.com/jup-ag/jupiter-lend/blob/7960a14/target/idl/vaults.json), [DEX IDL](https://github.com/jup-ag/jupiter-lend/blob/7960a14/target/idl/dex.json), [VaultState source](https://github.com/Instadapp/fluid-solana-programs/blob/626b177f235224bc5d074d39439cd2558f542886/programs/vaults/src/state/vault_state.rs), [T1 user operation source](https://github.com/Instadapp/fluid-solana-programs/blob/626b177f235224bc5d074d39439cd2558f542886/programs/vaults/src/module/user.rs), and [Vault tick account constraints](https://github.com/Instadapp/fluid-solana-programs/blob/626b177f235224bc5d074d39439cd2558f542886/programs/vaults/src/state/context.rs). These code files are context for shared accounting and T1 behavior, not proof of the unavailable smart-vault handlers.

The upgradeable-loader program-data ELF hashes were read from mainnet and matched against the local Surfpool fork. This establishes that the fork executed the same four program binaries at the recorded read, but does not establish source-to-bytecode equivalence:

| Program | Program-data address | Deployment slot | ELF SHA-256 |
|---|---|---:|---|
| Vaults | `3EgkASqSXVcgD4s3BXR9dU8DGn5usNhNbkakCKYRvkAC` | 473721033 | `bea4108086e314c352dcf3440a255afbcf52a09555019cdbca89bdb6848f3a44` |
| DEX | `E4TqU7cqaKuAmpHZt2RZ6W4zPKqbC5K5muE3M2T5ZL1S` | 473720900 | `81a37033b308eb4fcc4ec4ebfb644bc5cbc1c9f262a2063cb3f38202337e54c7` |
| Liquidity | `J6Ry5yuy4Vp4kNa1PTGASiHJxZ8x4pgRPaJ18SmnqtW5` | 453953579 | `f7be679179291c719b204eb031cc134fe94a5299cd4bfdf705ba632863cffafe` |
| Oracle | `A5jX8nt82Pj5aQyrtooMPkgrfk5myqNRjuxC6urSJKAT` | 466022647 | `412ff998cdd15f14cf9e397bc2c0bf9312093ecce90b3c9657128a8657d7025a` |

## Architecture and execution map

The Vaults IDL exposes `operate_dex`, `operate_perfect_dex`, `liquidate_dex`, `liquidate_perfect_dex`, `rebalance_dex`, and `rebalance_dex_with_amounts`. The DEX IDL exposes deposit/withdraw and borrow/payback variants, plus `swap_in` and `swap_out`. The SDK builders assemble the Vaults instruction, DEX pool and position accounts, Liquidity reserve/position accounts, oracle accounts, and tick/branch setup instructions. Successful fork logs show Vaults `OperateDex` invoking DEX `Borrow` and Liquidity `Operate`/`PreOperate` paths.

The reviewed state topology has a particularly useful native overlap:

- DEX pool 3 (`DQfkVMGvZzqdq5jwoCRAyD26rJEioPM6kRGjC7BYts5P`) is enabled for both smart collateral and smart debt. It trades `JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD` against USDC, uses six decimals on both sides, and has a configured 1% fee.
- Vault 108 is T2: pool 3 shares are collateral and USDC is ordinary debt.
- Vault 91 is T3: the ordinary collateral mint is `59obFNBzyTBGowrkif5uK7ojS58vsuWz3ZCvg6tfZAGw`, while pool 3 shares are smart debt.
- Both Vaults therefore consume the same DEX pool state through different lending roles. This is topology evidence, not a finding.

## Invariants under review

1. A Vault's DEX supply or borrow share position should move consistently with the corresponding DEX pool share total, subject to documented fees and integer rounding.
2. A Vault's aggregate supply and debt accounting should reconcile with its DEX-side position after conversion into the Vault/Liquidity accounting units.
3. A swap can change DEX reserves and the stored price, but should not silently mint or burn lending or DEX position shares.
4. A user operation, its DEX CPI, token transfers, and Vault position updates should be atomic: a failed leg must leave no partial accounting transition.
5. Rebalance and liquidation conversions should use compatible DEX share and oracle valuation rules. These paths remain unverified because their deployed handler source is not public in the pinned materials.

## Local fork validation

Surfpool 1.8.0 served a latest-state Solana fork at `http://127.0.0.1:8891`; the final local slot observed was 474220806. Synthetic token balances were granted only to ephemeral local signers through Surfpool cheatcodes. Transaction signatures below are local Surfpool signatures and are not mainnet transactions.

### T2 deposit, DEX swap, partial withdrawal

On vault 108, a local position supplied 1,000,000 raw units of each pool token, swapped 5,000 raw units through pool 3, and withdrew 100,000 raw units of each token. The SDK used `minShares=1` for the supply and `maxShares=1,000,000,000,000,000` for the withdrawal. The swap test used `amountOutMin=0` solely to characterize local state changes.

| State | DEX total supply shares | Vault 108 total supply | DEX stored price |
|---|---:|---:|---:|
| Before | 1931207491870039 | 1931197491870029 | 999772274082896 |
| After deposit | 1931208478910632 | 1931198478910622 | 999772274136547 |
| After swap | 1931208478910632 | 1931198478910622 | 999772274132239 |
| After withdrawal | 1931208380204095 | 1931198380204085 | 999772274125702 |

The deposit increased both share totals by 987,040,593. The swap changed the stored price but did not change either share total. The withdrawal reduced both totals by 98,706,537. No mismatch appeared in this sequence.
Local transaction signatures: deposit `4NVYdckAw3SbEHqd1dJW9KWw35uzRjQ4fTw2Vy7ZcgkJy9NeDtjmXPGPxyzKfugW2Ex8T56duWW59bTd6cEGUhbo`; swap `VFqRP9cvdVqxj4CZa7oWpxXRoE13s5T3c3wM5w22nsqnHSb9eCzsPubFiZqia4njPH39mSxboxG3xuHH31KpLiT`; withdrawal `4q9XAG1C1rNUhDVMnWS3MHzdcCXxsJrTDEWKbtHQkm85p4YpPeL3eXR4Tjybu7cPvhZ3zZ6q2idsTkkjPvwQn7Wj`.

### T3 ordinary collateral plus smart debt

On vault 91, a local position supplied 1,000,000,000 raw collateral units and borrowed 100,000 raw units of each DEX token. With a permissive local `max shares` bound, `operate_dex` completed through the Vaults, DEX, Liquidity, and Oracle programs. The new Vault position recorded `supply_amount=1000000000000` in its internal normalized units and `dust_debt_amount=42857`.

In the local state immediately before the operation, DEX total borrow shares were 1499978558520298. Afterward they were 1499978656669981, an increase of 98,149,683; the aggregate Vault DEX borrow position changed from 1499973558520298 to 1499973656669981 by the same amount. The Vault state after the operation recorded total borrow `1499973720292192`. A separate mainnet read at confirmed slot 474221232 observed baseline Vault 91 total borrow `1499973622142508`, total positions 68, and next position ID 69. The Vault source snapshot's generic `update_total_borrow` helper rounds the stored total upward, so a one-unit delta difference is plausible; the smart-handler source is absent, and the isolated difference does not show an invariant violation or loss.

Local transaction signature: `26bcdjHUNfhv357TE4ahadVSwZyUJ9C5BinCfkiiyuwE2Khabhhy9nLfdgLhimn27upeiKNch2BXpXukc8SCfHQN`.

An initial simulated T3 attempt used an intentionally too-small share bound and reverted with DEX error `DexBorrowExcessSharesMinted` (6043); it left no state changes. Raising the bound allowed the operation to complete. This was expected slippage-guard behavior, not a candidate defect.

## Assessment and next checks

**Confirmed implementation defects:** none.
**Reproduced invariant violations:** none.
**Plausible but unverified risks:** exact conversions used by smart-vault liquidation and rebalancing; the relationship between `dust_debt_amount`, DEX borrow shares, and Vault aggregate debt under repeated small operations; and behavior when a swap crosses configured utilization or oracle/price boundaries.
**Expected behavior observed:** pool swaps move stored price without moving DEX share totals; smart supply/withdraw update the DEX and Vault supply totals equally in the tested T2 sequence; T3 borrowing moved aggregate DEX and Vault debt accounting by nearly identical normalized amounts.

Rebalance is gated by each Vault configuration's rebalancer authority and was not exercised with an unauthorized signer. Liquidation was not tested because no controlled unhealthy synthetic position was established. Flash liquidity was not needed for these native operation tests. The next source-dependent work is to acquire a deployment-matched DEX/Vaults smart-handler build or a full source release, then verify the one-unit rounding observation and test exact-share liquidation/rebalance transitions against independently decoded account states.

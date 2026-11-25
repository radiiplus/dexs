# Ethereum / SushiSwap V2 Evidence Ledger

## Status and scope

- Chain: Ethereum. This is the second DEX in the GeckoTerminal `/api/v2/networks/eth/dexes` listing.
- DEX: SushiSwap V2 (`sushiswap/v2-core`), source commit `a349882c918c752d0363e4c6e02dedcbc48b734e`, package version `1.0.0`.
- Source repository and files: [`sushiswap/v2-core`](https://github.com/sushiswap/v2-core/tree/a349882c918c752d0363e4c6e02dedcbc48b734e); reviewed [`UniswapV2Factory.sol`](https://github.com/sushiswap/v2-core/blob/a349882c918c752d0363e4c6e02dedcbc48b734e/contracts/UniswapV2Factory.sol), [`UniswapV2Pair.sol`](https://github.com/sushiswap/v2-core/blob/a349882c918c752d0363e4c6e02dedcbc48b734e/contracts/UniswapV2Pair.sol), [`UniswapV2Router02.sol`](https://github.com/sushiswap/v2-core/blob/a349882c918c752d0363e4c6e02dedcbc48b734e/contracts/UniswapV2Router02.sol), [`UniswapV2Library.sol`](https://github.com/sushiswap/v2-core/blob/a349882c918c752d0363e4c6e02dedcbc48b734e/contracts/libraries/UniswapV2Library.sol), and [`SushiRoll.sol`](https://github.com/sushiswap/v2-core/blob/a349882c918c752d0363e4c6e02dedcbc48b734e/contracts/SushiRoll.sol).
- Compiler: Solidity `0.6.12`; optimizer configured for 200 runs.
- Scope: official repository contracts and its Ethereum deployment artifacts, plus isolated local reproduction. No live deployment or public network state was queried.
- The repository provides `deployments/ethereum/UniswapV2Factory.json` and `UniswapV2Router02.json`, with manifest addresses `0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac` and `0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F`. These are repository deployment records, not independently verified current deployments.
- `deploy/SushiRoll.ts` includes chain ID 1 and deploys SushiRoll against the canonical Uniswap V2 router and this repository's Sushi router. However, there is no `deployments/ethereum/SushiRoll.json`. Therefore the migration defect below is confirmed in the checked source and locally reproduced, but whether this exact SushiRoll implementation is deployed on Ethereum remains unverified.

## Architecture and execution map

- Factory/pair/LP token follow the V2 constant-product architecture, with Sushi LP name/symbol and a factory-controlled `migrator` extension (`contracts/UniswapV2Factory.sol:10-66`, `contracts/UniswapV2Pair.sol:1-205`, `contracts/UniswapV2ERC20.sol:1-98`).
- Pairs use CREATE2. The factory's deployment artifact is used by the repository's deployment script to preserve the expected pair creation code hash; this matters because `UniswapV2Library.pairFor` embeds a fixed init-code hash (`deploy/UniswapV2Factory.ts`, `contracts/libraries/UniswapV2Library.sol:18-30`).
- Router02 manages normal liquidity and swap paths and uses pair balances/reserves for settlement (`contracts/UniswapV2Router02.sol:12-453`). It is not an accounting custodian. The pair lock protects mint, burn, swap, skim, and sync; swap output is optimistic and callback settlement is checked against fee-adjusted `k` (`contracts/UniswapV2Pair.sol:31-36, 115-211`).
- The source includes `SushiRoll` for moving Uniswap V2 liquidity to SushiSwap. `migrateWithPermit` applies an old-pair permit and calls `migrate`; `migrate` burns the caller's old LP into SushiRoll, computes destination amounts, and should issue replacement Sushi LP (`contracts/SushiRoll.sol:12-76`).
- SushiRoll's `removeLiquidity` transfers old LP from the caller to the old pair, burns it to SushiRoll, then checks minimum underlying amounts (`contracts/SushiRoll.sol:78-92`). The source also contains an internal `addLiquidity` helper that transfers tokens and calls destination `mint`, but neither public migration function calls it (`contracts/SushiRoll.sol:111-134`).

## Entry-point and transition inventory

- Factory: `createPair`, `setFeeTo`, `setMigrator`, `setFeeToSetter`, plus pair enumeration and `pairCodeHash` views.
- Pair: `initialize`, `mint`, `burn`, `swap` including optional `uniswapV2Call`, `skim`, and `sync`; LP token `approve`, `transfer`, `transferFrom`, and `permit`.
- Router02: add/remove liquidity, permit-based removal, standard exact-input/exact-output swaps, fee-on-transfer variants, WETH wrapping/unwrapping, quote and route calculation views.
- Migrator: `migrateWithPermit` or `migrate`; expected sequence is old LP authorization -> old pair LP transfer -> old pair burn to migrator -> transfer underlying into new pair -> mint new LP to caller -> refund excess.
- Actual `migrate` sequence stops after the quote step: `removeLiquidity` -> `_addLiquidity` (pair create/quote only) -> refund arithmetic. No underlying transfer to the destination pair and no replacement LP mint occurs.

## Critical invariants reviewed

1. Pair reserves equal observed balances on successful pair settlement and fit `uint112`; swap final balances satisfy the fee-adjusted constant-product check.
2. LP supply changes in mint/burn correspond to underlying pool balance changes and preserve proportional ownership, subject to permanent minimum liquidity and the configured protocol fee.
3. A completed migration must not consume old LP shares unless it either mints destination LP representing the received assets or returns all received assets to the caller.
4. Any failed migration subcall or minimum check reverts prior token/LP transfers atomically.
5. Factory migrator override affects only first liquidity mint: while set, only the configured migrator may initialize the pair and it supplies the first LP quantity via `desiredLiquidity`; this is a privileged migration mechanism, not a permissionless LP accounting path.

## Findings

### High confidence: SushiRoll migration strands underlying tokens without issuing new LP

- Classification: confirmed implementation defect in checked source; reproduced invariant violation in an isolated local environment; Ethereum deployment exposure unverified.
- Location: `contracts/SushiRoll.sol:56-75`, `:85-91`, `:111-134`, `:136-164`.
- Preconditions: user has old Uniswap V2 LP and approves SushiRoll (or supplies a valid permit); the old pair and destination token/pair calls work; the migration's minimum amounts pass.
- Before: caller owns old LP; old pair holds underlying reserves; SushiRoll holds no assets; destination pair may not exist.
- Execution: `removeLiquidity` transfers the old LP to the old pair and burns it, sending underlying tokens to SushiRoll. `migrate` then calls `_addLiquidity`, which creates/looks up the Sushi pair and calculates desired amounts from its reserves, but performs no token transfer and does not call `mint`. The apparent mutating helper at lines 111-134 is unused. Refund logic transfers back only positive `amountOut - quoteAmount` deltas.
- After successful completion: caller's old LP is burned; SushiRoll retains the amount considered pooled; the new Sushi pair has no corresponding reserves or LP supply; SushiRoll has no withdrawal/recovery entrypoint. In the equal-reserve empty-destination reproduction, SushiRoll retained all withdrawn amounts.
- Invariant violation: a successful migration consumes the user's old liquidity claim without either creating a new claim or returning the corresponding underlying assets.
- Root cause: quote-only `_addLiquidity` is called where a mutating migration operation is required; the unused helper additionally pulls tokens from `msg.sender`, even though the burned assets are held by SushiRoll.
- Remediation: transfer the received amounts from SushiRoll to the destination pair, call pair `mint` with the caller as recipient, then refund only the true post-mint remainder. Do not route the internal operation through the unused helper without changing its token source. Add a regression test asserting old LP burned implies destination LP minted or all underlying refunded.

## Validation and independent review

- Isolated harness: `/tmp/gecko-sushiswap-harness/repro.js` compiled Sushi source with Solidity `0.6.12`, deployed synthetic ERC-20s, a canonical Uniswap V2 factory/pair, the repository's Ethereum Sushi factory artifact, router stubs, and SushiRoll to local Ganache. No live RPC or deployed contract was used.
- Result: reproduced successfully. User old LP balance `0`; old pair total supply `1000` (locked minimum); new pair LP supply `0`; new reserves `[0, 0]`; SushiRoll token balances each `999999999999999999000`, exactly matching the old pair burn outputs.
- Independent source review confirmed the quote-only call, unused mutating helper, refund behavior, and lack of a recovery method. The reviewer separately confirmed the deployment caveat: chain ID 1 appears in the deploy script, but the Ethereum deployment directory has no SushiRoll artifact.
- The repository has no committed test suite or test script for this contract. The local reproduction is the regression test for this finding.
- No live deployment interaction, transaction broadcast, or real-asset test was performed.

## Rejected hypotheses / expected behavior

- **Migrator can choose first LP supply:** privileged factory-configured migration behavior explicitly added by `contracts/README.md` and constrained to the configured migrator; not reportable as a permissionless accounting defect without evidence that the trust boundary is bypassed.
- **Reserve/balance differences and `skim`/`sync`:** pair's explicit surplus and reconciliation behavior; no independent value-accounting violation demonstrated in reviewed pair paths.
- **Fee-on-transfer inputs:** Router02 exposes supporting swap paths using observed pair balance deltas. Other nonstandard token behavior remains an integration assumption.
- **Hardcoded CREATE2 hashes:** must match the corresponding factory/pair deployment artifact. The repository intentionally uses the Ethereum factory artifact in its deploy script; independently compiling its newer factory source yielded a different pair code hash, so those compiled source artifacts must not be mixed with the deployment artifact. No separate live deployment mismatch was tested.

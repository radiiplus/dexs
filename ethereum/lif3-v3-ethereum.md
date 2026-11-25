# LIF3 V3 (Ethereum) Evidence Ledger

## Target and Source Attribution

- Chain: Ethereum mainnet; GeckoTerminal DEX ID `lif3-ethereum`.
- GeckoTerminal listed five Ethereum pools on 2026-11-25. All five identify as `Lif3V3Pool` instances created by `Lif3V3Factory` at `0x129538ee65a692fa041e107921d716c31d186803`.
- Sample pool: USDC/WETH 0.3%, `0xa70e93c5eb55a88b191a732e14189ad3d2df38f2`. Factory and pool use Solidity `0.7.6+commit.7338295f`, optimizer 200, Istanbul EVM. Blockscout reports source as verified but partially matched for both contracts.
- The explorer-published source is available from the [LIF3 factory](https://eth.blockscout.com/address/0x129538ee65a692fa041e107921d716c31d186803?tab=contract) and [sample pool](https://eth.blockscout.com/address/0xa70e93c5eb55a88b191a732e14189ad3d2df38f2?tab=contract). No matching public LIF3 V3 core repository was attributed in this pass.
- Recompiling the pool source with its recorded settings matches the deployed sample pool runtime outside immutable references and CBOR metadata. The fork test also confirms that a new pool created by the deployed factory has that same runtime outside its own immutable values and metadata. Factory runtime identity was not independently matched, so no full factory bytecode claim is made.
- Fee tier used for the reproduction: 3,000 with tick spacing 60. The other GeckoTerminal listings are WETH/USDT, WBTC/WETH, LIF3/WETH, and LSHARE/WETH, each at fee 3,000.

## Architecture and Execution Map

- `Lif3V3Factory` controls enabled fee/tick-spacing pairs and maps token0/token1/fee to a pool created through its deployer. Its owner can set pool protocol fee configuration through the pool's factory-owner gate.
- Each `Lif3V3Pool` stores price/tick state, active `uint128` liquidity, fee growth, protocol fees, and positions keyed by owner and tick range. `mint` obtains owed tokens through `uniswapV3MintCallback`; `burn` removes liquidity and returns principal as `uint256`; `collect` transfers amounts from the position's `uint128 tokensOwed0/1` fields. `swap` and `flash` use callbacks while the pool is locked and verify final token balances before completing.
- The accounting boundary of interest is the conversion from full-width principal returned by `_burn` to the narrower per-position owed counters. Position liquidity is reduced in the same operation, and no generic pool-level `skim` or `sync` path exists to recover any principal that is not represented by a position claim.

## Critical Invariants

- Burning liquidity must either transfer the full principal or preserve it in a collectible claim, allowing only documented rounding.
- A position reaching zero liquidity must not leave its owner's principal unclaimable in pool balances.
- Mint, swap, and flash callbacks must settle before the pool unlocks or finalizes changed accounting.
- Fee growth and protocol fee counters must track their corresponding pool balances without narrowing away payable claims.

## Findings

### Low: burn principal is narrowed before it becomes collectible

Status: **Confirmed on the deployed LIF3 pool code in a local fork using a pool created by the deployed factory.** The explorer-published pool source and runtime match outside immutables and metadata. No current public pool exposure at the demonstrated scale is established.

The pool's `_burn` path computes principal as `uint256 amount0/amount1`, then adds `uint128(amount0)` and `uint128(amount1)` to `position.tokensOwed0/1`. The position's owed counters and `collect` return values are only 128 bits. If principal exceeds `2^128 - 1`, only the low 128 bits become collectible even though the requested liquidity is fully removed. The remainder stays in pool token balances without a live position claim.

The isolated reproduction forked Ethereum at block `26,492,441`, created a synthetic fee-3000 pool through LIF3's deployed factory, and initialized an extreme price with both sides funded by synthetic tokens. It minted and burned `2^100` liquidity, below the observed `maxLiquidityPerTick = 11505743598341114571880798222544994`. Burn returned `23322433066825155941180678901280398067255600096860` raw units on the tested side; the position recorded and collected only `241505722945880744600311766032696092252`. After collection, `23322433066583650218234798156680086301222904004609` units remained in the pool with position liquidity zero, within one raw unit of exact truncation accounting.

This is permanent principal stranding for the affected position. The required balances are extreme; all five current GeckoTerminal listings were checked for factory registration, but this assessment did not establish any live pool or position whose principal reaches the width boundary. No real asset was used and no transaction was sent to Ethereum.

Remediation: retain full-width principal claims or reject burns before reducing position liquidity whenever the result cannot be represented. Add tests around the `uint128` boundary for both token sides.

## Rejected Hypotheses

- **Tick-spacing liquidity cap prevents the principal boundary:** disproven. The reproduced `2^100` liquidity is below the fee-3000 per-tick cap; the cap constrains liquidity, not token principal at extreme prices.
- **The excess is rounding dust:** disproven. The leftover exceeds one raw unit and equals principal minus the narrowed collectible amount, within the stated one-unit tolerance.
- **The excess can be claimed through a pair-level skim:** disproven. The V3 pool exposes no generic `skim`/`sync` path; `collect` is bounded by the position's recorded owed values.
- **The result is transferred from another DEX's ledger:** not assumed. The test used LIF3's factory, LIF3's fee spacing, LIF3-created pool code, and LIF3's own indexed pool registrations.

## Isolated Validation and Limits

- `lif3-v3-principal-width-fork.test.js` reads the explorer-published pool and factory records, recompiles the pool source, verifies the sample pool runtime outside immutable references and metadata, verifies all five GeckoTerminal listings resolve to the LIF3 factory, creates a synthetic fee-3000 pool through that factory, and reproduces the burn/collect mismatch. Result: pass at fork block `26,492,441`; no public-chain transactions.
- Factory runtime identity was not matched in this pass. Pool code attribution is supported by verified explorer source and the fork-created pool runtime match. The test establishes a code-level invariant violation but not current real-pool financial exposure.

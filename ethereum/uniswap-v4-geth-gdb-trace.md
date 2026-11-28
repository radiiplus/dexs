# Uniswap V4 PoolManager Geth/GDB Trace

## Scope

This is a local dynamic trace of the verified Ethereum PoolManager runtime inside Geth's EVM. It tests whether caller callback code can cause PoolManager-scoped transient writes through ordinary manager calls, and whether the delta slot and nonzero-delta counter reconcile before `unlock` returns.

- PoolManager: `0x000000000004444c5dc75cb358380D2e3dE08A90`
- Runtime: 24,009 bytes, fetched from Ethereum and compared with the Sourcify full-match source build; bytecode matched outside the constructor immutable at offset 13,606.
- Solidity build: `0.8.26`, optimizer runs `44,444,444`, `viaIR`, Cancun, metadata bytecode hash disabled.
- Geth source: commit `6fe8b63d41be9218808adb9b25d6b21c55b37b54`; Go `1.27.3`; GDB `15.1`.
- Environment: local synthetic `StateDB`, no forked state, no live calls, no flash loan.

## Trace

A synthetic unlock callback performs an ordinary balanced ERC-6909 mint/burn against the actual PoolManager runtime. GDB stopped in Geth's `StateDB.SetTransientState`, reached from the EVM `opTSTORE` handler. All writes used the PoolManager address as the transient-storage namespace.

| Manager transient slot | Observed transition | Meaning |
| --- | --- | --- |
| Lock slot `0xc090fc4683624cfc3884e9d8de5eca132f2d0ec062aff75d43c0465d5ceeab23` | `0 -> 1 -> 0` | Unlock and relock |
| `keccak256(pad32(callback) || pad32(currency))` | `0 -> -1 -> 0` | Account delta created by mint, then resolved by burn |
| Nonzero-delta count `0x7d4b3164c6e45b97e7d87b7125a44c5828d005af88f9d751cfd78729c5d99a0b` | `0 -> 1 -> 0` | Count follows zero/nonzero delta transitions |

The EVM call completed successfully. The harness asserted that both the account delta and nonzero-delta count were zero after `unlock`; the test passed. Geth's ordinary interpreter differential test also passed under GDB.

## Interpretation

Caller code can indirectly make PoolManager write transient state by calling PoolManager functions. It does not directly select the transient-storage owner: Geth's `TSTORE` handler passes `scope.Contract.Address()` to `SetTransientState`. Geth stores transient entries by `(address, key)` and journals writes for rollback. The relevant implementation is [`opTstore`](https://github.com/ethereum/go-ethereum/blob/6fe8b63d41be9218808adb9b25d6b21c55b37b54/core/vm/eips.go), [`StateDB.SetTransientState`](https://github.com/ethereum/go-ethereum/blob/6fe8b63d41be9218808adb9b25d6b21c55b37b54/core/state/statedb.go), and [`transientStorage`](https://github.com/ethereum/go-ethereum/blob/6fe8b63d41be9218808adb9b25d6b21c55b37b54/core/state/transient_storage.go).

This trace confirms ordinary caller-induced PoolManager state transitions, but found no phantom delta or counter desynchronization in the tested path. It is not an exhaustive execution of every entry point or callback composition and does not establish profitability. The source-level invariant remains that `_accountDelta` writes the account/currency delta and applies the corresponding zero/nonzero counter transition without an external call between them.

The temporary Geth test harness was kept in the local Geth checkout and was not added as a standalone repository test because it depends on Geth's internal `core/vm` test helpers and the locally fetched runtime file.

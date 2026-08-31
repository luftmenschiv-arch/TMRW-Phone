# Preview 37 / v3 opt-in beta activation contract

This is a Phase 0 validation contract. It does not implement activation, v3 storage, migration, or rollback.

## Locked behavior

1. Preview 37 remains installed, unchanged, and available throughout the beta.
2. Preview 37's legacy data remains intact and readable.
3. Future v3 is disabled by default and must require an explicit opt-in.
4. Future v3 uses a distinct storage namespace and may not write Preview storage.
5. Initial migration reads or copies legacy data; it never deletes, moves, truncates, or migrates Preview data in place.
6. Disabling v3 stops its UI, listeners, jobs, timers, adapters, writes, and context injection.
7. Returning to Preview uses its preserved original data and requires no manual backup restore.
8. Exactly one TMRW runtime may author canon for a Story at a time.
9. Exactly one injector may add context for a source event.
10. Switching back does not silently merge v3-only canon into Preview.
11. Preview 37 cannot retire until rollback, migration, privacy, performance, stability, parity, and real beta evidence pass.

## Executable validation

```powershell
cd C:\ai\tmrw-extension\v3
node --test beta/activation-contract/activation-contract.test.mjs
```

Phase 1 must turn these assertions into runtime tests. It must not weaken or rewrite them to match an implementation.

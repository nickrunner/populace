# ADR-0004: Local and cloud modes share the runner; only Store and Scheduler differ

**Status:** accepted (fixed by brief)

## Decision

`Store` and `Scheduler` are interfaces in `@populace/core`. Milestone 0 implements `SqliteStore` and an in-process tick loop (`LocalDaemon`). Cloud mode will add a Postgres store and an external scheduler that invokes the same `runWake()` in a container. The runner never imports a concrete store.

## Consequences

The Store interface is wider than SQLite strictly needs (per-population daily cost, kill switch, tag queries) because those are the operations a cloud control plane will need too.


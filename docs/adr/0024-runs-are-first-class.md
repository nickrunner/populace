# ADR-0024: Runs are first-class and carry a frozen config snapshot

**Status:** accepted

## Decision

A run becomes an entity with a label, status, lineage and totals, and it points at a `ConfigSnapshot`: the resolved `PopulaceConfig` serialised once when the run starts, immutable thereafter, content-hashed so identical snapshots dedupe. Secrets are redacted to a reference — the snapshot records that an env var was used, never its value.

M1 does not store this. The roadmap holds M1 to no new persisted data, and everything but label, status and the snapshot is derivable from `agents`, `wakes` and `findings`. M1 ships a `RunSummary` read model behind a query interface; M2 puts the table underneath it without changing a screen.

## Consequences

Config that lives in rows and can be edited would otherwise rewrite history: editing a persona would change what a past run was. The snapshot is what stops that, and it is what lets a continuation say "same population, target repaired" instead of asking the user to remember.

Until M2 the derived model aggregates on every request and cannot tell a run that finished from a run whose daemon was killed. Both are acceptable for a read-only local dashboard and neither survives the browser being able to start runs, which is why the table lands in the same milestone that adds the button.

# ADR-0011: Local store on `node:sqlite`

**Status:** accepted

## Decision

`@populace/store-sqlite` uses the `node:sqlite` module built into Node 22 (`DatabaseSync`), not `better-sqlite3`. No native compilation, no prebuilt download, nothing to fail in a locked-down CI or behind a proxy. The module prints an `ExperimentalWarning` on Node 22; the CLI suppresses it.

## Consequences

Node 22.13+ is required. If `node:sqlite` changes shape, the store is the only package that touches it and every row goes through zod on read.


## Amendment (2026-09-18): the migration runner is deleted, and what brings it back

`DATA-MODEL.md` §11 planned a small ordered migration runner for M2, on the reasoning that authored
rows are a user's work and must never be dropped. That reasoning is right and its timing was wrong.
The restructure to projects, simulations, cohorts and people (ADR-0029) rewrote nearly every table
at once, and the only databases in existence were developers' throwaway local stores in this
repository. A migration sequence written for that is a sequence nobody will ever execute, kept
correct by hand for as long as it exists.

So `migrations.ts` is deleted — `Migration`, `applyMigrations`, `MIGRATIONS`,
`LATEST_SCHEMA_VERSION`, the `schema_version` control key and `dropPreRunScopedMemories` with it.
In its place, one `SCHEMA` constant holds every table and a `schema_shape` constant baked into the
source is written to `control` on a fresh file and compared on open. A mismatch drops every table,
recreates them, and warns:

```
populace store: the schema changed; this database was rebuilt from scratch and its runs are gone.
```

**The trigger that ends this regime, stated so it is not a judgement call later: the first database
outside this repository that holds a target somebody typed.** The moment a person has entered an
endpoint, a bearer token, a persona they wrote or a cohort they cast, dropping their tables is data
loss and the migration runner has to exist before the next schema change ships. It is cheaper to
write it with twelve tables in it than to write it now against a schema that is still moving, and
the cost of being wrong about the trigger is exactly one warned rebuild of a developer's own store.

Until then the rule is: produced and derived rows are expendable, authored rows are expendable
*only because there are none that matter yet*, and that sentence has an expiry date.

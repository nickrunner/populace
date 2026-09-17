# ADR-0011: Local store on `node:sqlite`

**Status:** accepted

## Decision

`@populace/store-sqlite` uses the `node:sqlite` module built into Node 22 (`DatabaseSync`), not `better-sqlite3`. No native compilation, no prebuilt download, nothing to fail in a locked-down CI or behind a proxy. The module prints an `ExperimentalWarning` on Node 22; the CLI suppresses it.

## Consequences

Node 22.13+ is required. If `node:sqlite` changes shape, the store is the only package that touches it and every row goes through zod on read.


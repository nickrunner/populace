# ADR-0022: `populace serve` is one process and owns the store

**Status:** accepted

## Decision

`populace serve` starts the HTTP API and hosts the daemon tick loop in the same process, and that process is the single writer to the store. It takes an advisory lock (a row in `control` naming pid and start time). A second `serve`, or a `populace run` against the same database, refuses to start and names the holder; `--force` breaks a stale lock. Read-only commands do not take the lock.

`node:sqlite`'s `DatabaseSync` is synchronous and single-process (ADR-0011), so two writers means `SQLITE_BUSY` under exactly the conditions that matter — a run in flight while someone clicks in the browser.

## Consequences

A user runs one command to get the product. The CLI keeps every command it has, but `run` and `serve` are mutually exclusive against one database, which is a behaviour change worth documenting rather than discovering.

This does not weaken ADR-0004. In cloud mode the API and the runners are separate processes again; what replaces the in-process loop is the `Scheduler` implementation and a job queue, not the runner.

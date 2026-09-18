# ADR-0022: `populace serve` is one process and owns the store

**Status:** accepted

## Decision

`populace serve` starts the HTTP API and hosts the daemon tick loop in the same process, and that process is the single writer to the store. It takes an advisory lock (a row in `control` naming pid and start time). A second `serve`, or a `populace run` against the same database, refuses to start and names the holder; `--force` breaks a stale lock. Read-only commands do not take the lock.

`node:sqlite`'s `DatabaseSync` is synchronous and single-process (ADR-0011), so two writers means `SQLITE_BUSY` under exactly the conditions that matter — a run in flight while someone clicks in the browser.

## Consequences

A user runs one command to get the product. The CLI keeps every command it has, but `run` and `serve` are mutually exclusive against one database, which is a behaviour change worth documenting rather than discovering.

This does not weaken ADR-0004. In cloud mode the API and the runners are separate processes again; what replaces the in-process loop is the `Scheduler` implementation and a job queue, not the runner.

## Amendment (M2, 2026-09-18): one run at a time

`POST /runs` refuses to start a second run while one is going, and answers `409` with "a run is
already going; stop that one before starting another".

The reason is the kill switch, not the lock. "Stop everything now" is the store row every in-flight
wake checks between turns (ADR-0009), so it is global by construction: with two runs going it would
stop both, and a button that claims to stop what the user is looking at would be lying. One process,
one writer and one run is a coherent whole; one process, one writer and two runs is not.

This is a local-install constraint and M4 has to revisit it. That rung is done when one install
drives three targets on schedules, and a scheduled start arriving during another run would be
refused with a 409 that nobody is watching — a build or a schedule that silently skipped its run is
worse than one that waited. M4 either queues starts or makes the stop run-scoped and leaves the kill
switch as the global control it is. `WEB-ARCHITECTURE.md` §8 carries the same note on the M4 row.


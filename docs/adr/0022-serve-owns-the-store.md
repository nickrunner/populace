# ADR-0022: `populace serve` is one process and owns the store

**Status:** accepted

## Decision

`populace serve` starts the HTTP API and hosts the daemon tick loop in the same process, and that process is the single writer to the store. It takes an advisory lock (a row in `control` naming pid and start time). A second `serve`, or a `populace run` against the same database, refuses to start and names the holder; `--force` breaks a stale lock. Read-only commands do not take the lock.

`node:sqlite`'s `DatabaseSync` is synchronous and single-process (ADR-0011), so two writers means `SQLITE_BUSY` under exactly the conditions that matter — a run in flight while someone clicks in the browser.

## Consequences

A user runs one command to get the product. The CLI keeps every command it has, but `run` and `serve` are mutually exclusive against one database, which is a behaviour change worth documenting rather than discovering.

This does not weaken ADR-0004. In cloud mode the API and the runners are separate processes again; what replaces the in-process loop is the `Scheduler` implementation and a job queue, not the runner.

## Amendment (2026-09-18): executions are exclusive per simulation, and the stop is not

What "one at a time" means changed with the entity model (ADR-0029), and the two halves no longer
line up.

**Starting is scoped to a simulation.** `startOne` refuses an execution while another execution of
the *same* simulation is `running` or `pending`, and names it: *"execution 3 of this simulation is
still going; pause or stop it before starting another"*. The reason is the target reset, not the
lock: an ephemeral start puts the target back before its first visit (ADR-0030), so a second
execution begun while the first is still going wipes the database out from under the people already
in it, and every report they file afterwards is against a state nobody asked for.

**Stopping is not scoped to anything.** `stop(runId, "now")` engages the store's kill switch, which
is the row every in-flight wake checks between turns (ADR-0009) and is global by construction. Two
simulations in a project can now run at once, so "Stop everything now" on one of them stops the
other, and — because `startOne` refuses to start anything while the switch is engaged — keeps it
from being restarted until somebody releases it. The button's label is honest about what it does
and the screen it sits on is not honest about what it covers.

This was written as a constraint M4 would have to undo. The restructure undid half of it early: the
per-simulation guard is right and should stay, while the global stop is now a live gap rather than a
future one. Two other things follow the same seam and are unguarded today: two simulations pointing
at one target, where an ephemeral start resets it under whoever else is using it
(`requireFreshTarget` checks only that a reset *exists*, not that nobody else is mid-run against
it), and the daily spend ceiling, which `dailyCeilingBreached` scopes to a *population* — so three
simulations on three populations have three ceilings and nothing holds the machine's total, which
is not what a number labelled "spending today" reads as.

The resolution is the one the original amendment named: make the stop run-scoped and leave the kill
switch as the global control it is, with a separate and clearly-labelled way to reach it. Scheduled
runs (M4) make it urgent rather than creating it — a schedule that silently skipped its run is
worse than one that waited. `WEB-ARCHITECTURE.md` §9 carries this as an open item.

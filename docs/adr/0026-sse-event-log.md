# ADR-0026: Live updates over SSE, backed by a persisted event log

**Status:** accepted

## Decision

Live updates are Server-Sent Events on one endpoint, `/api/v1/events?after=<cursor>`, carrying a discriminated union declared in `contract`. The cursor is a monotonic sequence over an append-only `events` table written by the runner's existing trace writer and by the daemon at run boundaries.

SSE over WebSockets because the flow is one-directional — control actions are plain POSTs — and because SSE reconnects itself and `Last-Event-ID` maps exactly onto the cursor.

The log lands in M2. M1's trace viewer reads `trace_events` and polls; its live mode is the same component with a live cursor.

## Consequences

`trace_events` is ordered per wake, which is right for replay and useless for "what happened next anywhere". A store-level cursor gives a reconnecting browser a replay instead of a gap, gives the run screen one subscription, and in M5 is how separate runner and API processes meet.

The log is derived from rows that already exist and may be truncated by age or count. Stating that now stops it from being treated later as the system of record.

## Amendment (2026-09-18): who writes the log, and who fills in the scope

The log is written by a `RecordingStore` decorator around the `Store`, not by the trace writer
itself. Every row it appends is derived from a write the runner was already making — a wake saved, a
finding saved, an identity saved, a trace event appended — which is what keeps `runWake()` untouched
and keeps the log honestly derived. An append that fails is swallowed: the log is derived data, and
losing a row of it costs a live update, while throwing would lose the wake that produced it.

**Every event about a run must carry its `runId`.** Both ends of delivery filter on it: the
in-process fan-out compares the event's ids to the subscriber's filter, and `listEvents` filters
with `run_id = ?`, which excludes NULL in SQL. An event about a run written with a null `runId`
therefore reaches neither the live stream nor the replay of the screen that run owns. A null
`runId` means the event is genuinely not about a run.

**Scope is stamped, not passed in.** Once a project holds several simulations, a page wants one
connection for all of them (`GET /events?project=…`), which needs `projectId` and `simulationId` on
the row. An emitter deep inside a wake knows its wake and its run and has no business knowing which
project the run is filed under, so `RecordingStore.scoped()` fills both from the run row, and fills
`runId` itself from the wake where only the wake is known. It caches per run, because a run's
project never changes — with one exception it must not cache: a run whose row is written a moment
after its first event is stamped with what is known and asked about again next time, rather than
the cache remembering "no project" forever.

The one emitter this cannot serve is a job with no run at all — `people.generate`, `target.reset`,
and `run.start` until the row it is creating exists. Those pass `projectId` explicitly, which is
why `Job` carries one.

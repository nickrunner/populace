# ADR-0026: Live updates over SSE, backed by a persisted event log

**Status:** accepted

## Decision

Live updates are Server-Sent Events on one endpoint, `/api/v1/events?after=<cursor>`, carrying a discriminated union declared in `contract`. The cursor is a monotonic sequence over an append-only `events` table written by the runner's existing trace writer and by the daemon at run boundaries.

SSE over WebSockets because the flow is one-directional — control actions are plain POSTs — and because SSE reconnects itself and `Last-Event-ID` maps exactly onto the cursor.

The log lands in M2. M1's trace viewer reads `trace_events` and polls; its live mode is the same component with a live cursor.

## Consequences

`trace_events` is ordered per wake, which is right for replay and useless for "what happened next anywhere". A store-level cursor gives a reconnecting browser a replay instead of a gap, gives the run screen one subscription, and in M5 is how separate runner and API processes meet.

The log is derived from rows that already exist and may be truncated by age or count. Stating that now stops it from being treated later as the system of record.

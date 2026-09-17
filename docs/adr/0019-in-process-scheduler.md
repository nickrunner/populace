# ADR-0019: Scheduler interface and the in-process cadence loop

**Status:** accepted

## Decision

`Scheduler.nextWakeAt(agent, now, lastWake)` returns the next due time from the population cadence (`every`, `jitter`, optional per-persona override). The store keeps `nextWakeAt` per agent. The local daemon ticks every few seconds, claims due agents up to a concurrency limit, runs `runWake()` for each and reschedules. Agents with `maxWakes` reached are retired. A cloud scheduler would call the same `nextWakeAt` and enqueue jobs instead.


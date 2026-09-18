# ADR-0019: Scheduler interface and the in-process cadence loop

**Status:** accepted

## Decision

`Scheduler.nextWakeAt(agent, now, lastWake)` returns the next due time from the population cadence (`every`, `jitter`, optional per-persona override). The store keeps `nextWakeAt` per agent. The local daemon ticks every few seconds, claims due agents up to a concurrency limit, runs `runWake()` for each and reschedules. Agents with `maxWakes` reached are retired. A cloud scheduler would call the same `nextWakeAt` and enqueue jobs instead. An agent retires for one of three
reasons, recorded on `agent.retiredReason`: `gave-up`, `max-wakes`, or `scaled-down`.

## Amendment (2026-09-18): `give_up` retires the agent

`give_up` is described to the model as leaving for good, and it ended the wake -- but nothing
retired the agent, so it woke again on the next cadence tick. Observed in a live run: all three
personas abandoned the product by wake 2 and every one of them came back, two of them filing a
second abandonment finding for the same decision.

Two consequences, and the second is the one that matters. Wakes are paid for that should never
have happened. More importantly the signal is wrong: churn is a thing a synthetic population
exists to measure, and "five abandonments across twelve wakes" from three personas who each quit
once is not a measurement. The returning agent also reads memory from a session in which it
decided to leave.

`runWake` now retires the agent when a wake ends `gave-up` (in `runWake`, not the daemon, so
`populace wake` behaves the same way), and the daemon never reschedules an agent that retired
itself during its wake.

`reconcile()` revives a retired agent when `maxWakes` is raised above its `wakeCount`, which
would have resurrected every agent that quit. It now skips agents whose `retiredReason` is
`gave-up`: an operator raising a limit is lifting their own constraint, not overruling the
agent's own decision. Retiring on `gave-up` without this is a no-op across runs.


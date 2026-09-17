# ADR-0003: Agents are never long-lived processes; a wake is a stateless job

**Status:** accepted (fixed by brief)

## Decision

An agent is data (persona, identity, memory, schedule) in the store. A wake is one execution: load state, run one session against the target, persist memory, trace, findings and cost, exit. `runWake()` in `@populace/runner` is that job. It holds no state between invocations and can run in any process.

## Consequences

- Scale is a scheduling question, not a process-management one.
- Memory must carry everything a returning user needs (ADR-0008).
- The message history of a wake is discarded after the wake; only the trace keeps it.


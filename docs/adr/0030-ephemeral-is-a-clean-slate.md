# ADR-0030: Ephemeral is a clean slate, not a repeatable result

**Status:** accepted 2026-09-18

## Context

A simulation needs to answer two different questions, and they want opposite things from history:

1. *"Is my product any good right now?"* — send people who know nothing about it, let them finish,
   read what they found. Then ship a change and do it again.
2. *"What happens to people who use this for a fortnight?"* — one cast, accumulating memory,
   accounts and grievances, running until somebody stops it.

The obvious framing for the first one is "repeatable", and it is wrong. The model is sampled,
`fallbacks: "default"` may route a request to a different model, cadence jitter is real, and the
target's state moves under everybody's feet. Two executions of one simulation **will** produce
different prose, different counts and different costs, and one may find a problem the other misses.

The user was explicit about this: *"My point wasn't that it needs to repeat exactly. Just that it
should re-run the simulation without any historical data, from a fresh clean slate. Wall clock
jitter and non-determinism is totally fine and accepted."*

## Decision

A simulation has a `mode`, and the mode is about **history carryover and termination**. It is not
about determinism, and **no determinism layer is built**: no virtual clock, no seeded id source, no
pinned model sampling, no forced concurrency of one, no jitter removal.

| | Ephemeral | Longitudinal |
|---|---|---|
| History | Clean slate every execution | Accumulates |
| Termination | Bounded: `visitsPerPerson` required | Unbounded: `visitsPerPerson` must be null |
| "Again" | A new execution, `seq + 1`, sibling, nothing inherited | Not offered; the action is Resume |
| Pause / Resume | Allowed within one execution | The main lifecycle |
| Accounts | Fresh per execution, swept when it ends | One set, kept for the run's life |
| Target reset | Before the first visit, where the target offers one | Never |

The seed survives for the one thing it is good for: **stable composition and stable identities**.
The same cohort seed draws the same traits, patience and budget per ordinal, so the cast is
comparable across executions even though what the cast *does* is not.

## The mechanism, which is almost entirely ADR-0020's

**Clean slate is free.** Memory is keyed `(runId, agentId)`, and a new run id is a new key. The
three things that carry history all hang off `continueFrom`, so an ephemeral "run it again" simply
does not pass it. That is the whole implementation. Identities are fresh for the same reason: a
signup email embeds `populace:<runId>`, and the run id is new, so two executions never share an
account.

**Bounded is arithmetic.** `resolveSimulationConfig` writes `population.maxWakes =
simulation.visitsPerPerson` for an ephemeral simulation, so every participant retires at its cap and
the daemon's existing exit condition fires on its own. A longitudinal simulation leaves it null, and
the cost estimate becomes a rate per hour rather than a total.

**Pause is the existing drain path**, settling the row to `paused` with `pauseReason: "user"`.
**Resume** rebuilds a daemon on the *same run id* from the run's frozen snapshot and reconciles;
memory is still there because it is keyed by that run id, and visit numbering continues.

**A process that died** is `paused` with `pauseReason: "process-ended"`, not `failed` (ADR-0024
amendment). `failed` is reserved for a run that actually threw.

## Consequences

**The UI must never promise identical results, and says so in those words.** The execution history
on an ephemeral simulation carries a fixed line — *"Executions are independent. Different people do
different things, so expect the numbers to move even when nothing about your product changed."* —
and the compare screen reports an absence as an absence rather than as a repair (ADR-0028
amendment).

Where a target declares no reset hook, ephemeral means fresh *people, memory and accounts* only, and
the screen says exactly that rather than implying more. Starting is refused only if the simulation
sets `requireFreshTarget`.

Editing a simulation while a longitudinal execution is running does nothing to it, because a run
executes a frozen snapshot (ADR-0024). The answer is an explicit action — "apply changes to the
running execution" — which re-resolves, re-snapshots and reconciles, adding participants for new
cohorts at visit one and retiring removed ones, while everybody else keeps their memory. Ephemeral
simulations do not offer it: edit it and run it again.

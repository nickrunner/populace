# ADR-0020: Memory is run-scoped, and runs form a lineage

**Status:** accepted

## Context

Two things people want from a synthetic population pull in opposite directions:

1. Run the same simulation repeatedly from a clean slate to evaluate a product, or to compare
   two configurations against each other.
2. Continue an existing simulation after shipping a fix, to see whether the users who
   complained are satisfied by it.

The original code served neither. Agent ids are deterministic (`agentIdFor(populationId,
personaId, ordinal)` -> `tasklet-trial/casual-lister#1`) and `upsertAgent` is keyed on id, so
`--new-run` did not create new agents: it mutated the existing rows to point at the new run.
After several runs the store held `distinct run ids in agents: 1`, and earlier runs' wakes and
findings referenced runs whose agent rows had moved on. Memory was keyed by `agent_id` alone
and so accumulated across runs indefinitely.

The effects were subtle and bad. `sweep -r <old run>` found no agents for that run and never
deleted their memory. A "fresh" run told the agent *this is your first visit* on wake 1 (memory
is hidden when `wakeNumber === 1`) and then handed it months of cross-run history on wake 2.
Worst, it corrupted the churn signal: in a live run `casual-lister` quit at wake 2 citing "I've
filed this bug at least 4 times across sessions" and listed six finding ids, most of them from
previous runs. She was not reacting to that trial, she was carrying a grudge from an earlier
experiment. Any comparison past wake 1 was contaminated.

## Decision

**Memory is keyed by `(runId, agentId)`.** A fresh run starts every agent with nothing, which is
what `--new-run` always claimed to do. `deleteAgentsByRun` drops memory by run id, so sweep is
correct. `memories` predating this change is dropped on open rather than migrated: those rows
are exactly the cross-run mixture this removes, and there is no migration framework to carry
them.

**A continuation is a new run that inherits.** `populace run --continue-from <run id>` always
allocates a new run id and seeds this run's agents from the parent: identity, wake count and
memory (copied under the new run id, leaving the parent's record intact). Both runs stay
separately reportable, so a before-fix digest can be compared with an after-fix one. Extending
the parent run in place was the alternative; it mixes pre-fix and post-fix wakes into one
digest, leaving timestamps as the only way to tell them apart.

**Only agents who said they would return come back.** `give_up` and `done` already ask the model
`would_return`, but it was written into prose and never stored; it is now `wake.wouldReturn`.
A continuation carries over every still-active agent and every agent that gave up with
`wouldReturn: true`. An agent that left for good stays gone -- a fix does not win back a user
who said nothing would.

**A continuation does not acquire users.** Agents in the population that were not inherited are
not created. Without this, an agent that left for good is replaced by an amnesiac wearing the
same id, which appears in the after-fix digest as though it were the same person.

**`maxWakes` is an allowance per continuation, not a lifetime total.** An inherited agent gets
`wakeCount + maxWakes`, so continuing a population whose agents have already spent their wakes
does not produce a run in which nobody wakes.

**Returning agents are told the product changed.** The first wake of a continuation adds a line
to the wake context: an agent that gave up reads that it stopped using the product and has heard
it has changed. This is the realistic prompt rather than a hint -- a churned user does not
wander back unprompted, they return because of a changelog or an email. `agent.continuedFrom`
carries `{ runId, atWake, gaveUp }` so the line appears once, on the right wake, and survives
the revival that clears `retiredReason`.

## Consequences

`--continue-from` against a run recorded before this change carries nobody over: those wakes have
no `wouldReturn`, which reads as "did not say they would return". Continuations are only
meaningful from runs recorded after it.

Identities stay in the run that minted them. The account's email embeds that run's tag, so it is
only discoverable by `listByTag` under the original tag, and re-tagging the row would break
teardown. A continuation therefore points at the parent's identity records, and
`sweep -r <parent>` removes accounts a continuation is still using. That is arguably right --
it is the same account -- but it means sweeping a parent invalidates its continuations.

## Amendment (2026-09-18): three ways of going again, and only one of them inherits

This ADR built one mechanism — a child run that inherits memory, identities and visit counts — and
the restructure (ADR-0029, ADR-0030) put three different user intentions on top of it. They are
distinguished here so the buttons cannot be confused:

- **Run it again** (ephemeral). A *sibling* execution: new run id, `seq + 1`, `continueFrom` unset,
  `parentRunId` null. Nothing is inherited, which is the entire implementation of "clean slate" —
  memory is keyed `(runId, agentId)` and the run id is new, so there is nothing to clear. New tag,
  new signup emails, new accounts. Offered only for an ephemeral simulation; a longitudinal one
  offers "start a new one" with the same mechanics and says plainly that it starts over.
- **Pause and resume** (both modes, the main lifecycle of a longitudinal one). The **same run id**,
  rebuilt from its frozen snapshot, `reconcile()`d so every agent keeps its runtime state and only
  agents with no next visit are rescheduled. Memory is still there because the key did not change,
  and visit numbering continues. This is not a continuation and does not make a child run.
- **Carry them forward** (both modes, secondary). This ADR's child run, unchanged: `parentRunId`
  set, memory copied under the new run id, identities and visit counts carried, and only the people
  who said `wouldReturn` coming back. Still the answer to "I shipped a fix — do they come back?".
  The route was `POST /runs/:id/continue` and is now `POST /runs/:id/carry-forward`, because
  "continue" was being read as "resume".

The rule underneath all three is this ADR's and is unchanged: **a new run id means a clean slate,
and the only things that cross one are the things `continueFrom` copies.** Resume is the case that
keeps the run id, which is why it is the only one where nothing has to be copied at all.

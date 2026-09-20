# ADR-0032: Translate at the contract boundary; do not rename internal nouns

**Status:** accepted 2026-09-18

## Context

The restructure to projects, simulations, cohorts and people (ADR-0029) also changed what the
product calls things. A user does not send *agents* on *wakes*; they send **people**, who make
**visits**. The old words are engineering words that leaked into the product, and the UI copy, the
screen names and the URL space all say the new ones.

The tempting next step is to rename underneath: `Agent` → `Participant`, `agents` → `participants`,
`Wake` → `Visit`, `wakes` → `visits`, `wakeCount` → `visitCount`, across core, runner, adapters,
store, reports, CLI and every test that names them. That is a diff of several thousand lines in
which every hunk is mechanical and any one of them can be wrong, landed at the same time as a real
change to the data model. It would also be the second such rename — `population.scale` was renamed
before it was deleted — and there is no reason to think it is the last.

## Decision

**The wire speaks the user's words. The rows do not change.**

- `packages/contract` is where the translation happens. `ParticipantSummaryView` and
  `ParticipantDetailView` are views of an `Agent` row: `wakeCount` becomes `visits`, `maxWakes`
  becomes `maxVisits`, `personaName` gives way to the person's `name`. The word "agent" does not
  appear anywhere on the wire — not in a field, not in a path, not in a query parameter
  (`?participant=<agent id>`).
- `Agent`, `agents`, `getAgent`, `listDueAgents`, `expandPopulation`, `Wake`, `wakes`, `wakeNumber`,
  `runWake` and every test that names them keep their names. The runner's vocabulary is the
  runner's.
- Route paths carry the translated noun (`GET /runs/:id/participants/:pid`), so a client, a CI
  consumer and a future SDK all read the product's words rather than the scheduler's.
- The *id* is not translated. A `ParticipantSummaryView.id` is the agent id, and it is rendered in
  ochre monospace on every screen that shows one, because an id is how the machine names somebody
  and a name is who they are.

## Consequences

There are two vocabularies, and a reader moving between the API and the runner has to know they are
the same thing. The mitigation is that the seam is one package and is documented there: the header
comment on `packages/contract/src/project.ts` states the rule, and the views are the only place the
mapping is written.

The alternative — renaming underneath — was rejected for cost and risk, not for taste. If the
internal words ever become actively misleading rather than merely dated, the rename is a mechanical
change that this decision does not forbid; it just refuses to bundle it with a data-model change.

The rule generalises, and that is the point of writing it down: **the next restructure changes what
the product calls things at the contract, and leaves the rows alone.** A product noun that changes
twice a year and a schema that must not are different things and should not share a name.

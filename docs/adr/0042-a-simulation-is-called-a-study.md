# ADR-0042: A simulation is called a study

**Status:** accepted 2026-09-25

## Context

The user's words, in the brief this record implements:

> *"Same for populations, targets, and simulations, which are renamed **studies**."*

The sentence arrived inside a request about list pages and builders (ADR-0043), and it is the one
part of that request that touches a noun rather than a screen. The reasoning behind it is short.
"Simulation" is the engineering word for what the machine does — it simulates users. "Study" is
the word for what a person is doing when they press go: they have a question about their product
and are sending people at it to find out. A product owner runs a study and reads its results; they
do not run a simulation, any more than they send agents on wakes.

ADR-0032 already settled how a noun changes in this codebase: **the wire speaks the user's words,
and the rows do not change.** It was written for participant and visit, and it said the rule
generalises — *"the next restructure changes what the product calls things at the contract, and
leaves the rows alone."* This is that next time.

## Decision

**"Simulation" is called "study" on the wire, in the URL bar and on every screen. Core, store,
runner, reports and CLI internals keep every `simulation` name.**

### 1. On the wire

The contract routes are `studies`, `study`, `studyEstimate`, `studyPreflight`, `studyRuns`,
`studyResults`, `studyCluster`, `studyCompare`, `studyApply`, `studyPeople`,
`studyPeopleRegenerate` and `studyPerson`, all under `/api/v1/projects/:p/studies/…`; the
`simulation*` routes are removed rather than aliased, because an API with two spellings of one path
has two paths. `RunListQuery.study` and `EventStreamQuery.study` filter runs and events by study.

The schemas follow: `StudySummaryView`, `StudyStatus`, `StudyResultsView`, `StudyPeopleView`, and
`StudyCreateInput` / `StudyUpdateInput` for POST and PUT (the second is the first without `slug`
and with everything optional). `ProjectOverviewView.studies`, `crossStudy`, `targets[].studies`
and `populations[].studies`; `ProjectCounts.studies`; `SetupStatus.studyIds`; `Need.scope.kind:
"study"`; `RunSummary.studyId` and `RunDetail.studyId`; `ParticipantDetailView.alsoIn[].studyId`
and `.studyName`; `PreflightView.study`. `StudyModeSchema` is a wire alias of the core
`SimulationModeSchema` — same two values, one definition — and is the one place the contract still
spells the old word, because an alias cannot be written without importing what it aliases.

**The event is translated on the way out.** The core `Event` row keeps `simulationId` (it is a
lifted column, and the rows do not change), so the wire gets its own `EventView` with `studyId`, and
the server copies each event onto it as it streams. The verbatim re-export of the core schema from
the contract is gone; a client reads `EventView` and destructures `studyId`.

**`RunEstimate` becomes `EstimateView`, and closes part of ADR-0035's recorded debt.** ADR-0035
listed the estimate as the place ADR-0032 was violated on the wire — `agents`,
`assumedWakesPerAgent`, `perCohort[].agents`, `stops.maxWakesPerAgent`, `perWakeUsd` read by the
browser. `EstimateView` carries `people`, `visits`, `bounded`, `assumedVisitsEach`,
`perCohort[].people` and `.visits`, `perVisitUsd`, `stops.perVisitUsd`, `stops.perVisitTurns` and
`stops.maxVisitsPerPerson`; `perCohort[].lane` is dropped rather than renamed, since "lane" is
internal and the `(cohort, personaId)` pair is the row's key. The server translates `estimateRun`'s
result onto it exactly as `wakeCount` is translated to `visits`, and both estimate routes — the
saved study's and the project-level draft estimate `POST /projects/:p/estimate` — return it.
`estimateRun` itself is untouched.

### 2. In the URL bar

Web routes are `/p/:proj/studies/new` and `/p/:proj/studies/:study/*`. The old addresses have been
in bookmarks and in chat messages, so they redirect rather than 404, and every redirect uses `..`
because react-router v7 resolves a relative `to` inside a splat against the FULL matched path:

- `/p/:proj/s` and `/p/:proj/studies` → the project index (which IS the studies dashboard,
  ADR-0043).
- `/p/:proj/s/new` → `studies/new`, carrying the search string, because a builder chain's `then`
  lives there.
- `/p/:proj/s/:sim/*` → `studies/:sim/<rest>`, with each tail segment re-encoded and the search and
  hash carried.
- `/runs/:runId/*` (`RunRedirect`) now lands under `/studies/`.

Inside the study shell, `visits/:wakeId` becomes `visits/:visitId`. Same segment, different param
name, so no redirect is needed and no bookmark breaks.

> **Amendment (2026-09-25, same day) — the redirects ADR-0043 added, and the catch-alls.** Two
> per-study addresses were retired by the builder work and redirect for the same reason the
> `/s/…` ones do: `studies/:study/settings` → `…/edit` (the settings screen was retired into the
> study builder's edit mode) and `studies/:study/population` → `…/people` (the per-study
> "Population" item became People). Both shells end in a `<Route path="*">` that navigates to
> `..` — an unknown path under a project lands on the project, an unknown path under a study lands
> on the study — and every one of these, like the redirects above, is `..` and never `.` for the
> react-router v7 reason: a relative `to` inside a splat route resolves against the full matched
> path, so `.` would land on the very address that failed to match. The table of every route and
> redirect is in WEB-ARCHITECTURE §5.

### 3. On every screen, and in every sentence the server emits

Every sentence the server emits says study, including the two zod messages on the core row that
reach a 400 body — *"an ephemeral study has to end: give it a visit cap"* and *"a longitudinal study
does not end; remove the visit cap"* — because those are user-facing sentences even though the
schema that carries them is internal. Tests that pinned "simulation" in copy flip, and one negative
assertion is added over the raw response bodies of the project overview, the studies list, setup,
preflight and both estimate routes: none contains "simulation", "agent" or "wake". "Simulation" and
"lane" join "agent" and "wake" as words that never appear on the wire or in UI copy.

The web's own names follow, for legibility rather than for the rule: `StudyShell`, `StudyScope`,
`useStudy`, `StudyResults`, `StudyActions`, query keys `studies` / `study` / `studyRuns` /
`studyPeople`, and api functions to match. `SimulationSettings` is not renamed; it is retired into
the study builder (ADR-0043). `staleAfter` derives its prefixes from the `keys` functions rather
than from literals, so a rename cannot leave a stale literal behind, and the event listener
destructures `studyId`. The marketing pages and diagrams say study.

**The chain diagram's link is renamed, and its copy is rewritten rather than substituted.** The
`ChainDiagram`'s `ChainLink` union and `CHAIN_LINKS` order read `"project" | "study" | "population"
| "cohort" | "person" | "visit" | "finding"` where the second value was `"simulation"`; `Concepts`
builds its anchors and its `Term` type from the same list, so the rename reached the concepts page
without a second edit. The `COPY` for the two changed links is new text, not the old with one word
swapped, because the size moved at the same time (ADR-0041): *Project — "holds studies" — "Everything
you author lives in one project — targets, personas, cohorts, populations, studies, settings,
triage. None of it is shared across two."* and *Study — "holds a population" — "A population, a
target, a mode and a size — the only place a headcount lives. It is the thing you press go on, and
each time you do it produces an execution."* Execution is still not a link and is not drawn as one;
it belongs inside the study's sentence, which is where that sentence puts it.

### 4. In the YAML

`simulations:` is also accepted as `studies:`, and both mean the same block; a file already written
keeps loading. `SimulationPlan` gains the optional `size` ADR-0041 describes, and the CLI's
`validate` output says study.

### 5. What does not change

`Simulation`, `SimulationSchema`, `SimulationContext`, `SimulationMode`, `simulations` (the table),
`simulation_id` (the lifted column on `runs`, `agents` and `events`), `resolveSimulationConfig`,
`ensureSimulation`, `createSimulation`, `SimulationPlan`, `SimulationDraft` and every test that
names them keep their names. ADR-0032 gives the reason and it has not weakened: a rename underneath
is several thousand mechanical lines that can each be wrong, landed beside a real change to the
data model (ADR-0041), and this would be the third such rename. The seam is one package, and the
header comment on `packages/contract/src/project.ts` says so.

## What this supersedes

- ADR-0032: *"The word 'agent' does not appear anywhere on the wire — not in a field, not in a
  path, not in a query parameter"* — extended, not reversed: neither does "simulation", and neither
  does "lane". The decision's own generalisation is what this record applies.
- ADR-0035, open item: *"ADR-0032 is violated in the wire today, and was before this work.
  `RunEstimateSchema` carries `agents`, `assumedWakesPerAgent`, `perCohort[].agents` and
  `stops.maxWakesPerAgent`; `perWakeUsd` is read by the browser"* — closed by `EstimateView`. The
  rest of that item — `wakeId` on `ParticipantLiveSchema` and the trace views — is still debt and
  is carried below.
- Every earlier ADR that says "simulation" — 0029, 0030, 0035, 0039 among them — describes the
  study under its old name. Their text is history and is not rewritten; the noun they define is the
  one this record renames.

## Consequences

**No store change.** The table is `simulations`, the column is `simulation_id`, and `SCHEMA_SHAPE`
is untouched. That is the whole point of translating at the contract.

**Three tokens of the old word remain in `packages/contract/src`**, all in `views.ts`: the import
of `SimulationModeSchema`, the ADR-0032 doc comment above it, and the alias line itself. Everything
else in the contract is clean, and a grep over the package for the word should find exactly those.

**A client that read `Event.simulationId` breaks**, and is meant to: the field is `studyId` on
`EventView`, and there is no shim. The only clients are the dashboard and the test suite, and both
moved with the change.

**Bookmarks survive, addresses in copy do not.** Redirects cover every path that has been in a URL
bar. A sentence in a README or a chat that says "the simulation" is not something the code can
redirect, and the marketing pages were rewritten by hand for that reason.

**What is knowingly left open:**

- **`/why-agents`** stays as a public route and a page title. It is the marketing page that
  explains why populace uses AI agents rather than scripted tests, and the word there is the
  honest one — the argument is about agents in the engineering sense. It is recorded as debt
  because a public path is a promise, and if the page is ever renamed the old path redirects.
- **`wakeId` on `ParticipantLiveSchema` and the trace views** is the remainder of ADR-0035's item.
  It is the id of a wake, rendered as an id in monospace, and ADR-0032 does not translate ids; but
  the FIELD name is a word on the wire, and it is the engineering one.
- **The internal rename.** ADR-0032 does not forbid it, and every `Simulation*` symbol is now a
  name for a thing the product calls something else. If it is ever done it is done alone, as a
  mechanical change with no data-model change beside it, which is the only way ADR-0032 allows.
- **The two zod messages** are user-facing sentences living on an internal schema. They are the
  right words in the wrong file, and they move when the row does.

**The argument against, recorded so it is not re-discovered.** This is the second product rename of
one noun's neighbourhood (`population.scale` was renamed before it was deleted; participant and
visit were ADR-0032), and every rename costs bookmarks, muscle memory and a redirect table that is
never deleted. "Study" also has an academic sense a reader may bring with them — a controlled
comparison with a hypothesis — and populace promises no such thing (ADR-0030). Both are real. The
rename was made because the word a product owner uses to describe what they are doing is the word
the product should use, and "simulation" describes what the machine does. What would change the
decision is a reader base that turns out to be developers alone, for whom "simulation" was never
the wrong word; ADR-0035 and the roadmap's D1 say it is not.

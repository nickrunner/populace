# ADR-0035: A project holds several targets and several populations, and a simulation is the pairing

**Status:** accepted 2026-09-21

## Context

A user set up a project and could not tell what they were supposed to do next. The complaint, in
their words: *"Is it first connect the app? Then build a population? Then start a simulation? Or is
it first setup a simulation which includes connecting the app and setting up a population. The
mental model here isn't clear."* And then the question that turned out to matter most: *"if I'm
testing stays would I make a dev project and a qa project (one for each environment), or would I
make a stays project and then add 2 targets?"*

Reading the code to answer it turned up something better than an opinion. **Almost all of it was
already supported, and only the presentation said otherwise.**

- The `targets` table's only uniqueness constraint is `(project_id, slug)`. There is no index,
  check or code path that refuses a second target.
- `POST /targets` carries a slug de-duplication loop (`target-2`) that only makes sense for N.
- `Simulation.targetId` is required, and its own schema comment reads *"Explicit, not 'the most
  recently updated target wins'."*
- `control.test.ts` already drove two simulations at two live MCP servers and asserted they
  resolved to different endpoints.
- `populations` has exactly the same shape, and `StoredPopulation` is `{ …, cohortIds }` — a
  durable named record, not a derived one.

What existed instead of the feature was a set of guesses and labels. Four places meant
`listTargets(projectId)[0]`, and `listTargets` orders `updated_at DESC` — so "the first target"
meant *whichever you edited last*, and `POST /simulations` froze that coin flip onto a row. The
rail said `counts.targets > 1 ? "The targets" : "The target"` while the screen it opened said
`items.length === 1 ? "The target" : "The targets"`, so an empty project's rail and page disagreed
with each other. And `PUT /populations/:pop` parsed `:pop`, resolved it, checked it, and then
edited a different row, because `setCohortSize` called `ensurePopulation` internally: you could
create a second population and never put anything in it.

## Decision

**A project is one product under test. It holds two libraries — targets and populations — and a
list of simulations. A simulation is the pairing of one target and one population, plus a mode,
and it is the only thing you press go on.**

In ten seconds: *pick where they go, pick who goes, press go.*

### Dev and qa are two targets in one project

Not two projects. This is the only supported answer, not a preference, because **nothing is shared
between projects**:

- Personas and cohorts would be duplicated and kept in sync by hand.
- The people would be *different people*. A person is `cohortSlug#ordinal` scoped to its project,
  so Marta in the dev project is not Marta in the qa project, and ADR-0031's "written once and
  never silently overwritten" is per project.
- **Finding signatures would never roll up.** "Seen in more than one simulation" is built per
  project (`project-read-model.ts`). Splitting dev and qa into two projects throws away the one
  thing you wanted them side by side for: *is this bug in qa too?*

Reach for a second project when the two things are genuinely different products, or must not share
a spend ceiling and a kill switch.

**There is no `environment` or `stage` field, and there must not be.** `DATA-MODEL.md` already
rejects a target-kind discriminator; "environment" is outside DESIGN-SYSTEM §7.1's closed
vocabulary; and a column on `targets` bumps `SCHEMA_SHAPE`, which drops and rebuilds every database
(ADR-0011). The environment is carried by the target's name and slug — `Stays — dev`, `Stays — qa`.
A naming convention, not a discriminator.

### Containment is not authoring order

ADR-0029 fixes the chain **project → simulation → population → cohort → person**. That says what
contains what. It does **not** say what you make first — and ADR-0029's own diagram hangs Target
off Project as a *sibling* of the population spine, outside that chain entirely.

So the authoring order is target, then population, then simulation, and it contradicts nothing.
The target goes first for a reason worth stating: **it is the only step that can fail for reasons
outside populace** — the endpoint does not answer, the bearer is wrong, there is no sign-up tool,
the tool list does not cover what the marketing page promises. `POST /targets/:t/check` and
`/first-contact` (ADR-0034) find all of that out for free. Discovering it after casting forty
people is the wrong way round.

**After the first run the order stops being a sequence and becomes a loop.** You come back and add
a qa target in month three. That is why the setup panel is shown on a project that has not begun
and never again, and why there is no permanent numbered checklist on the dashboard.

### Nouns do not inflect

**Targets. Personas. Cohorts. Populations.** Bare plurals, no article, constant at nought, one and
N, in every nav label, page title, breadcrumb and route segment. The count is a fact and lives in
the trailing figure (§7.4). A label that changes with the data cannot be learned, searched for, or
read without flicker — and two data-driven rules disagreed at zero, which is how the rail and the
page it opened came to print different words for the same thing.

"The target" survives in exactly one place: prose about one specific simulation's own target
("visits Stays — qa"), where there genuinely is one.

### Refuse to guess, and name the choices

One target defaults, because with one there is nothing to choose. Zero refuses, as it always did.
**Two or more without an explicit id is a refusal that names them.** A 400 saying "ambiguous" is a
puzzle; a 400 listing the two targets is an answer. The same rule applies to the population on
`POST /simulations`, and to `?target=` on the persona prompt preview — a preview is a preview *of a
target*, since the system prompt carries that target's description and tool list.

`SimulationInputSchema` keeps both ids optional, so this is a runtime refusal rather than a
contract break.

### A population is composition and nothing else

`seed`, `cadence` and `maxWakes` are off `PopulationInput` and `PopulationView`. They were written
to the project's settings row and fanned onto every simulation running that population — and
because the visit cap decides the mode (`visits === null ? "longitudinal" : "ephemeral"`), editing
a population could flip several simulations between ephemeral and longitudinal, which is an
ADR-0030 property of the *simulation*, from a screen that never says the word mode.

The cap and the mode are set on the simulation, by a simulation editor that lands with that
removal rather than after it. The cadence and the seed belong to the cohort.

### The default population is the oldest

`ensurePopulation` resolved `find(slug === "everyone") ?? populations[0]`, and its comment claimed
the slug lookup meant a second population could not silently become the default. Only half that
expression is by slug. **A YAML-seeded project has no row slugged `everyone`** — an import names
its population whatever the file says — so those installs fell through to `populations[0]`, and
`listPopulations` is `ORDER BY slug`. Composing a population whose slug sorted earlier *made it the
project's default*, silently retargeting `cohortsOf`, the setup status, `ensureSimulation` and the
first-run panel. Nothing would have reported it; the headcount would simply have changed.

The fallback is the oldest population, which is stable under anything added later — the only
property it actually needs. `DELETE /populations/:pop` refuses the last one and the default one,
and it asks that question the way the resolver answers it rather than comparing a slug.

## Consequences

`--w-page`-level UI changes are recorded in the amendment to ADR-0029, which this decision does not
otherwise disturb: the chain, every id format, `expandPopulation`, and the rule that anything keyed
by agent id alone leaks between executions are all untouched.

No stage of this work required a store schema change, so no database was dropped. The
`SCHEMA` constant and `schema_shape` are exactly as they were (ADR-0011).

**What is knowingly left open:**

- **ADR-0032 is violated in the wire today, and was before this work.** `RunEstimateSchema` carries
  `agents`, `assumedWakesPerAgent`, `perCohort[].agents` and `stops.maxWakesPerAgent`; `perWakeUsd`
  is read by the browser; `wakeId` is a field on `ParticipantLiveSchema` and the trace views. The
  schemas this work touched were renamed (`maxWakes` → `maxVisits` on `PopulationView`,
  `PopulationInput`, `CohortView`, `CohortInput`); the rest are debt, recorded here rather than
  quietly widened.
- **`GET /setup` and `GET /populations` still write rows** via `ensureSimulation` and
  `ensurePopulation`. A GET that writes is wrong (ADR-0023). Removing the first costs the first-run
  cost estimate, which is keyed by simulation id; the fix is an estimate that takes a target and a
  population, and it belongs with that change.
- **Two simulations sharing one target can reset it under each other**, and "stop everything now"
  on one stops both (ADR-0022:31-40). Promoting several targets in the IA is exactly what makes
  this bite. It is stated on the Targets band and refused nowhere.
- **Drift** — "the target's endpoint has changed since execution 4" — is not built.
  `simulationSummary` does not read the frozen snapshot, so it would add one store read per
  simulation row on every dashboard load.

## Amendment — a population carries the headcount (ADR-0039)

*Added 2026-09-23.* "A population is composition and nothing else" is superseded: a population is
which cohorts go and how many of each, `members[{cohortId, size}]`, and it is the only place a
headcount lives. What that section was actually protecting — that the cap, the cadence and the seed
are not the population's, because the cap decides a simulation's mode — still holds. Everything
else here stands.

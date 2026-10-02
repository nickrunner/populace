# ADR-0041: Size belongs to the study; a population is a weighted mix of cohorts

**Status:** accepted 2026-09-25

## Context

The user's words, paraphrased faithfully in the brief this record implements:

> *"ONE point of scale, at the study. A cohort is personas with weights. A population is cohorts
> with weights. A study picks a population and gives it a SIZE. Weights decide how many of each.
> Later, a study's size can be scaled up and down."*

and, on what that makes of the library:

> *"Personas, cohorts and populations are conceptual and reusable across studies. People are
> instantiated by a study and are only visible and editable inside a study."*

ADR-0039 put the headcount on the population member — `members[{cohortId, size}]` — and made
setting it the act that writes the people. Two days of building screens against that turned up the
seam it left.

**A population with sizes in it is not reusable.** The same cast at ten people for a smoke test and
at forty for a fortnight was two populations, identical but for the numbers, and the simulation's
own screen edited the population's numbers inline because there was nowhere else to put them. A
noun whose editor lives on a different noun's page is a noun in the wrong place.

**The two levels did not agree on what a number was.** Inside a cohort the mix was a ratio
(`weight`), apportioned; across a population the members were absolute counts (`size`), summed.
Scaling a study meant editing every member's size by hand and getting the ratios between them right
again each time, which is exactly the "headcount is the product of two numbers on two screens"
complaint ADR-0029 was written to end, one level down.

**People were written by GETs.** `ensureRoster` ran on the first read of a cohort, `ensurePopulation`
on `GET /populations`, and `ensureSimulation` on `GET /setup`, so opening a page could create a
population, a simulation and a roster. ADR-0035 recorded that as debt; the new headcount had to
land somewhere, and landing it on a GET again would have doubled the debt.

## Decision

**A cohort is personas with weights. A population is cohorts with weights. A study picks a
population and gives it a size, and that size is the only headcount there is.** Everything
downstream of `expandPopulation` — the resolved `Population` with one lane per cohort × persona,
`count` and frozen `people[]` — does not change shape, and the runner, reports and adapters are
untouched except for the one line that renders the brief (§4).

### 1. The study is the only headcount

The core `Simulation` row — the internal name stays, per ADR-0032; the product calls it a study
(ADR-0042) — gains two fields, both defaulted so every existing `.parse` path still passes:

- `size: int, nonnegative, default 0`. Nought is legal and sends nobody; a start refuses until it
  is raised. Growing it re-deals nobody (§2); changing a weight may.
- `brief: string, default ""` — what this study tells the people (§4).

`SimulationContext` gains both with the same defaults, so a snapshot says what ran: the members'
counts in a snapshot are the deal of that size, and the brief is frozen beside them. Both ride in
`PopulaceConfig`, so snapshot hashes change; the first "Apply to the running execution" after the
upgrade re-snapshots and reconciles to the same cast, and nothing else needs doing about it.

`PopulationMemberRef` becomes `{ cohortId, weight: positive number, default 1 }`. **`size` is
gone.** A zod `preprocess` on the member schema maps a legacy blob's `size` onto `weight` when
`weight` is absent, so a population written before this decision parses and keeps its ratios; the
parameter is left un-annotated and narrowed in place, with the ADR-0001 boundary comment, because
it is raw JSON and the schema underneath is what types it. The duplicate-cohort `superRefine`
stands.

`StoredSettings.maxWakes`, `cadence` and `seed` stay as the defaults a new study is created with.
They are not a second headcount.

### 2. Two-level deal, house-monotone, with a stated tie rule

The arithmetic lives in `packages/core/src/apportion.ts`, browser-safe on purpose — nothing in it
touches `node:crypto` — and exported from `@populace/core/isomorphic` as well as from the package
root, with `apportion` re-exported from `population.ts` so existing imports keep working. The
builders preview exactly the arithmetic the server performs, without a round trip and without a
second implementation that could drift.

`apportion(size, weights)` is Sainte-Laguë highest averages, as ADR-0039 chose it, moved here
verbatim and hardened: a weight that is not a positive finite number counts for nothing, when every
weight is like that the answer is all zeros (it used to hand the whole size to index 0 on a `NaN`),
a fractional size is floored and a size below nought is nought.

`dealStudy(size, members, mixes)` is the two-level deal. The size is apportioned across the
population's members by their weights, **in member order**; then each cohort's count is apportioned
across its mix by the entries' weights, **in mix order**. A member whose mix is missing or empty
keeps its cohort count and gets zero lanes, and `sends` — the sum of the lanes — then falls short of
the size, which is the builder's cue that a cohort still needs personas.

**Ties go to the earlier member, then the earlier mix entry.** That is a stated rule the builders
preview, not an accident of iteration order. Both levels are house-monotone and the composition of
two house-monotone maps is house-monotone, so growing a study by one never shrinks any lane:
*growing re-deals nobody* holds end to end. Changing a **weight** at either level can move people —
ADR-0039 already accepted this, and the builders say so when a population is already sent by a
study. Editing cohort C's mix re-lanes only C, because C's count is settled before its mix is looked
at.

This is tested as a property, not an example: for every size from 0 to 300 over a three-cohort,
six-lane fixture, the per-cohort totals equal `apportion(size, populationWeights)` and no lane ever
shrinks as the size grows; all-zero weights give all zeros; a missing mix gives zero lanes.

### 3. People rows stay on the cohort lane; the study decides how many are "in"

`Person` rows are unchanged: keyed `(project, laneSlug#ordinal)`, write-once, archived rather than
deleted (ADR-0031). Two studies over one cohort meet the same people up to the smaller size, for the
same reason two populations did under ADR-0039.

**The roster is sized by the studies.** A lane's roster is the LARGEST count that lane gets in any
study that is not archived — or is archived but still has an execution running or paused, because
that execution's people must not vanish under it. `ensureRoster` keeps its archive-and-restore
behaviour at those sizes; a person past their lane's count is archived, never deleted, and comes
back exactly as they were when a study sends them again.

**Resolution is read-only; materialisation is explicit.** `resolveSimulationConfig` never writes.
It reads the roster and fills a missing ordinal in memory from the seeded roster — same seed, same
names — so a snapshot can be taken of a study whose people were never written. The writers are
exactly: `POST /studies`, `PUT /studies/:s`, `DELETE /studies/:s` (archive), un-archive where it is
offered, `PUT /populations/:pop`, `PUT /cohorts/:c`, starting an execution (materialise before the
snapshot), the study's people write and regenerate jobs, and the YAML import. **GETs write
nothing**: `ensureRoster` is off the cohort reads, `ensurePopulation` off `GET /populations`,
`ensureSimulation` and `ensurePopulation` off `GET /setup`, and the preflight GET only resolves.

**The guessing is deleted, not narrowed.** `ensurePopulation`'s creating branch,
`DEFAULT_POPULATION_SLUG`, `cohortsOf`, `setPopulationMember` and `ensurePersonaCohort` go.
`POST /studies` REQUIRES `populationId` and `targetId` — the builder always has both — and a POST
without them is a 400 that names the choices (ADR-0035) and creates nothing. `ensureSimulation`
survives for tests only; the serve process's unknown-run fallback throws where it used to create.

**Deletes refuse, alike.** Population delete keeps only the `ReferencedError` refusal — a study
names it — and the "only population" and "default population" refusals go with the default they
protected. Cohort delete refuses with a 409 naming the populations holding it, instead of stripping
the cohort out of them on the reader's behalf. Persona delete refuses while a cohort mixes it, as
before. The slug `new` is reserved for personas, cohorts, populations, targets and studies (400),
because it is a route segment.

**People are on the wire through the study, and nowhere else.**

- `GET /projects/:p/studies/:s/people` returns `StudyPeopleView { items, missing, size, sends }`:
  the people this study sends, in deal order (member, mix, ordinal). Only rows that exist are
  items; a lane whose rows were never written contributes to `missing` instead, so
  `items.length + missing === sends`. The query count is bounded — one `listPeople` per project
  filtered in memory, or one per cohort — never one per person.
- `POST …/people` writes details for the placeholder rows among the ordinals THIS study sends, as
  a 202 `people.generate` job; refused 409 while any execution in the project is running or
  pending, as before. `POST …/people/regenerate` takes `GeneratePeopleBody`.
- `PATCH …/people/:person` takes `PersonPatch`. The row is shared by every study sending the
  cohort, and the People page says so once.
- The cohort-scoped people routes are removed everywhere.

`PersonView` gains `cohortSlug`, `cohortName` and `alsoSentBy` — the number of OTHER studies whose
deal includes this ordinal — and prints no `lane*` field. `CohortView` loses `size`, `mix[].people`,
`generated` and `usedByPopulations`, and gains `mix[].share` (weight over the sum, 0..1) and `usedBy`
(populations holding it). `PopulationView.members[]` loses `size` and `personas[].count`, gains
`weight` and `share` at both levels, `PopulationView.people` goes, and `PopulationView.usedBy` counts
the studies naming it. `PopulationInput.members[].weight` with 0 meaning remove; `PopulationCreate`
accepts `members`, so one POST composes a population.

### 4. The study brief

`Simulation.brief` is the one per-study text handed to the people. The runner renders it after the
cohort's `context` and before the person's own line, only when it is non-empty, and it is frozen
into the snapshot through `SimulationContext.brief`. **This is how a study configures its people
without a per-study person table.** The alternative — a `(study, person)` override row so one study
could give one person a different patience or a different errand — was considered and is left open
(below); a sentence every person in the study hears covers what was actually asked for, which is
"tell these people what this study is about".

### 5. The server's internal shape

So that the parallel work built against one shape, the server's internals were fixed with the
decision rather than left to emerge. In `cohort-store.ts`: `dealFor(store, population, size)`
returns the deal with cohorts and lanes resolved to rows, in member then mix order, throwing
`RosterIncomplete` when a persona in a mix is gone and skipping a member whose cohort is gone;
`laneSizes(store, cohort)` is the largest-count-over-studies rule above; `ensureRoster` is sized by
it; `ensureRosterFor(store, populationId)` runs it for every cohort a population holds;
`peopleSentBy(store, simulation)` is the READ-ONLY reading behind the people route, returning the
deal, the people in deal order and `missing`. In `config-store.ts`: `resolveDraft(store, process,
draft)` resolves a `StudyDraft` — target, population, size, cap, cadence, seed, overrides, brief —
without writing, omitting lanes with count 0 and filling people from the roster plus the seeded
fill; `resolveSimulationConfig` is `resolveDraft` over the row, and throws `ConfigIncomplete` when
the target or population is missing or the deal sends nobody ("this study sends nobody yet: give it
a size"); `materialise(store, simulationId)` is the one explicit writer the writers above call;
`createSimulation` takes `size`, `overrides` and `brief`. `estimateRun(config)` is unchanged, and
the estimate routes translate its result onto the wire (ADR-0042). `cohortChanges` in `runs.ts`
now aggregates counts per cohort as a sum over lanes — a latent bug once a cohort could have two
lanes — and is tested with a two-lane cohort growing from three to five.

## What this supersedes

- ADR-0039: *"The population says how many. `StoredPopulation.members: [{ cohortId, size }]`
  replaces `cohortIds`. This is the only place a headcount lives, and setting it is what writes the
  people"* — a population is cohorts with weights, the study's `size` is the only headcount, and
  the writers listed in §3 are what write the people. *"Its screens edit the population's numbers
  inline and say so"* — the study builder has a size and nothing edits a population from a study's
  page. *"The roster is sized at the largest size any population gives the cohort"* — by the
  studies, per §3. Everything else in ADR-0039 stands: a cohort is a condition and a mix, people
  are numbered per lane, Sainte-Laguë, hand-set dimensions on a person.
- ADR-0029, amendment of 2026-09-23: *"a population is which cohorts go and how many of each, and
  that size is the only headcount there is"* — which cohorts go and in what ratio; how many is the
  study's.
- ADR-0031, amendment of 2026-09-23: *"the roster is sized by the populations that send the
  cohort"* — by the studies. And from the decision: *"`ensureRoster(cohortId)` materialises them
  on first read of a cohort"* — a read writes nothing; the writers are explicit.
- ADR-0035, amendment of 2026-09-23: *"a population is which cohorts go and how many of each,
  `members[{cohortId, size}]`, and it is the only place a headcount lives"* — as above. From the
  decision, *"The default population is the oldest"* — there is no default population; a study
  names its own or the POST is refused naming the choices. The open item *"`GET /setup` and
  `GET /populations` still write rows"* is closed, and its proposed fix — an estimate that takes a
  target and a population — is `POST /projects/:p/estimate` (ADR-0042).
- ADR-0025, amendment of 2026-09-18: *"A cohort's `size` is the only number that decides headcount,
  so resolution is a join over cohorts"* — resolution is a deal of the study's size over two levels
  of weights, and it is read-only.

## Consequences

**`SCHEMA_SHAPE` is NOT bumped, and no database is dropped.** `size` and `brief` live inside the
`simulations` row's JSON and `weight` inside `populations.json`, so the tables are exactly as they
were. What the upgrade does need is a value for `size` on studies written before it existed, and
zod's default of 0 would send nobody, which for a longitudinal execution paused across the upgrade
means its people vanish on resume. So `SqliteStore` runs a one-time raw-JSON backfill on open,
guarded by a marker row `size_backfill = "1"` in the same `control` table that holds
`schema_shape`: for every `simulations` row whose JSON has no `size`, set
`size = Σ members[].size` of its population's raw JSON (0 when the population is gone), parsing the
raw blobs with minimal zod schemas at that boundary. Because Sainte-Laguë returns a target vector
exactly when the weights are proportional to it and sum to the size — and the legacy sizes ARE the
weights, by the preprocess in §1 — an upgraded study deals exactly the counts it had, and the paused
execution resumes with the same people. **Delete the backfill when the migration framework
arrives** (ADR-0011 amendment); it is the first forward step that framework would have owned.

**Snapshot hashes change**, because `SimulationContext.size` and `brief` ride in `PopulaceConfig`.
A running longitudinal execution is not disturbed — it executes its frozen snapshot — and its first
"Apply to the running execution" re-snapshots and reconciles to the same cast. No code.

**YAML is lossless in both directions.** A file's cohorts still carry lane counts (`size:` on a
cohort's persona, or per mix entry), because the CLI daemon runs the file directly and needs
numbers. Import turns them into weights — mix weight = lane count, population member weight = the
cohort's lane counts summed — and a study size of the plan's `size` if given, else the sum of every
count; `SimulationPlan` gains that optional `size`. `cli/config.ts` sets `simulation.size` to the
sum of the counts so a config built from a file says how big it was, and `populace validate` warns
when a plan's `size` differs from that sum. `populace scale` is left alone: it edits the YAML for
the CLI daemon, which is the one place a multiplier over counts still means something.

**The one-request starter path is gone.** ADR-0039 kept *"adopting a starter at a count makes a
persona, a cohort of that persona alone, a population member at that size, and a roster"*; with no
size on a population there is nothing for that request to set, and `ensurePersonaCohort` is
deleted. What replaces it is ADR-0043's builders, where a starter is a starting point inside the
persona builder.

**Static pools are unchanged.** A pool keyed by lane still hands person n entry n, and a pool too
small for the deal is still refused at start rather than wrapping round.

**What is knowingly left open:**

- **A per-study person override table.** `brief` says one thing to everybody in a study. A
  `(study, person)` row — this person, in this study, is impatient — would let two studies send
  the same Marta with different patience, and would be the first authored row keyed by two nouns
  at once. Nobody has asked for it; the brief is what was asked for, and a table nobody asked for
  is a schema change nobody can yet make without dropping databases.
- **Scaling an ephemeral execution in flight.** A study's size can be changed while a longitudinal
  execution runs and applied to it (ADR-0030's "apply changes"); an ephemeral execution takes the
  new size only on its next execution, exactly as it takes every other edit. Nothing here changes
  ADR-0030, and nothing is added to scale a bounded execution mid-flight.
- **Static pools are not sized to a study.** A pool serves a lane at whatever count the largest
  study gives it; a study sending fewer than the pool holds leaves accounts idle, and one sending
  more is refused. A pool that knows the study is a bigger change than this one.
- **`populace scale`** multiplies the file's counts and knows nothing of `size`. A file whose plan
  carries `size` and is then scaled ends up with `validate` warning about the mismatch, which is
  the honest outcome and not a good one.
- **`ProjectCounts.people`** counts non-archived person rows, which is the union over studies — a
  project's people can outnumber what any one study sends. The overview says "people" and means
  the roster; a reader wanting a study's headcount reads the study.

**The argument against all of this, recorded so it is not re-discovered.** Putting the size on the
study means a population no longer says how many, so a reader composing one cannot see a single
person until a study exists — the population builder answers with a "try a size" preview that is
never saved, which is a workaround for a real gap. Two studies over one population at different
sizes meet different prefixes of each lane, and a person who is "the fourth mobile first-timer" in
one study is nobody in another; ADR-0039 had the same property across populations and it is not
worse here, but it is now the common case rather than an edge. And two levels of weights are two
ratios to hold in one's head where a count per cohort was one number — the mix editor's shares and
the live deal preview exist because of that, and they are the mitigation, not a removal of the
cost. What would change the decision is evidence that people set a study's size once and then edit
weights to steer headcounts — at which point the weights are counts wearing a costume, and a count
per member would be the honest field again.

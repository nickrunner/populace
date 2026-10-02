# Data model

What populace persists and why each piece is keyed the way it is. Companion to
`WEB-ARCHITECTURE.md`; the vocabulary table in `docs/ARCHITECTURE.md` still defines the terms.

Sections 1, 5, 11 and 12 describe what exists. The rest are kept as the reasoning that got here —
several were written before the tables they describe were built, and their milestone markers say so.

---

## 1. What exists

Twenty-three tables plus a key-value `control` table (the schema shape, the kill switch, the serve
lock and the `size_backfill` marker of ADR-0041), each storing a zod-validated JSON blob with a few
columns lifted out for indexing (ADR-0011). Two of the twenty-three are named in the prose here
rather than given rows of their own — `cohort_personas`, the mix join, and `sign_in_grants`, keyed
`(project, url)` (ADR-0036) — so count the `CREATE TABLE` statements in
`packages/store-sqlite/src/index.ts` rather than the rows below if the number matters. Everything
populace knows is in the database: YAML is an import, not the entry point (ADR-0025).

**Authored — what a person edits.**

| Table | Key | Lifted columns |
| --- | --- | --- |
| `projects` | `id` | — |
| `targets` | `id` | `project_id`, `slug` (unique per project), `name`, `updated_at` |
| `personas` | `id` | `project_id`, `slug` (unique per project), `origin`, `updated_at` |
| `cohorts` | `id` | `project_id`, `slug` (unique per project), `updated_at` — the mix is in `cohort_personas(cohort_id, persona_id)` |
| `people` | `(project_id, id)` | `cohort_id`, `cohort_slug`, `persona_id`, `lane_slug`, `ordinal`, `archived_at` |
| `populations` | `id` | `project_id`, `slug` (unique per project), `updated_at` — members carry a `weight`, never a size |
| `simulations` | `id` | `project_id`, `slug` (unique per project), `population_id`, `target_id`, `mode`, `archived` — the **study** (ADR-0042); `size` and `brief` are in the blob |
| `settings` | `project_id` | — |
| `github_connections` | `project_id` | `repo`, `updated_at` — the repository this project files into, and **your** token to it (ADR-0044) |
| `filed_issues` | `(project_id, provider, repo, number)` | `filed_at` — the filing ledger: one row per issue populace opened, holding **every** member signature the cluster behind it contained, plus a sighting per report window that reported it, every absence already announced on it, and `supersededBy` (ADR-0044 §2, §8) |

Both of those were added without bumping `SCHEMA_SHAPE`, and both are in this layer for reasons
worth knowing. `github_connections` is its own table because a credential gets its own row, so
nothing that assembles a config, a snapshot or a view can reach it by walking a blob it was already
holding (ADR-0040) — the same reason `sign_in_grants` is one. `filed_issues` is here although no
human types it, because what it is scoped to is a **project**: an issue number outlives the cluster,
the run and the study that reported it, so `deleteRun` must not take it and a sweep must not either.
`deleteProject` takes both.

**Frozen — resolved once, immutable thereafter (ADR-0024).**

| Table | Key | Lifted columns |
| --- | --- | --- |
| `config_snapshots` | `id` | `hash` (identical snapshots dedupe), `created_at` |

**Produced — what the population generated.**

| Table | Key | Lifted columns |
| --- | --- | --- |
| `runs` | `id` | `project_id`, `simulation_id`, `seq`, `population_id`, `status`, `parent_run_id`, `started_at` |
| `agents` | `(run_id, id)` | `simulation_id`, `population_id`, `cohort_slug`, `person_id`, `status`, `next_wake_at` |
| `identities` | `id` | `run_id`, `tag`, `agent_id`, `torn_down_at` |
| `memories` | `(run_id, agent_id)` | — |
| `wakes` | `id` | `run_id`, `agent_id`, `population_id`, `started_at`, `cost_usd` |
| `trace_events` | `(wake_id, seq)` | — |
| `findings` | `id` | `run_id`, `wake_id`, `kind`, `signature`, `created_at`, `verified` |
| `events` | `seq` (autoincrement) | `at`, `project_id`, `simulation_id`, `run_id`, `wake_id`, `type` |
| `jobs` | `id` | `kind`, `status`, `project_id`, `run_id`, `created_at`, `cost_usd` |

**Judged — what a human decided.**

| Table | Key | Lifted columns |
| --- | --- | --- |
| `triage` | `(project_id, signature)` | `state`, `updated_at` |

Four of those keys are the whole of a design decision and are worth reading twice:

- **`agents` is keyed `(run_id, id)`**, not `id`. Agent ids are deterministic —
  `populationSlug/cohortSlug#ordinal` — and therefore repeat across executions by design. Keyed on
  `id` alone, starting a second execution rewrote the first one's participants and its memory joins
  went nowhere (ADR-0020, ADR-0024 amendment). **Anything keyed by agent id alone leaks between
  runs; key by run as well.**
- **`memories` is keyed `(run_id, agent_id)`**, which is what makes a clean slate free: a new run id
  is a new key and there is nothing to clear (ADR-0030).
- **`people` is keyed `(project_id, id)`** where the id is `cohortSlug.personaSlug#ordinal`. A person
  is durable and belongs to a cohort's lane, not to a study or an execution; every study that sends
  the cohort meets the first N of each lane, where N is that study's size dealt (ADR-0031,
  ADR-0041).
- **`triage` is keyed `(project_id, signature)`**, so a human's judgement survives a re-execution
  that produces entirely new finding rows (ADR-0028).

Two things are still deliberately not stored: **digests and clusters**, computed per request; and
**rollup counters**, because cached totals on `runs` are enough at local scale (§12). A third used
to be on this list — a cross-run "issue" entity — and `filed_issues` is now half of one: it holds an
issue's identity, the signatures it was filed for, and populace's own record of what it has seen and
already said about the problem — and nothing the tracker knows (§12).

## 2. The four layers

The model divides cleanly by who writes it, and that division is what keeps the runner ignorant
of the product above it.

```
  authored        ──►  frozen        ──►  produced          ──►  judged
  Project              ConfigSnapshot      Run                    Triage
  Target                                   Agent  Identity        Comparison
  Persona                                  Wake   Trace           Export
  Population                               Finding  Memory
  Settings                                 Digest  Cluster
```

- **Authored** is what a person edits. Mutable, versioned, never read by the runner.
- **Frozen** is one resolved `PopulaceConfig` captured at the moment a run starts. Immutable.
- **Produced** is what the population generated. Append-only in practice; the runner's output.
- **Judged** is what a human decided afterwards. Mutable, and deliberately kept out of the
  produced rows so evidence stays immutable.

The seam between authored and frozen is the whole of ADR-0024: the runner consumes a resolved
`PopulaceConfig` and does not care whether it was parsed from YAML or assembled from rows.

## 3. Runs become first-class

The dashboard is organised around runs — every screen in the roadmap is scoped to one or two of
them — and a run is currently the one thing with no representation.

```ts
Run {
  id: string                    // run_<base36 ms>_<suffix>, already sorts by time
  projectId: string             // "default" until M4
  targetId: string
  populationId: string
  label: string                 // human name; defaults to the target and a timestamp
  status: "pending" | "running" | "paused" | "completed" | "killed" | "failed"
  configSnapshotId: string      // the frozen PopulaceConfig (§4)
  parentRunId: string | null    // set by --continue-from
  continuation: { reason: string; carriedAgents: number; returningAfterGiveUp: number } | null
  startedAt: string
  endedAt: string | null
  totals: { agents, wakes, findings, confirmed, costUsd }   // cached counters
}
```

**M1 derives this and does not store it.** The roadmap holds M1 to "no new persisted data model",
and every field above except `label`, `status` and the config snapshot is recoverable from
existing rows: totals by aggregation, start and end from wake timestamps, lineage from
`agents.continuedFrom`. So M1 ships a `RunSummary` **read model** behind a query interface, and
M2 puts a real `runs` table underneath the same interface. Screens built in M1 do not change.

That is a deliberate trade and it has a cost: aggregation over `wakes` and `findings` on every
request, and no way to distinguish "a run that finished" from "a run whose daemon was killed".
Both are acceptable for a read-only local dashboard over one developer's database, and neither is
acceptable once the browser can start runs — which is exactly when M2 lands the table.

## 4. The config snapshot

When a run starts, the resolved `PopulaceConfig` is serialised and stored once, and the run points
at it.

```ts
ConfigSnapshot { id, createdAt, hash, config: PopulaceConfig }   // hash dedupes identical snapshots
```

This is the single most load-bearing addition in the model, and it is worth being explicit about
what it buys, because none of it is available today:

- **Reproducibility.** A digest from three weeks ago can say which model, which guardrails and
  which persona wording produced it. Right now the YAML file has moved on and the answer is lost.
- **History that does not rewrite itself.** Editing a persona in the M2 editor must not
  retroactively change what a past run was. With config in rows and no snapshot, it would.
- **Fix validation that can explain itself.** `--continue-from` compares parent and child
  snapshots, so the comparison screen can say "same population, target repaired" rather than
  asking the user to remember.
- **A safe migration path for D3.** Because the snapshot is the resolved object and not the
  authored rows, moving the source of truth from YAML to the database changes nothing downstream
  of the snapshot.

Secrets do not go in the snapshot. `bearerToken`, `apiKey` and anything substituted from `${VAR}`
are redacted to a reference before storage; the snapshot records *that* an env var was used, never
its value. This matters before M5, because a local database gets copied around and attached to bug
reports. The hash is taken over the redacted config with object keys ordered, so it is a hash of
content rather than of assembly order, and two runs on unchanged config share one row.

**A snapshot is a record of what ran, never a source of credentials.** It is redacted by
construction, so anything that opens a connection — a resumed execution, the verifier's replay,
sweep's teardown calls, an identity renewing a session — takes the *plan* from the snapshot and the
*secrets* from the authored rows. `withLiveSecrets` is the one place that puts them back, and it
covers `bearerToken`, per-endpoint headers, `model.apiKey`, the reset headers and an `admin-mint`
identity's own key. Connecting from a snapshot directly sends `[redacted]` as a bearer token, and
the failure is silent in the worst way: replays that cannot authenticate come back
`not-reproduced`, the digest drops not-reproduced findings before clustering, and real findings
disappear with nothing on screen to say why.

## 5. Config as rows

The authored layer, with the database as the source of truth (ADR-0025). The entity model is
ADR-0029's; what follows is how it is stored.

```ts
Project    { id, slug, name, description, archived, createdAt, updatedAt }
Target     { id, projectId, slug, name, mcp: McpEndpoint[], webBaseUrl?, description?,
             identity: IdentityConfig, reset: TargetReset, createdAt, updatedAt }
Persona    { id, projectId, slug, spec: PersonaSpec,
             origin: "starter" | "authored" | "imported", createdAt, updatedAt }
Cohort     { id, projectId, slug, name, context, mix: { personaId, weight }[], traits, tools,
             model, seed, cadence?, maxWakes?, notes, createdAt, updatedAt }
Person     { projectId, id: `${cohortSlug}.${personaSlug}#${ordinal}`, cohortId, cohortSlug,
             personaId, personaSlug, laneSlug, ordinal, name, details, handle,
             overrides: { patience?, budgetUsd?, traits },
             generatedBy: "seeded" | "model" | "authored", archivedAt?, updatedAt }
Population { id, projectId, slug, name, members: { cohortId, weight }[], createdAt, updatedAt }
Simulation { id, projectId, slug, name, description, brief, populationId, targetId,   // the study
             mode: "ephemeral" | "longitudinal", size, visitsPerPerson: number | null,
             cadence, seed, autoSweep, requireFreshTarget, overrides, archived, createdAt, updatedAt }
Settings   { projectId, model: ModelConfig, guardrails: Guardrails,
             verifier: VerifierConfig, daemon: DaemonConfig, cadence, seed, maxWakes }
Triage     { projectId, signature, state, note, externalRef, titleAtTriage, updatedAt }
```

Five things to get right here:

**Slugs stay stable, and they are the URL.** A target, persona, cohort, population and study
each carry an immutable `slug`, unique within the project, separate from the mutable display name
and from the surrogate row id. Agent ids are built from slugs, so renaming a persona in the editor
must never change one — and the URL space is spelled in slugs, so a rename must not break a
bookmark either.

**The URL space, as ADR-0043 left it.** Every authored noun has a list page and one builder page
serving both `new` and an id; the library segments are bare plurals; and the paths that moved —
`library/target`, `library/people`, and every `/s/…` address (ADR-0042) — redirect rather than 404,
because those addresses have been in a URL bar:

```
/p/:proj                                          the studies dashboard (the project home)
/p/:proj/studies/new                              the study builder: what, where, who (and how many), how
/p/:proj/studies/:study                           its results, and the screens under it
/p/:proj/studies/:study/people                    the people this study sends, in deal order
/p/:proj/studies/:study/executions/:runId/cohorts one execution's cohorts, as it ran them
/p/:proj/library/targets        /new   /:t        connect one — ADR-0040's flow, the one builder that saves early
/p/:proj/library/personas       /new   /:x        one builder for creating and editing
/p/:proj/library/cohorts        /new   /:c
/p/:proj/library/populations    /new   /:pop
/p/:proj/people/:personId                         one person, across every study (read-only)
/p/:proj/s/…                                      redirects to /studies/…
```

`new` sits before `:id` in every route table so that it is a verb rather than an id, and the server
reserves the slug `new` for every one of these nouns for the same reason. A target is still
addressed by row id here, not by slug — the slug column exists and `StoredTargetView` does not carry
it, which is the one place this table is aspirational rather than descriptive.

**The study owns the headcount; the cohort owns the seed and the people** (ADR-0041). A study's
`size` is the only number that decides how many people go — there is no `scale`, a cohort has no
size and neither has a population — and `dealStudy` apportions it across the population's member
weights and then across each cohort's mix by highest averages, one lane per persona, ties to the
earlier entry, so that growing a study re-deals nobody. A study may also carry a `brief`, one text
every person it sends hears after their cohort's context. The seed decides which traits, patience and budget each ordinal in
a lane is sampled with. Putting the seed on the population or the study would re-cast the
same people every time they were run, which destroys comparison across executions (ADR-0029).

**A person is a row, not a derivation.** Names are stable because they are stored, not because the
generator is deterministic: `ensureRoster` fills empty slots only and never overwrites, a shrink
archives rather than deletes, and changing the seed renames nobody (ADR-0031). The roster is sized
at the largest count any live study gives the lane — a study that is not archived, or is archived
but still has an execution running or paused — so a cohort in two studies is one roster and the
smaller study meets a prefix of each lane. **No GET writes a person**: resolution reads the roster
and fills a missing ordinal in memory, and the rows are written by creating, editing or archiving
a study, editing a population or a cohort, starting an execution, the study's people jobs and the
YAML import (ADR-0041).

**Deletes refuse, except at the project boundary.** A row another authored row points at cannot be
deleted: `deleteTarget`, `deletePersona`, `deleteCohort` and `deletePopulation` throw
`ReferencedError` naming the referrers, and the API turns that into a 409 that says which thing to
take apart first, because the user is being asked which of two things they meant. `deleteProject`
is the one exception and cascades, because a project IS the scope those references live in, so
there is no second thing to mean. It runs in one transaction and reaches everything scoped to the
project — including the produced rows, which are keyed by RUN rather than by project and so go
through `deleteRun`. `deleteRun` is the single place that knows what an execution produces: agents,
memories, identities, wakes, their trace events, findings and the event log. A delete that only
touched the tables with a `project_id` column would leave the rest keyed to a run id nothing could
resolve — invisible in every screen and counted by every `COUNT(*)`.

A study is the one thing ARCHIVED rather than deleted by default, because its executions are
history worth keeping under a name; deleting it with them is an explicit ask. The rules, in one
table, because five screens say these sentences and must agree with the server (ADR-0043 §7):

| Noun | Default act | Refused while… |
| --- | --- | --- |
| Persona | delete | a cohort's mix names it |
| Cohort | delete | a population holds it — the 409 names them; nothing is stripped out on the reader's behalf |
| Population | delete | a study names it — the 409 names them; there is no "last" or "default" population to protect |
| Target | delete | a study points at it |
| Study | **archive**; deleting its executions is opted into | — |
| Person | never deleted; archived by the roster rule and restored when a study sends them again | — |
| Project | cascade, in one transaction | — |

**Cohorts and populations reference; snapshots inline.** `Population.members[].cohortId` and
`Cohort.mix[].personaId` are references, so one cohort can be in two populations and one persona
in two cohorts' mixes. The snapshot inlines one member per LANE at the count the study's size deals it — the full
`PersonaSpec`, the cohort's `context`, overlay and policy, the study's `size` and `brief`, *and the
roster*: `member.people[]` with each person's id, name, details, handle and hand-set overrides —
because the frozen layer must not depend on a row
that can later change. That is what lets a three-month-old execution still render the right names after
its cohort has been re-cast.

**The shapes are the existing schemas.** `PersonaSpec`, `Cadence`, `McpEndpoint`, `IdentityConfig`,
`Guardrails`, `ModelConfig`, `VerifierConfig` are zod schemas in `packages/core/src/schemas/` and
the tables store those objects unchanged. Resolution to a `PopulaceConfig` is assembly, not
translation — and it is **per study**, not per project, and **read-only**: `resolveSimulationConfig`
reads that study's population, its target and its plan, deals its size, and layers the result over
the project's settings without writing a row (ADR-0025 amendments).

## 6. Evidence stays as it is

`Agent`, `Identity`, `Memory`, `Wake`, `TraceEvent` and `Finding` are well-shaped for what the
dashboard needs and change only by addition:

- `Wake` gains nothing. It already carries status, usage, cost, turns, tool calls, finding count
  and `wouldReturn` — the last of which is what the fix-validation screen reads.
- `TraceEvent` gains nothing. Its discriminated union already covers model turns, tool calls,
  reporter calls, guardrail trips, identity events, findings and memory writes, in sequence, with
  `(wakeId, seq)` ordering. The trace viewer is a rendering problem, not a data problem. This is
  the POC's best asset and the reason the instrument surface is cheap to build.
- `Finding` gains nothing in the produced layer. Its reproduction steps, evidence refs and
  verification verdict are complete. Human state goes elsewhere — see §8.

New indexes are needed for the read paths the dashboard actually uses: `findings(run_id, kind)`,
`wakes(run_id, agent_id, started_at)`, `agents(run_id, status)`. The current indexes were chosen
for the daemon's queries, not a dashboard's.

## 7. Digests and clusters get persisted (M2)

Today `buildDigest()` computes clusters in memory and `renderDigestMarkdown()` writes a file. For
the web app the digest is a screen, and for M3 it is the thing two runs are compared *by*.

```ts
Digest  { id, runIds, window, generatedAt, totals, costUsd }
Cluster { id, digestId, signature, kind, title, severity, tool?,
          representativeFindingId, findingIds, personaIds, wakeIds,
          confirmedCount, notReproducedCount, inconclusiveCount, unverifiedCount }
```

`signature` is the new field and it carries the weight: a stable, content-derived identifier
(kind + primary tool + normalised title) that identifies *the same problem* across runs. Markdown
becomes an exporter over the persisted digest rather than the only output.

## 8. Triage attaches to the signature, not the finding

This is the least obvious decision in the model and the one most likely to be got wrong.

The roadmap's M3 wants finding state — triaged, accepted, fixed, won't fix, duplicate — and its
fix-validation loop wants that state to survive a re-run. But a re-run produces **new finding
rows**: different ids, different wake, different run. Attach triage to `finding.id` and the moment
you press "re-run the people who complained", every judgement you recorded detaches from the
returning evidence, and the screen that is supposed to show "you marked this fixed, and Priya
agrees" has nothing to join on.

So:

```ts
Triage { projectId, signature, state, note, assignee?, duplicateOfSignature?,
         externalRef?, updatedAt, updatedBy }   // key: (projectId, signature)
```

Triage is keyed by cluster signature within a project. A finding's state is its cluster's state.
This is what makes "what is new in this run", "what came back after we fixed it" and "what did we
already decide not to fix" answerable with a join rather than a heuristic.

The risk is signature drift: if clustering changes, signatures change, and triage detaches. So the
signature function is versioned (`sig1:...`), its inputs are frozen alongside the algorithm, and
changing it requires a mapping step — the same care the store's table-shape changes already get.

## 9. The event log (M2)

An append-only log with one monotonic cursor across the whole store.

```ts
Event { seq: number, at: string,
        projectId: string | null, simulationId: string | null,
        runId: string | null, wakeId: string | null,
        type: "run.started" | "run.ended" | "run.status" | "run.config" | "wake.started"
            | "wake.ended" | "trace.appended" | "finding.filed" | "guardrail.tripped"
            | "identity.created" | "job.updated",
        payload: JsonValue }
```

`trace_events` is ordered per wake, which is right for replay and useless for "what happened next
anywhere". The log gives SSE a resumable cursor (ADR-0026), gives the run screen a single
subscription, and in M5 is how separate runner and API processes meet.

It is written by a `RecordingStore` decorator around the `Store` the runner already writes to, plus
the daemon at run boundaries — not by new instrumentation scattered through the wake loop. Every
row it appends is derived from a write that was happening anyway, which is what keeps `runWake()`
untouched and keeps the log honestly derived.

**Every event about a run carries its `runId`, and scope is stamped rather than passed in.** Both
ends of delivery filter on the id — the in-process fan-out compares the event's ids to the
subscriber's filter, and `listEvents` filters with `run_id = ?`, which excludes NULL in SQL — so an
event about a run written with a null `runId` is invisible to the screen that run owns. A null
`runId` means the event is genuinely not about a run.

`projectId` and `simulationId` — `studyId` on the wire's `EventView`, translated as the event leaves
(ADR-0042) — are not the emitter's job. An emitter deep inside a wake knows its
wake and its run and has no business knowing which project the run is filed under, so
`RecordingStore.scoped()` fills both from the run row (and fills `runId` itself from the wake when
only the wake is known), caching per run because a run's project never changes. That is what lets
one connection follow a whole project — `GET /events?project=…` — instead of one per run. The one
case it cannot cache is a run whose row is written a moment after its first event; that event is
stamped with what is known and the next one asks again, rather than the cache remembering "no
project" forever.

Retention: the log is derived from rows that already exist and can be truncated to the last
N events or the last M days without losing anything. That is stated up front so nobody later
treats it as the system of record.

## 10. Jobs (M2)

Starting a run, running a digest, validating a target and re-running a continuation are all
long-running and all cost money. The browser needs to show progress and survive a reload.

```ts
Job { id, kind, status: "queued"|"running"|"succeeded"|"failed"|"cancelled",
      runId?, progress: { done, total, label }, error?, createdAt, startedAt?, endedAt? }
```

One in-process runner drains the queue serially in M2 (ADR-0027). In M5 the same table is the queue
hosted workers pull from; the interface does not change.

Two rules the implementation settled. **A settled job never changes again:** `run.start` outlives
its own handler, because the handler returns once the run row exists and the daemon keeps ticking
behind it, so progress reported after the job succeeded belongs to the run and its own events.
**A job left `running` or `queued` by a process that died is failed on the next open**, because it
can never finish and a browser would wait on its spinner forever. Note that the job and the run it
was driving are reconciled to different states on the same open: the job to `failed`, the run to
`paused` with `pauseReason: "process-ended"` (§3 and the ADR-0024 amendment). That is not an
inconsistency — the job really did stop and cannot be resumed, while the execution is exactly what
`serve --resume` picks back up.

## 11. Schema change without a migration framework

The store has none, and as of the projects/simulations/cohorts/people restructure it does not even
have the beginnings of one: `migrations.ts` is deleted (ADR-0011 amendment). One `SCHEMA` constant
holds every table, and a `schema_shape` constant baked into the source is written to `control` on a
fresh file and compared on open. A mismatch drops every table, recreates them, and warns:

```
populace store: the schema changed; this database was rebuilt from scratch and its runs are gone.
```

Earlier revisions of this section planned a real migration runner for M2, on the reasoning that
authored rows are a user's work and must never be dropped. **That reasoning is right and its timing
was wrong.** The restructure rewrote nearly every table at once while the only databases in
existence were developers' throwaway local stores in this repository, and a migration sequence for
data nobody has is a sequence nobody keeps correct.

**The trigger that ends this regime is named rather than left to judgement: the first database
outside this repository that holds a target somebody typed.** Once a person has entered an endpoint,
a bearer token, a persona they wrote or a cohort they cast, a drop is data loss, and the migration
runner has to exist before the next schema change ships. The rules it will implement are the ones
this section always stated:

- **Produced and derived tables may be dropped and rebuilt.** Traces, events and jobs are
  reproducible or expendable.
- **Authored tables are never dropped.** Projects, targets, personas, cohorts, people, populations,
  simulations, settings and triage are the user's work. They get additive columns, defaults, and an
  ordered list of forward steps.
- **Snapshots are versioned, never migrated.** A snapshot records the `PopulaceConfig` version it
  was written with (`version: 2`) and is read through the schema of that version.

One forward step already exists outside this regime, and it is the shape the runner will formalise:
a `size_backfill` marker in `control` guards a one-time raw-JSON fill of every legacy study's `size`
from its population's summed member sizes, so `SCHEMA_SHAPE` was not bumped for ADR-0041 and no
database was dropped. It is deleted when the framework arrives.

Until the trigger fires, the cost of being wrong is exactly one warned rebuild of a developer's own
store, which is why the decision is affordable — and why the sentence "authored rows are expendable"
has an expiry date rather than a rationale.

## 12. What this model deliberately does not have

- **No determinism subsystem.** No virtual clock, no seeded id source, no pinned model sampling, no
  forced concurrency of one, no jitter removal. Two executions of one ephemeral study disagree
  by design, and everything that compares executions compares signatures (ADR-0030).
- **No semantic signature.** `sig1` is a hash of kind, primary tool and sorted title tokens, and the
  measured consequence is in ADR-0028's amendment: identical or punctuation-varied wording recurs
  100% of the time, a complaint reworded from scratch recurs 0% of the time. An embedding, or a
  judge asked "is this the same problem?", is a later decision.
- **No target-kind discriminator.** populace is MCP-only. `Target` is an MCP connection concretely,
  with no abstraction layer for a second kind that is not coming.
- **No cross-project anything.** A persona cannot be shared between projects; copy it. Signatures
  roll up within a project. Projects are scoping, not tenancy: one SQLite file, one `serve` lock, no
  authentication before M5.
- **No per-person authoring beyond a name, a detail line and the sampled dimensions.** A person
  cannot carry their own goals, tool policy or errands. The moment they do, the persona stops being
  a template and the cohort stops meaning anything (ADR-0031). A study says one thing to all of its
  people through `brief`; a `(study, person)` override table is deliberately not built (ADR-0041).
- ~~**No cross-run "issue" entity.** Cluster signature plus triage covers what the compare and Known
  screens need. A first-class Issue that outlives clusters is a product decision nobody has made.~~
  **Amended 2026-09-30 (ADR-0044): filing issues made that decision.** `filed_issues` holds an
  issue's `(repo, number, url)` and every member signature the cluster behind it contained, and an
  issue number does outlive the cluster, the signature, the run and the study — which is the whole
  point of it, since the ledger is what stops the same problem being filed twice. It also holds
  populace's own history of the problem — `seenIn`, one sighting per report window that reported it,
  and `quietNotices`, every absence populace has announced on the issue, keyed `(studyId, since)` so
  an absence is said once per piece of news rather than once per window (ADR-0044 §8, ADR-0045).
  That is a record of what populace observed and said, not a mirror of the issue. What is still
  deliberately absent is narrower and is the part worth defending: populace stores **no issue state
  and no issue body**. It does not know whether an issue is open or closed except by asking at the
  moment it publishes, nothing in the dashboard says "closed", and `FiledIssueView` is a link and a
  number on purpose. populace is not the system of record for anything in somebody's tracker, and a
  synced mirror of one is still a product decision nobody has made.
- **No persisted digests or clusters, and no rollup tables.** Clusters are computed in memory per
  request. At one project with a handful of studies that is fine; at thirty studies of
  thirty executions it is not, and the answer then is a rollup table built on evidence rather than
  speculated about now.
- **No scheduled or unattended runs.** A longitudinal study is started by hand, and "runs
  forever" means "runs as long as `serve` does". `serve --resume` re-arms executions a previous
  process left paused; there is no cron, no daemonisation and no wake-on-boot.
- **No YAML export for the new layers.** `populace.yaml` can create cohorts and studies on first
  open, turning the file's counts into weights and a study size; it is an import, not a sync, and a cohort cast in the browser is not in anybody's repository
  yet (ADR-0018 amendment).

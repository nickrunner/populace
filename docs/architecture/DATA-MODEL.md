# Data model

What populace persists and why each piece is keyed the way it is. Companion to
`WEB-ARCHITECTURE.md`; the vocabulary table in `docs/ARCHITECTURE.md` still defines the terms.

Sections 1, 5, 11 and 12 describe what exists. The rest are kept as the reasoning that got here —
several were written before the tables they describe were built, and their milestone markers say so.

---

## 1. What exists

Nineteen tables plus a key-value `control` table, each storing a zod-validated JSON blob with a few
columns lifted out for indexing (ADR-0011). Everything populace knows is in the database: YAML is an
import, not the entry point (ADR-0025).

**Authored — what a person edits.**

| Table | Key | Lifted columns |
| --- | --- | --- |
| `projects` | `id` | — |
| `targets` | `id` | `project_id`, `slug` (unique per project), `name`, `updated_at` |
| `personas` | `id` | `project_id`, `slug` (unique per project), `origin`, `updated_at` |
| `cohorts` | `id` | `project_id`, `slug` (unique per project), `persona_id`, `size`, `updated_at` |
| `people` | `(project_id, id)` | `cohort_id`, `cohort_slug`, `persona_id`, `ordinal`, `archived_at` |
| `populations` | `id` | `project_id`, `slug` (unique per project), `updated_at` |
| `simulations` | `id` | `project_id`, `slug` (unique per project), `population_id`, `target_id`, `mode`, `archived` |
| `settings` | `project_id` | — |

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
- **`people` is keyed `(project_id, id)`** where the id is `cohortSlug#ordinal`. A person is durable
  and belongs to a cohort, not to an execution; the same person appears in every execution that
  sends their cohort (ADR-0031).
- **`triage` is keyed `(project_id, signature)`**, so a human's judgement survives a re-execution
  that produces entirely new finding rows (ADR-0028).

Three things are still deliberately not stored: **digests and clusters**, computed per request;
**a cross-run "issue" entity**, which signature plus triage covers; and **rollup counters**, because
cached totals on `runs` are enough at local scale (§12).

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
reports.

## 5. Config as rows

The authored layer, with the database as the source of truth (ADR-0025). The entity model is
ADR-0029's; what follows is how it is stored.

```ts
Project    { id, slug, name, description, archived, createdAt, updatedAt }
Target     { id, projectId, slug, name, mcp: McpEndpoint[], webBaseUrl?, description?,
             identity: IdentityConfig, reset: TargetReset, createdAt, updatedAt }
Persona    { id, projectId, slug, spec: PersonaSpec,
             origin: "starter" | "authored" | "imported", createdAt, updatedAt }
Cohort     { id, projectId, slug, name, personaId, size, seed,
             cadence?, maxWakes?, notes, createdAt, updatedAt }
Person     { projectId, id: `${cohortSlug}#${ordinal}`, cohortId, cohortSlug, personaId, ordinal,
             name, details, handle, generatedBy: "seeded" | "model" | "authored",
             archivedAt?, updatedAt }
Population { id, projectId, slug, name, cohortIds: string[], createdAt, updatedAt }
Simulation { id, projectId, slug, name, description, populationId, targetId,
             mode: "ephemeral" | "longitudinal", visitsPerPerson: number | null,
             cadence, seed, autoSweep, requireFreshTarget, archived, createdAt, updatedAt }
Settings   { projectId, model: ModelConfig, guardrails: Guardrails,
             verifier: VerifierConfig, daemon: DaemonConfig, cadence, seed, maxWakes }
Triage     { projectId, signature, state, note, externalRef, titleAtTriage, updatedAt }
```

Five things to get right here:

**Slugs stay stable, and they are the URL.** A target, persona, cohort, population and simulation
each carry an immutable `slug`, unique within the project, separate from the mutable display name
and from the surrogate row id. Agent ids are built from slugs, so renaming a persona in the editor
must never change one — and the URL space is spelled in slugs, so a rename must not break a
bookmark either.

**A cohort owns the headcount and the seed; nothing else does.** `size` is the only number that
decides how many people exist — there is no `scale` — and the seed decides which traits, patience
and budget each ordinal is sampled with. Putting the seed on the population or the simulation would
re-cast the same people every time they were run, which destroys comparison across executions
(ADR-0029).

**A person is a row, not a derivation.** Names are stable because they are stored, not because the
generator is deterministic: `ensureRoster` fills empty slots only and never overwrites, a shrink
archives rather than deletes, and changing the seed renames nobody (ADR-0031).

**Cohorts and populations reference; snapshots inline.** `Population.cohortIds` and
`Cohort.personaId` are references, so one cohort can be in two populations and one persona behind
two cohorts. The snapshot inlines the full `PersonaSpec` *and the roster* — `member.people[]` with
each person's id, name, details and handle — because the frozen layer must not depend on a row that
can later change. That is what lets a three-month-old execution still render the right names after
its cohort has been re-cast.

**The shapes are the existing schemas.** `PersonaSpec`, `Cadence`, `McpEndpoint`, `IdentityConfig`,
`Guardrails`, `ModelConfig`, `VerifierConfig` are zod schemas in `packages/core/src/schemas/` and
the tables store those objects unchanged. Resolution to a `PopulaceConfig` is assembly, not
translation — and it is **per simulation**, not per project: `resolveSimulationConfig` reads that
simulation's population, its target and its plan, layered over the project's settings (ADR-0025
amendment).

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
Event { seq: number, at: string, runId: string | null, wakeId: string | null,
        type: "run.started" | "wake.started" | "trace.appended" | "finding.filed"
            | "guardrail.tripped" | "wake.ended" | "run.ended" | "job.updated" | ...,
        payload: JsonValue }
```

`trace_events` is ordered per wake, which is right for replay and useless for "what happened next
anywhere". The log gives SSE a resumable cursor (ADR-0025), gives the run screen a single
subscription, and in M5 is how separate runner and API processes meet. It is written by the
runner's existing trace writer and by the daemon at run boundaries — not by new instrumentation
scattered through the wake loop.

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

One in-process runner drains the queue in M2 (ADR-0026). In M5 the same table is the queue hosted
workers pull from; the interface does not change.

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

Until the trigger fires, the cost of being wrong is exactly one warned rebuild of a developer's own
store, which is why the decision is affordable — and why the sentence "authored rows are expendable"
has an expiry date rather than a rationale.

## 12. What this model deliberately does not have

- **No determinism subsystem.** No virtual clock, no seeded id source, no pinned model sampling, no
  forced concurrency of one, no jitter removal. Two executions of one ephemeral simulation disagree
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
- **No per-person authoring beyond a name and a detail line.** A person cannot carry their own
  goals, tool policy or budget. The moment they do, the persona stops being a template and the
  cohort stops meaning anything (ADR-0031).
- **No cross-run "issue" entity.** Cluster signature plus triage covers what the compare and Known
  screens need. A first-class Issue that outlives clusters is a product decision nobody has made.
- **No persisted digests or clusters, and no rollup tables.** Clusters are computed in memory per
  request. At one project with a handful of simulations that is fine; at thirty simulations of
  thirty executions it is not, and the answer then is a rollup table built on evidence rather than
  speculated about now.
- **No scheduled or unattended runs.** A longitudinal simulation is started by hand, and "runs
  forever" means "runs as long as `serve` does". `serve --resume` re-arms executions a previous
  process left paused; there is no cron, no daemonisation and no wake-on-boot.
- **No YAML export for the new layers.** `populace.yaml` can create cohorts and simulations on first
  open; it is an import, not a sync, and a cohort cast in the browser is not in anybody's repository
  yet (ADR-0018 amendment).

# Data model

What populace persists, what it should persist, and when each piece lands. Companion to
`WEB-ARCHITECTURE.md`; the vocabulary table in `docs/ARCHITECTURE.md` still defines the terms.

---

## 1. What exists today

Six entity tables plus a key-value `control` table, each storing a zod-validated JSON blob with a
few columns lifted out for indexing (ADR-0011).

| Table | Key | Lifted columns |
| --- | --- | --- |
| `agents` | `id` | `run_id`, `population_id`, `status`, `next_wake_at` |
| `identities` | `id` | `run_id`, `tag`, `agent_id`, `torn_down_at` |
| `memories` | `(run_id, agent_id)` | — |
| `wakes` | `id` | `run_id`, `agent_id`, `population_id`, `started_at`, `cost_usd` |
| `trace_events` | `(wake_id, seq)` | — |
| `findings` | `id` | `run_id`, `wake_id`, `kind`, `created_at`, `verified` |
| `control` | `key` | — (kill switch lives here) |

Everything else populace knows is somewhere other than the database:

- **Target, identity strategy, model, guardrails, verifier settings and the whole population**
  live in `populace.yaml` and are re-parsed on every command.
- **Runs** have no row at all. `listRunIds()` is `SELECT DISTINCT run_id` unioned across three
  tables. A run has no name, no status, no start or end time, no record of the config that
  produced it, and no parent — lineage exists only as `continuedFrom` scattered across agent rows.
- **Digests and clusters** are computed on demand and rendered to a Markdown file. Nothing is
  kept, so "what did last week's digest say" is answerable only if someone saved the file.
- **Human judgement about a finding** has nowhere to go. A finding has a machine verdict
  (`confirmed` / `not-reproduced` / `inconclusive`) and nothing else.

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
construction, so anything that opens a connection — the verifier's replay, sweep's teardown calls —
must take its credentials from the authored `targets` row and use the snapshot only for the shape
of what ran. Connecting with a snapshot directly sends `[redacted]` as a bearer token, and the
failure is silent in the worst way: replays that cannot authenticate come back `not-reproduced`,
and the digest drops not-reproduced findings before clustering, so real findings disappear with
nothing on screen to say why.

## 5. Config as rows (M2)

The authored layer, once the database is the source of truth (ADR-0025, decided D3).

```ts
Project   { id, name, createdAt }                        // "default" exists implicitly until M4
Target    { id, projectId, name, mcp: McpEndpoint[], webBaseUrl?, description?,
            identity: IdentityConfig, createdAt, updatedAt }
Persona   { id, projectId, slug, spec: PersonaSpec,
            origin: "starter" | "authored" | "imported", createdAt, updatedAt }
Population{ id, projectId, slug, scale, seed, cadence, maxWakes?,
            members: { personaId, count, cadence?, maxWakes? }[] }
Settings  { projectId, model: ModelConfig, guardrails: Guardrails,
            verifier: VerifierConfig, daemon: DaemonConfig }
```

Three things to get right here:

**Slugs stay stable.** Agent ids are `populationId/personaId#ordinal` and are deterministic by
design — that determinism is what lets a continuation run recognise the same person. So a persona
row keeps an immutable `slug` used for the id, separate from its mutable display name and its
surrogate row id. Renaming a persona in the editor must never change an agent id.

**Members reference personas; snapshots inline them.** The authored `Population.members` holds a
`personaId` reference so one persona can appear in several populations. The snapshot inlines the
full `PersonaSpec`, because the frozen layer must not depend on a row that can later change.

**The shapes are the existing schemas.** `PersonaSpec`, `Cadence`, `McpEndpoint`,
`IdentityConfig`, `Guardrails`, `ModelConfig`, `VerifierConfig` are already zod schemas in
`packages/core/src/schemas/`. The config tables store those objects unchanged. Resolution to a
`PopulaceConfig` is assembly, not translation — which is why YAML import and export are lossless
in both directions.

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
anywhere". The log gives SSE a resumable cursor (ADR-0026), gives the run screen a single
subscription, and in M5 is how separate runner and API processes meet.

It is written by a `RecordingStore` decorator around the `Store` the runner already writes to, plus
the daemon at run boundaries — not by new instrumentation scattered through the wake loop. Every
row it appends is derived from a write that was happening anyway, which is what keeps `runWake()`
untouched and keeps the log honestly derived.

**Every event about a run carries its `runId`.** Both ends of delivery filter on it — the in-process
fan-out compares `event.runId` to the subscriber's filter, and `listEvents` filters with `run_id =
?`, which excludes NULL in SQL — so an event about a run written with a null `runId` is invisible to
the screen that run owns. A null `runId` means the event is genuinely not about a run.

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

Two rules the M2 implementation settled. A settled job never changes again: `run.start` outlives its
own handler, because the handler returns once the run row exists and the daemon keeps ticking behind
it, so progress reported after the job succeeded belongs to the run and its own events. And a job
left `running` or `queued` by a process that died is failed on the next open, along with the run it
was driving — a dashboard that shows a dead run as live is worse than one that shows it as failed.

## 11. Schema change and the migration gate

Up to M1 the store had no versioning: `CREATE TABLE IF NOT EXISTS`, plus an explicit drop where a
shape had to change (`memories` losing its run scope is the precedent). That was affordable when
the only data was a developer's throwaway local runs. It stopped being affordable at M2, when a
user's personas and targets began living in the same file.

The rule from here:

- **Produced and derived tables may be dropped and rebuilt.** Traces, events, digests and clusters
  are reproducible or expendable; an incompatible change drops them with a logged warning.
- **Authored tables are never dropped.** Projects, targets, personas, populations, settings and
  triage are the user's work. They get additive columns, defaults, and a `schema_version` row in
  `control` gating a small ordered list of forward migration steps.
- **Snapshots are versioned, never migrated.** A snapshot records the `PopulaceConfig` version it
  was written with and is read through the schema of that version.

**Shipped in M2** as `packages/store-sqlite/src/migrations.ts`: a `MIGRATIONS` list of forward
steps, each applied once inside a transaction, gated on the `schema_version` row. A fresh database
and an M1 database both read as version 1, because the M1 shape is created by `CREATE TABLE IF NOT
EXISTS` before the gate runs — so "no version row" and "version 1" are the same state and neither
needs a special case. There are no down migrations and there will not be any: a local database's
recovery story is to delete it, and an authored table is exactly what must not be in that blast
radius.

## 12. What this model deliberately does not have

- **No target-kind discriminator.** D2 settled that populace is MCP-only. `Target` is an MCP
  connection concretely — a list of endpoints, a web base URL, a description — with no abstraction
  layer for a second kind that is not coming. If that reverses, it is a new decision with a new ADR.
- **No users, accounts or tenancy before M5.** `projectId` exists from M2 as a scoping column so
  that adding tenancy later is a column and a filter, not a reshaping. Nothing before M5 reads it
  as anything but `"default"`.
- **No cross-run "issue" entity.** Cluster signature plus triage covers what M3 needs. A
  first-class Issue that outlives clusters is a product decision nobody has made.
- **No separate analytics or rollup tables.** Cached counters on `Run` are enough at local scale.
  If a screen needs more, that is evidence for a rollup, not a reason to speculate about one now.

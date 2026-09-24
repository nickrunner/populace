# Populace in the cloud: the plan

**Status:** plan, 2026-09-24. Nothing here is started; this is the roadmap's R5 written out.
**Owner:** product and architecture together
**Input from:** `ROADMAP.md` (R5, D4, D5, D6), `WEB-ARCHITECTURE.md` §1 and §4, ADR-0003/0004/0022/0027
**Decisions taken for this plan:** GCP; bring-your-own-key at launch with a metered managed-key
tier later; this document lives beside the roadmap rather than inside it.

Populace runs on one machine today. A user starts `populace serve`, which is one process that owns
one SQLite file, hosts the API, drains the job queue and ticks the daemon. Getting from there to
a product somebody signs up for means five things: a database that several processes can share,
a runtime for the visits that is not the API's process, accounts and tenancy in front of it all,
secrets that are not plaintext in rows, and a way to charge for it. This document is the plan for
those five, in the order they can be built, with the reasons.

It is written from the code, not from the diagrams. §2 is the part to read if you read nothing
else: it is what the code assumes today that a hosted product breaks, found by reading the paths
a cloud split actually cuts through.

---

## 1. The invariant, and why it is not enough

> `runWake()` does not change.

Still true, and it is what makes this plan tractable at all. A visit is a stateless job over
`(agent, memory, identity, target, config)` (ADR-0003); the runner never imports a concrete
store (ADR-0004); starting a run, building a digest and sweeping accounts are already rows in a
`jobs` table (ADR-0027); live updates already ride a persisted event log rather than a socket
(ADR-0026); the API is Hono, whose handlers run the same on Node and on a container (ADR-0021).
Every one of those was chosen with this split in mind, and every one of them holds.

But the sentence the earlier documents repeat — *cloud is a different implementation of `Store`
and `Scheduler`* — is true and insufficient. Those two interfaces are the seam the runner sees.
Above the runner there is a control plane that was written for one process, and it does not
know it: it keeps the truth about a running execution in a `Map`, claims a due person by writing
a timestamp an hour ahead, enqueues jobs as closures, fans events out through an in-memory set of
listeners, and locks the store with a process id. None of that is wrong. All of it is single-
process, and the cloud is not.

So the plan has two halves. The first (§4, §5) is the runtime and the data — a worker that
visits, a database that several processes share. The second (§6, §7) is the product around it —
accounts, tenancy, keys, billing. §8 puts them in phases, and the first phase is entirely local
work: hardening the control plane so that two processes could share a database safely, which is
the same work whether the second process is on the laptop or in a container.

## 2. What the code assumes that the cloud breaks

Each item is a pattern that is correct for one process over one SQLite file and wrong for N
workers over Postgres. They are cited by file so the claims can be checked, and grouped by what
they have in common. Nothing here is a bug today.

### 2.1 The control plane lives in memory

- **A run "is running" when a daemon object exists.** `RunController` in
  `packages/server/src/runs.ts` keeps `active: Map<runId, { daemon, config, stopping, … }>`, and
  `pause`, `stop`, `resume`, `applyChanges`, `round` and `settled` all key off it. An execution
  the process is not driving is settled by writing the row directly, and `reconcileOrphans()` on
  boot marks every `running` row `paused / process-ended` because a row that says `running` with
  no daemon behind it is a lie. In the cloud there is no process that owns a run; the row has to
  be the truth, and "stop" has to be a write that whoever is visiting observes.

- **A job is a closure.** `JobRunner.enqueue(kind, handler)` in `packages/server/src/jobs.ts`
  persists a row with a `kind`, a status and progress — and holds the work itself as a function in
  the queue array. The row is a progress record, not a job. ADR-0027 says the same table becomes
  the queue hosted workers pull from; that is not true yet, and cannot be until a job is
  `{ kind, params }` with a handler looked up by kind in the process that runs it.

- **The claim is read-then-write, and the lease is a magic number.** `LocalDaemon.tick()` in
  `packages/runner/src/daemon.ts` calls `listDueAgents`, then for each result writes the whole
  agent back with `nextWakeAt` pushed an hour ahead so "a concurrent tick does not pick it up
  again". One process, one event loop: safe. Two dispatchers reading the same due rows before
  either writes: the same person visits twice at once, spends twice, and — on a self-signup
  target — signs up twice on the customer's product. The hour is also doing double duty as a
  lease: a visit that runs longer than an hour fires again on top of itself, and a person whose
  worker died is silent for an hour with nothing on the screen to say why.

- **An agent row is replaced whole.** `upsertAgent` writes one JSON blob that holds runtime
  state (`status`, `nextWakeAt`, `wakeCount`, `identityId`) and configuration (`persona`,
  `context`, `cohortTools`, `maxWakes`) together. `runWake`'s `finish()` writes back the agent it
  loaded at the start; `round()` writes `nextWakeAt: now` onto every active agent, in-flight ones
  included; `reconcile()` merges config over runtime. With one writer, JS serialises these. With
  several, the last write wins and one of them loses a `wakeCount` or an `identityId`.

- **The store lock is a process id.** `packages/server/src/lock.ts` writes `{ pid, host,
  startedAt }` and tests liveness with `process.kill(pid, 0)`. Across containers a pid says
  nothing. The lock exists because `node:sqlite` is single-process (ADR-0022); with Postgres the
  reason goes away and leases replace it.

### 2.2 One writer, zero latency

- **The event cursor assumes commit order.** `appendEvent` returns SQLite's `lastInsertRowid` as
  `seq`, and the SSE stream and `GET /events?afterSeq=` treat it as a monotonic cursor
  (ADR-0026). Under one writer a rowid *is* commit-ordered. A Postgres sequence is not: two
  transactions take 41 and 42, 42 commits first, a client reads through 42 and never sees 41.
  Either the cursor is assigned under a lock (one row that hands out the next `seq`, which
  serialises appends — fine at populace's write rate) or reads are gated on
  `pg_current_xact_id()` visibility. The plan picks the former.

- **Fan-out is in-process.** `EventHub` in `packages/server/src/events.ts` is a `Set` of
  listeners; `RecordingStore` wraps the store so every write the runner makes lands on the log
  without the runner knowing (ADR-0026), derives transitions by reading the row *before* writing
  it (`saveWake`, `saveFinding`, `saveIdentity`), and caches run scope in two `Map`s. In the cloud
  the writers are workers and the SSE connections are on API instances. The derivation still
  belongs beside the write, so workers wrap their store the same way; what changes is how an API
  instance learns a row was appended — `LISTEN/NOTIFY` on `events`, with the persisted cursor as
  the catch-up path it already is.

- **The `Store` is chatty.** `seedFromParent` calls `listWakes` once per agent; `round()` upserts
  once per agent; `reconcileOrphans()` lists wakes per run; `RecordingStore` reads before every
  write it derives from. Each call is microseconds on SQLite and a millisecond or three to Cloud
  SQL. A population of fifty is fine; the pattern is not, and `getTraces` already carries the
  comment that says why ("query-count discipline"). A Postgres store wants batch methods and a
  conformance suite that counts queries.

### 2.3 One tenant

- **The kill switch is one row.** `setKillSwitch` writes `control.kill`, every visit checks it
  between turns, and `startOne` refuses to start anything while it is engaged. The ADR-0022
  amendment already names this as an open gap for two simulations in one project; with two
  customers it is one customer stopping another.

- **The daily ceiling is per population, summed on demand.** `dailyCeilingBreached` in
  `packages/runner/src/guardrails.ts` asks `costSince({ populationId })`, which is a `SUM` over
  `wakes` at the start of every visit. There is no ceiling per organisation, none for the
  platform, and — for a managed-key tier — none for *us*.

- **The model provider is process-wide.** `serve.ts` takes one `provider()` built from
  `ANTHROPIC_API_KEY` and hands it to every run; `hasApiKey()` is a fact about the process; the
  verifier's provider is process-wide too. A hosted product resolves the provider per
  organisation, and one organisation's 429s must not stall another's visits. Today the SDK retries
  twice and the visit ends in `error`.

- **There is no authentication.** ADR-0023 says a non-loopback host needs a token; nothing in
  `serve.ts` or `app.ts` enforces one, because nothing has needed it. `listProjects()` returns
  every project in the store; `projectId` is the top of the scope chain; `GET /events?project=`
  is open to anyone who can reach the port.

### 2.4 Secrets

- **Credentials are inline strings.** A target's bearer, its headers, the reset hook's headers,
  an `admin-mint` key, the model key: all are fields on `PopulaceConfig`, resolved from rows into
  one object that the daemon, the sweep and the verifier's replay carry around. People's
  credentials (`identities.json`) and the user's own OAuth grants (`sign_in_grants.json`) are
  plaintext columns. The only protection is at the snapshot boundary, and it is a regular
  expression: `SECRETISH = /auth|token|key|secret|cookie/i` in `packages/server/src/config-store.ts`
  decides what `redactConfig` strips and `withLiveSecrets` puts back. A heuristic is the right
  tool for "don't paste a token into a bug report". It is the wrong tool for a multi-tenant
  database, where the question is not what a snapshot shows but where the bytes live.

- **The cost ledger is customer-influenced.** `wakes.cost_usd` is computed by `priceFor(model,
  modelConfig.prices)`, and `model.prices` is a config field a user can set. That is the right
  design for a local tool showing an estimate. It means the ledger cannot be the truth a
  managed-key tier bills from; token counts in `usage` can.

### 2.5 The machine

- **File paths in configuration.** The `static` identity strategy reads a JSON pool from
  `file:`; the `firebase-admin` adapter reads a service-account file; `reports/exporters.ts`
  writes digests under `digestDir`; `serve.ts` serves the dashboard from `public/`. Three of the
  four have to become rows or objects in a bucket.

- **A visit has no wall-clock deadline.** `WakeOptions` carries no deadline; MCP calls run on the
  SDK's defaults; a visit ends when its turns, tokens or dollars run out (ADR-0009). Locally that
  is fine — the process is the user's. In the cloud a deploy or a scale-in sends SIGTERM to a
  worker that is four minutes into a visit, with the customer's product half-visited and the
  money spent. A ceiling in time is the fourth guardrail, and the worker runtime has to grant
  minutes of grace, not seconds.

### 2.6 The network

- **Egress is unguarded, and the tenant controls the headers.** `McpSession.connect` opens a
  Streamable HTTP transport to a user-supplied URL with user-supplied `endpoint.headers`; the
  `http` reset hook does the same; OAuth discovery follows metadata the address publishes;
  `fetch_page` checks only that the path is same-origin with `webBaseUrl`. On a laptop this is
  the user reaching their own things. In a container on GCP, a target whose address is
  `http://metadata.google.internal/computeMetadata/v1/…` with a header `Metadata-Flavor: Google`
  is a tenant reading the worker's service-account token out of a tool result. This has to be
  refused at the transport — resolve the host, reject link-local, loopback, RFC 1918 and the
  metadata name, pin the resolved address — *and* by network policy, because either alone is one
  bug away from the other.

### 2.7 The gates

- **No migration framework** (D5). `SCHEMA_SHAPE` drops and rebuilds on mismatch. That ends the
  moment the first database is not a developer's.
- **The CLI opens the store directly.** `run`, `digest`, `sweep`, `status` construct a
  `SqliteStore` and, for writers, take the lock. In the cloud the CLI is a client of the API with
  a token, which is R4 arriving early.
- **The whole test suite is in-process SQLite.** A Postgres conformance run needs a database in
  CI. That is a tooling decision, not a problem, but it is on the path.

## 3. The shape on GCP

```
                 ┌──────────────────────────────┐
   browser ────► │  api   (Cloud Run service)   │ ◄──── populace CLI / CI client (org token)
   Identity      │  Hono + contract + dashboard │
   Platform      │  SSE ◄── LISTEN events       │
                 └──────────────┬───────────────┘
                                │ rows + NOTIFY
                 ┌──────────────▼───────────────┐
                 │  Cloud SQL for PostgreSQL    │   Cloud KMS (envelope keys)
                 │  @populace/store-postgres    │   Secret Manager (platform secrets)
                 │  orgs · projects · … · jobs  │   GCS (digests, exports)
                 └──────────────▲───────────────┘
                                │ claim (SKIP LOCKED) · lease · heartbeat
                 ┌──────────────┴───────────────┐
                 │  worker pool (Cloud Run,     │ ──► Anthropic (the org's key)
                 │  CPU always on, min N)       │ ──► the target's MCP endpoints
                 │  runWake() · jobs by kind    │     via Direct VPC egress → Cloud NAT
                 └──────────────────────────────┘     (static IPs; egress guard in-process)
```

| Piece | Choice | Why |
| --- | --- | --- |
| API | **`@populace/server` on Cloud Run**, stateless, scaled by request | Hono runs unchanged; the dashboard stays static assets in the same image (or moves to a bucket behind a CDN later — either is a one-line change). |
| Visits and jobs | **A worker pool that polls Postgres** — Cloud Run with CPU always allocated and a minimum instance count | The truth is already in rows (`nextWakeAt`, `jobs`), so the queue is the table, and `SELECT … FOR UPDATE SKIP LOCKED` is an atomic claim. **No Cloud Tasks at first**: a push queue adds a second source of truth and a second failure mode for something Postgres does in one statement. Each worker is its own dispatcher; there is no separate dispatcher service to keep alive. |
| Database | **Cloud SQL for PostgreSQL**, private IP | The store is already all-async behind an interface (§5). Managed backups and PITR are the reason not to run it ourselves. |
| Secrets | **Cloud KMS** envelope encryption for tenant secrets in rows; **Secret Manager** for the platform's own | Tenant secrets are many and per-row; platform secrets are few and per-deployment. Different tools for different shapes. |
| Sign-in | **Identity Platform** (email, Google, later SAML) | Sessions for the dashboard; the API also takes org-scoped tokens for the CLI and CI. |
| Billing | **Stripe** Billing + Checkout + customer portal, webhooks → `orgs.plan` | Not worth owning. |
| Egress | **Direct VPC egress → Cloud NAT with static addresses** | Customers allowlist us; the in-process guard (§4.7) is the other half. |
| Telemetry | OpenTelemetry → Cloud Logging, Monitoring, Trace | One trace per visit, tagged by org, run and person. |
| Files | **Cloud Storage** for rendered digests and exports | Replaces `digestDir`. |

**The escape hatch is GKE Autopilot for the worker pool.** Cloud Run is chosen because it keeps
the operational surface small for a small team, and it satisfies two of the three properties a
worker runtime needs — CPU while idle and egress through NAT. The third, *minutes of termination
grace*, it does not give: a revision being replaced gets a SIGTERM and seconds. §4.5 has the
drain protocol that works around this. If that protocol proves brittle in practice, the worker
moves to Autopilot, which gives all three natively, and nothing else in this document changes.

**Local mode does not change.** `SqliteStore`, `LocalDaemon` and the in-process `JobRunner` stay
exactly what they are; the hardening in C0 makes them safer on the laptop too.

## 4. How people visit in the cloud

This is the section the roadmap calls the hard part. It is hard because a visit is not a
request: it runs for minutes, it spends money on every turn, it mutates the customer's product,
and it must not run twice. Everything below follows from those four facts.

### 4.1 The truth is in the rows, and the queue is the table

An execution's state is its `runs` row plus its agents' `nextWakeAt` and lease columns. There is
no in-memory `active` map. `RunController` becomes a set of functions that read and write rows:

- **start** writes the run and snapshot, resets the target if ephemeral, runs `reconcile()` (which
  writes the people's first `nextWakeAt`) and returns. Nothing ticks. The people are due; a
  worker will find them.
- **pause** writes `status: paused` and `nextWakeAt: null` on every active agent. A worker
  mid-visit finishes that visit and reschedules nothing, because the run is not `running`.
- **stop now** writes a scoped stop row (§4.6); visits in flight observe it between turns exactly
  as they observe the kill switch today.
- **resume** writes `running` and runs `reconcile()`, which books a next visit for everybody with
  none.
- **round** brings `nextWakeAt` to now for agents that are *not leased*.

The `agents` row splits its one JSON column into runtime columns — `status`, `next_wake_at`,
`wake_count`, `identity_id`, `lease_id`, `lease_expires_at`, `version` — and a `json` column for
the configuration half. Runtime writes are column updates guarded by `version`; `reconcile()`
merges configuration; the two stop racing because they no longer touch the same bytes.

### 4.2 The claim is one statement, and the lease is explicit

```sql
UPDATE agents SET lease_id = $worker_lease, lease_expires_at = now() + interval '15 minutes'
WHERE (run_id, id) IN (
  SELECT a.run_id, a.id FROM agents a
  JOIN runs r ON r.id = a.run_id
  WHERE a.status = 'active' AND a.lease_id IS NULL AND a.next_wake_at <= now()
    AND r.status = 'running'
    AND <org and target concurrency predicates, §4.6>
  ORDER BY a.next_wake_at
  FOR UPDATE SKIP LOCKED LIMIT $free_slots
)
RETURNING *;
```

`listDueAgents(runId, now, limit)` becomes `claimDueAgents(leaseId, now, limit)`: across runs,
atomic, and returning what it claimed. The worker heartbeats `lease_expires_at` every minute
while the visit runs; a lease that expires is a worker that died, and the row is claimable
again. A lease is released by the visit's `finish()`, which also writes `next_wake_at` from
`Scheduler.nextWakeAt` — the same `CadenceScheduler`, unchanged (ADR-0019).

Locally, `LocalDaemon.tick()` calls the same `claimDueAgents`. SQLite has no `SKIP LOCKED`, and
does not need it: one process, one event loop. The interface is the same and the semantics —
claim is atomic, a lease has an expiry — are what the conformance suite asserts against both.

### 4.3 A visit is not idempotent

A queue's instinct is to retry. A visit must not be retried blindly: past the first model call
it has spent money, and past the first tool call it has changed the customer's product. So:

- A visit that fails **before turn one** (could not connect, credential could not be renewed,
  guardrail refused it) is a normal ending today (`auth-failed`, `killed`, `budget-exceeded`) and
  stays one. It is rescheduled by cadence, not retried.
- A visit whose worker **died mid-way** is found by lease expiry. Its `wakes` row says `running`
  with an `endedAt` of null. The reconciler marks it `error: worker lost` and lets cadence book
  the next visit. What the person learned up to that point survives, because `remember` already
  saves memory on every call rather than at the end (`wake.ts`); the trace has everything up to
  the last turn. **The visit is not replayed.**
- Duplicate delivery cannot happen by construction: there is no delivery, there is a claim, and
  a claim is a row update that either happened or did not.

The trace is the whole transcript of a visit — every model turn and tool call in order. A lost
visit could in principle be *resumed* from it by rebuilding `messages` and continuing. That
touches `runWake` and is deliberately not in this plan; it is noted as the one thing that would
turn "worker lost" from a lost visit into a paused one.

### 4.4 A fourth ceiling: time

ADR-0009 gives a visit three ceilings — tokens, dollars, turns — checked in the runner after every
model call. The cloud adds a fourth, wall-clock, for the same reason and in the same place: a
target that hangs or a model that stalls is otherwise a worker held until the turn ceiling is
reached one timeout at a time. `WakeOptions` gains `deadline`, the loop checks it beside the
others, and the ending is `budget-exceeded` with `time` as the rule. It is the one addition to
the runner's surface in this plan, and it is a guardrail, which is the runner's job.

### 4.5 Deploys drain; they do not interrupt

A worker that receives SIGTERM with a visit in flight has seconds on Cloud Run. So a deploy is
not a revision swap; it is:

1. write `control.drain = <current revision>`;
2. workers of that revision stop claiming, finish what they hold, release their leases and exit
   their loop;
3. when no lease is held by that revision, swap the revision.

It is a small protocol, and it is what makes Cloud Run acceptable for minutes-long work. If it
turns out to be the thing that pages somebody at 2am, the worker moves to Autopilot (§3) and the
protocol becomes a `terminationGracePeriodSeconds`.

### 4.6 Blast radius: stop, concurrency, spend

- **Stop is scoped.** The one `control.kill` row becomes `stops(scope_kind, scope_id, reason,
  at)` with scopes `run`, `project`, `org` and `platform`. `killSwitchReason(store)` takes the
  agent's run and walks up; a visit sees a stop at any level. "Stop everything now" on a run
  screen stops *that run*. The platform scope is ours, for an incident. This closes the gap the
  ADR-0022 amendment has carried open.
- **Concurrency is per organisation and per target.** The claim predicate counts leases held per
  org (from the plan's limit) and per target (a population must never flood one customer's app:
  a target-level cap, default small, settable). Both are `WHERE` clauses on the claim, not
  policy in a loop.
- **Spend is a ledger with three scopes.** `costSince` keeps its interface and gains `orgId`;
  `dailyCeilingBreached` checks population, then project, then org, and the org ceiling comes
  from the plan. For the managed-key tier (§7) there is a platform ledger as well, and it is the
  one that can stop a worker claiming at all.
- **The model provider is per organisation.** `WakeDeps.provider` is already injected per run,
  so this is a resolution change, not a runner change: the worker decrypts the org's key at
  claim time and builds the provider for that visit. A 429 with the SDK's retries exhausted is
  not an `error` ending; the visit is released unstarted and `next_wake_at` moves out by a
  backoff, so one organisation's rate limit is one organisation's problem.

### 4.7 The network, from the worker's side

- **Egress guard, in-process.** One `fetch`/agent used by the MCP transport, the reset hook,
  OAuth discovery and `fetch_page`: resolve the hostname, refuse loopback, link-local
  (`169.254.0.0/16`, including the metadata address), RFC 1918, ULA and the `metadata.google.internal`
  name, and connect to the address that was checked, not to a name that could resolve differently
  a moment later. Redirects go through the same check. This is the fix for §2.6 and it is
  independent of GCP.
- **Network policy, out of process.** The worker's VPC egress allows the internet and Cloud SQL
  and nothing else in the project; its service account can decrypt tenant secrets and write to
  the bucket and nothing else. Neither the API's nor the worker's identity can reach the other's
  secrets.
- **Static addresses.** Cloud NAT with reserved IPs, listed on the org's target screen so a
  customer can allowlist populace at their edge.
- **A target has to be yours.** Before a population is sent at an address that is not the
  sandbox target, the org proves it controls it: a token at `/.well-known/populace.txt`, a DNS
  TXT record, or — for `provision-url` targets — a kit that answers with the org's id. Without
  this the product is a bot farm anybody can aim at anybody. The sandbox target (Tasklet, hosted
  by us) is exempt and is the free tier's playground.
- **Isolation stance.** Workers run no customer code: a visit is model calls and HTTP calls. That
  is what makes a shared worker pool acceptable, with the container's own sandbox as the floor.
  The stance is recorded as a decision so that a future feature that *would* run customer code
  (a custom verifier, a scripted person) is recognised as a change of tier, not a feature.

### 4.8 Jobs become data

`jobs` gains a `params` column, a zod schema per `kind`, and a handler registry keyed by kind
that both the local `JobRunner` and the worker pool consult. `run.start` carries a simulation id
and options; `digest` a run id; `sweep` a run id and its options; `people.generate` a cohort id.
The API enqueues and answers with the job id, as it does today; what changes is that the process
answering is never the process working. The ADR-0027 amendment's fifteen-second wait on
`run.start` — the route waiting for the row to exist — goes away, because starting a run is
writing rows and no longer waits on a queue.

The verifier's replay, the digest build and the sweep are all jobs that connect to the target,
so they run on workers, through the egress guard, with the org's provider.

## 5. Data: Postgres behind `Store`

- **`@populace/store-postgres`** implements the same `Store`. The row shape stays what SQLite's
  is — a `jsonb` blob plus lifted columns for keys, indexes and sums — because the schemas are
  zod and the blob is what makes adding a field cheap. Runtime columns are lifted where §4.1
  says so. The driver is `postgres` (postgres.js) or `pg`; either is fine, and the store is the
  only package that imports it.
- **A conformance suite** in `packages/core` (or a `store-tests` package) runs every store
  behaviour — including the claim/lease semantics, cost sums, event ordering and the query-count
  budget for the read model's hot paths — against both implementations. Postgres runs in CI from
  a container. This suite is what keeps local and hosted honest with each other, and it is the
  first thing C1 writes.
- **Migrations first (D5).** A migration runner with numbered SQL files per store, applied on
  open, replacing `SCHEMA_SHAPE`'s drop-and-rebuild. The roadmap's trigger — the first database
  outside this repository holding a target somebody typed — is met by definition on the day a
  hosted database exists, so this is a C0 item, and it lands for SQLite too.
- **Tenancy in the rows.** `orgs`, `org_members`, and `org_id` on `projects`, denormalised onto
  every high-volume table (`runs`, `agents`, `wakes`, `trace_events`, `findings`, `identities`,
  `events`, `jobs`). Every store method that lists takes the org; row-level security on every
  tenant table with the org set per connection is the belt to the application's braces.
- **The event cursor.** One `event_cursor` row hands out `seq` under `UPDATE … RETURNING`, so
  `seq` is commit-ordered and the SSE cursor and `afterSeq` keep their meaning. Appends serialise
  on that row; at populace's event rate that is not a bottleneck, and if it becomes one the
  answer is a cursor per org, not a different mechanism.
- **Volume and retention.** `trace_events` holds every tool argument and result. Partition it by
  month; retention per plan; a scheduled job that drops partitions older than the org's
  retention and archives digests to the bucket. Backups and PITR are Cloud SQL's. Org export
  (everything the org owns, as JSON and the YAML the config export produces) and org delete are
  jobs, and the delete is the one cascade in the store (`deleteProject`, lifted a level).
- **Local to cloud is an import, not a sync.** The R2 YAML export is how an authored project
  moves up; runs do not move. There is no bidirectional sync and this plan does not want one.

## 6. The API platform

- **Authentication.** Hono middleware in `@populace/server`: Identity Platform sessions for the
  dashboard (cookie, `SameSite`, CSRF token on mutations — ADR-0023's "no cookie before M5"
  ends here), and org-scoped bearer tokens (`POST /orgs/:o/tokens`, shown once, hashed at rest)
  for the CLI and CI mode. Every route is under an org; `projectId` is no longer the top of the
  chain. The loopback rule stays for local mode, and the non-loopback token rule ADR-0023 wrote
  is finally implemented by the same middleware.
- **Authorization.** `owner`, `admin`, `member`, `viewer` per org; invites by email; an
  `audit_log` of control actions (start, stop, resume, secret changes, token issuance, plan
  changes) that an admin can read.
- **Hardening.** Request body limits, per-token rate limits, idempotency keys on the POSTs that
  start something (`run.start`, `people.generate`), and `/api/v1` treated as a public contract
  from the first external user: additive changes only, deprecations announced, `contract` the
  single source of truth as it already is.
- **The read model.** `project-read-model.ts` and `read-model.ts` stay as they are; they read
  rows. The one change is that the counts they compute per request (digests and clusters are
  "computed per request, deliberately") get persisted per run on workers once the org count
  makes per-request computation the API's hottest path. DATA-MODEL §7 already reserves that.
- **The CLI becomes a client.** `populace` gains `login` and `--remote`, and `run`, `digest`,
  `status`, `sweep` call the API under a token when remote. `serve` stays what it is. This is R4
  and the R3 "unattended running" question both answered by the same thing: a hosted org's
  longitudinal simulation runs because workers run, not because a laptop is open (D6).

## 7. Accounts, subscriptions, billing

**Bring your own key at launch (D4).** An org saves an Anthropic key on its settings screen; the
API validates it with one cheap call, envelope-encrypts it under a per-org KMS key, and stores
the ciphertext. A worker decrypts it at claim time, holds it for the visit, and never logs or
persists the plaintext. Spend is the customer's, on their Anthropic bill; populace still meters
it from `usage` on every visit so the org sees it, the ceilings work, and the plan's limits mean
something. The org's key never leaves the worker; it is not in a snapshot, an event or a trace
(that is already true of `model.apiKey` by redaction; it becomes true by construction when
secrets are refs, §8 C0).

**Plans are priced on the platform, not the tokens.** Placeholder shape, to be decided at C4:

| Plan | For | Limits (illustrative) |
| --- | --- | --- |
| Free | Trying it on the sandbox target | Sandbox target only; 1 project; small population; ephemeral only; 7-day retention |
| Team | A product team on their own app | N projects; verified targets; longitudinal; concurrency and org ceiling; 90-day retention |
| Business | Several teams, compliance asks | SSO/SAML; audit export; static egress IPs; higher caps; 1-year retention; DPA |

Limits are enforced where they bite — the claim predicate for concurrency, the ledger for spend,
the API for counts — and never in the runner.

**Stripe** owns the subscription: Checkout to start, the customer portal to change, webhooks
(`customer.subscription.*`) to set `orgs.plan`, a grace state for a failed payment that pauses
new executions without deleting anything.

**The metered managed-key tier comes later, and only after two things exist:** prepaid credits
or a hard org ceiling the *platform* enforces (a runaway population on our key is our bill), and
a platform-owned price table with `usage` token counts as the metered truth (§2.4 says why
`cost_usd` cannot be). Usage records go to Stripe metered billing per visit; margin is a number
in one place. The provider resolution in §4.6 already makes "whose key" a per-org fact, so the
tier is a settings choice and a ledger, not an architecture change.

## 8. Phases

Each phase is shippable on its own and each has a "done when". C0 is the one that pays for
itself even if nothing else happens: it is the hardening the ADR-0022 amendment already asked for.

### C0 — A control plane that could share a database *(local, no cloud)*

- The migration runner, for SQLite first (D5).
- `jobs.params` and the handler registry (§4.8).
- The agent row split, `claimDueAgents` with leases, `version`-guarded runtime writes (§4.1, §4.2).
- Scoped stops replacing the one kill row (§4.6), and the run-scoped stop the dashboard already
  wants.
- The wall-clock ceiling (§4.4).
- Secrets behind a `SecretBox`: `{ ref }` in config where a string is today, a `secrets` table,
  a local implementation keyed by a file the CLI generates, redaction by construction rather
  than by regex.
- The egress guard (§4.7), on by default with loopback allowed locally.
- `RunController` stateless: run state in rows, `reconcileOrphans` becomes lease expiry.
- The `Store` conformance suite, run against SQLite.

*Done when:* the local product is unchanged from the outside; two `serve` processes against one
database would not double-visit anybody; a snapshot cannot contain a secret because the type
does not allow one.

### C1 — Postgres

- `@populace/store-postgres` passing the conformance suite; Postgres in CI.
- `populace serve --database-url` runs the whole local product against Postgres.
- The commit-ordered event cursor; batch methods for the hot N+1s.

*Done when:* the reports tests find all four of Tasklet's planted defects against Postgres.

### C2 — Split processes, private deployment

- `populace worker`: the claim loop, the handler registry, heartbeats, the drain protocol.
- API and worker images; Terraform for Cloud Run, Cloud SQL, KMS, NAT, buckets; a deploy pipeline
  that drains before it swaps.
- Per-org provider resolution and the platform stop scope, even though there is one org.
- Single-tenant, one operator: a private deployment used for real runs.

*Done when:* a longitudinal simulation runs for a week with nobody's laptop open, and a deploy in
the middle of it loses no visit.

### C3 — Accounts and tenancy, private beta

- Identity Platform, orgs, members, roles, tokens, the audit log; RLS on tenant tables.
- Target ownership verification; static egress IPs on the target screen.
- Retention jobs; org export and delete.
- Design partners on the private deployment.

*Done when:* a stranger can sign up, verify their own target, run a simulation, and never see
another org's anything — asserted by tests that read raw response bodies across two orgs, the
way the person-name seam is asserted today (WEB-ARCHITECTURE §5).

### C4 — Billing and launch

- Stripe subscriptions, plan limits, BYOK onboarding, the usage screen.
- The launch gate that is not code: terms, privacy, DPA, status page, on-call basics, a security
  write-up that says what §4.7 says.

*Done when:* somebody we do not know pays.

### C5 — Later

- The managed-key metered tier (§7). SSO/SAML. Regional data residency. A self-hosted image for
  enterprises (the same two processes, their Postgres). Persisted digests and clusters. The
  trace-as-checkpoint resume for lost visits (§4.3). Cloud Tasks if scale-to-zero workers ever
  matter more than the simplicity of the poll.

### How this sits against the roadmap's rungs

R1 (the returning verdict) and R2 (export) stay ahead of all of this; they are the product. C0
can interleave with them because it is local hardening with local benefit. C1 onward is R5.
D5 is answered: the migration runner is C0. D6 is answered: unattended running is the worker
pool, not a local service.

## 9. Costs, risks, open decisions

**Running cost at idle** is Cloud SQL plus one always-on worker plus the API's minimum; it is a
few hundred dollars a month before the first customer and should be stated as such in the
business case. Model spend is the customer's under BYOK.

**Risks, named:**

- The trace holds the customer's data — whatever their product returned to a person's tool call.
  It is encrypted at rest by Cloud SQL, scoped by RLS, retained by plan, and exportable and
  deletable by the org. It is still the most sensitive thing populace holds and the reason the
  security write-up exists.
- Target verification is the abuse control. Without it, a paid account is a way to aim a
  population at somebody else's product. It is in C3, before any stranger can run.
- The drain protocol is the piece most likely to be operationally annoying. The escape hatch
  is decided in advance (§3) so that switching is a redeploy, not a redesign.
- Per-org Anthropic rate limits vary by the customer's tier. The backoff in §4.6 keeps it their
  problem; the usage screen has to say so in words when a population is being throttled.

**Open, to be decided at the phase that needs them:**

- Pricing and plan limits (C4). The table in §7 is a shape, not a proposal.
- Whether the dashboard is served by the API image or from a bucket (C2; either).
- Whether the OSS CLI and the hosted product share a version line or the hosted product runs
  ahead (C3).
- The static-pool and firebase-admin file inputs: rows, or an upload to the bucket (C1).

## 10. ADRs this plan will produce

Each is written when its phase starts, not now; the decisions above are the drafts.

- Jobs are data: `params` per kind and a handler registry (C0).
- Leases, claims and the agent row split (C0).
- Stops are scoped (C0; amends ADR-0022).
- The wall-clock ceiling (C0; amends ADR-0009).
- Secrets are references (C0).
- The egress guard and target ownership (C0/C3).
- `@populace/store-postgres` and the migration runner (C1; amends ADR-0011).
- The commit-ordered event cursor (C1; amends ADR-0026).
- The worker pool polls Postgres; the drain protocol (C2).
- Organisations, membership, tokens and RLS (C3).
- Bring your own key, plans, and the metered tier's preconditions (C4).

## 11. What does not change

`runWake()`'s body, apart from a fourth ceiling checked where the other three are. The reporter
toolset and the rule that findings and memory exist only through it (ADR-0007). Evidence by call
ref and the verifier's replay (ADR-0014, ADR-0015). Clustering and signatures (ADR-0017,
ADR-0028). Run lineage and carry-forward (ADR-0020). The contract package and the dashboard, which
read the same shapes off the same routes with an org in the path. Ephemeral and longitudinal
(ADR-0030). The chain (ADR-0029), with an organisation above the project. And the promise the
product does not make: nothing here makes two executions produce the same result, and nothing
here may say so.

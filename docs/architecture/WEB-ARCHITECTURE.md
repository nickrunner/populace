# Web architecture

How populace becomes a web product without changing what makes it work. This is the map for
everything above the wake loop; `docs/ARCHITECTURE.md` is still the map for the wake loop itself,
and nothing here is allowed to contradict it.

Input: `docs/product/ROADMAP.md`. Decisions are recorded as ADRs 0021 onward.

---

## 1. The invariant everything else is arranged around

> `runWake()` does not change.

The roadmap says it plainly for M5 ("if M5 requires touching `runWake()`, something earlier went
wrong") and it is just as true for M1–M4. A wake is already a pure-ish function of
`(agent, memory, identity, target, config)` over the `Store` and `Scheduler` interfaces
(ADR-0003, ADR-0004). Every addition below sits *beside* that function:

- The web app is a **reader** of what the store already holds (M1).
- The control plane is a **caller** of the same daemon the CLI calls (M2).
- Authoring is a **producer** of the same `PopulaceConfig` object the YAML file produces today
  (M2, ADR-0024).
- Cloud is a **different implementation** of `Store` and `Scheduler` (M5).

The concrete test: if a change would make the runner aware of HTTP, of a user, of a project, or of
where its config came from, it is in the wrong layer.

## 2. Packages

Two new packages, and the dependency direction stays strictly downward.

```
cli ────────► server ──► reports / runner / adapters / store-sqlite ──► core
                │                                                        ▲
                └──► contract ◄──────────── web ─────────────────────────┘
                                                              (types only)
```

| Package | What it is | Depends on |
| --- | --- | --- |
| `@populace/contract` | The HTTP wire format: a zod schema per request and response, the route table, and the SSE event union. No I/O, no Node built-ins — it is imported by both sides. | `core` |
| `@populace/server` | The HTTP API, the job runner, the SSE hub, and static hosting of the built dashboard. Owns the store process-wide. | `contract`, `core`, `runner`, `reports`, `store-sqlite`, `adapters` |
| `@populace/web` | The dashboard: a React SPA built by Vite. Ships as static assets inside `server`'s package at build time. | `contract`, `core` (types) |

`cli` gains one command, `populace serve`, which starts `server`. It keeps every command it has
today.

### Why `contract` is its own package

The alternative is exporting request/response schemas from `server` and importing them in `web`,
which makes the browser bundle depend on a package that imports `node:sqlite`. A separate
dependency-free package is the cheapest way to keep one definition of the wire format while
keeping the browser build clean. It is also the artifact an M4 CI client or an M5 SDK consumes.

### Core has to be isomorphic

`@populace/core` is pure schemas and pure functions except for two `node:crypto` imports
(`ids.ts` uses `randomBytes`, `population.ts` uses `createHash`). `contract` and `web` need core's
schemas at runtime, in a browser. The fix is small and is M1 work: `randomBytes` becomes
`globalThis.crypto.getRandomValues` (present in Node 22 and every target browser) and the seeded
sampler's `createHash` moves behind an explicit import boundary so it is not pulled in by a schema
import. A lint rule forbids new `node:` imports in `core`.

## 3. Stack

| Concern | Choice | Why |
| --- | --- | --- |
| API framework | **Hono** on `@hono/node-server` | Tiny, typed, no decorators or DI. Its handlers run unchanged on Node, on a container and on an edge runtime, which is the M5 seam. Alternatives: Express (untyped, unmaintained middleware), Fastify (heavier, node-only), hand-rolled `node:http` (routing, SSE, ranges and static serving are all code we would own for no benefit). |
| Validation | **zod at every boundary** | ADR-0002, unchanged. Every request body and query, and every response, is parsed against a `contract` schema. |
| Live updates | **SSE** with a resumable cursor | The flow is one-directional; control actions are plain POSTs. SSE reconnects itself, survives proxies, and `Last-Event-ID` maps exactly onto the monotonic event cursor (ADR-0025). WebSockets buy bidirectionality we do not need. |
| UI framework | **React 19 + Vite + TypeScript** | The largest hiring pool and the one the design thread's output translates into most directly. Vite because the repo is already ESM and `tsc -b`. |
| Routing / data | **React Router** + **TanStack Query** | Query gives cache, refetch and invalidation; in M2 an SSE event invalidates a query key rather than hand-rolling state sync. |
| Styling | **Tailwind v4** plus local primitives | Design output is layout-heavy. Tailwind keeps implementation close to the spec without a component library whose opinions fight it. Component primitives (dialog, popover, menu) come from Radix, styled locally. |
| Tests | **vitest** everywhere | API tests drive real wakes against the mock target with `ScriptedProvider` and assert on API responses, exactly as runner tests assert on the trace. Component tests use React Testing Library. Browser-level E2E is deferred to M2, where there is a flow worth driving end to end. |

Nothing above needs a network service, an account, or a hosted anything, per the roadmap's
local-first rule.

## 4. Process model

**One process owns the store.** `populace serve` starts the HTTP server *and* hosts the daemon
tick loop in-process.

This is forced by `node:sqlite` (ADR-0011): `DatabaseSync` is synchronous and a second writing
process means `SQLITE_BUSY` under exactly the conditions we want to be reliable — a run in flight
while someone clicks in the browser. So:

- `populace serve` takes an advisory lock (a row in `control`) naming the pid and start time.
- A second `serve`, or a `populace run` against the same database, refuses to start and says which
  process holds it. `--force` breaks a stale lock.
- Read-only commands (`status`, `digest` over an existing run) do not take the lock.

```
populace serve
   │
   ├── Hono app ──► /api/v1/*           JSON, zod-validated both ways
   │              └ /api/v1/events      SSE, resumable
   │              └ /*                  the built dashboard (SPA fallback)
   │
   ├── JobRunner ──► starts/stops LocalDaemon, digests, target validation   (ADR-0026)
   │
   └── Store (SQLite) ── the single writer
```

In M5 this diagram splits at the JobRunner: the API keeps its handlers, jobs become queue
entries, and hosted workers call the identical `runWake()`. The `Store` becomes Postgres. Nothing
above the seam knows.

## 5. The API

`/api/v1`, REST-shaped, JSON, one zod schema per payload in `contract`.

Not tRPC: it couples the client build to the server build and leaves M4's non-interactive CI mode
without a plain HTTP surface. Not GraphQL: the query shapes here are few and known.

```
GET    /runs                        run summaries, newest first
GET    /runs/:id                    one run, with lineage (parent and children)
GET    /runs/:id/agents             agents with wake counts, status, last wake
GET    /runs/:id/wakes              wake rows, filterable by agent
GET    /wakes/:id                   one wake
GET    /wakes/:id/trace             the full ordered trace
GET    /runs/:id/findings           findings, filterable by kind/severity/verdict
GET    /findings/:id                one finding, with reproduction and verification
GET    /runs/:id/digest             the digest read model: clusters, totals, coverage gaps
GET    /runs/:id/spend              cost rollups by agent, persona and day
GET    /target                      the configured target and its tool list
GET    /health                      version, store path, lock holder, kill-switch state
```

M1 is exactly the above and is read-only. M2 adds `POST /runs`, `POST /runs/:id/stop`,
`POST /runs/:id/wakes`, `POST /kill-switch`, `POST /jobs/digest`, the persona and target
authoring routes, and `POST /targets/:id/validate`. M3 adds `PATCH /clusters/:signature/triage`,
`GET /runs/:a/compare/:b` and `POST /runs/:id/revalidate`.

### Binding and access

The server binds `127.0.0.1` by default and refuses any other host without an explicit
`--host` flag *and* a token. This is not ceremony: the process holds an Anthropic API key and can
spend money on request. There is no cookie authentication at any point before M5, so there is no
CSRF surface to get wrong (ADR-0022).

### Pagination

Traces are the large object here — a busy wake produces hundreds of events with full tool
arguments and results. Trace and finding endpoints are cursor-paginated on the same monotonic
cursor the SSE stream uses, so "load the rest of the trace" and "follow the trace live" are the
same query with a different starting point.

## 6. Live updates

One SSE endpoint, `/api/v1/events?after=<cursor>&run=<runId>`, carrying a discriminated union of
event types declared in `contract`: `run.*`, `wake.*`, `trace.*`, `finding.*`, `job.*`,
`guardrail.*`.

The cursor is a store-level monotonic sequence over an append-only `events` table (ADR-0025).
Because it is persisted rather than in-memory:

- A reconnecting browser replays what it missed instead of showing a gap.
- The trace viewer uses one code path for a finished wake and a running one.
- M5's hosted runners and API servers are different processes, and the log is how they meet.

M1 does not write this table (the roadmap holds M1 to no new persisted data). M1's trace viewer
reads `trace_events` directly and polls. M2 introduces the event log, and the trace viewer's
"live" mode is then the same component with a live cursor.

## 7. Build and distribution

- `pnpm build` stays `tsc -b`; `@populace/web` adds a Vite build that writes to
  `packages/server/public/`. One extra script, wired into the existing `build`.
- `populace serve` serves those assets with an SPA fallback. A user runs one command.
- In development, `pnpm dev` runs Vite with `/api` proxied to the server so the dashboard hot
  reloads against a real store.
- `pnpm check` (lint + build + test) stays the single CI gate.

## 8. Build order

Per milestone, what lands where. Milestone content is the roadmap's; this is only the layering.

**M1 — read-only.** `contract` + `server` with the read routes above, `web` with the run list,
run overview, digest screen, findings list, finding detail and the wake trace viewer. Core made
isomorphic. Run summaries are *derived*, not stored (see `DATA-MODEL.md` §3). Done when both
roadmap acceptance clauses pass against the mock target.

**M2 — control and authoring.** The event log and SSE. The job runner. The daemon hosted in
`serve`. Config entities become rows and the database becomes the source of truth (ADR-0024,
pending Nick's confirmation of D3). The target wizard, persona editor and starter library. Cost
estimation before a run starts. This rung is roughly twice any other and is split by surface
depth if it must split, never by audience.

**M3 — the loop.** Cluster signatures persisted, triage state attached to them rather than to
finding rows (ADR-0027), run comparison, "re-run the people who complained" as a job over
`--continue-from`, GitHub issue export, a shareable digest.

**M4 — many targets.** Projects become real, targets get a library, runs get schedules, and a
non-interactive CI mode consumes the same API.

**M5 — cloud.** `@populace/store-postgres` behind the existing `Store` interface, an external
scheduler behind `Scheduler`, hosted runners pulling jobs, accounts and tenancy in `server`,
secrets out of the config rows. The runner is untouched.

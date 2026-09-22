# Architecture

populace deploys a scalable population of persona-seeded AI agents against any
application that exposes a rich MCP server. Agents behave like prospective users:
they discover the app through its tools, decide whether it is for them, sign up
or receive an identity, use it, and come back on a schedule. Their output is
structured findings that a report pipeline verifies, dedupes, clusters and
renders into a digest for a product team.

This document is the map. Each fixed decision has an ADR in `docs/adr/`.

The web product above this — the HTTP API, the dashboard and the data model they need — is mapped
in `docs/architecture/WEB-ARCHITECTURE.md` and `docs/architecture/DATA-MODEL.md`, against the
roadmap in `docs/product/ROADMAP.md`. Nothing there changes the wake loop described below; that is
the point of the split (ADR-0021 through ADR-0028).

## Vocabulary

| Term | Meaning | Where it lives |
| --- | --- | --- |
| **Target** | The app under test: one or more MCP endpoints (Streamable HTTP, bearer auth), optional web base URL, optional product description. | `@populace/core` `TargetSchema` |
| **IdentityProvider** | Adapter yielding credentials for a persona. Strategies: `self-signup`, `admin-mint`, `static`. All support `teardown` and `listByTag`. | interface in core, implementations in `@populace/adapters/*` |
| **Project** | What scopes authoring: targets, personas, cohorts, populations, simulations, settings and triage belong to one and are never shared. | core `ProjectSchema` |
| **Persona** | Static description: role, traits, goals, patience, budget, constraints, backstory. A template with no headcount. | core `PersonaSchema` |
| **Cohort** | N people on one persona. Owns the headcount (`size`), the seed, and cadence / visit-cap overrides. There is no scale factor. | core `CohortSchema` |
| **Person** | A durable individual in a cohort, `cohortSlug#ordinal`, with a stored name, detail line and handle. Written once, never silently overwritten. | core `PersonSchema` |
| **Population** | Composition and nothing else: an ordered set of cohorts. Its size is the sum of theirs. | core `StoredPopulationSchema`, `expandPopulation()` |
| **Simulation** | A population, a target and a mode — `ephemeral` (clean slate, bounded) or `longitudinal` (accumulating, unbounded). What a user presses go on. | core `SimulationSchema` |
| **Run** | One execution of a simulation, carrying `simulationId` and a `seq` counting from 1, plus the config snapshot it froze. | core `RunSchema`, `runs` table |
| **Agent** | A persona instance with a person's name, an identity, persistent memory and a schedule. **The wire calls it a participant** (ADR-0032). | core `AgentSchema`, rows in the store |
| **Wake** | One scheduled execution of an agent — **a visit**, on the wire and on every screen. A stateless job: load memory, run one session, persist memory/trace/findings/cost, exit. A wake that ends in `give_up` retires the agent. | `@populace/runner` `runWake()` |
| **Trace** | Ordered log of one wake: every tool call, model turn, token usage, dollar cost. | core `TraceEventSchema`, `trace_events` table |
| **Finding** | Structured report item (`bug`, `friction`, `coverage-gap`, `suggestion`, `abandonment`, `praise`) carrying the exact tool calls that led to it. | core `FindingSchema` |
| **Digest** | Verified, clustered findings over a window, rendered for humans. | `@populace/reports` |
| **Runner / Scheduler / Store** | Executes wakes / decides when / persists. | runner, core interfaces, `@populace/store-sqlite` |

## Packages

```
packages/
  core          vocabulary types + zod schemas, Store/Scheduler/IdentityProvider
                interfaces, run ids and tagging, population expansion, pricing
  runner        wake loop, MCP client wrapper with interception, reporter
                toolset, memory, guardrails, trace writer, model provider
  adapters      identity providers: self-signup, static, firebase-admin
                (each on its own subpath so provider SDKs stay optional)
  store-sqlite  Store implementation on node:sqlite
  reports       verifier, dedup/clustering, digest renderer, exporters
  cli           init, validate, run, wake, scale, digest, sweep, kill
  mock-target   reference app with its own MCP server, self-signup and
                planted defects; all development and CI runs against it
examples/       a three-persona population config for the mock target
```

Dependency direction is strictly downward: `cli -> reports/runner/adapters/store-sqlite -> core`.
`mock-target` depends on nothing in the workspace.

## The wake

A wake is the unit of everything. It is a pure function of
`(agent, memory, identity, target, config)` that produces
`(trace, memory', findings, cost, identity')`. There is no long-lived agent
process; a local daemon and a cloud job both just call `runWake()`.

```
 load agent, persona, memory, identity     (Store)
      |
 connect MCP client (+ bearer if identity) (McpSession)
      |
 list tools -> target policy + persona policy, merged (guardrails)
      |
 system prompt = persona + behaviour        stable, cached
 tools        = target tools + reporter     stable order, cached
 model/effort = persona override or global  resolveModel()
 user turn 1  = wake context: wake #, date, memory, identity state, goals
      |
 +--> stream model call, finalMessage()     (ModelProvider)  -> trace: model.call
 |         |
 |    guardrails: kill switch, per-wake token/$ ceiling, turn cap
 |         |
 |    for each tool_use block:
 |       reporter tool  -> runner handles (findings, memory, done/give_up)
 |       target tool    -> interceptor: denylist, destructive policy,
 |                         signup capture, call target, trace: tool.call
 |         |
 +--- append tool_result user turn (history is append-only)
      |
 persist memory, findings, wake row (status, usage, cost), trace
```

Every model call and every tool call is a trace event. If it is not in the
trace, it did not happen.

### Reporter toolset

Alongside the target's tools, every wake gets a runner-owned toolset:
`file_finding`, `give_up`, `remember`, `done`, and `fetch_page` when the target
has a web base URL. These are the only way findings and memory are produced
(ADR-0007). One `file_finding` covers every finding kind; `kind` selects which.
The tools are not declared `strict` — the API's grammar-complexity budget
rejected the toolset outright — so the runner validates every reporter call
against its zod schema itself (ADR-0007 amendment).

Each target tool call is given a call ref (`c1`, `c2`, ...) that is echoed in
the tool result. `file_finding` takes `evidence_calls: ["c3", "c4"]`; the runner
resolves those refs into full tool-call records (name, arguments, result,
error flag) and stores them as the finding's reproduction steps (ADR-0015).

### Memory

Each agent has a memory document: free-form notes plus a structured slice
(`waitingOn`, `annoyances`, `done`). It is loaded into every wake and updated
only through the `remember` tool. This is what makes a returning user
different from a first visit (ADR-0008).

Memory is keyed by `(runId, agentId)`, so a new run starts every agent with
nothing. `populace run --continue-from <run id>` copies a parent run's memory,
accounts and wake counts into a new run and brings back the agents who gave up
but said they would return, which is how a shipped fix is validated against the
users who complained about it (ADR-0020).

### Guardrails

Guardrails live in the runner, not in the prompt (ADR-0009): per-wake token
and dollar ceilings, per-population daily dollar ceiling, a global kill switch
in the store, allow/deny lists of tool names, and a destructive-tool policy driven
by MCP tool annotations (`destructiveHint`).

A tool policy lives on the TARGET as well as on a persona, and the effective policy for a wake is
the two merged: deny wins, allow intersects, and the stricter destructive setting applies
(ADR-0033). A persona can take more away and can never put anything back, so a tool the target
forbids is unreachable whoever is wearing the costume — and a persona added later inherits the
target's floor rather than the whole surface. The merge happens in `runWake`, in the one loop that
decides which target tools reach the model at all.

### Your sign-in, which is not the population's

Some targets will not talk to strangers at all: they answer `401` with a `WWW-Authenticate` header
naming an OAuth authorization server, and no tool list can be read without getting in first. For
those, populace signs the USER in — RFC 9728 discovery, dynamic client registration, authorization
code with PKCE, refresh, all of it the MCP SDK's own client, kept in `sign_in_grants` and keyed by
`(project, address)` rather than by target, because signing in happens while connecting and there
is no saved target yet (ADR-0036).

**That grant is one human's account, and it never reaches a population.** `McpSession` takes a
sign-in provider as a third argument and only the callers acting as the user pass one — the
connection check and the tool list behind it. `runWake` passes an identity's bearer and nothing
else, and an explicit token wins over a provider inside `connect()`. How the STRANGERS a simulation
sends get accounts of their own is the next section, and it is a different mechanism on purpose:
signing in yourself does not mean a population can run.

Pressing Check registers nothing with anybody. A provider is handed to the check only for an
address already signed in to; a failed connection is followed by one read-only probe that reads the
`401` and the RFC 9728 document, so "could not reach it" and "it will not talk to strangers" are
different sentences on the screen. Registration happens behind the sign-in button and nowhere else.

### Identity

`IdentityProvider.provision()` runs before the session. For `self-signup` it
returns nothing and the agent signs up through the target's own tools; the
interceptor recognises the configured signup tool, extracts the credential from
its result and reconnects with the bearer token (ADR-0012). `static` reads a pool
of accounts that already exist from a JSON file, preferably keyed by cohort
(`{ "byCohort": { "<cohortSlug>": [ … ] } }`); person n of a cohort is always
handed entry n, which is the same in every process and after a restart, and a pool
too small — or an older persona-keyed pool that would serve two cohorts, which both
number their people from 1 — is refused when the run starts rather than wrapping
round and giving two people one login. Those accounts are not populace's, so a
sweep leaves them where they are and says so. `admin-mint` (Firebase Admin) creates a user with the run tag
in its custom claims, mints a custom token and exchanges it at Google's identity
toolkit for the ID token the target will actually accept — a custom token is not
an ID token, so the exchange is the path, not an extra, and a config with neither
`identity.apiKey` nor `identity.exchangeUrl` refuses to mint a session rather than
hand back a token the target will bounce. That refusal is raised where a session
is minted, not at construction, because `teardown` and `listByTag` go through the
service account alone: a sweep must still be able to delete the users a
misconfigured run left behind.

`provision-url` is the fourth, and the one to reach for on a product whose accounts are not made
through an MCP tool (ADR-0037). The app mounts `@populace/tdk`, implements one function that makes
a user, and populace calls it with one shared secret — holding no vendor credential at all. The
provider is the client half of that wire: it provisions, renews with whichever of the user id and
refresh token the app wants, tears down idempotently, and follows the listing's cursor to the last
page, because a sweep that stops at the first one reports success while leaving the rest of a large
run's accounts on somebody's product. Both halves are tested against each other rather than against
a fixture apiece, which is what caught populace's long-standing habit of building an email address
with a colon in the local part.

A credential is redeemable, not permanent. `Credential` carries `expiresAt` and a
`redeemable` (a refresh token, a ticket, a password), and a wake whose bearer is
expired or within ten minutes of it — a margin sized to a whole wake, not to an
instant — calls `IdentityProvider.refresh()` before it connects, off the
tool-dispatch path, so nothing about the renewal enters the transcript. Whether a
renewal is possible is the provider's question and not the schema's: Firebase can
mint a fresh session from the uid alone, so an identity whose exchange handed back
no refresh token is renewed too. When the target refuses a credential anyway —
at connect, where an HTTP-layer bearer is checked, or on three tool calls in a row
— the wake ends `auth-failed` rather than spending the rest of its budget on 401s.
A person whose credential carries no bearer at all ends the same way, because the
alternative is a session that silently falls back to the operator's own gateway
token and drives the target with the operator's privileges.
A redeemable outlives the bearer it mints, so it is treated as `bearerToken` is:
never on the wire, never in a config snapshot, never in a trace.

None of that is knowable from a form, so **first contact** does it for real before a run
(ADR-0034): with a target saved, one identity is provisioned through the configured strategy, one
READ-ONLY tool the target itself annotates `readOnlyHint` is called with it, and the account is
taken back down. It is a POST because it creates an account on somebody's product; it calls no
model, so it costs nothing. It distinguishes "could not reach the endpoint" from "could not
provision" from "provisioned and the target refused the token" from "it worked", and for
`admin-mint` it says outright that a refusal is the case where the product does not accept this
issuer's tokens. When the account cannot be removed — a pool populace never owned, a self-signup
target with no teardown tool — the result names the account that was left. No credential ever
reaches the result, the log or the stored row. The last result is kept on the target row so
preflight, which is a GET and must provision nothing, can block a start that would only rediscover
the same failure.

Every identity, wake and finding carries a run id (`run_...`) and a tag
(`populace:run_...`). `populace sweep` tears down identities by tag (ADR-0010).
The run's wakes, traces and findings are KEPT: the evidence is what the run was
for, and losing it is asked for by name with `--delete-data`. A provider that
declares `ownsAccounts: false` created none of the accounts it handed out, so
nothing is torn down and the sweep reports them as pre-existing instead of
counting a no-op as a removal. A provider that declares `cannotRemove` DID create
them and has no way to delete them — self-signup on a target with no
`teardownTool` — so those are counted apart, said in words, and they hold back
both the `sweptAt` stamp and `--delete-data`: the run's own rows are the only
remaining record of which accounts were left on the product.

## Reports

```
findings --> verifier --> verified findings --> cluster --> digest --> exporters
             (replay)                             (dedup)   (render)   (markdown)
```

- **Verifier**: a second agent replays a finding's reproduction steps against
  the target with the finding's identity, then a judge compares original and
  replayed results and marks the finding `confirmed`, `not-reproduced` or
  `inconclusive` (ADR-0014). The judge is a model call by default; a
  deterministic heuristic judge exists for CI.
- **Clustering**: findings are grouped by kind, primary tool and title
  similarity; each cluster picks a representative and counts personas and
  wakes affected (ADR-0017).
- **Digest**: Markdown first. Exporters are a plugin interface; Markdown file
  is the only implementation in Milestone 0.

## Local mode vs cloud mode

Local mode is a CLI daemon with an in-process tick loop and a SQLite store.
Cloud mode (later) runs the same `runWake()` in a container with a Postgres
store and an external scheduler. The `Store` and `Scheduler` interfaces are
designed now; only SQLite and the in-process loop are implemented (ADR-0004).

## Model calls

Claude via `@anthropic-ai/sdk`. Server-side refusal fallbacks on by default,
adaptive thinking, every call streamed with `finalMessage()`, append-only message
history, SDK types throughout (ADR-0006). Model and effort resolve per wake: a
persona's `model` override layers over the global `model` block, and the
verifier's judge resolves its own from `verifier.model`, so cheap agents and a
strong judge coexist in one run. Caching covers both the stable prefix (system
prompt, tool list) and the conversation: one breakpoint rolls to the end of
`messages` each turn, without which the transcript is re-sent at full price
every turn and input dominates the bill. The provider sits behind a thin
`ModelProvider` interface; only the Anthropic implementation exists, plus a
scripted provider used by tests (ADR-0016).

## Testing

Nothing in this repo depends on an external service to test. The mock target
(`packages/mock-target`) is a small task-list app with its own MCP server,
self-signup, and documented planted defects. Runner, reports and CLI tests run
wakes against it with the scripted provider so that trace, memory, findings,
verification and the digest are exercised end to end in CI.

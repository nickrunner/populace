# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

populace deploys a population of persona-seeded AI agents against any app that exposes an MCP
server. The agents behave like prospective users — discover the product through its tools, sign
up, try to get their own errands done, come back on a schedule — and file structured findings
that a report pipeline verifies, clusters and renders into a digest.

The product's own words for those things are different from the code's, deliberately: a user sets
up a **project**, composes **personas** into **cohorts** and cohorts into a **population**, and runs
a **study** — a population, a target, a mode and a **size** — whose **executions** send those people
on **visits**. The code's word for a study is `Simulation`, and it stays (ADR-0032, ADR-0042). See
"The chain" below.

Read `docs/ARCHITECTURE.md` for the map and `docs/adr/` for every fixed decision. The ADRs are
the reason most things are the way they are; several carry amendments recording what changed and
why. Check them before reversing something that looks odd.

## Commands

```bash
pnpm check                      # build + lint + typecheck + test — what CI runs, in that order
pnpm build                      # tsc -b, required before any CLI command (the CLI runs from dist/)
pnpm test                       # vitest run
pnpm test:watch
pnpm vitest run packages/runner/src/wake.test.ts        # one file
pnpm vitest run -t "carries identity and memory"        # one test by name
```

`pnpm build` before running the CLI: `pnpm populace` and `pnpm mock-target` both execute compiled
output from `dist/`, so source edits are invisible until you rebuild.

Running the harness against the reference app:

```bash
pnpm mock-target --port 4310      # Tasklet, the reference target (entry is dist/bin.js)
pnpm populace serve               # the dashboard and the API: set everything up, run it, read it
pnpm populace validate            # parse config, connect, list the target's tools
pnpm populace wake casual-lister  # one wake for one persona, live model calls
pnpm populace run --new-run       # the daemon: every agent on its cadence
pnpm populace digest              # verify, cluster, render
pnpm populace status              # agents, wakes, findings, spend
pnpm populace sweep               # delete accounts this run created, and its local data
```

Live runs need `ANTHROPIC_API_KEY` and cost real money. The test suite does not: it drives wakes
against the mock target with a scripted model provider, so trace, memory, identities, findings,
verification, clustering, digest and sweep are all exercised offline.

## Architecture

Dependency direction is strictly downward: `cli -> reports/runner/adapters/store-sqlite -> core`.
`mock-target` and `tdk` depend on nothing in the workspace — the first because it stands in for
somebody else's product, the second because it installs into one.

**The chain is project → study → population → cohort → person** (ADR-0029, ADR-0039, ADR-0041). A
*project* scopes authoring: targets, personas, cohorts, populations, studies, settings and triage
all belong to one and are never shared across two. A *cohort* is people who share a condition —
`context`, required, told to every one of them — drawn from a `mix` of personas in a ratio; it owns
the seed, a fixed-trait overlay, a narrowing tool policy, a model override and cadence/visit-cap
overrides, and **no headcount**. A *population* is which cohorts go and in what ratio
(`members[{cohortId, weight}]`), and it has no headcount either. A *study* — the row is
`Simulation` — is a population, a target, a mode and a **`size`**, the only headcount there is:
`dealStudy` apportions the size across the population's weights and then each cohort's mix by
highest averages (`apportion`, Sainte-Laguë, ties to the earlier entry), growing it re-deals
nobody, and creating or editing a study is what writes the people. A study may also carry a
`brief`, one text told to everyone it sends after their cohort's context. A *person* is a durable
individual in a lane (`cohortSlug.personaSlug#ordinal`) with a stored name, detail line and any
hand-set patience/budget/traits, written once and never silently overwritten (ADR-0031); a lane's
roster is the largest count any live study gives it, and a person past that count is archived, not
deleted. People are read and edited only through a study (`…/studies/:s/people`). A **run is one
execution of a study**, carrying `simulationId` and a `seq` counting from 1. **GETs write
nothing**: resolution is read-only and the writers are explicit (ADR-0041).

**Containment is not authoring order** (ADR-0035, ADR-0043). The chain says what contains what. It
does not say what you make first — and Target is a *sibling* of the population spine hanging off
Project, not a link in it. The authoring order is target → population → study, and it contradicts
the chain in no way; every noun has a list page and one builder page, and the builders chain
forward when the thing to pick from does not exist yet (ADR-0043). **A project holds SEVERAL
targets and SEVERAL populations**, and a study is the pairing of one of each plus a size: dev and
qa are two targets in one project, never two projects, because nothing is shared across projects
and finding signatures only roll up within one. Nouns do not inflect — Targets, Personas, Cohorts,
Populations, Studies, at nought, one and N — and `POST /studies` requires both ids: where a project
holds more than one of something, the server refuses to guess which and names the choices.

**Ephemeral vs longitudinal is about history and termination, not determinism** (ADR-0030).
Ephemeral means a clean slate — no memory, accounts or visit counts carried — and a bounded end
(`visitsPerPerson` required). Longitudinal accumulates, is pausable and is unbounded
(`visitsPerPerson` must be null). **There is no determinism subsystem and outcomes vary between
executions by design**, so nothing in the UI or the docs may promise identical results; a problem
absent from the newest execution is reported as an absence, never as a fix (ADR-0028 amendment
carries the measured numbers).

**The wire speaks the user's words; the rows do not change** (ADR-0032, ADR-0042).
`packages/contract` is the translation: `ParticipantSummaryView` is an `Agent` row with `wakeCount`
as `visits` and `maxWakes` as `maxVisits`, a `StudySummaryView` is a `Simulation` row,
`EventView.studyId` is the event row's `simulationId`, and the words "agent", "wake", "simulation"
and "lane" appear in no path, field or query parameter. `Agent`, `Wake`, `Simulation`, `runWake`,
`expandPopulation`, `resolveSimulationConfig` and every store method keep their names. Do not
rename underneath, and do not leak any of the four words onto the wire or into UI copy.

**Agent ids are unique per run, not globally.** An id is
`populationSlug/cohortSlug.personaSlug#ordinal` — the middle segment is a *lane*, one persona's
share of a cohort, and ordinals count within it — deterministic, and therefore repeated in every
execution of the study. `agents` is `PRIMARY KEY (run_id, id)`, `memories` is keyed `(runId, agentId)`, and
`getAgent`/`listDueAgents` take a run id. **Anything keyed by agent id alone leaks across runs.**

**The wake is the unit of everything.** `runWake()` is a pure-ish function of
`(agent, memory, identity, target, config)` producing `(trace, memory', findings, cost, identity')`.
No agent process lives between wakes; the local daemon and a future cloud job both just call it.
Anything you add that needs to persist across a session belongs in memory, not in a variable.

**Three credentials, and they must never be confused** (ADR-0036 and its amendment, ADR-0037,
ADR-0044). *Yours, to the target*, is the OAuth sign-in to a gated address: discovery, dynamic
registration and PKCE through the browser, kept in `sign_in_grants` keyed by `(project, url)`
because signing in happens while connecting, before any target is saved. *Theirs* is one account
per person, which is `identity` on the target. A sign-in is passed only by the things acting AS the
user — `checkTarget` and the tool list behind it — and `runWake` passes an identity's bearer and
nothing else; an explicit token wins over a provider inside `McpSession.connect`. A grant that
reached a wake would send every person in wearing the owner's face. Pressing Check registers nothing
with anybody: a provider reaches the check only for an address already signed in to. *Yours, to a
third party that is NOT the target*, is the fine-grained GitHub token in `github_connections` — and
its rule is simpler than the other two rather than harder, because it reaches nothing: it never
touches `runWake` or `McpSession.connect` under any name, never enters a `ConfigSnapshot`, a trace,
an event or a log line, and never comes back down the wire (`GithubConnectionView` carries
`tokenSet`, never a value). All three live in their own tables so nothing that assembles a config or
a view can reach one by walking a blob it already held.

**`packages/tdk` is published to npm and is not an internal package.** It is the app-side half of
`provision-url` — somebody mounts it in *their* server, so it depends on nothing in this workspace
and carries its own inlined types. Changing it means a version bump and a release, and the wire it
serves is versioned separately (`tdk: 1`) from the package. Its request schema is deliberately not
`strict`, so a field added later is ignored by kits already installed rather than breaking them;
that is what makes additions like `attributes` safe. There are five ways in now —
`provision-url` (recommended), `none`, `self-signup`, `static`, `admin-mint` — and
`docs/TARGET-SETUP.md` is the reader-facing account of choosing between them, and
`docs/ISSUE-FILING.md` is the equivalent for the GitHub token and what gets filed (ADR-0044).

**Two toolsets reach the model as one list.** The target's own MCP tools are passed through
untouched, and the runner adds its own reporter toolset (`file_finding`, `give_up`, `remember`,
`done`, `fetch_page`). The runner checks the tool name before dispatching: its own it handles
internally, the target's it forwards through an interceptor that applies the persona's allow/deny
lists, the destructive-tool policy, and self-signup credential capture. Findings and memory exist
*only* through reporter tools — the runner never parses prose (ADR-0007).

**And that list is not fixed for the length of a visit.** A target that says
`notifications/tools/list_changed` gets re-listed between a turn's tool results and the next model
request: a stateless Streamable HTTP server sends the notification down the response stream of the
call that caused the change, ahead of that call's result, so `McpSession.toolsStale` is already set
when `call()` resolves and the check needs no polling and no timer. `buildToolSurface` rebuilds the
dispatch table, the model's tool schemas AND the system prompt's tool paragraph together, because
two of the three disagreeing is worse than a stale list; it does not reconnect. The policy is
applied inside the rebuild, so **a refresh can only narrow the surface and never widen what the
policy permits** — and the `tools changed` trace event records the TARGET's listing, before the
policy, so "the app added this" stays distinguishable from "this person may call it". A changed
list costs the prompt cache from that turn on, by design; the message history is untouched.

**Evidence is by call ref.** Every target tool result the model sees is prefixed `[c1]`, `[c2]`…
`file_finding` takes `evidence_calls: ["c3","c4"]`, which the runner resolves into full tool-call
records stored as the finding's reproduction steps. That is what makes the verifier's replay
possible (ADR-0015).

**Guardrails live in the runner, not the prompt** (ADR-0009): per-wake token/dollar/turn ceilings,
a population daily ceiling, a kill switch in the store, tool allow/deny lists, destructive-tool
confirmation driven by MCP `destructiveHint`.

**Runs form a lineage** (ADR-0020). Memory is keyed by `(runId, agentId)`, so `--new-run` is a
genuine clean slate. `populace run --continue-from <run id>` seeds a new run from a parent —
memory, accounts, wake counts — and brings back agents that gave up *if* they said they would.
Agent ids are deterministic (`populationSlug/cohortSlug.personaSlug#ordinal`), so anything keyed
by agent id alone leaks across runs; key by run as well.

**A window, not an execution; a set, not a representative** (ADR-0044, ADR-0045). populace files a
study's surviving problems into a repository, and two things there are counter-intuitive enough to
break if you touch them without reading the records. **The filing ledger is keyed on the SET of a
cluster's member signatures**, matched by intersection — never on `ClusterCardView.signature`,
because `pickRepresentative` sorts on verdict score first and the digest writes verdicts after the
run, so the representative MOVES inside one execution and a key built on it files a duplicate. The
same intersection finds a card's triage row, through one `oldestMatching`. A hidden
`<!-- populace-problem-sig1-… -->` marker per member signature sits at the top of every body as the
second line of defence — it survives a `SCHEMA_SHAPE` rebuild dropping the ledger, which would
otherwise re-file every issue in somebody's repository — and a marker search that was *refused*
refuses to create, because "rate limited" and "found nothing" lead to opposite actions. Publishing
spends nothing, opens no MCP session to the target (`NO_COVERAGE`) and writes no triage row.
**And the unit the `new`/`open`/`gone quiet`/`back` arithmetic reads is a report WINDOW, not an
execution.** `signatureHistories` compares executions and a longitudinal study has exactly one, so
three of those four states were unreachable for it; a window needs only an identity, an order, a
`visited` flag and findings, so feeding it one entry per report cycle makes the existing arithmetic
work unchanged. One code path serves both modes — an ephemeral study's windows are its execution
boundaries — and **inside an execution only a succeeded `issues.cycle` job closes a window**, never
`issues.publish`, or a human's bulk press advances the state machine and the next publish comments
"gone quiet" on everything. A boundary counts only where it falls strictly inside the run; an
execution's own end closes its last window, which is why the terminal flush (itself an
`issues.cycle` job, ending after the run did) adds none and an ephemeral study still has exactly one
window per execution. **And windows are not free:** only an armed cycle enqueues one, and arming
needs a connected repository with a stored token and `autoFile` on, so a longitudinal study with no
repository still has one window and `gone quiet`/`back` stay unreachable for it. A repeat comments
every window; an **absence is said once per piece of news**, recorded on the ledger row.

**One hazard to read before arming any of that** (ADR-0044's and ADR-0045's open items,
`SWEEP-AND-VERIFY.md`). `autoSweep` has two conflicting defaults — `false` on
`SimulationContextSchema` (`packages/core/src/schemas/simulation.ts:79`), `true` on `SimulationSchema`
(`:137`) — and a saved study resolves off the row, so an ephemeral study made in the dashboard
sweeps by default: its report is ordered digest → filing → sweep on the serial queue, so the issues
go out checked, but nothing filed from that execution can ever be checked again.

**The second hazard there is closed: the paid judge is now opt-in.** `VerifierConfigSchema`
defaults to `judge: "heuristic"`, so a cycle on a clock spends nothing by default, and `judge`
raised to `model` resolves `claude-opus-5-5` at `effort: "high"` — pinned, not inherited from
`DEFAULT_MODEL`, because a judge must not be weaker than what it judges. **Nothing about the
daily ceiling changed**: it still bounds spend per day and not per study, so a `model` judge armed
on a repeating cycle is still a standing bill, just one somebody chose.

**Cheap is the default and considered is the opt-in** (ADR-0006 amendment). The shipped defaults
are `claude-sonnet-5-5` at `effort: "low"` for agents, because a person meeting somebody else's
product for the first time is not deliberating and a study pays for that thinking on every visit by
every person it sends. A cohort or persona that needs better raises it. Two traps when retuning:
`DEFAULT_PRICES` must carry a row for any model actually used — `priceFor` bills an unlisted one at
the most expensive known rate, so a missing row reads several times high and fires ceilings early
(that is what `claude-sonnet-5-5` did) — and `effort` must stay constant for the length of a wake,
since changing it mid-conversation invalidates the messages cache.

**Model config resolves per wake.** A persona's `model` override layers over the global `model`
block via `resolveModel`, and the verifier's judge resolves its own from `verifier.model`. Cheap
agents and a strong judge coexist in one run.

## Conventions that bite

- **No `any`, no `unknown`** — both are lint errors (ADR-0001). JSON crossing a boundary (MCP
  results, SQLite rows, provider SDK objects) is parsed with zod immediately at that boundary, with
  an `eslint-disable` comment naming the reason. Every persisted and config shape is a zod schema
  in `packages/core/src/schemas/` (ADR-0002).
- **Prompt caching is load-bearing.** The system prompt and tool list carry breakpoints and a third
  rolls to the end of `messages` each turn. Without the rolling one the transcript is re-sent at
  full price every turn and input dominates the bill — it was ~70% of spend before it existed
  (ADR-0006 amendment). Adding a per-request varying value to the stable prefix silently destroys
  the cache; verify with `usage.cache_read_input_tokens`.
- **Reporter tools are deliberately not `strict`.** The API compiles strict schemas into grammars
  under a shared complexity budget that this toolset exceeded, failing every wake with
  `400 Schema is too complex.` before turn one, with an error naming no tool. `toStrictInputSchema`
  still keeps schemas inside the structured-outputs subset so strict can be re-enabled on one small
  tool; the runner re-validates every reporter call against its zod schema regardless
  (ADR-0007 amendment).
- **Message history within a wake is append-only.** Notices and budget warnings are appended as new
  user turns; earlier turns are never edited or deleted.
- **The store has no migration framework, and does not even have the beginnings of one.** One
  `SCHEMA` constant holds every table; a `schema_shape` constant baked into the source is compared
  on open and a mismatch drops and rebuilds everything with a warning. That is affordable only
  while the only databases are throwaway local ones in this repo — the trigger that ends it is the
  first database elsewhere holding a target somebody typed (ADR-0011 amendment). Changing a table
  today means changing `schema_shape` and accepting the rebuild. The one exception is not a table
  change: a `size_backfill` marker in `control` guards a one-time raw-JSON fill of a legacy study's
  `size` from its population's summed member sizes, to be deleted when the framework arrives
  (ADR-0041).
- **Adding a field to a `core` schema breaks construction sites**, notably `expandPopulation()` and
  the wake/agent builders in `runner`. The compiler finds them; expect more than one.
- **A detail view is not a superset of its summary.** `ParticipantDetailView.visits` is an array of
  visits where the summary's `visits` is a count, and `ClusterDetailView.peopleHit` is the people
  where the card's is a number. `StudyPeopleView.items` is the rows that exist and `missing` the
  dealt ordinals never written, where `StudySummaryView.sends` is the total. All are deliberate and
  two have caught a screen; read the schema in `packages/contract/src/project.ts` rather than
  assuming.

## Testing

Tests run real wakes against the in-process mock target with `ScriptedProvider`, a test double
whose policy is a function of `(turn, wakeContext, lastResults, allResults)` returning the tool
calls the "model" makes. Assertions are usually against the persisted trace
(`store.getTrace(wakeId)`), the store rows, or the resulting findings, rather than against strings.

`packages/mock-target` has four deliberately planted defects documented in its README — case-
sensitive `search_tasks`, a silently dropped `dueDate` on `update_task`, off-by-one `list_tasks`
paging, and a missing `delete_task` the product copy promises. A healthy population finds all four,
and the reports tests assert exactly that, so they are the end-to-end signal that the pipeline
works.

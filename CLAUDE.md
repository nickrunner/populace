# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

populace deploys a population of persona-seeded AI agents against any app that exposes an MCP
server. The agents behave like prospective users — discover the product through its tools, sign
up, try to get their own errands done, come back on a schedule — and file structured findings
that a report pipeline verifies, clusters and renders into a digest.

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
`mock-target` depends on nothing in the workspace.

**The wake is the unit of everything.** `runWake()` is a pure-ish function of
`(agent, memory, identity, target, config)` producing `(trace, memory', findings, cost, identity')`.
No agent process lives between wakes; the local daemon and a future cloud job both just call it.
Anything you add that needs to persist across a session belongs in memory, not in a variable.

**Two toolsets reach the model as one list.** The target's own MCP tools are passed through
untouched, and the runner adds its own reporter toolset (`file_finding`, `give_up`, `remember`,
`done`, `fetch_page`). The runner checks the tool name before dispatching: its own it handles
internally, the target's it forwards through an interceptor that applies the persona's allow/deny
lists, the destructive-tool policy, and self-signup credential capture. Findings and memory exist
*only* through reporter tools — the runner never parses prose (ADR-0007).

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
Agent ids are deterministic (`populationId/personaId#ordinal`), so anything keyed by agent id
alone leaks across runs; key by run as well.

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
- **The store has no migration framework.** `CREATE TABLE IF NOT EXISTS` plus, where a shape had to
  change, an explicit drop of the old table on open. Changing a table means deciding what happens to
  existing local databases.
- **Adding a field to a `core` schema breaks construction sites**, notably `expandPopulation()` and
  the wake/agent builders in `runner`. The compiler finds them; expect more than one.

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

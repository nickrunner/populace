# Populace product roadmap

**Status:** draft for approval
**Date:** 2026-09-18
**Owner:** product role
**Input to:** the UX design thread and the architecture/build thread

This is the product roadmap for turning populace from a terminal proof of concept into a
production web dashboard. It covers who the users are, what they are hiring populace to do,
and the milestone ladder from "runs locally as a web app" to cloud deployment.

Everything here is grounded in what the repository does today. Where a decision would change
the shape of the product and cannot be settled from the code or the stated goal, it is listed
in [Open decisions](#open-decisions) rather than guessed at.

---

## 1. What populace is, in one paragraph

Populace deploys a population of persona-seeded AI agents against any app that exposes an MCP
server. The agents behave like prospective users: they discover the product through its tools,
sign up, try to get their own errands done, get annoyed, quit, and come back on a schedule.
They file structured findings — bugs, friction, coverage gaps, suggestions, abandonment, praise —
each carrying the exact tool calls that produced it. A verifier replays those calls and a judge
confirms or rejects them, clustering survives into a digest.

It is not a test suite. A test suite asks "does the code do what I wrote down?" Populace asks
"can a person who does not know my product get their errand done, and if not, where did they
give up?"

## 2. What exists today (Milestone 0)

The POC is complete and coherent, not a sketch. It has:

- A stateless wake loop (`runWake()`) that is a pure-ish function of
  `(agent, memory, identity, target, config)`. No agent process lives between wakes, which is
  why a local daemon and a future cloud job are the same code (ADR-0003, ADR-0004).
- Persistent per-agent memory, run-scoped, so a returning user is genuinely different from a
  first visit (ADR-0008, ADR-0020).
- Run lineage: `--continue-from` seeds a new run from a parent and brings back the agents who
  gave up *only if they said they would return*. Both runs stay separately reportable.
- Evidence by call ref: every tool result is tagged `[c1]`, `[c2]`…, and a finding cites the
  refs, which the runner resolves into full reproduction steps (ADR-0015).
- A verifier that mechanically replays those steps and a model judge that rules on the replay
  (ADR-0014), then clustering and a Markdown digest.
- Guardrails in the runner rather than the prompt: per-wake token/dollar/turn ceilings, a daily
  population ceiling, a kill switch, tool allow/deny lists, destructive-tool confirmation
  (ADR-0009).
- Identity provisioning including genuine self-signup through the target's own tools, tagged by
  run so `sweep` can delete every account a run created (ADR-0010, ADR-0012).
- A reference target, Tasklet, with four deliberately planted defects, and the ability to repair
  named defects at startup so the fix-validation loop can be tested end to end.

**What does not exist:** any HTTP surface for populace itself, any UI, any notion of a user
account, project or workspace, any finding state beyond its verification verdict, and any way to
reach the product except a terminal, a hand-authored YAML file and an `ANTHROPIC_API_KEY` in the
environment.

### The gap, stated plainly

Nine commands and a nine-block YAML file stand between a person and their first finding. The
richest thing populace produces — the trace, with every model turn, tool call and guardrail trip
in order — is written to SQLite and never shown to anyone. The final output is a Markdown file in
a folder. A run that costs real money gives no visible signal while it is running except log
lines scrolling past.

That gap is the product opportunity, and it is bigger than "put the CLI on the web".

## 3. Who the users are

Four segments, in the order populace can serve them.

### A. The MCP server builder (primary, v1)

A developer who has shipped or is about to ship an MCP server and does not know whether an agent
can actually accomplish anything through it. They own the target, they can run things locally,
they have an Anthropic key.

- **Served today?** Yes, barely — this is the only segment the CLI can serve.
- **What they want:** to point populace at `localhost`, get a verdict before they ship, and see
  *why* an agent failed rather than just that it did.
- **What blocks them today:** config authoring, no visibility during a run, no way to share the
  result with anyone who does not have the repo checked out.

### B. The product manager on an AI surface (primary, from M3)

A PM at a company whose product has an MCP or agent-facing surface. They care about the digest,
the coverage gaps and the abandonment reasons. They will never author YAML or run a daemon.

- **Served today?** No. They cannot start a run and would not read a Markdown file in
  `digests/`.
- **What they want:** which errands can users not finish, which tool are we missing that people
  keep reaching for, and where in the funnel do people quit.
- **What blocks them:** everything before the digest.

### C. The release / QA engineer (secondary, from M5)

Wants populace in CI: run before each release, gate on new confirmed bugs, diff this run against
the last.

- **What they want:** a non-interactive mode with an exit code, and run-over-run comparison.
- **Cheap to serve** once the data model supports comparing runs — most of the work is M4's
  anyway.

### D. The platform or marketplace reviewer (a later bet)

An organisation certifying third-party MCP servers at scale: run a standard population against
every submitted server, score it. A strong wedge, but a different product shape (multi-tenant,
many targets, standardised populations, scoring rather than digests). Explicitly out of scope
until after cloud.

**Recommendation:** build for **A**, design so **B** becomes possible from M3 onward, pick up
**C** almost for free at M5, and leave **D** until the cloud milestone has landed.

## 4. Core use cases

Ranked by how much value a real user gets, not by how easy they are to build.

### 4.1 Pre-launch readiness — "can anyone actually use this?"

Point populace at an MCP server, run a small population, read the digest. The output is bugs with
reproductions, the tools people wished existed, and the points where people gave up.

This is the use case the repository already proves: a healthy population finds all four of
Tasklet's planted defects, and the reports tests assert exactly that. It is the demo, and it
should be the first thing the web app makes effortless.

### 4.2 Fix validation — "I fixed it; do the users who quit come back?"

Ship a fix, then `--continue-from` the run that complained. The agents who abandoned return only
if they said they would, carrying their memory of what annoyed them, and are told the product has
changed. Their verdict is the answer.

**This is populace's differentiated feature.** Nothing else in the synthetic-testing space models
a user who left, remembers why, and can be asked whether the fix won them back. It has already
been validated end to end in this repo: the project-planner persona abandoned over `update_task`
silently dropping `dueDate`, said she would return if that specific bug were fixed, and a
continuation against a repaired target confirmed it.

In the web app this should not be a flag on a command. It should be a button on a finding that
reads, in effect, *re-run the people who complained about this*. It is the single screen the
design thread should spend the most care on.

### 4.3 Coverage gaps — "what should my MCP server expose?"

Agents file `coverage-gap` findings naming the tool they wished existed. Tasklet's missing
`delete_task` is the planted example: the product copy promises it, no tool delivers it.

This is roadmap input rather than QA output, and it is the most PM-facing thing populace
produces. It is currently buried in a Markdown section. It deserves its own view.

### 4.4 First-run and onboarding friction

Because self-signup is real — the agent signs up through the target's own tools and the runner
captures the credential — wake 1 is a genuine first-impression test. Where a persona stalls
before their first successful errand is the onboarding funnel, measured by someone who has never
seen the product.

### 4.5 Release regression

Run the same population each release, compare digests, gate on new confirmed bugs. Needs
run-over-run comparison, which M4 builds for fix validation anyway.

### 4.6 Pricing and packaging signal

Personas carry a `budgetUsd` and real constraints ("will not pay for a list app"). When Tasklet's
free plan caps projects at three, the persona with a dozen workstreams hits the wall and files
friction or abandonment rather than a bug. That is a packaging experiment nobody else can run
cheaply. Secondary, but it comes free with the data already collected.

## 5. What the web app must do that the CLI cannot

Four things, each of which is a design brief:

1. **Make a run legible while it happens.** The trace already records every model turn, tool
   call, guardrail trip, memory write and finding in sequence. Watching Casey sign up, hit the
   case-sensitive search, try three more spellings and file a bug is the product's most
   persuasive moment, and today it is invisible. This is the centrepiece screen.
2. **Make personas authorable without YAML.** A persona is a name, a role, a backstory, goals,
   constraints, a patience dial and a budget. That is a form, not a config file. A starter
   library of personas is what gets a new user from zero to a run.
3. **Make findings actionable.** A finding today has a verification verdict and nothing else.
   It needs human state — triaged, accepted, fixed, won't fix, duplicate — and a route out to
   wherever the team actually works.
4. **Make cost visible before it is spent.** Live runs cost real money. Guardrails exist but are
   invisible until they trip. An estimate before you press go, and a live spend meter after, are
   table stakes for a product people will run on their own key.

## 6. Milestone ladder

Local-first throughout. Each milestone ends in something demonstrable against the mock target,
and each is a gate Nick approves before the next starts.

### M1 — See it locally *(read-only dashboard)*

A local HTTP API over the existing `Store`, and a read-only web dashboard served alongside it.
`populace serve` starts both. No new persisted data model, no accounts, no auth — it reads what
the SQLite store already holds.

Screens: runs list, run overview (agents, wakes, spend), agent detail with memory, **wake trace
viewer** (the sequence of model turns and tool calls, with the guardrail events in line),
findings list with reproduction steps, digest view.

*Done when:* run the mock target and a population from the terminal, open the browser, and see
all four planted defects with their reproductions and replay the trace of the wake that found
each one — without reading a Markdown file.

### M2 — Drive it from the browser *(control plane)*

Start and stop a run, scale the population, engage and release the kill switch, run a digest,
trigger a single wake. Live updates while a run is in flight, so the trace viewer fills in as it
happens rather than after.

*Done when:* a complete mock-target run — start, watch, digest — happens without touching the
terminal after `populace serve`.

### M3 — Set it up from the browser *(authoring; the PM becomes a user)*

The target connect wizard: paste an MCP URL, see the tool list, detect the signup tool, run the
equivalent of `validate` in the UI. A persona editor with a starter library. Guardrail and budget
controls as form fields with an estimated cost. YAML becomes an export and an import, not the
entry point.

*Done when:* someone who has never read the README gets from an MCP URL to their first finding in
under ten minutes, entirely in the browser.

### M4 — Act on the findings *(the fix-validation loop)*

Finding triage state and a cluster-first findings view. Run comparison: this run against that
one, what is new, what is gone. **"Re-run the people who complained"** as a first-class action
built on `--continue-from`. Export a finding to a GitHub issue. A shareable digest.

*Done when:* break Tasklet, find it, fix it with `--fix`, and confirm the fix from one screen,
with the returning persona's verdict shown against the original complaint.

### M5 — More than one target, still local *(teams and CI)*

Projects or workspaces holding multiple targets and their populations. A target library.
Scheduled runs. A non-interactive CI mode that exits non-zero on new confirmed bugs.

*Done when:* one local install drives three different targets, and a CI job fails a build on a
newly confirmed bug.

### M6 — Cloud

Postgres store and an external scheduler behind the interfaces ADR-0004 already defined. Hosted
runners. Accounts, authentication, multi-tenancy. Secrets management for target credentials and
API keys. Billing, on whichever model §7 settles.

The runner itself should not change. If M6 requires touching `runWake()`, something earlier went
wrong.

*Done when:* a team member who has never installed anything logs in, connects a target and reads
a digest.

### Sequencing notes

- M1 and M2 are close together and could merge if the API is designed for both from the start.
  They are listed separately so there is an early, cheap gate where Nick sees the trace viewer
  and can redirect before control-plane work is spent.
- M3 is where the audience widens from A to B and is therefore the milestone most worth over-
  investing in design.
- M4 is where populace stops being a testing tool and becomes a product loop.
- Nothing before M6 requires a network service, an account or a hosted anything.

## 7. Open decisions

These change the shape of the product and are not mine to settle. Recommendations given; none is
acted on without approval.

### D1 — Who is v1 for?

**Options:** (a) the developer who owns the MCP server; (b) the PM who reads digests;
(c) both at once.

**Recommendation: (a), widening to (b) at M3.** The developer is the only segment the current
code can serve, and every milestone through M3 removes a barrier that stands between the PM and
the product anyway. Building for both at once means the persona editor and the trace viewer
compete for the same design effort in M1.

**Why it matters:** it decides what the design thread draws first.

### D2 — Does populace stay MCP-only?

Today populace can only test an app that exposes a rich MCP server. That is a small and
fast-growing universe, but it is small. "General-purpose users" may eventually mean apps that have
a web UI or an HTTP API and no MCP server at all.

**Options:** (a) MCP-native forever — populace is *the* tool for MCP surfaces and says so;
(b) MCP first, with a browser-driving or HTTP-driving adapter as a later target type.

**Recommendation: (a) through M6, with the data model kept honest about it.** A `Target` should
not hard-code "MCP" into every table and screen even if MCP is the only kind that exists, so that
(b) stays possible without a rewrite. But no browser-driving work before cloud.

**Why it matters:** it decides whether the architecture thread designs `Target` as an MCP
connection or as an abstract connection with an MCP implementation, and that is expensive to
change later.

### D3 — Where does configuration live once the UI can author it?

**Options:** (a) `populace.yaml` stays the source of truth and the UI edits the file;
(b) the database becomes the source of truth and YAML is import/export.

**Recommendation: (b) from M3**, because a UI that edits a YAML file on disk cannot survive the
cloud milestone, and doing it twice is worse than doing it once. YAML import/export preserves
every CLI workflow and the examples in the repo.

**Assumed unless you say otherwise** — this one I will proceed on, since it is reversible before
M3 starts.

### D4 — Who pays for model calls in the cloud?

**Options:** (a) bring your own Anthropic key; (b) hosted and metered; (c) both.

**Recommendation: (a) for M6**, because it removes billing from the first cloud release
entirely and matches how the tool works locally today.

**Assumed unless you say otherwise** — it only binds at M6 and can be revisited then.

## 8. What happens next

On approval of this roadmap:

1. The **UX design thread** takes §3, §4, §5 and the M1–M4 screens and produces the dashboard
   layouts and screen flows as an editable design canvas. The wake trace viewer (§5.1) and the
   fix-validation loop (§4.2) are the two screens to get right.
2. The **architecture and build thread** takes this plus the designs, settles the data model and
   the stack, and dispatches engineering milestone by milestone against the repo.

Open decisions D1 and D2 should be settled before the design thread starts, because both change
what it draws.

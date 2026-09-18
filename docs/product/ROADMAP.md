# Populace product roadmap

**Status:** final — both open decisions settled by Nick on 2026-09-18
**Date:** 2026-09-18
**Owner:** product role
**Input to:** the UX design thread and the architecture/build thread

This is the product roadmap for turning populace from a terminal proof of concept into a
production web dashboard. It covers who the users are, what they are hiring populace to do,
and the milestone ladder from "runs locally as a web app" to cloud deployment.

Everything here is grounded in what the repository does today. Two decisions that would have
changed the shape of the product were escalated rather than guessed at; both are now settled
and recorded in [§7](#7-settled-decisions).

---

## 1. What populace is, in one paragraph

Populace deploys a population of persona-seeded AI agents against any app that exposes an MCP
server. The agents behave like prospective users: they discover the product through its tools,
sign up, try to get their own errands done, get annoyed, quit, and come back on a schedule.
They file structured findings — bugs, friction, coverage gaps, suggestions, abandonment, praise —
each carrying the exact tool calls that produced it. A verifier replays those calls and a judge
confirms or rejects them; what survives is clustered into a digest.

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

**v1 serves two audiences at once: the developer and the product owner.** That is a decision
(D1), and it is the single most consequential thing in this document, because it means populace
is not one dashboard with a technical depth setting. It is two surfaces over one body of
evidence, and both have to be finished.

### The two surfaces

**The evidence surface — for the product owner.** Clusters, not findings. Coverage gaps and
abandonment reasons in the persona's own words. What changed since the last run. Whether a
shipped fix won back the people who left. Nothing on this surface requires knowing what MCP is.
The unit is *an errand a user could not finish*.

**The instrument surface — for the developer.** The wake trace: every model turn, every tool
call with its arguments and result, every guardrail trip, in sequence. Reproduction steps that
can be replayed. Token and dollar cost per wake. The unit is *the call that went wrong*.

They are views over the same data, not two products. The fix-validation loop (§4.2) is
deliberately the place they meet: the product owner sees "Priya came back and she is satisfied",
the developer sees the replayed tool calls that prove it.

### The segments

**A. The MCP server builder — v1, served today.** A developer shipping an MCP server who does
not know whether an agent can accomplish anything through it. Owns the target, runs things
locally, has an API key. Blocked today by config authoring, zero visibility during a run, and a
result they cannot share with anyone who lacks the repo checked out.

**B. The product owner — v1, not served at all today.** Cares about the digest, the coverage
gaps and the abandonment reasons; will never author YAML or run a daemon. Blocked today by
everything that happens before the digest exists. Making them a real user in v1 is what pulls
setup and authoring forward in the ladder below.

**C. The release engineer — from M4.** Wants populace in CI: run before each release, gate on
new confirmed bugs, diff this run against the last. Cheap to serve once run-over-run comparison
exists, which M3 builds anyway.

**D. The platform reviewer — after cloud.** An organisation certifying third-party MCP servers
at scale: one standard population against every submitted server, scored. A strong wedge but a
different product shape — multi-tenant, many targets, scores rather than digests. Explicitly out
of scope until cloud has landed.

### The risk this creates, and how the ladder answers it

Serving two audiences in v1 is more work per milestone, and the failure mode is real: each rung
lands half a developer surface and half a product-owner surface, and neither audience has
anything they can use. The ladder below is cut to prevent that. **Every rung must land a
complete slice for both roles** — not a finished feature for one and a stub for the other. Where
that is not affordable within a rung, the rung is split rather than half-delivered.

## 4. Core use cases

Ranked by how much value a real user gets, not by how easy they are to build. The surface each
one primarily lands on is noted.

### 4.1 Pre-launch readiness — "can anyone actually use this?" *(both surfaces)*

Point populace at an MCP server, run a small population, read the digest. The output is bugs with
reproductions, the tools people wished existed, and the points where people gave up.

This is the use case the repository already proves: a healthy population finds all four of
Tasklet's planted defects, and the reports tests assert exactly that. It is the demo, and it
should be the first thing the web app makes effortless.

### 4.2 Fix validation — "I fixed it; do the users who quit come back?" *(both surfaces, together)*

Ship a fix, then `--continue-from` the run that complained. The agents who abandoned return only
if they said they would, carrying their memory of what annoyed them, and are told the product has
changed. Their verdict is the answer.

**This is populace's differentiated feature.** Nothing else in the synthetic-testing space models
a user who left, remembers why, and can be asked whether the fix won them back. It has already
been validated end to end in this repo: the project-planner persona abandoned over `update_task`
silently dropping `dueDate`, said she would return if that specific bug were fixed, and a
continuation against a repaired target confirmed it.

In the web app this should not be a flag on a command. It should be a button on a finding that
reads, in effect, *re-run the people who complained about this*. It is also the one screen where
both audiences are looking at the same thing for different reasons, which makes it the screen the
design thread should spend the most care on.

### 4.3 Coverage gaps — "what should my MCP server expose?" *(evidence surface)*

Agents file `coverage-gap` findings naming the tool they wished existed. Tasklet's missing
`delete_task` is the planted example: the product copy promises it, no tool delivers it.

This is roadmap input rather than QA output, and it is the most product-owner-facing thing
populace produces. It is currently buried in a Markdown section. It deserves its own view.

### 4.4 First-run and onboarding friction *(evidence surface)*

Because self-signup is real — the agent signs up through the target's own tools and the runner
captures the credential — wake 1 is a genuine first-impression test. Where a persona stalls
before their first successful errand is the onboarding funnel, measured by someone who has never
seen the product.

### 4.5 Release regression *(instrument surface)*

Run the same population each release, compare digests, gate on new confirmed bugs. Needs
run-over-run comparison, which M3 builds for fix validation anyway.

### 4.6 Pricing and packaging signal *(evidence surface)*

Personas carry a `budgetUsd` and real constraints ("will not pay for a list app"). When Tasklet's
free plan caps projects at three, the persona with a dozen workstreams hits the wall and files
friction or abandonment rather than a bug. That is a packaging experiment nobody else can run
cheaply. Secondary, but it comes free with the data already collected.

## 5. What the web app must do that the CLI cannot

Four things, each of which is a design brief:

1. **Make a run legible while it happens.** The trace already records every model turn, tool
   call, guardrail trip, memory write and finding in sequence. Watching Casey sign up, hit the
   case-sensitive search, try three more spellings and file a bug is the product's most
   persuasive moment, and today it is invisible. This is the centrepiece of the instrument
   surface.
2. **Make personas authorable without YAML.** A persona is a name, a role, a backstory, goals,
   constraints, a patience dial and a budget. That is a form, not a config file. A starter
   library of personas is what gets a new user from zero to a run — and for the product owner it
   is the *only* way in.
3. **Make findings actionable.** A finding today has a verification verdict and nothing else.
   It needs human state — triaged, accepted, fixed, won't fix, duplicate — and a route out to
   wherever the team actually works.
4. **Make cost visible before it is spent.** Live runs cost real money. Guardrails exist but are
   invisible until they trip. An estimate before you press go, and a live spend meter after, are
   table stakes for a product people will run on their own key — and a product owner will not
   press go on an unpriced button at all.

## 6. Milestone ladder

Local-first throughout. Each milestone ends in something demonstrable against the mock target,
and each is a gate Nick approves before the next starts.

**Both audiences in v1 re-cut this ladder.** Setup and authoring can no longer sit at M3: a
product owner who cannot start a run is not a user of the product. So the old "drive it" and
"set it up" milestones merge into a single M2, which is now the heaviest rung on the ladder and
the one where the two-audience decision is paid for. Everything after it shifts up by one.

### M1 — See it locally *(read-only, both surfaces)*

A local HTTP API over the existing `Store`, and a read-only web dashboard served alongside it.
`populace serve` starts both. No new persisted data model, no accounts, no auth — it reads what
the SQLite store already holds.

- *Evidence surface:* the digest as a screen rather than a file — clusters, severity, which
  personas hit each one, coverage gaps and abandonment in the persona's words.
- *Instrument surface:* runs, agents, wakes, spend, and the **wake trace viewer** — the sequence
  of model turns and tool calls with guardrail events in line, and reproduction steps per finding.

*Done when:* run the mock target and a population from the terminal, then, in the browser,
(a) a product owner can read what is wrong with Tasklet without being shown a tool call, and
(b) a developer can replay the trace of the wake that found each of the four planted defects.

### M2 — Run it from the browser *(control plane + authoring; the product owner becomes a user)*

The rung that makes v1 real for both audiences, and the largest. Two halves that ship together
because neither is sufficient alone:

- *Control:* start and stop a run, scale the population, engage and release the kill switch,
  trigger a digest or a single wake. Live updates while a run is in flight, so the trace viewer
  fills in as it happens rather than after.
- *Setup:* the target connect wizard — paste an MCP URL, see the tool list, detect the signup
  tool, run the equivalent of `validate` in the UI. A persona editor with a starter library.
  Guardrail and budget controls as form fields with an estimated cost before you press go.

YAML becomes an export and an import, not the entry point.

*Done when:* someone who has never read the README gets from an MCP URL to their first finding in
under ten minutes, entirely in the browser — and a developer runs the same population without
touching the terminal after `populace serve`.

*Note on size:* this rung is roughly twice any other. If it has to be split, split it by surface
depth (a working wizard with a small persona library first, the full editor second), never by
audience — shipping control without setup leaves the product owner exactly where they are today.

### M3 — Act on the findings *(the fix-validation loop)*

Finding triage state and a cluster-first findings view. Run comparison: this run against that
one, what is new, what is gone. **"Re-run the people who complained"** as a first-class action
built on `--continue-from`. Export a finding to a GitHub issue. A shareable digest.

*Done when:* break Tasklet, find it, fix it with `--fix`, and confirm the fix from one screen,
with the returning persona's verdict shown against the original complaint — the product owner
reading the verdict, the developer reading the replay, on the same screen.

### M4 — More than one target, still local *(teams and CI)*

Projects or workspaces holding multiple targets and their populations. A target library.
Scheduled runs. A non-interactive CI mode that exits non-zero on new confirmed bugs.

*Done when:* one local install drives three different targets, and a CI job fails a build on a
newly confirmed bug.

### M5 — Cloud

Postgres store and an external scheduler behind the interfaces ADR-0004 already defined. Hosted
runners. Accounts, authentication, multi-tenancy. Secrets management for target credentials and
API keys. Billing, on whichever model §7 settles.

The runner itself should not change. If M5 requires touching `runWake()`, something earlier went
wrong.

*Done when:* a team member who has never installed anything logs in, connects a target and reads
a digest.

### Sequencing notes

- M1 stays read-only and deliberately cheap. It is the early gate where Nick sees both surfaces
  and can redirect before control-plane and authoring work is spent.
- M2 is where the audience actually widens and is therefore the milestone most worth
  over-investing in design.
- M3 is where populace stops being a testing tool and becomes a product loop.
- Nothing before M5 requires a network service, an account or a hosted anything.

## 7. Settled decisions

### D1 — Who is v1 for? **Settled: both the developer and the product owner.**

*Decided by Nick, 2026-09-18.* The alternative on the table was developer-first, widening to the
product owner at M3, on the argument that the developer is the only segment the current code can
serve and that building for both at once makes the persona editor and the trace viewer compete
for the same design effort early.

The decision is both. Its consequences are folded through this document: §3 splits the product
into an evidence surface and an instrument surface, setup and authoring move from M3 into M2,
and every rung is required to land a complete slice for both roles rather than half of each.
The cost is concentrated in M2, which is now the biggest milestone on the ladder.

### D2 — Does populace stay MCP-only? **Settled: yes, MCP-only.**

*Decided by Nick, 2026-09-18.* Populace tests apps that expose an MCP server. No browser-driving
or HTTP-driving target type is planned, at any milestone.

This is a scope decision, and it simplifies the architecture thread's work: `Target` can be
modelled as an MCP connection directly, without a speculative abstraction layer for a second
target kind that is not coming. It also sharpens the positioning — populace is the tool for MCP
surfaces, and the product can say so plainly rather than hedging.

### D3 — Where does configuration live once the UI can author it? **Assumed: the database, from M2.**

The database becomes the source of truth and YAML becomes import/export. A UI that edits a YAML
file on disk cannot survive the cloud milestone, and doing it twice is worse than doing it once.
Import/export preserves every CLI workflow and the examples in the repo.

Note that D1 moved authoring from M3 to M2, so this decision binds a milestone earlier than
originally scoped. It is still reversible before M2 starts. Raised for awareness rather than
re-opened.

### D4 — Who pays for model calls in the cloud? **Assumed: bring your own API key.**

It removes billing from the first cloud release entirely and matches how the tool works locally
today. Only binds at M5 and can be revisited then.

## 8. What happens next

1. The **UX design thread** takes §3, §4, §5 and the M1–M3 screens and produces the dashboard
   layouts and screen flows as an editable design canvas. Its central problem is the one D1
   created: **two surfaces over one body of evidence**, which must feel like one product rather
   than a dashboard with a hidden expert mode. The wake trace viewer (§5.1) and the
   fix-validation loop (§4.2) are the two screens to get right, and the second is where the
   surfaces meet.
2. The **architecture and build thread** takes this plus the designs, settles the data model and
   the stack, and dispatches engineering milestone by milestone against the repo. D2 means
   `Target` is an MCP connection, concretely. D3 means the store, not the YAML file, is the
   source of truth from M2 — which is earlier than first scoped, and worth confirming before M2
   design work is spent.

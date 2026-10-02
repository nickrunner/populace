# Populace product roadmap

**Status:** re-baselined 2026-09-20 against `main` after the projects/simulations/cohorts/people
restructure (PR #5, `98b1b43`). Supersedes the 2026-09-18 draft.
**Owner:** product role
**Input to:** the UX design thread and the architecture/build thread

This is the product roadmap for populace as a web product. It covers who the users are, what
they are hiring populace to do, what has shipped, and what is left.

The 2026-09-18 version of this document was written in the old vocabulary — personas with counts
inside a population — and against a ladder that assumed none of the web product existed. Both are
now out of date, for a good reason: the restructure and the web work built most of M1 through M3.
This version re-baselines on what `main` actually is.

Nick's four decisions from 2026-09-18 stand unchanged and are restated in
[§8](#8-decisions). Two new decisions are open.

---

## 1. What populace is, in one paragraph

Populace sends a population of persona-seeded AI people into an app that exposes an MCP server.
They behave like prospective users: they discover the product through its tools, sign up, try to
get their own errands done, get annoyed, quit, and come back on a schedule. They file structured
findings — bugs, friction, coverage gaps, suggestions, abandonment, praise — each carrying the
exact tool calls that produced it. A verifier replays those calls and a judge confirms or rejects
them; what survives is clustered by signature into results a team reads.

It is not a test suite. A test suite asks "does the code do what I wrote down?" Populace asks
"can a person who does not know my product get their errand done, and if not, where did they
give up?"

## 2. The vocabulary, as it now stands

The restructure (ADR-0029) replaced the one noun between "the app" and "an agent" with five, and
that changes how every screen and every roadmap item is named. Three later decisions moved two
things without adding a noun: the headcount now belongs to the study (ADR-0041), the product's word
for a simulation is now study (ADR-0042), and every noun has a list page and a builder (ADR-0043).

| Noun | What it owns | What it replaced |
| --- | --- | --- |
| **Project** | Scopes authoring: targets, personas, cohorts, populations, studies, settings, triage. | Nothing; new. |
| **Target** | The app under test, its MCP endpoints, its identity strategy, **and its tool policy** (ADR-0033). | A `target` block in YAML with no policy of its own. |
| **Persona** | A template: role, backstory, goals, constraints, traits. **No headcount.** | A persona that also carried its count. |
| **Cohort** | **A shared condition and a mix of personas** (ADR-0039): `context`, `mix[{personaId, weight}]`, an overlay, the seed, cadence and visit-cap overrides. No headcount. | "N people on one persona" owning `size` (ADR-0029), which forced a cohort per persona per condition. |
| **Person** | A durable named individual in a lane, `cohortSlug.personaSlug#ordinal`, stored once and never silently overwritten, with the sampled dimensions settable by hand (ADR-0031, amended). | Nothing; new, and it is the most product-visible addition. |
| **Population** | Which cohorts go and in what ratio: `members[{cohortId, weight}]` (ADR-0041). Reusable across studies; **no headcount.** | `members[{cohortId, size}]`, the only headcount (ADR-0039) — which made a population at ten and the same at forty two populations. |
| **Study** | A population, a target, a mode — **ephemeral** or **longitudinal** (ADR-0030) — and a **size**, the one headcount, dealt across the population's and cohorts' weights; optionally a **brief** told to everyone it sends. What a user presses go on and what results belong to. The code calls it a `Simulation` (ADR-0032). | "Simulation" (ADR-0029, renamed by ADR-0042). The thing a user actually has in their head, under the word they use for it. |
| **Run** | One execution of a study, with a `seq` counting from 1 and a frozen config snapshot. | An unnumbered run id. |

Three translations matter for everything user-facing (ADR-0032, ADR-0042): **an agent is a
participant, a wake is a visit, and a simulation is a study**, on the wire and on every screen. The
rows keep their old names; the product does not use them. This document uses the product's words.

### What the restructure got right that the old roadmap missed

The old roadmap said "a persona is a form, not a config file". That was true and insufficient.
The thing that was actually missing was the **cohort** — the layer that lets "twelve first-timers
who come back every ten minutes" and "eight first-timers on mobile who come back every four" be
two different groups of the same persona. Without it, a population could hold one member per
persona and the headcount was the product of two numbers on two screens.

And **people being stored rather than derived** changes the evidence surface more than any screen
decision could. A finding is now attributable to a named individual who is the same individual
next execution. "Priya Desai walked away over this, and said a fix would bring her back" is a
sentence the product can now write, and it could not before.

## 3. Where we are (2026-09-20)

Most of the ladder the 2026-09-18 roadmap laid out has been built. Stating that plainly is the
point of this section, because the remaining work is small, specific, and not what the old
document said it was.

### Shipped

**The engine (was M0).** Unchanged and still the invariant: `runWake()` is untouched by all of
the above, which is exactly what ADR-0021 through ADR-0034 were arranged to protect.

**Read-only dashboard (was M1).** `populace serve` runs one process that owns the store
(ADR-0022), serves a REST API under a zod contract (ADR-0023) and hosts a React dashboard. Both
surfaces exist: results, gaps, who walked away, a person's history, and the visit trace viewer.

**Control and authoring (was M2).** Runs are first-class with frozen config snapshots
(ADR-0024). The store is the source of truth for configuration and YAML is an import
(ADR-0025) — which is D3, decided and now implemented. Live updates run over SSE on a persisted,
resumable event log (ADR-0026). Long operations are persisted jobs (ADR-0027). The library
screens author targets, personas, cohorts and populations, and the studies dashboard authors studies,
each noun with a list and one builder (ADR-0043); people are met and edited through the study that
sends them (ADR-0041). Cost is estimated before a run
starts, and `preflight` says who is going, what they will meet and what it will cost.

**Most of the loop (was M3).** Findings carry a content-derived `signature`; triage is keyed by
`(project, signature)` so a human's judgement survives a re-execution that produces entirely new
finding rows (ADR-0028). Run comparison exists. Carry-forward exists on the API. Problems marked
fixed collapse into a "Known" section, and one marked fixed that returns is flagged `regressed`.

**Projects (was M4), early.** Projects are real rows and the API is project-scoped, ahead of the
old ladder's sequencing.

### Two things the restructure added that the old roadmap never scoped

**A tool policy that belongs to the target (ADR-0033).** Policy used to live only on a persona,
which is the wrong altitude: a user pointing populace at their own deployed product found that
keeping the population away from `updateOrgClaimStatus`, `getUsers` and `getTransactions` meant
writing identical deny globs on every persona — and a persona added next month inherited the
whole surface silently. A policy that fails open as the population grows is not a policy. Now the
target owns it and a persona may only narrow it.

This is a product capability, not a detail: **it is what makes populace safe to point at a real
product** rather than only at a toy. The old roadmap did not have it anywhere.

**First contact (ADR-0034).** One account, one read-only call, before a run. It answers "is my
identity configuration actually right?" for zero model spend, and it distinguishes *unreachable*
from *provision-failed* from *rejected* from *accepted* from *connected-only* — which is the
whole value, because a user cannot infer any of that from a 401. The old roadmap's "connect
wizard" implied this and never named it.

**Filing a problem as a GitHub issue (ADR-0044), and a report cycle (ADR-0045).** R2's *results*
half has shipped, and more than its line asked for. A project connects one repository with a
fine-grained token; a problem becomes an issue whose body is the fix prompt, with its reproduction
and evidence intact and its credentials redacted, readable by somebody with no populace install. The
same problem is not filed twice — the ledger is keyed on the cluster's **member** signatures, because
the representative moves when a digest writes a verdict, and a hidden marker in each body survives
the local database being rebuilt. A problem reported again gets a comment every window it is reported in;
a problem that has gone quiet gets one **once per piece of news**, recorded on the ledger row, since
the alternative was the same absence restated on the hour for the life of the study. A closed issue
is reopened without any claim about why it was closed.

Beyond R2's line, and named as such: a **bulk** action, and an **automatic** path. The automatic one
required fixing something that had been quietly broken — `new`/`open`/`gone quiet`/`back` was
computed over *executions*, and a longitudinal study has exactly one, so three of those four states
were unreachable for the mode this product's loop depends on. A **report cycle** is now a window
boundary inside a run, which makes the existing arithmetic work unchanged and gives a continuously
running study a state machine on its own results page — with one caveat worth knowing before
relying on it: a window boundary inside a run is a succeeded `issues.cycle` job, and only an armed
cycle enqueues one, so a study with no repository connected still has a single window and the
`gone quiet`/`back` states stay out of reach for it.

Two honest limits. A complaint reworded from scratch still gets a second issue (§5's 0% number is
what bounds this, and nothing here improves it). And filing spends no model money and opens no
session to the target, but the **digest** the automatic cycle runs first does spend, on a judge whose
default is the strongest model at high effort — see D5 and ADR-0045's open items.

### Not shipped

- **The returning verdict.** See §5 — this is **still** the gap that matters most, and R2's results
  half (below) jumped ahead of it deliberately: filing issues needs no better verdict than the one
  that exists, and until something leaves the building there is nothing for anybody to act on. That
  ordering was a choice, not a re-ranking. R1 is still next.
- **A shareable digest.** Markdown export exists from the CLI; there is no shareable result.
- **YAML export.** Import works: a `populace.yaml` seeds the authored tables the first time a store
  is opened, and it is an import rather than a sync. There is no way back out. A cohort cast in the
  browser, a persona written in the editor and a target typed into the wizard exist only in one
  local SQLite file (DATA-MODEL §12). The old roadmap said YAML would become "an export and an
  import"; only half of that is true.
- **Persisted digests and clusters.** Computed per request, deliberately, and fine at local scale.
- **Scheduled or unattended runs.** A longitudinal study runs only as long as `serve` does.
  There is no cron, no daemonisation, no wake-on-boot. See D6.
- **A CI mode.** Nothing consumes the API non-interactively.
- **A migration framework.** Deliberately deleted, with a named trigger for its return. See D5.
- **Cloud.** Nothing started, by design.

## 4. Who the users are

Nick's D1 stands: **v1 serves the developer and the product owner together.** The two-surface
framing survives the restructure and is strengthened by it, because the new nouns split cleanly
along the same seam.

**The evidence surface — for the product owner.** A study's results: problems clustered by
signature, how many people hit each one, which cohorts, coverage gaps, who walked away and over
what, in their own words with their own names. Nothing here requires knowing what MCP is. The
unit is *an errand a person could not finish*.

**The instrument surface — for the developer.** The visit trace: every model turn, every tool
call with arguments and result, every guardrail trip, in sequence. Reproduction steps that
replay. Token and dollar cost per visit. First contact's failure modes. The unit is *the call
that went wrong*.

The architecture enforces the seam rather than leaving it to screen discipline: the project
overview and study results payloads **carry no person names at all**, and a name first
appears on a cluster detail as the author of a quote, asserted by a test that reads the raw
response bodies (ADR-0032, WEB-ARCHITECTURE §5). That is a better mechanism than the old
roadmap's rule, and it should stay.

### The rule about complete slices, revisited

The old roadmap required every rung to land a complete slice for both roles, because the failure
mode was landing half a surface each. **That rule did its job and should now be retired**, for a
specific reason: the remaining work is genuinely lopsided and pretending otherwise would force
artificial pairing. Export and CI mode are developer-surface. A shareable result is
product-owner-surface. The returning verdict is both. Cloud is both.

The rule that replaces it is narrower and still true: **no remaining item may leave one surface
unable to complete a job it can do today.** That is a regression test, not a pairing requirement.

## 5. The gap that matters most: the returning verdict

Fix validation is populace's differentiated feature, and after the restructure **its first half
is built and its second half does not exist.**

What exists: the "Who walked away" screen names each person who left, quotes what it was over,
and records whether they said a fix would bring them back — `Priya Desai · said a fix would bring
them back`. That is the promise, captured.

What does not exist: anything that acts on it. There is no button on that screen, or on a
problem, that carries those people forward. `POST /runs/:id/carry-forward` and
`carryForwardFrom` exist on the API and in the web client's `api.ts`, and **no screen drives
them.** And there is no screen that shows the result: *you carried Priya forward, she came back,
and here is what she said about the thing she left over.*

The old roadmap named this exactly right and it did not get built:

> It should be a button on a finding that reads, in effect, *re-run the people who complained
> about this*.

### Why this is now more important than it was

The comparison screen was measured during the restructure and the number is a cliff, not a curve
(ADR-0028 amendment): a complaint whose wording is identical recurs 100% of the time, and **a
complaint the model rewords from scratch recurs 0% of the time**, because a signature is a hash
of an exact token set. The screen handles this honestly — it reports an absence as an absence and
never says "you fixed this".

That is correct, and it means the set-difference between two executions is **the weak evidence**.
A problem that vanished may have been fixed, or may have been described differently by somebody
who hit it just as hard.

The strong evidence is the thing populace alone can produce: a **named person who left over a
specific problem, was brought back carrying their memory of it, and passed judgement**. That is
not a hash comparison. It is a first-person statement from a returning user, and `wouldReturn`,
run lineage and per-run memory already make it available.

So the recommendation is not "build the missing button". It is: **the fix-validation screen
should lead with the returning person's verdict and treat the signature diff as supporting
context** — the reverse of how the product currently presents it, because compare is a screen and
the verdict is nothing.

**This is the next rung.** It is a small amount of work on top of machinery that all exists, and
it finishes the one thing no competitor can copy.

## 6. Core use cases

Ranked by value to a real user. The surface each lands on is noted.

### 6.1 Pre-launch readiness — "can anyone actually use this?" *(both)*

Point a study at an MCP server, give it a size, read the results. The repository still proves
it: a healthy population finds all four of Tasklet's planted defects and the reports tests assert
exactly that.

### 6.2 Fix validation — "do the people who quit come back?" *(both, together)*

Covered in §5. Ephemeral and longitudinal now make the two halves of this precise in a way the
old roadmap could not:

- An **ephemeral** re-run is a *sibling execution with nothing inherited* — fresh people, memory
  and accounts. It answers "is it good now?", not "did my fix land".
- A **carry-forward** brings the parent's people, memory and accounts onto a new execution. It is
  the only path that can produce a returning verdict.

The old roadmap conflated these. They are different questions and the product should never offer
one as an answer to the other.

### 6.3 Safe targeting — "can I point this at my real product?" *(both)* — new

Between the target's tool policy (ADR-0033), destructive-tool confirmation, and first contact
(ADR-0034), populace can now be aimed at a deployed product with dangerous and privacy-sensitive
tools without writing a deny glob six times. This is a use case, not plumbing: it is the
difference between a tool you try on a demo app and one you run against the thing that pays your
salary.

### 6.4 Coverage gaps — "what should my MCP server expose?" *(evidence)*

Agents file `coverage-gap` findings naming the tool they wished existed. Tasklet's missing
`delete_task` is the planted example. This now has its own screen.

### 6.5 First-run and onboarding friction *(evidence)*

Self-signup is real, so visit 1 is a genuine first-impression test measured by somebody who has
never seen the product.

### 6.6 Release regression *(instrument)* and 6.7 pricing signal *(evidence)*

Regression needs the CI mode that does not exist yet. Pricing signal comes free: people carry a
real budget and constraints, so a paywall produces friction or abandonment rather than a bug.

## 7. What is left

Rungs, in recommended order. Every one of them is small next to what has already landed.

### R1 — The returning verdict *(recommended next)*

Carry-forward as an action a person can take from where the promise is recorded, and a screen
that shows what the returning people said. Lead with the verdict; keep the signature diff as
supporting context. §5 is the whole argument.

*Done when:* break Tasklet, find it, fix it, press one control, and read Priya's own words about
whether it is fixed — without composing a CLI command or reasoning about a set difference.

### R2 — Work that leaves the building

Everything a user makes is currently trapped in one local database. Two halves, and the first has
shipped:

- ~~**Results.** Export a problem to a GitHub issue, carrying its reproduction steps and its
  evidence.~~ **Shipped 2026-09-30** (ADR-0044, ADR-0045). What is left of this half is *a shareable
  result a product owner can send to somebody who does not run `serve`* — a filed issue is that for
  one problem and for a reader who has a GitHub account; a shareable **digest** is not built.
- **Config.** YAML export, so the authored layer can go back into a repository.

The config half is a D1 consequence and is easy to under-rate. v1 serves developers, and a
developer expects their configuration in version control: reviewable in a pull request, diffable
when a run's behaviour changes, and recoverable when a laptop dies. Today the wizard, the persona
editor and the cohort caster all write to a file that is in no repository and, until the migration
framework exists (D5), can be dropped by the next schema change. Import-only was the right call
for getting the database to be the source of truth; leaving it import-only makes the authored
layer unshareable and unbacked.

*Done when:* ~~a problem becomes a filed issue with its reproduction intact~~ (done); a result can be
read by somebody with no populace install; and a project authored entirely in the browser can be
written out as YAML, committed, and used to seed a fresh store.

### R3 — Unattended running

Today "comes back on a schedule" is true only while `serve` is open, which is a gap against the
product's own pitch. Whether this is a local service or waits for cloud is **D6**.

### R4 — CI mode

A non-interactive client over the existing API that gates a build on newly confirmed problems.
Cheap, because the API and signatures already exist.

### R5 — Cloud

Postgres behind `Store`, an external scheduler behind `Scheduler`, hosted runners pulling the
existing jobs table, accounts and tenancy in `server`, secrets out of the config rows. The runner
is untouched; if it is not, something earlier went wrong.

### The gate that is not a rung: the migration trigger

The store has no migration framework and `migrations.ts` was deleted. A schema change drops every
table and warns. That was affordable because the only databases in existence are developers'
throwaway stores in this repository.

The trigger that ends it is named rather than left to judgement: **the first database outside
this repository that holds a target somebody typed.** After that, a drop is data loss — an
endpoint, a bearer token, a persona somebody wrote, a cohort somebody cast. This is a release
gate on the whole product, not an item inside a rung, and it is **D5**.

## 8. Decisions

### Settled, and unchanged

**D1 — Who is v1 for? Both the developer and the product owner.** *Nick, 2026-09-18.* Still the
organising principle. The two-surface split now has an architectural enforcement mechanism
(§4) that is better than the process rule it replaces.

**D2 — Does populace stay MCP-only? Yes.** *Nick, 2026-09-18.* Implemented as decided: the data
model carries no target-kind discriminator, and `Target` is an MCP connection concretely
(DATA-MODEL §12).

**D3 — Where does configuration live? The database, with YAML as import.** Decided as an assumed
default; now implemented as ADR-0025. YAML can create cohorts and studies on first open; it
is an import, not a sync.

**D4 — Who pays for model calls in the cloud? Bring your own key.** Unchanged, and still only
binds at R5.

### Open

**D5 — When does the migration framework have to exist?**

The named trigger is the first database outside this repository holding a target somebody typed.
Only Nick knows when that is. If anyone is going to run populace against their own product before
cloud — and ADR-0033 suggests somebody already has — the migration runner is a release gate
before the next schema change, not an R5 item.

*Recommendation:* treat the trigger as already imminent and schedule the migration runner before
R2, because authored rows are the user's work and the cost of being wrong is somebody's typed
credentials and cast cohorts.

*Sharpened 2026-09-30 (ADR-0044).* R2's results half shipped before the migration runner, and it
made this worse in two specific ways rather than one general one. A long-lived database now holds a
**fine-grained GitHub token** — which is arguably the named trigger itself, without waiting for
anybody else's laptop — and an **issue ledger**, which a `SCHEMA_SHAPE` bump drops, and which when
dropped re-files every issue in somebody's repository. The hidden marker in each issue body is what
makes that survivable in the meantime, and it is the strongest argument for reconciling against the
repository rather than trusting local state; it is a mitigation, not a reason to wait longer.

**And one hazard worth reading beside this has since been closed, in a way worth recording.** The
verifier's default judge was `claude-opus-5` at `effort: "high"` with `maxFindings: 50` — chosen
when a digest was something a person asked for. ADR-0045's report cycle runs a digest **on a clock,
for as long as a study runs**, so a longitudinal study left going on default config could spend on
the most expensive model in the table indefinitely, regardless of what the population itself ran.
The argument for leaving it was that lowering it quietly would change every digest anybody asks for
— which had it backwards: the danger was that the same setting served both the digest a person
requested and the cycle nobody watches. The paid judge is now opt-in (`judge: "heuristic"` by
default, ADR-0006 amendment), so asking for a written verdict is a choice, and the agents' own
default moved to `claude-sonnet-5-5` at `effort: "low"` for the same reason — a study pays for
deliberation on every visit by every person it sends.

**What is still open:** the project's daily ceiling is read before anything is spent and bounds the
damage per day and not per study, so a judge deliberately armed on a repeating cycle remains a
standing bill with no per-study limit. A per-study ceiling is the missing piece.

**D6 — Does unattended running come before cloud?**

A longitudinal study is the product's answer to "what happens to people who use this for a
fortnight", and today it stops when `serve` stops. Either populace grows a local always-on mode
before cloud, or longitudinal studies stay a supervised activity until R5.

*Recommendation:* let it wait for cloud. A local always-on service is a different support surface
— process management, restarts, log rotation — for a product that is still local-first, and R5
solves it properly. But this is a real limitation against the pitch and should be a deliberate
choice rather than an accident of sequencing.

## 9. What happens next

1. The **architecture and build thread** takes R1 as the recommended next rung, and answers D5
   and D6 to Nick.
2. The **UX design thread** has one screen to design that does not exist: the returning verdict
   (§5). It is the payoff screen for the feature the whole product is differentiated by, and it
   is the only significant screen still missing.

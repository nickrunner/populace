# ADR-0044: Filing a study's problems as GitHub issues

**Status:** accepted 2026-09-30

## Context

The user's words, paraphrased faithfully in the brief this record implements:

> *"populace runs continuously against a deployed product and files what it finds. Claude watches
> the issues and opens PRs. A human approves them. populace's longitudinal study then confirms the
> fix functionally over time, and files anything new or regressed. populace is the sensor and the
> verifier in a self-improving system; it is not a reporting tool that runs once."*

**populace finds problems and then strands them.** A study runs, the digest verifies and clusters
the findings, triage prunes what a human has already settled — and the surviving problems live in
one local SQLite file behind `populace serve`. The only way one reached the person who would fix it
was that somebody opened the finding page, pressed the copy button on the fix prompt, and pasted it
somewhere by hand.

This is rung **R2** in `docs/product/ROADMAP.md`, named there already: *"Export a problem to a
GitHub issue, carrying its reproduction steps and its evidence. Done when: a problem becomes a
filed issue with its reproduction intact."*

**Two things about scope, said here rather than left to be inferred.** R2's line is *one problem,
user-initiated*. The bulk action and the automatic report cycle (ADR-0045) are **new scope beyond
it**. And R2 itself sits below **R1**, the returning verdict, which the roadmap calls *"the gap that
matters most"* — the strong "did my fix land" evidence is a named person brought back carrying
their memory of a problem, and this record does not build it. Jumping ahead of R1 was a deliberate
call, made because the loop in the brief needs an outbound write before it needs a better verdict:
without filing there is nothing for anybody to open a PR against, and the reach evidence a
longitudinal study already produces is enough to be worth reading. It is not a claim that the
signature diff became strong evidence. It did not (ADR-0028's amendment; §4 below).

## Decision

**A problem that survived the digest becomes an issue in a repository the project is connected to,
whose body is the fix prompt — the whole reproduction, the reach, the intent, the verdict,
credential-redacted — so a developer or a coding agent can act on it with no populace access. The
same problem is not filed twice. Publishing spends nothing and opens no session to the target.**

### 1. Two new tables, and `SCHEMA_SHAPE` is untouched

`github_connections` — `project_id` PRIMARY KEY, `repo`, `updated_at`, `json` — holds the
repository and the token. `filed_issues` — PRIMARY KEY `(project_id, provider, repo, number)`,
plus `filed_at` and `json` — is the filing ledger. A row is more than a dedupe key: alongside the
issue's identity and the signature set it was filed for it holds `seenIn`, one sighting per report
window that reported the problem, `quietNotices`, every absence populace has already announced on
it, and `supersededBy`. Those last two are what make a comment able to say something once (§8).

**Neither bumps the shape, and that is the rule rather than an exception.** The comment over
`sign_in_grants` in `packages/store-sqlite/src/index.ts` already states it, and these two tables
are the second and third things to rely on it:

> *"Adding this table did NOT bump SCHEMA_SHAPE, and that is the rule rather than an exception:
> every statement here runs under CREATE TABLE IF NOT EXISTS on every open, including the open that
> finds the recorded shape already current, so a table nothing else references appears in an
> existing database by itself. The shape guards tables that CHANGE, where an old file's columns are
> wrong and the rebuild is the whole migration story. Changing THIS table later is a bump like any
> other."*

So `SCHEMA_SHAPE` stays `"m4.cohorts-mix-lanes.1"` and no database is dropped (ADR-0011). Nothing
here changes a column. `deleteProject`'s transaction takes both tables, so a deleted project cannot
orphan a token; `deleteRun` and a sweep take neither, because **an issue number outlives the
cluster, the run and the study that reported it** — the ledger is scoped to a project, which is
also why it sits among the authored rows in DATA-MODEL §1 although no human types it.

**No signature join table, deliberately.** The one query the ledger exists for is *"does any of
these N signatures already appear in any filed set?"*, which SQL wants as a join table or a lifted
column. Both cost a second write that has to stay consistent with the blob, and there is no
migration framework to repair a divergence once one exists — a ledger that disagrees with itself
re-files every issue in somebody's repository, which is the exact failure the ledger is for. So
`matchFiledIssues` intersects in memory over one repository's rows, which
`(project_id, provider, repo)` reaches as the leading columns of the primary key.

### 2. The key is a SET of member signatures, not the representative

**This is the central technical decision of this record, and the obvious design is wrong.**

The obvious key is `ClusterCardView.signature`. It does not work, because that field is the
*representative* of a clustering over one window's findings, and `pickRepresentative`
(`packages/reports/src/cluster.ts`) **sorts on verdict score first**. Verdicts are written by the
digest, *after* the run. So: file at the end of an execution, build a digest, and the same cluster
now presents under a **different** representative. The key moves inside a single execution, with
nobody having reworded anything, and the second pass files a duplicate.

What is actually stable is the individual finding's own `signature`: the runner computes it once at
file time from `kind | primary tool | sorted title tokens` and never recomputes it. So:

- A ledger row records **every** signature the cluster it filed contained, and grows: a match adds
  the candidate's new signatures, a sighting for the window being reported on, and — only when one
  went out — the absence notice, all in **one atomic growth** rather than a read-modify-write,
  because the single-problem route runs outside the serial queue and a `get` plus a `save` would
  drop one of two interleaved passes' signatures.
- A candidate is already filed if **any** of its members' signatures appears in **any** filed set.
- On a match, the candidate's new signatures are added to that row, so the set grows and drift is
  absorbed rather than forking.

Three consequences follow and each is a decision:

- **The match is scoped to a repository, not to a project.** `provider` and `repo` are part of the
  key, because re-pointing a project at a second repository is one PUT and a dev/qa split inside one
  project is the intended shape (ADR-0035). Match on the project alone and every candidate
  afterwards matches a row filed into the *old* repository: the publisher comments where the token
  is not scoped and the new repository never receives an issue at all.
- **A candidate may match more than one row.** `clusterFindings` is greedy over titles at a 0.3
  Jaccard floor, so a later report whose title bridges two previously separate problems produces one
  cluster intersecting two rows. The **oldest wins** — it is the issue a reader has been following —
  and the rest are marked `supersededBy`, so an orphan is a stated outcome rather than an accident.
  A superseded row is kept, not deleted; it is what stops a third filing if the clusterer stops
  bridging.
- **The same intersection settles triage.** A card looks its triage row and its filed issue up by
  the member set, through one `oldestMatching`, for the same reason: looked up by the representative,
  a card would read "not filed" and "not triaged" in precisely the case both records exist for — the
  problem whose key flipped after it had gone out as an issue, or after somebody had declined it.
  ADR-0028 is amended to say so.

### 3. A hidden marker in every body, as the second line of defence

Every body opens with a block of `<!-- populace-problem-sig1-<hex> -->`, one per member signature,
up to twenty-five. The signature *is* the hash a marker wants, so the marker is that and not a
second derivation of it; the colon becomes a hyphen because GitHub tokenises punctuation and a run
of word characters and hyphens is what comes back from a quoted-phrase search. The markers go at the
**top**, because `fitIssueBody` cuts from the end — a marker lost to the cut is a defence present
exactly when it is not needed.

Before creating anything, a candidate the ledger did not match is searched for in the repository —
and **the two numbers are deliberately different: twenty-five markers are written, at most three are
searched.** Writing them is free, asking is not: search is a rate-limited endpoint of its own,
roughly thirty requests a minute, so three per new problem is already a hundred and twenty requests
across a bulk pass of forty. Searching happens only where the ledger did not match, so a repeat pass
asks nothing, and a marker is asked about once per pass however many problems share the wording. The
cost of the asymmetry is real and is the right way round: a problem whose body carries a marker
outside its own first three signatures is not found by search, so a lost ledger re-files it.

**What this survives is the local ledger being gone.** The store has no migration framework: a
`SCHEMA_SHAPE` change drops every table and rebuilds it. Without a marker, one schema change
**re-files every issue in somebody's repository** — and the same is true of a database copied
between machines, or restored from a backup taken before the last twenty issues went out. The
marker is the only part of the dedupe that lives where the issues do.

**And a search that could not answer is not a search that found nothing.** `searchIssues` returns
three answers, not two, because a rate-limited search and an empty repository read identically
through an empty list and lead to opposite actions. Read as "nothing found", one 403 files a
duplicate of every problem whose ledger row is gone. So a marker search that was refused **refuses
to create**, and the first refusal stops every later search in the pass. A skipped issue can be
filed by running the pass again; a duplicate in somebody's public tracker cannot be taken back.

### 4. What this does not solve, stated as the limit it is

**A finding reworded from scratch gets its own issue.** It shares no member signature with what was
filed, and reworded titles do not merge at the clusterer's 0.3 Jaccard floor either. ADR-0028's
amendment measured this and the number is a cliff rather than a curve:

| The second execution's wording | Signatures that recur |
| --- | --- |
| Identical | 4 of 4 — 100% |
| Same words, different punctuation and filler | 4 of 4 — 100% |
| The same complaints reworded from scratch | **0 of 4 — 0%** |

**0% is the figure this feature inherits and does not improve.** A signature is a hash of an exact
token set, so one different content word is a different key by construction, and neither the ledger
nor the marker can see through that — both are keyed on the same hash. The backstop is human: the
**already-filed column** on the bulk dialog, read off `ClusterCardView.filedIssue`, so a person sees
"#41" beside a near-duplicate before pressing. That is a guard, not idempotency, and this record says
so rather than claiming a property it does not have. The only thing that moves the number is a
semantic signature, which is a later decision (DATA-MODEL §12).

### 5. Publishing spends nothing and dials nobody's product

`publishIssues` is one function behind all three triggers — one problem from its own page, a bulk
job, and ADR-0045's automatic cycle. They differ in who asked and what they do with the answer, not
in what happens.

- **No model spend.** The job's `costUsd` is 0. Nothing here verifies: verification lives in the
  digest, which the cycle enqueues *first* for exactly that reason.
- **No MCP session to the target.** The clusters come from one `StudyContext` built with an empty
  `ToolUsageView`. `GET /results` builds its coverage panel through `coverageOf`, which opens a live
  session using the operator's sign-in grant threaded off the request — and a filing job has no
  request and must not dial somebody's product. Clusters never read coverage.
- **One context for the whole pass.** `ProjectReadModel.cluster()` rebuilds the entire context per
  call — every execution, every visit, every report, two clustering passes — so forty issues off
  forty calls would be forty full recomputes over one set of rows. `publishable` hands the detail
  back beside the card.
- **The ledger row is written per issue, before the next one**, so a process that dies mid-pass does
  not re-file what it already sent.

**Hard skips, whatever a filter says:** `praise` has nothing to fix; a `settled` signature and a
`duplicate` are a human's judgement standing; and `state === "fixed"` — `resultCards` deliberately
adds a card per signature an earlier window reported and this one did not, and **filing an absence
is exactly what ADR-0028 forbids.** Then the connection's filter narrows by kind, severity and
`onlyConfirmed`; it never widens.

**No triage row is ever written.** Manufacturing a judgement nobody typed would make the finding
page say a human settled this minutes ago and hand `drifted` a `titleAtTriage` no human stood
behind. The filed issue reaches the screens through `ClusterCardView.filedIssue` and
`TriageView.filedIssue`, both read off the ledger, and `Triage.externalRef` stays whatever a person
typed.

**Two events**, `issue.opened` and `issue.commented`. Both comparable third-party-mutating actions
already append one — `target.reset` and a sweep — and this is the first that writes somewhere the
study never visited, so it is the last place that should be silent. Not `*.filed`: `finding.filed`
already means a *person* wrote a report.

### 6. The third credential class

The token is **yours, to a third party that is not the target**. ADR-0036 describes two credentials
and ADR-0037 says populace holds no vendor credential at all; both are amended, because this is a
third kind and the rule about it is simpler than the other two rather than harder:

> **It never reaches `runWake` or `McpSession.connect` at all, under any name. It never enters a
> `ConfigSnapshot`, a trace, an event payload or a log line. It never comes back down the wire.**

There is no legitimate path by which the code that talks to somebody's product should be holding the
code that talks to their repository, and a token that arrived at a wake would be sent to a
stranger's MCP server as a bearer. Its own table is what makes that structural: nothing that
assembles a config, a snapshot or a view can reach it by walking a blob it was already holding
(ADR-0040). `PopulaceConfig` is assembled field by field with no passthrough, and `redactConfig`
gained a `github`/`token` clause anyway, because defence in depth is cheap and that function's
enumerated-paths design is not.

On the wire: `GithubConnectionView` carries `tokenSet: boolean` and never the token; `PUT` follows
the established write-only round trip — **absent keeps, `""` clears, a value replaces** — and the
UI says *a token is stored*, never a value.

### 7. A public repository is a different risk

An issue body carries `product.endpoints[].url` — the target's real MCP address — plus the product
description and every hit cohort's brief. On a public repository that publishes an internal staging
address and the study's setup, and a regex miss stops being an awkward paste and becomes a
credential to rotate.

So the check records `visibility` as it **found** it, not as anybody typed it; `unknown` is the
default, so nothing treats an unchecked connection as safe.

**The reduction fails CLOSED: it fires unless the repository is known private.** The test is
`connection.visibility !== "private"`, not `=== "public"`, and the difference is the state populace
is in most of the time — `unknown` is the default, it is where every connection sits until somebody
presses Check, and it is where one lands again the moment it is re-pointed. On the narrower test the
automatic path published the target's real endpoints into a repository populace had no idea was
world-readable, so an unknown repository is treated as public and told so in the body's own words.

**And the reduction is a narrowing of the addresses populace was configured with, not a scrub.** It
replaces every absolute URL whose host is one of *this* target's hosts, wherever it appears — the
endpoint list, the report's prose, the people's quotes, the reproduction and the replay, arguments
and results alike, the judge's reason — each edit marked in place, because the fix prompt tells its
reader every removal is marked. Nothing else is touched, and **the body says so itself**: *"Nothing
else is scrubbed. The product's own replies are quoted as they came back, so any other address,
identifier or internal name they printed is here in full."* The product description and every hit
cohort's brief go out as written. That sentence is the limit, and it is in the body rather than only
in this record because a reader told "addresses are reduced" and not told the rest will file into a
world-readable tracker believing the body was sanitised — which is the risk, more than the body is.

The confirmation is where somebody takes that on knowingly: the bulk press and the single press both
go through a `ConfirmButton` whose copy, on a public repository, names it as public and states what
is reduced and what is not. It is the same one press rather than a second dialog, and **the
automatic cycle has no confirmation at all** — `autoFile` is the only thing anybody consents to, and
it is consented to once.

### 8. A repeat comments; it never re-files. A closed issue is reopened without the word "regression"

A problem reported again gets a comment on the issue it already has, every window it is true of —
"reported again" is news each time. **An absence is not.** A gone-quiet comment goes out **once per
piece of news**: the notice is recorded on the ledger row and keyed `(studyId, since)`, where
`since` is the study-wide ordinal of the last window that *did* report the problem, so every later
quiet cycle looks back at the same report, carries the same `since`, and is skipped. Unbounded, it
was the absence written again with a bigger number in it every window for the rest of the study's
life — on ADR-0045's default hourly rhythm roughly a hundred and seventy comments a week, on exactly
the issues whose repairs had just worked. The problem coming back and going quiet again looks back
at a **later** window, so it is news once more, with the `regressed` comment's own announcement in
between. It is keyed by study as well as by issue because a project holds several studies against
several targets (ADR-0035): a dev study falling silent is not the qa study's news.

A **closed** issue is reopened, and the comment that goes with the reopening says:

> *"This issue was closed, and populace has reopened it because the problem was reported again.
> populace cannot tell why it was closed — a repair, a triage decision, a duplicate, a tidy-up — and
> is making no claim about that."*

**The word "regression" is not in it, and the reason is a distinction rather than a squeamishness.**
`regressed` is a word populace may use about *its own observation sequence* — present, absent,
present again across report windows — which is what `signatures.ts` defines it as. Calling a reopened
issue a regression is a different claim: it says the problem was **fixed** and came back, which
asserts that somebody closed the issue because they repaired it. populace cannot know that. A closed
issue is a fact about a tracker, not about a product, and the two get conflated the instant the word
is used. "fixed", "verified", "resolved", "no longer reproducible" and "still broken" appear in
nothing this code writes; "fixed" is a human's word, typed on the triage control
(`DESIGN-SYSTEM.md` §7.3).

An issue is the most public copy populace produces, and a title lands in a search index that
outlives the issue being edited or deleted — so the vocabulary rule binds harder here than anywhere
else: "agent", "wake", "simulation" and "lane" appear in no title, body or comment (ADR-0032,
ADR-0042), and `issueTitleOf` runs the title through `redactText` too, because "the cluster title
verbatim" would be a path around the redaction funnel.

### 9. The routes, and where the fix prompt now lives

`routes.github(p)` — GET, PUT, DELETE — and `routes.githubCheck(p)`, POST, whose body may carry an
unsaved token (the `ProvisioningCheckBody` precedent) and which answers in the remote's own words:
`ready`, `unreachable`, `refused`, `no-issues` (a repository with issues switched off), `expired` —
fine-grained PATs expire, and a dead token is reported the way `signInStatus` reports a dead grant.
`routes.studyIssue(p, s, signature)` files one problem synchronously, 201 when an issue was created
and 200 when it was commented on, skipped or failed. `routes.studyIssues(p, s)` files in bulk as a
job and answers 202 with the job row. **The synchronous route runs outside the
serial queue**, so it takes the same ledger-and-marker path: a double-click, or a click during a
running job, would otherwise file twice.

The connection is a section on Settings, not a new noun, so ADR-0043's list-and-builder rule does
not apply to it.

`buildFixPrompt` moved out of `packages/web` into **`@populace/fix-prompt`**, a leaf package
depending only on `@populace/contract`, because the server now writes issue bodies with it and the
dashboard is not a dependency of the server. It gained `fitIssueBody` — a GitHub body is capped at
65,536 characters and ten error results plus a replay exceed it, so the cut is made where it can be
marked rather than by GitHub answering 422 — and `issueTitleOf`.

## What this supersedes

- **`docs/architecture/DATA-MODEL.md` §12:** *"**No cross-run 'issue' entity.** Cluster signature
  plus triage covers what the compare and Known screens need. A first-class Issue that outlives
  clusters is a product decision nobody has made."* — **filing issues makes that decision.** An
  issue number outlives the cluster, the signature, the run and the study. What §12 still denies is
  correct and is now narrower: populace stores no issue *state* and no issue *body*, and it is not
  the system of record for anything in the tracker. §12 is amended rather than deleted.
- **ADR-0028**, whose amendment is written beside this one: a triage row is matched by signature-set
  intersection, not on the representative, and populace may now write an external reference of its
  own — through the ledger, never by overwriting the human's `externalRef`.
- **ADR-0037:** *"populace calls it with one shared secret and holds no vendor credential at all."*
  — true of the target and false of populace, which now holds a token to github.com. Amended there,
  with the taxonomy amended in ADR-0036.
- **CLAUDE.md**, *"Two credentials, and they must never be confused"* — three, and the file says so.

## Consequences

**Store impact first: two new tables, no column changed, `SCHEMA_SHAPE` untouched at
`"m4.cohorts-mix-lanes.1"`, no database dropped.** `Store` gained `saveGithubConnection`,
`getGithubConnection`, `deleteGithubConnection`, `saveFiledIssue`, `listFiledIssues`,
`matchFiledIssues` and `growFiledIssue`; `RecordingStore` in `packages/server/src/events.ts`
implements `Store` by hand-delegating, so a missing method was a compile error rather than a silent
gap. `deleteProject` deletes both tables' rows inside its existing transaction.

**Two new job kinds** (`issues.publish`, `issues.cycle`) and **two new event types**
(`issue.opened`, `issue.commented`). `jobs.kind` and `events.type` are `TEXT`, so neither is a
schema change. ADR-0027's amendment carries the queue consequences.

**A third judge**, `typesafe`, joins `VerifierConfigSchema.judge` and `Verification.judge`. Both are
inside JSON blobs, so old rows keep their values and nothing migrates. It exists because ADR-0045's
cycle is a digest on a clock, and the default judge is the most expensive model in the table at high
effort — see that record and the hazard below. **What it costs is a published price and a measured
request, not a bill:** $0.042 per million input tokens with output free, against Opus-high's $5 in
and $25 out, over a request `stability.test.ts` measures for five real findings replayed against
Tasklet — worst case ~1,705 tokens for the whole request, ~957 of them state, against a 32k-token
state cap. The dollars-per-finding that follows is arithmetic over that price, and nobody has run a
month of cycles to check it. Its two thresholds are **not yet calibrated** either, and the suite
that would calibrate them cannot measure the model at all offline — so it declines to make the typed
judge a default. The shipped default is still `model`; the judge the suite trusts for an unattended
pass is `heuristic`, which costs nothing and is the one thing here that is measured end to end.

**The dashboard must be rebuilt with the server.** `packages/web/src/api.ts` parses job rows through
`JobKindSchema`, so a browser holding an older bundle rejects a `issues.publish` row.

**`@populace/fix-prompt` is a new package in the build graph**, registered in
`tsconfig.build.json` after `contract`, in `packages/server/tsconfig.json`, in both package
manifests, and as a vite alias so `pnpm dev` works on a clean tree. `packages/web/src/format.ts`
re-exports `people` and `plural` from it so there is one definition; forty files importing them from
`format.js` did not change.

**Tests run offline with no key and no network.** Every outbound call is behind an injected
`FetchLike`, and `publish-issues.test.ts` asserts against rows: one issue per surviving cluster and
none for `praise`, `wont-fix`, `duplicate` or an absence card; the within-one-execution
representative flip producing one issue and one comment rather than two issues; a mid-batch failure
keeping what was already filed; **no MCP session opened by publishing**; and no title, body or
comment containing "agent", "wake", "simulation", "lane", "regression", "fixed" or "still broken".

**Where the token is asserted absent, named exactly, because a list of surfaces nobody checks is
worse than a short one.** Four places, and they are the four that can carry it out of the process:
the **raw response text** of `GET`/`PUT` the connection route, asserted as text and not as a parsed
view, because the literal that looks right — `{ ...connection, tokenSet: … }` — typechecks clean and
puts the token on the wire (`control.test.ts`); a **`ConfigSnapshot`** through `redactConfig`, with a
`github` block forced in by `Object.assign` because `PopulaceConfig` has no such field
(`control.test.ts`); every **event payload** and every **ledger row**
(`publish-issues.test.ts`, `report-cycle.test.ts`); and everything the fake GitHub client received —
title, body and comment alike. Also asserted: the publisher's own **refusal message** names what is
missing and nothing that is stored, and `github.ts` **redacts the remote's words** before they are
quoted, so a 403 that echoes the `Authorization` header back does not become a job row. There is no
assertion against the `/settings`, `/overview`, `/needs` or `/results` bodies; the token never
enters those views' shapes, and if that is worth a test it is not written yet.

**What is knowingly left open:**

- **`autoSweep` still ends the verifiability of everything an ephemeral study filed — but the
  ordering is now structural rather than warned about.** The sweep is a **job**, which is what
  `SWEEP-AND-VERIFY.md` named as the proper fix. `drive()` offers the terminal flush the teardown
  (`ReportTrigger.sweep`), and when the flush takes it `reportIssuesWith` enqueues it **third** on
  the strictly serial FIFO, behind the digest and the filing: digest → filing → sweep, which a queue
  with no cancellation cannot reorder. "Enqueued before the sweep" was never the same thing as "runs
  before the sweep" — the flush only *queues* a digest, so a sweep on the next line tore the
  accounts down while that digest was still draining, and whether a verdict read the product or said
  "the account that filed this was removed" came down to which pass got there first, with nothing on
  the outside saying which had happened. `drive()` now sweeps inline only on the paths where the
  flush declined the teardown — no reporter, filing not armed, nobody visited, or the flush threw —
  and the loud warning survives for exactly the reporter that declines it.
  **What it still costs:** the accounts are gone once the pass drains, so nothing filed from that
  execution can be checked *again* — a later digest, a manual re-check or a `--continue-from`
  execution all get "the account that filed this was removed", and the issue in somebody's
  repository is as checked as it will ever be. And the move has a real price of its own: a process
  that exits between the report and the sweep leaves the accounts on the target, where before they
  went inside `drive()`, which `shutdown()` waits for. `jobs.reconcileOrphans()` fails the row on
  the next start and the run's `sweptAt` stays null, so the execution is still discoverable as
  unswept and `populace sweep` still removes them; findings with no accounts behind them are the
  worse of the two, because nothing about them says so.
- **`autoSweep` has two conflicting defaults, and the one that wins is the one that costs.** `false`
  on `SimulationContextSchema` (`packages/core/src/schemas/simulation.ts:79`) and `true` on
  `SimulationSchema` (`:137`). Which applies is a matter of path, not of preference: a **saved
  study** resolves its context off the row (`contextOf`), so every ephemeral study made in the
  dashboard sweeps by default, while the context's `false` is what a hand-built or YAML config that
  has never heard of studies gets — `config-store.ts` copies `autoSweep` up only for a named study,
  precisely so such a config cannot silently delete accounts. So the default an ephemeral study that
  files issues actually runs under is **true**: its accounts go at the end of every execution, and
  the only reason its issues carry checked verdicts at all is the queue ordering above. Whichever
  default is right, two is one too many, and the study is still not **refused**;
  `SWEEP-AND-VERIFY.md` carries the four options.
- **One repository per project.** The precedent for moving it is `autoSweep`, the other "outbound
  when a run ends" flag, which is per study.
- **No CLI command.** `populace issues`, or a `"github-issues"` entry in the existing `Exporter`
  plugin point, is what R4's CI mode wants.
- **A migration framework (D5) got sharper, not looser.** A long-lived database now holds a PAT and
  an issue ledger, and the roadmap already recommends the migration runner land *before* R2. A
  database holding somebody's fine-grained token is arguably the named trigger itself (ADR-0011
  amendment). The marker in §3 is what makes the interim survivable and is the strongest argument
  for reconciling against the repository rather than trusting local state.
- **The ledger holds no TRACKER state, only populace's own.** populace learns an issue is closed by
  asking at publish time and never otherwise, so nothing in the dashboard says "closed";
  `FiledIssueView` is a link and a number, on purpose. What the row *does* hold is populace's record
  of what it has observed and what it has already said — the sightings and the quiet notices above —
  which is a history of populace and not a mirror of the issue. The distinction matters the moment
  somebody wants a "closed" badge: that is a poll, a rate limit and a freshness question, and none
  of the three is in here.
- **R1 is still the gap that matters most.** Nothing here produces a returning person's verdict, and
  ADR-0045's reach evidence is not a substitute for one.

**The argument against, recorded so it is not re-discovered.** This is populace writing to somebody
else's server, unattended, in the most public copy it produces, keyed on a hash it already knows
recurs 0% of the time under rewording — and the failure mode is not a bad screen but forty
near-duplicate issues in a stranger's tracker, or one staging endpoint in a public repository, or a
schema rebuild re-filing everything. Every one of those is a thing a person cannot take back, which
is a category of risk nothing else in this codebase has. It was built anyway because the alternative
is what exists today: a product that finds four planted defects reliably and then requires a human
to copy each one out by hand, which means it is read once and never wired into anything. The
mitigations are structural rather than careful — the member-set key, the marker that outlives the
database, a refused search refusing to create, the hard skips, an explicit confirmation for a public
repository, the already-filed column — and the one that is not structural, the 0% rewording case, is
stated as the limit in §4 rather than papered over. What would change the decision is a measured
duplicate rate in a real repository over a month of cycles; if it is not near zero, the answer is a
semantic signature (DATA-MODEL §12), not tighter heuristics on the same hash.

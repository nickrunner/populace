# ADR-0045: A report cycle is the longitudinal analogue of an execution

**Status:** accepted 2026-09-30

## Context

The user's words, paraphrased faithfully in the brief this record implements:

> *"populace's longitudinal study then confirms the fix functionally over time, and files anything
> new or regressed."*

That sentence rests on a state machine, and **the state machine did not work for the mode the
sentence is about.**

`signatureHistories` (`packages/reports/src/signatures.ts`) is where a problem gets a state:

> *"- **new** — first reported in the latest execution.
> - **open** — reported in the latest and in at least one before it.
> - **fixed** — reported in an earlier execution, absent from the latest.
> - **regressed** — reported, then absent, then reported again."*

Every one of those is defined over a list of **executions**. And a longitudinal study has exactly
one execution for its whole life — one run, `seq` 1, for ever, because a longitudinal run has no
arithmetic end (ADR-0030). The file says so about itself, in a field comment:

> *"The window it has been seen in — the whole story for a longitudinal simulation, which has only
> ever one execution."*

So for a longitudinal study, `evidence` has one entry, `before` is empty, `presence` is empty,
`inLatest` is always true, and **every signature is `new` for ever.** `open`, `fixed` and
`regressed` were unreachable. Not approximate, not degraded — unreachable, for the one study type
the product's north star depends on.

Three things downstream were built on states that could not occur:

- **The results screen.** `stateOfCluster` in `packages/web/src/format.ts` had a **longitudinal
  branch**, with the words already written — `fixed` rendered as the badge **"gone quiet"** with
  *"not reported since <ago>"*, `regressed` as **"back"** with *"reported again <ago>"*. Both rows
  were **dead code**. Somebody wrote the right copy for a state the arithmetic could not produce.
  (That branch is no longer selected by mode; the words are the same and §7 of this record says
  what picks them now.)
- **The `settled` fold.** A signature a human marked `fixed` and which is `regressed` stays above
  the fold rather than collapsing into Known (ADR-0028's amendment). For a longitudinal study it
  could never be `regressed`, so it always collapsed.
- **Anything that files issues.** ADR-0044 leans on the state for every decision it makes: an
  absence card must never be filed, a repeat gets a comment, a problem that stopped being reported
  gets a "gone quiet" comment. All three are `new`-for-ever for a longitudinal study, which means a
  continuously running study would have filed each problem once, at the first cycle, and then said
  nothing about anything ever again.

## Decision

**A report cycle is the longitudinal analogue of an execution. The unit the state machine reads is a
REPORT WINDOW, and an execution boundary and a report cycle are both window boundaries. One code
path serves both modes.**

### 1. The arithmetic never actually needed a window to be an execution

`signatureHistories` takes `ExecutionFindings`, which is four things:

```
{ runId, seq, visited, findings }
```

— an identity, an order, whether anybody visited, and the reports. Nothing in it is about a run
except the name of the field. So it is enough to hand it **one entry per report window**, with a
synthetic identity per window, and **the existing arithmetic works unchanged**. Not adapted, not
parameterised: unchanged. `packages/server/src/report-windows.ts` builds the windows and
`toExecutionFindings` reduces each to that shape.

| observation across windows | state | what a comment says |
| --- | --- | --- |
| present in the newest window, never before | `new` | file it |
| present in the newest and an earlier one | `open` | reported again |
| absent from the newest, present earlier | `fixed` | **gone quiet**, said as an absence, with reach |
| present, absent, present again | `regressed` | **back** — reported again after going quiet |

`presence.at(-1) === false → "regressed"` is exactly *"went quiet, then came back"*, which is what
the longitudinal branch of `stateOfCluster` was already written for.

**The identity has to be per window, not per execution.** `signatureHistories` counts presence into
a `Set` of the `runId` it is given and keys its seq lookup by the same string, so handing it the
real run id for every window of one run collapses them into a single window and puts the bug
straight back. A window's id is `${runId}#c${cycle}`.

**`visited` is why an empty cycle is harmless.** A window nobody visited gets `visited: false` and
is filtered out of the evidence before anything is asked of it — the guard `signatures.ts` already
documents, written for an execution killed on the way up and correct here for a study whose people
come back every six hours. A cycle in which nobody visited says nothing either way, rather than
calling every open problem `fixed`.

**One more counting rule, because the windows made it reachable.** A visit that *spans* a boundary
counts as a visit to both windows for `visited` and for `visitors`, and only to the window it ended
in for `visits`. Otherwise a cycle landing mid-visit leaves that visit's reports sitting in a window
marked empty, and the per-window counts stop summing to the execution's.

### 2. One code path, and ephemeral is not a special case

The window sequence for a study is **every execution boundary and every cycle boundary, in order**.

- **Ephemeral** has natural windows already: sibling executions, `seq` 1, 2, 3. An ephemeral study
  normally has one window per execution, which is bit-for-bit what it gets today — so nothing about
  the existing behaviour changes, and every sentence `stateOfCluster` wrote about such a study it
  still writes word for word (§7).
- **Longitudinal** has one execution, so its windows are report cycles.
- **A long ephemeral run may also use cycles.** Twenty people at ten visits each is worth reporting
  from before it finishes, and that needs no special handling: it is just a study with several
  windows inside one execution, which is the longitudinal shape.

**Nothing branches on mode for the state machine, and nothing should.** The mode decides whether
cycles are *armed* — only a longitudinal execution arms them, because it is the one that never
reaches a terminal status and would otherwise have no boundary at all — not how presence is counted.
An ephemeral execution gets its last window closed by ending.

### 3. Inside an execution, only a job of the dedicated `issues.cycle` kind closes a window

Window boundaries cost no new state: they are read off the jobs table, which already carries
`run_id`, as the `endedAt` of each **succeeded `issues.cycle`** job of that run. Findings partition
by `createdAt`, visits by their own start and end.

**Two rules narrow that, and both are what keep the ephemeral case identical to today's**
(`reportWindows`). A boundary counts only where it falls **strictly inside** the execution — after
`startedAt` and before `endedAt` — and an execution's own end closes its last window. So a boundary
at or after a finished execution's end closes that last window rather than opening a permanently
empty one after it, which is precisely where the terminal flush's own job lands: `drive()` writes
`endedAt` on the run before it enqueues the report, so the flush's `issues.cycle` row ends *after*
the execution did and adds no window. An ephemeral study reported once per execution therefore has
exactly one window per execution, flush or no flush. Duplicate boundary timestamps collapse, and a
run row handed over twice is de-duplicated by id before anything is counted.

**The kind is its own, and the reason is a bug that was found by sharing one.** Closing a window
means *"populace has reported on everything up to here"*, which is a claim the automatic cycle makes
and a human pressing "File all" does not. Read off `issues.publish` — the kind the bulk press and
the single-problem press both run under — **one manual press silently advanced the state machine**:
the next cycle found a window opened at the moment of the press with nothing reported in it yet,
read that as an absence, and commented **"gone quiet" on every issue in the repository** — in
populace's most public copy — because somebody had clicked a button twice.

So the automatic cycle carries `issues.cycle` and nothing else closes a window. The cost of the
split is one direction of wiring error: a cycle enqueued under the *other* kind reports normally and
leaves the boundary unrecorded, so the next cycle reports over the same stretch of time again rather
than over a wrong one. That is the safe direction of the two, and it is said in the code at both
ends.

### 4. The trigger is `onWake`, and there is no new timer

`DaemonOptions.onWake` already exists and `RunController.build` already passes one, for job
progress. The cycle counts visits there and asks, on each one: have `everyVisits` visits or the
elapsed deadline passed since the last window closed? If so, enqueue.

- **No `Scheduler` change.** Its contract is `(agent, cadence, now)` and `null` retires an agent; a
  report is not an agent.
- **No interval in `serve.ts`**, which today contains none.
- **No timer at all, and the argument is not laziness.** A report window has nothing to say until
  somebody has visited. If nothing is happening there is nothing to report, so a clock that fires
  into an idle study produces an empty window, which is correctly read as no evidence and is
  therefore two jobs spent to say nothing. The trailing window of a study whose people all walked
  away is covered by the terminal report: `daemon.run()` resolves, the run settles `completed`, and
  the final flush reports what is left (ADR-0044 §5).

**Configured as `ReportCycleSchema` on the study**, modelled field for field on `CadenceSchema` —
the same shape asking the same question about a person, *how often does this come round and how much
does it scatter* — so it layers and snapshots the way cadence already does rather than inventing a
second idiom. It rides in `SimulationContext`, which means it is read off the **frozen snapshot**
exactly as `autoSweep` is: editing the study while it runs does not change the rhythm of an
execution already in flight, and "apply changes" is what replaces it.

`jitter` defaults non-zero (`5m`) for the reason commit `f03c5f1` made cadence jitter non-zero —
*zero jitter is a herd* — and it matters more here: two longitudinal runs started in the same minute
would not merely report in lockstep, they would **queue behind each other** on a strictly serial
FIFO and delay every sweep and target check sitting there. The deadline's jitter is rolled **once,
when the window opens**, exactly as `CadenceScheduler` rolls a person's: rolling per check makes a
cycle fire as soon as one roll comes up small, which is a coin flip pretending to be a schedule.

`everyVisits` defaults to 25 so a quiet study does not report six empty windows for every full one.

### 5. The cycle body is digest, then publish — in that order, and it skips rather than stacks

Two enqueues onto the serial FIFO: `digest`, then `issues.cycle`. The terminal flush of an
ephemeral study that sweeps adds a **third**, the teardown, behind both — see ADR-0044's `autoSweep`
hazard for why the ordering had to become structural rather than hoped for.

- **Digest first**, because verification lives only in the digest. With the filing first, a
  connection set to `onlyConfirmed` would file nothing at all, for ever, and say nothing about why.
  The queue is strictly serial, so enqueueing in order *is* the whole implementation of "in that
  order".
- **Skip, never stack.** If a cycle is still in flight the next one is skipped. `JobRunner` is a
  strictly serial FIFO with no delay, recurrence or cancellation (ADR-0027), so a stacked cycle
  would block sweeps, target checks and a run start behind it — and the work it would do has not
  changed in the meantime anyway.
- **A failed cycle must not tear down the run.** `configForRun` throws when live credentials cannot
  be restored, and a long-lived study whose target somebody deleted should go on visiting and stop
  reporting rather than fall over. The enqueue is detached, the rejection is taken so it cannot
  become an unhandled rejection, and the job row is where the reason is read.

### 6. What a "gone quiet" comment may claim

This is the payload of the whole loop — the comment that appears after a PR lands — so what it may
say matters more than anything else here. **It uses the product's existing vocabulary verbatim**,
which is `stateOfCluster`'s and `verdictWords`': *gone quiet*, *not reported*, *back*, *reported
again*, *did not recur*, *unsure*. Forbidden outright: "fixed", "verified fixed", "resolved", "no
longer reproducible", "we confirm the fix" (`DESIGN-SYSTEM.md` §7.3). `NOT_A_REPAIR` — *"an absence,
not a repair"* — is carried into the comment verbatim.

**And it names who is missing, because the reach evidence has a hole in exactly the place it
matters.** `problemReach` counts participations in buckets that add up:

- People who hit the problem and **kept going** do come back, carrying memory, with no carry-forward
  needed — memory is keyed `(runId, agentId)` and `maxWakes` is null for a longitudinal study. Their
  continued non-reporting is real evidence and it is free.
- People who **walked away over it** do not. A `gave_up` visit sets `status: "retired"` and
  `nextWakeAt: null`, and `listDueAgents` selects `status = 'active'`, so **a person who quit over
  this problem is never heard from again inside the same execution.** Their silence is not a
  judgement and is reported separately, or the comment puts words in the mouth of somebody who left.
- A participation a **limit** stopped — a visit cap, a scale-down, a paused execution — did not walk
  away and did not pass judgement either, and is its own bucket.
- `stillActive` requires the **execution** to be running as well as the row to be active: a
  participant row keeps `status: "active"` when its execution is paused, so read off the row alone
  populace would tell a reader people are still visiting a study that stopped days ago.

So the comment says what it can support and no more:

> *Not reported in the last 3 report cycles. Of the 5 people who hit this, 4 are still visiting — 11
> visits between them since it was last reported — and none has reported it again. 1 walked away
> over it and has not been brought back. This is an absence, not a repair.*

**And it is said ONCE per piece of news, not once per window.** Nothing bounded this at first:
once a filed problem stopped being reported, every later window wrote the absence again with a
bigger number in it — on the default hourly rhythm roughly a hundred and seventy comments a week,
landing on exactly the issues whose repairs had just worked, so the one comment a developer is meant
to read became the reason they muted the issue. The notice is now recorded on the ledger row
(`FiledIssue.quietNotices`, written in the same atomic growth as the comment it accompanies) and
compared on **what** went quiet rather than on when somebody published: `since` is the study-wide
ordinal of the last window that *did* report it, so every later quiet cycle carries the same `since`
and is dropped as the same news. A problem that comes back and goes quiet again looks back at a
later window, so it is news once more — and its coming back is the `regressed` comment's own
announcement in between. `since` is nought where populace has no report of the problem on record at
all, which is the marker-search case: an issue older than the ledger row that found it. A **repeat**
is not bounded this way and needs no bounding — "reported again" is news every window it is true
of.

Two further rules. **Every number is counted over the same stretch of time as the sentence it sits
under** — a per-window count under a lifetime sentence is a false claim, not a rounding error — and a
lifetime total is said on its own line with its scope named. §7 is the same rule applied to the
screens, where it was got wrong most often and hardest to see. And populace's own word `regressed` is
about **its own observation sequence** and nothing else; it may not be used to say a fix came undone,
and an issue reopening carries no such word (ADR-0044 §8).

### 7. One judgement decides whether a sentence may name an execution, and it is not the mode

Defining the window made every number in the product answerable to two scopes, and the failure
mode that followed is the one this record has to be read for: **a number counted over one scope
printed under a sentence describing the other.** It was found four separate times while this
feature was being built, and twice it was a *guard against it* that looked right.

So the judgement is made in exactly one place — `executionScoped` in `packages/web/src/format.ts`
— and both writers of the sentence read it from there: `stateOfCluster` for the finding page's
header and `stateDetail` (`design/organisms/ClusterRow.tsx`) for the results row.

**It is not the study's mode, and mode was the subtler of the two bugs.** `stateOfCluster` asked
`mode === "longitudinal"` while the row asked whether the card's own two scopes agreed. Both gave
the right answer only because §4 arms cycles for a longitudinal execution alone: the moment an
ephemeral study is given cycles — which §2 says is the whole point of one code path, and which this
record's own "long ephemeral run" case asks for — mode says *name executions* about a card whose
state was computed over cycles, and a window ordinal goes back out under the word "execution".
`mode` is still a parameter because every call site has one to hand; it decides nothing.

**And it is exact rather than a length comparison**, which was the other bug and the one with a
passing test in front of it. "The two lists are the same length" admits two false cards:

- a problem reported in **exactly one window**, which has one entry in each list however many
  windows the study has had. The row said *"last reported in execution 1"* about a longitudinal
  study whose only execution was still running and still being visited;
- a long ephemeral run with cycles, where a problem reported in windows 2 and 3 falls in
  executions 1 and 2 — two entries each, four different stretches.

The rule is therefore: the ordinals must be the **same list**, which is what one window per
execution produces and the only arrangement in which window `k` is execution `k`; and an absence
(`inLatest === false`) additionally needs the execution being read to be **strictly later** than
the last one that reported it, because otherwise the window that went quiet is another cycle of the
execution the card already names. With no execution to measure that against, the answer is no.

Everywhere the answer is no, the screen says the time-based thing instead — *"not reported since 7
hours ago"* — which is true at either scope and is the better sentence for a soak anyway. One case
of a longitudinal study does name its execution, and it is honest: a study whose newest visited
window is its first has one window and one execution, so the two scopes are the same stretch.

## What this supersedes

- **Every sentence in `packages/reports/src/signatures.ts` that said "execution" and meant
  "window".** The arithmetic was handed windows the moment this decision shipped, and the doc
  comments were the last thing still describing the old unit — which matters more than tidiness,
  because `SignatureHistory.seenIn` *is* a list of window ordinals and a caller reading its doc as
  executions prints a falsehood. The whole block is amended rather than one line of it:
  - `SignatureHistory.seenIn` read *"The `seq` of every execution that reported it, ascending."*
    It is now the `seq` of every report **window** that reported it, with the reason it is the
    field most likely to be mis-printed and a pointer to `executionSeqsOf` in
    `project-read-model.ts`, which is what maps them back to executions and collapses them.
  - `ExecutionFindings.seq` read *"The execution's ordinal within its simulation."* It is the
    **window's** ordinal across the whole study: `toExecutionFindings` passes
    `ReportWindow.ordinal`, because two cycles of one execution that share a `seq` are one window
    as far as the arithmetic is concerned.
  - `SignatureState`'s four definitions said "the latest execution" and now say "the latest
    window". The arithmetic they describe is byte-for-byte unchanged, which is the point of §1 —
    only the unit they are written in is, and under the old wording they described the behaviour
    of an ephemeral study and misdescribed a longitudinal one.
  - `ExecutionFindings.visited`, `SignatureHistory.inLatest`, `SignatureHistory.reports` and the
    `evidence` filter's own comment likewise: a window with no visits in it is now named as what
    it also is, a report cycle that fell while a study happened to be idle.
  - The field comment that read *"the whole story for a longitudinal simulation, which has only
    ever one execution"* says so in the past tense, with the timestamps named as the finer-grained
    answer and the only one when a caller passes a single window.

  The type is still called `ExecutionFindings` and the parameter `executions`, and the doc says
  to read both as windows: renaming them touches every caller for no behaviour.
- Nothing in ADR-0030 is reversed. An absence is still weak evidence and a later presence is still
  weak evidence of a regression; `regressed` is still reserved for the informative shape. What
  changes is that a longitudinal study can now have that shape at all.

## Consequences

**Store impact first: none.** No table, no column, no `SCHEMA_SHAPE` change. A window boundary is
the `endedAt` of a job row that already exists, findings partition by a `created_at` that already
exists, and `listJobs({ runId })` already takes a run. The only new persisted thing in this feature
is ADR-0044's two tables, and neither of them holds a window. The two new job kinds go in a `TEXT`
column.

**`report-windows.ts` is a pure module.** Nothing in it reads the store, so every hard case — a
window nobody visited, a boundary landing mid-visit, a person who walked away and therefore cannot
pass judgement, an execution deleted under a finding — is reachable from a test with a handful of
literals, offline and with no key.

**Two dead branches of `stateOfCluster` can come to life**, and they are the reason this is worth a
record of its own rather than a paragraph in ADR-0044: the results screen reads its histories over
windows now (`ProjectReadModel.studyContext`, `historiesOf(windows, …)`), so a longitudinal study's results
page can say *this problem has gone quiet* and *this problem is back* without a single issue being
filed. **What it cannot do is get there with no repository connected**, and that limit is worth
stating plainly because it is the opposite of what the read model's shape suggests. A window
boundary inside an execution is a succeeded `issues.cycle` job, and the only thing that enqueues one
is an armed cycle: `armCycle` is off entirely without a reporter, and `filingArmed` refuses unless
the project has a connection with a repository, a stored token and `autoFile` switched on. So a
longitudinal study with no repository still has exactly one window, `inLatest` is still always true,
and those two branches are still dead for it. The arithmetic is fixed; the boundaries are not free,
and reading the results page is not what pays for them.

**An ephemeral study's behaviour is unchanged.** One window per execution is what it had; the code
path is shared rather than replaced.

**What is knowingly left open:**

- **The scope judgement belongs to the producer, and it is on the client.** `executionScoped` (§7)
  infers from a card's two lists what the read model knows outright: it built the windows, so it
  knows whether this study has one per execution. The honest shape is one boolean on
  `ClusterCardView` — *these two scopes describe the same stretches* — computed once where the
  windows are, which would also stop the inference needing an execution to measure an absence
  against and would be right on the compare screen, where the card's lists are study-wide and the
  screen's `currentSeq` is one of the two executions being read. What is here is correct for every
  view populace serves today and is one place rather than two; it is the field that should replace
  it.

- **The judge's default is the most expensive model in the table, and an unattended cycle would
  spend on it for ever.** `VerifierConfigSchema` defaults to `judge: "model"` with `claude-opus-5`
  at `effort: "high"` and `maxFindings: 50` — a defensible price for a digest somebody asked for and
  an indefensible one for a cycle that turns over by itself for as long as a study runs, which on a
  default hourly rhythm is up to 50 Opus-high judge calls an hour, for ever, regardless of what the
  population itself ran. The verifier's own comment already notes that "with thinking on, headroom
  here is spend". **The default was not changed**, because the judge decides what reaches the digest
  and lowering it quietly would change every digest anybody asks for. What was added is a third,
  cheap, typed judge (`judge: "typesafe"`, ADR-0044) and an explicit refusal rather than a silent
  downgrade when a configured judge has no key. **The typed judge's cheapness is a price-table
  figure plus a measured request size, and neither is a bill anybody has paid.** Jev charges $0.042
  per million input tokens and nothing for output, against Opus-high's $5 in and $25 out — a
  published price, not a measurement. What *is* measured is the request: `stability.test.ts` builds
  the real thing for five real findings replayed against Tasklet and prints the worst — state 2,869
  characters (~957 tokens at a pessimistic three characters per token), whole request ~1,705 tokens,
  against a 32k-token state cap — and the cost arithmetic is asserted over a scripted usage figure,
  which is what makes "three orders of magnitude under an Opus-high verdict on the same evidence"
  arithmetic rather than experience. Its two thresholds are also **not yet calibrated**, and the
  suite cannot measure the model offline at all, so nothing has moved off `model` as the shipped
  default and the judge that is measured end to end is still the free `heuristic`. Arming a cycle on default config is still a way to
  spend real money unattended, and nothing refuses it. The proper fix is either a cycle-specific
  verifier override or a spend ceiling the cycle checks before enqueueing rather than the digest
  checking after; the daily ceiling is read before anything is spent, which bounds the damage per
  day and not per study.

  **Resolved (2026-10-01), differently than either fix above** (ADR-0006 amendment). The default
  moved after all — `judge: "heuristic"` — and the reasoning recorded above for not moving it is
  what turned out to be wrong. "Lowering it quietly would change every digest anybody asks for"
  treats the default as the setting for a digest a person requested, when the thing that made it
  dangerous was precisely that it was *also* the setting for a cycle nobody is watching. Making the
  paid judge opt-in separates the two without needing a cycle-specific override or a new ceiling:
  a person who wants a written verdict asks for one. `judge: "model"` also no longer means "the
  most expensive model in the table" — it pins `claude-opus-5-5` at `high` instead of following
  `DEFAULT_MODEL`, which has itself moved down to a Sonnet at `low`. **The last two sentences above
  still stand:** the daily ceiling remains per day and not per study, so a `model` or `typesafe`
  judge deliberately armed on a repeating cycle is still an unbounded standing bill.
- **A functional re-check is deliberately not in the loop.** Replay writes, and the `slice(-5)`
  evidence fallback replays calls nobody chose, so a repeating loop compounds the drift. ADR-0014's
  amendment is amended beside this record with the full reasoning, and names narrowing that fallback
  as the prerequisite if the loop ever wants a functional check. The loop uses **reach**, not replay.
- **A verdict is sticky**, and here that is convenient rather than limiting: `verifyPending` takes
  `unverifiedOnly: true`, so each cycle's digest verifies only findings filed since the last one,
  which is what keeps a recurring cycle cheap. It also means a verdict written under a
  contaminated replay is never revisited.
- **Windows are derived, not recorded.** A deleted job row silently re-merges two windows, and
  nothing detects that. It is the right trade at this size — a recorded window is a table, and the
  store has no migration framework (ADR-0011) — but it means the state machine's history is only as
  durable as the jobs table it is read off.
- **Unattended running is still R3.** The loop works for as long as `serve` is open, which is fine
  on a box somebody controls and is not the product's own pitch. "You deploy populace" is R3/D6.
- **A person who walked away over a problem is never heard from again inside one run.** The strongest
  "did your fix land" evidence is R1's carry-forward verdict, which only brings back those whose last
  visit said `wouldReturn === true`, costs a real visit per person, and is not built. Longitudinal
  gives continuous reach evidence for free; ephemeral plus carry-forward gives the returning verdict.
  **Neither is a substitute for the other**, and the roadmap is explicit that the product must never
  offer one as an answer to the other.

**The argument against, recorded so it is not re-discovered.** A report cycle is a *synthetic*
boundary: nothing about the product under study changed at the moment it fell, and a problem read as
"gone quiet" across two cycles may simply not have been looked for — the same people doing different
things an hour apart, which is the non-determinism ADR-0030 insists on. Slicing one execution into
windows therefore manufactures the appearance of a controlled comparison out of a continuous stream,
and every "gone quiet" comment is a claim built on a line somebody's config drew. The honest
alternative was to leave longitudinal studies with no state machine and file each problem once, which
is what the code did, and to put the whole loop on ephemeral sibling executions, where the boundary
is real.

That was rejected for two reasons. The boundary being synthetic does not make the *presence* data
synthetic — a problem reported in window 7 and not in windows 8, 9 and 10 by four people who made
eleven visits between them is a fact about those visits, whatever drew the lines — and the arithmetic
already refuses to read an unvisited window as evidence. And the alternative is worse than doing
nothing: an ephemeral-only loop excludes the study type the north star is about, and a longitudinal
study with no state machine files everything once and then goes silent, which reads as "populace has
nothing more to say" rather than as a missing feature. The mitigation is in the copy — every claim
names its window count, its people and its visits, and calls itself an absence — not in pretending
the boundary is more than it is. What would change the decision is a measured false "gone quiet"
rate: run a study against an unrepaired target for twenty cycles and count how often a problem goes
quiet and comes back on its own. If that number is high, `everyVisits` is the dial, and the honest
fix is to require a minimum number of visits in a window before its absence is allowed to mean
anything at all.

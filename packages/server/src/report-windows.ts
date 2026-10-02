import { personIdOfAgentId, type Agent, type Finding, type Job, type ReportCycle, type Run, type Wake } from "@populace/core";
import { signatureHistories, type ExecutionFindings, type SignatureHistory } from "@populace/reports";

/**
 * Report windows: the arithmetic that gives a longitudinal study a state machine.
 *
 * `signatureHistories` (`packages/reports/src/signatures.ts`) works out whether a problem is new,
 * open, gone quiet or back by comparing a list of EXECUTIONS. A longitudinal study has exactly one
 * — `signatures.ts:41` says so outright — so `inLatest` is always true, the presence list before it
 * is always empty, and every signature is `new` for ever. `open`, `fixed` and `regressed` are
 * unreachable for the one study type the product's loop is built around.
 *
 * The fix costs no new arithmetic, because `signatureHistories` never actually required a window to
 * BE an execution. It takes `ExecutionFindings` — an identity, an order, whether anybody visited,
 * and the reports — so it is enough to hand it one entry per REPORT WINDOW. An execution boundary
 * is a window boundary and so is a report cycle, and the sequence for a study is every one of both,
 * in order.
 *
 * That is deliberately ONE code path for both modes. An ephemeral study normally has a single
 * window per execution, which is bit-for-bit what it gets today; a longitudinal study has one
 * execution and many cycles. Nothing here branches on mode, and nothing should: the mode decides
 * whether cycles are armed, not how presence is counted.
 *
 * Everything in this file is a function of its arguments. Nothing reads the store, so the hard
 * parts — a window nobody visited, a boundary that lands mid-visit, a person who walked away and
 * therefore cannot pass judgement — are all reachable from a test with a handful of literals.
 */

/**
 * The job kind whose successful end closes a window (ADR-0027's queue, `JobKindSchema`).
 *
 * **A SHARED job kind cannot define a boundary, and that is why this is its own kind.** Closing a
 * window means "populace has reported on everything up to here", which is a statement the
 * automatic cycle makes and a human pressing "File all" does not. Read off `issues.publish` — the
 * kind the bulk press and the single-problem press both run under — one manual press advanced the
 * state machine: the next publish found a window opened at the press with no reports in it yet and
 * commented "gone quiet" on every issue in the repository, in populace's most public copy, because
 * somebody had clicked a button twice.
 *
 * So the automatic cycle carries its own kind and nothing else closes a window. The cost of the
 * split is that the hook which enqueues the cycle MUST use `issues.cycle`: a cycle enqueued as
 * `issues.publish` reports as normal and leaves the boundary unrecorded, so the next cycle reports
 * over the same stretch of time again rather than over a wrong one. That is the safe direction of
 * the two, and it is the direction this file is wrong in if the wiring is ever changed back.
 */
const CYCLE_KIND = "issues.cycle";

/**
 * Was this visit REFUSED before it began, rather than made?
 *
 * A guardrail can turn a wake away on the doorstep: the kill switch and the population's daily
 * dollar ceiling are both checked before the first turn, and `runWake` writes the row anyway —
 * with a status, zero turns, and an end time (`packages/runner/src/wake.ts:262-271`). The row is
 * the record that populace declined to send somebody, and it is deliberately not a visit: the
 * runner does not even advance the participant's visit count for it, and calls the same predicate
 * `skipped` (`wake.ts:247`). This is that predicate, and the two must agree — a visit populace
 * refused to make must not be counted anywhere populace then reports on what people did.
 *
 * It matters here because every number in this file is published. Counted as visits, a stretch
 * where the kill switch was on becomes a "gone quiet" comment claiming people "have been back" and
 * made N visits since — visits that never happened, in populace's most public copy. And a window
 * consisting entirely of refused visits is evidence of nothing at all, so it must come out
 * `visited: false`: `signatures.ts:24-31` is the guard that keeps an unvisited window from being
 * read as an absence, and reading this one as an absence would call every signature in the next
 * window a regression.
 *
 * ZERO TURNS is half the test on purpose, and the narrower half. `killed` and `budget-exceeded`
 * are also how a visit that was genuinely made ENDS when a ceiling is hit part-way through — the
 * kill switch mid-flight (`wake.ts:623`) or a budget breach after some turns (`wake.ts:715`). That
 * visit happened, its tool calls hit the target and its reports are real evidence, so only the
 * turn count tells the doorstep case from the interrupted one. The other statuses are all outcomes
 * of a visit that started: `auth-failed` means the target refused this person's credential, which
 * happens after populace decided to send them, and `error` can land on turn zero but is a fault in
 * the harness rather than a decision not to go — neither is claimed here.
 */
function refusedBeforeStarting(wake: Wake): boolean {
  return wake.turns === 0 && (wake.status === "killed" || wake.status === "budget-exceeded");
}

/** One report window: a stretch of one execution, bounded by the cycles that reported on it. */
export interface ReportWindow {
  /**
   * The identity the arithmetic sees, `${runId}#c${cycle}`.
   *
   * It has to be per-window rather than per-execution: `signatureHistories` counts presence into a
   * `Set` of the `runId` it is given and keys its seq lookup by the same string
   * (`signatures.ts:79-82`), so handing it the real run id for every window of one run would
   * collapse them into a single window and put the bug straight back.
   */
  id: string;
  /** The execution this window is part of. */
  runId: string;
  /** That execution's ordinal within the study — what the user calls "execution 3". */
  seq: number;
  /** 1-based ordinal of this window within its execution. */
  cycle: number;
  /** 1-based ordinal across the whole study: the order the arithmetic reads windows in. */
  ordinal: number;
  /** Null only for an execution that never started, which has one window and no clock. */
  openedAt: string | null;
  /** Null while the window is still open — the live end of a running execution. */
  closedAt: string | null;
  /**
   * Did anybody visit inside it? A window a visit merely overlaps counts, because a cycle boundary
   * landing mid-visit must not leave that visit's reports sitting in a window marked empty.
   *
   * A visit populace REFUSED before turn one does not count — see `refusedBeforeStarting` — so a
   * window whose only visits were refused is `false` here, which is the answer that says "no
   * evidence" rather than the one that says "absent".
   */
  visited: boolean;
  /**
   * Visits that ENDED here, so the counts across a study's windows sum to the visits the study
   * actually made — refused visits excluded, which is the only way this number is true of the
   * sentence a published comment puts it in.
   */
  visits: number;
  /**
   * The participants whose visits touched this window, by agent id, in no particular order.
   *
   * It is what "of the N who went, M hit it" has to be counted over: `peopleHit` on a card is
   * scoped to the window being published, and the roster of the whole execution is not, so the two
   * read together are a fraction whose halves are about different stretches of time. Agent ids
   * need no run in the key here because a window lies inside exactly one execution.
   *
   * Touched and not "ended in", for the reason `visited` is: a visit that spans a boundary was a
   * visit to both windows, and the person who made it did go, in both.
   */
  visitors: string[];
  findings: Finding[];
}

export interface ReportWindowInput {
  /** Every execution of one study, in any order. */
  runs: readonly Run[];
  /** Every visit across those executions. */
  wakes: readonly Wake[];
  /** Every report across those executions. */
  findings: readonly Finding[];
  /**
   * The jobs of those executions, as `listJobs({ runId })` returns them. Only a SUCCEEDED
   * `issues.cycle` with an end time closed a window; the rest are ignored here — a manual publish
   * among them included, see `CYCLE_KIND` — so a caller can hand over the run's job list without
   * pre-filtering it and without knowing the kind's name.
   */
  jobs: readonly Job[];
}

/** Half-open `[openedAt, closedAt)`, under construction. */
interface Draft {
  openedAt: string | null;
  closedAt: string | null;
  visited: boolean;
  visits: number;
  /** A set while it is being filled, so one person's four visits do not count them four times. */
  visitors: Set<string>;
  findings: Finding[];
}

/**
 * The windows of one study, oldest first.
 *
 * Boundaries cost no new state at all: each succeeded publish job already records when it ended,
 * and reports and visits partition by their own timestamps. Two rules are worth stating because
 * they are what keeps the ephemeral case identical to today's:
 *
 * - A boundary at or after a FINISHED execution's end does not open a new window, it closes the
 *   last one. Nothing more can happen in an execution that has ended, so a window opened after it
 *   would be permanently empty — and it would push every later window's ordinal along by one,
 *   which is exactly what the terminal flush would do to an ephemeral study reported once per
 *   execution.
 * - A boundary at or before an execution's start is not a boundary of it. A publish that ended
 *   before the run began cannot have closed a window of that run.
 */
export function reportWindows(input: ReportWindowInput): ReportWindow[] {
  // By id first, then by seq. A window's identity is `${runId}#c${n}`, and `signatureHistories`
  // counts presence into a Set of the ids it is handed (`signatures.ts:88-89`) and keys its seq
  // lookup by the same string (`:82`), so one run row arriving twice would emit each of its windows
  // twice under one id — collapsing them into a single window and putting the very bug this file
  // exists to fix straight back.
  const runs = [...new Map(input.runs.map((run) => [run.id, run])).values()].sort((a, b) => a.seq - b.seq);
  const out: ReportWindow[] = [];
  let ordinal = 0;

  for (const run of runs) {
    const opened = run.startedAt === null ? null : Date.parse(run.startedAt);
    const ended = run.endedAt === null ? null : Date.parse(run.endedAt);
    const closes = [
      ...new Set(
        input.jobs
          .filter((job) => job.runId === run.id && job.kind === CYCLE_KIND && job.status === "succeeded")
          .flatMap((job) => (job.endedAt === null ? [] : [job.endedAt])),
      ),
    ]
      .map((at) => ({ at, ms: Date.parse(at) }))
      .filter((close) => (opened === null || close.ms > opened) && (ended === null || close.ms < ended))
      .sort((a, b) => a.ms - b.ms);

    // One more window than there are boundaries: the last one runs to the execution's end, or
    // stays open if the execution is still going.
    const drafts: Draft[] = [];
    for (let i = 0; i <= closes.length; i += 1) {
      drafts.push({
        openedAt: i === 0 ? run.startedAt : (closes[i - 1]?.at ?? null),
        closedAt: closes[i]?.at ?? run.endedAt,
        visited: false,
        visits: 0,
        visitors: new Set<string>(),
        findings: [],
      });
    }

    // Which window a moment falls in. Half-open at the top, so a report written at the instant a
    // cycle ended belongs to the window that cycle opened rather than to the one it reported on.
    const windowAt = (ms: number): number => {
      let i = 0;
      while (i < closes.length && ms >= (closes[i]?.ms ?? Number.POSITIVE_INFINITY)) i += 1;
      return i;
    };

    for (const finding of input.findings) {
      if (finding.runId !== run.id) continue;
      drafts[windowAt(Date.parse(finding.createdAt))]?.findings.push(finding);
    }

    for (const wake of input.wakes) {
      if (wake.runId !== run.id) continue;
      // A visit populace refused to make is not a visit, in any of the three numbers below: it
      // cannot mark the window visited, cannot put somebody in the visitor set, and cannot be
      // counted. See `refusedBeforeStarting` — a window whose only visits were refused has to come
      // out `visited: false`, because it is evidence of nothing rather than an absence.
      if (refusedBeforeStarting(wake)) continue;
      const from = windowAt(Date.parse(wake.startedAt));
      const to = wake.endedAt === null ? drafts.length - 1 : windowAt(Date.parse(wake.endedAt));
      // A visit that spans a boundary visited both windows. Marking only one of them would let a
      // report land in a window flagged as having no visits, and `signatureHistories` reads an
      // unvisited window as no evidence and drops its reports out of the presence count entirely.
      for (let i = from; i <= Math.max(from, to); i += 1) {
        const draft = drafts[i];
        if (!draft) continue;
        draft.visited = true;
        draft.visitors.add(wake.agentId);
      }
      const last = drafts[Math.max(from, to)];
      if (last) last.visits += 1;
    }

    drafts.forEach((draft, i) => {
      ordinal += 1;
      out.push({ id: `${run.id}#c${i + 1}`, runId: run.id, seq: run.seq, cycle: i + 1, ordinal, ...draft, visitors: [...draft.visitors] });
    });
  }

  return out;
}

/**
 * The windows in the shape the cross-window arithmetic takes.
 *
 * `seq` is the window's global ordinal rather than its execution's, because it is what orders the
 * sequence and two windows of one execution would otherwise be indistinguishable. The two numbers
 * agree in the ordinary ephemeral case — one window per execution — and where they do not, a caller
 * naming an execution to the user reads `runId`/`seq` off the window rather than off the history's
 * `seenIn`.
 */
export function toExecutionFindings(windows: readonly ReportWindow[]): ExecutionFindings[] {
  return windows.map((window) => ({ runId: window.id, seq: window.ordinal, visited: window.visited, findings: window.findings }));
}

/**
 * Where every problem in a study stands, over report windows instead of executions.
 *
 * This is the call that replaces `signatureHistories(runs.map(...))`: same arithmetic, same
 * `groups` map for "these two wordings are one problem", a sequence that has more than one entry
 * for a longitudinal study.
 */
export function windowHistories(input: ReportWindowInput, groups?: ReadonlyMap<string, string>): Map<string, SignatureHistory> {
  return historiesOf(reportWindows(input), groups);
}

/**
 * The same thing, for a caller that already holds the windows.
 *
 * `windowHistories` is the convenient form and this is the one the publisher uses: it needs the
 * windows themselves — which one it is reporting on, who visited it, what was reported in it — so
 * asking for the histories off the rows would compute every window twice per publish, and the
 * second pass could disagree with the first if a row landed in between.
 */
export function historiesOf(windows: readonly ReportWindow[], groups?: ReadonlyMap<string, string>): Map<string, SignatureHistory> {
  return signatureHistories(toExecutionFindings(windows), groups);
}

/**
 * When the first cycle of a run may fire, and when each one after it may.
 *
 * Split in two and rolled ONCE per window, which is how `CadenceScheduler` handles the identical
 * question about a person (`packages/core/src/interfaces/scheduler.ts`): the jitter is drawn when
 * the deadline is set, not when it is checked. Drawing it per check would make a cycle fire as soon
 * as one roll came up small, which is a coin flip pretending to be a schedule.
 *
 * `random` is an argument for the same reason it is on `CadenceScheduler` — a test wants the
 * deadline it asked for.
 */
export function firstCycleAt(cycle: ReportCycle, runStartedAt: Date, random: () => number = Math.random): Date {
  return new Date(runStartedAt.getTime() + cycle.initialDelay + jitterOf(cycle, random));
}

/** The deadline for the next cycle, measured from the moment the last window closed. */
export function nextCycleAt(cycle: ReportCycle, closedAt: Date, random: () => number = Math.random): Date {
  return new Date(closedAt.getTime() + cycle.every + jitterOf(cycle, random));
}

/**
 * Non-zero jitter matters more here than it does for a person. Commit `f03c5f1` ("zero jitter is a
 * herd") is about two runs coming round in lockstep; two runs REPORTING in lockstep also queue
 * behind each other on a strictly serial FIFO, delaying every sweep and target check sitting there.
 */
function jitterOf(cycle: ReportCycle, random: () => number): number {
  return cycle.jitter > 0 ? Math.floor(random() * cycle.jitter) : 0;
}

/** Which condition closed the window, for the line the caller logs. */
export type CycleTrigger = "visits" | "elapsed";

export interface CycleDueInput {
  cycle: ReportCycle;
  /** The deadline `firstCycleAt`/`nextCycleAt` rolled when this window opened. */
  dueAt: Date;
  /** Visits since this window opened. */
  visitsSince: number;
  /**
   * A cycle already queued or running for this run. Skip, never stack: the job queue is a serial
   * FIFO with no delay or cancellation, so a second cycle would sit in front of everything else
   * waiting to repeat work the first one is doing.
   */
  inFlight?: boolean;
  now: Date;
}

export interface CycleDecision {
  due: boolean;
  trigger: CycleTrigger | null;
  /** Milliseconds left on the clock; negative once the deadline has gone by. */
  msRemaining: number;
}

/**
 * Is it time to close this window?
 *
 * Both triggers require a visit. A window nobody visited says nothing either way — that is the
 * guard `signatures.ts:24-31` documents — so reporting on one spends two jobs on the serial queue
 * to produce no evidence. It also means no timer is needed anywhere: the question is asked as each
 * visit lands, and if nothing is happening there is nothing to report.
 */
export function cycleDue(input: CycleDueInput): CycleDecision {
  const msRemaining = input.dueAt.getTime() - input.now.getTime();
  if (input.inFlight === true || input.visitsSince <= 0) return { due: false, trigger: null, msRemaining };
  const byVisits = input.cycle.everyVisits !== null && input.visitsSince >= input.cycle.everyVisits;
  if (byVisits) return { due: true, trigger: "visits", msRemaining };
  if (msRemaining <= 0) return { due: true, trigger: "elapsed", msRemaining };
  return { due: false, trigger: null, msRemaining };
}

export interface ProblemReachInput {
  /** Every report carrying this problem — all of the cluster's signatures, across every execution. */
  findings: readonly Finding[];
  /** The participants of the executions those reports came from. */
  agents: readonly Agent[];
  /** The visits those participants made. */
  wakes: readonly Wake[];
  /**
   * Every execution of the study. Not optional, because "still visiting" is a claim about the
   * execution as much as about the person: a participant row keeps `status: "active"` when its
   * execution is paused, completed, killed or failed, so read off the row alone it has populace
   * telling a reader that people are still visiting a study that stopped days ago.
   */
  runs: readonly Run[];
  /** Overrides "when it was last reported". Defaults to the newest of `findings`. */
  since?: string;
}

/**
 * How far a problem reached, and — the part that is easy to get wrong — how much of that reach can
 * honestly be read as evidence that it has stopped happening.
 *
 * Two units live side by side here and neither can stand in for the other. A **person** is durable
 * and outlives the execution, so it is the unit a headline number has to be in: "5 people hit this"
 * must not become 15 because three executions reported it. A **participation** — one person in one
 * execution, `(runId, agentId)` — is the unit that has a *status*, because giving up, hitting a
 * visit cap and being woken again are all things that happen inside one execution. So the counts
 * below are participations and `hit` is people, and both are returned rather than one being quietly
 * used for the other's sentence.
 */
export interface ProblemReach {
  /**
   * Distinct PEOPLE who reported it. `personId` is the durable individual behind a participant
   * (`personIdOfAgentId`), so one person who hit the same problem in three executions is one.
   */
  hit: number;
  /**
   * Distinct participations that reported it: people counted once per execution they hit it in.
   * Equal to `hit` for a study with one execution, and larger as soon as the same person hits the
   * same problem twice — which is the case that used to be published as more people than exist.
   */
  participations: number;
  /**
   * Of those participations, the ones who could actually come back. Two conditions, and both are
   * needed: `listDueAgents` selects `status = 'active'`
   * (`packages/store-sqlite/src/index.ts:423-427`), so nobody else will be woken again whatever
   * the cadence says — and the execution itself has to still be running, since a paused,
   * completed, killed or failed one wakes nobody however active the row says they are.
   */
  stillActive: number;
  /**
   * Of the still-active, the ones who have visited since it was last reported. A visit populace
   * refused before turn one is not one of them (`refusedBeforeStarting`): being turned away on the
   * doorstep by the kill switch is not coming back and looking.
   */
  cameBack: number;
  /** Visits those people made between them since it was last reported, refused visits excluded. */
  visitsSince: number;
  /**
   * Of the participations that hit it, the ones that walked away. A give-up sets
   * `status: "retired"` and `nextWakeAt: null` (`packages/runner/src/wake.ts:252`), so a person who
   * quit over this problem is never heard from again inside the same execution. Their silence is
   * not a judgement on it and must be reported separately — counting them among the people who came
   * back and said nothing would put words in the mouth of somebody who left.
   */
  walkedAway: number;
  /**
   * Of those, the ones the study never gave another look. Split out because "walked away and has
   * not been brought back" is a second claim on top of the give-up, and it is false the moment a
   * sibling execution or a carry-forward run puts that person back in
   * (`ContinuedFrom.gaveUp` — "the agent had walked away and is being given another look").
   * A caller may say "walked away over it, so their silence says nothing about it" for
   * `walkedAway`; it may only add "and has not been brought back" for this number.
   */
  notBroughtBack: number;
  /**
   * Of the participations that hit it, the ones a limit stopped rather than a decision: a visit
   * cap, a scale-down, or an execution that is paused or over. They did not walk away and they did
   * not pass judgement either.
   */
  stopped: number;
  /**
   * Participations that reported it and have no participant row any more — an execution deleted
   * under them, or a store rebuilt (ADR-0011).
   *
   * They are in none of the four buckets above, because inventing a status for somebody nobody can
   * look up is worse than saying so: `stillActive + walkedAway + stopped + unknown` is
   * `participations`, and without this number the arithmetic in a published comment simply did not
   * add up. A caller printing the buckets says this many are unaccounted for, or says that the
   * buckets are a subset.
   */
  unknown: number;
  lastReportedAt: string | null;
}

/**
 * A participant is identified by `(runId, agentId)` and never by agent id alone: ids are
 * deterministic and repeat in every execution of a study, so an id on its own leaks across runs.
 */
function keyOf(runId: string, agentId: string): string {
  return `${runId}\u0000${agentId}`;
}

/**
 * An execution somebody could still visit.
 *
 * `paused` is deliberately not one: it is resumable rather than terminal, but nobody is woken while
 * it sits there, and "4 are still visiting" said of a paused longitudinal study is the most
 * misleading sentence this file could hand a reader. `pending` is out for the opposite reason — its
 * daemon has not ticked yet — and an execution whose row is missing is out because nothing can be
 * confirmed about it.
 */
function isLive(run: Run | undefined): boolean {
  return run?.status === "running";
}

/**
 * The reach numbers behind a "gone quiet" comment.
 *
 * What it counts is bounded by what it can support. `visitsSince` is the visits of the people who
 * are still active and have come back — a person who hit their visit cap after two more visits made
 * those visits too, but the sentence they are counted into is about people who are still visiting,
 * so they are left out rather than quietly folded in. Under-claiming is the safe direction here;
 * the comment is populace's most public copy.
 */
export function problemReach(input: ProblemReachInput): ProblemReach {
  const reporters = new Set(input.findings.map((finding) => keyOf(finding.runId, finding.agentId)));
  const reported = input.findings.map((finding) => finding.createdAt).sort();
  const lastReportedAt = input.since ?? reported.at(-1) ?? null;
  const since = lastReportedAt === null ? null : Date.parse(lastReportedAt);

  const participants = new Map(input.agents.map((agent) => [keyOf(agent.runId, agent.id), agent]));
  const live = new Map(input.runs.map((run) => [run.id, run]));
  // The person behind each report: the row's own `personId` where the row is there, and the
  // derivation off the id where it is not, exactly as the read model does it
  // (`project-read-model.ts:661`).
  const people = new Set(
    input.findings.map((finding) => participants.get(keyOf(finding.runId, finding.agentId))?.personId ?? personIdOfAgentId(finding.agentId)),
  );

  let stillActive = 0;
  let walkedAway = 0;
  let notBroughtBack = 0;
  let stopped = 0;
  let unknown = 0;
  const active = new Set<string>();
  for (const key of reporters) {
    const agent = participants.get(key);
    // A reporter whose participant row is gone — an execution deleted under it — gets a bucket of
    // its own rather than being dropped out of all of them: the four sum to `participations`, and
    // a comment that prints them can say how many are unaccounted for instead of publishing three
    // numbers that do not add up to the total above them.
    if (!agent) {
      unknown += 1;
      continue;
    }
    if (agent.status === "retired" && agent.retiredReason === "gave-up") {
      walkedAway += 1;
      if (!broughtBackAfter(agent, input.agents, live)) notBroughtBack += 1;
    } else if (agent.status === "active" && isLive(live.get(agent.runId))) {
      stillActive += 1;
      active.add(key);
    } else stopped += 1;
  }

  const returned = new Set<string>();
  let visitsSince = 0;
  for (const wake of input.wakes) {
    const key = keyOf(wake.runId, wake.agentId);
    if (!active.has(key)) continue;
    // A visit populace refused to make is not somebody coming back and not a visit made since, in
    // either number: `cameBack` is the count a comment turns into "they have been back", and a
    // person the kill switch turned away has not been back. See `refusedBeforeStarting`.
    if (refusedBeforeStarting(wake)) continue;
    // A visit that STARTED after the last report is unambiguously a later one — which keeps the
    // visit that filed the report from counting as a visit made since it. It has to have finished:
    // a visit still in flight has not had its say yet.
    if (wake.endedAt === null) continue;
    if (since !== null && Date.parse(wake.startedAt) <= since) continue;
    returned.add(key);
    visitsSince += 1;
  }

  return { hit: people.size, participations: reporters.size, stillActive, cameBack: returned.size, visitsSince, walkedAway, notBroughtBack, stopped, unknown, lastReportedAt };
}

/**
 * Did the study give this person another look after they walked away?
 *
 * Two shapes count, and both are read off rows populace already has rather than inferred. A later
 * execution in which they are active is one — a sibling execution deals the same lane and the same
 * person walks in again. A row carrying `continuedFrom.gaveUp` is the other, and it is the datum
 * that says so outright; it stays true even if they then gave up a second time, because being
 * brought back and staying are different claims and only the first is being made here.
 *
 * Both are measured against the execution they walked away in, by `seq`. Where a `seq` is missing
 * the comparison is resolved towards "brought back", because the alternative is publishing the
 * stronger claim on weaker evidence.
 */
function broughtBackAfter(agent: Agent, agents: readonly Agent[], runs: ReadonlyMap<string, Run>): boolean {
  const seq = runs.get(agent.runId)?.seq ?? Number.NEGATIVE_INFINITY;
  return agents.some((other) => {
    if (other.personId !== agent.personId) return false;
    const otherSeq = runs.get(other.runId)?.seq ?? Number.POSITIVE_INFINITY;
    if (otherSeq <= seq) return false;
    return other.status === "active" || other.continuedFrom?.gaveUp === true;
  });
}

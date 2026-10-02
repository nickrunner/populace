import { AgentSchema, FindingSchema, JobSchema, ReportCycleSchema, RunSchema, WakeSchema, ZERO_USAGE, type Agent, type Finding, type Job, type Run, type Wake } from "@populace/core";
import { describe, expect, it } from "vitest";
import { cycleDue, firstCycleAt, nextCycleAt, problemReach, reportWindows, windowHistories, type ReportWindowInput } from "./report-windows.js";

const T0 = Date.parse("2026-01-01T00:00:00.000Z");
/** Minutes past a fixed epoch, as the ISO string every row stores. */
const at = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();

const BUG = "sig1:aaaaaaaaaaaa";
const OTHER = "sig1:bbbbbbbbbbbb";

const PERSONA = { id: "casual", name: "Casual lister", role: "r", backstory: "b", goals: ["g"] };

function run(seq: number, over: Partial<Run> = {}): Run {
  return RunSchema.parse({ id: `run-${seq}`, projectId: "p", simulationId: "study", seq, mode: "longitudinal", populationId: "everyone", status: "running", startedAt: at(0), ...over });
}

let wakeNo = 0;
function wake(runId: string, agentId: string, startedAt: string, endedAt: string | null): Wake {
  wakeNo += 1;
  return WakeSchema.parse({
    id: `wake-${wakeNo}`,
    runId,
    tag: "t",
    agentId,
    personaId: PERSONA.id,
    populationId: "everyone",
    wakeNumber: wakeNo,
    status: endedAt === null ? "running" : "done",
    model: "m",
    effort: "medium",
    usage: ZERO_USAGE,
    costUsd: 0,
    turns: 1,
    toolCalls: 1,
    findingCount: 0,
    startedAt,
    endedAt,
  });
}

/**
 * What a guardrail leaves behind when it turns somebody away on the doorstep.
 *
 * The kill switch and the population's daily dollar ceiling are both checked before the first
 * turn, and `runWake` writes the row anyway — a status, zero turns, an end time
 * (`packages/runner/src/wake.ts:262-271`). It is the record that populace DECLINED to send
 * somebody, which is not a record of a visit.
 */
function refusedWake(runId: string, agentId: string, startedAt: string, status: "killed" | "budget-exceeded" = "killed"): Wake {
  return WakeSchema.parse({ ...wake(runId, agentId, startedAt, startedAt), status, turns: 0, toolCalls: 0, findingCount: 0 });
}

/** A visit that WAS made and then cut off part-way through: the same status, turns on the clock. */
function killedMidVisit(runId: string, agentId: string, startedAt: string, endedAt: string): Wake {
  return WakeSchema.parse({ ...wake(runId, agentId, startedAt, endedAt), status: "killed", turns: 3, toolCalls: 4 });
}

let findingNo = 0;
function finding(runId: string, agentId: string, signature: string, createdAt: string, wakeId = "wake-0"): Finding {
  findingNo += 1;
  return FindingSchema.parse({
    id: `finding-${findingNo}`,
    runId,
    tag: "t",
    wakeId,
    agentId,
    personaId: PERSONA.id,
    kind: "bug",
    signature,
    title: "search misses capitals",
    description: "d",
    expected: "e",
    observed: "o",
    severity: "high",
    confidence: 0.9,
    reproduction: [],
    endpoint: "http://127.0.0.1:1/",
    createdAt,
  });
}

function agent(runId: string, id: string, over: Partial<Agent> = {}): Agent {
  return AgentSchema.parse({
    id,
    runId,
    simulationId: "study",
    populationId: "everyone",
    cohortSlug: "weekenders",
    personId: id,
    name: "Someone",
    handle: "someone",
    persona: PERSONA,
    ordinal: 0,
    createdAt: at(0),
    ...over,
  });
}

/** A succeeded report cycle: its end is a window boundary and nothing else about it matters here. */
function cycleJob(runId: string, endedAt: string): Job {
  return JobSchema.parse({ id: `job-${runId}-${endedAt}`, kind: "issues.cycle", status: "succeeded", runId, createdAt: endedAt, endedAt });
}

/** What a human's press leaves behind: the same pass, under the kind a person's press runs under. */
function manualPublishJob(runId: string, endedAt: string): Job {
  return JobSchema.parse({ id: `job-manual-${runId}-${endedAt}`, kind: "issues.publish", status: "succeeded", runId, createdAt: endedAt, endedAt });
}

/** Everything that had happened by `cutoff`, so one dataset can be read at four points in time. */
function upto(input: ReportWindowInput, cutoff: string): ReportWindowInput {
  return {
    runs: input.runs,
    wakes: input.wakes.filter((w) => w.startedAt < cutoff),
    findings: input.findings.filter((f) => f.createdAt < cutoff),
    jobs: input.jobs.filter((j) => j.endedAt !== null && j.endedAt < cutoff),
  };
}

function stateOf(input: ReportWindowInput, signature: string): string | undefined {
  return windowHistories(input).get(signature)?.state;
}

describe("report windows, longitudinal", () => {
  /**
   * The whole point of the file. A longitudinal study has ONE execution, so asked per execution
   * this problem would be `new` for ever; asked per report window it walks the ladder the results
   * screen and any notion of a regression are built on.
   */
  const soak: ReportWindowInput = {
    runs: [run(1, { endedAt: null })],
    wakes: [
      wake("run-1", "p1", at(2), at(3)),
      wake("run-1", "p1", at(12), at(13)),
      wake("run-1", "p1", at(22), at(23)),
      wake("run-1", "p1", at(32), at(33)),
    ],
    findings: [
      finding("run-1", "p1", BUG, at(3)),
      finding("run-1", "p1", BUG, at(13)),
      // Window 3 visited and reported something else: real evidence, and the bug is not in it.
      finding("run-1", "p1", OTHER, at(23)),
      finding("run-1", "p1", BUG, at(33)),
    ],
    jobs: [cycleJob("run-1", at(10)), cycleJob("run-1", at(20)), cycleJob("run-1", at(30))],
  };

  it("walks new, open, gone quiet, back across four cycles of one execution", () => {
    expect(stateOf(upto(soak, at(5)), BUG)).toBe("new");
    expect(stateOf(upto(soak, at(15)), BUG)).toBe("open");
    expect(stateOf(upto(soak, at(25)), BUG)).toBe("fixed");
    expect(stateOf(upto(soak, at(35)), BUG)).toBe("regressed");
  });

  it("gives every window its own identity, since presence is counted into a set of them", () => {
    const windows = reportWindows(soak);
    expect(windows.map((w) => w.cycle)).toEqual([1, 2, 3, 4]);
    expect(windows.map((w) => w.ordinal)).toEqual([1, 2, 3, 4]);
    expect(new Set(windows.map((w) => w.id)).size).toBe(4);
    expect(windows.every((w) => w.runId === "run-1")).toBe(true);
    // Half-open: the window a cycle opened starts where the one it reported on ended.
    expect(windows.map((w) => w.openedAt)).toEqual([at(0), at(10), at(20), at(30)]);
    expect(windows.map((w) => w.closedAt)).toEqual([at(10), at(20), at(30), null]);
    // One visit each, counted where it ended, so the windows account for every visit exactly once.
    expect(windows.map((w) => w.visits)).toEqual([1, 1, 1, 1]);
    expect(windows.reduce((n, w) => n + w.visits, 0)).toBe(soak.wakes.length);
    expect(windows.map((w) => w.findings.map((f) => f.signature))).toEqual([[BUG], [BUG], [OTHER], [BUG]]);
  });

  it("counts a visit that spans a boundary as a visit to both windows", () => {
    // The hazard: a report written after the cycle fired lands in the new window, and if that
    // window is flagged as unvisited the arithmetic drops the report out of the presence count.
    const spanning: ReportWindowInput = {
      runs: [run(1, { endedAt: null })],
      wakes: [wake("run-1", "p1", at(8), at(12))],
      findings: [finding("run-1", "p1", BUG, at(11))],
      jobs: [cycleJob("run-1", at(10))],
    };
    const windows = reportWindows(spanning);
    expect(windows.map((w) => w.visited)).toEqual([true, true]);
    expect(windows.map((w) => w.visits)).toEqual([0, 1]);
    expect(stateOf(spanning, BUG)).toBe("new");
  });
});

describe("report windows, ephemeral", () => {
  /** Four sibling executions, each reported once as it ends — today's behaviour, unchanged. */
  function execution(seq: number, signatures: string[]): { run: Run; wakes: Wake[]; findings: Finding[]; jobs: Job[] } {
    const base = seq * 100;
    const id = `run-${seq}`;
    return {
      run: run(seq, { mode: "ephemeral", status: "completed", startedAt: at(base), endedAt: at(base + 10) }),
      wakes: [wake(id, "p1", at(base + 1), at(base + 2))],
      findings: signatures.map((signature) => finding(id, "p1", signature, at(base + 2))),
      // The terminal flush runs after the execution has ended, which must close its last window
      // rather than open an empty one after it.
      jobs: [cycleJob(id, at(base + 11))],
    };
  }

  const executions = [execution(1, [BUG]), execution(2, [BUG]), execution(3, [OTHER]), execution(4, [BUG])];
  const upto2 = (n: number): ReportWindowInput => {
    const taken = executions.slice(0, n);
    return { runs: taken.map((e) => e.run), wakes: taken.flatMap((e) => e.wakes), findings: taken.flatMap((e) => e.findings), jobs: taken.flatMap((e) => e.jobs) };
  };

  it("gets exactly one window per execution, so the ordinals are the execution numbers", () => {
    const windows = reportWindows(upto2(4));
    expect(windows).toHaveLength(4);
    expect(windows.map((w) => w.ordinal)).toEqual([1, 2, 3, 4]);
    expect(windows.map((w) => w.seq)).toEqual([1, 2, 3, 4]);
    expect(windows.map((w) => w.cycle)).toEqual([1, 1, 1, 1]);
    expect(windows.map((w) => w.closedAt)).toEqual([at(110), at(210), at(310), at(410)]);
  });

  it("walks the same ladder over sibling executions, through the same code path", () => {
    expect(stateOf(upto2(1), BUG)).toBe("new");
    expect(stateOf(upto2(2), BUG)).toBe("open");
    expect(stateOf(upto2(3), BUG)).toBe("fixed");
    expect(stateOf(upto2(4), BUG)).toBe("regressed");
    // And the history names executions the user can find, not window ordinals off the end.
    expect(windowHistories(upto2(4)).get(BUG)?.seenIn).toEqual([1, 2, 4]);
  });

  it("ignores boundaries that cannot belong to the execution", () => {
    const stray: ReportWindowInput = {
      runs: [run(1, { mode: "ephemeral", status: "completed", startedAt: at(100), endedAt: at(110) })],
      wakes: [wake("run-1", "p1", at(101), at(102))],
      findings: [finding("run-1", "p1", BUG, at(102))],
      // One before it started, one after it ended, and one belonging to somebody else's execution.
      jobs: [cycleJob("run-1", at(50)), cycleJob("run-1", at(200)), cycleJob("run-9", at(105))],
    };
    expect(reportWindows(stray)).toHaveLength(1);
  });

  it("gives one window one id, even handed the same execution twice", () => {
    // Presence is counted into a set of window ids, so two windows sharing one are one window.
    const twice = { ...upto2(2), runs: [...upto2(2).runs, ...upto2(2).runs] };
    const windows = reportWindows(twice);
    expect(windows).toHaveLength(2);
    expect(new Set(windows.map((w) => w.id)).size).toBe(2);
    expect(windows.map((w) => w.ordinal)).toEqual([1, 2]);
    expect(stateOf(twice, BUG)).toBe("open");
  });

  it("ignores a job that is not a succeeded report cycle", () => {
    const noisy: ReportWindowInput = {
      runs: [run(1, { endedAt: null })],
      wakes: [wake("run-1", "p1", at(1), at(2))],
      findings: [finding("run-1", "p1", BUG, at(2))],
      jobs: [
        JobSchema.parse({ id: "j1", kind: "digest", status: "succeeded", runId: "run-1", createdAt: at(5), endedAt: at(5) }),
        JobSchema.parse({ id: "j2", kind: "issues.cycle", status: "failed", runId: "run-1", createdAt: at(6), endedAt: at(6) }),
        JobSchema.parse({ id: "j3", kind: "issues.cycle", status: "running", runId: "run-1", createdAt: at(7), endedAt: null }),
      ],
    };
    expect(reportWindows(noisy)).toHaveLength(1);
  });

  /**
   * The boundary is the automatic cycle's and NOT a human's press, and this is the test that says
   * so.
   *
   * Both run the same pass, and under one shared job kind a manual "File all" advanced the state
   * machine: the window it appeared to close had no reports in it yet, so the very next publish
   * read every open problem as absent and commented "gone quiet" on every issue in somebody's
   * repository — because a person pressed a button twice. A boundary means "populace has reported
   * on everything up to here", which the cycle claims and the press does not.
   */
  it("is not moved by a publish a person asked for", () => {
    const pressed: ReportWindowInput = {
      runs: [run(1, { endedAt: null })],
      wakes: [wake("run-1", "p1", at(2), at(3)), wake("run-1", "p1", at(12), at(13))],
      findings: [finding("run-1", "p1", BUG, at(3))],
      // Between the two visits, which is exactly where it would split the reports off the silence.
      jobs: [manualPublishJob("run-1", at(10))],
    };
    expect(reportWindows(pressed)).toHaveLength(1);
    // And the problem is still open rather than having gone quiet, which is what the comment says.
    expect(stateOf(pressed, BUG)).toBe("new");
    expect(reportWindows(pressed)[0]?.findings).toHaveLength(1);

    // The same moment, recorded by the automatic cycle, IS a boundary: the mechanism works, it is
    // only the press that no longer drives it.
    const cycled = { ...pressed, jobs: [cycleJob("run-1", at(10))] };
    expect(reportWindows(cycled)).toHaveLength(2);
    expect(stateOf(cycled, BUG)).toBe("fixed");
  });

  /**
   * Who went, per window, which is the denominator of "1 of 12 people who went hit it".
   *
   * Counted over the execution instead, that fraction had a numerator from one cycle and a
   * denominator from the whole life of a longitudinal study — a proportion whose halves are about
   * different stretches of time.
   */
  it("records who visited each window, counting a visit that spans a boundary in both", () => {
    const crowd: ReportWindowInput = {
      runs: [run(1, { endedAt: null })],
      wakes: [
        wake("run-1", "p1", at(2), at(3)),
        wake("run-1", "p2", at(4), at(5)),
        // Spans the boundary: this person went in both windows, and did.
        wake("run-1", "p3", at(8), at(12)),
        wake("run-1", "p1", at(14), at(15)),
      ],
      findings: [],
      jobs: [cycleJob("run-1", at(10))],
    };
    const windows = reportWindows(crowd);
    expect(windows.map((w) => [...w.visitors].sort())).toEqual([
      ["p1", "p2", "p3"],
      ["p1", "p3"],
    ]);
    // One person's two visits are one visitor: the number is people who went, not visits made.
    const twice: ReportWindowInput = { runs: [run(1, { endedAt: null })], wakes: [wake("run-1", "p1", at(2), at(3)), wake("run-1", "p1", at(4), at(5))], findings: [], jobs: [] };
    expect(reportWindows(twice)[0]?.visitors).toEqual(["p1"]);
  });
});

describe("a window nobody visited", () => {
  /**
   * The guard `signatures.ts:24-31` documents, now reachable mid-run: a quiet stretch says nothing
   * either way, and counting its silence as an absence would call the next window a regression.
   */
  const quiet: ReportWindowInput = {
    runs: [run(1, { endedAt: null })],
    wakes: [wake("run-1", "p1", at(2), at(3)), wake("run-1", "p1", at(22), at(23))],
    findings: [finding("run-1", "p1", BUG, at(3)), finding("run-1", "p1", BUG, at(23))],
    jobs: [cycleJob("run-1", at(10)), cycleJob("run-1", at(20))],
  };

  it("is no evidence, not an absence", () => {
    const windows = reportWindows(quiet);
    expect(windows.map((w) => w.visited)).toEqual([true, false, true]);
    expect(windows.map((w) => w.visits)).toEqual([1, 0, 1]);
    expect(stateOf(quiet, BUG)).toBe("open");
  });

  it("would have read as a regression had anybody visited and not reported it", () => {
    const busy: ReportWindowInput = { ...quiet, wakes: [...quiet.wakes, wake("run-1", "p1", at(12), at(13))] };
    expect(reportWindows(busy).map((w) => w.visited)).toEqual([true, true, true]);
    expect(stateOf(busy, BUG)).toBe("regressed");
  });

  it("reports an execution that never visited as one unvisited window", () => {
    const stillborn: ReportWindowInput = { runs: [run(1, { status: "pending", startedAt: null })], wakes: [], findings: [], jobs: [] };
    const windows = reportWindows(stillborn);
    expect(windows).toHaveLength(1);
    expect(windows[0]?.visited).toBe(false);
    expect(windows[0]?.openedAt).toBeNull();
  });
});

describe("a visit populace refused to make", () => {
  /**
   * The quiet stretch above, except that the middle window is not empty of ROWS: the kill switch
   * was on and the daily ceiling had gone, so populace wrote a wake for every person it declined
   * to send. Counted as visits those rows publish a false claim twice over — a window that is
   * evidence of nothing gets read as an absence, and the next window's report gets called a
   * regression on the strength of visits that never happened.
   */
  const refused: ReportWindowInput = {
    runs: [run(1, { endedAt: null })],
    wakes: [
      wake("run-1", "p1", at(2), at(3)),
      refusedWake("run-1", "p1", at(12)),
      refusedWake("run-1", "p2", at(14), "budget-exceeded"),
      wake("run-1", "p1", at(22), at(23)),
    ],
    findings: [finding("run-1", "p1", BUG, at(3)), finding("run-1", "p1", BUG, at(23))],
    jobs: [cycleJob("run-1", at(10)), cycleJob("run-1", at(20))],
  };

  it("leaves the window it landed in unvisited, and contributes no evidence", () => {
    const windows = reportWindows(refused);
    expect(windows.map((w) => w.visited)).toEqual([true, false, true]);
    expect(windows.map((w) => w.visits)).toEqual([1, 0, 1]);
    // Nobody went, so nobody is in the denominator of "N of the M who went hit it" either.
    expect(windows.map((w) => w.visitors)).toEqual([["p1"], [], ["p1"]]);
    // The middle window is no evidence rather than an absence, so the bug is open, not regressed.
    expect(stateOf(refused, BUG)).toBe("open");
    // And the counts still account for exactly the visits that were made.
    expect(windows.reduce((n, w) => n + w.visits, 0)).toBe(2);
  });

  it("still counts a visit that was made and then cut off part-way through", () => {
    // Zero turns is the narrower half of the test on purpose: the same status lands on a visit
    // that really did reach the target before a ceiling stopped it, and that visit is evidence.
    const interrupted: ReportWindowInput = { ...refused, wakes: [...refused.wakes, killedMidVisit("run-1", "p3", at(15), at(16))] };
    const windows = reportWindows(interrupted);
    expect(windows.map((w) => w.visited)).toEqual([true, true, true]);
    expect(windows.map((w) => w.visits)).toEqual([1, 1, 1]);
    expect(windows[1]?.visitors).toEqual(["p3"]);
    // Somebody went and did not report it, which is the shape that IS informative.
    expect(stateOf(interrupted, BUG)).toBe("regressed");
  });

  it("reports an execution whose every visit was refused as one unvisited window", () => {
    const allRefused: ReportWindowInput = {
      runs: [run(1, { endedAt: null })],
      wakes: [refusedWake("run-1", "p1", at(2)), refusedWake("run-1", "p2", at(4), "budget-exceeded")],
      findings: [],
      jobs: [],
    };
    const windows = reportWindows(allRefused);
    expect(windows).toHaveLength(1);
    expect(windows[0]?.visited).toBe(false);
    expect(windows[0]?.visits).toBe(0);
    expect(windows[0]?.visitors).toEqual([]);
  });
});

describe("cycleDue", () => {
  const cycle = ReportCycleSchema.parse({ every: "1h", jitter: "10m", initialDelay: "5m", everyVisits: 25 });
  /** Half of everything, so the jitter is a number the assertions can name. */
  const half = (): number => 0.5;

  it("rolls the jitter once, when the deadline is set", () => {
    const first = firstCycleAt(cycle, new Date(T0), half);
    expect(first.getTime()).toBe(T0 + 5 * 60_000 + 5 * 60_000);
    const next = nextCycleAt(cycle, first, half);
    expect(next.getTime()).toBe(first.getTime() + 60 * 60_000 + 5 * 60_000);
    // Zero jitter is a herd, but it is still honoured where somebody asks for it.
    expect(nextCycleAt(ReportCycleSchema.parse({ every: "1h", jitter: 0 }), new Date(T0), half).getTime()).toBe(T0 + 60 * 60_000);
  });

  it("fires on visits, ahead of the clock", () => {
    const decision = cycleDue({ cycle, dueAt: new Date(T0 + 60 * 60_000), visitsSince: 25, now: new Date(T0 + 60_000) });
    expect(decision).toMatchObject({ due: true, trigger: "visits" });
    expect(decision.msRemaining).toBeGreaterThan(0);
    expect(cycleDue({ cycle, dueAt: new Date(T0 + 60 * 60_000), visitsSince: 24, now: new Date(T0 + 60_000) }).due).toBe(false);
  });

  it("fires on elapsed time, on one visit", () => {
    const due = new Date(T0 + 60 * 60_000);
    expect(cycleDue({ cycle, dueAt: due, visitsSince: 1, now: new Date(due.getTime() - 1) }).due).toBe(false);
    expect(cycleDue({ cycle, dueAt: due, visitsSince: 1, now: due })).toMatchObject({ due: true, trigger: "elapsed" });
  });

  it("has nothing to report when nobody visited, however long it has been", () => {
    expect(cycleDue({ cycle, dueAt: new Date(T0), visitsSince: 0, now: new Date(T0 + 86_400_000) }).due).toBe(false);
  });

  it("never fires twice for one boundary", () => {
    const due = new Date(T0 + 60 * 60_000);
    const fired = new Date(due.getTime() + 1000);
    // Asked again with the same arguments it answers the same, because nothing inside it is random.
    const repeats = Array.from({ length: 20 }, () => cycleDue({ cycle, dueAt: due, visitsSince: 30, now: fired }));
    expect(repeats.every((d) => d.due && d.trigger === "visits")).toBe(true);
    // The window has closed: the deadline moves on and the counter starts again.
    expect(cycleDue({ cycle, dueAt: nextCycleAt(cycle, fired, half), visitsSince: 0, now: fired }).due).toBe(false);
    // And while a cycle is still in flight it is skipped rather than stacked, both triggers or not.
    expect(cycleDue({ cycle, dueAt: due, visitsSince: 30, inFlight: true, now: fired }).due).toBe(false);
  });

  it("leaves time as the only trigger when nothing counts visits", () => {
    const untimed = ReportCycleSchema.parse({ every: "1h", jitter: "1m", everyVisits: null });
    const due = new Date(T0 + 60 * 60_000);
    expect(cycleDue({ cycle: untimed, dueAt: due, visitsSince: 500, now: new Date(T0) }).due).toBe(false);
    expect(cycleDue({ cycle: untimed, dueAt: due, visitsSince: 500, now: due }).trigger).toBe("elapsed");
  });
});

describe("problemReach", () => {
  /** The durable person behind a participant: the same individual in every execution of the study. */
  const PERSON = "weekenders.casual#1";

  /**
   * Five people hit it. Two came back and said nothing about it, one is still active but has not
   * been back, one walked away over something, one ran out of visits. Only the first four could
   * have come back at all, and only the person who quit must be named separately: claiming their
   * silence is claiming a judgement from somebody who left.
   */
  const reports = [
    finding("run-1", "p1", BUG, at(10), "wake-p1"),
    finding("run-1", "p2", BUG, at(11), "wake-p2"),
    finding("run-1", "p3", BUG, at(12), "wake-p3"),
    finding("run-1", "p4", BUG, at(13), "wake-p4"),
    finding("run-1", "p5", BUG, at(14), "wake-p5"),
  ];
  const agents = [
    agent("run-1", "p1"),
    agent("run-1", "p2"),
    agent("run-1", "p3"),
    agent("run-1", "p4", { status: "retired", retiredReason: "gave-up" }),
    agent("run-1", "p5", { status: "retired", retiredReason: "max-wakes" }),
  ];
  /** The execution those five are in, still going — which is what makes "still visiting" true. */
  const live = [run(1, { endedAt: null })];

  it("counts only the people who could have come back, and names the one who walked away", () => {
    const reach = problemReach({
      findings: reports,
      agents,
      runs: live,
      wakes: [
        // The visits that filed the reports. They started before the last report and are not
        // visits made since it.
        wake("run-1", "p1", at(9), at(10)),
        wake("run-1", "p2", at(9), at(11)),
        wake("run-1", "p3", at(9), at(12)),
        wake("run-1", "p1", at(20), at(21)),
        wake("run-1", "p1", at(30), at(31)),
        wake("run-1", "p2", at(20), at(21)),
        // p4 walked away and p5 hit its cap: neither is woken again, so neither can be counted.
        wake("run-1", "p4", at(20), at(21)),
        wake("run-1", "p5", at(20), at(21)),
      ],
    });
    expect(reach.hit).toBe(5);
    expect(reach.participations).toBe(5);
    expect(reach.stillActive).toBe(3);
    expect(reach.cameBack).toBe(2);
    expect(reach.visitsSince).toBe(3);
    expect(reach.walkedAway).toBe(1);
    expect(reach.notBroughtBack).toBe(1);
    expect(reach.stopped).toBe(1);
    expect(reach.lastReportedAt).toBe(at(14));
    // The buckets are a partition of the PARTICIPATIONS, which is one execution's worth of people
    // here and is not the same number as `hit` in general.
    expect(reach.stillActive + reach.walkedAway + reach.stopped + reach.unknown).toBe(reach.participations);
  });

  it("does not count the visit that filed the report as a visit made since", () => {
    const reach = problemReach({
      findings: [finding("run-1", "p1", BUG, at(10), "wake-p1")],
      agents: [agent("run-1", "p1")],
      runs: live,
      // One visit, which started before the report and ended after it.
      wakes: [wake("run-1", "p1", at(9), at(11))],
    });
    expect(reach.cameBack).toBe(0);
    expect(reach.visitsSince).toBe(0);
  });

  it("does not count a visit still in flight, which has not had its say", () => {
    const reach = problemReach({
      findings: [finding("run-1", "p1", BUG, at(10), "wake-p1")],
      agents: [agent("run-1", "p1")],
      runs: live,
      wakes: [wake("run-1", "p1", at(20), null)],
    });
    expect(reach.cameBack).toBe(0);
  });

  it("keys people by execution, since the same participation is not the same one in another run", () => {
    const reach = problemReach({
      findings: [finding("run-1", "p1", BUG, at(10), "wake-p1")],
      agents: [agent("run-1", "p1", { status: "retired", retiredReason: "gave-up", personId: PERSON })],
      // The same id, visiting in a later execution. It is not the participation that hit this.
      wakes: [wake("run-2", "p1", at(20), at(21))],
      runs: [run(1, { status: "completed", endedAt: at(15) }), run(2)],
    });
    expect(reach.hit).toBe(1);
    expect(reach.walkedAway).toBe(1);
    expect(reach.stillActive).toBe(0);
    expect(reach.cameBack).toBe(0);
    expect(reach.visitsSince).toBe(0);
  });

  it("takes an explicit `since`, for a problem last reported before the window being described", () => {
    const reach = problemReach({
      findings: [finding("run-1", "p1", BUG, at(10), "wake-p1")],
      agents: [agent("run-1", "p1")],
      runs: live,
      wakes: [wake("run-1", "p1", at(20), at(21)), wake("run-1", "p1", at(40), at(41))],
      since: at(30),
    });
    expect(reach.lastReportedAt).toBe(at(30));
    expect(reach.visitsSince).toBe(1);
  });

  /**
   * A reporter with no participant row lands in a bucket of its own.
   *
   * Dropped out of all of them — which is what used to happen — the three statuses under "5 hit
   * this" summed to four, in a published comment, with nothing saying why. An execution deleted
   * under a ledger row, or a store rebuilt (ADR-0011), is all it takes.
   */
  it("accounts for a reporter whose participant row is gone", () => {
    const reach = problemReach({
      findings: [finding("run-1", "p1", BUG, at(10), "wake-a"), finding("run-1", "gone", BUG, at(11), "wake-b")],
      agents: [agent("run-1", "p1", { personId: "weekenders.casual#1" })],
      wakes: [],
      runs: live,
    });
    expect(reach.participations).toBe(2);
    expect(reach.unknown).toBe(1);
    expect(reach.stillActive).toBe(1);
    // The buckets are a partition of the participations again, which is what a comment prints.
    expect(reach.stillActive + reach.walkedAway + reach.stopped + reach.unknown).toBe(reach.participations);
  });

  /**
   * The defect this guards: a wake row written for a visit populace REFUSED to make — the kill
   * switch, or the population's daily dollar ceiling, either of them before turn one — was counted
   * as a visit made since the last report. The "gone quiet" comment then told a reader that these
   * people "have been back" N times and said nothing about the problem, when populace had turned
   * every one of them away on the doorstep.
   */
  it("does not count a visit it refused to make as somebody coming back", () => {
    const reach = problemReach({
      findings: [finding("run-1", "p1", BUG, at(10), "wake-p1")],
      agents: [agent("run-1", "p1")],
      runs: live,
      wakes: [refusedWake("run-1", "p1", at(20)), refusedWake("run-1", "p1", at(30), "budget-exceeded")],
    });
    // They are still active — nothing about their row changed — and they have not been back.
    expect(reach.stillActive).toBe(1);
    expect(reach.cameBack).toBe(0);
    expect(reach.visitsSince).toBe(0);
  });

  it("counts the visits that were made among the ones that were refused", () => {
    const reach = problemReach({
      findings: [finding("run-1", "p1", BUG, at(10), "wake-p1")],
      agents: [agent("run-1", "p1"), agent("run-1", "p2")],
      runs: live,
      wakes: [
        refusedWake("run-1", "p1", at(20)),
        // One real visit, between two refusals, plus one cut off after it had reached the target.
        wake("run-1", "p1", at(30), at(31)),
        refusedWake("run-1", "p1", at(40), "budget-exceeded"),
        killedMidVisit("run-1", "p1", at(50), at(51)),
      ],
    });
    expect(reach.cameBack).toBe(1);
    expect(reach.visitsSince).toBe(2);
  });

  it("says nothing was reported, rather than dividing by nobody", () => {
    const reach = problemReach({ findings: [], agents, wakes: [], runs: live });
    expect(reach).toMatchObject({ hit: 0, participations: 0, stillActive: 0, cameBack: 0, visitsSince: 0, walkedAway: 0, notBroughtBack: 0, stopped: 0, unknown: 0, lastReportedAt: null });
  });

  describe("the headline number is people, not participations", () => {
    /**
     * The defect this guards: counting `(runId, agentId)` pairs multiplies the number in "N people
     * hit this" by the number of executions that reported the problem, so one person who hit it in
     * three executions is published to somebody's issue tracker as three people.
     */
    it("counts one person who hit it in two executions once", () => {
      const reach = problemReach({
        findings: [finding("run-1", "p1", BUG, at(10), "wake-a"), finding("run-2", "p1", BUG, at(110), "wake-b")],
        agents: [agent("run-1", "p1", { personId: PERSON }), agent("run-2", "p1", { personId: PERSON })],
        wakes: [],
        runs: [run(1, { status: "completed", endedAt: at(100) }), run(2, { endedAt: null })],
      });
      expect(reach.hit).toBe(1);
      // And the participation count is still there, because it is what the status buckets count.
      expect(reach.participations).toBe(2);
      expect(reach.stillActive).toBe(1);
      expect(reach.stopped).toBe(1);
    });

    it("reads the person off the id when the participant row is gone", () => {
      const id = "everyone/weekenders.casual#1";
      const reach = problemReach({
        findings: [finding("run-1", id, BUG, at(10), "wake-a"), finding("run-2", id, BUG, at(110), "wake-b")],
        agents: [],
        wakes: [],
        runs: [run(1, { status: "completed", endedAt: at(100) }), run(2, { endedAt: null })],
      });
      expect(reach.hit).toBe(1);
      expect(reach.participations).toBe(2);
    });

    it("counts two different people in one execution as two", () => {
      const reach = problemReach({
        findings: [finding("run-1", "p1", BUG, at(10), "wake-a"), finding("run-1", "p2", BUG, at(11), "wake-b")],
        agents: [agent("run-1", "p1", { personId: "weekenders.casual#1" }), agent("run-1", "p2", { personId: "weekenders.casual#2" })],
        wakes: [],
        runs: live,
      });
      expect(reach.hit).toBe(2);
      expect(reach.participations).toBe(2);
    });
  });

  describe("still visiting is a claim about the execution too", () => {
    const hitIt = {
      findings: [finding("run-1", "p1", BUG, at(10), "wake-a"), finding("run-1", "p2", BUG, at(11), "wake-b")],
      agents: [agent("run-1", "p1", { personId: "weekenders.casual#1" }), agent("run-1", "p2", { personId: "weekenders.casual#2" })],
      wakes: [wake("run-1", "p1", at(20), at(21))],
    };

    /**
     * The defect this guards: a participant row keeps `status: "active"` when its execution is
     * paused, so read off the row alone populace would tell a reader that people are still
     * visiting a study that is not running — and a paused longitudinal study is exactly the case
     * where somebody would act on that sentence.
     */
    it("reports nobody still visiting a paused execution, and puts them in the stopped bucket", () => {
      const reach = problemReach({ ...hitIt, runs: [run(1, { status: "paused", pauseReason: "user", endedAt: null })] });
      expect(reach.stillActive).toBe(0);
      expect(reach.stopped).toBe(2);
      expect(reach.cameBack).toBe(0);
      expect(reach.visitsSince).toBe(0);
      expect(reach.stillActive + reach.walkedAway + reach.stopped).toBe(reach.participations);
    });

    it("reports nobody still visiting an execution that is over, however active the rows are", () => {
      for (const status of ["completed", "killed", "failed"] as const) {
        const reach = problemReach({ ...hitIt, runs: [run(1, { status, endedAt: at(30) })] });
        expect(reach.stillActive).toBe(0);
        expect(reach.stopped).toBe(2);
      }
    });

    it("cannot confirm anything about an execution whose row is missing", () => {
      const reach = problemReach({ ...hitIt, runs: [] });
      expect(reach.stillActive).toBe(0);
      expect(reach.stopped).toBe(2);
    });

    it("does count them while the execution is genuinely running", () => {
      const reach = problemReach({ ...hitIt, runs: [run(1, { endedAt: null })] });
      expect(reach.stillActive).toBe(2);
      expect(reach.stopped).toBe(0);
      expect(reach.cameBack).toBe(1);
      expect(reach.visitsSince).toBe(1);
    });
  });

  describe("walked away, and whether the study gave them another look", () => {
    const gaveUp = agent("run-1", "p1", { status: "retired", retiredReason: "gave-up", personId: PERSON });
    const executions = [run(1, { status: "completed", endedAt: at(100) }), run(2, { endedAt: null })];
    const report = { findings: [finding("run-1", "p1", BUG, at(10), "wake-a")], wakes: [] };

    it("says never brought back only when the study never brought them back", () => {
      const reach = problemReach({ ...report, agents: [gaveUp], runs: [executions[0] as Run] });
      expect(reach.walkedAway).toBe(1);
      expect(reach.notBroughtBack).toBe(1);
    });

    /**
     * The defect this guards: "walked away over it and has not been brought back" was asserted off
     * the give-up row alone, and is false as soon as a sibling execution or a carry-forward run
     * puts that person back in.
     */
    it("does not claim a carried-forward person was never brought back", () => {
      const carried = agent("run-2", "p1", {
        personId: PERSON,
        status: "retired",
        retiredReason: "gave-up",
        // Carried in after giving up and having another look, which is what says they came back —
        // whatever they then decided.
        continuedFrom: { runId: "run-1", atWake: 3, gaveUp: true },
      });
      const reach = problemReach({ ...report, agents: [gaveUp, carried], runs: executions });
      expect(reach.walkedAway).toBe(1);
      expect(reach.notBroughtBack).toBe(0);
    });

    it("does not claim it either when a later execution deals them in again", () => {
      const again = agent("run-2", "p1", { personId: PERSON });
      const reach = problemReach({ ...report, agents: [gaveUp, again], runs: executions });
      expect(reach.notBroughtBack).toBe(0);
    });

    it("is not talked out of it by an EARLIER execution, or by somebody else", () => {
      const before = agent("run-0", "p1", { personId: PERSON });
      const somebodyElse = agent("run-2", "p2", { personId: "weekenders.casual#2" });
      const reach = problemReach({
        ...report,
        agents: [before, gaveUp, somebodyElse],
        runs: [run(1, { seq: 2, status: "completed", endedAt: at(100) }), run(2, { seq: 3, endedAt: null }), RunSchema.parse({ id: "run-0", projectId: "p", simulationId: "study", seq: 1, mode: "longitudinal", populationId: "everyone", status: "completed", startedAt: at(0), endedAt: at(1) })],
      });
      expect(reach.walkedAway).toBe(1);
      expect(reach.notBroughtBack).toBe(1);
    });
  });
});

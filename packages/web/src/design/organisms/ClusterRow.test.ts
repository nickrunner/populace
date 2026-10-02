import type { ClusterCardView, Finding } from "@populace/contract";
import { describe, expect, it } from "vitest";

import { stateOfCluster } from "../../format.js";
import { cardOfCluster, type DigestCluster } from "../../screens/digest.js";
import { stateDetail } from "./ClusterRow.js";

/**
 * The one sentence on the results screen that names a number out of the card's history.
 *
 * `ClusterCardView` carries two scopes — `seenIn` counts executions, `seenInWindows` counts report
 * windows (ADR-0045) — and they are the same stretches only for an ephemeral study, which gets one
 * window per execution. A longitudinal study has ONE execution and a window per report cycle, so a
 * row that counts windows and prints the word "execution" states a number that is not true of the
 * sentence it is in: "reported in 3 executions", "first reported in execution 4", about a study
 * that has never had a second execution to report anything.
 *
 * So these assertions are about the words, and they are the guard the read model's two fields exist
 * for: conflate them again and the row goes straight back to inventing executions.
 *
 * Two of them are about the ways the judgement was WRONG rather than missing, because both passed
 * the length comparison it used to be. A card reported in exactly one window has one entry in each
 * list however many windows the study has had, and a long ephemeral run with report cycles can
 * report a problem in two windows that fall in two other executions — same length, four different
 * stretches. And the last describes `stateOfCluster`, which asked the study's MODE instead and now
 * reads the same judgement as the row: two ways to answer one question is why this kept returning.
 */

const HOUR = 60 * 60 * 1000;

const card = (over: Partial<ClusterCardView>): ClusterCardView => ({
  signature: "sig1:1f0c9a2e41b7",
  title: "Search says it is case-insensitive and is not",
  severity: "high",
  kind: "bug",
  tool: "search_tasks",
  verdict: "confirmed",
  peopleHit: 3,
  peopleTotal: 8,
  reports: 4,
  cohorts: [],
  inLatest: true,
  state: "open",
  seenIn: [1],
  seenInWindows: [1],
  firstSeenAt: new Date(Date.now() - 51 * HOUR).toISOString(),
  lastSeenAt: new Date(Date.now() - 2 * HOUR).toISOString(),
  triage: null,
  filedIssue: null,
  ...over,
});

/** One execution, three report cycles that all reported it. The main case (ADR-0045). */
const longitudinal = (over: Partial<ClusterCardView>): ClusterCardView => card({ seenIn: [1], seenInWindows: [1, 2, 3], ...over });

describe("a longitudinal study's row", () => {
  it("names no execution count for a study that has had one execution", () => {
    for (const state of ["new", "open", "fixed", "regressed"] as const) {
      const detail = stateDetail(longitudinal({ state, inLatest: state !== "fixed" }), 1);
      // Not "3 executions", not "execution 2", not "execution 3" — the study has had one, and the
      // only honest count of the three stretches is a count of windows, which this sentence is not
      // about.
      expect(detail).not.toMatch(/execution/);
      expect(detail).not.toMatch(/\b3\b/);
      // ...and it still says something: the time-based words, which are true at either scope.
      expect(detail).toMatch(/ago|·/);
      // Whatever it says, it never says the product was mended (§7.3, ADR-0028).
      expect(detail).not.toMatch(/fixed|repaired/);
    }
  });

  /**
   * The case the length comparison could not see, and the one the state machine makes commonest: a
   * problem reported in the FIRST cycle and not since. One execution, one window in the list, so
   * both lists are length 1 and the old check said "name the execution" — about a study whose only
   * execution is still running and still being visited. The absence is from a later CYCLE of
   * execution 1, which is why the sentence may not mention executions at all.
   */
  it("names no execution for a problem reported in exactly one window", () => {
    const quiet = card({ state: "fixed", inLatest: false, seenIn: [1], seenInWindows: [1] });
    expect(stateDetail(quiet, 1)).toBe("not reported since 2 hours ago");
    expect(stateDetail(quiet, 1)).not.toMatch(/execution/);
  });

  it("says how long ago, in the words the longitudinal branch already had", () => {
    expect(stateDetail(longitudinal({ state: "new" }), 1)).toBe("first reported 2 days ago");
    expect(stateDetail(longitudinal({ state: "fixed", inLatest: false }), 1)).toBe("not reported since 2 hours ago");
    expect(stateDetail(longitudinal({ state: "regressed" }), 1)).toBe("reported again 2 hours ago");
    expect(stateDetail(longitudinal({ state: "open" }), 1)).toBe("first 2 days ago · last 2 hours ago");
  });
});

describe("an ephemeral study's row", () => {
  /**
   * Unchanged, and asserted so rather than assumed: its windows ARE its executions, one each, so
   * every sentence that named one before names the same one now.
   */
  it("still names the execution when the card's two scopes are the same stretches", () => {
    expect(stateDetail(card({ state: "new", seenIn: [3], seenInWindows: [3] }), 3)).toBe("first reported in execution 3");
    expect(stateDetail(card({ state: "open", seenIn: [1, 2, 4], seenInWindows: [1, 2, 4] }), 4)).toBe("reported in 3 executions");
    expect(stateDetail(card({ state: "fixed", inLatest: false, seenIn: [1, 2], seenInWindows: [1, 2] }), 3)).toBe("last reported in execution 2");
    expect(stateDetail(card({ state: "regressed", seenIn: [1, 4], seenInWindows: [1, 4] }), 4)).toBe("absent, and reported again in execution 4");
  });

  /**
   * A long ephemeral run may close a window mid-execution too (ADR-0045 §2), and then the two
   * lists can match in length while naming different stretches: reported in windows 2 and 3,
   * which fall in executions 1 and 2. Two entries each, four stretches, and the ordinals are the
   * proof — window `k` is execution `k` only where there is one window per execution.
   */
  it("names no execution when the ordinals disagree, however well the lengths match", () => {
    const spanning = card({ state: "open", seenIn: [1, 2], seenInWindows: [2, 3] });
    expect(stateDetail(spanning, 2)).toBe("first 2 days ago · last 2 hours ago");
    expect(stateDetail(spanning, 2)).not.toMatch(/execution/);
  });

  /**
   * A card from a producer with no window scope of its own — the design fixtures, and nothing
   * populace serves — is execution-scoped by construction, and its figures were drawn as
   * executions. Omitting the field must not silently change what those figures say.
   */
  it("reads a card with no window scope as the executions it always was", () => {
    const fixture = card({ state: "open", seenIn: [1, 2, 4] });
    delete fixture.seenInWindows;
    expect(stateDetail(fixture, 4)).toBe("reported in 3 executions");
  });
});

/**
 * The other producer of a `ClusterCardView`: the execution digest screen, which translates a
 * rendered digest into the same row (`cardOfCluster`). A digest is one execution's window, so it
 * is the case where the two scopes genuinely are one stretch — and it has to SAY so, because a
 * card that left the window scope out would be read as a fixture's and get the right sentence for
 * the wrong reason.
 */
describe("the digest screen's card", () => {
  const finding = (): Finding => ({
    id: "f1",
    runId: "run_1",
    tag: "populace:run_1",
    wakeId: "w1",
    agentId: "pop/regulars#1",
    personaId: "regular",
    kind: "bug",
    signature: "sig1:abcdef123456",
    title: "search misses capitalised tasks",
    description: "",
    expected: "",
    observed: "",
    severity: "high",
    confidence: 0.8,
    reproduction: [],
    endpoint: "default",
    identityId: null,
    verification: null,
    createdAt: "2026-01-01T10:00:00.000Z",
  });

  const cluster = (): DigestCluster => {
    const members = [finding()];
    return {
      id: "cluster-1",
      signature: "sig1:abcdef123456",
      kind: "bug",
      title: "search misses capitalised tasks",
      severity: "high",
      tool: "search_tasks",
      representative: members[0] ?? finding(),
      findings: members,
      personaIds: ["regular"],
      cohorts: [],
      personIds: ["regulars#1"],
      wakeIds: ["w1"],
      confirmedCount: 0,
      notReproducedCount: 0,
      inconclusiveCount: 0,
      unverifiedCount: 1,
    };
  };

  it("names its own window as well as its own execution, and keeps the row naming the execution", () => {
    const built = cardOfCluster(cluster(), { seq: 4, peopleTotal: 12 });
    expect(built.seenIn).toEqual([4]);
    expect(built.seenInWindows).toEqual([4]);
    expect(stateDetail(built, 4)).toBe("reported in 1 execution");
  });
});

/**
 * `stateOfCluster` writes the same sentence for the finding page's header, and it used to decide
 * whether to name an execution by asking the STUDY'S MODE. Both answers were right only while
 * report cycles were armed for longitudinal studies alone: arm them for an ephemeral study and
 * mode says "name executions" about a card whose state was computed over cycles, which is this
 * round's defect with a different guard in front of it.
 *
 * So the mode argument decides nothing, and this is the assertion that holds it: an EPHEMERAL
 * study, a card whose scopes disagree, and the words that are true at either scope.
 */
describe("the finding page's header sentence", () => {
  it("reads the card's scopes and not the study's mode", () => {
    const cycled = card({ state: "fixed", inLatest: false, seenIn: [1], seenInWindows: [1, 2, 3] });
    expect(stateOfCluster(cycled, "ephemeral", [1])).toMatchObject({
      badge: "gone quiet",
      detail: "not reported since 2 hours ago",
    });
  });

  /** And where they do agree, an ephemeral study's header is word for word what it was. */
  it("still names the execution for a study with one window per execution", () => {
    const sibling = card({ state: "fixed", inLatest: false, seenIn: [1, 2], seenInWindows: [1, 2] });
    expect(stateOfCluster(sibling, "ephemeral", [1, 2, 3])).toMatchObject({
      badge: "not reported",
      detail: "last reported in execution 2",
    });
  });
});

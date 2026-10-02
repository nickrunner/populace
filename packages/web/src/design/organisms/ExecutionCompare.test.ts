import { describe, expect, it } from "vitest";
import type { ClusterCardView, ExecutionHistoryEntry } from "@populace/contract";

import { compareReadings } from "./ExecutionCompare.js";

/**
 * How the side-by-side screen decides which of its three groups a problem belongs in.
 *
 * The answer is "it does not decide" — the read model's `compare()` partitions by RUN ID and sends
 * `persisting`, `fixed` and `appeared` over the wire, and this component reads them. It used to
 * split one flat list itself by asking whether each card's `seenIn` contained an execution's
 * `seq`, and that is what these tests pin shut.
 *
 * The arithmetic is no longer the reason. `seenIn` counts executions and `seenInWindows` counts
 * report windows (ADR-0045), so an execution `seq` and a `seenIn` entry are at last the same kind
 * of number. What the filter still got wrong is the QUESTION. `compare()` clusters each
 * execution's own findings and shares out the cards by which representative signatures the two
 * sets have in common; `seenIn` comes from the study-wide GROUP's history, and a group holds every
 * wording of one problem on purpose. The two answers come apart precisely where this screen is
 * least allowed to be wrong — see the first test.
 */

function execution(seq: number, runId: string): ExecutionHistoryEntry {
  return {
    runId,
    seq,
    label: `execution ${seq}`,
    status: "completed",
    startedAt: "2026-09-01T10:00:00.000Z",
    endedAt: "2026-09-01T11:00:00.000Z",
    visits: 12,
    findings: 4,
    confirmed: 3,
    costUsd: 1.5,
  };
}

/**
 * One card as the server builds it, with both scopes set and agreeing.
 *
 * `seenIn` is the execution sequence numbers that reported the card's group and `seenInWindows` the
 * report-window ordinals. These fixtures are all ephemeral studies, which get exactly one window
 * per execution, so the two lists are the same numbers — which is the only case where they may be,
 * and stating it here is what keeps the fixtures honest rather than merely convenient.
 */
function card(signature: string, seenIn: readonly number[]): ClusterCardView {
  return {
    signature,
    title: `search_tasks misses anything typed in capitals (${signature})`,
    severity: "high",
    kind: "bug",
    tool: "search_tasks",
    verdict: "confirmed",
    peopleHit: 3,
    peopleTotal: 8,
    reports: 4,
    cohorts: [{ slug: "planners", name: "Planners", hit: 3, total: 8 }],
    inLatest: true,
    state: "open",
    seenIn: [...seenIn],
    seenInWindows: [...seenIn],
    firstSeenAt: "2026-09-01T10:30:00.000Z",
    lastSeenAt: "2026-09-08T10:30:00.000Z",
    triage: null,
    filedIssue: null,
  };
}

describe("compareReadings", () => {
  it("keeps the server's absence an absence, though the problem's group was reported in both", () => {
    // One bug, worded one way in execution 4 and another way in execution 5. `compare()` clusters
    // each execution's findings separately, so the two wordings are two cards: an absence from 5
    // and an arrival in 5. But `seenIn` is the study-wide GROUP's history, and the clusterer puts
    // both wordings in one group, so BOTH cards say they were seen in executions 4 and 5 — which
    // is true of the group and true of neither card. The old filter asked the card, got "both" for
    // each, and printed the same bug twice under "Reported in both", erasing the only thing the
    // screen was opened to see.
    const wasWordedThisWay = card("bug|search_tasks|capitals miss", [4, 5]);
    const nowWordedThatWay = card("bug|search_tasks|uppercase ignored", [4, 5]);
    const { earlier, later, readings } = compareReadings({
      a: execution(4, "run_a_aaaaaa"),
      b: execution(5, "run_b_bbbbbb"),
      persisting: [],
      fixed: [wasWordedThisWay],
      appeared: [nowWordedThatWay],
    });

    expect(earlier.seq).toBe(4);
    expect(later.seq).toBe(5);
    // The precondition, asserted so the test cannot pass by accident: asked of its own history,
    // each card claims both executions, and a filter reading it would say "both".
    expect(wasWordedThisWay.seenIn).toEqual([4, 5]);
    expect(nowWordedThatWay.seenIn).toEqual([4, 5]);

    // What the server said, which is what the screen must show: nothing in both, one gone, one new.
    expect(readings.find((reading) => reading.key === "both")?.clusters).toEqual([]);
    expect(readings.find((reading) => reading.key === "only-earlier")?.clusters.map((c) => c.signature)).toEqual([wasWordedThisWay.signature]);
    expect(readings.find((reading) => reading.key === "only-later")?.clusters.map((c) => c.signature)).toEqual([nowWordedThatWay.signature]);
    // The booleans are what the paired lattice's sentences are built from, so a screen reader
    // reaches "Reported here" and "Not reported here" beside the row's own `execution N` stub,
    // rather than colour alone. The reach in that sentence names no execution on purpose: one card
    // is drawn on both sides and its incidence belongs to only one of them (see LatticeSide).
    const gone = readings.find((reading) => reading.key === "only-earlier");
    expect(gone?.reportedEarlier).toBe(true);
    expect(gone?.reportedLater).toBe(false);
  });

  it("drops nothing: every card the server sent lands in exactly one reading", () => {
    // The re-derivation had a hole in it — three predicates over one flat list, and a card
    // answering no to all three fell through — so totality is asserted directly rather than
    // inferred from any one card's history.
    const persisting = [card("sig|both|one", [6, 7]), card("sig|both|two", [6, 7])];
    const fixed = [card("sig|gone|one", [6])];
    const appeared = [card("sig|new|one", [7])];
    const { readings } = compareReadings({
      a: execution(6, "run_a_aaaaaa"),
      b: execution(7, "run_b_bbbbbb"),
      persisting,
      fixed,
      appeared,
    });

    const placed = readings.flatMap((reading) => reading.clusters.map((c) => c.signature));
    expect([...placed].sort()).toEqual(
      [...persisting, ...fixed, ...appeared].map((c) => c.signature).sort(),
    );
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("says absence of the earlier side's own list, and never of the later one's", () => {
    // `sig|gone` was reported in executions 1 and 2 and not in 3; `sig|new` only in 3.
    const { readings } = compareReadings({
      a: execution(2, "run_a_aaaaaa"),
      b: execution(3, "run_b_bbbbbb"),
      persisting: [],
      fixed: [card("sig|gone", [1, 2])],
      appeared: [card("sig|new", [3])],
    });

    const gone = readings.find((reading) => reading.key === "only-earlier");
    expect(gone?.title).toBe("Not reported in execution 3");
    expect(gone?.clusters.map((c) => c.signature)).toEqual(["sig|gone"]);
    expect(gone?.reportedEarlier).toBe(true);
    expect(gone?.reportedLater).toBe(false);
    // Nothing in the copy may read as a repair (§7.3), on any of the three groups.
    for (const reading of readings) {
      expect(`${reading.title} ${reading.sub} ${reading.empty}`.toLowerCase()).not.toContain(
        "fixed",
      );
    }

    const arrived = readings.find((reading) => reading.key === "only-later");
    expect(arrived?.title).toBe("Only in execution 3");
    expect(arrived?.clusters.map((c) => c.signature)).toEqual(["sig|new"]);
    expect(arrived?.reportedEarlier).toBe(false);
    expect(arrived?.reportedLater).toBe(true);
  });

  it("swaps both sides together when the pair arrives newest first", () => {
    // The server's `fixed` is "in a, not in b" whatever a and b are; earlier and later are read
    // off the sequence. A caller handing them over the other way round must not get a heading
    // saying "not reported in execution 9" over the problems only execution 9 reported.
    const { earlier, later, readings } = compareReadings({
      a: execution(9, "run_newer_a"),
      b: execution(8, "run_older_b"),
      persisting: [],
      fixed: [card("sig|only-in-9", [9])],
      appeared: [card("sig|only-in-8", [8])],
    });

    expect(earlier.seq).toBe(8);
    expect(later.seq).toBe(9);
    expect(
      readings.find((reading) => reading.key === "only-earlier")?.clusters.map((c) => c.signature),
    ).toEqual(["sig|only-in-8"]);
    expect(
      readings.find((reading) => reading.key === "only-later")?.clusters.map((c) => c.signature),
    ).toEqual(["sig|only-in-9"]);
  });
});

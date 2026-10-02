import type { Digest, Finding } from "@populace/contract";
import { describe, expect, it } from "vitest";

import {
  cardOfCluster,
  checkStateOf,
  nothingToList,
  verdictOfCluster,
  whatDidNotReproduce,
  whatHasBeenChecked,
  whatWasFiled,
  whyRecheckFailed,
  windowNote,
  type DigestCluster,
} from "./digest.js";

/**
 * The arithmetic and the copy behind the execution digest screen.
 *
 * This package has no component-rendering tests and is not getting any, so what is asserted here
 * is everything the screen could get wrong without anybody noticing: the denominator under
 * "3 of 12 people", the count of how much has actually been judged, and — above all — that an
 * unjudged report is never worded as a conclusion and an absence is never worded as a repair
 * (ADR-0028, DESIGN-SYSTEM §7.3).
 */

let seq = 0;

/** A finding with only the fields these functions read spelled out; the rest is ballast. */
function finding(over: Partial<Finding> = {}): Finding {
  seq += 1;
  return {
    id: `f${seq}`,
    runId: "run_1",
    tag: "populace:run_1",
    wakeId: `w${seq}`,
    agentId: `pop/regulars#${seq}`,
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
    ...over,
  };
}

function cluster(over: Partial<DigestCluster> = {}): DigestCluster {
  const members = over.findings ?? [finding()];
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
    wakeIds: members.map((f) => f.wakeId),
    confirmedCount: 0,
    notReproducedCount: 0,
    inconclusiveCount: 0,
    unverifiedCount: members.length,
    ...over,
  };
}

function digest(over: Partial<Digest> = {}): Digest {
  const clusters = over.clusters ?? [cluster()];
  return {
    id: "digest_1",
    targetName: "Tasklet",
    runIds: ["run_1"],
    window: { from: "2026-01-01T10:00:00.000Z", to: "2026-01-01T10:30:00.000Z" },
    generatedAt: "2026-01-01T10:30:00.000Z",
    totals: {
      wakes: 24,
      agents: 12,
      findings: clusters.reduce((n, c) => n + c.findings.length, 0),
      clusters: clusters.length,
      costUsd: 1.5,
    },
    clusters,
    ...over,
  };
}

describe("how much of a digest has actually been judged", () => {
  it("counts an unverified digest as nothing checked, which is the state the screen is built for", () => {
    const state = checkStateOf(digest({ clusters: [cluster({ findings: [finding(), finding(), finding()], unverifiedCount: 3 })] }));
    expect(state).toMatchObject({ listed: 3, checked: 0, unchecked: 3, notReproduced: 0 });
  });

  it("reads the findings that fell out of the list as not-reproduced rather than as missing", () => {
    // `buildDigest` clusters everything EXCEPT the findings a replay did not reproduce, so the
    // totals and the clusters disagree by exactly those. A screen that trusted either number as
    // both would silently lose four reports.
    const state = checkStateOf(
      digest({
        clusters: [cluster({ findings: [finding(), finding()], confirmedCount: 2, unverifiedCount: 0 })],
        totals: { wakes: 24, agents: 12, findings: 6, clusters: 1, costUsd: 1.5 },
      }),
    );
    expect(state.listed).toBe(2);
    expect(state.checked).toBe(2);
    expect(state.notReproduced).toBe(4);
  });

  it("never reports a negative count when the totals and the clusters are read a moment apart", () => {
    const state = checkStateOf(
      digest({
        clusters: [cluster({ findings: [finding(), finding()] })],
        totals: { wakes: 1, agents: 1, findings: 0, clusters: 1, costUsd: 0 },
      }),
    );
    expect(state.notReproduced).toBe(0);
  });
});

describe("one cluster's verdict, out of four counts", () => {
  it("takes the strongest thing a judge actually demonstrated", () => {
    expect(verdictOfCluster(cluster({ confirmedCount: 1, inconclusiveCount: 2, unverifiedCount: 0 }))).toBe("confirmed");
    expect(verdictOfCluster(cluster({ inconclusiveCount: 2, unverifiedCount: 0 }))).toBe("inconclusive");
    expect(verdictOfCluster(cluster({ notReproducedCount: 1, unverifiedCount: 0 }))).toBe("not-reproduced");
  });

  it("says nothing at all when nobody has ruled, which the row prints as 'not checked yet'", () => {
    expect(verdictOfCluster(cluster({ unverifiedCount: 3 }))).toBeNull();
  });
});

describe("a digest cluster, as the results screen's row reads one", () => {
  const card = cardOfCluster(
    cluster({ personIds: ["regulars#1", "regulars#2", "sceptics#1"], findings: [finding(), finding({ createdAt: "2026-01-01T10:20:00.000Z" })] }),
    { seq: 4, peopleTotal: 12 },
  );

  it("counts the people who WENT as the denominator, not the people who reported", () => {
    // The digest is built with no cohort census, so the clusterer's own `peopleTotal` is just the
    // people it saw in the findings — every problem would read "3 of 3 people".
    expect(card.peopleHit).toBe(3);
    expect(card.peopleTotal).toBe(12);
    expect(card.reports).toBe(2);
  });

  it("floors the denominator at the numerator rather than drawing 3 of 1", () => {
    expect(cardOfCluster(cluster({ personIds: ["a", "b", "c"] }), { seq: 1, peopleTotal: 1 }).peopleTotal).toBe(3);
  });

  it("drops the per-cohort rows, whose totals are numerators in disguise", () => {
    const withCohorts = cardOfCluster(
      cluster({ cohorts: [{ slug: "regulars", name: "Regulars", peopleHit: 3, peopleTotal: 3, reports: 3 }] }),
      { seq: 1, peopleTotal: 12 },
    );
    expect(withCohorts.cohorts).toEqual([]);
  });

  it("claims nothing about other executions: the window is one execution and the state says only 'reported here'", () => {
    expect(card.state).toBe("open");
    expect(card.seenIn).toEqual([4]);
    expect(card.triage).toBeNull();
    expect(card.firstSeenAt).toBe("2026-01-01T10:00:00.000Z");
    expect(card.lastSeenAt).toBe("2026-01-01T10:20:00.000Z");
  });
});

describe("the sentence a reader who reads nothing else gets", () => {
  it("says who went, what they did and what came of it, with the numbers", () => {
    expect(whatWasFiled(digest({ totals: { wakes: 24, agents: 12, findings: 31, clusters: 6, costUsd: 2 } }))).toBe(
      "12 people made 24 visits and filed 31 findings, which cluster into 6 problems.",
    );
  });

  it("gives a zero-findings execution the same sentence rather than an apology", () => {
    expect(whatWasFiled(digest({ clusters: [], totals: { wakes: 36, agents: 12, findings: 0, clusters: 0, costUsd: 2 } }))).toBe(
      "12 people made 36 visits and filed nothing.",
    );
  });

  it("does not claim clusters when the replay emptied the list", () => {
    expect(whatWasFiled(digest({ clusters: [], totals: { wakes: 4, agents: 1, findings: 3, clusters: 0, costUsd: 0 } }))).toBe(
      "1 person made 4 visits and filed 3 findings.",
    );
  });
});

describe("claims against verdicts, said plainly", () => {
  it("refuses to let an unjudged digest read as a set of conclusions", () => {
    const words = whatHasBeenChecked({ listed: 31, checked: 0, confirmed: 0, inconclusive: 0, unchecked: 31, notReproduced: 0 });
    expect(words).toContain("None of this has been re-checked");
    expect(words).toContain("not a verdict");
  });

  it("says how far the judge got when it got partway", () => {
    expect(whatHasBeenChecked({ listed: 10, checked: 6, confirmed: 4, inconclusive: 2, unchecked: 4, notReproduced: 0 })).toBe(
      "6 of the 10 findings below have been replayed against the target. The other 4 are still reports, not verdicts.",
    );
  });

  it("keeps the last one singular", () => {
    expect(whatHasBeenChecked({ listed: 4, checked: 3, confirmed: 3, inconclusive: 0, unchecked: 1, notReproduced: 0 })).toContain(
      "The last one is still a report, not a verdict.",
    );
  });

  it("says nothing when there is nothing listed", () => {
    expect(whatHasBeenChecked({ listed: 0, checked: 0, confirmed: 0, inconclusive: 0, unchecked: 0, notReproduced: 0 })).toBe("");
  });

  it("never promises a repeat, in any branch", () => {
    const states = [
      { listed: 31, checked: 0, confirmed: 0, inconclusive: 0, unchecked: 31, notReproduced: 0 },
      { listed: 10, checked: 6, confirmed: 4, inconclusive: 2, unchecked: 4, notReproduced: 0 },
      { listed: 4, checked: 4, confirmed: 4, inconclusive: 0, unchecked: 0, notReproduced: 2 },
    ];
    for (const state of states) {
      const words = `${whatHasBeenChecked(state)} ${whatDidNotReproduce(state) ?? ""}`;
      expect(words).not.toMatch(/\bfixed\b|\brepair|\bevery time\b|\balways\b/i);
    }
  });
});

describe("the findings that did not recur", () => {
  it("accounts for them as one replay's result, never as a repair", () => {
    const words = whatDidNotReproduce({ listed: 2, checked: 2, confirmed: 2, inconclusive: 0, unchecked: 0, notReproduced: 4 });
    expect(words).toBe(
      "4 findings filed in this execution are not listed above: they were replayed and did not recur. That is what one replay found, not a promise about the next one.",
    );
  });

  it("stays silent when everything filed is listed", () => {
    expect(whatDidNotReproduce({ listed: 2, checked: 0, confirmed: 0, inconclusive: 0, unchecked: 2, notReproduced: 0 })).toBeNull();
  });
});

describe("the empty case, which is a state and not an error", () => {
  it("reports nobody filing anything as a result, and names where to check coverage", () => {
    const empty = digest({ clusters: [], totals: { wakes: 36, agents: 12, findings: 0, clusters: 0, costUsd: 2 } });
    expect(nothingToList(empty, checkStateOf(empty))).toBe(
      "12 people made 36 visits and none of them filed anything. That is a result, not a gap — the coverage table says which of your tools they actually reached.",
    );
  });

  it("reports a list the replay emptied as what that replay found", () => {
    const replayed = digest({ clusters: [], totals: { wakes: 4, agents: 2, findings: 3, clusters: 0, costUsd: 0 } });
    const words = nothingToList(replayed, checkStateOf(replayed));
    expect(words).toContain("none of it recurred");
    expect(words).toContain("not a promise about the next execution");
  });
});

describe("an execution that did not run to the end", () => {
  it("treats stopping halfway as an ordinary window, not a broken digest", () => {
    expect(windowNote("killed")).toContain("shorter, not the digest partial");
    expect(windowNote("paused")).toContain("whole reading of the part that ran");
    expect(windowNote("running")).toContain("up to now");
  });

  it("says nothing about an execution that finished", () => {
    expect(windowNote("completed")).toBeNull();
  });
});

describe("why a re-check did not happen", () => {
  it("names the missing API key, and what to do about it", () => {
    const words = whyRecheckFailed(503);
    expect(words).toContain("ANTHROPIC_API_KEY");
    expect(words).toContain("verifier.judge");
  });

  it("names the unreachable target, and sends the reader to the study that ran it", () => {
    expect(whyRecheckFailed(409)).toContain("check the study it ran");
  });

  it("promises the stored findings are untouched, whatever refused", () => {
    for (const status of [503, 409, 500, 0]) expect(whyRecheckFailed(status)).toContain("exactly as it was");
  });
});

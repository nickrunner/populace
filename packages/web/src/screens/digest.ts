import type { ClusterCardView, Digest, RunStatus, Verdict } from "@populace/contract";

import { people, plural } from "../format.js";

/**
 * What a digest of ONE execution says, worked out away from the screen that draws it.
 *
 * `ExecutionDigest` is a React component and this package has no component-rendering tests, so
 * everything here that could be got wrong quietly — a denominator, a count of what has actually
 * been judged, the sentence that tells a reader whether they are looking at claims or at verdicts
 * — is a function of its arguments and is asserted in `digest.test.ts`. The screen is then a
 * layout over these.
 *
 * The one thing to keep in mind reading any of it: **a digest built without `?verify=true` is
 * what the people who went said, not what a judge confirmed.** Nothing in this file may phrase an
 * unjudged report as a conclusion, and nothing in it may phrase an absence as a repair (ADR-0028,
 * DESIGN-SYSTEM §7.3).
 */

/** One cluster as `DigestSchema` carries it. Not a `ClusterCardView` — see `cardOfCluster`. */
export type DigestCluster = Digest["clusters"][number];

/**
 * How much of a digest has been through the judge, and what fell out of it on the way.
 *
 * `notReproduced` is the subtle one. `buildDigest` clusters only the findings whose verdict is
 * not `not-reproduced` — a replayed finding that did not recur is dropped from the list and
 * survives as a count — so the findings totalled in `digest.totals` and the findings listed in
 * `digest.clusters` are deliberately different numbers, and a screen that printed one of them as
 * both would either lose reports or invent them.
 */
export interface DigestCheckState {
  /** Findings inside the clusters below. */
  listed: number;
  /** Of those, how many a judge has ruled on. */
  checked: number;
  confirmed: number;
  inconclusive: number;
  /** Listed findings nobody has replayed yet: claims, not verdicts. */
  unchecked: number;
  /** Findings filed in this window that are NOT listed, because the replay did not reproduce them. */
  notReproduced: number;
}

export function checkStateOf(digest: Digest): DigestCheckState {
  let listed = 0;
  let confirmed = 0;
  let inconclusive = 0;
  let notReproducedInList = 0;
  let unchecked = 0;
  for (const cluster of digest.clusters) {
    listed += cluster.findings.length;
    confirmed += cluster.confirmedCount;
    inconclusive += cluster.inconclusiveCount;
    notReproducedInList += cluster.notReproducedCount;
    unchecked += cluster.unverifiedCount;
  }
  return {
    listed,
    checked: confirmed + inconclusive + notReproducedInList,
    confirmed,
    inconclusive,
    unchecked,
    // Never negative: the totals and the clusters are two reads of the store a moment apart, and
    // a negative count printed as "−1 findings did not recur" is worse than a silent floor.
    notReproduced: Math.max(0, digest.totals.findings - listed),
  };
}

/**
 * One cluster's verdict, from the four counts the digest keeps.
 *
 * A cluster is several people reporting the same thing and they are judged one at a time, so
 * there is no single stored verdict to read. The rule is *the strongest thing a judge actually
 * demonstrated*: one replay that reproduced outweighs two that were inconclusive, because a
 * reproduction is evidence and an inconclusive is the absence of it. `null` is not a verdict at
 * all and renders as "not checked yet".
 */
export function verdictOfCluster(cluster: DigestCluster): Verdict | null {
  if (cluster.confirmedCount > 0) return "confirmed";
  if (cluster.inconclusiveCount > 0) return "inconclusive";
  if (cluster.notReproducedCount > 0) return "not-reproduced";
  return null;
}

/**
 * A digest cluster as `ClusterRow` reads one.
 *
 * The row is `StudyResults`' row and this screen does not get a second one; what it gets is
 * a translation, because the results screen's `ClusterCardView` is assembled by the server from a
 * project's whole history and a digest knows only its own window.
 *
 * Three fields are the careful ones:
 *
 *  - **`peopleTotal` is the people who went**, passed in from `digest.totals.agents`, and not the
 *    cluster's own `cohorts[].peopleTotal`. `buildDigest` calls `clusterFindings` with no census,
 *    and without one the clusterer falls back to counting the people it saw *in the findings* —
 *    so every cohort's denominator equals its numerator and the row would read "3 of 3 people"
 *    for every problem in the digest, which says everybody hit it.
 *  - **`cohorts` is emptied** for the same reason. Nothing on this screen draws incidence bars,
 *    and handing on a per-cohort denominator that is really a numerator is a trap for whoever
 *    draws them next.
 *  - **`state` is `open`, and both `seenIn` and `seenInWindows` are this execution and only this
 *    execution.** A digest is one execution's window; it cannot see whether a problem is new,
 *    back, or absent from a later run, and `new`/`regressed`/`fixed` all claim exactly that.
 *    `open` claims nothing beyond "reported here", which is all the window supports. The two lists
 *    are the same one entry because here the two scopes really are one stretch, which is exactly
 *    what the results screen's card cannot assume (`ClusterCardView`).
 */
export function cardOfCluster(cluster: DigestCluster, options: { seq: number; peopleTotal: number }): ClusterCardView {
  const filedAt = cluster.findings.map((finding) => finding.createdAt).sort();
  return {
    signature: cluster.signature,
    title: cluster.title,
    severity: cluster.severity,
    kind: cluster.kind,
    tool: cluster.tool ?? null,
    verdict: verdictOfCluster(cluster),
    peopleHit: cluster.personIds.length,
    // A floor rather than a trust: the totals count people who made a visit and the cluster counts
    // people who filed, and a denominator below its numerator reads as a broken screen.
    peopleTotal: Math.max(options.peopleTotal, cluster.personIds.length),
    reports: cluster.findings.length,
    cohorts: [],
    // True by construction: a digest holds the problems its own window reported, so there is no
    // absence card in one to carry.
    inLatest: true,
    state: "open",
    seenIn: [options.seq],
    // One window, because a digest IS one: it is rendered for a single execution and holds the
    // problems that execution reported, so the stretch this card is about and the execution it is
    // about are the same stretch. Saying so is what tells a row that a sentence naming an execution
    // is true here — the two lists agree in length, as they do for any one-window-per-execution
    // study — where on the results screen they can disagree and the row has to stop naming one.
    // If a digest is ever rendered per report cycle, this is the line that has to learn the cycle's
    // own ordinal rather than borrow its execution's.
    seenInWindows: [options.seq],
    firstSeenAt: filedAt[0] ?? null,
    lastSeenAt: filedAt.at(-1) ?? null,
    triage: null,
    // The filing ledger is a project's row, not a digest's: a digest is a rendered window and
    // knows nothing about what populace has opened anywhere. Saying "not filed" is the only thing
    // this translation can say, and the results screen is where the real answer lives.
    filedIssue: null,
  };
}

/**
 * The one sentence for somebody who reads nothing else: who went, how much they did, what came of
 * it. §7.4 — say what happened, with a number — and a zero-findings execution gets this sentence
 * too rather than being demoted to an empty box.
 */
export function whatWasFiled(digest: Digest): string {
  const { agents, wakes, findings, clusters } = digest.totals;
  const went = `${people(agents)} made ${plural(wakes, "visit")}`;
  if (findings === 0) return `${went} and filed nothing.`;
  if (clusters === 0) return `${went} and filed ${plural(findings, "finding")}.`;
  return `${went} and filed ${plural(findings, "finding")}, which cluster into ${plural(clusters, "problem")}.`;
}

/**
 * Whether the reader is looking at claims or at verdicts, said plainly and once.
 *
 * This is the sentence the brief for this screen turns on. A digest built without verification is
 * what the people who went reported; the product's position is that a report is not a finding
 * until its recorded calls have been run again, so a screen that let 31 unjudged reports read as
 * 31 conclusions would be overstating its own evidence.
 */
export function whatHasBeenChecked(state: DigestCheckState): string {
  if (state.listed === 0) return "";
  if (state.checked === 0)
    return "None of this has been re-checked. Every problem below is what somebody reported in their own words, not a verdict a judge reached.";
  if (state.unchecked === 0)
    return `Every one of the ${plural(state.listed, "finding")} below has been replayed against the target, and ${state.confirmed} of them reproduced.`;
  const rest =
    state.unchecked === 1
      ? "The last one is still a report, not a verdict."
      : `The other ${state.unchecked} are still reports, not verdicts.`;
  return `${state.checked} of the ${plural(state.listed, "finding")} below have been replayed against the target. ${rest}`;
}

/**
 * The findings that were replayed and did not recur, which is why they are not in the list.
 *
 * Stated as what one replay did and nothing more (§7.3): a finding that did not reproduce on one
 * execution is not a repaired product, and this footnote is the exact place that reading would
 * otherwise be invited.
 */
export function whatDidNotReproduce(state: DigestCheckState): string | null {
  if (state.notReproduced === 0) return null;
  const it = state.notReproduced === 1 ? "it was" : "they were";
  return `${plural(state.notReproduced, "finding")} filed in this execution ${state.notReproduced === 1 ? "is" : "are"} not listed above: ${it} replayed and did not recur. That is what one replay found, not a promise about the next one.`;
}

/**
 * The empty case, which is a real state and a common one — and two different real states.
 *
 * Nobody filing anything is a result (§7.4), and it is reported as one, with the coverage table
 * named as the thing that says whether they actually reached your tools. Everything filed being
 * replayed away is the other one, and it is reported as what one replay found.
 */
export function nothingToList(digest: Digest, state: DigestCheckState): string {
  if (state.notReproduced > 0)
    return `Everything filed in this execution was replayed against the target and none of it recurred. That is what that one replay found; it is not a promise about the next execution.`;
  return `${people(digest.totals.agents)} made ${plural(digest.totals.wakes, "visit")} and none of them filed anything. That is a result, not a gap — the coverage table says which of your tools they actually reached.`;
}

/**
 * What the window means when the execution did not run to the end.
 *
 * The window is the execution: `startedAt` to `endedAt` or, while it is still going, to now. So
 * "I stopped it halfway" is an ordinary reading of the part that ran, and saying so is the
 * difference between a reader trusting a short digest and a reader assuming it is broken. None of
 * these promises what a longer execution would have found, because nothing can (§7.3).
 */
const WINDOW_NOTES = {
  pending: "This execution has not started, so there is nothing in the window yet.",
  running:
    "This execution is still going. The digest covers it from when it started up to now, so building it again later will cover more.",
  paused:
    "This execution is paused. Everything the people in it produced before it stopped is here — a digest of a paused execution is a whole reading of the part that ran, not a broken reading of a whole one.",
  killed:
    "This execution was stopped before it finished. Everything the people in it produced up to that point is here; stopping early makes the window shorter, not the digest partial.",
  failed:
    "This execution ended in an error. Everything the people in it produced before that is here, and the visits list says where it stopped.",
  completed: null,
} satisfies Record<RunStatus, string | null>;

export function windowNote(status: RunStatus): string | null {
  return WINDOW_NOTES[status];
}

/**
 * Why a re-check did not happen, in the reader's terms. The machine's own words go in the well
 * beneath this sentence (`WhatWentWrong`), never inside it (§7.4).
 *
 * The two statuses that are named are the two the route refuses with on purpose, and a generic
 * "something went wrong" for either is useless: 503 is a missing API key, which the reader can
 * fix in a minute, and 409 is a target this execution can no longer reach, which they fix
 * somewhere else entirely. Both refusals leave every stored finding exactly as it was, and saying
 * so is half the point — a reader who thinks a failed re-check may have half-judged their
 * findings has no reason to trust the page afterwards.
 */
export function whyRecheckFailed(status: number): string {
  if (status === 503)
    return "Nothing was re-checked. The model judge needs an API key and populace has not got one: set ANTHROPIC_API_KEY where it runs, or set verifier.judge to heuristic, then press this again. Every finding below is exactly as it was.";
  if (status === 409)
    return "Nothing was re-checked. Replaying a finding means calling the target again as the person who filed it, and this execution's target cannot be reached with what is stored now — check the study it ran. Every finding below is exactly as it was.";
  if (status === 404) return "Nothing was re-checked. This execution is not there any more.";
  return "Nothing was re-checked. Every finding below is exactly as it was.";
}

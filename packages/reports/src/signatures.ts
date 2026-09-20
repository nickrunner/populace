import type { Finding } from "@populace/core";

/**
 * Where one problem stands across the executions of one simulation (SPEC §4.3).
 *
 * - **new** — first reported in the latest execution.
 * - **open** — reported in the latest and in at least one before it.
 * - **fixed** — reported in an earlier execution, absent from the latest.
 * - **regressed** — reported, then absent, then reported again.
 *
 * Note what `new` is NOT: a problem that turns up in execution 2 having been missed in execution 1
 * is `new`, not `regressed`. Executions are independent and the people in them do different things
 * (SPEC §4), so an absence is weak evidence of a fix and a later presence is weak evidence of a
 * regression. `regressed` is reserved for the shape that is actually informative — present, gone,
 * back — and for a signature a human marked `fixed` and which has turned up anyway, which the read
 * model layers on top.
 */
export type SignatureState = "new" | "open" | "fixed" | "regressed";

/** One execution of one simulation, reduced to what the cross-execution arithmetic needs. */
export interface ExecutionFindings {
  runId: string;
  /** The execution's ordinal within its simulation. */
  seq: number;
  /**
   * Did anybody actually visit?
   *
   * An execution that made no visits at all — killed on the way up, or refused by a guardrail —
   * says nothing about whether a problem is still there. Counting it as an absence would call
   * every signature in the next execution a regression, so it is not evidence either way.
   */
  visited: boolean;
  findings: readonly Finding[];
}

export interface SignatureHistory {
  signature: string;
  state: SignatureState;
  /** The `seq` of every execution that reported it, ascending. */
  seenIn: number[];
  /** The window it has been seen in — the whole story for a longitudinal simulation, which has only ever one execution. */
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  /**
   * Reported by the most recent execution that actually sent somebody. When false, the state is
   * `fixed` — which is why the execution asked has to be one that visited.
   */
  inLatest: boolean;
  /** How many reports carry this signature, across every execution. */
  reports: number;
}

/**
 * Every signature the simulation has ever seen, and where it stands.
 *
 * Executions are keyed by signature rather than by cluster id: `cluster-3` is a position in a
 * sorted list and moves whenever anything else does, which is exactly why ADR-0028 asked for a
 * content hash. This function is the thing the hash was for.
 *
 * `groups` is how a caller says "these keys are one problem". A signature is a hash of an exact
 * token set while the clusterer merges titles that are merely similar, so a problem worded two
 * ways carries two keys — and asked one key at a time, the arithmetic would call the old wording
 * fixed and the new one new, twice over, for one thing that never moved. Given a signature ->
 * group map (the clusterer's representative is the natural key), presence is counted per GROUP and
 * the answer is returned under the group key and under every member signature alike.
 */
export function signatureHistories(executions: readonly ExecutionFindings[], groups?: ReadonlyMap<string, string>): Map<string, SignatureHistory> {
  const ordered = [...executions].sort((a, b) => a.seq - b.seq);
  // Only executions that ran are evidence of anything — and that applies to the LATEST one first
  // of all. A run that has been created but has not made a visit yet (the seconds between pressing
  // start and the first wake landing, or forever for a run that never got off the ground) reports
  // nothing, and reading that silence as an absence would call every open problem `fixed`. So the
  // question is asked of the most recent execution that visited, and the answer is drawn from the
  // visited ones before it.
  const evidence = ordered.filter((execution) => execution.visited);
  const latest = evidence.at(-1);
  const before = evidence.slice(0, -1);

  const present = new Map<string, Set<string>>();
  const stamps = new Map<string, string[]>();
  const reports = new Map<string, number>();
  const seqOf = new Map<string, number>(ordered.map((execution) => [execution.runId, execution.seq]));
  const members = new Map<string, Set<string>>();
  for (const execution of ordered) {
    for (const finding of execution.findings) {
      const key = groups?.get(finding.signature) ?? finding.signature;
      members.set(key, (members.get(key) ?? new Set<string>()).add(finding.signature));
      const runs = present.get(key) ?? new Set<string>();
      runs.add(execution.runId);
      present.set(key, runs);
      stamps.set(key, [...(stamps.get(key) ?? []), finding.createdAt]);
      reports.set(key, (reports.get(key) ?? 0) + 1);
    }
  }

  const out = new Map<string, SignatureHistory>();
  for (const [key, runs] of present) {
    const signature = key;
    const window = [...(stamps.get(signature) ?? [])].sort();
    const inLatest = latest !== undefined && runs.has(latest.runId);
    const presence = before.map((execution) => runs.has(execution.runId));
    const state: SignatureState =
      // Nothing has visited at all, so no execution can be asked. Reachable only with findings
      // that have no visit behind them; `fixed` would be the one answer that is certainly wrong.
      latest === undefined
        ? "open"
        : !inLatest
          ? "fixed"
          : !presence.some(Boolean)
            ? "new"
            : presence.at(-1) === false
              ? "regressed"
              : "open";
    const history: SignatureHistory = {
      signature,
      state,
      seenIn: [...runs].flatMap((runId) => (seqOf.has(runId) ? [seqOf.get(runId) as number] : [])).sort((a, b) => a - b),
      firstSeenAt: window[0] ?? null,
      lastSeenAt: window.at(-1) ?? null,
      inLatest,
      reports: reports.get(signature) ?? 0,
    };
    // Under the group key AND under every member signature: a caller holding either one — the
    // cluster's representative, or a single finding's key — gets the same answer.
    out.set(signature, history);
    for (const member of members.get(key) ?? []) out.set(member, history);
  }
  return out;
}

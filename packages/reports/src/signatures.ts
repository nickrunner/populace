import type { Finding } from "@populace/core";

/**
 * Where one problem stands across the report windows of one simulation (SPEC §4.3) — the
 * executions of an ephemeral study, or the report cycles of a longitudinal one (ADR-0045).
 *
 * - **new** — first reported in the latest window.
 * - **open** — reported in the latest window and in at least one before it.
 * - **fixed** — reported in an earlier window, absent from the latest.
 * - **regressed** — reported, then absent, then reported again.
 *
 * Every one of those says WINDOW and means it. They used to say "execution", which was the same
 * sentence while a window could only be one — and it is the reading that put a window ordinal
 * behind the word "execution" on a screen, for a longitudinal study that has exactly one execution
 * and a window per report cycle (ADR-0045). The arithmetic below is unchanged; only the unit it is
 * described in is.
 *
 * Note what `new` is NOT: a problem that turns up in window 2 having been missed in window 1 is
 * `new`, not `regressed`. The people in two windows do different things — different executions are
 * independent outright (SPEC §4), and two cycles of one execution are two stretches of the same
 * lives, with nothing saying anybody went looking twice — so an absence is weak evidence of a fix
 * and a later presence is weak evidence of a regression. `regressed` is reserved for the shape
 * that is actually informative — present, gone, back — and for a signature a human marked `fixed`
 * and which has turned up anyway, which the read model layers on top.
 */
export type SignatureState = "new" | "open" | "fixed" | "regressed";

/**
 * One *report window* of one simulation, reduced to what the cross-window arithmetic needs.
 *
 * Nothing in this shape is about a run except the name of the field, which is why a longitudinal
 * study — one execution that never ends — can be measured at all: the caller hands one entry per
 * report cycle instead of one per execution and the arithmetic below runs unchanged (ADR-0045).
 * `packages/server/src/report-windows.ts` builds those windows. The identity has to differ per
 * window, because `signatureHistories` counts presence into a `Set` of the `runId` it is given;
 * handing it the real run id for every cycle of one run would collapse them back into one window.
 */
export interface ExecutionFindings {
  runId: string;
  /**
   * This window's ordinal in the sequence, ascending and counted across the whole simulation.
   *
   * It is the WINDOW's number and not its execution's. `toExecutionFindings` passes
   * `ReportWindow.ordinal` here for exactly that reason: two cycles of one execution carry the
   * same `seq` if the execution's is used, and two windows that cannot be told apart are one
   * window as far as everything below is concerned. Anything that needs to name an execution to a
   * reader reads it off the window instead (`ReportWindow.seq`), because an ordinal printed under
   * the word "execution" is the falsehood this whole field exists to avoid.
   */
  seq: number;
  /**
   * Did anybody actually visit?
   *
   * A window that saw no visits at all — an execution killed on the way up, refused by a
   * guardrail, or a report cycle that fell while a long-running study happened to be idle — says
   * nothing about whether a problem is still there. Counting it as an absence would call every
   * signature in the next window a regression, so it is not evidence either way.
   */
  visited: boolean;
  findings: readonly Finding[];
}

export interface SignatureHistory {
  signature: string;
  state: SignatureState;
  /**
   * The `seq` of every report window that reported it, ascending — window ordinals, because that
   * is what the caller hands in (ADR-0045).
   *
   * This read "the `seq` of every execution" while an entry could only be an execution. It is the
   * one field most likely to be printed, and a window ordinal under the word "execution" is a
   * plain falsehood about a longitudinal study: four cycles of its single run would read as four
   * executions of a study that has never had a second one. The caller that wants executions maps
   * these back through the windows it built (`executionSeqsOf` in `project-read-model.ts`), which
   * collapses them, and `ClusterCardView` carries both scopes under their own names.
   */
  seenIn: number[];
  /**
   * The span it has been seen across. This used to be described as the whole story for a
   * longitudinal simulation "which has only ever one execution" — true of the row, and the reason
   * the state machine above was unreachable for that mode until report windows gave it more than
   * one entry to compare (ADR-0045). The timestamps are still the finer-grained answer, and the
   * only one when a caller passes a single window.
   */
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  /**
   * Reported by the most recent window that actually sent somebody. When false, the state is
   * `fixed` — which is why the window asked has to be one that visited.
   */
  inLatest: boolean;
  /** How many reports carry this signature, across every window handed in. */
  reports: number;
}

/**
 * Every signature the simulation has ever seen, and where it stands across its report windows.
 *
 * Presence is keyed by signature rather than by cluster id: `cluster-3` is a position in a
 * sorted list and moves whenever anything else does, which is exactly why ADR-0028 asked for a
 * content hash. This function is the thing the hash was for.
 *
 * The parameter is still called `executions`, and the type `ExecutionFindings`, because an
 * execution was the only window there was when they were named and renaming them would touch
 * every caller for no behaviour (ADR-0045 §1). Read both as WINDOWS throughout: what arrives here
 * is one entry per report window, and the comments below say so where it matters.
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
  // Only windows somebody visited are evidence of anything — and that applies to the LATEST one
  // first of all. A window with no visits in it (the seconds between pressing start and the first
  // wake landing, forever for a run that never got off the ground, or a report cycle that fell
  // while a long-running study happened to be idle) reports nothing, and reading that silence as
  // an absence would call every open problem `fixed`. So the question is asked of the most recent
  // window that visited, and the answer is drawn from the visited ones before it.
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
      // Nothing has visited at all, so no window can be asked. Reachable only with findings
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

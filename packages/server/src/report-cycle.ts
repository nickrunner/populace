import type { Job, PopulaceConfig, Run, Store } from "@populace/core";
import { runDigest, type DigestDeps } from "./control.js";
import type { IssuesClientFactory } from "./deps.js";
import type { JobRunner } from "./jobs.js";
import type { ProjectReadModel } from "./project-read-model.js";
import { publishIssues } from "./publish-issues.js";
import type { ReportHandle, ReportTrigger } from "./runs.js";

/**
 * The automatic report: what `RunController` calls when a report window closes, whether it was
 * closed by a cycle inside a running execution or by the execution ending.
 *
 * It is a module rather than a closure inside `serve.ts` for one reason. Nothing in the test suite
 * may reach the network or hold a token, and the only way to prove the wiring — that a cycle
 * really is a digest THEN a filing, under the kind the window boundary depends on, on job rows
 * that name the project so their spend is visible — is to be able to build one with a fake GitHub
 * client. `serve.ts` passes no client at all, which means the real one, which is what production
 * wants and what a test may never have.
 *
 * Two orderings matter and both are load-bearing:
 *
 * - **Digest before filing.** Verification lives only in the digest, so with the filing first a
 *   connection set to `onlyConfirmed` would file nothing at all, for ever, and say nothing about
 *   why. The queue is a strictly serial FIFO (ADR-0027), so enqueueing in order is the whole
 *   implementation of "in that order".
 * - **`issues.cycle`, not `issues.publish`.** A succeeded `issues.cycle` with an end time is the
 *   ONE thing that closes a report window (`report-windows.ts`), because "populace has reported on
 *   everything up to here" is a claim the automatic cycle makes and a button press does not. A
 *   cycle enqueued under the other kind reports normally and leaves the boundary unrecorded, so
 *   the next cycle reports over the same stretch of time again rather than over a wrong one.
 *
 * It EXTENDS `DigestDeps`, because the digest half of a cycle is not a digest of its own: it is
 * `runDigest`, the same function `POST /runs/:id/digest/job` runs, so the pre-flight refusal and
 * the project's daily ceiling cannot be one thing on the button and another on the clock.
 */

export interface ReportCycleDeps extends DigestDeps {
  jobs: JobRunner;
  /** The read model the publisher derives every cluster from, so it builds one study context. */
  readModel: ProjectReadModel;
  /**
   * The config a run is EXECUTING, with the live credentials put back (`liveConfigForRun`). It
   * throws when they cannot be restored, which is why every caller catches: a long-lived study
   * whose target somebody deleted should go on visiting and stop reporting, not fall over.
   */
  configForRun(runId: string): Promise<PopulaceConfig>;
  /** Whether this process can call the model at all, for the judge's pre-flight. */
  hasApiKey(): boolean;
  /** Absent means the real GitHub client, which is what `serve` leaves it as. */
  githubClient?: IssuesClientFactory;
  log?: (line: string) => void;
}

/**
 * The global stop, asked again INSIDE each half of a cycle.
 *
 * `RunController.filingArmed` already refuses to queue a cycle while the stop is engaged, and on
 * its own that is not enough. The queue is a strictly serial FIFO with no cancellation (ADR-0027),
 * so a cycle queued a moment before somebody pressed the button is still sitting in it: the digest
 * half would spend model money and replay recorded calls against somebody's product, and the
 * filing half would write issues and comments into somebody's repository, all while everything was
 * supposed to be stopped. So each half asks for itself, as late as it can — beside the ceiling
 * check in `runDigest`'s case, since the two refusals are the same kind of thing and one of them
 * is about money.
 *
 * It throws, which fails that job. That is the right answer for the filing half too: a pass that
 * was refused before it wrote anything genuinely did not happen, and a failed `issues.cycle`
 * leaves the report window open, so the stretch of time it would have covered is reported on by
 * the next cycle instead of being silently skipped.
 */
async function refuseIfStopped(store: Store, consequence: string): Promise<void> {
  const kill = await store.getKillSwitch();
  if (kill.engaged) throw new Error(`everything is stopped${kill.reason ? ` (${kill.reason})` : ""}; ${consequence}`);
}

/**
 * The callback `RunController` is given: enqueue a digest and a filing, and hand back a promise
 * that resolves once the filing has run.
 *
 * Both jobs carry `projectId` AND `runId`. The project is what makes their spend visible —
 * `costSince({ projectId })` sums `jobs.cost_usd` BY project, so a cycle on a null project is an
 * unattended loop with no dollar ceiling over it at all — and the run is what puts their progress
 * on that execution's live feed and, for the filing, into the `listJobs({ runId })` the window
 * boundaries are read out of. A `Job` names no study; the label does.
 */
export function reportIssuesWith(deps: ReportCycleDeps): (run: Run, trigger: ReportTrigger) => Promise<ReportHandle> {
  return async (run: Run, trigger: ReportTrigger): Promise<ReportHandle> => {
    const study = await deps.store.getSimulation(run.simulationId);
    if (study === undefined) throw new Error(`run ${run.id} belongs to a study that is gone, so there is nothing to report on`);
    // Read again even though the controller has already checked, because the LABEL names the
    // repository, and a label naming the wrong one is worse than a label naming none.
    const connection = await deps.store.getGithubConnection(run.projectId);
    if (connection === undefined) throw new Error("this project has no repository to file issues into");
    const where = { projectId: run.projectId, runId: run.id };

    /*
     * The digest first. Its label carries a caveat when the accounts are on their way out, because
     * a person reading the live feed is the only reader this path has, and `replayFinding` refuses
     * outright once an identity is torn down — so a reader has to be told which side of that this
     * pass ran on. Which caveat is true depends on who is doing the removing, and the branch below
     * says why. Neither version says anything about whether a problem is still there, which an
     * absence never establishes.
     */
    await deps.jobs.enqueue(
      "digest",
      async (_job, report, spend) => {
        await refuseIfStopped(deps.store, "re-checking findings costs money and replays recorded calls against the target, so nothing was checked");
        await runDigest(deps, run.id, report, spend);
        // The caveat goes LAST, because `runDigest` writes its own labels over the one this job
        // was queued under and the live feed shows whichever came last.
        //
        // Two different true sentences, and which one applies depends on who is removing the
        // accounts. When this report took the teardown on (`trigger.sweep`), it is queued BEHIND
        // this job, so this pass did its checking with the accounts still alive and the thing that
        // will not be possible is checking again. When it did not, the accounts are going
        // alongside this job and nothing here could be relied on to have been checked at all.
        // Neither says anything about whether a problem is still there, which an absence never
        // establishes.
        if (trigger.sweep !== undefined) await report({ label: "checked what was found; the accounts are removed next, so none of it can be checked against the target after that" });
        else if (trigger.sweeping) await report({ label: "checked what was found; the accounts are being removed now, so none of it can be checked against the target again" });
        return undefined;
      },
      { ...where, label: trigger.sweeping ? "checking what was found before the accounts go" : "checking what has been found so far" },
    );

    let finish: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });

    await deps.jobs.enqueue(
      "issues.cycle",
      async (_job, report) => {
        try {
          await refuseIfStopped(deps.store, "nothing was filed");
          await report({ label: "reading what this study found", done: 0, total: null });
          /*
           * Progress writes, serialised. `onProgress` is synchronous and `report` is not, so
           * firing each as a loose promise lets two writes of one job row race and the count go
           * backwards on the live screen.
           */
          let writes: Promise<void> = Promise.resolve();
          const summary = await publishIssues(
            { simulation: study },
            {
              store: deps.store,
              readModel: deps.readModel,
              ...(deps.githubClient ? { client: deps.githubClient } : {}),
              onProgress: (done: number, total: number) => {
                writes = writes.then(() => report({ done, total, label: `${String(done)} of ${String(total)} looked at` }));
              },
            },
          );
          await writes;
          const counts = [
            summary.filed > 0 ? `${String(summary.filed)} filed` : "",
            summary.commented > 0 ? `${String(summary.commented)} commented on` : "",
            summary.skipped > 0 ? `${String(summary.skipped)} passed over` : "",
            summary.failed > 0 ? `${String(summary.failed)} not filed` : "",
          ].filter((part) => part !== "");
          /*
           * The pass RAN, so this job SUCCEEDS — and this is the one decision in the file the
           * state machine hangs off.
           *
           * A succeeded `issues.cycle` with an end time is the only thing that closes a report
           * window (`report-windows.ts`). Failing the job because one problem out of thirty could
           * not be filed therefore leaves the window open for the rest of the study's life: every
           * later cycle reports over the same stretch of time again, comments again on every issue
           * in it, and nothing on the dashboard can clear it. A developer deleting an issue
           * populace filed is enough to reach that, and it is unrecoverable rather than transient
           * — the ledger row still names the issue that is gone, so the next pass fails on it too,
           * and the one after that.
           *
           * So "some problems could not be filed" and "this cycle did not happen" are kept apart.
           * The per-problem failures are counted and the first one's reason is NAMED, in the
           * progress label, which is the field `JobProgress` renders and the live feed carries;
           * the row's `error` column belongs to the queue rather than to a handler — `JobRunner`
           * writes it only when the handler throws — so the label is where a visible reason can
           * actually be put. Nothing is lost by not throwing: a ledger row is written per issue
           * inside the pass, so everything counted here is already persisted, and the problems
           * that failed carry no ledger row and are candidates again next time.
           *
           * What still fails the job is a failure that means the pass genuinely did not happen,
           * and all of those throw out of `publishIssues` before any outbound write: no
           * repository, no token, or the global stop above.
           */
          const first = summary.results.find((entry) => entry.outcome === "failed");
          const headline = counts.length > 0 ? `${counts.join(", ")} in ${summary.repo}` : `nothing to file in ${summary.repo}`;
          const progress: Partial<Job["progress"]> = {
            done: summary.results.length,
            total: summary.results.length,
            label: first === undefined ? headline : `${headline}. The first that did not go: ${first.error ?? "no reason given"}`,
          };
          await report(progress);
          return undefined;
        } finally {
          /*
           * Resolved whatever happened, and a `finally` rather than a line at the end for a
           * reason: `RunController` holds this promise as its skip-never-stack flag, so a filing
           * that threw and left it pending would leave a longitudinal study believing a cycle was
           * still in flight and never report again for the rest of its life.
           */
          finish();
        }
      },
      { ...where, label: `filing what ${study.name} found in ${connection.repo}` },
    );

    /*
     * The teardown, ON THE SAME QUEUE, which is the whole reason it is here rather than in
     * `RunController`.
     *
     * The ordering this restores is "check the findings while the accounts that filed them still
     * exist". It used to be written as "enqueue the report, then sweep", and those are not the
     * same thing: the report only QUEUES a digest, so the sweep on the next line ran while the
     * digest was still draining. `replayFinding` refuses outright once an identity is torn down,
     * so whether a verdict was a reading of the product or the sentence "the account that filed
     * this was removed" came down to which of two concurrent passes got there first — the exact
     * hazard the ordering existed to remove, with no way to tell from the outside that it had
     * happened. Enqueued third on a strictly serial FIFO (ADR-0027), it cannot.
     *
     * The cost of the move, stated because it is real: a process that exits between the report and
     * this job leaves the accounts on the target, where before they went inside `drive()`, which
     * `shutdown()` waits for. `jobs.reconcileOrphans()` fails the row on the next start and the
     * run's `sweptAt` stays null, so the execution is still discoverable as unswept and
     * `populace sweep` still removes them. Findings with no accounts behind them are the worse of
     * the two, because nothing about them says so.
     */
    const sweep = trigger.sweep;
    if (sweep !== undefined) {
      await deps.jobs.enqueue(
        "sweep",
        async (_job, report) => {
          // No kill-switch refusal here, deliberately. Removing the accounts an execution made is
          // cleaning up after populace's own visits on somebody else's product — it spends
          // nothing and writes nothing anybody reads — and refusing it because everything is
          // stopped would leave the accounts behind for exactly the reason somebody pressed stop.
          await report({ label: "removing the accounts this execution made" });
          await sweep();
          return undefined;
        },
        { ...where, label: "removing the accounts this execution made" },
      );
    }

    deps.log?.(`[run ${run.id}] ${trigger.because === "final" ? "the last report of this execution" : `a report cycle (${trigger.because})`}: a digest, then filing into ${connection.repo}${sweep === undefined ? "" : ", then the accounts"}`);
    return { finished, sweeps: sweep !== undefined };
  };
}

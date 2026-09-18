import { newJobId, type Job, type JobKind, type Store } from "@populace/core";

/**
 * One in-process queue, drained one job at a time (ADR-0027). Long operations are rows rather than
 * in-flight promises because they are slow, most of them cost money, and the browser has to be
 * able to reload in the middle of one and still see where it got to.
 *
 * Serial by design at this size: the operations are a digest, a target check, a sweep and starting
 * a run, and two of those touching the same store at once buys nothing. In M5 the same table is
 * the queue hosted workers pull from and the concurrency question moves there.
 */
/** A handler may name the run it produced, so the job row can point at it afterwards. */
export interface JobOutcome {
  runId?: string;
}
export type JobHandler = (job: Job, report: (progress: Partial<Job["progress"]>) => Promise<void>) => Promise<JobOutcome | undefined>;

export class JobRunner {
  private readonly queue: { job: Job; handler: JobHandler }[] = [];
  private draining = false;

  constructor(
    private readonly store: Store,
    private readonly log: (line: string) => void = () => undefined,
  ) {}

  /** Enqueues and returns immediately: the caller answers with the job id, not with the outcome. */
  async enqueue(kind: JobKind, handler: JobHandler, options: { runId?: string; projectId?: string; label?: string } = {}): Promise<Job> {
    const job: Job = {
      id: newJobId(),
      kind,
      status: "queued",
      projectId: options.projectId ?? null,
      runId: options.runId ?? null,
      costUsd: 0,
      progress: { done: 0, total: null, label: options.label ?? "" },
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      endedAt: null,
    };
    await this.save(job);
    this.queue.push({ job, handler });
    void this.drain();
    return job;
  }

  private async save(job: Job): Promise<void> {
    await this.store.saveJob(job);
    // Progress reaches the browser over the event stream rather than by polling `GET /jobs/:id`,
    // which is what lets one SSE subscription carry the whole run screen.
    //
    // The project is passed explicitly because the recording store can only derive one FROM A RUN,
    // and an authoring job (`people.generate`, `target.reset`) has no run at all — nor does
    // `run.start` until the row it is creating exists. Without this a project's stream carries no
    // job progress for the project's own jobs.
    await this.store.appendEvent({
      runId: job.runId,
      wakeId: null,
      ...(job.projectId === null ? {} : { projectId: job.projectId }),
      type: "job.updated",
      payload: { jobId: job.id, kind: job.kind, status: job.status, progress: job.progress, error: job.error },
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (let next = this.queue.shift(); next !== undefined; next = this.queue.shift()) {
        let job: Job = { ...next.job, status: "running", startedAt: new Date().toISOString() };
        await this.save(job);
        // A settled job never changes again. `run.start` outlives its own handler — the handler
        // returns once the run row exists and the daemon keeps ticking behind it — so its progress
        // callback goes on firing for every visit long after the job succeeded. Writing those
        // would leave a finished job with a moving progress count, and put a "run.start:
        // succeeded" line on the live feed once per visit. Progress after the fact belongs to the
        // run, which has its own events.
        let settled = false;
        const report = async (progress: Partial<Job["progress"]>): Promise<void> => {
          if (settled) return;
          job = { ...job, progress: { ...job.progress, ...progress } };
          await this.save(job);
        };
        try {
          const result = await next.handler(job, report);
          job = { ...job, status: "succeeded", endedAt: new Date().toISOString(), ...(result?.runId ? { runId: result.runId } : {}) };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.log(`job ${job.id} (${job.kind}) failed: ${message}`);
          job = { ...job, status: "failed", error: message, endedAt: new Date().toISOString() };
        }
        settled = true;
        await this.save(job);
      }
    } finally {
      this.draining = false;
    }
  }

  /** Waits for the queue to settle. Tests use it; nothing in a request path may. */
  async idle(): Promise<void> {
    while (this.draining || this.queue.length > 0) await new Promise((resolve) => setTimeout(resolve, 5));
  }

  /**
   * A job left `running` by a process that died can never finish, so an open fails it rather than
   * leaving a spinner the browser will wait on forever.
   */
  async reconcileOrphans(): Promise<number> {
    const stale = [...(await this.store.listJobs({ status: "running" })), ...(await this.store.listJobs({ status: "queued" }))];
    for (const job of stale) await this.save({ ...job, status: "failed", error: "populace serve stopped while this was running", endedAt: new Date().toISOString() });
    return stale.length;
  }
}

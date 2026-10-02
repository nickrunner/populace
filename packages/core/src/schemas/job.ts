import { z } from "zod";

/**
 * Long-running operations are rows, not in-flight promises (ADR-0027): starting a run, building a
 * digest, checking a target and sweeping all take time and most of them cost money, so the browser
 * has to be able to show progress and survive a reload. In M5 this same table is the queue hosted
 * workers pull from.
 */
/**
 * `issues.publish` and `issues.cycle` run the same pass and are deliberately two kinds.
 *
 * `issues.publish` is what a person's press enqueues — one problem, or "File all" over the results
 * screen. `issues.cycle` is the automatic report cycle, and its successful end is the one thing
 * that CLOSES a report window (`packages/server/src/report-windows.ts`): "populace has reported on
 * everything up to here" is a claim the cycle makes and a button press does not. Under one shared
 * kind a manual press moved that boundary, and the next publish told every issue in somebody's
 * repository that its problem had gone quiet.
 */
export const JobKindSchema = z.enum([
  "run.start",
  "run.continue",
  "run.round",
  "run.resume",
  "digest",
  "target.check",
  "sweep",
  "people.generate",
  "target.reset",
  "issues.publish",
  "issues.cycle",
]);
export type JobKind = z.infer<typeof JobKindSchema>;

export const JobStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobProgressSchema = z.object({
  done: z.number().int().nonnegative().default(0),
  /** Null when the total is not knowable in advance, which is the normal case for a run. */
  total: z.number().int().nonnegative().nullable().default(null),
  label: z.string().default(""),
});
export type JobProgress = z.infer<typeof JobProgressSchema>;

export const JobSchema = z.object({
  id: z.string().min(1),
  kind: JobKindSchema,
  status: JobStatusSchema,
  projectId: z.string().nullable().default(null),
  runId: z.string().nullable().default(null),
  /**
   * Model spend this job made OUTSIDE a wake (`people.generate` is the first of those). It counts
   * against the project's daily ceiling through the same path a wake's cost does.
   */
  costUsd: z.number().nonnegative().default(0),
  progress: JobProgressSchema.prefault({}),
  error: z.string().nullable().default(null),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable().default(null),
  endedAt: z.iso.datetime().nullable().default(null),
});
export type Job = z.infer<typeof JobSchema>;

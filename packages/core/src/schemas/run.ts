import { z } from "zod";
import { PopulaceConfigSchema } from "./config.js";
import { SimulationModeSchema } from "./simulation.js";

/**
 * `pending` is a run whose row exists but whose daemon has not ticked yet. `paused` stops being
 * terminal: it now means resumable, which is what pause/resume on a longitudinal simulation
 * requires. `failed` is reserved for a run that actually threw.
 */
export const RunStatusSchema = z.enum(["pending", "running", "paused", "completed", "killed", "failed"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const PauseReasonSchema = z.enum(["user", "process-ended", "kill-switch"]);
export type PauseReason = z.infer<typeof PauseReasonSchema>;

export const RunTotalsSchema = z.object({
  agents: z.number().int().nonnegative().default(0),
  activeAgents: z.number().int().nonnegative().default(0),
  wakes: z.number().int().nonnegative().default(0),
  findings: z.number().int().nonnegative().default(0),
  confirmed: z.number().int().nonnegative().default(0),
  costUsd: z.number().nonnegative().default(0),
});
export type RunTotals = z.infer<typeof RunTotalsSchema>;

export const ContinuationSchema = z.object({
  reason: z.string().default(""),
  carriedAgents: z.number().int().nonnegative().default(0),
  returningAfterGiveUp: z.number().int().nonnegative().default(0),
});
export type Continuation = z.infer<typeof ContinuationSchema>;

export const RunSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  /** Every run belongs to a simulation. */
  simulationId: z.string().min(1),
  /** 1-based execution number WITHIN the simulation. "Execution 3" is how the user names it. */
  seq: z.number().int().positive(),
  /** Copied from the simulation at start, so a later mode change cannot rewrite history. */
  mode: SimulationModeSchema,
  /** The authored target this run was started against. */
  targetId: z.string().default(""),
  populationId: z.string().min(1),
  /** Human name. Defaults to the target and a timestamp; the user may rename it. */
  label: z.string().default(""),
  status: RunStatusSchema,
  /** The frozen `PopulaceConfig` this run is executing (ADR-0024). Empty only for derived rows. */
  configSnapshotId: z.string().default(""),
  /** ADR-0020 lineage: the "I shipped a fix, do they come back?" child run. Unrelated to `seq`. */
  parentRunId: z.string().nullable().default(null),
  continuation: ContinuationSchema.nullable().default(null),
  pauseReason: PauseReasonSchema.nullable().default(null),
  resumes: z.number().int().nonnegative().default(0),
  lastResumedAt: z.iso.datetime().nullable().default(null),
  /** When the accounts this run made were swept. Null means they are still on the target. */
  sweptAt: z.iso.datetime().nullable().default(null),
  startedAt: z.iso.datetime().nullable().default(null),
  endedAt: z.iso.datetime().nullable().default(null),
  /**
   * Cached counters. They are a cache, not the truth: the read model still recomputes them from
   * `wakes` and `findings` so a run whose daemon died does not report stale totals forever.
   */
  totals: RunTotalsSchema.prefault({}),
});
export type Run = z.infer<typeof RunSchema>;

/**
 * One resolved `PopulaceConfig`, captured when a run starts and never edited (`DATA-MODEL.md` §4).
 * Editing a persona in the browser must not retroactively change what a past run was, and this is
 * the thing that stops it.
 */
export const ConfigSnapshotSchema = z.object({
  id: z.string().min(1),
  createdAt: z.iso.datetime(),
  /** Content hash over the redacted config, so two identical snapshots are one row. */
  hash: z.string().min(1),
  config: PopulaceConfigSchema,
  /**
   * Names of the secrets that were redacted out of `config`. The snapshot records *that* a
   * credential was used, never its value: a local database gets copied around and attached to
   * bug reports.
   */
  redacted: z.array(z.string()).default([]),
});
export type ConfigSnapshot = z.infer<typeof ConfigSnapshotSchema>;

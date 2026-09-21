import {
  DigestSchema,
  FindingKindSchema,
  FindingSchema,
  JsonValueSchema,
  MemorySchema,
  SeveritySchema,
  ToolCallRecordSchema,
  TraceEventSchema,
  VerdictSchema,
  VerificationSchema,
  WakeSchema,
  WakeStatusSchema,
} from "@populace/core/isomorphic";
import type {
  Digest,
  Finding,
  JsonValue,
  Memory,
  ToolCallRecord,
  TraceEvent,
  Verdict,
  Verification,
} from "@populace/core/isomorphic";
import { z } from "zod";

/**
 * Read models the dashboard renders. These are views, not storage: M1 derives every one of them
 * from the rows the store already holds, and M2 puts real tables underneath the same shapes
 * without the screens changing (ADR-0024).
 */

export const RunStatusSchema = z.enum(["pending", "running", "paused", "completed", "killed", "failed"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunTotalsSchema = z.object({
  agents: z.number().int().nonnegative(),
  activeAgents: z.number().int().nonnegative(),
  wakes: z.number().int().nonnegative(),
  findings: z.number().int().nonnegative(),
  confirmed: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export type RunTotals = z.infer<typeof RunTotalsSchema>;

export const RunSummarySchema = z.object({
  id: z.string(),
  label: z.string(),
  /**
   * Which simulation this is an execution of, and which project owns it (SPEC §6.1: "a run id is
   * globally unique and the row carries its project and its simulation"). The browser needs them
   * to turn a bookmarked `/runs/:id` into the simulation page that replaced it, without walking
   * every project. Empty on a derived row that predates runs having a row of their own.
   */
  projectId: z.string(),
  simulationId: z.string(),
  populationId: z.string(),
  /**
   * Derived in M1 and therefore coarse: `running` while any agent is still active, `completed`
   * otherwise. A run whose daemon was killed is indistinguishable from one that finished until
   * M2 gives runs a row of their own (ADR-0024).
   */
  status: RunStatusSchema,
  startedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  parentRunId: z.string().nullable(),
  totals: RunTotalsSchema,
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const RunDetailSchema = RunSummarySchema.extend({
  childRunIds: z.array(z.string()),
  /** Agents carried in from the parent run, and how many of those had given up. */
  carriedAgents: z.number().int().nonnegative(),
  returningAfterGiveUp: z.number().int().nonnegative(),
  findingsByKind: z.record(FindingKindSchema, z.number().int().nonnegative()),
  findingsBySeverity: z.record(SeveritySchema, z.number().int().nonnegative()),
  /** How the run's visits ended. `done` is the overview's "errands finished". */
  wakesByStatus: z.record(WakeStatusSchema, z.number().int().nonnegative()),
  /** Verification progress, which the overview reads as "4 of 6 checked". */
  verified: z.object({ checked: z.number().int().nonnegative(), confirmed: z.number().int().nonnegative(), notReproduced: z.number().int().nonnegative(), inconclusive: z.number().int().nonnegative() }),
});
export type RunDetail = z.infer<typeof RunDetailSchema>;

/**
 * `AgentSummarySchema` used to live here. It is gone: the wire speaks the user's words now, so
 * `ParticipantSummaryView` and `ParticipantDetailView` in `project.ts` are what a client reads
 * (Decision A). The `Agent` row, the `agents` table and every store method keep their names —
 * this was a translation at the boundary, not a rename underneath it.
 */
export { MemorySchema };
export type { Memory };

/**
 * What a target tool was actually used for during a run. A tool with no calls is the point of
 * this view: the coverage-gaps screen reads it as "tools you expose that nobody reached for".
 */
export const ToolUsageSchema = z.object({
  name: z.string(),
  calls: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  agents: z.array(z.string()),
  firstUsedAt: z.iso.datetime().nullable(),
  lastUsedAt: z.iso.datetime().nullable(),
  /** False when the tool is called in the trace but the target no longer lists it. */
  exposed: z.boolean(),
  destructive: z.boolean(),
});
export type ToolUsage = z.infer<typeof ToolUsageSchema>;

export const ToolUsageViewSchema = z.object({
  items: z.array(ToolUsageSchema),
  exposedCount: z.number().int().nonnegative(),
  neverCalledCount: z.number().int().nonnegative(),
  /** Null when the target could not be reached, in which case only called tools are listed. */
  toolsError: z.string().nullable(),
});
export type ToolUsageView = z.infer<typeof ToolUsageViewSchema>;

/** A wake row plus the persona name, so a list does not need a second request to be readable. */
export const WakeSummarySchema = WakeSchema.extend({ personaName: z.string() });
export type WakeSummary = z.infer<typeof WakeSummarySchema>;

export const WakeDetailSchema = WakeSummarySchema.extend({
  findingIds: z.array(z.string()),
  /** Memory as it stood after this wake, which is what makes a returning agent legible. */
  memoryUpdatedAt: z.iso.datetime().nullable(),
});
export type WakeDetail = z.infer<typeof WakeDetailSchema>;

/**
 * ---- the records the browser reads verbatim ------------------------------------------------
 *
 * A trace event, a tool-call record, a finding, a verification and a digest are **stored rows the
 * dashboard reads unchanged**. They are re-exported here rather than restated as a parallel
 * `…View`, and that is a deliberate reading of ADR-0032 rather than an exception to it.
 *
 * ADR-0032 says the wire speaks the *user's words*: `Agent` becomes `ParticipantSummaryView`
 * because the product calls that thing a person and the row calls it an agent, and the two
 * vocabularies have to meet somewhere. **These records have no second vocabulary.** A tool call is
 * a tool call on both sides of the boundary; `ToolCallRecord.ref` is the `[c3]` a person typed
 * into `evidence_calls` and the `[c3]` a reader clicks (ADR-0015). Inventing `ToolCallView` with
 * the same eight fields would add a shape to maintain, a second place for a field to be forgotten,
 * and no translation whatsoever.
 *
 * What ADR-0032 *does* require is that there is **one import site**. `@populace/contract` is it:
 * nothing in `packages/web` reaches into `@populace/core/isomorphic` for a record shape, so the
 * day one of these genuinely needs translating, this file is where the translation goes and no
 * screen changes its import to find out.
 *
 * These already cross the wire under exactly these names: `ClusterDetailView.reproduction` is
 * `ToolCallRecord[]` and `ClusterDetailView.replay` is `Verification` (`project.ts`), and
 * `GET /wakes/:id/trace` pages `TraceEvent`.
 */
export {
  TraceEventSchema,
  ToolCallRecordSchema,
  FindingSchema,
  VerificationSchema,
  DigestSchema,
  VerdictSchema,
  JsonValueSchema,
};
export type { TraceEvent, ToolCallRecord, Finding, Verification, Digest, Verdict, JsonValue };

export const SpendBucketSchema = z.object({
  key: z.string(),
  label: z.string(),
  wakes: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadInputTokens: z.number().int().nonnegative(),
});
export type SpendBucket = z.infer<typeof SpendBucketSchema>;

export const SpendViewSchema = z.object({
  totalUsd: z.number().nonnegative(),
  /** The guardrail the sidebar shows this run's spend against (ADR-0009). */
  dailyCeilingUsd: z.number().nonnegative(),
  spentTodayUsd: z.number().nonnegative(),
  byAgent: z.array(SpendBucketSchema),
  byPersona: z.array(SpendBucketSchema),
  /** By COHORT, which is what a bill is read by: two cohorts may share one persona. */
  byCohort: z.array(SpendBucketSchema),
  byDay: z.array(SpendBucketSchema),
});
export type SpendView = z.infer<typeof SpendViewSchema>;

export const TargetToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  endpoint: z.string(),
  destructive: z.boolean(),
});
export type TargetTool = z.infer<typeof TargetToolSchema>;

/**
 * The configured target as the dashboard may see it. Bearer tokens and headers are never
 * included: a snapshot or a view of config carries the fact that a secret was used, not the
 * secret (`DATA-MODEL.md` §4).
 */
export const TargetViewSchema = z.object({
  name: z.string(),
  endpoints: z.array(z.object({ name: z.string(), url: z.string(), authenticated: z.boolean() })),
  webBaseUrl: z.string().nullable(),
  description: z.string().nullable(),
  identityStrategy: z.string(),
  /** Absent when the server was started without connecting, or when the target is unreachable. */
  tools: z.array(TargetToolSchema).nullable(),
  toolsError: z.string().nullable(),
});
export type TargetView = z.infer<typeof TargetViewSchema>;

export const HealthViewSchema = z.object({
  version: z.string(),
  storePath: z.string(),
  readOnly: z.boolean(),
  killSwitch: z.object({ engaged: z.boolean(), reason: z.string().nullable(), at: z.string().nullable() }),
});
export type HealthView = z.infer<typeof HealthViewSchema>;

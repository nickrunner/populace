import {
  AgentStatusSchema,
  ContinuedFromSchema,
  DigestSchema,
  FindingKindSchema,
  FindingSchema,
  MemorySchema,
  RetiredReasonSchema,
  SeveritySchema,
  TraceEventSchema,
  VerdictSchema,
  WakeSchema,
  WakeStatusSchema,
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

export const AgentSummarySchema = z.object({
  id: z.string(),
  runId: z.string(),
  personaId: z.string(),
  personaName: z.string(),
  role: z.string(),
  status: AgentStatusSchema,
  retiredReason: RetiredReasonSchema.nullable(),
  continuedFrom: ContinuedFromSchema.nullable(),
  identityId: z.string().nullable(),
  wakeCount: z.number().int().nonnegative(),
  maxWakes: z.number().int().positive().nullable(),
  nextWakeAt: z.iso.datetime().nullable(),
  lastWakeAt: z.iso.datetime().nullable(),
  findingCount: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  /** What the agent said on its last `done` or `give_up` about coming back. */
  wouldReturn: z.boolean().nullable(),
  backstory: z.string(),
  patience: z.number().int(),
  budgetUsd: z.number().nonnegative(),
  model: z.string(),
  effort: z.string(),
  /**
   * The account this agent holds on the target, by its readable handle only. The bearer token
   * the credential also carries is never on the wire (`DATA-MODEL.md` §4).
   */
  account: z.object({ email: z.string().nullable(), userId: z.string().nullable() }).nullable(),
});
export type AgentSummary = z.infer<typeof AgentSummarySchema>;

export { MemorySchema };

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

export { TraceEventSchema, FindingSchema, DigestSchema, VerdictSchema };

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

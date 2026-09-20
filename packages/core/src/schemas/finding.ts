import { z } from "zod";
import { ToolCallRecordSchema } from "./trace.js";

export const FindingKindSchema = z.enum(["bug", "friction", "coverage-gap", "suggestion", "abandonment", "praise"]);
export type FindingKind = z.infer<typeof FindingKindSchema>;

export const SeveritySchema = z.enum(["critical", "high", "medium", "low"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export const VerdictSchema = z.enum(["confirmed", "not-reproduced", "inconclusive"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const VerificationSchema = z.object({
  verdict: VerdictSchema,
  reason: z.string(),
  /** Which judge produced the verdict. */
  judge: z.enum(["model", "heuristic"]),
  /** The replayed steps with fresh results, aligned by index with the finding's reproduction steps. */
  replay: z.array(ToolCallRecordSchema),
  verifiedAt: z.iso.datetime(),
  costUsd: z.number().nonnegative().default(0),
});
export type Verification = z.infer<typeof VerificationSchema>;

export const FindingSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  tag: z.string().min(1),
  wakeId: z.string().min(1),
  agentId: z.string().min(1),
  personaId: z.string().min(1),
  kind: FindingKindSchema,
  /**
   * `sig1:<12 hex>` over (kind, primary tool, sorted title tokens) — ADR-0028's key. Stable across
   * executions, so "this problem, everywhere it has been seen" is one lookup rather than a
   * re-clustering. The `sig1:` prefix is a version: a clustering change bumps it, which detaches
   * triage loudly instead of silently.
   */
  signature: z.string().min(1),
  title: z.string().min(1),
  /** What happened, in the persona's words. */
  description: z.string(),
  expected: z.string(),
  observed: z.string(),
  severity: SeveritySchema,
  /** 0..1 */
  confidence: z.number().min(0).max(1),
  /** For coverage gaps: the tool the persona wished existed. For bugs: the tool at fault. */
  tool: z.string().optional(),
  /** The exact tool calls that led to the finding, in order. */
  reproduction: z.array(ToolCallRecordSchema),
  /** Endpoint the reproduction ran against. */
  endpoint: z.string(),
  identityId: z.string().nullable().default(null),
  verification: VerificationSchema.nullable().default(null),
  createdAt: z.iso.datetime(),
});
export type Finding = z.infer<typeof FindingSchema>;

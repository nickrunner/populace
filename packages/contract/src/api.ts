import { FindingKindSchema, SeveritySchema } from "@populace/core/isomorphic";
import { z } from "zod";
import { VerdictSchema } from "./views.js";

/** Everything under one version prefix, so M4's CI client and an M5 SDK have a stable base. */
export const API_BASE = "/api/v1";

/**
 * A page of results. `nextCursor` is opaque to the client and is the same cursor the event
 * stream uses, so "load the rest" and "follow it live" are one query at different offsets
 * (ADR-0023, ADR-0026).
 */
export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

export const ErrorBodySchema = z.object({
  error: z.object({
    code: z.enum(["not_found", "bad_request", "conflict", "unavailable", "internal"]),
    message: z.string(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

const cursor = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

export const RunListQuerySchema = cursor;
export type RunListQuery = z.infer<typeof RunListQuerySchema>;

export const WakeListQuerySchema = cursor.extend({ agentId: z.string().optional() });
export type WakeListQuery = z.infer<typeof WakeListQuerySchema>;

export const TraceQuerySchema = cursor.extend({
  /** Trace sequence to resume after; the trace is ordered by `(wakeId, seq)`. */
  afterSeq: z.coerce.number().int().nonnegative().optional(),
});
export type TraceQuery = z.infer<typeof TraceQuerySchema>;

/**
 * Repeated query parameters arrive as a string or an array of strings depending on how many
 * were sent, which is a boundary worth normalising once rather than at every call site.
 */
const multi = <T extends z.ZodType>(item: T) =>
  z
    .union([item, z.array(item)])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]));

export const FindingListQuerySchema = cursor.extend({
  kind: multi(FindingKindSchema),
  severity: multi(SeveritySchema),
  verdict: multi(VerdictSchema),
  /** `true` keeps only findings no judge has ruled on yet. */
  unverified: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  agentId: z.string().optional(),
  tool: z.string().optional(),
});
export type FindingListQuery = z.infer<typeof FindingListQuerySchema>;

export const DigestQuerySchema = z.object({
  /** Verify findings that have no verdict yet before building. Off by default: it costs money. */
  verify: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});
export type DigestQuery = z.infer<typeof DigestQuerySchema>;

/**
 * The route table lives here rather than in the server so that a client, a CI consumer and the
 * server all name the same paths. M1 is read-only; the control and authoring routes arrive with
 * M2 and M3 (`WEB-ARCHITECTURE.md` §5).
 */
export const routes = {
  health: `${API_BASE}/health`,
  target: `${API_BASE}/target`,
  runs: `${API_BASE}/runs`,
  run: (id: string) => `${API_BASE}/runs/${encodeURIComponent(id)}`,
  runAgents: (id: string) => `${API_BASE}/runs/${encodeURIComponent(id)}/agents`,
  runWakes: (id: string) => `${API_BASE}/runs/${encodeURIComponent(id)}/wakes`,
  runFindings: (id: string) => `${API_BASE}/runs/${encodeURIComponent(id)}/findings`,
  runDigest: (id: string) => `${API_BASE}/runs/${encodeURIComponent(id)}/digest`,
  runSpend: (id: string) => `${API_BASE}/runs/${encodeURIComponent(id)}/spend`,
  runTools: (id: string) => `${API_BASE}/runs/${encodeURIComponent(id)}/tools`,
  agentMemory: (runId: string, agentId: string) => `${API_BASE}/runs/${encodeURIComponent(runId)}/agents/${encodeURIComponent(agentId)}/memory`,
  wake: (id: string) => `${API_BASE}/wakes/${encodeURIComponent(id)}`,
  wakeTrace: (id: string) => `${API_BASE}/wakes/${encodeURIComponent(id)}/trace`,
  finding: (id: string) => `${API_BASE}/findings/${encodeURIComponent(id)}`,
} as const;

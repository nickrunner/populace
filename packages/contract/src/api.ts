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

/** `after` is the event-log cursor; a reconnect resumes from it instead of losing the gap. */
export const EventStreamQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().optional(),
  run: z.string().optional(),
});
export type EventStreamQuery = z.infer<typeof EventStreamQuerySchema>;

export const DigestQuerySchema = z.object({
  /** Verify findings that have no verdict yet before building. Off by default: it costs money. */
  verify: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});
export type DigestQuery = z.infer<typeof DigestQuerySchema>;

/**
 * Path segments are encoded, except a `:name` pattern, which is passed through untouched. That is
 * what lets one route table serve both sides: the client calls `routes.run(id)` with a real id and
 * the server registers `routes.run(":id")` as a pattern, so a path can never be spelled two ways.
 */
const seg = (value: string): string => (value.startsWith(":") ? value : encodeURIComponent(value));

/**
 * The route table lives here rather than in the server so that a client, a CI consumer and the
 * server all name the same paths. M1 is read-only; the control and authoring routes arrive with
 * M2 and M3 (`WEB-ARCHITECTURE.md` §5).
 */
export const routes = {
  health: `${API_BASE}/health`,
  target: `${API_BASE}/target`,
  runs: `${API_BASE}/runs`,
  run: (id: string) => `${API_BASE}/runs/${seg(id)}`,
  runAgents: (id: string) => `${API_BASE}/runs/${seg(id)}/agents`,
  runWakes: (id: string) => `${API_BASE}/runs/${seg(id)}/wakes`,
  runFindings: (id: string) => `${API_BASE}/runs/${seg(id)}/findings`,
  runDigest: (id: string) => `${API_BASE}/runs/${seg(id)}/digest`,
  runSpend: (id: string) => `${API_BASE}/runs/${seg(id)}/spend`,
  runTools: (id: string) => `${API_BASE}/runs/${seg(id)}/tools`,
  agentMemory: (runId: string, agentId: string) => `${API_BASE}/runs/${seg(runId)}/agents/${seg(agentId)}/memory`,
  wake: (id: string) => `${API_BASE}/wakes/${seg(id)}`,
  wakeTrace: (id: string) => `${API_BASE}/wakes/${seg(id)}/trace`,
  finding: (id: string) => `${API_BASE}/findings/${seg(id)}`,

  // ---- M2: authoring (ADR-0025) -------------------------------------------
  setup: `${API_BASE}/setup`,
  targets: `${API_BASE}/targets`,
  target_: (id: string) => `${API_BASE}/targets/${seg(id)}`,
  targetCheck: (id: string) => `${API_BASE}/targets/${seg(id)}/check`,
  targetPromises: (id: string) => `${API_BASE}/targets/${seg(id)}/promises`,
  personas: `${API_BASE}/personas`,
  persona: (id: string) => `${API_BASE}/personas/${seg(id)}`,
  personaStarters: `${API_BASE}/personas/starters`,
  personaPreview: (id: string) => `${API_BASE}/personas/${seg(id)}/preview`,
  personaDuplicate: (id: string) => `${API_BASE}/personas/${seg(id)}/duplicate`,
  population: `${API_BASE}/population`,
  settings: `${API_BASE}/settings`,
  configExport: `${API_BASE}/config/export`,
  configImport: `${API_BASE}/config/import`,
  configHistory: `${API_BASE}/config/history`,
  configRevision: (id: string) => `${API_BASE}/config/history/${seg(id)}`,
  configRestore: (id: string) => `${API_BASE}/config/history/${seg(id)}/restore`,

  // ---- M2: control (ADR-0027) ---------------------------------------------
  runsEstimate: `${API_BASE}/runs/estimate`,
  runStop: (id: string) => `${API_BASE}/runs/${seg(id)}/stop`,
  runRound: (id: string) => `${API_BASE}/runs/${seg(id)}/round`,
  runContinue: (id: string) => `${API_BASE}/runs/${seg(id)}/continue`,
  runSweep: (id: string) => `${API_BASE}/runs/${seg(id)}/sweep`,
  runLive: (id: string) => `${API_BASE}/runs/${seg(id)}/live`,
  runDigestJob: (id: string) => `${API_BASE}/runs/${seg(id)}/digest/job`,
  killSwitch: `${API_BASE}/kill-switch`,
  job: (id: string) => `${API_BASE}/jobs/${seg(id)}`,

  // ---- M2: live (ADR-0026) ------------------------------------------------
  events: `${API_BASE}/events`,
} as const;

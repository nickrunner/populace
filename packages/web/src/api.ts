import {
  AgentSummarySchema,
  DigestSchema,
  ErrorBodySchema,
  FindingSchema,
  HealthViewSchema,
  MemorySchema,
  RunDetailSchema,
  RunSummarySchema,
  SpendViewSchema,
  TargetViewSchema,
  ToolUsageViewSchema,
  TraceEventSchema,
  WakeDetailSchema,
  WakeSummarySchema,
  pageOf,
  routes,
} from "@populace/contract";
import type { z } from "zod";

/**
 * Every response is parsed against the contract schema before it reaches a component, so a
 * server that drifts from the contract fails here with a readable message rather than three
 * screens deep as an undefined field (ADR-0023).
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  // eslint-disable-next-line no-restricted-syntax -- HTTP boundary: parsed with the contract schema two lines down.
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ErrorBodySchema.safeParse(body);
    throw new ApiError(parsed.success ? parsed.data.error.message : `${res.status} from ${path}`, res.status);
  }
  return schema.parse(body);
}

const runs = pageOf(RunSummarySchema);
const agents = pageOf(AgentSummarySchema);
const wakes = pageOf(WakeSummarySchema);
const findings = pageOf(FindingSchema);
const trace = pageOf(TraceEventSchema);

export const api = {
  health: () => get(routes.health, HealthViewSchema),
  target: () => get(routes.target, TargetViewSchema),
  runs: () => get(routes.runs, runs),
  run: (id: string) => get(routes.run(id), RunDetailSchema),
  agents: (id: string) => get(routes.runAgents(id), agents),
  wakes: (id: string) => get(routes.runWakes(id), wakes),
  findings: (id: string, query = "") => get(`${routes.runFindings(id)}${query}`, findings),
  digest: (id: string) => get(routes.runDigest(id), DigestSchema),
  spend: (id: string) => get(routes.runSpend(id), SpendViewSchema),
  tools: (id: string) => get(routes.runTools(id), ToolUsageViewSchema),
  memory: (runId: string, agentId: string) => get(routes.agentMemory(runId, agentId), MemorySchema),
  wake: (id: string) => get(routes.wake(id), WakeDetailSchema),
  /** The whole trace in one request: a wake is bounded by the turn cap, so it always fits. */
  trace: (id: string) => get(`${routes.wakeTrace(id)}?limit=500`, trace),
  finding: (id: string) => get(routes.finding(id), FindingSchema),
};

export type Run = z.infer<typeof RunDetailSchema>;
export type RunSummary = z.infer<typeof RunSummarySchema>;
export type Agent = z.infer<typeof AgentSummarySchema>;
export type Wake = z.infer<typeof WakeSummarySchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type Digest = z.infer<typeof DigestSchema>;
export type Cluster = Digest["clusters"][number];
export type TraceEvent = z.infer<typeof TraceEventSchema>;
export type Memory = z.infer<typeof MemorySchema>;
export type ToolUsageView = z.infer<typeof ToolUsageViewSchema>;
export type SpendView = z.infer<typeof SpendViewSchema>;
export type TargetView = z.infer<typeof TargetViewSchema>;

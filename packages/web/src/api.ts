import {
  AgentSummarySchema,
  ConfigExportSchema,
  ConfigImportResultSchema,
  ConfigRevisionDetailSchema,
  ConfigRevisionViewSchema,
  EventSchema,
  JobViewSchema,
  PersonaPreviewSchema,
  PersonaViewSchema,
  PopulationViewSchema,
  RunEstimateSchema,
  RunLiveSchema,
  SettingsViewSchema,
  SetupStatusSchema,
  StarterPersonaViewSchema,
  StartedRunSchema,
  StoredTargetViewSchema,
  TargetCheckSchema,
  TargetPromisesSchema,
  type PersonaInput,
  type PopulationInput,
  type SettingsInput,
  type StartRunBody,
  type TargetInput,
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
import { z } from "zod";

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

/**
 * Anything that writes, spends money or reaches someone else's server is a POST or a PUT. The
 * response is parsed against the contract schema exactly as a GET's is, so a server that drifts
 * fails here rather than three screens deep (ADR-0023).
 */
async function send<T>(method: "POST" | "PUT" | "DELETE", path: string, body: object | undefined, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  // eslint-disable-next-line no-restricted-syntax -- HTTP boundary: parsed with the contract schema below.
  const parsed = (res.status === 204 ? null : await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const error = ErrorBodySchema.safeParse(parsed);
    throw new ApiError(error.success ? error.data.error.message : `${res.status} from ${path}`, res.status);
  }
  return schema.parse(parsed);
}

const runs = pageOf(RunSummarySchema);
const targets = pageOf(StoredTargetViewSchema);
const personas = pageOf(PersonaViewSchema);
const starters = pageOf(StarterPersonaViewSchema);
const revisions = pageOf(ConfigRevisionViewSchema);
const nothing = z.null();
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

  // ---- M2: setting it up -------------------------------------------------
  setup: () => get(routes.setup, SetupStatusSchema),
  targets: () => get(routes.targets, targets),
  saveTarget: (id: string | null, body: TargetInput) => (id === null ? send("POST", routes.targets, body, StoredTargetViewSchema) : send("PUT", routes.target_(id), body, StoredTargetViewSchema)),
  /** Opens a connection to the target. POST because that is a side effect on someone else's server. */
  checkTarget: (id: string) => send("POST", routes.targetCheck(id), undefined, TargetCheckSchema),
  checkDraftTarget: (body: { mcp: TargetInput["mcp"] }) => send("POST", `${routes.targets}/check`, body, TargetCheckSchema),
  promises: (id: string) => get(routes.targetPromises(id), TargetPromisesSchema),

  personas: () => get(routes.personas, personas),
  starters: () => get(routes.personaStarters, starters),
  addStarter: (slug: string, count: number) => send("POST", routes.personaStarters, { slug, count }, PersonaViewSchema),
  savePersona: (id: string | null, body: PersonaInput) => (id === null ? send("POST", routes.personas, body, PersonaViewSchema) : send("PUT", routes.persona(id), body, PersonaViewSchema)),
  removePersona: (id: string) => send("DELETE", routes.persona(id), undefined, nothing),
  /** The assembled system prompt. The draft goes up so the panel follows what is being typed. */
  previewPersona: (id: string, spec?: PersonaInput["spec"]) => send("POST", routes.personaPreview(id), spec === undefined ? {} : { spec }, PersonaPreviewSchema),
  duplicatePersona: (id: string) => send("POST", routes.personaDuplicate(id), {}, PersonaViewSchema),

  population: () => get(routes.population, PopulationViewSchema),
  savePopulation: (body: PopulationInput) => send("PUT", routes.population, body, PopulationViewSchema),
  settings: () => get(routes.settings, SettingsViewSchema),
  saveSettings: (body: SettingsInput) => send("PUT", routes.settings, body, SettingsViewSchema),

  // ---- M2: the config file ------------------------------------------------
  exportConfig: () => get(routes.configExport, ConfigExportSchema),
  /** The same bytes the screen shows, as a download. */
  exportConfigUrl: `${routes.configExport}?format=yaml`,
  /** `apply: false` reports what a file would do and writes nothing. */
  importConfig: (yaml: string, apply: boolean) => send("POST", routes.configImport, { yaml, apply }, ConfigImportResultSchema),
  history: () => get(routes.configHistory, revisions),
  revision: (id: string) => get(routes.configRevision(id), ConfigRevisionDetailSchema),
  restoreRevision: (id: string) => send("POST", routes.configRestore(id), {}, ConfigRevisionViewSchema),

  // ---- M2: driving it ----------------------------------------------------
  /** Arithmetic over history. It spends nothing and never starts a run. */
  estimate: () => send("POST", routes.runsEstimate, {}, RunEstimateSchema),
  startRun: (body: StartRunBody) => send("POST", routes.runs, body, StartedRunSchema),
  continueRun: (id: string, body: StartRunBody) => send("POST", routes.runContinue(id), body, StartedRunSchema),
  stopRun: (id: string, mode: "drain" | "now") => send("POST", routes.runStop(id), { mode }, z.object({ runId: z.string(), status: z.string() })),
  oneMoreRound: (id: string) => send("POST", routes.runRound(id), {}, z.object({ runId: z.string(), agents: z.number() })),
  sweepRun: (id: string, body: { dryRun?: boolean; keepData?: boolean }) => send("POST", routes.runSweep(id), body, JobViewSchema),
  buildDigest: (id: string) => send("POST", routes.runDigestJob(id), {}, JobViewSchema),
  setKillSwitch: (engaged: boolean, reason?: string) => send("POST", routes.killSwitch, { engaged, ...(reason === undefined ? {} : { reason }) }, z.object({ engaged: z.boolean(), reason: z.string().nullable(), at: z.string().nullable() })),
  job: (id: string) => get(routes.job(id), JobViewSchema),
  live: (id: string) => get(routes.runLive(id), RunLiveSchema),
};

/**
 * The run's live feed (ADR-0026). `EventSource` reconnects by itself and sends `Last-Event-ID`,
 * so a dropped connection resumes from the cursor rather than losing what happened in the gap;
 * `after` only seeds the very first connection.
 */
export function openEventStream(runId: string, after: number, onEvent: (event: z.infer<typeof EventSchema>) => void): () => void {
  const source = new EventSource(`${routes.events}?run=${encodeURIComponent(runId)}&after=${after}`);
  const handle = (message: MessageEvent<string>): void => {
    // eslint-disable-next-line no-restricted-syntax -- SSE boundary: parsed with the contract schema on the next line.
    const parsed = EventSchema.safeParse(JSON.parse(message.data) as unknown);
    if (parsed.success) onEvent(parsed.data);
  };
  for (const type of ["run.started", "run.ended", "run.status", "wake.started", "wake.ended", "trace.appended", "finding.filed", "guardrail.tripped", "identity.created", "job.updated"]) {
    source.addEventListener(type, handle as EventListener);
  }
  return () => source.close();
}

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
export type SetupStatus = z.infer<typeof SetupStatusSchema>;
export type StoredTarget = z.infer<typeof StoredTargetViewSchema>;
export type TargetCheck = z.infer<typeof TargetCheckSchema>;
export type TargetPromises = z.infer<typeof TargetPromisesSchema>;
export type Persona = z.infer<typeof PersonaViewSchema>;
export type Starter = z.infer<typeof StarterPersonaViewSchema>;
export type PersonaPreview = z.infer<typeof PersonaPreviewSchema>;
export type ConfigRevision = z.infer<typeof ConfigRevisionViewSchema>;
export type ConfigRevisionDetail = z.infer<typeof ConfigRevisionDetailSchema>;
export type ConfigImportResult = z.infer<typeof ConfigImportResultSchema>;
export type PopulationView = z.infer<typeof PopulationViewSchema>;
export type Settings = z.infer<typeof SettingsViewSchema>;
export type RunEstimate = z.infer<typeof RunEstimateSchema>;
export type RunLive = z.infer<typeof RunLiveSchema>;
export type AgentLive = RunLive["agents"][number];
export type Job = z.infer<typeof JobViewSchema>;
export type LiveEvent = z.infer<typeof EventSchema>;

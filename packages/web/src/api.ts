import {
  ClusterDetailViewSchema,
  CohortViewSchema,
  ExecutionCompareViewSchema,
  EventSchema,
  JobViewSchema,
  PersonViewSchema,
  PersonaViewSchema,
  PopulationViewSchema,
  PreflightViewSchema,
  ProjectViewSchema,
  RunEstimateSchema,
  RunLiveSchema,
  SettingsViewSchema,
  SetupStatusSchema,
  SimulationResultsViewSchema,
  ParticipantDetailViewSchema,
  ParticipantSummaryViewSchema,
  ProjectOverviewViewSchema,
  ProjectSummaryViewSchema,
  RunCohortViewSchema,
  SimulationSummaryViewSchema,
  StarterPersonaViewSchema,
  StartedRunSchema,
  StoredTargetViewSchema,
  TargetCheckSchema,
  TargetPromisesSchema,
  TriageViewSchema,
  type CohortInput,
  type PersonPatch,
  type PersonaInput,
  type PopulationInput,
  type ProjectInput,
  type SettingsInput,
  type SimulationInput,
  type StartExecutionBody,
  type TriageInput,
  type TargetInput,
  DigestSchema,
  ErrorBodySchema,
  FindingSchema,
  FirstContactSchema,
  HealthViewSchema,
  MemorySchema,
  RunDetailSchema,
  RunSummarySchema,
  SpendViewSchema,
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

/**
 * Whether the server said "there is nothing here" rather than "I could not answer". The two read
 * very differently to a person — a mistyped or stale URL is not a failure — so the screens that
 * can be asked for something that is gone branch on it and write the sentence themselves.
 */
export function isMissing(error: Error | null): boolean {
  return error instanceof ApiError && error.status === 404;
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
 * Anything that writes, spends money or reaches someone else's server is a POST, a PUT or a
 * PATCH. The response is parsed against the contract schema exactly as a GET's is, so a server
 * that drifts fails here rather than three screens deep (ADR-0023).
 */
async function send<T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body: object | undefined, schema: z.ZodType<T>): Promise<T> {
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
const nothing = z.null();
const participants = pageOf(ParticipantSummaryViewSchema);
const projectList = pageOf(ProjectSummaryViewSchema);
const simulations = pageOf(SimulationSummaryViewSchema);
const runCohorts = pageOf(RunCohortViewSchema);
const cohorts = pageOf(CohortViewSchema);
const people = pageOf(PersonViewSchema);
const populations = pageOf(PopulationViewSchema);
const wakes = pageOf(WakeSummarySchema);
const findings = pageOf(FindingSchema);
const trace = pageOf(TraceEventSchema);
const triageList = pageOf(TriageViewSchema);
const events = pageOf(EventSchema);

/**
 * The prompt one persona would produce, rendered by the runner's own code. It has no contract
 * schema of its own — it is two strings — so the boundary is parsed here (ADR-0023 all the same).
 */
const promptPreview = z.object({ personaSlug: z.string(), text: z.string() });

/**
 * Which project a call is about is an ARGUMENT, never process state. The project is a path
 * segment in the URL (`/p/:proj`) and `ProjectContext` reads it from there, so two tabs open on
 * two projects cannot answer for each other — which is what a module-level `currentProject()`
 * made possible.
 */
export const api = {
  health: () => get(routes.health, HealthViewSchema),

  // ---- projects ------------------------------------------------------------
  projects: () => get(routes.projects, projectList),
  createProject: (body: ProjectInput) => send("POST", routes.projects, body, ProjectViewSchema),
  project: (p: string) => get(routes.project(p), ProjectOverviewViewSchema),
  saveProject: (p: string, body: ProjectInput) => send("PUT", routes.project(p), body, ProjectViewSchema),
  setup: (p: string) => get(routes.projectSetup(p), SetupStatusSchema),

  // ---- the library ---------------------------------------------------------
  targets: (p: string) => get(routes.targets(p), targets),
  target: (p: string, t: string) => get(routes.target_(p, t), StoredTargetViewSchema),
  saveTarget: (p: string, id: string | null, body: TargetInput) =>
    id === null ? send("POST", routes.targets(p), body, StoredTargetViewSchema) : send("PUT", routes.target_(p, id), body, StoredTargetViewSchema),
  removeTarget: (p: string, id: string) => send("DELETE", routes.target_(p, id), undefined, nothing),
  /** Opens a connection to the target. POST because that is a side effect on someone else's server. */
  checkTarget: (p: string, id: string) => send("POST", routes.targetCheck(p, id), undefined, TargetCheckSchema),
  checkDraftTarget: (p: string, body: { mcp: TargetInput["mcp"] }) => send("POST", routes.targetsCheck(p), body, TargetCheckSchema),
  promises: (p: string, id: string) => get(routes.targetPromises(p, id), TargetPromisesSchema),
  /**
   * One person through the front door: an account is provisioned, one read-only tool is called and
   * the account is removed again. POST because it creates something on somebody else's product —
   * not because it spends anything, which it does not: no model is called.
   */
  firstContact: (p: string, id: string) => send("POST", routes.targetFirstContact(p, id), undefined, FirstContactSchema),

  personas: (p: string) => get(routes.personas(p), personas),
  persona: (p: string, x: string) => get(routes.persona(p, x), PersonaViewSchema),
  starters: (p: string) => get(routes.personaStarters(p), starters),
  addStarter: (p: string, slug: string, count: number) => send("POST", routes.personaStarters(p), { slug, count }, PersonaViewSchema),
  savePersona: (p: string, id: string | null, body: PersonaInput) =>
    id === null ? send("POST", routes.personas(p), body, PersonaViewSchema) : send("PUT", routes.persona(p, id), body, PersonaViewSchema),
  removePersona: (p: string, id: string) => send("DELETE", routes.persona(p, id), undefined, nothing),
  /** The system prompt this persona would produce, rendered by the runner rather than guessed at. */
  personaPreview: (p: string, x: string) => send("POST", routes.personaPreview(p, x), undefined, promptPreview),

  cohorts: (p: string) => get(routes.cohorts(p), cohorts),
  cohort: (p: string, c: string) => get(routes.cohort(p, c), CohortViewSchema),
  createCohort: (p: string, body: CohortInput) => send("POST", routes.cohorts(p), body, CohortViewSchema),
  saveCohort: (p: string, c: string, body: CohortInput) => send("PUT", routes.cohort(p, c), body, CohortViewSchema),
  removeCohort: (p: string, c: string) => send("DELETE", routes.cohort(p, c), undefined, nothing),
  cohortPeople: (p: string, c: string) => get(routes.cohortPeople(p, c), people),
  /** Fills the slots nobody has written yet. A job, because a model writes them (SPEC §5.4). */
  writePeople: (p: string, c: string) => send("POST", routes.cohortPeople(p, c), {}, JobViewSchema),
  recastPeople: (p: string, c: string, ordinals?: number[]) =>
    send("POST", routes.cohortPeopleRegenerate(p, c), { confirm: true, ...(ordinals === undefined ? {} : { ordinals }) }, JobViewSchema),
  savePerson: (p: string, c: string, ordinal: number, body: PersonPatch) => send("PATCH", routes.cohortPerson(p, c, ordinal), body, PersonViewSchema),

  populations: (p: string) => get(routes.populations(p), populations),
  createPopulation: (p: string, body: { name: string }) => send("POST", routes.populations(p), body, PopulationViewSchema),
  savePopulation: (p: string, pop: string, body: PopulationInput) => send("PUT", routes.population_(p, pop), body, PopulationViewSchema),

  settings: (p: string) => get(routes.settings(p), SettingsViewSchema),
  saveSettings: (p: string, body: SettingsInput) => send("PUT", routes.settings(p), body, SettingsViewSchema),

  /** What a human decided about a problem, keyed by signature so it survives a re-execution. */
  triage: (p: string) => get(routes.triage(p), triageList),
  setTriage: (p: string, body: TriageInput) => send("PUT", routes.triage(p), body, TriageViewSchema),

  // ---- simulations ---------------------------------------------------------
  simulations: (p: string) => get(routes.simulations(p), simulations),
  simulation: (p: string, s: string) => get(routes.simulation(p, s), SimulationSummaryViewSchema),
  createSimulation: (p: string, body: SimulationInput) => send("POST", routes.simulations(p), body, SimulationSummaryViewSchema),
  saveSimulation: (p: string, s: string, body: SimulationInput) => send("PUT", routes.simulation(p, s), body, SimulationSummaryViewSchema),
  removeSimulation: (p: string, s: string) => send("DELETE", routes.simulation(p, s), undefined, nothing),
  /** Arithmetic over history. It spends nothing and never starts a run. */
  estimate: (p: string, s: string) => send("POST", routes.simulationEstimate(p, s), {}, RunEstimateSchema),
  preflight: (p: string, s: string) => get(routes.simulationPreflight(p, s), PreflightViewSchema),
  results: (p: string, s: string) => get(routes.simulationResults(p, s), SimulationResultsViewSchema),
  cluster: (p: string, s: string, signature: string) => get(routes.simulationCluster(p, s, signature), ClusterDetailViewSchema),
  simulationRuns: (p: string, s: string) => get(routes.simulationRuns(p, s), runs),
  /** Two executions of one simulation, side by side. Both ids are explicit: neither is "the latest". */
  compare: (p: string, s: string, a: string, b: string) => get(`${routes.simulationCompare(p, s)}?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`, ExecutionCompareViewSchema),
  startRun: (p: string, s: string, body: StartExecutionBody) => send("POST", routes.simulationRuns(p, s), body, StartedRunSchema),

  // ---- runs, read ----------------------------------------------------------
  runs: (p?: string) => get(p === undefined ? routes.runs : `${routes.runs}?project=${encodeURIComponent(p)}`, runs),
  run: (id: string) => get(routes.run(id), RunDetailSchema),
  participants: (id: string) => get(routes.runParticipants(id), participants),
  participant: (runId: string, pid: string) => get(routes.participant(runId, pid), ParticipantDetailViewSchema),
  runCohorts: (id: string) => get(routes.runCohorts(id), runCohorts),
  wakes: (id: string) => get(routes.runWakes(id), wakes),
  findings: (id: string, query = "") => get(`${routes.runFindings(id)}${query}`, findings),
  digest: (id: string) => get(routes.runDigest(id), DigestSchema),
  spend: (id: string) => get(routes.runSpend(id), SpendViewSchema),
  tools: (id: string) => get(routes.runTools(id), ToolUsageViewSchema),
  memory: (runId: string, participantId: string) => get(routes.participantMemory(runId, participantId), MemorySchema),
  wake: (id: string) => get(routes.wake(id), WakeDetailSchema),
  /** The whole trace in one request: a wake is bounded by the turn cap, so it always fits. */
  trace: (id: string) => get(`${routes.wakeTrace(id)}?limit=500`, trace),
  finding: (id: string) => get(routes.finding(id), FindingSchema),

  // ---- runs, control (ADR-0027) --------------------------------------------
  carryForward: (id: string, body: StartExecutionBody) => send("POST", routes.runCarryForward(id), body, StartedRunSchema),
  stopRun: (id: string, mode: "drain" | "now") => send("POST", routes.runStop(id), { mode }, z.object({ runId: z.string(), status: z.string() })),
  pauseRun: (id: string) => send("POST", routes.runPause(id), {}, z.object({ runId: z.string(), status: z.string() })),
  resumeRun: (id: string) => send("POST", routes.runResume(id), {}, z.object({ runId: z.string(), status: z.string() })),
  oneMoreRound: (id: string) => send("POST", routes.runRound(id), {}, z.object({ runId: z.string(), participants: z.number() })),
  sweepRun: (id: string, body: { dryRun?: boolean; keepData?: boolean }) => send("POST", routes.runSweep(id), body, JobViewSchema),
  buildDigest: (id: string) => send("POST", routes.runDigestJob(id), {}, JobViewSchema),
  setKillSwitch: (engaged: boolean, reason?: string) =>
    send("POST", routes.killSwitch, { engaged, ...(reason === undefined ? {} : { reason }) }, z.object({ engaged: z.boolean(), reason: z.string().nullable(), at: z.string().nullable() })),
  job: (id: string) => get(routes.job(id), JobViewSchema),
  live: (id: string) => get(routes.runLive(id), RunLiveSchema),
  /**
   * One execution's life: started, paused, resumed, reconfigured, ended. The same log the stream
   * carries, read back rather than followed — a longitudinal execution's history is not a list of
   * runs, it is what happened to one (SPEC §4.3).
   */
  runEvents: (id: string) => get(`${routes.eventsHistory}?run=${encodeURIComponent(id)}`, events),
};

type Listener = (event: z.infer<typeof EventSchema>) => void;

const EVENT_TYPES = ["run.started", "run.ended", "run.status", "run.config", "wake.started", "wake.ended", "trace.appended", "finding.filed", "guardrail.tripped", "identity.created", "job.updated"];

function stream(query: string, onEvent: Listener): () => void {
  const source = new EventSource(`${routes.events}?${query}`);
  const handle = (message: MessageEvent<string>): void => {
    // eslint-disable-next-line no-restricted-syntax -- SSE boundary: parsed with the contract schema on the next line.
    const parsed = EventSchema.safeParse(JSON.parse(message.data) as unknown);
    if (parsed.success) onEvent(parsed.data);
  };
  for (const type of EVENT_TYPES) source.addEventListener(type, handle as EventListener);
  return () => source.close();
}

/**
 * The run's live feed (ADR-0026). `EventSource` reconnects by itself and sends `Last-Event-ID`,
 * so a dropped connection resumes from the cursor rather than losing what happened in the gap;
 * `after` only seeds the very first connection.
 */
export function openEventStream(runId: string, after: number, onEvent: Listener): () => void {
  return stream(`run=${encodeURIComponent(runId)}&after=${after}`, onEvent);
}

/**
 * One connection for a whole project, which is what `events.project_id` is for: the shell follows
 * every simulation in the project on it and invalidates what each event touched, so no screen
 * needs a timer to notice that something happened.
 */
export function openProjectEventStream(projectId: string, onEvent: Listener): () => void {
  return stream(`project=${encodeURIComponent(projectId)}`, onEvent);
}

export type Run = z.infer<typeof RunDetailSchema>;
export type RunSummary = z.infer<typeof RunSummarySchema>;
export type Participant = z.infer<typeof ParticipantSummaryViewSchema>;
export type Wake = z.infer<typeof WakeSummarySchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type Digest = z.infer<typeof DigestSchema>;
export type Cluster = Digest["clusters"][number];
export type TraceEvent = z.infer<typeof TraceEventSchema>;
export type Memory = z.infer<typeof MemorySchema>;
export type ToolUsageView = z.infer<typeof ToolUsageViewSchema>;
export type SpendView = z.infer<typeof SpendViewSchema>;
export type SetupStatus = z.infer<typeof SetupStatusSchema>;
export type StoredTarget = z.infer<typeof StoredTargetViewSchema>;
export type TargetCheck = z.infer<typeof TargetCheckSchema>;
export type TargetPromises = z.infer<typeof TargetPromisesSchema>;
export type FirstContact = z.infer<typeof FirstContactSchema>;
export type Persona = z.infer<typeof PersonaViewSchema>;
export type Starter = z.infer<typeof StarterPersonaViewSchema>;
export type PopulationView = z.infer<typeof PopulationViewSchema>;
export type ProjectSummary = z.infer<typeof ProjectSummaryViewSchema>;
export type ProjectOverview = z.infer<typeof ProjectOverviewViewSchema>;
export type SimulationSummary = z.infer<typeof SimulationSummaryViewSchema>;
export type SimulationResults = z.infer<typeof SimulationResultsViewSchema>;
export type Preflight = z.infer<typeof PreflightViewSchema>;
export type CohortView = z.infer<typeof CohortViewSchema>;
export type PersonView = z.infer<typeof PersonViewSchema>;
export type Settings = z.infer<typeof SettingsViewSchema>;
export type RunEstimate = z.infer<typeof RunEstimateSchema>;
export type RunLive = z.infer<typeof RunLiveSchema>;
export type ParticipantLive = RunLive["participants"][number];
export type Job = z.infer<typeof JobViewSchema>;
export type ClusterCard = SimulationResults["clusters"][number];
export type ClusterDetail = z.infer<typeof ClusterDetailViewSchema>;
export type ExecutionCompare = z.infer<typeof ExecutionCompareViewSchema>;
export type ParticipantDetail = z.infer<typeof ParticipantDetailViewSchema>;
export type RunCohort = z.infer<typeof RunCohortViewSchema>;
export type Triage = z.infer<typeof TriageViewSchema>;
export type LiveEvent = z.infer<typeof EventSchema>;

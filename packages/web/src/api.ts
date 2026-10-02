import {
  ClusterDetailViewSchema,
  CohortViewSchema,
  ExecutionCompareViewSchema,
  EventViewSchema,
  EstimateViewSchema,
  GithubCheckResultSchema,
  GithubConnectionViewSchema,
  JobViewSchema,
  PublishIssueResultSchema,
  PersonViewSchema,
  PersonaPreviewViewSchema,
  PersonaViewSchema,
  PopulationViewSchema,
  PreflightViewSchema,
  ProjectViewSchema,
  ProvisioningCheckSchema,
  RunLiveSchema,
  SettingsViewSchema,
  SignInStartResultSchema,
  SignInStatusSchema,
  SetupStatusSchema,
  StudyPeopleViewSchema,
  StudyResultsViewSchema,
  ParticipantDetailViewSchema,
  ParticipantSummaryViewSchema,
  ProjectOverviewViewSchema,
  ProjectSummaryViewSchema,
  RunCohortViewSchema,
  StudySummaryViewSchema,
  StarterPersonaViewSchema,
  StartedRunSchema,
  StoredTargetViewSchema,
  TargetCheckSchema,
  TargetPromisesSchema,
  TriageViewSchema,
  type CohortInput,
  type FiledIssueView,
  type GithubCheckBody,
  type GithubConnectionInput,
  type PersonPatch,
  type PersonaInput,
  type PersonaPreviewBody,
  type PopulationCreate,
  type PopulationInput,
  type ProjectEstimateBody,
  type ProjectInput,
  type ProvisioningCheckBody,
  type SettingsInput,
  type StudyCreateInput,
  type StudyUpdateInput,
  type StartExecutionBody,
  type TriageInput,
  type TargetCheckBody,
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

/**
 * Whether the server REFUSED rather than failed: a cohort still held by a population, a
 * population a study still sends, a start with nobody to send. A 409 carries the reason in its
 * message and is shown through `WhatWentWrong`, not retried — asking again changes nothing.
 */
export function isRefused(error: Error | null): boolean {
  return error instanceof ApiError && error.status === 409;
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
const studies = pageOf(StudySummaryViewSchema);
const runCohorts = pageOf(RunCohortViewSchema);
const cohorts = pageOf(CohortViewSchema);
const populations = pageOf(PopulationViewSchema);
const wakes = pageOf(WakeSummarySchema);
const findings = pageOf(FindingSchema);
const trace = pageOf(TraceEventSchema);
const triageList = pageOf(TriageViewSchema);
const events = pageOf(EventViewSchema);
/**
 * `null` is an answer, not a gap: a project nobody has connected a repository to has no
 * connection to describe, and an empty object pretending to be one would make the settings screen
 * say it had a repository whose token you could not see (`GithubConnectionViewSchema`'s note).
 */
const githubConnection = GithubConnectionViewSchema.nullable();

/**
 * Which project a call is about is an ARGUMENT, never process state. The project is a path
 * segment in the URL (`/p/:proj`) and `ProjectContext` reads it from there, so two tabs open on
 * two projects cannot answer for each other — which is what a module-level `currentProject()`
 * made possible.
 *
 * The names here are the wire's, which are the user's words (ADR-0032, ADR-0042): a study, its
 * executions, its people. Nothing in this file says simulation, agent, wake or lane.
 */
export const api = {
  health: () => get(routes.health, HealthViewSchema),

  // ---- projects ------------------------------------------------------------
  projects: () => get(routes.projects, projectList),
  createProject: (body: ProjectInput) => send("POST", routes.projects, body, ProjectViewSchema),
  project: (p: string) => get(routes.project(p), ProjectOverviewViewSchema),
  saveProject: (p: string, body: ProjectInput) => send("PUT", routes.project(p), body, ProjectViewSchema),
  /**
   * Gone, and everything in it with it: the targets, the personas, the cohorts and their people,
   * the populations, the studies, the settings, the triage and every execution with its visits,
   * traces and findings. The server refuses while an execution in it is running.
   */
  removeProject: (p: string) => send("DELETE", routes.project(p), undefined, nothing),
  /** What stands between this project and a first execution. A GET, and it creates nothing (D7). */
  setup: (p: string) => get(routes.projectSetup(p), SetupStatusSchema),

  // ---- the library ---------------------------------------------------------
  targets: (p: string) => get(routes.targets(p), targets),
  target: (p: string, t: string) => get(routes.target_(p, t), StoredTargetViewSchema),
  saveTarget: (p: string, id: string | null, body: TargetInput) =>
    id === null ? send("POST", routes.targets(p), body, StoredTargetViewSchema) : send("PUT", routes.target_(p, id), body, StoredTargetViewSchema),
  /** Refused, by name, while a study points at it. */
  removeTarget: (p: string, id: string) => send("DELETE", routes.target_(p, id), undefined, nothing),
  /** Opens a connection to the target. POST because that is a side effect on someone else's server. */
  checkTarget: (p: string, id: string) => send("POST", routes.targetCheck(p, id), undefined, TargetCheckSchema),
  /**
   * The same question against an address nobody has saved — or against one this screen saved a
   * moment ago, which is what `target` names (ADR-0040). A stored bearer token never comes back
   * down to the browser, so a re-check after a reload has to say which row's token to reuse.
   */
  checkDraftTarget: (p: string, body: TargetCheckBody) => send("POST", routes.targetsCheck(p), body, TargetCheckSchema),
  promises: (p: string, id: string) => get(routes.targetPromises(p, id), TargetPromisesSchema),
  /**
   * One person through the front door: an account is provisioned, one read-only tool is called and
   * the account is removed again. POST because it creates something on somebody else's product —
   * not because it spends anything, which it does not: no model is called.
   */
  firstContact: (p: string, id: string) => send("POST", routes.targetFirstContact(p, id), undefined, FirstContactSchema),
  /**
   * The TDK handshake, asked on the reader's behalf (ADR-0038). A POST because the body may carry
   * the shared secret, and not because it writes: at the far end it is a `GET` that creates
   * nobody, which is what makes it safe to offer before a target is saved.
   */
  checkProvisioning: (p: string, body: ProvisioningCheckBody) => send("POST", routes.provisioningCheck(p), body, ProvisioningCheckSchema),

  /**
   * YOUR sign-in to an address (ADR-0036). Keyed by the address rather than by a target, because
   * signing in is part of CONNECTING — there is no saved target yet when it happens.
   */
  signInStatus: (p: string, url: string) => get(`${routes.signIn(p)}?url=${encodeURIComponent(url)}`, SignInStatusSchema),
  /** Registers this populace with the authorization server if need be, and says where to send the browser. */
  startSignIn: (p: string, url: string) => send("POST", routes.signIn(p), { url }, SignInStartResultSchema),
  forgetSignIn: (p: string, url: string) => send("DELETE", `${routes.signIn(p)}?url=${encodeURIComponent(url)}`, undefined, SignInStatusSchema),

  personas: (p: string) => get(routes.personas(p), personas),
  persona: (p: string, x: string) => get(routes.persona(p, x), PersonaViewSchema),
  /**
   * The prebuilt personas, each with its whole `spec` and a suggested cohort context, offered
   * INSIDE the persona builder as a starting point (ADR-0043). Reading them makes nothing: taking
   * one is `createPersona` with the starter's spec and `origin: "starter"`.
   */
  starters: (p: string) => get(routes.personaStarters(p), starters),
  /** `origin: "starter"` says the builder began from one, which is what lets `suggestedContext` be found later. */
  createPersona: (p: string, body: PersonaInput) => send("POST", routes.personas(p), body, PersonaViewSchema),
  savePersona: (p: string, x: string, body: PersonaInput) => send("PUT", routes.persona(p, x), body, PersonaViewSchema),
  /** Refused, by name, while a cohort mixes it. */
  removePersona: (p: string, id: string) => send("DELETE", routes.persona(p, id), undefined, nothing),
  /**
   * "How this reads to them", for a persona that may not be saved yet: the system prompt the
   * body's `spec` would produce, rendered by the runner rather than guessed at. `targetId` says
   * WHICH target the prompt is a preview of; the server refuses to guess above one, and with none
   * it renders against a placeholder product so the preview still has a shape. A POST that spends
   * nothing — the prompt is rendered, not sent anywhere.
   */
  previewPersonaDraft: (p: string, body: PersonaPreviewBody) => send("POST", routes.personasPreview(p), body, PersonaPreviewViewSchema),
  /** The saved persona's prompt: the same render, from the stored spec. */
  personaPreview: (p: string, x: string, target: string | null) =>
    send("POST", `${routes.personaPreview(p, x)}${target === null ? "" : `?target=${encodeURIComponent(target)}`}`, undefined, PersonaPreviewViewSchema),

  cohorts: (p: string) => get(routes.cohorts(p), cohorts),
  cohort: (p: string, c: string) => get(routes.cohort(p, c), CohortViewSchema),
  createCohort: (p: string, body: CohortInput) => send("POST", routes.cohorts(p), body, CohortViewSchema),
  /** A changed mix re-deals this cohort — and only this cohort — in every study that sends it. */
  saveCohort: (p: string, c: string, body: CohortInput) => send("PUT", routes.cohort(p, c), body, CohortViewSchema),
  /** Refused, by name, while a population holds it. */
  removeCohort: (p: string, c: string) => send("DELETE", routes.cohort(p, c), undefined, nothing),

  populations: (p: string) => get(routes.populations(p), populations),
  population: (p: string, pop: string) => get(routes.population_(p, pop), PopulationViewSchema),
  /** Composed in one request: the builder has the whole form at once, so `members` goes with the name. */
  createPopulation: (p: string, body: PopulationCreate) => send("POST", routes.populations(p), body, PopulationViewSchema),
  /**
   * `members`, when sent, IS the composition — the whole ordered set at a weight each, nought
   * removing one. Changing a weight can move people in every study that sends this population
   * (ADR-0039 accepts this; the builder says so).
   */
  savePopulation: (p: string, pop: string, body: PopulationInput) => send("PUT", routes.population_(p, pop), body, PopulationViewSchema),
  /** Refused, by name, while a study still names it. */
  removePopulation: (p: string, pop: string) => send("DELETE", routes.population_(p, pop), undefined, nothing),

  settings: (p: string) => get(routes.settings(p), SettingsViewSchema),
  saveSettings: (p: string, body: SettingsInput) => send("PUT", routes.settings(p), body, SettingsViewSchema),

  /** What a human decided about a problem, keyed by signature so it survives a re-execution. */
  triage: (p: string) => get(routes.triage(p), triageList),
  setTriage: (p: string, body: TriageInput) => send("PUT", routes.triage(p), body, TriageViewSchema),

  // ---- studies -------------------------------------------------------------
  studies: (p: string) => get(routes.studies(p), studies),
  study: (p: string, s: string) => get(routes.study(p, s), StudySummaryViewSchema),
  /**
   * A study is a population at a size, sent at a target (ADR-0041): all three are in the body,
   * because a project holds several targets and several populations and the server refuses to
   * guess (ADR-0035). Saving is what writes the people — a 201 means the roster is dealt.
   */
  createStudy: (p: string, body: StudyCreateInput) => send("POST", routes.studies(p), body, StudySummaryViewSchema),
  /**
   * What changed, and nothing is required. A new `size` re-deals the roster at once: growing
   * re-deals nobody, shrinking puts people aside rather than away. A running longitudinal
   * execution takes none of it until `applyStudy`; an ephemeral one uses it next time.
   */
  saveStudy: (p: string, s: string, body: StudyUpdateInput) => send("PUT", routes.study(p, s), body, StudySummaryViewSchema),
  /**
   * Off the list. A study is ARCHIVED by default and its executions stay exactly where they are;
   * `withRuns` is the reader having ticked "Delete its executions too", shown how many that is.
   * People no other study sends are put aside, not deleted, and come back if a study sends them
   * again (ADR-0031).
   */
  removeStudy: (p: string, s: string, withRuns = false) => send("DELETE", `${routes.study(p, s)}${withRuns ? "?runs=delete" : ""}`, undefined, nothing),
  /** Arithmetic over history for a saved study. It spends nothing and never starts a run. */
  studyEstimate: (p: string, s: string) => send("POST", routes.studyEstimate(p, s), {}, EstimateViewSchema),
  /**
   * The same arithmetic for a study that is not saved yet, or one whose form has changed: the
   * body is the draft. The server resolves it read-only — no person is written, no roster is
   * touched — and a deal that sends nobody comes back as a zero estimate, never a refusal. A POST
   * only because the draft is too large for a query string.
   */
  projectEstimate: (p: string, body: ProjectEstimateBody) => send("POST", routes.projectEstimate(p), body, EstimateViewSchema),
  /** Who is going, and what they will meet — before a penny is spent. A GET, so it writes nothing. */
  studyPreflight: (p: string, s: string) => get(routes.studyPreflight(p, s), PreflightViewSchema),
  studyResults: (p: string, s: string) => get(routes.studyResults(p, s), StudyResultsViewSchema),
  studyCluster: (p: string, s: string, signature: string) => get(routes.studyCluster(p, s, signature), ClusterDetailViewSchema),
  studyRuns: (p: string, s: string) => get(routes.studyRuns(p, s), runs),
  /** Two executions of one study, side by side. Both ids are explicit: neither is "the latest". */
  studyCompare: (p: string, s: string, a: string, b: string) =>
    get(`${routes.studyCompare(p, s)}?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`, ExecutionCompareViewSchema),
  startStudyRun: (p: string, s: string, body: StartExecutionBody) => send("POST", routes.studyRuns(p, s), body, StartedRunSchema),
  /**
   * Re-resolve and re-snapshot the study's live longitudinal execution (SPEC §4.2): the only way
   * a change to a running study reaches the people in it. A 409 — a static pool too small for the
   * new size, say — is the server declining, and it is shown through `WhatWentWrong`.
   */
  applyStudy: (p: string, s: string) => send("POST", routes.studyApply(p, s), {}, z.object({ runId: z.string(), configSnapshotId: z.string() })),

  /**
   * The people this study sends, in deal order — member order, then mix order, then ordinal
   * (ADR-0041). Only rows that exist; `missing` counts the ones nobody has written yet, so
   * `items.length + missing === sends`.
   */
  studyPeople: (p: string, s: string) => get(routes.studyPeople(p, s), StudyPeopleViewSchema),
  /**
   * Fills the placeholders among the people THIS study sends. A job, because a model writes them
   * (SPEC §5.4); refused while any execution in the project is running.
   */
  writeStudyPeople: (p: string, s: string) => send("POST", routes.studyPeople(p, s), {}, JobViewSchema),
  /** Rewrites people who already exist, which is why it is refused without `confirm`. */
  regenerateStudyPeople: (p: string, s: string, personIds?: string[]) =>
    send("POST", routes.studyPeopleRegenerate(p, s), { confirm: true, ...(personIds === undefined ? {} : { personIds }) }, JobViewSchema),
  /**
   * One person by id (`cohortSlug.personaSlug#n`); the route encodes the `#`. The row is shared by
   * every study that sends the cohort, so a line written here follows them into all of those.
   */
  saveStudyPerson: (p: string, s: string, personId: string, body: PersonPatch) => send("PATCH", routes.studyPerson(p, s, personId), body, PersonViewSchema),

  // ---- github (ADR-0044) ---------------------------------------------------
  /**
   * The repository this project files its problems in, or `null` before anybody has connected
   * one. It carries `tokenSet` and never a token: a credential goes up and never comes back down
   * (ADR-0036, ADR-0040), so a form editing a saved connection has never been shown the token it
   * is editing and asks only whether one is stored.
   */
  github: (p: string) => get(routes.github(p), githubConnection),
  /**
   * A patch, with the token's three cases — **absent keeps the stored one, the empty string
   * clears it, a value replaces it** — which is `mergeIdentity`'s contract exactly. A form that
   * only flips the automatic switch therefore sends no token at all, rather than sending the
   * empty field it was shown and wiping one.
   */
  saveGithub: (p: string, body: GithubConnectionInput) => send("PUT", routes.github(p), body, GithubConnectionViewSchema),
  /** Forgets the repository and the token with it. GitHub is not told, because it did not ask. */
  forgetGithub: (p: string) => send("DELETE", routes.github(p), undefined, nothing),
  /**
   * "Will this token open an issue in that repository?" — five outcomes in the remote's own words,
   * as `checkProvisioning` has four.
   *
   * A POST for three reasons, any one of which would be enough: the body may carry a token nobody
   * has saved yet, it reaches somebody else's server, and it writes what it learned — whether the
   * repository is world-readable, and when it was asked — onto the connection. An absent token
   * means "use the stored one", which is how a form that has never seen the token can still ask.
   */
  checkGithub: (p: string, body: GithubCheckBody) => send("POST", routes.githubCheck(p), body, GithubCheckResultSchema),
  /**
   * One problem, filed now. Synchronous, because one issue is one round trip and somebody who
   * pressed a button on a problem wants the link rather than a job to watch.
   *
   * It reports what happened rather than only succeeding: a problem already in the ledger is
   * COMMENTED on instead of filed twice, a problem the connection's filter passes over comes back
   * `skipped` with the reason, and a repository that refused comes back `failed` with GitHub's own
   * words. A 409 is the project having nowhere to file, which is shown through `WhatWentWrong`.
   */
  fileIssue: (p: string, s: string, signature: string) => send("POST", routes.studyIssue(p, s, signature), undefined, PublishIssueResultSchema),
  /**
   * Every problem this study found that the connection's filter passes, or the ones named — a job,
   * because forty issues is forty round trips to somebody else's server (ADR-0027). Watch the
   * returned row with `JobProgress`; publishing calls no model, so it spends nothing.
   *
   * Naming signatures says which problems to CONSIDER, never which rules to waive: praise, a
   * problem a human has settled, a duplicate, an absence and anything already filed are passed
   * over whoever asked.
   */
  fileIssues: (p: string, s: string, signatures?: string[]) =>
    send("POST", routes.studyIssues(p, s), signatures === undefined ? {} : { signatures }, JobViewSchema),

  // ---- runs, read ----------------------------------------------------------
  runs: (p?: string) => get(p === undefined ? routes.runs : `${routes.runs}?project=${encodeURIComponent(p)}`, runs),
  run: (id: string) => get(routes.run(id), RunDetailSchema),
  participants: (id: string) => get(routes.runParticipants(id), participants),
  participant: (runId: string, pid: string) => get(routes.participant(runId, pid), ParticipantDetailViewSchema),
  runCohorts: (id: string) => get(routes.runCohorts(id), runCohorts),
  wakes: (id: string) => get(routes.runWakes(id), wakes),
  findings: (id: string, query = "") => get(`${routes.runFindings(id)}${query}`, findings),
  /**
   * One execution's digest, built from what is already in the store. Free, instant, and it calls
   * nobody: safe to read on load, on a refetch, and on every `finding.filed` the stream carries.
   */
  digest: (id: string) => get(routes.runDigest(id), DigestSchema),
  /**
   * The same digest with the judge run first, and **the one read in this file with effects**.
   *
   * `?verify=true` calls the model on every finding with no verdict yet AND replays each one's
   * recorded tool calls against the live target as the person who filed it — `app.ts` calls it
   * the single deliberate exception to "no route with effects behind a GET", off by default and
   * named in the query string so it can never happen by accident. It is spelled as its own
   * function for exactly that reason: `q.digest` must stay a plain read, or the project event
   * stream invalidating `["digest", runId]` on a filed finding would quietly spend money and
   * write to somebody's product. Only an explicit press may call this.
   */
  recheckAndDigest: (id: string) => get(`${routes.runDigest(id)}?verify=true`, DigestSchema),
  spend: (id: string) => get(routes.runSpend(id), SpendViewSchema),
  tools: (id: string) => get(routes.runTools(id), ToolUsageViewSchema),
  memory: (runId: string, participantId: string) => get(routes.participantMemory(runId, participantId), MemorySchema),
  wake: (id: string) => get(routes.wake(id), WakeDetailSchema),
  /** The whole trace in one request: a visit is bounded by the turn cap, so it always fits. */
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
  /**
   * One execution and everything it produced. Refused while it is running, and refused when it
   * made accounts that are still on the target — those rows are the only record of them, so the
   * server says to sweep first. `force` is the reader accepting the strand.
   */
  removeRun: (id: string, force = false) => send("DELETE", `${routes.run(id)}${force ? "?force=1" : ""}`, undefined, nothing),
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

/**
 * One line of the log as the browser reads it. `EventViewSchema` rather than the core row: the
 * row names the study by the store's own word and the wire speaks the user's (ADR-0032,
 * ADR-0042), so what arrives here already says `studyId`.
 */
export type LiveEvent = z.infer<typeof EventViewSchema>;
type Listener = (event: LiveEvent) => void;

/**
 * Which named events this browser listens for. An `EventSource` delivers by name, so a type
 * missing from this list arrives and is dropped — which is why `issue.opened` and
 * `issue.commented` are here: the automatic report cycle files without anybody pressing
 * anything, and a results screen that never hears about it goes on offering to file a problem
 * that already has an issue.
 */
const EVENT_TYPES = [
  "run.started",
  "run.ended",
  "run.status",
  "run.config",
  "wake.started",
  "wake.ended",
  "trace.appended",
  "finding.filed",
  "guardrail.tripped",
  "identity.created",
  "job.updated",
  "issue.opened",
  "issue.commented",
];

function stream(query: string, onEvent: Listener): () => void {
  const source = new EventSource(`${routes.events}?${query}`);
  const handle = (message: MessageEvent<string>): void => {
    // eslint-disable-next-line no-restricted-syntax -- SSE boundary: parsed with the contract schema on the next line.
    const parsed = EventViewSchema.safeParse(JSON.parse(message.data) as unknown);
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
 * every study in the project on it and invalidates what each event touched, so no screen needs
 * a timer to notice that something happened.
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
/** One leftover, and what it is about. See `NeedSchema` in the contract. */
export type Need = SetupStatus["needs"][number];
export type StoredTarget = z.infer<typeof StoredTargetViewSchema>;
export type TargetCheck = z.infer<typeof TargetCheckSchema>;
/** YOUR sign-in to an address, never the token it holds (ADR-0036). */
export type SignInStatus = z.infer<typeof SignInStatusSchema>;
export type TargetPromises = z.infer<typeof TargetPromisesSchema>;
export type FirstContact = z.infer<typeof FirstContactSchema>;
export type ProvisioningCheck = z.infer<typeof ProvisioningCheckSchema>;
export type Persona = z.infer<typeof PersonaViewSchema>;
export type Starter = z.infer<typeof StarterPersonaViewSchema>;
/** Two strings: the slug the prompt was rendered for and the prompt itself. */
export type PromptPreview = z.infer<typeof PersonaPreviewViewSchema>;
export type PopulationView = z.infer<typeof PopulationViewSchema>;
export type ProjectSummary = z.infer<typeof ProjectSummaryViewSchema>;
export type ProjectOverview = z.infer<typeof ProjectOverviewViewSchema>;
export type StudySummary = z.infer<typeof StudySummaryViewSchema>;
export type StudyResults = z.infer<typeof StudyResultsViewSchema>;
/** The people one study sends, with how many are not written yet (ADR-0041). */
export type StudyPeople = z.infer<typeof StudyPeopleViewSchema>;
export type Preflight = z.infer<typeof PreflightViewSchema>;
export type CohortView = z.infer<typeof CohortViewSchema>;
export type PersonView = z.infer<typeof PersonViewSchema>;
export type Settings = z.infer<typeof SettingsViewSchema>;
/** What a study would cost, in the wire's words: people, visits, and the ceilings that stop it. */
export type Estimate = z.infer<typeof EstimateViewSchema>;
export type RunLive = z.infer<typeof RunLiveSchema>;
export type ParticipantLive = RunLive["participants"][number];
export type Job = z.infer<typeof JobViewSchema>;
export type ClusterCard = StudyResults["clusters"][number];
export type ClusterDetail = z.infer<typeof ClusterDetailViewSchema>;
export type ExecutionCompare = z.infer<typeof ExecutionCompareViewSchema>;
export type ParticipantDetail = z.infer<typeof ParticipantDetailViewSchema>;
export type RunCohort = z.infer<typeof RunCohortViewSchema>;
export type Triage = z.infer<typeof TriageViewSchema>;
/** The project's issue connection, never the token it holds (ADR-0040). `tokenSet` is all there is. */
export type GithubConnection = z.infer<typeof GithubConnectionViewSchema>;
/** What the check found: one of five outcomes, a sentence, and GitHub's own words underneath. */
export type GithubCheck = z.infer<typeof GithubCheckResultSchema>;
/**
 * An issue populace has filed, as a screen needs it: enough to name it and link to it. Taken as
 * the contract's own type rather than inferred here, because nothing in this file parses one on
 * its own — it arrives inside a cluster card, a triage row or a filing result.
 */
export type FiledIssue = FiledIssueView;
/** What happened to one problem: filed, commented on, passed over with a reason, or failed. */
export type PublishResult = z.infer<typeof PublishIssueResultSchema>;

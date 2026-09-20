import { api, isMissing } from "./api.js";

/**
 * One place that names every query.
 *
 * Keys used to be spelled inline at each call site, which is fine until something has to be
 * invalidated from somewhere else — and after M2 that is the normal case: the event stream knows
 * a finding was filed and has to say which queries that made stale. A factory makes the key a
 * value rather than a string a second screen has to remember to spell the same way.
 */
export const keys = {
  projects: ["projects"] as const,
  project: (p: string) => ["project", p] as const,
  setup: (p: string) => ["setup", p] as const,

  targets: (p: string) => ["targets", p] as const,
  target: (p: string, t: string) => ["target", p, t] as const,
  promises: (p: string, t: string) => ["promises", p, t] as const,

  personas: (p: string) => ["personas", p] as const,
  persona: (p: string, x: string) => ["persona", p, x] as const,
  starters: (p: string) => ["starters", p] as const,
  personaPreview: (p: string, x: string) => ["persona-preview", p, x] as const,

  cohorts: (p: string) => ["cohorts", p] as const,
  cohort: (p: string, c: string) => ["cohort", p, c] as const,
  cohortPeople: (p: string, c: string) => ["cohort-people", p, c] as const,
  populations: (p: string) => ["populations", p] as const,
  settings: (p: string) => ["settings", p] as const,

  simulations: (p: string) => ["simulations", p] as const,
  simulation: (p: string, s: string) => ["simulation", p, s] as const,
  estimate: (p: string, s: string) => ["estimate", p, s] as const,
  preflight: (p: string, s: string) => ["preflight", p, s] as const,
  results: (p: string, s: string) => ["results", p, s] as const,
  cluster: (p: string, s: string, signature: string) => ["cluster", p, s, signature] as const,
  compare: (p: string, s: string, a: string, b: string) => ["compare", p, s, a, b] as const,
  simulationRuns: (p: string, s: string) => ["simulation-runs", p, s] as const,
  triage: (p: string) => ["triage", p] as const,

  runs: (p: string) => ["runs", p] as const,
  run: (id: string) => ["run", id] as const,
  participants: (id: string) => ["participants", id] as const,
  participant: (runId: string, pid: string) => ["participant", runId, pid] as const,
  runCohorts: (id: string) => ["run-cohorts", id] as const,
  runEvents: (id: string) => ["run-events", id] as const,
  wakes: (id: string) => ["wakes", id] as const,
  findings: (id: string, filter = "") => ["findings", id, filter] as const,
  digest: (id: string) => ["digest", id] as const,
  spend: (id: string) => ["spend", id] as const,
  tools: (id: string) => ["tools", id] as const,
  memory: (runId: string, pid: string) => ["memory", runId, pid] as const,
  wake: (id: string) => ["wake", id] as const,
  trace: (id: string) => ["trace", id] as const,
  live: (id: string) => ["live", id] as const,
  job: (id: string) => ["job", id] as const,
};

/**
 * How often a query re-asks on its own. The global five-second poll is gone: it re-fetched every
 * screen in the product including a persona form nobody but this browser can change, and it made
 * the event stream redundant instead of authoritative (ADR-0026).
 *
 * What is left is a backstop for the things that move without this browser doing anything, at a
 * rate matched to how fast each one actually moves. Everything else is invalidated by the event
 * stream in `ProjectShell`, or by the mutation that changed it.
 */
export const WATCHING = 2_000;
const BACKSTOP = 20_000;

/**
 * A 404 is an ANSWER, not a failure to get one: the project, the simulation, the execution or the
 * signature in the URL is not there. Retrying it changes nothing and only delays saying so, so the
 * queries whose subject can be missing ask once and let the screen write the sentence.
 */
const retryUnlessMissing = (failureCount: number, error: Error): boolean => !isMissing(error) && failureCount < 1;

export const q = {
  projects: () => ({ queryKey: keys.projects, queryFn: () => api.projects() }),
  project: (p: string) => ({ queryKey: keys.project(p), queryFn: () => api.project(p), refetchInterval: BACKSTOP, retry: retryUnlessMissing }),
  setup: (p: string) => ({ queryKey: keys.setup(p), queryFn: () => api.setup(p) }),

  targets: (p: string) => ({ queryKey: keys.targets(p), queryFn: () => api.targets(p) }),
  target: (p: string, t: string) => ({ queryKey: keys.target(p, t), queryFn: () => api.target(p, t) }),
  promises: (p: string, t: string) => ({ queryKey: keys.promises(p, t), queryFn: () => api.promises(p, t) }),

  personas: (p: string) => ({ queryKey: keys.personas(p), queryFn: () => api.personas(p) }),
  persona: (p: string, x: string) => ({ queryKey: keys.persona(p, x), queryFn: () => api.persona(p, x) }),
  starters: (p: string) => ({ queryKey: keys.starters(p), queryFn: () => api.starters(p) }),
  /** A POST that spends nothing: it renders the prompt, it does not send it anywhere. */
  personaPreview: (p: string, x: string) => ({ queryKey: keys.personaPreview(p, x), queryFn: () => api.personaPreview(p, x) }),

  cohorts: (p: string) => ({ queryKey: keys.cohorts(p), queryFn: () => api.cohorts(p) }),
  cohort: (p: string, c: string) => ({ queryKey: keys.cohort(p, c), queryFn: () => api.cohort(p, c) }),
  cohortPeople: (p: string, c: string) => ({ queryKey: keys.cohortPeople(p, c), queryFn: () => api.cohortPeople(p, c) }),
  populations: (p: string) => ({ queryKey: keys.populations(p), queryFn: () => api.populations(p) }),
  settings: (p: string) => ({ queryKey: keys.settings(p), queryFn: () => api.settings(p) }),

  simulations: (p: string) => ({ queryKey: keys.simulations(p), queryFn: () => api.simulations(p), refetchInterval: BACKSTOP }),
  simulation: (p: string, s: string) => ({ queryKey: keys.simulation(p, s), queryFn: () => api.simulation(p, s), refetchInterval: BACKSTOP, retry: retryUnlessMissing }),
  /** Arithmetic over history. It spends nothing, so it may be asked for on every keystroke. */
  estimate: (p: string, s: string) => ({ queryKey: keys.estimate(p, s), queryFn: () => api.estimate(p, s), retry: false }),
  preflight: (p: string, s: string) => ({ queryKey: keys.preflight(p, s), queryFn: () => api.preflight(p, s), retry: false }),
  results: (p: string, s: string) => ({ queryKey: keys.results(p, s), queryFn: () => api.results(p, s), refetchInterval: BACKSTOP }),
  /** One problem in full, keyed by its signature rather than by a cluster's place in a digest. */
  cluster: (p: string, s: string, signature: string) => ({ queryKey: keys.cluster(p, s, signature), queryFn: () => api.cluster(p, s, signature), retry: retryUnlessMissing }),
  compare: (p: string, s: string, a: string, b: string) => ({ queryKey: keys.compare(p, s, a, b), queryFn: () => api.compare(p, s, a, b), enabled: a !== "" && b !== "" }),
  triage: (p: string) => ({ queryKey: keys.triage(p), queryFn: () => api.triage(p) }),
  simulationRuns: (p: string, s: string) => ({ queryKey: keys.simulationRuns(p, s), queryFn: () => api.simulationRuns(p, s) }),

  runs: (p: string) => ({ queryKey: keys.runs(p), queryFn: () => api.runs(p) }),
  run: (id: string) => ({ queryKey: keys.run(id), queryFn: () => api.run(id), retry: retryUnlessMissing }),
  participants: (id: string) => ({ queryKey: keys.participants(id), queryFn: () => api.participants(id) }),
  runCohorts: (id: string) => ({ queryKey: keys.runCohorts(id), queryFn: () => api.runCohorts(id) }),
  participant: (runId: string, pid: string) => ({ queryKey: keys.participant(runId, pid), queryFn: () => api.participant(runId, pid), retry: retryUnlessMissing }),
  runEvents: (id: string) => ({ queryKey: keys.runEvents(id), queryFn: () => api.runEvents(id) }),
  wakes: (id: string) => ({ queryKey: keys.wakes(id), queryFn: () => api.wakes(id) }),
  findings: (id: string, filter = "") => ({ queryKey: keys.findings(id, filter), queryFn: () => api.findings(id, filter) }),
  digest: (id: string) => ({ queryKey: keys.digest(id), queryFn: () => api.digest(id) }),
  spend: (id: string) => ({ queryKey: keys.spend(id), queryFn: () => api.spend(id) }),
  tools: (id: string) => ({ queryKey: keys.tools(id), queryFn: () => api.tools(id) }),
  wake: (id: string) => ({ queryKey: keys.wake(id), queryFn: () => api.wake(id) }),
  trace: (id: string) => ({ queryKey: keys.trace(id), queryFn: () => api.trace(id) }),
  /** The one screen that is genuinely watching something move, and its own stream on top. */
  live: (id: string) => ({ queryKey: keys.live(id), queryFn: () => api.live(id), refetchInterval: WATCHING }),
  /**
   * A job row. The runner writes to it from another process, so nothing this browser does will
   * tell it the job is done: the screen watching one polls it (`refetchInterval` at the call
   * site, which stops the moment the row is terminal) and drops the poll when it finishes.
   */
  job: (id: string) => ({ queryKey: keys.job(id), queryFn: () => api.job(id) }),
};

/**
 * What one event makes stale, as key prefixes. `invalidateQueries` matches on prefix, so
 * `["run", id]` covers every query about that run and `["results"]` every simulation's results.
 *
 * Trace rows are deliberately absent: a visit screen follows its own trace, and invalidating it
 * from the project stream would refetch five hundred rows on every tool call in the population.
 */
export function staleAfter(event: { type: string; runId: string | null; projectId: string | null; simulationId: string | null; wakeId: string | null }): readonly (readonly string[])[] {
  const out: (readonly string[])[] = [];
  const { runId, projectId, simulationId } = event;
  // A trace row makes NOTHING stale but the trace, and the trace is followed by the one screen
  // reading it. There is one of these for every model turn and every tool call in the population,
  // so treating one as project news refetched the whole live screen, the project and the results
  // at tool-call rate — and the live screen, which skips trace rows for exactly this reason, had
  // its own care undone from here.
  if (event.type === "trace.appended") return out;
  // A project-scoped key is spelled with whatever the URL said — `/p/tasklet` or `/p/prj_9f2…`,
  // both of which resolve to the same project — and an event only knows the id. Matching on the
  // id alone would therefore invalidate nothing at all on the common path, so these prefixes stop
  // at the query NAME. One browser holds one project at a time, so the over-invalidation is one
  // project's worth of queries, which is the correct answer arrived at bluntly rather than the
  // precise answer arrived at wrongly.
  if (projectId !== null) out.push(["project"], ["simulations"], ["runs"], ["setup"]);
  if (simulationId !== null) out.push(["results"], ["simulation"], ["simulation-runs"], ["cluster"]);
  // Run-scoped keys are exact: a run id is a run id everywhere, including in the URL.
  if (runId !== null) {
    out.push(["run", runId], ["live", runId]);
    if (event.type === "finding.filed") out.push(["findings", runId], ["digest", runId]);
    if (event.type === "wake.ended" || event.type === "run.ended") out.push(["wakes", runId], ["participants", runId], ["spend", runId], ["run-cohorts", runId]);
    if (event.type === "run.status" || event.type === "run.config" || event.type === "run.started" || event.type === "run.ended") out.push(["run-events", runId]);
    if (event.type === "identity.created") out.push(["participants", runId]);
  }
  if (event.type === "job.updated") out.push(["job"]);
  return out;
}

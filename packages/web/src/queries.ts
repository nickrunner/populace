import type { PersonaPreviewBody, ProjectEstimateBody } from "@populace/contract";
import { api, isMissing } from "./api.js";

/**
 * One place that names every query.
 *
 * Keys used to be spelled inline at each call site, which is fine until something has to be
 * invalidated from somewhere else — and after M2 that is the normal case: the event stream knows
 * a finding was filed and has to say which queries that made stale. A factory makes the key a
 * value rather than a string a second screen has to remember to spell the same way.
 *
 * Every key opens with the query's NAME and then its arguments, in order. `staleAfter` below
 * matches on the name alone for anything project- or study-scoped, and it reads the name off
 * these factories rather than spelling it again, so a key renamed here is renamed there.
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
  personaPreview: (p: string, x: string, target: string | null) => ["persona-preview", p, x, target] as const,
  /**
   * The draft's own prompt, keyed by the draft: the builder asks on a debounce as the form
   * changes, and two identical drafts are one question. The body is structurally hashed by the
   * query client, so its key order does not matter.
   */
  personaDraftPreview: (p: string, body: PersonaPreviewBody) => ["persona-draft-preview", p, body] as const,

  cohorts: (p: string) => ["cohorts", p] as const,
  cohort: (p: string, c: string) => ["cohort", p, c] as const,
  populations: (p: string) => ["populations", p] as const,
  population: (p: string, pop: string) => ["population", p, pop] as const,
  settings: (p: string) => ["settings", p] as const,
  /** The project's issue connection. One per project, so the project is the whole key. */
  github: (p: string) => ["github", p] as const,

  studies: (p: string) => ["studies", p] as const,
  study: (p: string, s: string) => ["study", p, s] as const,
  estimate: (p: string, s: string) => ["estimate", p, s] as const,
  /** A study that is not saved yet, priced as the form has it. Keyed by the draft, as the preview is. */
  draftEstimate: (p: string, body: ProjectEstimateBody) => ["draft-estimate", p, body] as const,
  preflight: (p: string, s: string) => ["preflight", p, s] as const,
  results: (p: string, s: string) => ["results", p, s] as const,
  cluster: (p: string, s: string, signature: string) => ["cluster", p, s, signature] as const,
  compare: (p: string, s: string, a: string, b: string) => ["compare", p, s, a, b] as const,
  studyRuns: (p: string, s: string) => ["study-runs", p, s] as const,
  studyPeople: (p: string, s: string) => ["study-people", p, s] as const,
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
 * A 404 is an ANSWER, not a failure to get one: the project, the study, the execution or the
 * signature in the URL is not there. Retrying it changes nothing and only delays saying so, so the
 * queries whose subject can be missing ask once and let the screen write the sentence.
 */
const retryUnlessMissing = (failureCount: number, error: Error): boolean => !isMissing(error) && failureCount < 1;

export const q = {
  projects: () => ({ queryKey: keys.projects, queryFn: () => api.projects() }),
  project: (p: string) => ({ queryKey: keys.project(p), queryFn: () => api.project(p), refetchInterval: BACKSTOP, retry: retryUnlessMissing }),
  setup: (p: string) => ({ queryKey: keys.setup(p), queryFn: () => api.setup(p) }),

  targets: (p: string) => ({ queryKey: keys.targets(p), queryFn: () => api.targets(p) }),
  target: (p: string, t: string) => ({ queryKey: keys.target(p, t), queryFn: () => api.target(p, t), retry: retryUnlessMissing }),
  promises: (p: string, t: string) => ({ queryKey: keys.promises(p, t), queryFn: () => api.promises(p, t) }),

  personas: (p: string) => ({ queryKey: keys.personas(p), queryFn: () => api.personas(p) }),
  persona: (p: string, x: string) => ({ queryKey: keys.persona(p, x), queryFn: () => api.persona(p, x), retry: retryUnlessMissing }),
  /** Read, never taken: the builder fills its draft from one of these and saving is what makes a row. */
  starters: (p: string) => ({ queryKey: keys.starters(p), queryFn: () => api.starters(p) }),
  /** A POST that spends nothing: it renders the prompt, it does not send it anywhere. */
  personaPreview: (p: string, x: string, target: string | null) => ({ queryKey: keys.personaPreview(p, x, target), queryFn: () => api.personaPreview(p, x, target) }),
  /**
   * The same render for a draft. `retry: false` because the one way it fails is a refusal — the
   * project has several targets and the body named none — and asking again gets the same answer.
   */
  personaDraftPreview: (p: string, body: PersonaPreviewBody) => ({ queryKey: keys.personaDraftPreview(p, body), queryFn: () => api.previewPersonaDraft(p, body), retry: false }),

  cohorts: (p: string) => ({ queryKey: keys.cohorts(p), queryFn: () => api.cohorts(p) }),
  cohort: (p: string, c: string) => ({ queryKey: keys.cohort(p, c), queryFn: () => api.cohort(p, c), retry: retryUnlessMissing }),
  populations: (p: string) => ({ queryKey: keys.populations(p), queryFn: () => api.populations(p) }),
  population: (p: string, pop: string) => ({ queryKey: keys.population(p, pop), queryFn: () => api.population(p, pop), retry: retryUnlessMissing }),
  settings: (p: string) => ({ queryKey: keys.settings(p), queryFn: () => api.settings(p) }),
  /**
   * The issue connection, or `null` when nobody has made one — which is an answer and not a
   * failure to get one, so nothing here treats an unconnected project as an error. A plain read:
   * it carries `tokenSet` and never a token, so there is nothing here worth not asking for.
   */
  github: (p: string) => ({ queryKey: keys.github(p), queryFn: () => api.github(p) }),

  studies: (p: string) => ({ queryKey: keys.studies(p), queryFn: () => api.studies(p), refetchInterval: BACKSTOP }),
  study: (p: string, s: string) => ({ queryKey: keys.study(p, s), queryFn: () => api.study(p, s), refetchInterval: BACKSTOP, retry: retryUnlessMissing }),
  /** Arithmetic over history. It spends nothing, so it may be asked for on every keystroke. */
  estimate: (p: string, s: string) => ({ queryKey: keys.estimate(p, s), queryFn: () => api.studyEstimate(p, s), retry: false }),
  /** The same, for a study the form has not saved yet. Writes nothing; a deal that sends nobody is a zero, not a refusal. */
  draftEstimate: (p: string, body: ProjectEstimateBody) => ({ queryKey: keys.draftEstimate(p, body), queryFn: () => api.projectEstimate(p, body), retry: false }),
  preflight: (p: string, s: string) => ({ queryKey: keys.preflight(p, s), queryFn: () => api.studyPreflight(p, s), retry: false }),
  results: (p: string, s: string) => ({ queryKey: keys.results(p, s), queryFn: () => api.studyResults(p, s), refetchInterval: BACKSTOP }),
  /** One problem in full, keyed by its signature rather than by a cluster's place in a digest. */
  cluster: (p: string, s: string, signature: string) => ({ queryKey: keys.cluster(p, s, signature), queryFn: () => api.studyCluster(p, s, signature), retry: retryUnlessMissing }),
  compare: (p: string, s: string, a: string, b: string) => ({ queryKey: keys.compare(p, s, a, b), queryFn: () => api.studyCompare(p, s, a, b), enabled: a !== "" && b !== "" }),
  triage: (p: string) => ({ queryKey: keys.triage(p), queryFn: () => api.triage(p) }),
  studyRuns: (p: string, s: string) => ({ queryKey: keys.studyRuns(p, s), queryFn: () => api.studyRuns(p, s) }),
  /** The people this study sends, in deal order. One request however many there are. */
  studyPeople: (p: string, s: string) => ({ queryKey: keys.studyPeople(p, s), queryFn: () => api.studyPeople(p, s), retry: retryUnlessMissing }),

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
 * A key as the factories above make one: the query's name first, then whatever it is about. The
 * arguments are strings, a `null` (the preview's "no target"), or a request body.
 */
export type Key = readonly [string, ...(string | null | object)[]];

/**
 * The family a key belongs to — its name alone, which as a prefix covers every key the factory
 * can make. Spelled by CALLING the factory with placeholders and reading the name back, rather
 * than by repeating the string: this is the only way `staleAfter` can never disagree with `keys`
 * about what a query is called.
 *
 * Exported for the one other place that has to invalidate bluntly: a mutation on a study knows
 * the study's slug, and the URL — and so the key — may spell it by id instead. `StudyActions`
 * invalidates the family and lets the refetch sort out which.
 */
export const familyOf = (key: Key): readonly [string] => [key[0]];

/** A family narrowed to one subject: `["findings", runId]` covers every filter of that run's findings. */
const under = (key: Key, id: string): readonly [string, string] => [key[0], id];

/**
 * Everything about a project that any event in it may have moved: the overview, the studies
 * list, the runs list and what is left to set up.
 */
const PROJECT_WIDE: readonly (readonly [string])[] = [keys.project, keys.studies, keys.runs, keys.setup].map((make) => familyOf(make("")));

/**
 * Everything about a study that an execution of it may have moved: the summary (status, latest,
 * spend), the results and every problem in them, the executions list and the comparisons, and the
 * people — a start materialises the roster, so a People page reading "3 not yet written" learns
 * they now are. The pre-flight and the estimate are deliberately absent: the pre-flight opens a
 * connection to the target to list its tools, and nothing in a project's event stream should do
 * that at visit rate.
 */
const STUDY_WIDE: readonly (readonly [string])[] = [
  ...[keys.study, keys.results, keys.studyRuns, keys.studyPeople].map((make) => familyOf(make("", ""))),
  familyOf(keys.cluster("", "", "")),
  familyOf(keys.compare("", "", "", "")),
];

/**
 * The shape of an event as far as invalidation is concerned: `LiveEvent` minus the fields no key
 * is built from. It is named structurally so the test can hand one in without a payload.
 */
export interface StaleEvent {
  type: string;
  runId: string | null;
  projectId: string | null;
  studyId: string | null;
  wakeId: string | null;
}

/**
 * What one event makes stale, as key prefixes. `invalidateQueries` matches on prefix, so
 * `["run", id]` covers every query about that run and `["results"]` every study's results.
 *
 * Trace rows are deliberately absent: a visit screen follows its own trace, and invalidating it
 * from the project stream would refetch five hundred rows on every tool call in the population.
 */
export function staleAfter(event: StaleEvent): readonly (readonly string[])[] {
  const out: (readonly string[])[] = [];
  const { runId, projectId, studyId } = event;
  // A trace row makes NOTHING stale but the trace, and the trace is followed by the one screen
  // reading it. There is one of these for every model turn and every tool call in the population,
  // so treating one as project news refetched the whole live screen, the project and the results
  // at tool-call rate — and the live screen, which skips trace rows for exactly this reason, had
  // its own care undone from here.
  if (event.type === "trace.appended") return out;
  // A project-scoped key is spelled with whatever the URL said — `/p/my-app` or `/p/prj_9f2…`,
  // both of which resolve to the same project — and an event only knows the id. Matching on the
  // id alone would therefore invalidate nothing at all on the common path, so these prefixes stop
  // at the query NAME. One browser holds one project at a time, so the over-invalidation is one
  // project's worth of queries, which is the correct answer arrived at bluntly rather than the
  // precise answer arrived at wrongly.
  if (projectId !== null) out.push(...PROJECT_WIDE);
  // The same argument for a study: the URL has its slug, the event has its id.
  if (studyId !== null) out.push(...STUDY_WIDE);
  // Run-scoped keys are exact: a run id is a run id everywhere, including in the URL.
  if (runId !== null) {
    out.push(keys.run(runId), keys.live(runId));
    if (event.type === "finding.filed") out.push(under(keys.findings(runId), runId), keys.digest(runId));
    if (event.type === "wake.ended" || event.type === "run.ended") out.push(keys.wakes(runId), keys.participants(runId), keys.spend(runId), keys.runCohorts(runId));
    if (event.type === "run.status" || event.type === "run.config" || event.type === "run.started" || event.type === "run.ended") out.push(keys.runEvents(runId));
    if (event.type === "identity.created") out.push(keys.participants(runId));
  }
  if (event.type === "job.updated") out.push(familyOf(keys.job("")));
  // populace opened or added to an issue, which the automatic cycle does with nobody watching.
  // The results and every problem in them are already covered by the study-wide prefixes above —
  // a card carries its `filedIssue` — and the project's triage list is not, because it is the one
  // read keyed by project alone that also carries the filing. Without this, the list somebody
  // rules on from goes on showing no issue against a problem that now has one.
  if (event.type === "issue.opened" || event.type === "issue.commented") out.push(familyOf(keys.triage("")));
  return out;
}

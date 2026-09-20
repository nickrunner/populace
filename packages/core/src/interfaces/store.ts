import type { Agent } from "../schemas/agent.js";
import type { Project, StoredPersona, StoredPopulation, StoredSettings, StoredTarget } from "../schemas/authored.js";
import type { Cohort } from "../schemas/cohort.js";
import type { Person } from "../schemas/person.js";
import type { Simulation } from "../schemas/simulation.js";
import type { Triage } from "../schemas/triage.js";
import type { Event, EventInput, EventQuery } from "../schemas/event.js";
import type { Job } from "../schemas/job.js";
import type { ConfigSnapshot, Run } from "../schemas/run.js";
import type { Finding, Verification } from "../schemas/finding.js";
import type { Identity } from "../schemas/identity.js";
import type { Memory } from "../schemas/memory.js";
import type { TraceEvent } from "../schemas/trace.js";
import type { Wake } from "../schemas/wake.js";

/**
 * Which model spend a question is about: `visits` is what wakes cost, `authoring` is what jobs
 * spent outside a wake (writing a cohort's people). Omitting it asks for both.
 */
export type CostKind = "visits" | "authoring";

/**
 * Scope of a spend question. A population scopes visits — it is what a wake row carries and what
 * the runner's per-population ceiling is written in terms of. A project scopes both, because
 * authoring belongs to a project and to no population at all.
 */
export interface CostQuery {
  populationId?: string;
  projectId?: string;
  kind?: CostKind;
}

export interface FindingQuery {
  runIds?: string[];
  since?: Date;
  until?: Date;
  kinds?: Finding["kind"][];
  unverifiedOnly?: boolean;
}

/** Everything `listAgents` can narrow by. A run is not optional: agent ids repeat between runs. */
export interface AgentQuery {
  runId: string;
  simulationId?: string;
  cohortSlug?: string;
  status?: Agent["status"];
}

export interface PersonQuery {
  projectId?: string;
  cohortId?: string;
  /** Archived people are the ones past a shrunken cohort's size. Excluded unless asked for. */
  includeArchived?: boolean;
}

export interface SimulationQuery {
  projectId?: string;
  populationId?: string;
  targetId?: string;
  includeArchived?: boolean;
}

/**
 * Thrown by a delete that would orphan a row (SPEC §2.14): an authored row referenced by another
 * authored row cannot be deleted, and the message names the referrers so the user is told what to
 * take apart first rather than being told "no".
 */
export class ReferencedError extends Error {
  constructor(
    readonly entity: string,
    readonly id: string,
    readonly referrers: string[],
  ) {
    super(`cannot delete ${entity} ${id}: still used by ${referrers.join(", ")}`);
    this.name = "ReferencedError";
  }
}

export interface WakeQuery {
  runIds?: string[];
  agentId?: string;
  since?: Date;
  until?: Date;
}

/**
 * Persistence for everything a population produces. SQLite implements this in
 * Milestone 0; a Postgres implementation will implement the same interface for
 * cloud mode (ADR-0004). All methods are async so a remote store fits.
 */
export interface Store {
  // agents
  upsertAgent(agent: Agent): Promise<void>;
  /**
   * An agent id is `populationSlug/cohortSlug#ordinal` and is unique WITHIN A RUN, not globally:
   * two executions of one simulation have an agent of the same id each. `runId` is half the key.
   */
  getAgent(runId: string, id: string): Promise<Agent | undefined>;
  listAgents(filter: AgentQuery): Promise<Agent[]>;
  /**
   * Agents of THIS RUN that are active and whose nextWakeAt is at or before `now`, oldest first.
   * The run predicate is load-bearing: without it one run's daemon claims another run's agents.
   */
  listDueAgents(runId: string, now: Date, limit: number): Promise<Agent[]>;
  deleteAgentsByRun(runId: string): Promise<number>;

  // identities
  saveIdentity(identity: Identity): Promise<void>;
  getIdentity(id: string): Promise<Identity | undefined>;
  listIdentitiesByTag(tag: string, includeTornDown?: boolean): Promise<Identity[]>;
  markIdentityTornDown(id: string, at: Date): Promise<void>;
  deleteIdentitiesByRun(runId: string): Promise<number>;

  // memory
  getMemory(runId: string, agentId: string): Promise<Memory | undefined>;
  saveMemory(memory: Memory): Promise<void>;

  // wakes and traces
  saveWake(wake: Wake): Promise<void>;
  getWake(id: string): Promise<Wake | undefined>;
  listWakes(query?: WakeQuery): Promise<Wake[]>;
  appendTraceEvent(event: TraceEvent): Promise<void>;
  getTrace(wakeId: string): Promise<TraceEvent[]>;
  /**
   * Several wakes' traces in ONE call, ordered by `(wakeId, seq)`. A screen that measures tool
   * coverage over a whole execution reads every visit's trace; doing that one wake at a time made
   * the number of round trips grow with the headcount, which is the shape the project read model
   * is not allowed to have (SPEC §6.2, "query-count discipline").
   */
  getTraces(wakeIds: string[]): Promise<TraceEvent[]>;
  deleteWakesByRun(runId: string): Promise<number>;

  // findings
  saveFinding(finding: Finding): Promise<void>;
  getFinding(id: string): Promise<Finding | undefined>;
  listFindings(query?: FindingQuery): Promise<Finding[]>;
  saveVerification(findingId: string, verification: Verification): Promise<void>;
  deleteFindingsByRun(runId: string): Promise<number>;

  // guardrail support
  /**
   * Dollars of model spend after `since`, in the one place a ceiling is read from.
   *
   * `people.generate` is the first thing outside `runWake` that calls the model, and ADR-0009
   * assumed every dollar was spent inside a wake. Rather than give authoring its own ceiling and
   * its own accounting — two budgets that can each be under while the bill is over — authoring
   * spend is counted here, by the same path, and told apart by `kind` so a spend screen can still
   * separate what the people cost from what the visits did (SPEC §5.4).
   */
  costSince(query: CostQuery, since: Date): Promise<number>;
  setKillSwitch(engaged: boolean, reason?: string): Promise<void>;
  getKillSwitch(): Promise<{ engaged: boolean; reason: string | null; at: string | null }>;
  /**
   * The `control` key-value table, for process-level facts that are not anybody's data: the
   * schema version and `serve`'s advisory lock. Values are opaque strings; a caller that stores
   * JSON parses it with zod on the way out.
   */
  getControl(key: string): Promise<string | undefined>;
  setControl(key: string, value: string): Promise<void>;
  deleteControl(key: string): Promise<void>;

  // runs
  listRunIds(): Promise<string[]>;
  /**
   * Runs become rows at M2 (ADR-0024). A store opened on a database written before then has run
   * ids with no row behind them, so `getRun` returning undefined is a normal state that the read
   * model falls back to deriving, not an error.
   */
  saveRun(run: Run): Promise<void>;
  getRun(id: string): Promise<Run | undefined>;
  /**
   * `parentRunId` is the ADR-0020 lineage lookup and is backed by the `runs_parent` index. The
   * read model used to find a run's children by loading every OTHER run's agents and looking for
   * one that pointed back; that scan was O(runs x agents) on a screen that renders on every poll.
   */
  listRuns(filter?: { projectId?: string; simulationId?: string; status?: Run["status"]; parentRunId?: string }): Promise<Run[]>;
  deleteRun(id: string): Promise<void>;

  // config snapshots (immutable; written once when a run starts)
  saveConfigSnapshot(snapshot: ConfigSnapshot): Promise<void>;
  getConfigSnapshot(id: string): Promise<ConfigSnapshot | undefined>;
  /** Content hash lookup, so two runs on identical config share one snapshot row. */
  findConfigSnapshotByHash(hash: string): Promise<ConfigSnapshot | undefined>;

  // authored config (DATA-MODEL §5). These tables are the user's work and are never dropped.
  saveProject(project: Project): Promise<void>;
  getProject(id: string): Promise<Project | undefined>;
  listProjects(): Promise<Project[]>;

  saveTarget(target: StoredTarget): Promise<void>;
  getTarget(id: string): Promise<StoredTarget | undefined>;
  listTargets(projectId?: string): Promise<StoredTarget[]>;
  /** Refused with `ReferencedError` while a simulation names it. */
  deleteTarget(id: string): Promise<void>;

  savePersona(persona: StoredPersona): Promise<void>;
  getPersona(id: string): Promise<StoredPersona | undefined>;
  listPersonas(projectId?: string): Promise<StoredPersona[]>;
  /** Refused with `ReferencedError` while a cohort points at it. */
  deletePersona(id: string): Promise<void>;

  /**
   * Cohorts: "N people on one persona", and the only place headcount lives. A population is an
   * ordered list of these, and the cohort owns the `people` rows drawn from its seed.
   */
  saveCohort(cohort: Cohort): Promise<void>;
  getCohort(id: string): Promise<Cohort | undefined>;
  listCohorts(projectId?: string): Promise<Cohort[]>;
  /**
   * Refused with `ReferencedError` while a population contains it. Its people are ARCHIVED rather
   * than deleted: past runs' agents name them, and growing the cohort back must meet the same cast.
   */
  deleteCohort(id: string): Promise<void>;

  /**
   * People: one named individual per `(cohort, ordinal)`, written once and then frozen. The id is
   * `${cohortSlug}#${ordinal + 1}` and is project-scoped, which is why reads take a project.
   */
  savePerson(person: Person): Promise<void>;
  getPerson(projectId: string, id: string): Promise<Person | undefined>;
  listPeople(query?: PersonQuery): Promise<Person[]>;
  /** Shrinking a cohort, or deleting one: the rows stay, `archivedAt` is stamped. */
  archivePeople(cohortId: string, at: Date): Promise<number>;

  savePopulation(population: StoredPopulation): Promise<void>;
  getPopulation(id: string): Promise<StoredPopulation | undefined>;
  listPopulations(projectId?: string): Promise<StoredPopulation[]>;
  /** Refused with `ReferencedError` while a simulation names it. */
  deletePopulation(id: string): Promise<void>;

  /** A population running against a target, in one of two modes (`ephemeral` | `longitudinal`). */
  saveSimulation(simulation: Simulation): Promise<void>;
  getSimulation(id: string): Promise<Simulation | undefined>;
  listSimulations(query?: SimulationQuery): Promise<Simulation[]>;
  /**
   * A simulation that has ever run is ARCHIVED, never deleted: its runs are the user's history and
   * archiving a simulation never touches them.
   */
  deleteSimulation(id: string): Promise<void>;

  /** Human judgement about a problem, keyed by signature so it survives a re-execution (ADR-0028). */
  saveTriage(triage: Triage): Promise<void>;
  getTriage(projectId: string, signature: string): Promise<Triage | undefined>;
  listTriage(projectId: string): Promise<Triage[]>;

  saveSettings(settings: StoredSettings): Promise<void>;
  getSettings(projectId: string): Promise<StoredSettings | undefined>;

  // event log (ADR-0026). Append-only, one monotonic cursor across the whole store.
  appendEvent(event: EventInput): Promise<Event>;
  listEvents(query?: EventQuery): Promise<Event[]>;
  latestEventSeq(): Promise<number>;
  /** Derived data: truncating it loses nothing that the produced rows do not still hold. */
  truncateEvents(keepLast: number): Promise<number>;

  // jobs (ADR-0027)
  saveJob(job: Job): Promise<void>;
  getJob(id: string): Promise<Job | undefined>;
  listJobs(filter?: { status?: Job["status"]; runId?: string; limit?: number }): Promise<Job[]>;

  close(): Promise<void>;
}

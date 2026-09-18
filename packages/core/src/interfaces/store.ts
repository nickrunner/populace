import type { Agent } from "../schemas/agent.js";
import type { Project, StoredPersona, StoredPopulation, StoredSettings, StoredTarget } from "../schemas/authored.js";
import type { Event, EventInput, EventQuery } from "../schemas/event.js";
import type { Job } from "../schemas/job.js";
import type { ConfigSnapshot, Run } from "../schemas/run.js";
import type { Finding, Verification } from "../schemas/finding.js";
import type { Identity } from "../schemas/identity.js";
import type { Memory } from "../schemas/memory.js";
import type { TraceEvent } from "../schemas/trace.js";
import type { Wake } from "../schemas/wake.js";

export interface FindingQuery {
  runIds?: string[];
  since?: Date;
  until?: Date;
  kinds?: Finding["kind"][];
  unverifiedOnly?: boolean;
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
  getAgent(id: string): Promise<Agent | undefined>;
  listAgents(filter?: { runId?: string; populationId?: string; status?: Agent["status"] }): Promise<Agent[]>;
  /** Agents that are active and whose nextWakeAt is at or before `now`, oldest first. */
  listDueAgents(now: Date, limit: number): Promise<Agent[]>;
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
  deleteWakesByRun(runId: string): Promise<number>;

  // findings
  saveFinding(finding: Finding): Promise<void>;
  getFinding(id: string): Promise<Finding | undefined>;
  listFindings(query?: FindingQuery): Promise<Finding[]>;
  saveVerification(findingId: string, verification: Verification): Promise<void>;
  deleteFindingsByRun(runId: string): Promise<number>;

  // guardrail support
  /** Dollars spent by wakes of this population that started after `since`. */
  costSince(populationId: string, since: Date): Promise<number>;
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
  listRuns(filter?: { projectId?: string; status?: Run["status"] }): Promise<Run[]>;
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
  deleteTarget(id: string): Promise<void>;

  savePersona(persona: StoredPersona): Promise<void>;
  getPersona(id: string): Promise<StoredPersona | undefined>;
  listPersonas(projectId?: string): Promise<StoredPersona[]>;
  deletePersona(id: string): Promise<void>;

  savePopulation(population: StoredPopulation): Promise<void>;
  getPopulation(id: string): Promise<StoredPopulation | undefined>;
  listPopulations(projectId?: string): Promise<StoredPopulation[]>;
  deletePopulation(id: string): Promise<void>;

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

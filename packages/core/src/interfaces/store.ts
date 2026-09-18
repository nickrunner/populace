import type { Agent } from "../schemas/agent.js";
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

  // runs
  listRunIds(): Promise<string[]>;

  close(): Promise<void>;
}

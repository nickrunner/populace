import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  AgentSchema,
  FindingSchema,
  IdentitySchema,
  MemorySchema,
  TraceEventSchema,
  WakeSchema,
  type Agent,
  type Finding,
  type FindingQuery,
  type Identity,
  type Memory,
  type Store,
  type TraceEvent,
  type Verification,
  type Wake,
  type WakeQuery,
} from "@populace/core";
import type { z } from "zod";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, population_id TEXT NOT NULL, status TEXT NOT NULL,
  next_wake_at TEXT, json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agents_due ON agents(status, next_wake_at);
CREATE TABLE IF NOT EXISTS identities (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, tag TEXT NOT NULL, agent_id TEXT NOT NULL,
  torn_down_at TEXT, json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS identities_tag ON identities(tag);
CREATE TABLE IF NOT EXISTS memories (agent_id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS wakes (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, agent_id TEXT NOT NULL, population_id TEXT NOT NULL,
  started_at TEXT NOT NULL, cost_usd REAL NOT NULL, json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS wakes_pop_started ON wakes(population_id, started_at);
CREATE TABLE IF NOT EXISTS trace_events (
  wake_id TEXT NOT NULL, seq INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (wake_id, seq)
);
CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, wake_id TEXT NOT NULL, kind TEXT NOT NULL,
  created_at TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS findings_created ON findings(created_at);
CREATE TABLE IF NOT EXISTS control (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

interface JsonRow {
  json: string;
}

function parseRow<T>(schema: z.ZodType<T>, row: JsonRow): T {
  // eslint-disable-next-line no-restricted-syntax -- SQLite boundary: JSON text is parsed with zod immediately.
  return schema.parse(JSON.parse(row.json) as unknown);
}

function rows(result: object[]): JsonRow[] {
  // eslint-disable-next-line no-restricted-syntax -- node:sqlite returns loosely typed rows; every row is zod-parsed by the caller.
  return result as unknown as JsonRow[];
}

/** Store implementation on the SQLite module built into Node 22 (ADR-0011). */
export class SqliteStore implements Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
  }

  static open(path: string): SqliteStore {
    return new SqliteStore(path);
  }

  // ---- agents ------------------------------------------------------------

  upsertAgent(agent: Agent): Promise<void> {
    const parsed = AgentSchema.parse(agent);
    this.db
      .prepare(
        `INSERT INTO agents (id, run_id, population_id, status, next_wake_at, json) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET run_id = excluded.run_id, population_id = excluded.population_id, status = excluded.status,
           next_wake_at = excluded.next_wake_at, json = excluded.json`,
      )
      .run(parsed.id, parsed.runId, parsed.populationId, parsed.status, parsed.nextWakeAt, JSON.stringify(parsed));
    return Promise.resolve();
  }

  getAgent(id: string): Promise<Agent | undefined> {
    const row = this.db.prepare("SELECT json FROM agents WHERE id = ?").get(id);
    return Promise.resolve(row ? parseRow(AgentSchema, rows([row])[0] as JsonRow) : undefined);
  }

  listAgents(filter: { runId?: string; populationId?: string; status?: Agent["status"] } = {}): Promise<Agent[]> {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.runId) {
      where.push("run_id = ?");
      params.push(filter.runId);
    }
    if (filter.populationId) {
      where.push("population_id = ?");
      params.push(filter.populationId);
    }
    if (filter.status) {
      where.push("status = ?");
      params.push(filter.status);
    }
    const sql = `SELECT json FROM agents ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id`;
    return Promise.resolve(rows(this.db.prepare(sql).all(...params)).map((r) => parseRow(AgentSchema, r)));
  }

  listDueAgents(now: Date, limit: number): Promise<Agent[]> {
    const result = this.db
      .prepare("SELECT json FROM agents WHERE status = 'active' AND next_wake_at IS NOT NULL AND next_wake_at <= ? ORDER BY next_wake_at LIMIT ?")
      .all(now.toISOString(), limit);
    return Promise.resolve(rows(result).map((r) => parseRow(AgentSchema, r)));
  }

  deleteAgentsByRun(runId: string): Promise<number> {
    const agents = rows(this.db.prepare("SELECT json FROM agents WHERE run_id = ?").all(runId)).map((r) => parseRow(AgentSchema, r));
    for (const agent of agents) this.db.prepare("DELETE FROM memories WHERE agent_id = ?").run(agent.id);
    const result = this.db.prepare("DELETE FROM agents WHERE run_id = ?").run(runId);
    return Promise.resolve(Number(result.changes));
  }

  // ---- identities --------------------------------------------------------

  saveIdentity(identity: Identity): Promise<void> {
    const parsed = IdentitySchema.parse(identity);
    this.db
      .prepare(
        `INSERT INTO identities (id, run_id, tag, agent_id, torn_down_at, json) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET torn_down_at = excluded.torn_down_at, json = excluded.json`,
      )
      .run(parsed.id, parsed.runId, parsed.tag, parsed.agentId, parsed.tornDownAt, JSON.stringify(parsed));
    return Promise.resolve();
  }

  getIdentity(id: string): Promise<Identity | undefined> {
    const row = this.db.prepare("SELECT json FROM identities WHERE id = ?").get(id);
    return Promise.resolve(row ? parseRow(IdentitySchema, rows([row])[0] as JsonRow) : undefined);
  }

  listIdentitiesByTag(tag: string, includeTornDown = false): Promise<Identity[]> {
    const sql = `SELECT json FROM identities WHERE tag = ? ${includeTornDown ? "" : "AND torn_down_at IS NULL"} ORDER BY id`;
    return Promise.resolve(rows(this.db.prepare(sql).all(tag)).map((r) => parseRow(IdentitySchema, r)));
  }

  async markIdentityTornDown(id: string, at: Date): Promise<void> {
    const identity = await this.getIdentity(id);
    if (!identity) return;
    await this.saveIdentity({ ...identity, tornDownAt: at.toISOString() });
  }

  deleteIdentitiesByRun(runId: string): Promise<number> {
    return Promise.resolve(Number(this.db.prepare("DELETE FROM identities WHERE run_id = ?").run(runId).changes));
  }

  // ---- memory ------------------------------------------------------------

  getMemory(agentId: string): Promise<Memory | undefined> {
    const row = this.db.prepare("SELECT json FROM memories WHERE agent_id = ?").get(agentId);
    return Promise.resolve(row ? parseRow(MemorySchema, rows([row])[0] as JsonRow) : undefined);
  }

  saveMemory(memory: Memory): Promise<void> {
    const parsed = MemorySchema.parse(memory);
    this.db
      .prepare("INSERT INTO memories (agent_id, json) VALUES (?, ?) ON CONFLICT(agent_id) DO UPDATE SET json = excluded.json")
      .run(parsed.agentId, JSON.stringify(parsed));
    return Promise.resolve();
  }

  // ---- wakes and traces --------------------------------------------------

  saveWake(wake: Wake): Promise<void> {
    const parsed = WakeSchema.parse(wake);
    this.db
      .prepare(
        `INSERT INTO wakes (id, run_id, agent_id, population_id, started_at, cost_usd, json) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET cost_usd = excluded.cost_usd, json = excluded.json`,
      )
      .run(parsed.id, parsed.runId, parsed.agentId, parsed.populationId, parsed.startedAt, parsed.costUsd, JSON.stringify(parsed));
    return Promise.resolve();
  }

  getWake(id: string): Promise<Wake | undefined> {
    const row = this.db.prepare("SELECT json FROM wakes WHERE id = ?").get(id);
    return Promise.resolve(row ? parseRow(WakeSchema, rows([row])[0] as JsonRow) : undefined);
  }

  listWakes(query: WakeQuery = {}): Promise<Wake[]> {
    const where: string[] = [];
    const params: string[] = [];
    if (query.runIds?.length) {
      where.push(`run_id IN (${query.runIds.map(() => "?").join(",")})`);
      params.push(...query.runIds);
    }
    if (query.agentId) {
      where.push("agent_id = ?");
      params.push(query.agentId);
    }
    if (query.since) {
      where.push("started_at >= ?");
      params.push(query.since.toISOString());
    }
    if (query.until) {
      where.push("started_at <= ?");
      params.push(query.until.toISOString());
    }
    const sql = `SELECT json FROM wakes ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY started_at`;
    return Promise.resolve(rows(this.db.prepare(sql).all(...params)).map((r) => parseRow(WakeSchema, r)));
  }

  appendTraceEvent(event: TraceEvent): Promise<void> {
    const parsed = TraceEventSchema.parse(event);
    this.db.prepare("INSERT INTO trace_events (wake_id, seq, json) VALUES (?, ?, ?)").run(parsed.wakeId, parsed.seq, JSON.stringify(parsed));
    return Promise.resolve();
  }

  getTrace(wakeId: string): Promise<TraceEvent[]> {
    const result = this.db.prepare("SELECT json FROM trace_events WHERE wake_id = ? ORDER BY seq").all(wakeId);
    return Promise.resolve(rows(result).map((r) => parseRow(TraceEventSchema, r)));
  }

  deleteWakesByRun(runId: string): Promise<number> {
    this.db.prepare("DELETE FROM trace_events WHERE wake_id IN (SELECT id FROM wakes WHERE run_id = ?)").run(runId);
    return Promise.resolve(Number(this.db.prepare("DELETE FROM wakes WHERE run_id = ?").run(runId).changes));
  }

  // ---- findings ----------------------------------------------------------

  saveFinding(finding: Finding): Promise<void> {
    const parsed = FindingSchema.parse(finding);
    this.db
      .prepare(
        `INSERT INTO findings (id, run_id, wake_id, kind, created_at, verified, json) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET verified = excluded.verified, json = excluded.json`,
      )
      .run(parsed.id, parsed.runId, parsed.wakeId, parsed.kind, parsed.createdAt, parsed.verification ? 1 : 0, JSON.stringify(parsed));
    return Promise.resolve();
  }

  getFinding(id: string): Promise<Finding | undefined> {
    const row = this.db.prepare("SELECT json FROM findings WHERE id = ?").get(id);
    return Promise.resolve(row ? parseRow(FindingSchema, rows([row])[0] as JsonRow) : undefined);
  }

  listFindings(query: FindingQuery = {}): Promise<Finding[]> {
    const where: string[] = [];
    const params: string[] = [];
    if (query.runIds?.length) {
      where.push(`run_id IN (${query.runIds.map(() => "?").join(",")})`);
      params.push(...query.runIds);
    }
    if (query.kinds?.length) {
      where.push(`kind IN (${query.kinds.map(() => "?").join(",")})`);
      params.push(...query.kinds);
    }
    if (query.since) {
      where.push("created_at >= ?");
      params.push(query.since.toISOString());
    }
    if (query.until) {
      where.push("created_at <= ?");
      params.push(query.until.toISOString());
    }
    if (query.unverifiedOnly) where.push("verified = 0");
    const sql = `SELECT json FROM findings ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at`;
    return Promise.resolve(rows(this.db.prepare(sql).all(...params)).map((r) => parseRow(FindingSchema, r)));
  }

  async saveVerification(findingId: string, verification: Verification): Promise<void> {
    const finding = await this.getFinding(findingId);
    if (!finding) throw new Error(`finding ${findingId} not found`);
    await this.saveFinding({ ...finding, verification });
  }

  deleteFindingsByRun(runId: string): Promise<number> {
    return Promise.resolve(Number(this.db.prepare("DELETE FROM findings WHERE run_id = ?").run(runId).changes));
  }

  // ---- guardrail support -------------------------------------------------

  costSince(populationId: string, since: Date): Promise<number> {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM wakes WHERE population_id = ? AND started_at >= ?")
      .get(populationId, since.toISOString());
    // eslint-disable-next-line no-restricted-syntax -- aggregate row from node:sqlite.
    const total = (row as unknown as { total: number } | undefined)?.total ?? 0;
    return Promise.resolve(total);
  }

  setKillSwitch(engaged: boolean, reason = ""): Promise<void> {
    const value = JSON.stringify({ engaged, reason, at: new Date().toISOString() });
    this.db.prepare("INSERT INTO control (key, value) VALUES ('kill', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(value);
    return Promise.resolve();
  }

  getKillSwitch(): Promise<{ engaged: boolean; reason: string | null; at: string | null }> {
    const row = this.db.prepare("SELECT value AS json FROM control WHERE key = 'kill'").get();
    if (!row) return Promise.resolve({ engaged: false, reason: null, at: null });
    // eslint-disable-next-line no-restricted-syntax -- control row is a tiny JSON blob written by setKillSwitch.
    const parsed = JSON.parse((row as unknown as JsonRow).json) as { engaged: boolean; reason: string; at: string };
    return Promise.resolve({ engaged: parsed.engaged, reason: parsed.reason || null, at: parsed.at });
  }

  // ---- runs --------------------------------------------------------------

  listRunIds(): Promise<string[]> {
    const result = this.db.prepare("SELECT DISTINCT run_id AS json FROM agents UNION SELECT DISTINCT run_id FROM wakes UNION SELECT DISTINCT run_id FROM findings").all();
    return Promise.resolve(rows(result).map((r) => r.json));
  }

  close(): Promise<void> {
    this.db.close();
    return Promise.resolve();
  }
}

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  AgentSchema,
  ConfigRevisionSchema,
  ConfigSnapshotSchema,
  EventSchema,
  FindingSchema,
  JobSchema,
  ProjectSchema,
  RunSchema,
  StoredPersonaSchema,
  StoredPopulationSchema,
  StoredSettingsSchema,
  StoredTargetSchema,
  IdentitySchema,
  MemorySchema,
  TraceEventSchema,
  WakeSchema,
  type Agent,
  type Finding,
  type FindingQuery,
  type ConfigRevision,
  type ConfigSnapshot,
  type Event,
  type EventInput,
  type EventQuery,
  type Identity,
  type Job,
  type Memory,
  type Project,
  type Run,
  type Store,
  type StoredPersona,
  type StoredPopulation,
  type StoredSettings,
  type StoredTarget,
  type TraceEvent,
  type Verification,
  type Wake,
  type WakeQuery,
} from "@populace/core";
import type { z } from "zod";
import { applyMigrations } from "./migrations.js";

/**
 * `memories` was keyed by agent alone, so memory leaked across runs and `--new-run` was not
 * a clean slate. There is no migration framework here and the old rows are exactly the mixture
 * this change exists to remove, so an old table is dropped rather than migrated.
 */
function dropPreRunScopedMemories(db: DatabaseSync): void {
  const present = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memories'").get();
  if (!present) return;
  const columns = db.prepare("SELECT name FROM pragma_table_info('memories')").all();
  // eslint-disable-next-line no-restricted-syntax -- SQLite pragma rows are untyped at this boundary.
  const hasRunId = (columns as { name?: unknown }[]).some((c) => c.name === "run_id");
  if (!hasRunId) db.exec("DROP TABLE memories");
}

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
CREATE TABLE IF NOT EXISTS memories (run_id TEXT NOT NULL, agent_id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (run_id, agent_id));
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
    dropPreRunScopedMemories(this.db);
    this.db.exec(SCHEMA);
    // `SCHEMA` creates the M1 shape; everything after it is a versioned forward step, so an
    // existing database and a fresh one converge here (`DATA-MODEL.md` §11).
    applyMigrations(this.db, (line) => console.warn(`populace store: ${line}`));
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
    this.db.prepare("DELETE FROM memories WHERE run_id = ?").run(runId);
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

  getMemory(runId: string, agentId: string): Promise<Memory | undefined> {
    const row = this.db.prepare("SELECT json FROM memories WHERE run_id = ? AND agent_id = ?").get(runId, agentId);
    return Promise.resolve(row ? parseRow(MemorySchema, rows([row])[0] as JsonRow) : undefined);
  }

  saveMemory(memory: Memory): Promise<void> {
    const parsed = MemorySchema.parse(memory);
    this.db
      .prepare("INSERT INTO memories (run_id, agent_id, json) VALUES (?, ?, ?) ON CONFLICT(run_id, agent_id) DO UPDATE SET json = excluded.json")
      .run(parsed.runId, parsed.agentId, JSON.stringify(parsed));
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
    // A limit takes the newest rows in the database and hands them back oldest-first, so a caller
    // never loads the whole table to keep the tail of it.
    const clause = `SELECT json FROM wakes ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`;
    if (query.limit === undefined) {
      const sql = `${clause} ORDER BY started_at, rowid`;
      return Promise.resolve(rows(this.db.prepare(sql).all(...params)).map((r) => parseRow(WakeSchema, r)));
    }
    const sql = `${clause} ORDER BY started_at DESC, rowid DESC LIMIT ?`;
    const newest = rows(this.db.prepare(sql).all(...params, Math.max(0, query.limit))).map((r) => parseRow(WakeSchema, r));
    return Promise.resolve(newest.reverse());
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
    // `created_at` alone is not a total order: several findings of one wake are filed in the same
    // millisecond, and SQLite is free to return tied rows in any order. That matters because the
    // verifier replays findings in this order against the live target, and a replay can write —
    // so a tie decided differently between two runs changes what the next replay sees. `rowid` is
    // insertion order, which makes "the order they were filed" the order they come back in.
    const sql = `SELECT json FROM findings ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at, rowid`;
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

  getControl(key: string): Promise<string | undefined> {
    const row = this.db.prepare("SELECT value AS json FROM control WHERE key = ?").get(key);
    return Promise.resolve(row ? (rows([row])[0] as JsonRow).json : undefined);
  }

  setControl(key: string, value: string): Promise<void> {
    this.db.prepare("INSERT INTO control (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
    return Promise.resolve();
  }

  deleteControl(key: string): Promise<void> {
    this.db.prepare("DELETE FROM control WHERE key = ?").run(key);
    return Promise.resolve();
  }

  // ---- runs --------------------------------------------------------------

  listRunIds(): Promise<string[]> {
    const result = this.db
      .prepare("SELECT DISTINCT run_id AS json FROM agents UNION SELECT DISTINCT run_id FROM wakes UNION SELECT DISTINCT run_id FROM findings UNION SELECT DISTINCT id FROM runs")
      .all();
    return Promise.resolve(rows(result).map((r) => r.json));
  }

  saveRun(run: Run): Promise<void> {
    const parsed = RunSchema.parse(run);
    this.db
      .prepare(
        `INSERT INTO runs (id, project_id, population_id, status, parent_run_id, started_at, json) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, population_id = excluded.population_id, status = excluded.status,
           parent_run_id = excluded.parent_run_id, started_at = excluded.started_at, json = excluded.json`,
      )
      .run(parsed.id, parsed.projectId, parsed.populationId, parsed.status, parsed.parentRunId, parsed.startedAt, JSON.stringify(parsed));
    return Promise.resolve();
  }

  getRun(id: string): Promise<Run | undefined> {
    const row = this.db.prepare("SELECT json FROM runs WHERE id = ?").get(id);
    return Promise.resolve(row ? parseRow(RunSchema, rows([row])[0] as JsonRow) : undefined);
  }

  listRuns(filter: { projectId?: string; status?: Run["status"] } = {}): Promise<Run[]> {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.projectId) {
      where.push("project_id = ?");
      params.push(filter.projectId);
    }
    if (filter.status) {
      where.push("status = ?");
      params.push(filter.status);
    }
    const sql = `SELECT json FROM runs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC`;
    return Promise.resolve(rows(this.db.prepare(sql).all(...params)).map((r) => parseRow(RunSchema, r)));
  }

  deleteRun(id: string): Promise<void> {
    this.db.prepare("DELETE FROM runs WHERE id = ?").run(id);
    this.db.prepare("DELETE FROM events WHERE run_id = ?").run(id);
    return Promise.resolve();
  }

  // ---- config snapshots --------------------------------------------------

  saveConfigSnapshot(snapshot: ConfigSnapshot): Promise<void> {
    const parsed = ConfigSnapshotSchema.parse(snapshot);
    // Snapshots are immutable: an id that already exists is the same content by construction, so
    // a re-insert is a no-op rather than an update.
    this.db
      .prepare("INSERT INTO config_snapshots (id, hash, created_at, json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
      .run(parsed.id, parsed.hash, parsed.createdAt, JSON.stringify(parsed));
    return Promise.resolve();
  }

  getConfigSnapshot(id: string): Promise<ConfigSnapshot | undefined> {
    const row = this.db.prepare("SELECT json FROM config_snapshots WHERE id = ?").get(id);
    return Promise.resolve(row ? parseRow(ConfigSnapshotSchema, rows([row])[0] as JsonRow) : undefined);
  }

  findConfigSnapshotByHash(hash: string): Promise<ConfigSnapshot | undefined> {
    const row = this.db.prepare("SELECT json FROM config_snapshots WHERE hash = ? ORDER BY created_at LIMIT 1").get(hash);
    return Promise.resolve(row ? parseRow(ConfigSnapshotSchema, rows([row])[0] as JsonRow) : undefined);
  }

  // ---- authored config ---------------------------------------------------

  saveProject(project: Project): Promise<void> {
    const parsed = ProjectSchema.parse(project);
    this.db.prepare("INSERT INTO projects (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json").run(parsed.id, JSON.stringify(parsed));
    return Promise.resolve();
  }

  getProject(id: string): Promise<Project | undefined> {
    const row = this.db.prepare("SELECT json FROM projects WHERE id = ?").get(id);
    return Promise.resolve(row ? parseRow(ProjectSchema, rows([row])[0] as JsonRow) : undefined);
  }

  listProjects(): Promise<Project[]> {
    return Promise.resolve(rows(this.db.prepare("SELECT json FROM projects ORDER BY id").all()).map((r) => parseRow(ProjectSchema, r)));
  }

  saveTarget(target: StoredTarget): Promise<void> {
    const parsed = StoredTargetSchema.parse(target);
    this.db
      .prepare(
        `INSERT INTO targets (id, project_id, name, updated_at, json) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, name = excluded.name, updated_at = excluded.updated_at, json = excluded.json`,
      )
      .run(parsed.id, parsed.projectId, parsed.name, parsed.updatedAt, JSON.stringify(parsed));
    return Promise.resolve();
  }

  getTarget(id: string): Promise<StoredTarget | undefined> {
    const row = this.db.prepare("SELECT json FROM targets WHERE id = ?").get(id);
    return Promise.resolve(row ? parseRow(StoredTargetSchema, rows([row])[0] as JsonRow) : undefined);
  }

  listTargets(projectId?: string): Promise<StoredTarget[]> {
    const sql = `SELECT json FROM targets ${projectId ? "WHERE project_id = ?" : ""} ORDER BY updated_at DESC`;
    const result = projectId ? this.db.prepare(sql).all(projectId) : this.db.prepare(sql).all();
    return Promise.resolve(rows(result).map((r) => parseRow(StoredTargetSchema, r)));
  }

  deleteTarget(id: string): Promise<void> {
    this.db.prepare("DELETE FROM targets WHERE id = ?").run(id);
    return Promise.resolve();
  }

  savePersona(persona: StoredPersona): Promise<void> {
    const parsed = StoredPersonaSchema.parse(persona);
    this.db
      .prepare(
        `INSERT INTO personas (id, project_id, slug, origin, updated_at, json) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, origin = excluded.origin, updated_at = excluded.updated_at, json = excluded.json`,
      )
      .run(parsed.id, parsed.projectId, parsed.slug, parsed.origin, parsed.updatedAt, JSON.stringify(parsed));
    return Promise.resolve();
  }

  getPersona(id: string): Promise<StoredPersona | undefined> {
    const row = this.db.prepare("SELECT json FROM personas WHERE id = ?").get(id);
    return Promise.resolve(row ? parseRow(StoredPersonaSchema, rows([row])[0] as JsonRow) : undefined);
  }

  listPersonas(projectId?: string): Promise<StoredPersona[]> {
    const sql = `SELECT json FROM personas ${projectId ? "WHERE project_id = ?" : ""} ORDER BY slug`;
    const result = projectId ? this.db.prepare(sql).all(projectId) : this.db.prepare(sql).all();
    return Promise.resolve(rows(result).map((r) => parseRow(StoredPersonaSchema, r)));
  }

  deletePersona(id: string): Promise<void> {
    this.db.prepare("DELETE FROM personas WHERE id = ?").run(id);
    return Promise.resolve();
  }

  savePopulation(population: StoredPopulation): Promise<void> {
    const parsed = StoredPopulationSchema.parse(population);
    this.db
      .prepare(
        `INSERT INTO populations (id, project_id, slug, updated_at, json) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, updated_at = excluded.updated_at, json = excluded.json`,
      )
      .run(parsed.id, parsed.projectId, parsed.slug, parsed.updatedAt, JSON.stringify(parsed));
    return Promise.resolve();
  }

  getPopulation(id: string): Promise<StoredPopulation | undefined> {
    const row = this.db.prepare("SELECT json FROM populations WHERE id = ?").get(id);
    return Promise.resolve(row ? parseRow(StoredPopulationSchema, rows([row])[0] as JsonRow) : undefined);
  }

  listPopulations(projectId?: string): Promise<StoredPopulation[]> {
    const sql = `SELECT json FROM populations ${projectId ? "WHERE project_id = ?" : ""} ORDER BY slug`;
    const result = projectId ? this.db.prepare(sql).all(projectId) : this.db.prepare(sql).all();
    return Promise.resolve(rows(result).map((r) => parseRow(StoredPopulationSchema, r)));
  }

  deletePopulation(id: string): Promise<void> {
    this.db.prepare("DELETE FROM populations WHERE id = ?").run(id);
    return Promise.resolve();
  }

  saveSettings(settings: StoredSettings): Promise<void> {
    const parsed = StoredSettingsSchema.parse(settings);
    this.db.prepare("INSERT INTO settings (project_id, json) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET json = excluded.json").run(parsed.projectId, JSON.stringify(parsed));
    return Promise.resolve();
  }

  getSettings(projectId: string): Promise<StoredSettings | undefined> {
    const row = this.db.prepare("SELECT json FROM settings WHERE project_id = ?").get(projectId);
    return Promise.resolve(row ? parseRow(StoredSettingsSchema, rows([row])[0] as JsonRow) : undefined);
  }

  // ---- config history ----------------------------------------------------

  saveConfigRevision(revision: ConfigRevision): Promise<void> {
    const parsed = ConfigRevisionSchema.parse(revision);
    // Revisions are immutable, so an id that exists already is the same content by construction.
    this.db
      .prepare("INSERT INTO config_revisions (id, project_id, at, source, summary, json) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
      .run(parsed.id, parsed.projectId, parsed.at, parsed.source, parsed.summary, JSON.stringify(parsed));
    return Promise.resolve();
  }

  getConfigRevision(id: string): Promise<ConfigRevision | undefined> {
    const row = this.db.prepare("SELECT json FROM config_revisions WHERE id = ?").get(id);
    return Promise.resolve(row ? parseRow(ConfigRevisionSchema, rows([row])[0] as JsonRow) : undefined);
  }

  listConfigRevisions(projectId: string, limit = 100): Promise<ConfigRevision[]> {
    // Newest first: history is read from the present backwards. Two revisions written in the same
    // millisecond have the same `at`, so the implicit rowid — insertion order — is what decides,
    // and an edit never appears above the undo point taken just before it.
    const result = this.db.prepare("SELECT json FROM config_revisions WHERE project_id = ? ORDER BY at DESC, rowid DESC LIMIT ?").all(projectId, limit);
    return Promise.resolve(rows(result).map((r) => parseRow(ConfigRevisionSchema, r)));
  }

  pruneConfigRevisions(projectId: string, keepLast: number): Promise<number> {
    const result = this.db
      .prepare(
        `DELETE FROM config_revisions WHERE project_id = ? AND id NOT IN (
           SELECT id FROM config_revisions WHERE project_id = ? ORDER BY at DESC, rowid DESC LIMIT ?
         )`,
      )
      .run(projectId, projectId, Math.max(0, keepLast));
    return Promise.resolve(Number(result.changes));
  }

  // ---- event log ---------------------------------------------------------

  appendEvent(event: EventInput): Promise<Event> {
    const at = event.at ?? new Date().toISOString();
    const result = this.db
      .prepare("INSERT INTO events (at, run_id, wake_id, type, payload) VALUES (?, ?, ?, ?, ?)")
      .run(at, event.runId, event.wakeId, event.type, JSON.stringify(event.payload));
    return Promise.resolve(EventSchema.parse({ ...event, at, seq: Number(result.lastInsertRowid) }));
  }

  listEvents(query: EventQuery = {}): Promise<Event[]> {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (query.afterSeq !== undefined) {
      where.push("seq > ?");
      params.push(query.afterSeq);
    }
    if (query.runId !== undefined) {
      where.push("run_id = ?");
      params.push(query.runId);
    }
    if (query.types?.length) {
      where.push(`type IN (${query.types.map(() => "?").join(",")})`);
      params.push(...query.types);
    }
    const sql = `SELECT seq, at, run_id, wake_id, type, payload FROM events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY seq LIMIT ?`;
    const result = this.db.prepare(sql).all(...params, query.limit ?? 500);
    // eslint-disable-next-line no-restricted-syntax -- SQLite boundary: every row is zod-parsed on the next line.
    const raw = result as unknown as { seq: number; at: string; run_id: string | null; wake_id: string | null; type: string; payload: string }[];
    // eslint-disable-next-line no-restricted-syntax -- the payload column is JSON text written by appendEvent.
    return Promise.resolve(raw.map((r) => EventSchema.parse({ seq: r.seq, at: r.at, runId: r.run_id, wakeId: r.wake_id, type: r.type, payload: JSON.parse(r.payload) as unknown })));
  }

  latestEventSeq(): Promise<number> {
    const row = this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS total FROM events").get();
    // eslint-disable-next-line no-restricted-syntax -- aggregate row from node:sqlite.
    return Promise.resolve((row as unknown as { total: number } | undefined)?.total ?? 0);
  }

  truncateEvents(keepLast: number): Promise<number> {
    const result = this.db.prepare("DELETE FROM events WHERE seq <= (SELECT COALESCE(MAX(seq), 0) - ? FROM events)").run(keepLast);
    return Promise.resolve(Number(result.changes));
  }

  // ---- jobs --------------------------------------------------------------

  saveJob(job: Job): Promise<void> {
    const parsed = JobSchema.parse(job);
    this.db
      .prepare(
        `INSERT INTO jobs (id, kind, status, run_id, created_at, json) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, run_id = excluded.run_id, json = excluded.json`,
      )
      .run(parsed.id, parsed.kind, parsed.status, parsed.runId, parsed.createdAt, JSON.stringify(parsed));
    return Promise.resolve();
  }

  getJob(id: string): Promise<Job | undefined> {
    const row = this.db.prepare("SELECT json FROM jobs WHERE id = ?").get(id);
    return Promise.resolve(row ? parseRow(JobSchema, rows([row])[0] as JsonRow) : undefined);
  }

  listJobs(filter: { status?: Job["status"]; runId?: string; limit?: number } = {}): Promise<Job[]> {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.status) {
      where.push("status = ?");
      params.push(filter.status);
    }
    if (filter.runId) {
      where.push("run_id = ?");
      params.push(filter.runId);
    }
    const sql = `SELECT json FROM jobs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`;
    return Promise.resolve(rows(this.db.prepare(sql).all(...params, filter.limit ?? 100)).map((r) => parseRow(JobSchema, r)));
  }

  close(): Promise<void> {
    this.db.close();
    return Promise.resolve();
  }
}

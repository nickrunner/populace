import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  AgentSchema,
  CohortSchema,
  ConfigSnapshotSchema,
  EventSchema,
  FindingSchema,
  JobSchema,
  PersonSchema,
  ProjectSchema,
  ReferencedError,
  RunSchema,
  SimulationSchema,
  TriageSchema,
  StoredPersonaSchema,
  StoredPopulationSchema,
  StoredSettingsSchema,
  StoredTargetSchema,
  IdentitySchema,
  MemorySchema,
  TraceEventSchema,
  WakeSchema,
  type Agent,
  type AgentQuery,
  type Cohort,
  type CostKind,
  type CostQuery,
  type Finding,
  type FindingQuery,
  type ConfigSnapshot,
  type Event,
  type EventInput,
  type EventQuery,
  type Identity,
  type Job,
  type Memory,
  type Person,
  type PersonQuery,
  type Project,
  type Run,
  type Simulation,
  type SimulationQuery,
  type Store,
  type StoredPersona,
  type StoredPopulation,
  type StoredSettings,
  type StoredTarget,
  type TraceEvent,
  type Triage,
  type Verification,
  type Wake,
  type WakeQuery,
} from "@populace/core";
import type { z } from "zod";

/**
 * Every table, in one constant. There is no migration framework and no `schema_version`: the
 * ordered forward-migration runner that used to live in `migrations.ts` was deleted because
 * nothing outside this repo holds a row yet, and an ordered list of steps whose first step is
 * "create the world" is ceremony, not safety.
 *
 * What replaces it is `SCHEMA_SHAPE` below: a constant baked into this source and written to
 * `control`. When it differs from what a database was written with, every table is dropped and
 * recreated. That promise ends at first real use — the first time a database outside this repo
 * holds a target somebody typed, this path is replaced by the forward-migration runner and the
 * deleted file is the starting point (ADR-0011 amendment).
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS control (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Produced rows -----------------------------------------------------------

/*
 * PRIMARY KEY (run_id, id), not id alone. An agent id is \`populationSlug/cohortSlug#ordinal\` and
 * repeats between executions of one simulation by design; keyed by id alone, a second run silently
 * rewrote the first run's participants and its memory joins went nowhere.
 */
CREATE TABLE IF NOT EXISTS agents (
  run_id TEXT NOT NULL, id TEXT NOT NULL, simulation_id TEXT NOT NULL, population_id TEXT NOT NULL,
  cohort_slug TEXT NOT NULL, person_id TEXT NOT NULL, status TEXT NOT NULL, next_wake_at TEXT,
  json TEXT NOT NULL, PRIMARY KEY (run_id, id)
);
CREATE INDEX IF NOT EXISTS agents_due ON agents(run_id, status, next_wake_at, id);
CREATE INDEX IF NOT EXISTS agents_run_cohort ON agents(run_id, cohort_slug);

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
CREATE INDEX IF NOT EXISTS wakes_run_agent_started ON wakes(run_id, agent_id, started_at);

CREATE TABLE IF NOT EXISTS trace_events (
  wake_id TEXT NOT NULL, seq INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (wake_id, seq)
);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, wake_id TEXT NOT NULL, kind TEXT NOT NULL,
  signature TEXT NOT NULL, created_at TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS findings_created ON findings(created_at);
CREATE INDEX IF NOT EXISTS findings_run_kind ON findings(run_id, kind);
CREATE INDEX IF NOT EXISTS findings_signature ON findings(signature);

-- Authored rows -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, json TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS targets (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL,
  updated_at TEXT NOT NULL, json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS targets_project ON targets(project_id);
/* The slug is the immutable URL segment (SPEC §2.2), so it has to identify exactly one row. */
CREATE UNIQUE INDEX IF NOT EXISTS targets_slug ON targets(project_id, slug);

CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, slug TEXT NOT NULL, origin TEXT NOT NULL,
  updated_at TEXT NOT NULL, json TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS personas_slug ON personas(project_id, slug);

CREATE TABLE IF NOT EXISTS cohorts (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, slug TEXT NOT NULL, persona_id TEXT NOT NULL,
  size INTEGER NOT NULL, updated_at TEXT NOT NULL, json TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cohorts_slug ON cohorts(project_id, slug);
CREATE INDEX IF NOT EXISTS cohorts_persona ON cohorts(persona_id);

/* A person id is \`cohortSlug#ordinal\` and is unique within a project, not globally. */
CREATE TABLE IF NOT EXISTS people (
  project_id TEXT NOT NULL, id TEXT NOT NULL, cohort_id TEXT NOT NULL, cohort_slug TEXT NOT NULL,
  persona_id TEXT NOT NULL, ordinal INTEGER NOT NULL, archived_at TEXT, updated_at TEXT NOT NULL,
  json TEXT NOT NULL, PRIMARY KEY (project_id, id)
);
CREATE INDEX IF NOT EXISTS people_cohort_ordinal ON people(cohort_id, ordinal);

CREATE TABLE IF NOT EXISTS populations (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, slug TEXT NOT NULL, updated_at TEXT NOT NULL, json TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS populations_slug ON populations(project_id, slug);

CREATE TABLE IF NOT EXISTS simulations (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, slug TEXT NOT NULL, population_id TEXT NOT NULL,
  target_id TEXT NOT NULL, mode TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL, json TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS simulations_slug ON simulations(project_id, slug);
CREATE INDEX IF NOT EXISTS simulations_population ON simulations(population_id);
CREATE INDEX IF NOT EXISTS simulations_target ON simulations(target_id);

CREATE TABLE IF NOT EXISTS triage (
  project_id TEXT NOT NULL, signature TEXT NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL,
  json TEXT NOT NULL, PRIMARY KEY (project_id, signature)
);

CREATE TABLE IF NOT EXISTS settings (project_id TEXT PRIMARY KEY, json TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS config_snapshots (
  id TEXT PRIMARY KEY, hash TEXT NOT NULL, created_at TEXT NOT NULL, json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS config_snapshots_hash ON config_snapshots(hash);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, simulation_id TEXT NOT NULL, seq INTEGER NOT NULL,
  population_id TEXT NOT NULL, status TEXT NOT NULL, parent_run_id TEXT, started_at TEXT,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_project_status ON runs(project_id, status);
CREATE INDEX IF NOT EXISTS runs_parent ON runs(parent_run_id);
CREATE INDEX IF NOT EXISTS runs_simulation ON runs(simulation_id, seq);

CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, project_id TEXT, simulation_id TEXT,
  run_id TEXT, wake_id TEXT, type TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_run ON events(run_id, seq);
CREATE INDEX IF NOT EXISTS events_project ON events(project_id, seq);

/*
 * \`cost_usd\` is lifted out of the blob because it is read as a SUM: a job that writes a cohort's
 * people spends real money outside any wake, and \`costSince\` adds it to what the visits cost to
 * answer one question about a project's day (SPEC §5.4).
 */
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, project_id TEXT, run_id TEXT,
  created_at TEXT NOT NULL, cost_usd REAL NOT NULL DEFAULT 0, json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, created_at);
CREATE INDEX IF NOT EXISTS jobs_project_created ON jobs(project_id, created_at);
`;

/**
 * Bump this whenever any table above changes shape. It is compared against what the database was
 * written with; a mismatch rebuilds the file from scratch.
 */
const SCHEMA_SHAPE = "m3.projects-simulations-cohorts-people.3";
const SHAPE_KEY = "schema_shape";
const REBUILT_WARNING = "populace store: the schema changed; this database was rebuilt from scratch and its runs are gone.";

function tableNames(db: DatabaseSync): string[] {
  const result = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  // eslint-disable-next-line no-restricted-syntax -- sqlite_master rows are untyped at this boundary.
  return (result as { name?: unknown }[]).flatMap((r) => (typeof r.name === "string" ? [r.name] : []));
}

function sumOf(db: DatabaseSync, sql: string, ...params: string[]): number {
  const row = db.prepare(sql).get(...params);
  // eslint-disable-next-line no-restricted-syntax -- aggregate row from node:sqlite.
  const total = (row as { total?: unknown } | undefined)?.total;
  return typeof total === "number" ? total : 0;
}

/** `SELECT COUNT(*) AS n …`, which node:sqlite hands back as a loosely typed row. */
function countOf(db: DatabaseSync, sql: string, ...params: string[]): number {
  const row = db.prepare(sql).get(...params);
  // eslint-disable-next-line no-restricted-syntax -- aggregate row from node:sqlite.
  const n = (row as { n?: unknown } | undefined)?.n;
  return typeof n === "number" ? n : 0;
}

function recordedShape(db: DatabaseSync): string | null {
  if (!tableNames(db).includes("control")) return null;
  const row = db.prepare("SELECT value FROM control WHERE key = ?").get(SHAPE_KEY);
  if (!row) return null;
  // eslint-disable-next-line no-restricted-syntax -- control row written only by this file.
  const value = (row as { value?: unknown }).value;
  return typeof value === "string" ? value : null;
}

/**
 * Greenfield, deliberately (SPEC §3.2). A database whose recorded shape is not this build's is
 * emptied rather than migrated, and the one line of warning is the whole user-facing story.
 */
function applySchema(db: DatabaseSync, warn: (line: string) => void): void {
  const recorded = recordedShape(db);
  if (recorded === SCHEMA_SHAPE) {
    db.exec(SCHEMA);
    return;
  }
  const existing = tableNames(db);
  // A fresh file has no tables at all. Anything else was written by a different shape.
  const hadData = existing.some((name) => name !== "control") || (existing.includes("control") && countOf(db, "SELECT COUNT(*) AS n FROM control") > 0);
  if (hadData) {
    for (const name of existing) db.exec(`DROP TABLE IF EXISTS "${name}"`);
    warn(REBUILT_WARNING);
  }
  db.exec(SCHEMA);
  db.prepare("INSERT INTO control (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SHAPE_KEY, SCHEMA_SHAPE);
}

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

  constructor(path: string, warn: (line: string) => void = (line) => console.warn(line)) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    applySchema(this.db, warn);
  }

  static open(path: string, warn?: (line: string) => void): SqliteStore {
    return new SqliteStore(path, warn);
  }

  // ---- agents ------------------------------------------------------------

  upsertAgent(agent: Agent): Promise<void> {
    const parsed = AgentSchema.parse(agent);
    this.db
      .prepare(
        `INSERT INTO agents (run_id, id, simulation_id, population_id, cohort_slug, person_id, status, next_wake_at, json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, id) DO UPDATE SET simulation_id = excluded.simulation_id, population_id = excluded.population_id,
           cohort_slug = excluded.cohort_slug, person_id = excluded.person_id, status = excluded.status,
           next_wake_at = excluded.next_wake_at, json = excluded.json`,
      )
      .run(parsed.runId, parsed.id, parsed.simulationId, parsed.populationId, parsed.cohortSlug, parsed.personId, parsed.status, parsed.nextWakeAt, JSON.stringify(parsed));
    return Promise.resolve();
  }

  getAgent(runId: string, id: string): Promise<Agent | undefined> {
    const row = this.db.prepare("SELECT json FROM agents WHERE run_id = ? AND id = ?").get(runId, id);
    return Promise.resolve(row ? parseRow(AgentSchema, rows([row])[0] as JsonRow) : undefined);
  }

  listAgents(filter: AgentQuery): Promise<Agent[]> {
    const where = ["run_id = ?"];
    const params: string[] = [filter.runId];
    if (filter.simulationId) {
      where.push("simulation_id = ?");
      params.push(filter.simulationId);
    }
    if (filter.cohortSlug) {
      where.push("cohort_slug = ?");
      params.push(filter.cohortSlug);
    }
    if (filter.status) {
      where.push("status = ?");
      params.push(filter.status);
    }
    const sql = `SELECT json FROM agents WHERE ${where.join(" AND ")} ORDER BY id`;
    return Promise.resolve(rows(this.db.prepare(sql).all(...params)).map((r) => parseRow(AgentSchema, r)));
  }

  /**
   * Scoped to one run. Without the run predicate a second daemon in the same process claimed the
   * first run's agents, which pause/resume and several simulations per project make reachable.
   * `id` breaks the `next_wake_at` tie so a claim is a total order, not a coin toss.
   */
  listDueAgents(runId: string, now: Date, limit: number): Promise<Agent[]> {
    const result = this.db
      .prepare(
        `SELECT json FROM agents WHERE run_id = ? AND status = 'active' AND next_wake_at IS NOT NULL AND next_wake_at <= ?
         ORDER BY next_wake_at, id LIMIT ?`,
      )
      .all(runId, now.toISOString(), limit);
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
    const sql = `SELECT json FROM wakes ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY started_at, rowid`;
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

  /**
   * Chunked because SQLite caps the number of bound parameters in one statement, not because the
   * caller should think about it: what matters to a read model is that this is a fixed handful of
   * round trips however many participants an execution had.
   */
  getTraces(wakeIds: string[]): Promise<TraceEvent[]> {
    const out: TraceEvent[] = [];
    for (let i = 0; i < wakeIds.length; i += 400) {
      const chunk = wakeIds.slice(i, i + 400);
      if (chunk.length === 0) continue;
      const sql = `SELECT json FROM trace_events WHERE wake_id IN (${chunk.map(() => "?").join(",")}) ORDER BY wake_id, seq`;
      for (const row of rows(this.db.prepare(sql).all(...chunk))) out.push(parseRow(TraceEventSchema, row));
    }
    return Promise.resolve(out);
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
        `INSERT INTO findings (id, run_id, wake_id, kind, signature, created_at, verified, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET signature = excluded.signature, verified = excluded.verified, json = excluded.json`,
      )
      .run(parsed.id, parsed.runId, parsed.wakeId, parsed.kind, parsed.signature, parsed.createdAt, parsed.verification ? 1 : 0, JSON.stringify(parsed));
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

  costSince(query: CostQuery, since: Date): Promise<number> {
    const at = since.toISOString();
    const wants = (kind: CostKind): boolean => query.kind === undefined || query.kind === kind;
    let total = 0;
    if (wants("visits")) {
      // A wake row carries its population; the project comes from the run it belongs to. Asking by
      // population is the runner's own ceiling and stays exactly the query it always was.
      if (query.populationId !== undefined) {
        total += sumOf(this.db, "SELECT COALESCE(SUM(cost_usd), 0) AS total FROM wakes WHERE population_id = ? AND started_at >= ?", query.populationId, at);
      } else if (query.projectId !== undefined) {
        total += sumOf(this.db, "SELECT COALESCE(SUM(w.cost_usd), 0) AS total FROM wakes w JOIN runs r ON r.id = w.run_id WHERE r.project_id = ? AND w.started_at >= ?", query.projectId, at);
      }
    }
    // Authoring belongs to a project and to no population, so a population-scoped question sees
    // none of it — which is right: it is not that population's visits.
    if (wants("authoring") && query.projectId !== undefined) {
      total += sumOf(this.db, "SELECT COALESCE(SUM(cost_usd), 0) AS total FROM jobs WHERE project_id = ? AND created_at >= ?", query.projectId, at);
    }
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
        `INSERT INTO runs (id, project_id, simulation_id, seq, population_id, status, parent_run_id, started_at, json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, simulation_id = excluded.simulation_id, seq = excluded.seq,
           population_id = excluded.population_id, status = excluded.status, parent_run_id = excluded.parent_run_id,
           started_at = excluded.started_at, json = excluded.json`,
      )
      .run(parsed.id, parsed.projectId, parsed.simulationId, parsed.seq, parsed.populationId, parsed.status, parsed.parentRunId, parsed.startedAt, JSON.stringify(parsed));
    return Promise.resolve();
  }

  getRun(id: string): Promise<Run | undefined> {
    const row = this.db.prepare("SELECT json FROM runs WHERE id = ?").get(id);
    return Promise.resolve(row ? parseRow(RunSchema, rows([row])[0] as JsonRow) : undefined);
  }

  listRuns(filter: { projectId?: string; simulationId?: string; status?: Run["status"]; parentRunId?: string } = {}): Promise<Run[]> {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.projectId) {
      where.push("project_id = ?");
      params.push(filter.projectId);
    }
    if (filter.simulationId) {
      where.push("simulation_id = ?");
      params.push(filter.simulationId);
    }
    if (filter.status) {
      where.push("status = ?");
      params.push(filter.status);
    }
    // Backed by `runs_parent`: a run's children are an index lookup, not a scan over every
    // other run's agents.
    if (filter.parentRunId) {
      where.push("parent_run_id = ?");
      params.push(filter.parentRunId);
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

  // ---- referential integrity (SPEC §2.14) --------------------------------

  /**
   * One rule, applied in every delete method: an authored row referenced by another authored row
   * cannot be deleted and the refusal NAMES the referrers, so the user is told what to take apart
   * rather than told "no"; a row referenced by a past run is archived instead of deleted.
   */
  private simulationsNaming(column: "target_id" | "population_id", id: string): string[] {
    const result = this.db.prepare(`SELECT json FROM simulations WHERE ${column} = ? ORDER BY slug`).all(id);
    return rows(result).map((r) => `simulation "${parseRow(SimulationSchema, r).name}"`);
  }

  private cohortsNamingPersona(personaId: string): string[] {
    const result = this.db.prepare("SELECT json FROM cohorts WHERE persona_id = ? ORDER BY slug").all(personaId);
    return rows(result).map((r) => `cohort "${parseRow(CohortSchema, r).name}"`);
  }

  private populationsHolding(cohortId: string): string[] {
    const result = this.db.prepare("SELECT json FROM populations ORDER BY slug").all();
    return rows(result)
      .map((r) => parseRow(StoredPopulationSchema, r))
      .filter((population) => population.cohortIds.includes(cohortId))
      .map((population) => `population "${population.name}"`);
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
        `INSERT INTO targets (id, project_id, slug, name, updated_at, json) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, slug = excluded.slug, name = excluded.name,
           updated_at = excluded.updated_at, json = excluded.json`,
      )
      .run(parsed.id, parsed.projectId, parsed.slug, parsed.name, parsed.updatedAt, JSON.stringify(parsed));
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
    const referrers = this.simulationsNaming("target_id", id);
    if (referrers.length) return Promise.reject(new ReferencedError("target", id, referrers));
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
    const referrers = this.cohortsNamingPersona(id);
    if (referrers.length) return Promise.reject(new ReferencedError("persona", id, referrers));
    this.db.prepare("DELETE FROM personas WHERE id = ?").run(id);
    return Promise.resolve();
  }

  saveCohort(cohort: Cohort): Promise<void> {
    const parsed = CohortSchema.parse(cohort);
    this.db
      .prepare(
        `INSERT INTO cohorts (id, project_id, slug, persona_id, size, updated_at, json) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, persona_id = excluded.persona_id, size = excluded.size,
           updated_at = excluded.updated_at, json = excluded.json`,
      )
      .run(parsed.id, parsed.projectId, parsed.slug, parsed.personaId, parsed.size, parsed.updatedAt, JSON.stringify(parsed));
    return Promise.resolve();
  }

  getCohort(id: string): Promise<Cohort | undefined> {
    const row = this.db.prepare("SELECT json FROM cohorts WHERE id = ?").get(id);
    return Promise.resolve(row ? parseRow(CohortSchema, rows([row])[0] as JsonRow) : undefined);
  }

  listCohorts(projectId?: string): Promise<Cohort[]> {
    const sql = `SELECT json FROM cohorts ${projectId ? "WHERE project_id = ?" : ""} ORDER BY slug`;
    const result = projectId ? this.db.prepare(sql).all(projectId) : this.db.prepare(sql).all();
    return Promise.resolve(rows(result).map((r) => parseRow(CohortSchema, r)));
  }

  /**
   * The people are archived, never deleted: past runs' agents name them by `personId`, and growing
   * a cohort back has to meet the same individuals rather than a fresh cast.
   */
  async deleteCohort(id: string): Promise<void> {
    const referrers = this.populationsHolding(id);
    if (referrers.length) throw new ReferencedError("cohort", id, referrers);
    await this.archivePeople(id, new Date());
    this.db.prepare("DELETE FROM cohorts WHERE id = ?").run(id);
  }

  // ---- people ------------------------------------------------------------

  savePerson(person: Person): Promise<void> {
    const parsed = PersonSchema.parse(person);
    this.db
      .prepare(
        `INSERT INTO people (project_id, id, cohort_id, cohort_slug, persona_id, ordinal, archived_at, updated_at, json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, id) DO UPDATE SET cohort_id = excluded.cohort_id, cohort_slug = excluded.cohort_slug,
           persona_id = excluded.persona_id, ordinal = excluded.ordinal, archived_at = excluded.archived_at,
           updated_at = excluded.updated_at, json = excluded.json`,
      )
      .run(parsed.projectId, parsed.id, parsed.cohortId, parsed.cohortSlug, parsed.personaId, parsed.ordinal, parsed.archivedAt, parsed.updatedAt, JSON.stringify(parsed));
    return Promise.resolve();
  }

  getPerson(projectId: string, id: string): Promise<Person | undefined> {
    const row = this.db.prepare("SELECT json FROM people WHERE project_id = ? AND id = ?").get(projectId, id);
    return Promise.resolve(row ? parseRow(PersonSchema, rows([row])[0] as JsonRow) : undefined);
  }

  listPeople(query: PersonQuery = {}): Promise<Person[]> {
    const where: string[] = [];
    const params: string[] = [];
    if (query.projectId) {
      where.push("project_id = ?");
      params.push(query.projectId);
    }
    if (query.cohortId) {
      where.push("cohort_id = ?");
      params.push(query.cohortId);
    }
    if (!query.includeArchived) where.push("archived_at IS NULL");
    const sql = `SELECT json FROM people ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY cohort_slug, ordinal`;
    return Promise.resolve(rows(this.db.prepare(sql).all(...params)).map((r) => parseRow(PersonSchema, r)));
  }

  async archivePeople(cohortId: string, at: Date): Promise<number> {
    const living = await this.listPeople({ cohortId });
    const stamp = at.toISOString();
    for (const person of living) await this.savePerson({ ...person, archivedAt: stamp, updatedAt: stamp });
    return living.length;
  }

  // ---- simulations -------------------------------------------------------

  saveSimulation(simulation: Simulation): Promise<void> {
    const parsed = SimulationSchema.parse(simulation);
    this.db
      .prepare(
        `INSERT INTO simulations (id, project_id, slug, population_id, target_id, mode, archived, updated_at, json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, population_id = excluded.population_id, target_id = excluded.target_id,
           mode = excluded.mode, archived = excluded.archived, updated_at = excluded.updated_at, json = excluded.json`,
      )
      .run(parsed.id, parsed.projectId, parsed.slug, parsed.populationId, parsed.targetId, parsed.mode, parsed.archived ? 1 : 0, parsed.updatedAt, JSON.stringify(parsed));
    return Promise.resolve();
  }

  getSimulation(id: string): Promise<Simulation | undefined> {
    const row = this.db.prepare("SELECT json FROM simulations WHERE id = ?").get(id);
    return Promise.resolve(row ? parseRow(SimulationSchema, rows([row])[0] as JsonRow) : undefined);
  }

  listSimulations(query: SimulationQuery = {}): Promise<Simulation[]> {
    const where: string[] = [];
    const params: string[] = [];
    if (query.projectId) {
      where.push("project_id = ?");
      params.push(query.projectId);
    }
    if (query.populationId) {
      where.push("population_id = ?");
      params.push(query.populationId);
    }
    if (query.targetId) {
      where.push("target_id = ?");
      params.push(query.targetId);
    }
    if (!query.includeArchived) where.push("archived = 0");
    const sql = `SELECT json FROM simulations ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY slug`;
    return Promise.resolve(rows(this.db.prepare(sql).all(...params)).map((r) => parseRow(SimulationSchema, r)));
  }

  /**
   * A simulation that has ever run is the user's history: it is archived, not deleted, and its
   * runs are left exactly where they are.
   */
  async deleteSimulation(id: string): Promise<void> {
    const existing = await this.getSimulation(id);
    if (!existing) return;
    if (countOf(this.db, "SELECT COUNT(*) AS n FROM runs WHERE simulation_id = ?", id) > 0) {
      await this.saveSimulation({ ...existing, archived: true, updatedAt: new Date().toISOString() });
      return;
    }
    this.db.prepare("DELETE FROM simulations WHERE id = ?").run(id);
  }

  // ---- triage ------------------------------------------------------------

  saveTriage(triage: Triage): Promise<void> {
    const parsed = TriageSchema.parse(triage);
    this.db
      .prepare(
        `INSERT INTO triage (project_id, signature, state, updated_at, json) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id, signature) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at, json = excluded.json`,
      )
      .run(parsed.projectId, parsed.signature, parsed.state, parsed.updatedAt, JSON.stringify(parsed));
    return Promise.resolve();
  }

  getTriage(projectId: string, signature: string): Promise<Triage | undefined> {
    const row = this.db.prepare("SELECT json FROM triage WHERE project_id = ? AND signature = ?").get(projectId, signature);
    return Promise.resolve(row ? parseRow(TriageSchema, rows([row])[0] as JsonRow) : undefined);
  }

  listTriage(projectId: string): Promise<Triage[]> {
    const result = this.db.prepare("SELECT json FROM triage WHERE project_id = ? ORDER BY signature").all(projectId);
    return Promise.resolve(rows(result).map((r) => parseRow(TriageSchema, r)));
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
    const referrers = this.simulationsNaming("population_id", id);
    if (referrers.length) return Promise.reject(new ReferencedError("population", id, referrers));
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

  // ---- event log ---------------------------------------------------------

  appendEvent(event: EventInput): Promise<Event> {
    const at = event.at ?? new Date().toISOString();
    const projectId = event.projectId ?? null;
    const simulationId = event.simulationId ?? null;
    const result = this.db
      .prepare("INSERT INTO events (at, project_id, simulation_id, run_id, wake_id, type, payload) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(at, projectId, simulationId, event.runId, event.wakeId, event.type, JSON.stringify(event.payload));
    return Promise.resolve(EventSchema.parse({ ...event, projectId, simulationId, at, seq: Number(result.lastInsertRowid) }));
  }

  listEvents(query: EventQuery = {}): Promise<Event[]> {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (query.afterSeq !== undefined) {
      where.push("seq > ?");
      params.push(query.afterSeq);
    }
    if (query.projectId !== undefined) {
      where.push("project_id = ?");
      params.push(query.projectId);
    }
    if (query.simulationId !== undefined) {
      where.push("simulation_id = ?");
      params.push(query.simulationId);
    }
    if (query.runId !== undefined) {
      where.push("run_id = ?");
      params.push(query.runId);
    }
    if (query.types?.length) {
      where.push(`type IN (${query.types.map(() => "?").join(",")})`);
      params.push(...query.types);
    }
    const sql = `SELECT seq, at, project_id, simulation_id, run_id, wake_id, type, payload FROM events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY seq LIMIT ?`;
    const result = this.db.prepare(sql).all(...params, query.limit ?? 500);
    // eslint-disable-next-line no-restricted-syntax -- SQLite boundary: every row is zod-parsed on the next line.
    const raw = result as unknown as { seq: number; at: string; project_id: string | null; simulation_id: string | null; run_id: string | null; wake_id: string | null; type: string; payload: string }[];
    return Promise.resolve(
      raw.map((r) =>
        EventSchema.parse({
          seq: r.seq,
          at: r.at,
          projectId: r.project_id,
          simulationId: r.simulation_id,
          runId: r.run_id,
          wakeId: r.wake_id,
          type: r.type,
          // eslint-disable-next-line no-restricted-syntax -- the payload column is JSON text written by appendEvent.
          payload: JSON.parse(r.payload) as unknown,
        }),
      ),
    );
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
        `INSERT INTO jobs (id, kind, status, project_id, run_id, created_at, cost_usd, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, project_id = excluded.project_id, run_id = excluded.run_id,
           cost_usd = excluded.cost_usd, json = excluded.json`,
      )
      .run(parsed.id, parsed.kind, parsed.status, parsed.projectId, parsed.runId, parsed.createdAt, parsed.costUsd, JSON.stringify(parsed));
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

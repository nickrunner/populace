import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  AgentSchema,
  CohortSchema,
  ConfigSnapshotSchema,
  EventSchema,
  FiledIssueQuietNoticeSchema,
  FiledIssueSchema,
  FiledIssueSightingSchema,
  FindingSchema,
  GithubConnectionSchema,
  JobSchema,
  PersonSchema,
  ProjectSchema,
  ReferencedError,
  normalizeEndpointUrl,
  RunSchema,
  SignInGrantSchema,
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
  type FiledIssue,
  type FiledIssueGrowth,
  type FiledIssueKey,
  type FiledIssueProvider,
  type GithubConnection,
  type Identity,
  type Job,
  type Memory,
  type Person,
  type SignInGrant,
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
import { z } from "zod";

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

/*
 * The user's own OAuth sign-ins to targets that will not talk to strangers (ADR-0036). One row per
 * (project, address): two targets in one project on one address are one server and one sign-in.
 *
 * Adding this table did NOT bump SCHEMA_SHAPE, and that is the rule rather than an exception:
 * every statement here runs under CREATE TABLE IF NOT EXISTS on every open, including the open
 * that finds the recorded shape already current, so a table nothing else references appears in an
 * existing database by itself. The shape guards tables that CHANGE, where an old file's columns
 * are wrong and the rebuild is the whole migration story. Changing THIS table later is a bump like
 * any other.
 */
CREATE TABLE IF NOT EXISTS sign_in_grants (
  project_id TEXT NOT NULL, url TEXT NOT NULL, pending_state TEXT,
  updated_at TEXT NOT NULL, json TEXT NOT NULL,
  PRIMARY KEY (project_id, url)
);
/* The OAuth callback arrives holding a state parameter and nothing else; this finds its flow. */
CREATE INDEX IF NOT EXISTS sign_in_grants_state ON sign_in_grants(pending_state);

/*
 * YOUR credential to a third party that is NOT the target: the repository populace files issues
 * into, and the fine-grained token it files them with (ADR-0044). Its own table for the same
 * reason \`sign_in_grants\` is one — a credential gets its own row, so nothing that assembles a
 * config, a snapshot or a view can reach it by walking a blob it was already holding (ADR-0040).
 *
 * \`project_id\` alone is the key, because one project files into one repository: nothing is shared
 * across projects and a project's finding signatures only roll up within it (ADR-0035), so its
 * issues only roll up within one repository too. \`repo\` is lifted out because it is what every
 * refusal and every confirmation names, and reading which repository a project points at should
 * not mean opening the row that holds the token.
 */
CREATE TABLE IF NOT EXISTS github_connections (
  project_id TEXT PRIMARY KEY, repo TEXT NOT NULL, updated_at TEXT NOT NULL, json TEXT NOT NULL
);

/*
 * The filing ledger: one row per issue populace has opened, holding EVERY finding signature the
 * cluster behind it contained. This is the thing that makes "the same problem is not filed twice"
 * true; \`FiledIssueSchema\` carries the argument for why the key is the member signature SET and
 * not the cluster's representative signature, which moves when a verdict is written.
 *
 * It sits among the authored rows and not the produced ones although no human types it, because
 * what it is scoped to is a PROJECT: an issue number outlives the cluster, the run and the study
 * that reported it, so \`deleteRun\` must not take it and a sweep must not either.
 *
 * Keyed \`(project_id, provider, repo, number)\` — an issue number identifies an issue only inside
 * one repository, so a connection re-pointed at a second repository does not make the rows it
 * already wrote ambiguous.
 *
 * **No signature join table, deliberately.** The one query this table exists for is "does any of
 * these N signatures already appear in any filed set?", which SQL wants as either a join table or
 * a lifted column plus \`IN (…)\`. Both cost a second write that has to stay consistent with the
 * blob, and there is no migration framework here to repair a divergence once one exists (ADR-0011
 * amendment) — a ledger that disagrees with itself re-files every issue in somebody's repository,
 * which is the exact failure the ledger is for. So \`matchFiledIssues\` intersects in memory over
 * one repository's rows, which \`(project_id, provider, repo)\` reaches as the leading columns of
 * the primary key with no extra index, and the row count is bounded by the issues one person reads
 * in one repository. If that stops being true the join table is the fix, and this is the note that
 * it was weighed.
 */
CREATE TABLE IF NOT EXISTS filed_issues (
  project_id TEXT NOT NULL, provider TEXT NOT NULL, repo TEXT NOT NULL, number INTEGER NOT NULL,
  filed_at TEXT NOT NULL, json TEXT NOT NULL,
  PRIMARY KEY (project_id, provider, repo, number)
);

CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, slug TEXT NOT NULL, origin TEXT NOT NULL,
  updated_at TEXT NOT NULL, json TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS personas_slug ON personas(project_id, slug);

/*
 * A cohort has no persona column and no size (ADR-0039): it MIXES personas, in \`json.mix\`, and
 * the one headcount there is belongs to the STUDY that sends it (ADR-0041) — a population only
 * weights its cohorts. \`cohort_personas\` is the mix lifted out of the blob for one query —
 * "which cohorts still name this persona?" — which is the guard that refuses to delete a persona
 * somebody is drawn from.
 */
CREATE TABLE IF NOT EXISTS cohorts (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, slug TEXT NOT NULL, updated_at TEXT NOT NULL, json TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cohorts_slug ON cohorts(project_id, slug);
CREATE TABLE IF NOT EXISTS cohort_personas (
  cohort_id TEXT NOT NULL, persona_id TEXT NOT NULL, PRIMARY KEY (cohort_id, persona_id)
);
CREATE INDEX IF NOT EXISTS cohort_personas_persona ON cohort_personas(persona_id);

/* A person id is \`cohortSlug.personaSlug#ordinal\` and is unique within a project, not globally. */
CREATE TABLE IF NOT EXISTS people (
  project_id TEXT NOT NULL, id TEXT NOT NULL, cohort_id TEXT NOT NULL, cohort_slug TEXT NOT NULL,
  persona_id TEXT NOT NULL, lane_slug TEXT NOT NULL, ordinal INTEGER NOT NULL, archived_at TEXT,
  updated_at TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (project_id, id)
);
CREATE INDEX IF NOT EXISTS people_cohort_lane_ordinal ON people(cohort_id, lane_slug, ordinal);

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
const SCHEMA_SHAPE = "m4.cohorts-mix-lanes.1";
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

/**
 * The one migration this file carries, and the reason it is not a `SCHEMA_SHAPE` bump (ADR-0041).
 *
 * The headcount moved from `populations.json.members[].size` to `simulations.json.size`. Both are
 * blob fields with no lifted column, so the tables did not change and a rebuild would have thrown
 * away every run for nothing; but a simulation written before the move has no `size`, and the
 * default of nought would send nobody the next time it ran. So on open, once, every simulation
 * whose JSON has no `size` is given the sum of its population's legacy member sizes — nought when
 * the population is gone — and the population's `size`s are left where they are, because the
 * member schema reads them as weights. Sainte-Laguë returns a target vector exactly when the
 * weights are proportional to it and sum to the size, so an upgraded study deals exactly the
 * counts it had and a longitudinal execution paused across the upgrade resumes with the same people.
 *
 * `SIZE_BACKFILL_KEY` is the marker in the same table as the shape: present, the pass is skipped;
 * absent (a database from before this build, or one the shape check has just rebuilt), it runs and
 * is then recorded. Running it twice is harmless — a row that has a `size` is never touched — the
 * marker only saves reading every simulation on every open. The raw blobs are read with the
 * MINIMAL schemas below rather than `SimulationSchema`, because the whole point is that these rows
 * predate the field that schema now expects. Delete this when the migration framework arrives.
 */
const SIZE_BACKFILL_KEY = "size_backfill";

/** Just enough of a legacy population blob to add its member sizes up; everything else passes through untouched. */
const LegacyPopulationBlobSchema = z.looseObject({
  members: z.array(z.looseObject({ size: z.number().int().nonnegative().optional() })).default([]),
});

/** Just enough of a simulation blob to know which population it sends and whether it has a size yet. */
const SimulationBlobSchema = z.looseObject({
  populationId: z.string(),
  size: z.number().int().nonnegative().optional(),
});

function backfillStudySizes(db: DatabaseSync): void {
  const marker = db.prepare("SELECT value FROM control WHERE key = ?").get(SIZE_BACKFILL_KEY);
  if (marker) return;
  const legacySizeOf = new Map<string, number>();
  for (const row of db.prepare("SELECT id, json FROM populations").all()) {
    // eslint-disable-next-line no-restricted-syntax -- SQLite boundary: the blob is parsed with the minimal schema on the next line.
    const { id, json } = row as unknown as { id: string; json: string };
    const population = parseRow(LegacyPopulationBlobSchema, { json });
    legacySizeOf.set(id, population.members.reduce((sum, member) => sum + (member.size ?? 0), 0));
  }
  const update = db.prepare("UPDATE simulations SET json = ? WHERE id = ?");
  for (const row of db.prepare("SELECT id, json FROM simulations").all()) {
    // eslint-disable-next-line no-restricted-syntax -- SQLite boundary: the blob is parsed with the minimal schema on the next line.
    const { id, json } = row as unknown as { id: string; json: string };
    const simulation = parseRow(SimulationBlobSchema, { json });
    if (simulation.size !== undefined) continue;
    update.run(JSON.stringify({ ...simulation, size: legacySizeOf.get(simulation.populationId) ?? 0 }), id);
  }
  // LAST, deliberately: a row this cannot parse throws out of the loop above, and an absent marker
  // is what makes the next open try again once somebody has repaired the row. Recording the marker
  // first, or in a `finally`, would turn one bad blob into a study that deals nobody for ever.
  db.prepare("INSERT INTO control (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SIZE_BACKFILL_KEY, "1");
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
  /** Kept because a read can now degrade rather than throw; see `ledgerRows`. */
  private readonly warn: (line: string) => void;

  constructor(path: string, warn: (line: string) => void = (line) => console.warn(line)) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.warn = warn;
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    applySchema(this.db, warn);
    // The backfill reads two whole tables through `parseRow`, which throws on a blob it cannot
    // understand — and a throw here escapes the CONSTRUCTOR, so one hand-edited or truncated row
    // in `populations` or `simulations` would make the database impossible to OPEN AT ALL. Every
    // other blob read in this file is per-query and fails only that query, so this one is caught
    // and reported instead. The marker is written as the backfill's last statement, so a failure
    // leaves it absent and the next open retries — which is what makes repairing the row enough.
    try {
      backfillStudySizes(this.db);
    } catch (err) {
      warn(`populace: could not backfill study sizes on open (${err instanceof Error ? err.message : String(err)}); studies written before the headcount moved may still deal nobody. The pass will run again on the next open.`);
    }
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

  /**
   * The run and everything produced under it. `trace_events` is keyed by wake and `memories` by
   * `(run_id, agent_id)`, so both have to go before their parents do or they are keyed to nothing:
   * that is exactly what the old two-statement version left behind, rows invisible to every screen
   * and counted by every `COUNT(*)`.
   */
  deleteRun(id: string): Promise<void> {
    this.db.prepare("DELETE FROM trace_events WHERE wake_id IN (SELECT id FROM wakes WHERE run_id = ?)").run(id);
    this.db.prepare("DELETE FROM wakes WHERE run_id = ?").run(id);
    this.db.prepare("DELETE FROM findings WHERE run_id = ?").run(id);
    this.db.prepare("DELETE FROM memories WHERE run_id = ?").run(id);
    this.db.prepare("DELETE FROM agents WHERE run_id = ?").run(id);
    this.db.prepare("DELETE FROM identities WHERE run_id = ?").run(id);
    this.db.prepare("DELETE FROM jobs WHERE run_id = ?").run(id);
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
    // "study", not "simulation": this string reaches the user in the 409 body, and the product's
    // word for the row is study (ADR-0032, ADR-0042). The method keeps the row's name.
    return rows(result).map((r) => `study "${parseRow(SimulationSchema, r).name}"`);
  }

  private cohortsNamingPersona(personaId: string): string[] {
    const result = this.db
      .prepare("SELECT c.json FROM cohorts c JOIN cohort_personas cp ON cp.cohort_id = c.id WHERE cp.persona_id = ? ORDER BY c.slug")
      .all(personaId);
    return rows(result).map((r) => `cohort "${parseRow(CohortSchema, r).name}"`);
  }

  private populationsHolding(cohortId: string): string[] {
    const result = this.db.prepare("SELECT json FROM populations ORDER BY slug").all();
    return rows(result)
      .map((r) => parseRow(StoredPopulationSchema, r))
      .filter((population) => population.members.some((member) => member.cohortId === cohortId))
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

  /**
   * The project and everything under it, in one transaction. Every other delete in this file
   * refuses when something still points at the row; this one is the exception the interface
   * documents, because a project IS the scope those references live in.
   *
   * Order is by dependency, not by table name: the produced rows are keyed by run and the runs by
   * project, so the runs go first and through `deleteRun`, which is the single place that knows
   * what an execution produces. `cohort_id` and `wake_id` have no project column of their own, so
   * people and trace events are reached through the rows that do.
   *
   * All of it, or none of it. A half-deleted project — its target gone and its simulations still
   * naming it — is worse than the pile-up this fixes, and `busy_timeout` plus WAL means the
   * transaction is the only thing that makes that impossible rather than merely unlikely.
   */
  async deleteProject(id: string): Promise<void> {
    const existing = await this.getProject(id);
    if (!existing) return;
    const runIds = (await this.listRuns({ projectId: id })).map((run) => run.id);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const runId of runIds) await this.deleteRun(runId);
      // Trace events are keyed by wake alone, so a wake left by a run row that never existed —
      // an M1 database, where runs became rows only at M2 — is reached through its population.
      this.db
        .prepare("DELETE FROM trace_events WHERE wake_id IN (SELECT id FROM wakes WHERE population_id IN (SELECT id FROM populations WHERE project_id = ?))")
        .run(id);
      this.db.prepare("DELETE FROM wakes WHERE population_id IN (SELECT id FROM populations WHERE project_id = ?)").run(id);
      this.db.prepare("DELETE FROM people WHERE project_id = ?").run(id);
      this.db.prepare("DELETE FROM simulations WHERE project_id = ?").run(id);
      this.db.prepare("DELETE FROM populations WHERE project_id = ?").run(id);
      this.db.prepare("DELETE FROM cohort_personas WHERE cohort_id IN (SELECT id FROM cohorts WHERE project_id = ?)").run(id);
      this.db.prepare("DELETE FROM cohorts WHERE project_id = ?").run(id);
      this.db.prepare("DELETE FROM personas WHERE project_id = ?").run(id);
      this.db.prepare("DELETE FROM targets WHERE project_id = ?").run(id);
      this.db.prepare("DELETE FROM sign_in_grants WHERE project_id = ?").run(id);
      // A project's credentials go with it (ADR-0036), and so does its filing ledger: the issues
      // outlive the runs, but they were signatures rolled up inside this project and nothing else
      // can ever match them again.
      this.db.prepare("DELETE FROM github_connections WHERE project_id = ?").run(id);
      this.db.prepare("DELETE FROM filed_issues WHERE project_id = ?").run(id);
      this.db.prepare("DELETE FROM triage WHERE project_id = ?").run(id);
      this.db.prepare("DELETE FROM settings WHERE project_id = ?").run(id);
      this.db.prepare("DELETE FROM jobs WHERE project_id = ?").run(id);
      this.db.prepare("DELETE FROM events WHERE project_id = ?").run(id);
      this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
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

  saveSignInGrant(grant: SignInGrant): Promise<void> {
    const parsed = SignInGrantSchema.parse(grant);
    this.db
      .prepare(
        `INSERT INTO sign_in_grants (project_id, url, pending_state, updated_at, json) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id, url) DO UPDATE SET pending_state = excluded.pending_state,
           updated_at = excluded.updated_at, json = excluded.json`,
      )
      .run(parsed.projectId, parsed.url, parsed.pending?.state ?? null, parsed.updatedAt, JSON.stringify(parsed));
    return Promise.resolve();
  }

  getSignInGrant(projectId: string, url: string): Promise<SignInGrant | undefined> {
    const row = this.db.prepare("SELECT json FROM sign_in_grants WHERE project_id = ? AND url = ?").get(projectId, normalizeEndpointUrl(url));
    return Promise.resolve(row ? parseRow(SignInGrantSchema, rows([row])[0] as JsonRow) : undefined);
  }

  listSignInGrants(projectId?: string): Promise<SignInGrant[]> {
    const sql = `SELECT json FROM sign_in_grants ${projectId ? "WHERE project_id = ?" : ""} ORDER BY updated_at DESC`;
    const result = projectId ? this.db.prepare(sql).all(projectId) : this.db.prepare(sql).all();
    return Promise.resolve(rows(result).map((r) => parseRow(SignInGrantSchema, r)));
  }

  deleteSignInGrant(projectId: string, url: string): Promise<void> {
    this.db.prepare("DELETE FROM sign_in_grants WHERE project_id = ? AND url = ?").run(projectId, normalizeEndpointUrl(url));
    return Promise.resolve();
  }

  saveGithubConnection(connection: GithubConnection): Promise<void> {
    const parsed = GithubConnectionSchema.parse(connection);
    this.db
      .prepare(
        `INSERT INTO github_connections (project_id, repo, updated_at, json) VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET repo = excluded.repo, updated_at = excluded.updated_at, json = excluded.json`,
      )
      .run(parsed.projectId, parsed.repo, parsed.updatedAt, JSON.stringify(parsed));
    return Promise.resolve();
  }

  getGithubConnection(projectId: string): Promise<GithubConnection | undefined> {
    const row = this.db.prepare("SELECT json FROM github_connections WHERE project_id = ?").get(projectId);
    return Promise.resolve(row ? parseRow(GithubConnectionSchema, rows([row])[0] as JsonRow) : undefined);
  }

  deleteGithubConnection(projectId: string): Promise<void> {
    this.db.prepare("DELETE FROM github_connections WHERE project_id = ?").run(projectId);
    return Promise.resolve();
  }

  saveFiledIssue(issue: FiledIssue): Promise<void> {
    const parsed = FiledIssueSchema.parse(issue);
    this.db
      .prepare(
        `INSERT INTO filed_issues (project_id, provider, repo, number, filed_at, json) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, provider, repo, number) DO UPDATE SET filed_at = excluded.filed_at, json = excluded.json`,
      )
      .run(parsed.projectId, parsed.provider, parsed.repo, parsed.number, parsed.filedAt, JSON.stringify(parsed));
    return Promise.resolve();
  }

  /**
   * Ledger rows, parsed one at a time and with a row that will not parse SKIPPED rather than
   * thrown out of.
   *
   * `parseRow` is right everywhere else in this file: a corrupt blob is a bug and a loud one. Here
   * it is the wrong trade, because of what the caller does with a throw. A publisher that cannot
   * read the ledger has no way to tell "nothing has been filed" from "I could not look", and if it
   * guesses the first it re-files every issue in somebody's repository. One unreadable row must
   * not be able to cause that, so it costs its own issue a possible duplicate and nothing more.
   *
   * Skipping is also the only honest thing to do with such a row: a row this binary cannot
   * understand is one it must not MATCH on either — it cannot know which signatures are in a set
   * it cannot read. The count is warned about so the row is repairable rather than invisible.
   */
  private ledgerRows(result: object[]): FiledIssue[] {
    const out: FiledIssue[] = [];
    let skipped = 0;
    for (const row of rows(result)) {
      // eslint-disable-next-line no-restricted-syntax -- SQLite boundary: JSON text is parsed with zod on this same line.
      const parsed = FiledIssueSchema.safeParse(JSON.parse(row.json) as unknown);
      if (parsed.success) out.push(parsed.data);
      else skipped += 1;
    }
    if (skipped > 0) this.warn(`populace: skipped ${skipped} filing-ledger row${skipped === 1 ? "" : "s"} this build cannot read. They are not matched against, so the problems behind them may be filed again.`);
    return out;
  }

  /** Oldest first, which is the policy every caller of the ledger is written around. */
  listFiledIssues(projectId: string): Promise<FiledIssue[]> {
    const result = this.db.prepare("SELECT json FROM filed_issues WHERE project_id = ? ORDER BY filed_at ASC, number ASC").all(projectId);
    return Promise.resolve(this.ledgerRows(result));
  }

  matchFiledIssues(projectId: string, provider: FiledIssueProvider, repo: string, signatures: readonly string[]): Promise<FiledIssue[]> {
    // Nothing to match against is not a match: a cluster with no member signatures cannot be the
    // thing any row is about, and the alternative — an empty `IN ()` — would be a row scan whose
    // answer is always no.
    if (!signatures.length) return Promise.resolve([]);
    const wanted = new Set(signatures);
    // Scoped to the repository, not to the project. `saveGithubConnection` upserts on the project,
    // so re-pointing at a second repository is one PUT — and a match on the project alone would
    // then send every comment to the repository this token is no longer scoped to while the new
    // one never receives an issue at all. A row filed elsewhere has genuinely not told THIS
    // repository anything, so it is not a match; it is kept, because it is what stops a
    // re-point-and-back from filing everything twice.
    //
    // Oldest first, and every match rather than the first: two rows both match once the clusterer
    // bridges two problems into one cluster, and the caller comments on the oldest and marks the
    // rest `supersededBy` instead of orphaning them silently.
    const result = this.db.prepare("SELECT json FROM filed_issues WHERE project_id = ? AND provider = ? AND repo = ? ORDER BY filed_at ASC, number ASC").all(projectId, provider, repo);
    return Promise.resolve(this.ledgerRows(result).filter((issue) => issue.signatures.some((signature) => wanted.has(signature))));
  }

  /**
   * The set union and the sighting append, in one transaction, because the alternative loses a
   * signature. Read-modify-write through `saveFiledIssue` spans two awaits, and the single-problem
   * route runs outside the serial job queue — so a bulk job and a click interleave there, the
   * later write wins whole, and the signatures the earlier one added are gone. That is the exact
   * duplicate this ledger exists to prevent, reintroduced by the code that maintains it.
   *
   * `BEGIN IMMEDIATE` rather than a deferred transaction, and the same shape as `deleteProject`:
   * the write lock is taken before the read, so two growers serialise on the lock instead of one
   * of them losing at COMMIT.
   */
  growFiledIssue(key: FiledIssueKey, growth: FiledIssueGrowth): Promise<FiledIssue | undefined> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare("SELECT json FROM filed_issues WHERE project_id = ? AND provider = ? AND repo = ? AND number = ?")
        .get(key.projectId, key.provider, key.repo, key.number);
      if (!row) {
        this.db.exec("COMMIT");
        return Promise.resolve(undefined);
      }
      const existing = parseRow(FiledIssueSchema, rows([row])[0] as JsonRow);
      const signatures = [...existing.signatures];
      for (const signature of growth.signatures) if (!signatures.includes(signature)) signatures.push(signature);
      // A window already recorded is a double-publish of that window, not a second sighting —
      // which is the whole reason a sighting carries `window` and not a bare `seq` (a longitudinal
      // study has one execution for its life, so `seq` alone is 1 for ever).
      const seenIn = [...existing.seenIn];
      const seenKey = (seen: (typeof seenIn)[number]): string => `${seen.studyId}|${seen.runId}|${String(seen.seq)}|${String(seen.window)}`;
      const known = new Set(seenIn.map(seenKey));
      for (const seen of growth.seenIn) {
        const parsed = FiledIssueSightingSchema.parse(seen);
        if (known.has(seenKey(parsed))) continue;
        known.add(seenKey(parsed));
        seenIn.push(parsed);
      }
      // A gone-quiet announcement already recorded for the same `(studyId, since)` is the SAME
      // news, and the publisher's whole guard rests on this append being atomic: the synchronous
      // single-problem route runs outside the serial job queue, so a `get` plus a `save` at the
      // call site would let two passes each see no notice and each write one (see
      // `FiledIssueQuietNoticeSchema`).
      const quietNotices = [...existing.quietNotices];
      const quietKey = (notice: (typeof quietNotices)[number]): string => `${notice.studyId}|${String(notice.since)}`;
      const announced = new Set(quietNotices.map(quietKey));
      for (const notice of growth.quietNotices ?? []) {
        const parsed = FiledIssueQuietNoticeSchema.parse(notice);
        if (announced.has(quietKey(parsed))) continue;
        announced.add(quietKey(parsed));
        quietNotices.push(parsed);
      }
      const grown = FiledIssueSchema.parse({
        ...existing,
        signatures,
        seenIn,
        quietNotices,
        ...(growth.supersededBy === undefined ? {} : { supersededBy: growth.supersededBy }),
        updatedAt: growth.updatedAt,
      });
      this.db.prepare("UPDATE filed_issues SET json = ? WHERE project_id = ? AND provider = ? AND repo = ? AND number = ?").run(JSON.stringify(grown), key.projectId, key.provider, key.repo, key.number);
      this.db.exec("COMMIT");
      return Promise.resolve(grown);
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
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

  /** The row and its mix, together: the join table is the mix and must never disagree with the blob. */
  saveCohort(cohort: Cohort): Promise<void> {
    const parsed = CohortSchema.parse(cohort);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO cohorts (id, project_id, slug, updated_at, json) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, updated_at = excluded.updated_at, json = excluded.json`,
        )
        .run(parsed.id, parsed.projectId, parsed.slug, parsed.updatedAt, JSON.stringify(parsed));
      this.db.prepare("DELETE FROM cohort_personas WHERE cohort_id = ?").run(parsed.id);
      const insert = this.db.prepare("INSERT INTO cohort_personas (cohort_id, persona_id) VALUES (?, ?)");
      for (const entry of parsed.mix) insert.run(parsed.id, entry.personaId);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
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
    this.db.prepare("DELETE FROM cohort_personas WHERE cohort_id = ?").run(id);
    this.db.prepare("DELETE FROM cohorts WHERE id = ?").run(id);
  }

  // ---- people ------------------------------------------------------------

  savePerson(person: Person): Promise<void> {
    const parsed = PersonSchema.parse(person);
    this.db
      .prepare(
        `INSERT INTO people (project_id, id, cohort_id, cohort_slug, persona_id, lane_slug, ordinal, archived_at, updated_at, json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, id) DO UPDATE SET cohort_id = excluded.cohort_id, cohort_slug = excluded.cohort_slug,
           persona_id = excluded.persona_id, lane_slug = excluded.lane_slug, ordinal = excluded.ordinal,
           archived_at = excluded.archived_at, updated_at = excluded.updated_at, json = excluded.json`,
      )
      .run(parsed.projectId, parsed.id, parsed.cohortId, parsed.cohortSlug, parsed.personaId, parsed.laneSlug, parsed.ordinal, parsed.archivedAt, parsed.updatedAt, JSON.stringify(parsed));
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
    const sql = `SELECT json FROM people ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY cohort_slug, lane_slug, ordinal`;
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
   * A simulation that has ever run is the user's history: by default it is archived, not deleted,
   * and its runs are left exactly where they are. `withRuns` is the caller passing on a user who
   * was shown how many executions that is and said to delete them anyway.
   */
  async deleteSimulation(id: string, options: { withRuns?: boolean } = {}): Promise<void> {
    const existing = await this.getSimulation(id);
    if (!existing) return;
    const runs = await this.listRuns({ simulationId: id });
    if (runs.length > 0 && options.withRuns !== true) {
      await this.saveSimulation({ ...existing, archived: true, updatedAt: new Date().toISOString() });
      return;
    }
    for (const run of runs) await this.deleteRun(run.id);
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

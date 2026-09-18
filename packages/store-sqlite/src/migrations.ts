import type { DatabaseSync } from "node:sqlite";

/**
 * The smallest thing that deserves the name (`DATA-MODEL.md` §11).
 *
 * Up to M1 the store had no versioning at all: `CREATE TABLE IF NOT EXISTS` plus an explicit drop
 * where a shape had to change. That was affordable while the only data was a developer's
 * throwaway runs. M2 is the first release where a user's targets and personas live in this file,
 * so from here the rules differ by layer:
 *
 * - **Authored tables are never dropped.** Projects, targets, personas, populations and settings
 *   are the user's work. They get additive columns and defaults, and nothing else.
 * - **Produced and derived tables may be dropped and rebuilt.** Traces, events, digests and
 *   clusters are reproducible or expendable, and an incompatible change drops them with a warning.
 *
 * `schema_version` lives in `control` and gates an ordered list of forward steps. Each step runs
 * once, in a transaction, in order. There is no down migration and there will not be one: a local
 * database's recovery story is to delete it, and an authored table is exactly what must not be in
 * that blast radius.
 */
export interface Migration {
  version: number;
  name: string;
  up(db: DatabaseSync, warn: (line: string) => void): void;
}

const M2_TABLES = `
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, json TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS targets (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, updated_at TEXT NOT NULL, json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS targets_project ON targets(project_id);

CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, slug TEXT NOT NULL, origin TEXT NOT NULL,
  updated_at TEXT NOT NULL, json TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS personas_slug ON personas(project_id, slug);

CREATE TABLE IF NOT EXISTS populations (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, slug TEXT NOT NULL, updated_at TEXT NOT NULL, json TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS populations_slug ON populations(project_id, slug);

CREATE TABLE IF NOT EXISTS settings (project_id TEXT PRIMARY KEY, json TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS config_snapshots (
  id TEXT PRIMARY KEY, hash TEXT NOT NULL, created_at TEXT NOT NULL, json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS config_snapshots_hash ON config_snapshots(hash);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, population_id TEXT NOT NULL, status TEXT NOT NULL,
  parent_run_id TEXT, started_at TEXT, json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_project_status ON runs(project_id, status);
CREATE INDEX IF NOT EXISTS runs_parent ON runs(parent_run_id);

CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, run_id TEXT, wake_id TEXT,
  type TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_run ON events(run_id, seq);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, run_id TEXT,
  created_at TEXT NOT NULL, json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, created_at);
`;

/**
 * The read paths the dashboard actually uses, which are not the ones the daemon's queries were
 * indexed for (`DATA-MODEL.md` §6).
 */
const DASHBOARD_INDEXES = `
CREATE INDEX IF NOT EXISTS findings_run_kind ON findings(run_id, kind);
CREATE INDEX IF NOT EXISTS wakes_run_agent_started ON wakes(run_id, agent_id, started_at);
CREATE INDEX IF NOT EXISTS agents_run_status ON agents(run_id, status);
`;

/**
 * The authored layer's history (`DATA-MODEL.md` §5). An authored table, so it is additive and
 * never dropped: it is the only copy of what a config looked like before someone changed it.
 */
const CONFIG_REVISIONS = `
CREATE TABLE IF NOT EXISTS config_revisions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, at TEXT NOT NULL, source TEXT NOT NULL,
  summary TEXT NOT NULL, json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS config_revisions_project ON config_revisions(project_id, at);
`;

export const MIGRATIONS: Migration[] = [
  {
    version: 2,
    name: "m2-config-runs-events-jobs",
    up(db) {
      // Every statement here is additive, so an M1 database keeps every row it had. A run written
      // before this step has no `runs` row; the read model derives those exactly as M1 did, which
      // is why nothing has to be backfilled and no produced table is touched.
      db.exec(M2_TABLES);
      db.exec(DASHBOARD_INDEXES);
    },
  },
  {
    version: 3,
    name: "m2-config-history",
    up(db) {
      db.exec(CONFIG_REVISIONS);
    },
  },
];

const VERSION_KEY = "schema_version";

function currentVersion(db: DatabaseSync): number {
  const row = db.prepare("SELECT value FROM control WHERE key = ?").get(VERSION_KEY);
  if (!row) return 1;
  // eslint-disable-next-line no-restricted-syntax -- control row written only by this file.
  const value = (row as unknown as { value?: unknown }).value;
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 1;
}

/**
 * Applies every migration newer than the recorded version. A fresh database and a database from
 * M1 both start at 1: the M1 shape is created by `CREATE TABLE IF NOT EXISTS` before this runs, so
 * "no version row" and "version 1" are the same state and neither needs a special case.
 */
export function applyMigrations(db: DatabaseSync, warn: (line: string) => void = () => undefined): number {
  let version = currentVersion(db);
  for (const migration of MIGRATIONS) {
    if (migration.version <= version) continue;
    db.exec("BEGIN");
    try {
      migration.up(db, warn);
      db.prepare("INSERT INTO control (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(VERSION_KEY, String(migration.version));
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`migration ${migration.version} (${migration.name}) failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    version = migration.version;
  }
  return version;
}

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 1;

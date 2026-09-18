import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { DEFAULT_PROJECT_ID, type Job, type PopulaceConfig, type Store } from "@populace/core";
import type { ModelProvider } from "@populace/runner";
import type { Hono } from "hono";
import { createApp } from "./app.js";
import { ensureProject, ensureSettings, resolveProjectConfig, seedProjectFromConfig, withLiveCredentials, type ProcessConfig } from "./config-store.js";
import type { ControlDeps } from "./deps.js";
import { EventHub, RecordingStore } from "./events.js";
import { JobRunner } from "./jobs.js";
import { releaseLock, takeLock, type ServeLock } from "./lock.js";
import { RunController } from "./runs.js";
import { sweepRun, type SweepOptions } from "./sweep.js";

export interface ServeOptions {
  store: Store;
  storePath: string;
  version: string;
  processConfig?: ProcessConfig;
  projectId?: string;
  /**
   * Builds the model provider. Absent means this process cannot call the model: the API stays up
   * and read-only, and everything that would spend money says why it cannot.
   */
  provider?: () => ModelProvider;
  /**
   * A `populace.yaml` to import into the authored tables the first time this store is opened.
   * Import, not sync: rows are the source of truth from M2 (ADR-0025), and a project that already
   * has a target keeps it.
   */
  seedConfig?: PopulaceConfig;
  /** Serve the read-only API only: no run control, no authoring, no lock taken. */
  readOnly?: boolean;
  /** Take over a lock held by another process. */
  force?: boolean;
  port?: number;
  /**
   * Defaults to loopback. The process reads a store that can name a target's credentials and can
   * spend money on request, so exposing it takes a deliberate flag (ADR-0023).
   */
  host?: string;
  /** Where the built dashboard lives. Defaults to this package's `public/`. */
  webRoot?: string;
  log?: (line: string) => void;
}

export interface RunningServer {
  url: string;
  app: Hono;
  /** The store the API writes through: the one passed in, wrapped so writes reach the event log. */
  store: Store;
  close(): Promise<void>;
}

const here = dirname(fileURLToPath(import.meta.url));

function placeholder(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>populace</title></head>
<body style="font-family: system-ui; max-width: 40rem; margin: 4rem auto">
<h1>populace</h1>
<p>The API is running. The dashboard has not been built into this install yet.</p>
<p>Try <code>/api/v1/runs</code>, or run <code>pnpm build</code> from a checkout to build the dashboard.</p>
</body></html>`;
}

/**
 * One process: the HTTP API, the job queue, the daemon and the single SQLite writer
 * (`WEB-ARCHITECTURE.md` §4). In M5 this splits at the job runner and nothing above the seam
 * knows.
 */
export async function startServer(options: ServeOptions): Promise<RunningServer> {
  const log = options.log ?? ((): void => undefined);
  const projectId = options.projectId ?? DEFAULT_PROJECT_ID;
  const processConfig: ProcessConfig = options.processConfig ?? { store: { kind: "sqlite", path: options.storePath }, digestDir: "digests" };

  let lock: ServeLock | undefined;
  let control: ControlDeps | undefined;
  let jobs: JobRunner | undefined;
  let runs: RunController | undefined;
  let store = options.store;

  if (!options.readOnly) {
    lock = await takeLock(options.store, options.force === undefined ? {} : { force: options.force });
    await ensureProject(options.store, projectId);
    await ensureSettings(options.store, projectId);
    if (options.seedConfig) {
      const seeded = await seedProjectFromConfig(options.store, options.seedConfig, projectId);
      log(`populace serve: ${seeded.seeded ? `imported populace.yaml — ${seeded.reason}` : `using the config in the database (${seeded.reason})`}`);
    }

    const hub = new EventHub();
    // Every write the runner makes goes through here, which is what puts it on the event log
    // without the wake loop knowing the log exists (ADR-0026).
    store = new RecordingStore(options.store, hub.publish);
    jobs = new JobRunner(store, log);
    runs = new RunController({
      store,
      provider: () => {
        if (!options.provider) throw new Error("this process has no model provider; set ANTHROPIC_API_KEY");
        return options.provider();
      },
      log,
    });

    // A run or a job left mid-flight by a process that died can never finish on its own, and a
    // dashboard that shows one as live is worse than one that shows it as failed.
    const orphanRuns = await runs.reconcileOrphans();
    const orphanJobs = await jobs.reconcileOrphans();
    if (orphanRuns + orphanJobs > 0) log(`populace serve: marked ${orphanRuns} run(s) and ${orphanJobs} job(s) as failed after an earlier process stopped`);

    /**
     * The config a run executed, ready to open a connection with. The snapshot is the record of
     * what ran and carries `[redacted]` in place of every secret, so the live credentials are put
     * back from the authored target row before this reaches the verifier's replay or sweep — both
     * of which talk to the target, and both of which would silently fail against an authenticated
     * one otherwise (ADR-0024).
     */
    const configForRun = async (runId: string): Promise<PopulaceConfig> => {
      const run = await store.getRun(runId);
      const snapshot = run?.configSnapshotId ? await store.getConfigSnapshot(run.configSnapshotId) : undefined;
      if (snapshot) return withLiveCredentials(store, snapshot.config, projectId);
      return (await resolveProjectConfig(store, processConfig, projectId)).config;
    };

    control = {
      store,
      projectId,
      processConfig,
      hasApiKey: () => options.provider !== undefined,
      ...(options.provider ? { provider: options.provider } : {}),
      jobs,
      runs,
      hub,
      configForRun,
      sweep: async (runId: string, sweepOptions: SweepOptions, report: (progress: Partial<Job["progress"]>) => Promise<void>) => {
        await report({ label: "finding the accounts this run created" });
        const config = await configForRun(runId);
        const result = await sweepRun(store, config, runId, sweepOptions);
        for (const line of result.lines) log(`populace sweep: ${line}`);
        return result;
      },
    };
  }

  const app = createApp({
    store,
    storePath: options.storePath,
    version: options.version,
    config: async () => (await resolveProjectConfig(store, processConfig, projectId)).config,
    ...(options.provider ? { verifier: options.provider() } : {}),
    ...(control ? { control } : {}),
  });

  const webRoot = options.webRoot ?? resolve(here, "../public");
  if (existsSync(webRoot)) {
    app.use("/*", serveStatic({ root: webRoot }));
    // The dashboard is a single-page app: any path it owns has to resolve to index.html.
    app.get("/*", serveStatic({ root: webRoot, path: "index.html" }));
  } else {
    app.get("/", (c) => c.html(placeholder()));
  }

  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4311;
  const server: ServerType = await new Promise((ready) => {
    const s = serve({ fetch: app.fetch, hostname: host, port }, () => {
      ready(s);
    });
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;
  const url = `http://${host}:${actualPort}`;
  log(`populace serve: ${url} (${options.readOnly ? "read-only; " : ""}store ${options.storePath})`);

  return {
    url,
    app,
    store,
    close: async () => {
      // Runs first: a wake in flight is still writing, and closing under it loses the visit.
      await runs?.shutdown();
      await new Promise<void>((done, failed) => {
        server.close((err) => (err ? failed(err) : done()));
      });
      if (lock) await releaseLock(options.store, lock);
    },
  };
}

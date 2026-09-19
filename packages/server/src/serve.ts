import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { DEFAULT_PROJECT_ID, type Job, type PopulaceConfig, type Store } from "@populace/core";
import type { ModelProvider } from "@populace/runner";
import type { Hono } from "hono";
import { createApp } from "./app.js";
import { ensureProject, ensureSettings, ensureSimulation, resolveSimulationConfig, seedProjectFromConfig, type ProcessConfig, type SimulationPlan } from "./config-store.js";
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
  /**
   * The simulations that `populace.yaml` describes, imported alongside it. Absent means the file
   * named none and one is implied from its visit cap.
   */
  seedSimulations?: readonly SimulationPlan[];
  /**
   * Pick back up the executions a previous process left behind (SPEC §4.2). `reconcileOrphans()`
   * marks a run whose process died `paused` / `process-ended`; this is the other half — without it
   * a longitudinal soak the user was told to leave running stops for good the first time the
   * laptop closes. Off by default, because re-arming a run spends money.
   */
  resume?: boolean;
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
      const seeded = await seedProjectFromConfig(options.store, options.seedConfig, projectId, options.seedSimulations ? { simulations: options.seedSimulations } : {});
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
      // Resuming an execution needs the live credentials a snapshot does not carry, and applying
      // changes to one is a re-resolve by definition.
      resolve: async (simulationId: string) => (await resolveSimulationConfig(store, processConfig, simulationId)).config,
      log,
    });

    // A run or a job left mid-flight by a process that died can never finish on its own, and a
    // dashboard that shows one as live is worse than one that shows it as failed.
    const orphanRuns = await runs.reconcileOrphans();
    const orphanJobs = await jobs.reconcileOrphans();
    if (orphanRuns + orphanJobs > 0) log(`populace serve: ${orphanRuns} run(s) paused and ${orphanJobs} job(s) failed after an earlier process stopped`);

    // `--resume`: the other half of the orphan story. Only the runs a dead process left behind are
    // re-armed — a run somebody paused on purpose stays paused, and nothing is re-armed at all
    // without a model provider to run it with.
    if (options.resume && options.provider) {
      for (const run of await store.listRuns({ status: "paused" })) {
        if (run.pauseReason !== "process-ended") continue;
        try {
          await runs.resume(run.id);
          log(`populace serve: picked execution ${run.seq} back up (${run.id})`);
        } catch (err) {
          log(`populace serve: could not pick ${run.id} back up: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } else if (options.resume && !options.provider) {
      log("populace serve: --resume needs ANTHROPIC_API_KEY; the paused executions were left where they are.");
    }

    const configForRun = async (runId: string): Promise<PopulaceConfig> => {
      const run = await store.getRun(runId);
      const snapshot = run?.configSnapshotId ? await store.getConfigSnapshot(run.configSnapshotId) : undefined;
      if (snapshot) return snapshot.config;
      const simulationId = run?.simulationId ?? (await ensureSimulation(store, projectId)).id;
      return (await resolveSimulationConfig(store, processConfig, simulationId)).config;
    };

    control = {
      store,
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

  /**
   * The config ONE RUN executed, for the read routes that cannot render without one. It resolves
   * that run's SIMULATION — there is no process-wide "the config" any more, because there is no
   * process-wide project (SPEC §6).
   */
  const configForRunRead = async (runId: string): Promise<PopulaceConfig | undefined> => {
    const run = await store.getRun(runId);
    const snapshot = run?.configSnapshotId ? await store.getConfigSnapshot(run.configSnapshotId) : undefined;
    if (snapshot) return snapshot.config;
    if (!run) return undefined;
    try {
      return (await resolveSimulationConfig(store, processConfig, run.simulationId)).config;
    } catch {
      return undefined;
    }
  };

  const app = createApp({
    store,
    storePath: options.storePath,
    version: options.version,
    configForRun: configForRunRead,
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
        // Every open dashboard holds an event stream, and an event stream never ends by design, so
        // `server.close()` on its own waits for a callback that can never come: the listener drops
        // at once — the app the user is looking at starts refusing connections — and the process
        // sits there until the browser tab is closed. Idle sockets go immediately; anything still
        // being served gets a moment to finish and then goes too.
        const grace = setTimeout(() => {
          if ("closeAllConnections" in server) server.closeAllConnections();
        }, 500);
        server.close((err) => {
          clearTimeout(grace);
          if (err) failed(err);
          else done();
        });
        if ("closeIdleConnections" in server) server.closeIdleConnections();
      });
      if (lock) await releaseLock(options.store, lock);
    },
  };
}

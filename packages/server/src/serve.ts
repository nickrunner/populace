import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { DEFAULT_PROJECT_ID, type Job, type PopulaceConfig, type Run, type Store } from "@populace/core";
import { createTypesafeClient, type TypesafeClient } from "@populace/reports";
import type { ModelProvider } from "@populace/runner";
import type { Hono } from "hono";
import { createApp } from "./app.js";
import { ensureProject, ensureSettings, liveConfigForRun, materialise, resolveSimulationConfig, seedProjectFromConfig, type ProcessConfig, type SimulationPlan } from "./config-store.js";
import type { ControlDeps } from "./deps.js";
import { EventHub, RecordingStore } from "./events.js";
import { JobRunner } from "./jobs.js";
import { releaseLock, takeLock, type ServeLock } from "./lock.js";
import { ProjectReadModel } from "./project-read-model.js";
import { reportIssuesWith } from "./report-cycle.js";
import { RunController, type ReportHandle, type ReportTrigger } from "./runs.js";
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
   * The studies that `populace.yaml` describes (its `simulations:` or `studies:` block), imported
   * alongside it. Absent means the file named none and one is implied from its visit cap, at the
   * size of the people it counted.
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
  /*
   * The typed judge's client, built once from `TYPESAFE_API_KEY`.
   *
   * Its ABSENCE is the flag everywhere downstream — there is no `hasTypesafeKey()` beside
   * `hasApiKey()` — because building one is reading a string, where `provider()` has to be a thunk
   * that can throw. Without it, `verifier.judge: "typesafe"` threw from inside the verifier once
   * per finding; with it, every place that verifies refuses at its pre-flight with one sentence
   * naming the key. Read here rather than passed in because this is the process that owns the
   * environment, and the key goes into no config, no snapshot, no trace and no log.
   */
  const typesafeKey = process.env.TYPESAFE_API_KEY;
  const typesafe: TypesafeClient | undefined = typesafeKey === undefined || typesafeKey === "" ? undefined : createTypesafeClient({ apiKey: typesafeKey });

  /**
   * The live config of one study, credentials and all. Secrets live in the rows and nowhere else,
   * so this is the only place the redacted halves of a snapshot can be filled back in from. It
   * reads and never writes (ADR-0041): the roster it freezes is written by `materialise`, below.
   */
  const resolveLive = async (simulationId: string): Promise<PopulaceConfig> => (await resolveSimulationConfig(store, processConfig, simulationId)).config;

  if (!options.readOnly) {
    lock = await takeLock(options.store, options.force === undefined ? {} : { force: options.force });
    // A project is created when there is a REASON for one, not on every boot. This used to run
    // unconditionally, so every `serve` against a store that had none minted a project literally
    // called "Default" — and since nothing in the product could delete a project, those piled up
    // as the first thing a new user saw. The two reasons are a `populace.yaml` to import into and
    // an explicit `--project`; with neither, the dashboard opens on its empty state and the user
    // makes the first project themselves, with a name that means something.
    if (options.seedConfig || options.projectId !== undefined) {
      await ensureProject(options.store, projectId, options.seedConfig ? { name: options.seedConfig.target.name } : {});
      await ensureSettings(options.store, projectId);
    }
    if (options.seedConfig) {
      const seeded = await seedProjectFromConfig(options.store, options.seedConfig, projectId, options.seedSimulations ? { simulations: options.seedSimulations } : {});
      log(`populace serve: ${seeded.seeded ? `imported populace.yaml — ${seeded.reason}` : `using the config in the database (${seeded.reason})`}`);
    }

    const hub = new EventHub();
    // Every write the runner makes goes through here, which is what puts it on the event log
    // without the wake loop knowing the log exists (ADR-0026).
    store = new RecordingStore(options.store, hub.publish);
    jobs = new JobRunner(store, log);
    const queue = jobs;
    /*
     * The automatic report: a digest and then the filing, for a window a cycle closed inside an
     * execution or that an execution ended.
     *
     * A hoisted function declaration on purpose. It reads `configForRun`, which is a `const`
     * further down, and the controller has to exist before that — nothing in here runs until a
     * visit lands or an execution settles, long after both are defined. And it deliberately does
     * not reach for `control`, which does not exist at this point either.
     *
     * No `githubClient`: absent means the real one, which is what production wants.
     */
    function reportIssues(run: Run, trigger: ReportTrigger): Promise<ReportHandle> {
      return reportIssuesWith({
        store,
        jobs: queue,
        readModel: new ProjectReadModel(store, { runningRunIds: () => runs?.runningIds ?? [] }),
        configForRun: (runId: string) => configForRun(runId),
        hasApiKey: () => options.provider !== undefined,
        ...(options.provider ? { provider: options.provider } : {}),
        ...(typesafe ? { typesafe: () => typesafe } : {}),
        log,
      })(run, trigger);
    }
    runs = new RunController({
      store,
      provider: () => {
        if (!options.provider) throw new Error("this process has no model provider; set ANTHROPIC_API_KEY");
        return options.provider();
      },
      // Resuming an execution needs the live credentials a snapshot does not carry, and applying
      // changes to one is a re-resolve by definition.
      resolve: resolveLive,
      // A start writes the roster its study deals before freezing the cast (D3): the one writer
      // that is not a route.
      materialise: (simulationId: string) => materialise(store, simulationId),
      // Automatic filing, both halves: the last window of an execution that ended, and a window a
      // cycle closed inside a longitudinal one. Nothing happens unless the project's connection
      // says `autoFile`, which the controller checks before anything is enqueued.
      reportIssues,
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

    /**
     * The config a run is executing, for everything that then CONNECTS with it: the sweep job, the
     * digest job's verification replay and the tool list behind a run's coverage. It is the
     * snapshot with the live credentials put back, never the snapshot verbatim — and when the
     * credentials cannot be had it throws, because `[redacted]` on the wire is the failure this is
     * here to prevent and it is invisible from every other vantage point.
     */
    const configForRun = async (runId: string): Promise<PopulaceConfig> => {
      const live = await liveConfigForRun(store, runId, resolveLive);
      if (live) return live;
      const run = await store.getRun(runId);
      // No such run at all is an error, not a cue to invent a study. This used to fall back to the
      // project's default study — creating one, with a population it also created, on a request
      // that only asked to connect as a run — and nothing that asks for a run's config has any
      // business writing rows (ADR-0041, D3).
      if (!run) throw new Error(`no run ${runId}`);
      // The run is there but its rows no longer resolve, so there are no live credentials to
      // restore. `resolveLive` is asked again for the reason, which names what is missing.
      return resolveLive(run.simulationId);
    };

    control = {
      store,
      processConfig,
      hasApiKey: () => options.provider !== undefined,
      ...(options.provider ? { provider: options.provider } : {}),
      ...(typesafe ? { typesafe: () => typesafe } : {}),
      jobs,
      runs,
      hub,
      configForRun,
      sweep: async (runId: string, sweepOptions: SweepOptions, report: (progress: Partial<Job["progress"]>) => Promise<void>) => {
        await report({ label: "finding the accounts this run created" });
        const config = await configForRun(runId);
        const result = await sweepRun(store, config, runId, sweepOptions);
        for (const line of result.lines) log(`populace sweep: ${line}`);
        // The honest sentence has to reach the BROWSER, not just this process's stdout: a static
        // run otherwise showed a job called "removing the accounts this run created" completing
        // happily with nothing anywhere saying the accounts were deliberately left in place.
        const summary = [
          result.removed > 0 ? `${result.removed} account(s) removed` : "",
          result.preExisting > 0 ? `${result.preExisting} used pre-existing accounts; populace did not create them and has not removed them` : "",
          result.stranded > 0 ? `${result.stranded} could not be removed and ${result.stranded === 1 ? "is" : "are"} still on the target` : "",
          result.failures > 0 ? `${result.failures} failed` : "",
        ].filter((part) => part !== "");
        await report({ label: summary.length > 0 ? summary.join("; ") : "nothing was tagged for this run" });
        return result;
      },
    };
  }

  /**
   * The config ONE RUN executed, for the read routes that cannot render without one. It resolves
   * that run's STUDY — there is no process-wide "the config" any more, because there is no
   * process-wide project (SPEC §6).
   */
  const configForRunRead = (runId: string): Promise<PopulaceConfig | undefined> => liveConfigForRun(store, runId, resolveLive);

  const app = createApp({
    store,
    storePath: options.storePath,
    version: options.version,
    configForRun: configForRunRead,
    ...(options.provider ? { verifier: options.provider() } : {}),
    ...(typesafe ? { typesafe } : {}),
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

import type { Job, PopulaceConfig, Store } from "@populace/core";
import type { ModelProvider } from "@populace/runner";
import type { ProcessConfig } from "./config-store.js";
import type { EventHub } from "./events.js";
import type { JobRunner } from "./jobs.js";
import type { RunController } from "./runs.js";
import type { SweepOptions, SweepResult } from "./sweep.js";

/**
 * What the control routes need in order to author config and drive runs.
 *
 * There is no `projectId` here any more. It used to be closed over once per process, which is the
 * shape that encoded "there is exactly one project": every authoring handler now reads `:p` out of
 * the path, so one `serve` holds as many projects as the store does and a handler cannot answer
 * for the wrong one (SPEC §6).
 */
export interface ControlDeps {
  store: Store;
  /** Where the database and the digest directory live — process facts, never project rows. */
  processConfig: ProcessConfig;
  /** Whether this process can call the model at all. Without a key, a run is not startable. */
  hasApiKey(): boolean;
  provider?: () => ModelProvider;
  jobs: JobRunner;
  runs: RunController;
  hub: EventHub;
  /**
   * The config a past run actually executed, read from its snapshot. A digest rebuilt today must
   * use the config that produced the findings, not whatever the forms say now (ADR-0024).
   */
  configForRun(runId: string): Promise<PopulaceConfig>;
  sweep(runId: string, options: SweepOptions, report: (progress: Partial<Job["progress"]>) => Promise<void>): Promise<SweepResult>;
}

export interface ServerDeps {
  store: Store;
  storePath: string;
  version: string;
  /**
   * The config ONE RUN executed, for the read routes that cannot be rendered without one: the
   * tool list a coverage-gaps screen measures against, and the guardrail a spend view is read
   * against. It is per run, from that run's snapshot — the process-wide `config()` thunk it
   * replaces was the last place a singleton project was assumed.
   */
  configForRun?: (runId: string) => Promise<PopulaceConfig | undefined>;
  /** Model provider for the verifier. Absent means a `model` judge cannot run; a heuristic one can. */
  verifier?: ModelProvider;
  /** Present once the process can drive runs. Absent leaves the API read-only, exactly as M1 was. */
  control?: ControlDeps;
}

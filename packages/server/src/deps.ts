import type { Job, PopulaceConfig, Store } from "@populace/core";
import type { ModelProvider } from "@populace/runner";
import type { ProcessConfig } from "./config-store.js";
import type { EventHub } from "./events.js";
import type { JobRunner } from "./jobs.js";
import type { RunController } from "./runs.js";
import type { SweepOptions, SweepResult } from "./sweep.js";

/** What the M2 routes need in order to author config and drive runs. */
export interface ControlDeps {
  store: Store;
  projectId?: string;
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
   * Resolves the config the read routes render. In M2 this assembles the authored rows; a test or
   * a CLI command that already holds a `PopulaceConfig` passes one back directly.
   */
  config: () => Promise<PopulaceConfig>;
  /** Model provider for the verifier. Absent means a `model` judge cannot run; a heuristic one can. */
  verifier?: ModelProvider;
  /** Present once the process can drive runs. Absent leaves the API read-only, exactly as M1 was. */
  control?: ControlDeps;
}

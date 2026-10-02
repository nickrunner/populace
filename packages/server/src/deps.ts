import type { Job, PopulaceConfig, Store } from "@populace/core";
import type { TypesafeClient } from "@populace/reports";
import type { ModelProvider } from "@populace/runner";
import type { ProcessConfig } from "./config-store.js";
import type { EventHub } from "./events.js";
import type { GithubClient } from "./github.js";
import type { JobRunner } from "./jobs.js";
import type { IssueClient } from "./publish-issues.js";
import type { RunController } from "./runs.js";
import type { SweepOptions, SweepResult } from "./sweep.js";

/**
 * Everything the routes ask github.com, which is the publisher's slice plus the check's one
 * operation. Typed off `GithubClient` rather than restated, so an operation renamed there is a
 * compile error here instead of a runtime surprise, and so a test double that satisfies this
 * satisfies the publisher too.
 */
export type IssuesClient = IssueClient & Pick<GithubClient, "getRepo">;

/**
 * How a client is built from a connection: the repository it is scoped to and the token it speaks
 * with, and nothing else. It is a FACTORY rather than a client because the token is per project
 * and is read at the moment it is needed — a long-lived client would be a credential held open
 * across requests for projects it has nothing to do with (ADR-0040).
 */
export type IssuesClientFactory = (connection: { repo: string; token: string }) => IssuesClient;

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
   * The config a past run actually executed, ready to connect with: its snapshot (ADR-0024) with
   * the live credentials put back (`liveConfigForRun`). Everything reached through here goes on to
   * call the target — sweep, the digest job's replay, a coverage tool list — so it THROWS rather
   * than hand back a plan whose credentials are still `[redacted]`.
   */
  configForRun(runId: string): Promise<PopulaceConfig>;
  sweep(runId: string, options: SweepOptions, report: (progress: Partial<Job["progress"]>) => Promise<void>): Promise<SweepResult>;
  /**
   * Builds the client that talks to github.com. Absent means the real one, which is what `serve`
   * leaves it as; the tests pass a double, because nothing in the suite may reach the network and
   * nothing in it holds a token.
   */
  githubClient?: IssuesClientFactory;
  /**
   * The typed judge's client, built from `TYPESAFE_API_KEY` by whoever reads the environment.
   *
   * Its ABSENCE is the flag — there is no `hasTypesafeKey()` beside `hasApiKey()` — because there
   * is nothing lazy to protect here: building one is reading a string, where `provider()` throws
   * when the process has no model key and so needs a boolean that can be asked without throwing.
   * Without this, `verifier.judge: "typesafe"` throws once per finding from inside the verifier;
   * with it, the digest job refuses at the pre-flight with a sentence naming the key.
   */
  typesafe?: () => TypesafeClient;
}

export interface ServerDeps {
  store: Store;
  storePath: string;
  version: string;
  /**
   * The config ONE RUN executed, with its live credentials (`liveConfigForRun`): the tool list a
   * coverage-gaps screen measures against, and the replay behind `?verify=1`, both of which call
   * the target. It is per run, from that run's snapshot — the process-wide `config()` thunk it
   * replaces was the last place a singleton project was assumed.
   *
   * `undefined` means this run cannot be connected as, and nothing may fall back to its redacted
   * snapshot to try anyway; the routes that only DESCRIBE a run read that snapshot directly.
   */
  configForRun?: (runId: string) => Promise<PopulaceConfig | undefined>;
  /** Model provider for the verifier. Absent means a `model` judge cannot run; a heuristic one can. */
  verifier?: ModelProvider;
  /**
   * The typed judge's client, for `GET /runs/:id/digest?verify=true`. Absent means a `typesafe`
   * judge cannot run, and the route says so at its pre-flight rather than letting `verifyFinding`
   * throw once per finding.
   */
  typesafe?: TypesafeClient;
  /** Present once the process can drive runs. Absent leaves the API read-only, exactly as M1 was. */
  control?: ControlDeps;
}

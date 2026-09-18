import { identityProviderFor } from "@populace/adapters";
import { newRunId, tagForRun, type PopulaceConfig, type Run, type Store } from "@populace/core";
import { LocalDaemon, type ModelProvider, type WakeResult } from "@populace/runner";
import { snapshotConfig } from "./config-store.js";

export interface RunControllerDeps {
  store: Store;
  provider(): ModelProvider;
  log?: (line: string) => void;
}

export interface StartRunOptions {
  config: PopulaceConfig;
  projectId: string;
  targetId: string;
  label: string;
  /** Carry a previous run's agents, memory and accounts forward (ADR-0020). */
  continueFrom?: string;
  continuationReason?: string;
}

interface ActiveRun {
  daemon: LocalDaemon;
  /** Set once a stop has been asked for, so a second click does not queue a second stop. */
  stopping: "drain" | "now" | null;
  finished: Promise<void>;
}

/**
 * The daemon, made callable from HTTP. Everything here is lifecycle: which runs are in flight in
 * this process, and how the run row and the event log follow them. It does not touch what an agent
 * does inside a visit — `runWake()` is unchanged, which is the invariant the whole web product is
 * arranged around.
 */
export class RunController {
  private readonly active = new Map<string, ActiveRun>();

  constructor(private readonly deps: RunControllerDeps) {}

  get store(): Store {
    return this.deps.store;
  }

  isRunning(runId: string): boolean {
    return this.active.has(runId);
  }

  get runningIds(): string[] {
    return [...this.active.keys()];
  }

  /**
   * Creates the run row, freezes its config and starts ticking. The row and the snapshot are
   * written before the first wake, so a browser that reloads immediately still finds the run.
   */
  async start(options: StartRunOptions, onProgress?: (wakes: number) => void): Promise<Run> {
    const kill = await this.store.getKillSwitch();
    if (kill.engaged) throw new Error(`everything is stopped${kill.reason ? ` (${kill.reason})` : ""}; release the stop before starting a run`);

    const snapshot = await snapshotConfig(this.store, options.config);
    const runId = newRunId();
    const startedAt = new Date().toISOString();
    const run: Run = {
      id: runId,
      projectId: options.projectId,
      targetId: options.targetId,
      populationId: options.config.population.id,
      label: options.label,
      status: "pending",
      configSnapshotId: snapshot.id,
      parentRunId: options.continueFrom ?? null,
      continuation: options.continueFrom ? { reason: options.continuationReason ?? "", carriedAgents: 0, returningAfterGiveUp: 0 } : null,
      startedAt,
      endedAt: null,
      totals: { agents: 0, activeAgents: 0, wakes: 0, findings: 0, confirmed: 0, costUsd: 0 },
    };
    await this.store.saveRun(run);

    const daemon = new LocalDaemon(
      {
        config: options.config,
        runId,
        ...(options.continueFrom ? { continueFrom: options.continueFrom } : {}),
        onWake: (result: WakeResult) => {
          onProgress?.(daemon.wakesRun);
          this.deps.log?.(`[run ${runId}] ${result.wake.agentId} ${result.wake.status} $${result.wake.costUsd.toFixed(4)}`);
        },
      },
      {
        store: this.store,
        provider: this.deps.provider(),
        identityProvider: identityProviderFor(options.config.identity),
        ...(this.deps.log ? { log: this.deps.log } : {}),
      },
    );

    const agents = await daemon.reconcile();
    const carried = agents.filter((a) => a.continuedFrom !== null);
    const running: Run = {
      ...run,
      status: "running",
      totals: { ...run.totals, agents: agents.length, activeAgents: agents.filter((a) => a.status === "active").length },
      ...(run.continuation ? { continuation: { ...run.continuation, carriedAgents: carried.length, returningAfterGiveUp: carried.filter((a) => a.continuedFrom?.gaveUp === true).length } } : {}),
    };
    await this.store.saveRun(running);
    await this.store.appendEvent({
      runId,
      wakeId: null,
      type: "run.started",
      payload: { label: running.label, agents: agents.length, populationId: running.populationId, parentRunId: running.parentRunId, carriedAgents: running.continuation?.carriedAgents ?? 0 },
    });

    const finished = this.drive(runId, daemon);
    this.active.set(runId, { daemon, stopping: null, finished });
    return running;
  }

  /** Runs the tick loop to completion and settles the run row however it ended. */
  private async drive(runId: string, daemon: LocalDaemon): Promise<void> {
    let error: string | null = null;
    try {
      await daemon.run();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      this.deps.log?.(`[run ${runId}] failed: ${error}`);
    }
    const entry = this.active.get(runId);
    this.active.delete(runId);
    const run = await this.store.getRun(runId);
    if (!run) return;
    // A drain that the user asked for is a pause, not a completion: the agents still have visits
    // left and the run can be carried on. Only an exhausted population is `completed`.
    const status: Run["status"] = error !== null ? "failed" : entry?.stopping === "now" ? "killed" : entry?.stopping === "drain" ? "paused" : "completed";
    const ended = new Date().toISOString();
    await this.store.saveRun({ ...run, status, endedAt: ended });
    await this.store.appendEvent({ runId, wakeId: null, type: "run.ended", payload: { status, error, wakes: daemon.wakesRun } });
  }

  /**
   * `drain` lets the wakes already in flight finish and stops scheduling more. `now` engages the
   * store's kill switch, which every in-flight wake checks between turns, so it stops mid-visit.
   *
   * The kill switch stays engaged afterwards. "Stop everything now" that quietly re-armed itself
   * would be a worse safety property than the CLI's, and the browser has a release control.
   */
  async stop(runId: string, mode: "drain" | "now"): Promise<Run | undefined> {
    const entry = this.active.get(runId);
    if (!entry) return this.store.getRun(runId);
    entry.stopping = mode;
    if (mode === "now") await this.store.setKillSwitch(true, `stopped from the dashboard (${runId})`);
    entry.daemon.stop();
    await entry.finished;
    return this.store.getRun(runId);
  }

  /**
   * "Send one more round": bring every active agent's next visit forward to now, so the next tick
   * wakes all of them instead of waiting out the cadence.
   */
  async round(runId: string): Promise<number> {
    const agents = await this.store.listAgents({ runId, status: "active" });
    const at = new Date().toISOString();
    for (const agent of agents) await this.store.upsertAgent({ ...agent, nextWakeAt: at });
    await this.store.appendEvent({ runId, wakeId: null, type: "run.status", payload: { action: "round", agents: agents.length } });
    return agents.length;
  }

  /** The tag every identity, wake and finding of a run carries, which is what `sweep` matches on. */
  tagFor(runId: string): string {
    return tagForRun(runId);
  }

  /**
   * A run row left `running` by a process that died is a lie the dashboard would show forever, so
   * an open reconciles them. This is exactly the distinction the derived M1 model could not make.
   */
  async reconcileOrphans(): Promise<number> {
    const stale = [...(await this.store.listRuns({ status: "running" })), ...(await this.store.listRuns({ status: "pending" }))];
    let fixed = 0;
    for (const run of stale) {
      if (this.active.has(run.id)) continue;
      const wakes = await this.store.listWakes({ runIds: [run.id] });
      const last = wakes[wakes.length - 1];
      await this.store.saveRun({ ...run, status: "failed", endedAt: run.endedAt ?? last?.endedAt ?? last?.startedAt ?? new Date().toISOString() });
      fixed++;
    }
    return fixed;
  }

  /** Stops every in-flight run without engaging the kill switch. Used when `serve` shuts down. */
  async shutdown(): Promise<void> {
    await Promise.all(
      [...this.active.entries()].map(async ([, entry]) => {
        entry.stopping = "drain";
        entry.daemon.stop();
        await entry.finished;
      }),
    );
  }
}

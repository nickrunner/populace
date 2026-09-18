import { identityProviderFor } from "@populace/adapters";
import { newRunId, tagForRun, type JsonValue, type PauseReason, type PopulaceConfig, type Run, type Store } from "@populace/core";
import { LocalDaemon, type ModelProvider, type WakeResult } from "@populace/runner";
import { snapshotConfig, withLiveSecrets } from "./config-store.js";
import { sweepRun } from "./sweep.js";
import { resetTarget } from "./target-reset.js";

export interface RunControllerDeps {
  store: Store;
  provider(): ModelProvider;
  /**
   * Re-resolves a simulation's config from the authored rows. Two things need it: a resume, which
   * executes the frozen snapshot but has to put the live credentials back into it (a snapshot is
   * redacted by design), and "apply changes to the running execution", which is a re-resolve by
   * definition. A process without it can still start and stop runs.
   */
  resolve?(simulationId: string): Promise<PopulaceConfig>;
  log?: (line: string) => void;
}

export interface StartRunOptions {
  config: PopulaceConfig;
  projectId: string;
  /** The simulation this execution belongs to. Its `seq` is counted within it. */
  simulationId: string;
  targetId: string;
  label: string;
  /**
   * Carry a previous run's agents, memory and accounts forward (ADR-0020). Only ever set for an
   * explicit carry-forward: "run it again" is a SIBLING execution with no inheritance at all,
   * which is the entire implementation of an ephemeral clean slate (SPEC §4.2).
   */
  continueFrom?: string;
  continuationReason?: string;
}

interface ActiveRun {
  daemon: LocalDaemon;
  /** The config this run is executing, kept so a sweep at the end knows where the accounts are. */
  config: PopulaceConfig;
  /** Set once a stop has been asked for, so a second click does not queue a second stop. */
  stopping: "drain" | "now" | null;
  /** Why it is draining, written onto the row when it settles. */
  pauseReason: PauseReason;
  finished: Promise<void>;
}

/**
 * Serialises work under a key, so a check-then-act that spans several awaits cannot interleave
 * with itself.
 *
 * Both `start` and `resume` are exactly that shape: they read the store, decide, and only then
 * register the daemon they built. Two overlapping resumes of one run therefore both passed the
 * "is it already going?" guard and both built a `LocalDaemon` on the SAME run id, and only one of
 * them could ever be reached by `pause`, `stop` or `shutdown` afterwards — the other kept calling
 * the model and writing visits on a run the dashboard showed as paused.
 */
class KeyedGate {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    // Registered BEFORE the await below, so the next caller queues behind this one rather than
    // racing it: the map is written synchronously, which is the whole point.
    const tail = previous.then(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    this.tails.set(key, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

/**
 * The daemon, made callable from HTTP. Everything here is lifecycle: which runs are in flight in
 * this process, and how the run row and the event log follow them. It does not touch what an agent
 * does inside a visit — `runWake()` is unchanged, which is the invariant the whole web product is
 * arranged around.
 */
export class RunController {
  private readonly active = new Map<string, ActiveRun>();
  /** One start per simulation and one resume per run at a time. See `KeyedGate`. */
  private readonly gate = new KeyedGate();

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
    // Under the gate: `seq` is `max(seq) + 1` read from the store, and two simultaneous starts of
    // one simulation would otherwise both mint the same execution number — and, worse, the second
    // one would reset the target out from under the first (below).
    return this.gate.run(options.simulationId, () => this.startOne(options, onProgress));
  }

  private async startOne(options: StartRunOptions, onProgress?: (wakes: number) => void): Promise<Run> {
    const kill = await this.store.getKillSwitch();
    if (kill.engaged) throw new Error(`everything is stopped${kill.reason ? ` (${kill.reason})` : ""}; release the stop before starting a run`);

    const config = options.config;
    const snapshot = await snapshotConfig(this.store, config);
    const runId = newRunId();
    const startedAt = new Date().toISOString();
    // Executions of one simulation are numbered within it: "execution 3" is how the user names a
    // run, and it is independent of the `parentRunId` lineage a carry-forward creates. It is the
    // highest `seq` so far plus one rather than a count, so deleting an execution never hands its
    // number to the next one.
    const siblings = await this.store.listRuns({ simulationId: options.simulationId });
    // One execution of a simulation at a time. An ephemeral start RESETS THE TARGET (below), so a
    // second execution begun while the first is still going wipes the database out from under the
    // people already in it, and every report they file afterwards is against a state nobody asked
    // for. Pause or stop the one that is going, or carry it forward when it has ended.
    const live = siblings.find((run) => run.status === "running" || run.status === "pending" || this.active.has(run.id));
    if (live) throw new Error(`execution ${live.seq} of this simulation is still going (${live.id}); pause or stop it before starting another`);
    const seq = siblings.reduce((highest, run) => Math.max(highest, run.seq), 0) + 1;
    const run: Run = {
      id: runId,
      projectId: options.projectId,
      simulationId: options.simulationId,
      seq,
      // Copied, never read back from the simulation: changing a simulation's mode afterwards must
      // not rewrite what an execution already was.
      mode: config.simulation.mode,
      targetId: options.targetId,
      populationId: config.population.id,
      label: options.label,
      status: "pending",
      configSnapshotId: snapshot.id,
      parentRunId: options.continueFrom ?? null,
      continuation: options.continueFrom ? { reason: options.continuationReason ?? "", carriedAgents: 0, returningAfterGiveUp: 0 } : null,
      pauseReason: null,
      resumes: 0,
      lastResumedAt: null,
      sweptAt: null,
      startedAt,
      endedAt: null,
      totals: { agents: 0, activeAgents: 0, wakes: 0, findings: 0, confirmed: 0, costUsd: 0 },
    };
    await this.store.saveRun(run);

    // An ephemeral execution puts the target back before its first visit, where the target offers
    // a way. Where it does not, the event says so in words rather than the run pretending.
    if (run.mode === "ephemeral" && options.continueFrom === undefined) {
      const outcome = await resetTarget(this.store, config, { runId, projectId: options.projectId, simulationId: options.simulationId });
      this.deps.log?.(`[run ${runId}] ${outcome.applied ? (outcome.ok ? "target reset" : "target reset FAILED") : "no target reset"}: ${outcome.detail}`);
    }

    const daemon = this.build(runId, config, options.continueFrom, onProgress);
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
      payload: {
        label: running.label,
        agents: agents.length,
        populationId: running.populationId,
        simulationId: running.simulationId,
        seq: running.seq,
        mode: running.mode,
        parentRunId: running.parentRunId,
        carriedAgents: running.continuation?.carriedAgents ?? 0,
      },
    });

    const finished = this.drive(runId, daemon, config);
    this.active.set(runId, { daemon, config, stopping: null, pauseReason: "user", finished });
    return running;
  }

  /** A daemon on one run id. The same shape for a start, a carry-forward and a resume. */
  private build(runId: string, config: PopulaceConfig, continueFrom: string | undefined, onProgress?: (wakes: number) => void): LocalDaemon {
    const daemon: LocalDaemon = new LocalDaemon(
      {
        config,
        runId,
        ...(continueFrom ? { continueFrom } : {}),
        onWake: (result: WakeResult) => {
          onProgress?.(daemon.wakesRun);
          this.deps.log?.(`[run ${runId}] ${result.wake.agentId} ${result.wake.status} $${result.wake.costUsd.toFixed(4)}`);
        },
      },
      {
        store: this.store,
        provider: this.deps.provider(),
        identityProvider: identityProviderFor(config.identity),
        ...(this.deps.log ? { log: this.deps.log } : {}),
      },
    );
    return daemon;
  }

  /** Runs the tick loop to completion and settles the run row however it ended. */
  private async drive(runId: string, daemon: LocalDaemon, config: PopulaceConfig): Promise<void> {
    let error: string | null = null;
    try {
      await daemon.run();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      this.deps.log?.(`[run ${runId}] failed: ${error}`);
    }
    // The entry stays in `active` until everything below has happened, because `settled()` waits on
    // this promise BY LOOKING THE ENTRY UP: deleting it first hands a caller a resolved promise
    // while the row is still being written, and the caller then reads a run that has not settled.
    try {
      const entry = this.active.get(runId);
      const run = await this.store.getRun(runId);
      if (!run) return;
      // A drain that somebody asked for is a PAUSE, not a completion: the participants still have
      // visits left and the execution can be picked back up. Only an exhausted population is
      // `completed`, and only a throw is `failed`.
      const status: Run["status"] = error !== null ? "failed" : entry?.stopping === "now" ? "killed" : entry?.stopping === "drain" ? "paused" : "completed";
      const ended = new Date().toISOString();
      const settled: Run = { ...run, status, endedAt: ended, pauseReason: status === "paused" ? (entry?.pauseReason ?? "user") : null };
      await this.store.saveRun(settled);
      await this.store.appendEvent({ runId, wakeId: null, type: "run.ended", payload: { status, error, wakes: daemon.wakesRun, pauseReason: settled.pauseReason } });
      if (status === "completed" || status === "killed") await this.autoSweep(settled, config);
    } finally {
      this.active.delete(runId);
    }
  }

  /**
   * An ephemeral execution that has ended takes its accounts with it (SPEC §2.7). Without this, a
   * simulation run ten times leaves ten cohorts of abandoned accounts on somebody's product.
   *
   * Only the accounts: `keepData` is always true here, because the evidence is the point of having
   * run at all, and the digest is read after the run ends.
   */
  private async autoSweep(run: Run, config: PopulaceConfig): Promise<void> {
    if (run.mode !== "ephemeral" || !config.simulation.autoSweep || run.sweptAt !== null) return;
    try {
      const result = await sweepRun(this.store, config, run.id, { dryRun: false, keepData: true });
      for (const line of result.lines) this.deps.log?.(`[run ${run.id}] ${line}`);
      await this.store.appendEvent({
        runId: run.id,
        wakeId: null,
        type: "run.status",
        payload: { action: "swept", identities: result.identities, removed: result.removed, failures: result.failures },
      });
    } catch (err) {
      this.deps.log?.(`[run ${run.id}] the accounts could not be swept: ${err instanceof Error ? err.message : String(err)}`);
    }
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
   * Pause: stop spending, keep everything. The row settles to `paused` with `pauseReason: "user"`,
   * which is not terminal any more — memory, accounts and visit counts are all still there,
   * because they are keyed by this run id and this run id is not going anywhere.
   */
  async pause(runId: string): Promise<Run | undefined> {
    const entry = this.active.get(runId);
    if (entry) {
      entry.pauseReason = "user";
      return this.stop(runId, "drain");
    }
    // A run this process is not driving (another process died holding it) is settled directly, so
    // the row stops claiming to be running and can be picked back up.
    const run = await this.store.getRun(runId);
    if (!run || (run.status !== "running" && run.status !== "pending")) return run;
    const paused: Run = { ...run, status: "paused", pauseReason: "user", endedAt: run.endedAt ?? new Date().toISOString() };
    await this.store.saveRun(paused);
    await this.store.appendEvent({ runId, wakeId: null, type: "run.status", payload: { action: "paused", reason: "user" } });
    return paused;
  }

  /**
   * Resume: the SAME run id, picked back up.
   *
   * Nothing is copied and nothing is cleared. Memory is keyed `(runId, agentId)` and the run id has
   * not changed, so it is simply still there; `reconcile()` keeps every agent's runtime state and
   * reschedules only the ones with no next visit booked. Visit numbering continues.
   */
  async resume(runId: string, onProgress?: (wakes: number) => void): Promise<Run> {
    // Under the gate: a double click used to put two daemons on one run id, of which `pause`,
    // `stop` and `shutdown` could only ever reach the second. The first went on spending.
    return this.gate.run(runId, () => this.resumeOne(runId, onProgress));
  }

  private async resumeOne(runId: string, onProgress?: (wakes: number) => void): Promise<Run> {
    const existing = this.active.get(runId);
    if (existing) {
      const run = await this.store.getRun(runId);
      if (!run) throw new Error(`no run ${runId}`);
      return run;
    }
    const run = await this.store.getRun(runId);
    if (!run) throw new Error(`no run ${runId}`);
    if (run.status !== "paused") throw new Error(`only a paused execution can be picked back up; ${runId} is ${run.status}`);
    const kill = await this.store.getKillSwitch();
    if (kill.engaged) throw new Error(`everything is stopped${kill.reason ? ` (${kill.reason})` : ""}; release the stop before picking a run back up`);

    const config = await this.configFor(run);
    const resumed: Run = { ...run, status: "running", pauseReason: null, resumes: run.resumes + 1, lastResumedAt: new Date().toISOString(), endedAt: null };
    await this.store.saveRun(resumed);
    const daemon = this.build(runId, config, undefined, onProgress);
    const agents = await daemon.reconcile();
    await this.store.appendEvent({ runId, wakeId: null, type: "run.status", payload: { action: "resumed", resumes: resumed.resumes, agents: agents.length } });
    const finished = this.drive(runId, daemon, config);
    this.active.set(runId, { daemon, config, stopping: null, pauseReason: "user", finished });
    return resumed;
  }

  /**
   * The config a run is executing: its frozen snapshot (ADR-0024), with the live credentials put
   * back into it. A snapshot never holds a secret, so a resume that ran the snapshot verbatim
   * would authenticate to the target with the string `[redacted]`.
   */
  private async configFor(run: Run): Promise<PopulaceConfig> {
    const snapshot = run.configSnapshotId ? await this.store.getConfigSnapshot(run.configSnapshotId) : undefined;
    if (!snapshot) {
      if (!this.deps.resolve) throw new Error(`run ${run.id} has no frozen config to pick back up`);
      return this.deps.resolve(run.simulationId);
    }
    if (!this.deps.resolve) return snapshot.config;
    try {
      return withLiveSecrets(snapshot.config, await this.deps.resolve(run.simulationId));
    } catch {
      // The rows may have moved on since — a deleted target, a renamed persona. The frozen plan is
      // still what this run is executing, and it is better than refusing to pick it back up.
      return snapshot.config;
    }
  }

  /**
   * "Apply changes to the running execution" (SPEC §4.2). A run executes a frozen snapshot, so an
   * edit is invisible to it until this says otherwise — explicitly, with the change recorded.
   *
   * Longitudinal only. An ephemeral execution is edited and run again, which is a sibling with a
   * clean slate; rewriting the plan underneath a bounded execution would make "execution 3" mean
   * two different things.
   */
  async applyChanges(runId: string): Promise<Run> {
    const run = await this.store.getRun(runId);
    if (!run) throw new Error(`no run ${runId}`);
    if (run.mode !== "longitudinal") throw new Error("only a longitudinal execution takes changes while it runs; edit the simulation and run it again");
    if (!this.deps.resolve) throw new Error("this process cannot re-resolve a simulation's config");
    const config = await this.deps.resolve(run.simulationId);
    const snapshot = await snapshotConfig(this.store, config);
    if (snapshot.id === run.configSnapshotId) return run;
    const before = run.configSnapshotId ? await this.store.getConfigSnapshot(run.configSnapshotId) : undefined;
    const updated: Run = { ...run, configSnapshotId: snapshot.id, populationId: config.population.id };
    await this.store.saveRun(updated);
    await this.store.appendEvent({
      runId,
      wakeId: null,
      type: "run.config",
      payload: { from: run.configSnapshotId, to: snapshot.id, ...cohortChanges(before?.config, config) },
    });
    const entry = this.active.get(runId);
    if (entry) {
      entry.config = config;
      entry.daemon.applyConfig(config);
      // Added cohorts get fresh participants at visit 1, removed ones retire as `scaled-down`, and
      // everybody else keeps their memory — which is what `reconcile()` has always done.
      await entry.daemon.reconcile();
    } else {
      await this.build(runId, config, undefined).reconcile();
    }
    return updated;
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
   * an open reconciles them — to `paused`, not to `failed`.
   *
   * "Runs forever" on a laptop means "runs as long as `serve` does", and the honest UI for that is
   * an execution you can pick back up, not one marked broken. `failed` is reserved for a run that
   * actually threw.
   */
  async reconcileOrphans(): Promise<number> {
    const stale = [...(await this.store.listRuns({ status: "running" })), ...(await this.store.listRuns({ status: "pending" }))];
    let fixed = 0;
    for (const run of stale) {
      if (this.active.has(run.id)) continue;
      const wakes = await this.store.listWakes({ runIds: [run.id] });
      const last = wakes[wakes.length - 1];
      await this.store.saveRun({
        ...run,
        status: "paused",
        pauseReason: "process-ended",
        endedAt: run.endedAt ?? last?.endedAt ?? last?.startedAt ?? new Date().toISOString(),
      });
      await this.store.appendEvent({ runId: run.id, wakeId: null, type: "run.status", payload: { action: "paused", reason: "process-ended" } });
      fixed++;
    }
    return fixed;
  }

  /** Resolves once a run this process is driving has settled. Returns at once for any other. */
  async settled(runId: string): Promise<void> {
    await this.active.get(runId)?.finished;
  }

  /** Stops every in-flight run without engaging the kill switch. Used when `serve` shuts down. */
  async shutdown(): Promise<void> {
    await Promise.all(
      [...this.active.entries()].map(async ([, entry]) => {
        entry.stopping = "drain";
        // The process is going away, not the user asking for a pause — and the difference is what
        // the run screen says when it is opened again.
        entry.pauseReason = "process-ended";
        entry.daemon.stop();
        await entry.finished;
      }),
    );
  }
}

/** What an "apply changes" actually changed about who is going, for the `run.config` event. */
function cohortChanges(before: PopulaceConfig | undefined, after: PopulaceConfig): { added: JsonValue; removed: JsonValue; resized: JsonValue } {
  const was = new Map((before?.population.members ?? []).map((member) => [member.cohort, member.count]));
  const now = new Map(after.population.members.map((member) => [member.cohort, member.count]));
  return {
    added: [...now.keys()].filter((cohort) => !was.has(cohort)),
    removed: [...was.keys()].filter((cohort) => !now.has(cohort)),
    resized: [...now.entries()].flatMap(([cohort, count]) => {
      const previous = was.get(cohort);
      return previous === undefined || previous === count ? [] : [`${cohort}: ${previous} → ${count}`];
    }),
  };
}

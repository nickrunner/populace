import { CadenceScheduler, cadenceFor, expandPopulation, type Agent, type Cadence, type PopulaceConfig, type Scheduler, type Store } from "@populace/core";
import { runWake, type WakeDeps, type WakeResult } from "./wake.js";

export interface DaemonOptions {
  config: PopulaceConfig;
  runId: string;
  scheduler?: Scheduler;
  /** Stop after every agent has reached maxWakes (or this many wakes in total). */
  stopAfterTotalWakes?: number;
  onWake?: (result: WakeResult) => void;
}

/**
 * Local mode: an in-process tick loop that claims due agents and runs their
 * wakes (ADR-0019). Nothing here is agent-specific; a cloud scheduler would
 * replace only this file.
 */
export class LocalDaemon {
  private readonly scheduler: Scheduler;
  private running = false;
  private inFlight = 0;
  private totalWakes = 0;
  private timer: NodeJS.Timeout | null = null;
  private stopResolve: (() => void) | null = null;

  constructor(
    private readonly options: DaemonOptions,
    private readonly deps: WakeDeps,
  ) {
    this.scheduler = options.scheduler ?? new CadenceScheduler();
  }

  private get store(): Store {
    return this.deps.store;
  }

  private cadenceOf(agent: Agent): Cadence {
    const population = this.options.config.population;
    const member = population.members.find((m) => m.persona.id === agent.persona.id);
    return member ? cadenceFor(population, member) : population.cadence;
  }

  /** Creates (or reconciles) the agents for the population and schedules their first wakes. */
  async reconcile(now: Date = new Date()): Promise<Agent[]> {
    const expanded = expandPopulation(this.options.config.population, this.options.runId, now);
    const existing = await this.store.listAgents({ runId: this.options.runId, populationId: this.options.config.population.id });
    const byId = new Map(existing.map((a) => [a.id, a]));
    const wanted = new Set<string>();
    const agents: Agent[] = [];
    for (const { agent, cadence } of expanded) {
      wanted.add(agent.id);
      const current = byId.get(agent.id);
      if (current) {
        // Keep runtime state; refresh persona and limits from config.
        const merged: Agent = { ...current, persona: agent.persona, maxWakes: agent.maxWakes, status: current.status === "retired" && agent.maxWakes !== null && current.wakeCount < agent.maxWakes ? "active" : current.status };
        if (merged.status === "active" && merged.nextWakeAt === null) merged.nextWakeAt = this.scheduler.firstWakeAt(merged, cadence, now).toISOString();
        await this.store.upsertAgent(merged);
        agents.push(merged);
      } else {
        const fresh: Agent = { ...agent, nextWakeAt: this.scheduler.firstWakeAt(agent, cadence, now).toISOString() };
        await this.store.upsertAgent(fresh);
        agents.push(fresh);
      }
    }
    // Scale-down: agents no longer in the population are retired, never deleted (their history stays).
    for (const agent of existing) {
      if (!wanted.has(agent.id) && agent.status === "active") await this.store.upsertAgent({ ...agent, status: "retired", nextWakeAt: null });
    }
    return agents;
  }

  /** One scheduler tick: run every due agent up to the concurrency limit. Returns the number of wakes started. */
  async tick(now: Date = new Date()): Promise<number> {
    const free = this.options.config.daemon.concurrency - this.inFlight;
    if (free <= 0) return 0;
    const due = await this.store.listDueAgents(now, free);
    await Promise.all(
      due.map(async (agent) => {
        // Claim: push nextWakeAt into the future so a concurrent tick does not pick it up again.
        await this.store.upsertAgent({ ...agent, nextWakeAt: new Date(now.getTime() + 3_600_000).toISOString() });
        this.inFlight++;
        try {
          const result = await runWake({ agent, config: this.options.config }, this.deps);
          this.totalWakes++;
          const after = result.agent;
          const next = result.skipped ? new Date(now.getTime() + this.cadenceOf(after).every) : this.scheduler.nextWakeAt(after, this.cadenceOf(after), this.deps.now?.() ?? new Date());
          await this.store.upsertAgent(next ? { ...after, nextWakeAt: next.toISOString() } : { ...after, status: "retired", nextWakeAt: null });
          this.options.onWake?.(result);
        } finally {
          this.inFlight--;
        }
      }),
    );
    return due.length;
  }

  /** Runs the tick loop until `stop()` is called or every agent is retired. */
  async run(): Promise<void> {
    this.running = true;
    await this.reconcile();
    const tickMs = this.options.config.daemon.tick;
    await new Promise<void>((resolve) => {
      this.stopResolve = resolve;
      const loop = async (): Promise<void> => {
        if (!this.running) return;
        try {
          await this.tick();
        } catch (err) {
          this.deps.log?.(`[daemon] tick failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        const active = await this.store.listAgents({ runId: this.options.runId, populationId: this.options.config.population.id, status: "active" });
        const limitReached = this.options.stopAfterTotalWakes !== undefined && this.totalWakes >= this.options.stopAfterTotalWakes;
        if ((active.length === 0 && this.inFlight === 0) || limitReached) {
          this.running = false;
          resolve();
          return;
        }
        this.timer = setTimeout(() => void loop(), tickMs);
      };
      void loop();
    });
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.stopResolve?.();
  }

  get wakesRun(): number {
    return this.totalWakes;
  }
}

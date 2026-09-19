import { CadenceScheduler, cadenceFor, expandPopulation, type Agent, type Cadence, type PopulaceConfig, type Scheduler, type Store } from "@populace/core";
import { runWake, type WakeDeps, type WakeResult } from "./wake.js";

export interface DaemonOptions {
  config: PopulaceConfig;
  runId: string;
  scheduler?: Scheduler;
  /** Stop after every agent has reached maxWakes (or this many wakes in total). */
  stopAfterTotalWakes?: number;
  /**
   * Carry a previous run's agents into this one: their memory, accounts and wake counts come
   * forward, and the ones who walked away return if they said they would. This is the
   * "I shipped a fix, do my users come back?" run; `runId` must be a new run so the two stay
   * separately reportable.
   */
  continueFrom?: string;
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

  /**
   * Keyed by COHORT. It matched on `persona.id`, which silently assumed one member per persona:
   * two cohorts on one persona both matched the first member and shared its cadence, which is
   * precisely what made "25 weekend planners every 10 minutes and 9 sceptics every hour" a
   * population you could describe and not run.
   */
  private cadenceOf(agent: Agent): Cadence {
    const population = this.options.config.population;
    const member = population.members.find((m) => m.cohort === agent.cohortSlug);
    return member ? cadenceFor(population, member) : population.cadence;
  }


  /**
   * Seeds this run's agents from a parent run. Each agent keeps its identity, wake count and
   * memory (copied under the new run id, so the parent's record stays intact); an agent that
   * gave up comes back only if it said it would, and one that hit `maxWakes` gets a fresh
   * allowance from the current config.
   */
  private async seedFromParent(parentRunId: string): Promise<Map<string, Agent>> {
    const seeded = new Map<string, Agent>();
    const parents = await this.store.listAgents({ runId: parentRunId });
    for (const parent of parents) {
      const wakes = await this.store.listWakes({ runIds: [parentRunId], agentId: parent.id });
      const last = wakes[wakes.length - 1];
      const gaveUp = parent.retiredReason === "gave-up";
      // A user who left saying nothing would bring them back does not come back.
      if (gaveUp && last?.wouldReturn !== true) continue;
      const memory = await this.store.getMemory(parentRunId, parent.id);
      if (memory) await this.store.saveMemory({ ...memory, runId: this.options.runId });
      seeded.set(parent.id, {
        ...parent,
        runId: this.options.runId,
        status: "active",
        retiredReason: null,
        nextWakeAt: null,
        continuedFrom: { runId: parentRunId, atWake: parent.wakeCount, gaveUp },
      });
    }
    return seeded;
  }

  /** Creates (or reconciles) the agents for the population and schedules their first wakes. */
  async reconcile(now: Date = new Date()): Promise<Agent[]> {
    const expanded = expandPopulation(this.options.config.population, this.options.runId, this.options.config.simulation.id, now);
    // The identity provider sees one agent at a time, so "every person gets their own account" can
    // only be checked here, where the whole population is visible — and before any row is written
    // or any wake is paid for. A run that will hand two people one login is worse than a refusal.
    const problems = this.deps.identityProvider.checkPopulation?.(expanded.map((e) => e.agent)) ?? [];
    if (problems.length > 0) throw new Error(`this population cannot be given identities: ${problems.join("; ")}`);
    const existing = await this.store.listAgents({ runId: this.options.runId });
    // A continuation seeds from the parent run, but only before this run has agents of its own.
    const continuing = this.options.continueFrom !== undefined;
    const inherited = continuing && existing.length === 0 ? await this.seedFromParent(this.options.continueFrom as string) : new Map<string, Agent>();
    const byId = new Map([...inherited, ...existing.map((a): [string, Agent] => [a.id, a])]);
    const wanted = new Set<string>();
    const agents: Agent[] = [];
    for (const { agent, cadence } of expanded) {
      const current = byId.get(agent.id);
      // A continuation reports on the cohort it inherited; it does not acquire new users.
      // Without this an agent that left for good is replaced by an amnesiac wearing its id,
      // which then shows up in the after-fix digest as if it were the same person.
      if (!current && continuing) continue;
      wanted.add(agent.id);
      if (current) {
        // Keep runtime state; refresh persona and limits from config.
        // Raising maxWakes brings back an agent the limit retired, but never one that walked away.
        const allowance = agent.maxWakes === null ? null : current.wakeCount + agent.maxWakes;
        const maxWakes = current.continuedFrom && current.continuedFrom.atWake === current.wakeCount ? allowance : agent.maxWakes;
        const revivable = current.status === "retired" && current.retiredReason !== "gave-up" && maxWakes !== null && current.wakeCount < maxWakes;
        const merged: Agent = { ...current, persona: agent.persona, maxWakes, ...(revivable ? { status: "active" as const, retiredReason: null } : {}) };
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
      if (!wanted.has(agent.id) && agent.status === "active") await this.store.upsertAgent({ ...agent, status: "retired", retiredReason: "scaled-down", nextWakeAt: null });
    }
    return agents;
  }

  /** One scheduler tick: run every due agent up to the concurrency limit. Returns the number of wakes started. */
  async tick(now: Date = new Date()): Promise<number> {
    const free = this.options.config.daemon.concurrency - this.inFlight;
    if (free <= 0) return 0;
    const due = await this.store.listDueAgents(this.options.runId, now, free);
    await Promise.all(
      due.map(async (agent) => {
        // Claim: push nextWakeAt into the future so a concurrent tick does not pick it up again.
        await this.store.upsertAgent({ ...agent, nextWakeAt: new Date(now.getTime() + 3_600_000).toISOString() });
        this.inFlight++;
        try {
          const result = await runWake({ agent, config: this.options.config }, this.deps);
          this.totalWakes++;
          const after = result.agent;
          // An agent that retired itself during the wake is never rescheduled.
          const next = after.status === "retired" ? null : result.skipped ? new Date(now.getTime() + this.cadenceOf(after).every) : this.scheduler.nextWakeAt(after, this.cadenceOf(after), this.deps.now?.() ?? new Date());
          await this.store.upsertAgent(next ? { ...after, nextWakeAt: next.toISOString() } : { ...after, status: "retired", retiredReason: after.retiredReason ?? "max-wakes", nextWakeAt: null });
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
        // `stop()` resolves `run()` immediately, so a tick that was already in flight when it was
        // called outlives the shutdown it was supposed to end. Checking again after every await is
        // what makes "the daemon has stopped" mean "it has stopped touching the store".
        if (!this.running) return;
        const active = await this.store.listAgents({ runId: this.options.runId, status: "active" });
        if (!this.running) return;
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

  /**
   * Replaces the config this run executes, for "apply changes to the running execution"
   * (SPEC §4.2). A run executes a frozen snapshot, so an edit is invisible to it until something
   * says otherwise; this is that something, and the caller re-snapshots and reconciles around it.
   */
  applyConfig(config: PopulaceConfig): void {
    this.options.config = config;
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

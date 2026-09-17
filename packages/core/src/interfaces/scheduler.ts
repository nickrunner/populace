import type { Agent } from "../schemas/agent.js";
import type { Cadence } from "../schemas/population.js";

/**
 * Decides when an agent wakes next. The local daemon and a cloud scheduler
 * both call `nextWakeAt`; only the loop that acts on it differs (ADR-0019).
 */
export interface Scheduler {
  /** Next wake time for an agent that has just been created (never woken). */
  firstWakeAt(agent: Agent, cadence: Cadence, now: Date): Date;
  /** Next wake time after a wake that ended at `now`. Returns null to retire the agent. */
  nextWakeAt(agent: Agent, cadence: Cadence, now: Date): Date | null;
}

/** Cadence-based scheduler with optional jitter; deterministic when given a random source. */
export class CadenceScheduler implements Scheduler {
  constructor(private readonly random: () => number = Math.random) {}

  firstWakeAt(_agent: Agent, cadence: Cadence, now: Date): Date {
    return new Date(now.getTime() + cadence.initialDelay + this.jitter(cadence));
  }

  nextWakeAt(agent: Agent, cadence: Cadence, now: Date): Date | null {
    if (agent.maxWakes !== null && agent.wakeCount >= agent.maxWakes) return null;
    return new Date(now.getTime() + cadence.every + this.jitter(cadence));
  }

  private jitter(cadence: Cadence): number {
    return cadence.jitter > 0 ? Math.floor(this.random() * cadence.jitter) : 0;
  }
}

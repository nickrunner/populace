import { resolveModel, type PopulaceConfig, type Store, type Wake } from "@populace/core";
import type { RunEstimate } from "@populace/contract";

/**
 * What a run will cost, before anything is spent. The screen promises a figure "worked out from
 * what a visit actually cost on your last run", so history is the first source and the fallback is
 * named in the answer rather than hidden in it.
 *
 * This function reads. It never starts anything, and nothing it returns is binding: it is
 * arithmetic over an average, and the guardrails in the runner are what actually stop spending
 * (ADR-0009).
 */

/**
 * Used only when the store has no wake to learn from. Derived from the reference runs against the
 * mock target: a visit with a few turns against an Opus-class model lands near this once prompt
 * caching is warm. It is deliberately not cheap — a first-time user should be surprised downwards.
 */
export const DEFAULT_COST_PER_WAKE_USD = 0.12;

/** How far either side of the central figure the range runs, when it comes from history. */
const SPREAD = 0.4;

export interface EstimateInput {
  config: PopulaceConfig;
  /** Visits per agent to assume when neither the member nor the population caps them. */
  assumedWakesPerAgent?: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  if (upper === undefined) return null;
  return sorted.length % 2 === 0 && lower !== undefined ? (lower + upper) / 2 : upper;
}

/**
 * Visits the population will make if every agent runs to its cap. An uncapped population has no
 * arithmetic answer, so it is reported as unbounded and the estimate becomes a per-hour rate
 * rather than a total — a number that says "this does not stop on its own" is more use than a
 * large one that pretends it does.
 */
export function plannedVisits(config: PopulaceConfig, assumed: number): { agents: number; visits: number; bounded: boolean; perAgent: { personaId: string; agents: number; visits: number; capped: boolean }[] } {
  const perAgent: { personaId: string; agents: number; visits: number; capped: boolean }[] = [];
  let agents = 0;
  let visits = 0;
  let bounded = true;
  for (const member of config.population.members) {
    const count = Math.ceil(member.count * config.population.scale);
    const cap = member.maxWakes ?? config.population.maxWakes;
    const each = cap ?? assumed;
    if (cap === undefined) bounded = false;
    agents += count;
    visits += count * each;
    perAgent.push({ personaId: member.persona.id, agents: count, visits: count * each, capped: cap !== undefined });
  }
  return { agents, visits, bounded, perAgent };
}

export async function estimateRun(store: Store, input: EstimateInput): Promise<RunEstimate> {
  const assumed = input.assumedWakesPerAgent ?? 4;
  const plan = plannedVisits(input.config, assumed);

  // History from this machine, whatever population produced it: a visit's cost is a property of
  // the model and the target far more than of the persona, and a narrow filter would usually find
  // nothing on the run that most needs the estimate — the first one after a config change.
  const wakes: Wake[] = await store.listWakes({});
  const priced = wakes.filter((w) => w.costUsd > 0).map((w) => w.costUsd);
  const recent = priced.slice(-50);
  const observed = median(recent);

  const perWake = observed ?? DEFAULT_COST_PER_WAKE_USD;
  const central = perWake * plan.visits;
  const spread = observed === null ? 0.6 : SPREAD;

  const model = resolveModel(input.config.model, undefined);
  return {
    basis: observed === null ? "default" : "history",
    sampleSize: observed === null ? 0 : recent.length,
    perWakeUsd: Number(perWake.toFixed(4)),
    agents: plan.agents,
    visits: plan.visits,
    bounded: plan.bounded,
    assumedWakesPerAgent: plan.bounded ? null : assumed,
    lowUsd: Number(Math.max(0, central * (1 - spread)).toFixed(2)),
    expectedUsd: Number(central.toFixed(2)),
    highUsd: Number((central * (1 + spread)).toFixed(2)),
    perPersona: plan.perAgent.map((p) => ({ personaId: p.personaId, agents: p.agents, visits: p.visits, capped: p.capped, expectedUsd: Number((p.visits * perWake).toFixed(2)) })),
    model: model.model,
    effort: model.effort,
    /** The ceilings that will actually stop it, whatever this estimate says (ADR-0009). */
    stops: {
      perWakeUsd: input.config.guardrails.perWake.maxUsd,
      perWakeTurns: input.config.guardrails.perWake.maxTurns,
      dailyUsd: input.config.guardrails.dailyUsd,
      maxWakesPerAgent: input.config.population.maxWakes ?? null,
    },
  };
}

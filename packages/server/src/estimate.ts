import { laneSlugFor, resolveModel, type Guardrails, type ModelConfig, type PopulaceConfig, type Store, type Wake } from "@populace/core";
import type { EstimateView } from "@populace/contract";

/**
 * What a run will cost, before anything is spent. The screen promises a figure "worked out from
 * what a visit actually cost on your last run", so history is the first source and the fallback is
 * named in the answer rather than hidden in it.
 *
 * This function reads. It never starts anything, and nothing it returns is binding: it is
 * arithmetic over an average, and the guardrails in the runner are what actually stop spending
 * (ADR-0009).
 *
 * The arithmetic speaks the code's words (agents, wakes) and the wire speaks the user's (people,
 * visits) — ADR-0032. `estimateRun` returns the internal shape and `toEstimateView` is the one
 * translation, so a route can never half-rename a field.
 */

/**
 * Used only when the store has no wake to learn from. Derived from the reference runs against the
 * mock target: a visit with a few turns against an Opus-class model lands near this once prompt
 * caching is warm. It is deliberately not cheap — a first-time user should be surprised downwards.
 */
export const DEFAULT_COST_PER_WAKE_USD = 0.12;

/** How far either side of the central figure the range runs, when it comes from history. */
const SPREAD = 0.4;

/** What one lane of the estimate is about, in the code's words. `lane` is the (cohort, persona) slug. */
export interface LaneEstimate {
  lane: string;
  cohort: string;
  personaId: string;
  agents: number;
  visits: number;
  capped: boolean;
  expectedUsd: number;
}

/** The estimate in the code's words. The wire gets `toEstimateView(...)` of this, never this. */
export interface RunEstimate {
  basis: "history" | "default";
  sampleSize: number;
  perWakeUsd: number;
  agents: number;
  visits: number;
  bounded: boolean;
  assumedWakesPerAgent: number | null;
  lowUsd: number;
  expectedUsd: number;
  highUsd: number;
  perCohort: LaneEstimate[];
  model: string;
  effort: string;
  /** The ceilings that will actually stop it, whatever this estimate says (ADR-0009). */
  stops: {
    perWakeUsd: number;
    perWakeTurns: number;
    dailyUsd: number;
    maxWakesPerAgent: number | null;
  };
}

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
export function plannedVisits(
  config: PopulaceConfig,
  assumed: number,
): { agents: number; visits: number; bounded: boolean; perCohort: { lane: string; cohort: string; personaId: string; agents: number; visits: number; capped: boolean }[] } {
  const perCohort: { lane: string; cohort: string; personaId: string; agents: number; visits: number; capped: boolean }[] = [];
  let agents = 0;
  let visits = 0;
  // An EPHEMERAL study is bounded by definition: `visitsPerPerson` resolves onto
  // `population.maxWakes`, so every cohort carries a cap and the run ends when the last
  // participant hits it. A longitudinal one is bounded only if every cohort caps itself.
  let bounded = config.simulation.mode === "ephemeral";
  for (const member of config.population.members) {
    const count = member.count;
    const cap = member.maxWakes ?? config.population.maxWakes;
    const each = cap ?? assumed;
    if (cap === null || cap === undefined) bounded = false;
    agents += count;
    visits += count * each;
    // One row per LANE: a cohort mixing two personas is two rows sharing `cohort`.
    perCohort.push({ lane: laneSlugFor(member.cohort, member.persona.id), cohort: member.cohort, personaId: member.persona.id, agents: count, visits: count * each, capped: cap !== null && cap !== undefined });
  }
  return { agents, visits, bounded, perCohort };
}

/**
 * The median priced visit on this machine, whatever population produced it: a visit's cost is a
 * property of the model and the target far more than of the persona, and a narrow filter would
 * usually find nothing on the run that most needs the estimate — the first one after a config
 * change. Null when nothing has been priced yet.
 */
async function observedPerWake(store: Store): Promise<{ perWake: number | null; sampleSize: number }> {
  const wakes: Wake[] = await store.listWakes({});
  const priced = wakes.filter((w) => w.costUsd > 0).map((w) => w.costUsd);
  const recent = priced.slice(-50);
  const observed = median(recent);
  return { perWake: observed, sampleSize: observed === null ? 0 : recent.length };
}

export async function estimateRun(store: Store, input: EstimateInput): Promise<RunEstimate> {
  const assumed = input.assumedWakesPerAgent ?? 4;
  const plan = plannedVisits(input.config, assumed);
  const history = await observedPerWake(store);

  const perWake = history.perWake ?? DEFAULT_COST_PER_WAKE_USD;
  const central = perWake * plan.visits;
  const spread = history.perWake === null ? 0.6 : SPREAD;

  const model = resolveModel(input.config.model, undefined);
  return {
    basis: history.perWake === null ? "default" : "history",
    sampleSize: history.sampleSize,
    perWakeUsd: Number(perWake.toFixed(4)),
    agents: plan.agents,
    visits: plan.visits,
    bounded: plan.bounded,
    assumedWakesPerAgent: plan.bounded ? null : assumed,
    lowUsd: Number(Math.max(0, central * (1 - spread)).toFixed(2)),
    expectedUsd: Number(central.toFixed(2)),
    highUsd: Number((central * (1 + spread)).toFixed(2)),
    perCohort: plan.perCohort.map((p) => ({ lane: p.lane, cohort: p.cohort, personaId: p.personaId, agents: p.agents, visits: p.visits, capped: p.capped, expectedUsd: Number((p.visits * perWake).toFixed(2)) })),
    model: model.model,
    effort: model.effort,
    stops: {
      perWakeUsd: input.config.guardrails.perWake.maxUsd,
      perWakeTurns: input.config.guardrails.perWake.maxTurns,
      dailyUsd: input.config.guardrails.dailyUsd,
      maxWakesPerAgent: input.config.population.maxWakes,
    },
  };
}

/** What a zero estimate is told about the study, since there is no resolved config to read it from. */
export interface ZeroEstimateInput {
  /** The project's model with the study's override on it (`planSettings`). */
  model: ModelConfig;
  /** The project's guardrails with the study's override on them. */
  guardrails: Guardrails;
  /** The study's visit cap: null is longitudinal, which is what makes the empty study unbounded. */
  visitsPerPerson: number | null;
}

/**
 * The estimate for a study whose deal sends nobody: a size of nought, or weights that leave every
 * lane empty. Nothing can be resolved for it — a config with no members is not a config — and it is
 * NOT a refusal: the builder shows a cost while the size is still being typed, and a 409 there is
 * a form that shouts. Everything a number could say is nought; the basis is still read from
 * history, so the per-visit figure is the one the first person will cost, and the ceilings are the
 * ones the study would run under.
 */
export async function zeroEstimate(store: Store, input: ZeroEstimateInput): Promise<RunEstimate> {
  const history = await observedPerWake(store);
  const perWake = history.perWake ?? DEFAULT_COST_PER_WAKE_USD;
  return {
    basis: history.perWake === null ? "default" : "history",
    sampleSize: history.sampleSize,
    perWakeUsd: Number(perWake.toFixed(4)),
    agents: 0,
    visits: 0,
    bounded: input.visitsPerPerson !== null,
    assumedWakesPerAgent: null,
    lowUsd: 0,
    expectedUsd: 0,
    highUsd: 0,
    perCohort: [],
    model: input.model.model,
    effort: input.model.effort,
    stops: {
      perWakeUsd: input.guardrails.perWake.maxUsd,
      perWakeTurns: input.guardrails.perWake.maxTurns,
      dailyUsd: input.guardrails.dailyUsd,
      maxWakesPerAgent: input.visitsPerPerson,
    },
  };
}

/**
 * The estimate in the wire's words (ADR-0032, ADR-0042): agents are people, wakes are visits, and
 * the lane slug — an internal key that reads `cohort.persona` — is dropped, because the (cohort,
 * personaId) pair on each row is the key and "lane" is not a word the product uses. Every field is
 * mapped by name here and nowhere else, so both estimate routes and the preflight answer alike.
 */
export function toEstimateView(estimate: RunEstimate): EstimateView {
  return {
    basis: estimate.basis,
    sampleSize: estimate.sampleSize,
    perVisitUsd: estimate.perWakeUsd,
    people: estimate.agents,
    visits: estimate.visits,
    bounded: estimate.bounded,
    assumedVisitsEach: estimate.assumedWakesPerAgent,
    lowUsd: estimate.lowUsd,
    expectedUsd: estimate.expectedUsd,
    highUsd: estimate.highUsd,
    perCohort: estimate.perCohort.map((row) => ({ cohort: row.cohort, personaId: row.personaId, people: row.agents, visits: row.visits, capped: row.capped, expectedUsd: row.expectedUsd })),
    model: estimate.model,
    effort: estimate.effort,
    stops: {
      perVisitUsd: estimate.stops.perWakeUsd,
      perVisitTurns: estimate.stops.perWakeTurns,
      dailyUsd: estimate.stops.dailyUsd,
      maxVisitsPerPerson: estimate.stops.maxWakesPerAgent,
    },
  };
}

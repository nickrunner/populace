import { createHash } from "node:crypto";
import type { Agent } from "./schemas/agent.js";
import type { ModelOverride } from "./schemas/model.js";
import type { PersonOverrides, Persona, PersonaSpec, TraitSpec, TraitValue } from "./schemas/persona.js";
import type { Cadence, PersonProfile, Population, PopulationMember } from "./schemas/population.js";
import { handleFor, nameFrom } from "./names.js";

/** mulberry32: small, seedable, good enough for trait sampling. */
export function seededRandom(seed: string): () => number {
  const digest = createHash("sha256").update(seed).digest();
  let a = digest.readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleTrait(spec: TraitSpec, random: () => number): TraitValue {
  if (typeof spec !== "object") return spec;
  if (spec.distribution === "uniform") {
    const value = spec.min + random() * (spec.max - spec.min);
    return spec.integer ? Math.round(value) : Number(value.toFixed(3));
  }
  const weights = spec.weights ?? spec.values.map(() => 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = random() * total;
  for (let i = 0; i < spec.values.length; i++) {
    roll -= weights[i] ?? 0;
    if (roll <= 0) return spec.values[i] as TraitValue;
  }
  return spec.values[spec.values.length - 1] as TraitValue;
}

function asInt(value: TraitValue, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

/** Turns a persona spec into a concrete persona for one agent, sampling traits deterministically. */
export function instantiatePersona(spec: PersonaSpec, seed: string): Persona {
  const random = seededRandom(seed);
  const traits: Record<string, TraitValue> = {};
  for (const key of Object.keys(spec.traits).sort()) traits[key] = sampleTrait(spec.traits[key] as TraitSpec, random);
  const patience = asInt(sampleTrait(spec.patience, random), 3, 1, 5);
  const budgetRaw = sampleTrait(spec.budgetUsd, random);
  const budgetUsd = typeof budgetRaw === "number" ? Math.max(0, budgetRaw) : 0;
  return {
    id: spec.id,
    name: spec.name,
    role: spec.role,
    backstory: spec.backstory,
    goals: spec.goals,
    constraints: spec.constraints,
    patience,
    budgetUsd,
    traits,
    tools: spec.tools,
    model: spec.model,
  };
}

/**
 * A lane is one (cohort, persona) pair, and it is the unit people are numbered in. Slugs are
 * `[a-z0-9-]`, so the dot is unambiguous, and `cohortSlugOfAgentId` reads the group back out of
 * any id without a lookup.
 */
export function laneSlugFor(cohortSlug: string, personaSlug: string): string {
  return `${cohortSlug}.${personaSlug}`;
}

/** The cohort half of a lane slug. A slug with no dot is its own cohort (a pre-lane id). */
export function cohortSlugOfLane(laneSlug: string): string {
  const dot = laneSlug.indexOf(".");
  return dot === -1 ? laneSlug : laneSlug.slice(0, dot);
}

/** The persona half of a lane slug; empty for a pre-lane id. */
export function personaSlugOfLane(laneSlug: string): string {
  const dot = laneSlug.indexOf(".");
  return dot === -1 ? "" : laneSlug.slice(dot + 1);
}

export function agentIdFor(populationSlug: string, laneSlug: string, ordinal: number): string {
  return `${populationSlug}/${laneSlug}#${ordinal + 1}`;
}

/** A person's durable id. Lane-scoped and 1-based, so it reads the same way an agent id does. */
export function personIdFor(laneSlug: string, ordinal: number): string {
  return `${laneSlug}#${ordinal + 1}`;
}

/** The lane slug out of an agent id: `populationSlug/laneSlug#ordinal`. */
export function laneSlugOfAgentId(agentId: string): string {
  const slash = agentId.indexOf("/");
  const hash = agentId.lastIndexOf("#");
  if (slash === -1 || hash <= slash) return "";
  return agentId.slice(slash + 1, hash);
}

/**
 * The cohort slug out of an agent id, so "which group was this?" is readable from a finding's
 * `agentId` alone — which is what lets the clusterer report per-cohort incidence without a
 * second query per report.
 */
export function cohortSlugOfAgentId(agentId: string): string {
  return cohortSlugOfLane(laneSlugOfAgentId(agentId));
}

/** The persona slug out of an agent id, for a per-persona split inside a cohort. */
export function personaSlugOfAgentId(agentId: string): string {
  return personaSlugOfLane(laneSlugOfAgentId(agentId));
}

/**
 * The person id out of an agent id. The person outlives the execution and the agent does not, so
 * counting PEOPLE hit — rather than agents — is what makes a number comparable across executions.
 */
export function personIdOfAgentId(agentId: string): string {
  const slash = agentId.indexOf("/");
  return slash === -1 ? agentId : agentId.slice(slash + 1);
}

/**
 * How many of `size` people each entry of a mix gets — Sainte-Laguë highest averages.
 *
 * The property that matters is that it is HOUSE-MONOTONE: growing the cohort never shrinks a
 * lane, so raising a population from 10 to 11 people adds one person somewhere and archives
 * nobody. Largest-remainder rounding does not have that property (the Alabama paradox), and a
 * cohort that archived somebody because it grew would break ADR-0031 for no reason anybody could
 * see. Ties go to the earlier entry, so the result is a pure function of `(size, weights)`.
 *
 * At small sizes a light entry gets nobody; that is the honest answer and the editor says so.
 */
export function apportion(size: number, weights: readonly number[]): number[] {
  const seats = weights.map(() => 0);
  if (weights.length === 0) return seats;
  for (let seat = 0; seat < size; seat++) {
    let best = 0;
    let bestScore = -1;
    for (let i = 0; i < weights.length; i++) {
      const score = (weights[i] ?? 0) / (2 * (seats[i] ?? 0) + 1);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    seats[best] = (seats[best] ?? 0) + 1;
  }
  return seats;
}

function definedOnly(override: ModelOverride): ModelOverride {
  return {
    ...(override.model === undefined ? {} : { model: override.model }),
    ...(override.effort === undefined ? {} : { effort: override.effort }),
    ...(override.maxTokens === undefined ? {} : { maxTokens: override.maxTokens }),
  };
}

/**
 * The persona one person actually runs with: the spec sampled from the person's seed, then the
 * cohort's overlay (fixed traits, model), then whatever was set on the person by hand. Last
 * wins, so a hand-set patience beats the sample and a cohort trait beats the persona's draw.
 */
export function individuate(spec: PersonaSpec, seed: string, cohort: { traits: Record<string, TraitValue>; model: ModelOverride }, overrides: PersonOverrides): Persona {
  const base = instantiatePersona(spec, seed);
  return {
    ...base,
    patience: overrides.patience ?? base.patience,
    budgetUsd: overrides.budgetUsd ?? base.budgetUsd,
    traits: { ...base.traits, ...cohort.traits, ...overrides.traits },
    model: { ...base.model, ...definedOnly(cohort.model) },
  };
}

/**
 * The cohort's cadence, layered over the population's. Keyed by COHORT — it used to be keyed by
 * persona, which is the single line that made two cohorts on one persona impossible.
 */
export function cadenceFor(population: Population, member: PopulationMember): Cadence {
  return { ...population.cadence, ...(member.cadence ?? {}) };
}

export interface ExpandedAgent {
  agent: Agent;
  cadence: Cadence;
}

/**
 * A lane's cast, filling every ordinal the stored roster does not cover.
 *
 * The seeded tier is defined to be always available (SPEC §5.1): a config written by hand, or a
 * cohort whose roster has not been filled yet, still expands into named people, and the names it
 * produces for a seed are the ones the roster writer would have written for the same seed. An
 * ordinal that DOES have a row is never touched — a name a model wrote is not re-drawn.
 */
export function seededRoster(laneSlug: string, seed: string, count: number, existing: readonly PersonProfile[] = []): PersonProfile[] {
  const byOrdinal = new Map(existing.map((p) => [p.ordinal, p]));
  const used = new Set(existing.map((p) => p.name));
  const out: PersonProfile[] = [];
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const already = byOrdinal.get(ordinal);
    if (already) {
      out.push(already);
      continue;
    }
    const name = nameFrom(`${seed}:${laneSlug}:${ordinal}`, used);
    used.add(name);
    out.push({ ordinal, id: personIdFor(laneSlug, ordinal), name, details: "", handle: handleFor(name, laneSlug, ordinal), overrides: { traits: {} } });
  }
  return out;
}

/** The lane a snapshot member stands for. */
export function laneOf(member: PopulationMember): string {
  return laneSlugFor(member.cohort, member.persona.id);
}

function seededPeople(member: PopulationMember): Map<number, PersonProfile> {
  return new Map(seededRoster(laneOf(member), member.seed, member.count, member.people).map((p) => [p.ordinal, p]));
}

/**
 * Expands a population config into concrete agents (without schedules; the daemon assigns those).
 *
 * This is a JOIN now, not a generator: every per-person decision — name, details, handle, what
 * was set by hand — was made when the person row was written and is frozen into the config
 * snapshot. `individuate` still samples here because the persona spec may have changed since,
 * and the seed it draws from is the person's, so the draw is the same one.
 */
export function expandPopulation(population: Population, runId: string, simulationId: string, now: Date = new Date()): ExpandedAgent[] {
  const out: ExpandedAgent[] = [];
  for (const member of population.members) {
    const cadence = cadenceFor(population, member);
    const lane = laneOf(member);
    const byOrdinal = seededPeople(member);
    for (let ordinal = 0; ordinal < member.count; ordinal++) {
      const person = byOrdinal.get(ordinal);
      if (!person) throw new Error(`lane ${lane} has no person at ordinal ${ordinal}`);
      const seed = `${member.seed}:${lane}:${ordinal}`;
      const persona = individuate(member.persona, seed, member, person.overrides);
      const agent: Agent = {
        id: agentIdFor(population.id, lane, ordinal),
        runId,
        simulationId,
        populationId: population.id,
        cohortSlug: member.cohort,
        personId: person.id,
        context: member.context,
        cohortTools: member.tools,
        name: person.name,
        details: person.details,
        handle: person.handle,
        persona,
        ordinal,
        status: "active",
        retiredReason: null,
        continuedFrom: null,
        identityId: null,
        wakeCount: 0,
        maxWakes: member.maxWakes ?? population.maxWakes ?? null,
        nextWakeAt: null,
        lastWakeAt: null,
        createdAt: now.toISOString(),
      };
      out.push({ agent, cadence });
    }
  }
  return out;
}

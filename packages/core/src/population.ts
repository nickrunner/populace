import { createHash } from "node:crypto";
import type { Agent } from "./schemas/agent.js";
import type { Persona, PersonaSpec, TraitSpec, TraitValue } from "./schemas/persona.js";
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

export function agentIdFor(populationSlug: string, cohortSlug: string, ordinal: number): string {
  return `${populationSlug}/${cohortSlug}#${ordinal + 1}`;
}

/** A person's durable id. Cohort-scoped and 1-based, so it reads the same way an agent id does. */
export function personIdFor(cohortSlug: string, ordinal: number): string {
  return `${cohortSlug}#${ordinal + 1}`;
}

/**
 * The cohort slug out of an agent id. Agent ids are `populationSlug/cohortSlug#ordinal`, so
 * "which group was this?" is readable from a finding's `agentId` alone — which is what lets the
 * clusterer report per-cohort incidence without a second query per report.
 */
export function cohortSlugOfAgentId(agentId: string): string {
  const slash = agentId.indexOf("/");
  const hash = agentId.lastIndexOf("#");
  if (slash === -1 || hash <= slash) return "";
  return agentId.slice(slash + 1, hash);
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
 * A cohort's cast, filling every ordinal the stored roster does not cover.
 *
 * The seeded tier is defined to be always available (SPEC §5.1): a config written by hand, or a
 * cohort whose roster has not been filled yet, still expands into named people, and the names it
 * produces for a seed are the ones the roster writer would have written for the same seed. An
 * ordinal that DOES have a row is never touched — a name a model wrote is not re-drawn.
 */
export function seededRoster(cohortSlug: string, seed: string, count: number, existing: readonly PersonProfile[] = []): PersonProfile[] {
  const byOrdinal = new Map(existing.map((p) => [p.ordinal, p]));
  const used = new Set(existing.map((p) => p.name));
  const out: PersonProfile[] = [];
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const already = byOrdinal.get(ordinal);
    if (already) {
      out.push(already);
      continue;
    }
    const name = nameFrom(`${seed}:${cohortSlug}:${ordinal}`, used);
    used.add(name);
    out.push({ ordinal, id: personIdFor(cohortSlug, ordinal), name, details: "", handle: handleFor(name, cohortSlug, ordinal) });
  }
  return out;
}

function seededPeople(member: PopulationMember): Map<number, PersonProfile> {
  return new Map(seededRoster(member.cohort, member.seed, member.count, member.people).map((p) => [p.ordinal, p]));
}

/**
 * Expands a population config into concrete agents (without schedules; the daemon assigns those).
 *
 * This is a JOIN now, not a generator: every per-person decision — name, details, handle — was
 * made when the person row was written and is frozen into the config snapshot.
 * `instantiatePersona` still runs here because the persona spec may have changed since, and the
 * seed it draws from is the person's, so the draw is the same one.
 */
export function expandPopulation(population: Population, runId: string, simulationId: string, now: Date = new Date()): ExpandedAgent[] {
  const out: ExpandedAgent[] = [];
  for (const member of population.members) {
    const cadence = cadenceFor(population, member);
    const byOrdinal = seededPeople(member);
    for (let ordinal = 0; ordinal < member.count; ordinal++) {
      const person = byOrdinal.get(ordinal);
      if (!person) throw new Error(`cohort ${member.cohort} has no person at ordinal ${ordinal}`);
      const seed = `${member.seed}:${member.cohort}:${ordinal}`;
      const persona = instantiatePersona(member.persona, seed);
      const agent: Agent = {
        id: agentIdFor(population.id, member.cohort, ordinal),
        runId,
        simulationId,
        populationId: population.id,
        cohortSlug: member.cohort,
        personId: person.id,
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

import { createHash } from "node:crypto";
import type { Agent } from "./schemas/agent.js";
import type { Persona, PersonaSpec, TraitSpec, TraitValue } from "./schemas/persona.js";
import type { Cadence, Population } from "./schemas/population.js";

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

export function agentIdFor(populationId: string, personaId: string, ordinal: number): string {
  return `${populationId}/${personaId}#${ordinal + 1}`;
}

export function cadenceFor(population: Population, member: Population["members"][number]): Cadence {
  return { ...population.cadence, ...(member.cadence ?? {}) };
}

export interface ExpandedAgent {
  agent: Agent;
  cadence: Cadence;
}

/** Expands a population config into concrete agents (without schedules; the daemon assigns those). */
export function expandPopulation(population: Population, runId: string, now: Date = new Date()): ExpandedAgent[] {
  const out: ExpandedAgent[] = [];
  for (const member of population.members) {
    const count = Math.max(1, Math.ceil(member.count * population.scale));
    const cadence = cadenceFor(population, member);
    for (let ordinal = 0; ordinal < count; ordinal++) {
      const seed = `${population.seed}:${member.persona.id}:${ordinal}`;
      const persona = instantiatePersona(member.persona, seed);
      const agent: Agent = {
        id: agentIdFor(population.id, persona.id, ordinal),
        runId,
        populationId: population.id,
        persona,
        ordinal,
        status: "active",
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

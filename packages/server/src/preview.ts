import type { DraftPersonaSpec, PersonaPreview } from "@populace/contract";
import { agentIdFor, instantiatePersona, resolveModel, type PersonaSpec, type StoredPersona, type StoredPopulation, type StoredSettings, type StoredTarget, type Target } from "@populace/core";
import { personaSystemPrompt } from "@populace/runner";

/**
 * "What she will be told" (the design's words): the system prompt this person receives at the
 * start of every visit, assembled by the same `personaSystemPrompt` the runner calls.
 *
 * Calling the runner's function rather than describing what it does is the whole point. A
 * reimplementation would drift the first time the prompt changed, and a preview that lies about
 * what an agent is told is worse than no preview: the persona editor is where someone decides
 * whether a finding is the product's fault or the brief's.
 */
export function previewPersona(input: {
  slug: string;
  spec: PersonaSpec;
  population: StoredPopulation;
  settings: StoredSettings;
  target: StoredTarget | undefined;
}): PersonaPreview {
  // The same seed the population uses for the first agent of this person, so the sampled numbers
  // below are the ones the first of them actually gets rather than a fresh roll.
  const seed = `${input.population.seed}:${input.slug}:0`;
  const persona = instantiatePersona({ ...input.spec, id: input.slug }, seed);

  const target: Target = input.target
    ? {
        name: input.target.name,
        mcp: input.target.mcp,
        ...(input.target.webBaseUrl ? { webBaseUrl: input.target.webBaseUrl } : {}),
        ...(input.target.description ? { description: input.target.description } : {}),
      }
    : // No target yet is a normal state on the way to a first run. The prompt is still worth
      // reading, so it is assembled with a placeholder name and the screen says which part is not
      // real yet rather than showing nothing.
      { name: "the product", mcp: [{ name: "default", url: "http://127.0.0.1:1/", headers: {} }] };

  const resolved = resolveModel(input.settings.model, input.spec.model);
  return {
    systemPrompt: personaSystemPrompt(persona, target),
    slug: input.slug,
    agentId: agentIdFor(input.population.slug, input.slug, 0),
    sampled: { patience: persona.patience, budgetUsd: persona.budgetUsd, traits: persona.traits },
    target: { name: target.name, configured: input.target !== undefined, describes: Boolean(input.target?.description) },
    model: {
      model: resolved.model,
      effort: resolved.effort,
      inherited: input.spec.model.model === undefined && input.spec.model.effort === undefined,
    },
  };
}

/**
 * The spec a preview runs on: the draft being typed if there is one, the stored person if not.
 * The draft is deliberately not re-validated against `PersonaSpecSchema` — a half-written person
 * is the normal state of this screen, and the slug still comes from the stored row, never the
 * draft, because that is what agent ids are built from.
 */
export function specForPreview(persona: StoredPersona, draft: DraftPersonaSpec | undefined): PersonaSpec {
  return draft ? { ...draft, id: persona.slug } : persona.spec;
}

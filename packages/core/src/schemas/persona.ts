import { z } from "zod";
import { ModelOverrideSchema } from "./model.js";
import { ToolPolicySchema } from "./tool-policy.js";

export const TraitValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export type TraitValue = z.infer<typeof TraitValueSchema>;

/** A trait can be fixed or sampled per agent from a distribution. */
export const TraitSpecSchema = z.union([
  TraitValueSchema,
  z.object({ distribution: z.literal("uniform"), min: z.number(), max: z.number(), integer: z.boolean().default(true) }),
  z.object({ distribution: z.literal("choice"), values: z.array(TraitValueSchema).min(1), weights: z.array(z.number().nonnegative()).optional() }),
]);
export type TraitSpec = z.infer<typeof TraitSpecSchema>;

export const PersonaSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "persona ids are lowercase slugs"),
  name: z.string().min(1),
  role: z.string().min(1),
  backstory: z.string().min(1),
  goals: z.array(z.string().min(1)).min(1),
  constraints: z.array(z.string()).default([]),
  /** 1 (gives up at the first snag) to 5 (will grind through anything). */
  patience: z.number().int().min(1).max(5).default(3),
  /** What this persona would pay per month, in USD. 0 means "free only". */
  budgetUsd: z.number().nonnegative().default(0),
  traits: z.record(z.string(), TraitValueSchema).default({}),
  /** What this persona will not touch. It can only ever NARROW the target's own policy, never widen it. */
  tools: ToolPolicySchema.prefault({}),
  /** Per-persona model and effort. Unset fields fall through to the global `model` block. */
  model: ModelOverrideSchema.prefault({}),
});
export type Persona = z.infer<typeof PersonaSchema>;

/** A persona as written in a population config: fixed fields plus samplable traits. */
export const PersonaSpecSchema = PersonaSchema.omit({ traits: true, patience: true, budgetUsd: true }).extend({
  patience: TraitSpecSchema.default(3),
  budgetUsd: TraitSpecSchema.default(0),
  traits: z.record(z.string(), TraitSpecSchema).default({}),
});
export type PersonaSpec = z.infer<typeof PersonaSpecSchema>;

/**
 * The dimensions of a persona that are SAMPLED per person — and that a person may therefore be
 * given by hand without the persona stopping being a template (ADR-0031 amendment). Goals,
 * constraints, backstory and tool policy are not here on purpose: those are what a persona IS.
 *
 * Applied last, over the sample and over the cohort's overlay, so a hand-set value always wins.
 */
export const PersonOverridesSchema = z.object({
  patience: z.number().int().min(1).max(5).optional(),
  budgetUsd: z.number().nonnegative().optional(),
  traits: z.record(z.string(), TraitValueSchema).default({}),
});
export type PersonOverrides = z.infer<typeof PersonOverridesSchema>;

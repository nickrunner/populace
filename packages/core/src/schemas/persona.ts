import { z } from "zod";

export const TraitValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export type TraitValue = z.infer<typeof TraitValueSchema>;

/** A trait can be fixed or sampled per agent from a distribution. */
export const TraitSpecSchema = z.union([
  TraitValueSchema,
  z.object({ distribution: z.literal("uniform"), min: z.number(), max: z.number(), integer: z.boolean().default(true) }),
  z.object({ distribution: z.literal("choice"), values: z.array(TraitValueSchema).min(1), weights: z.array(z.number().nonnegative()).optional() }),
]);
export type TraitSpec = z.infer<typeof TraitSpecSchema>;

export const ToolPolicySchema = z.object({
  /** Glob patterns. Empty means every target tool is allowed. */
  allow: z.array(z.string()).default([]),
  /** Glob patterns. Always wins over allow. */
  deny: z.array(z.string()).default([]),
  /** What to do with tools annotated `destructiveHint: true`. */
  destructive: z.enum(["allow", "confirm", "deny"]).default("confirm"),
});
export type ToolPolicy = z.infer<typeof ToolPolicySchema>;

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
  tools: ToolPolicySchema.prefault({}),
});
export type Persona = z.infer<typeof PersonaSchema>;

/** A persona as written in a population config: fixed fields plus samplable traits. */
export const PersonaSpecSchema = PersonaSchema.omit({ traits: true, patience: true, budgetUsd: true }).extend({
  patience: TraitSpecSchema.default(3),
  budgetUsd: TraitSpecSchema.default(0),
  traits: z.record(z.string(), TraitSpecSchema).default({}),
});
export type PersonaSpec = z.infer<typeof PersonaSpecSchema>;

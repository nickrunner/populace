import { z } from "zod";

export const EffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type Effort = z.infer<typeof EffortSchema>;

/** USD per million tokens. */
export const ModelPriceSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative(),
  cacheRead: z.number().nonnegative(),
});
export type ModelPrice = z.infer<typeof ModelPriceSchema>;

export const DEFAULT_MODEL = "claude-opus-5";

export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

export const ModelConfigSchema = z.object({
  model: z.string().default(DEFAULT_MODEL),
  effort: EffortSchema.default("high"),
  maxTokens: z.number().int().positive().default(16_000),
  /** Server-side refusal fallbacks (`fallbacks: "default"`). On by default. */
  fallbacks: z.boolean().default(true),
  /** Extra or overriding prices, keyed by model id. */
  prices: z.record(z.string(), ModelPriceSchema).default({}),
  /** Anthropic API key. Defaults to the ANTHROPIC_API_KEY environment variable. */
  apiKey: z.string().optional(),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

/**
 * A partial `ModelConfig`. Personas and the verifier each carry one: whatever it sets wins
 * over the global `model` block, so a population can mix cheap and capable agents and the
 * judge can stay on a stronger model than the agents it judges.
 */
export const ModelOverrideSchema = z.object({
  model: z.string().optional(),
  effort: EffortSchema.optional(),
  maxTokens: z.number().int().positive().optional(),
});
export type ModelOverride = z.infer<typeof ModelOverrideSchema>;

/** Layers an override over the global model config. Unset fields fall through to the base. */
export function resolveModel(base: ModelConfig, override: ModelOverride | undefined): ModelConfig {
  if (!override) return base;
  return {
    ...base,
    ...(override.model === undefined ? {} : { model: override.model }),
    ...(override.effort === undefined ? {} : { effort: override.effort }),
    ...(override.maxTokens === undefined ? {} : { maxTokens: override.maxTokens }),
  };
}

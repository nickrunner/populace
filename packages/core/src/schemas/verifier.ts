import { z } from "zod";
import { DEFAULT_MODEL, ModelOverrideSchema } from "./model.js";

/**
 * Split out of `config.ts` so `simulation.ts` can layer an override over it without the two files
 * importing each other: `config.ts` needs `SimulationContextSchema` and `SimulationSchema` needs
 * the verifier block, and a zod schema built at module scope cannot survive that cycle.
 */
export const VerifierConfigSchema = z.object({
  /** `model` asks Claude to judge replay results; `heuristic` compares them mechanically. */
  judge: z.enum(["model", "heuristic"]).default("model"),
  /** Verify at most this many findings per digest run. */
  maxFindings: z.number().int().positive().default(50),
  /**
   * The judge's model. It decides what reaches the digest, so it defaults to the strongest
   * model at high effort regardless of what the agents themselves run.
   */
  model: ModelOverrideSchema.prefault({ model: DEFAULT_MODEL, effort: "high" }),
});
export type VerifierConfig = z.infer<typeof VerifierConfigSchema>;

/** A partial `VerifierConfig` carrying no defaults, for the same reason as `GuardrailsOverrideSchema`. */
export const VerifierOverrideSchema = z.object({
  judge: z.enum(["model", "heuristic"]).optional(),
  maxFindings: z.number().int().positive().optional(),
  model: ModelOverrideSchema.optional(),
});
export type VerifierOverride = z.infer<typeof VerifierOverrideSchema>;

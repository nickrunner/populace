import { z } from "zod";
import { ModelOverrideSchema } from "./model.js";

/**
 * Split out of `config.ts` so `simulation.ts` can layer an override over it without the two files
 * importing each other: `config.ts` needs `SimulationContextSchema` and `SimulationSchema` needs
 * the verifier block, and a zod schema built at module scope cannot survive that cycle.
 */
export const VerifierConfigSchema = z.object({
  /**
   * `model` asks Claude to judge replay results; `heuristic` compares them mechanically;
   * `typesafe` asks a System One model for a typed judgement instead of prose.
   *
   * `heuristic` is the default because of what a report cycle is. `model` resolves to an Opus at
   * `effort: "high"`, and at `maxFindings` 50 that is up to 50 of those calls per digest — a
   * defensible price for a digest somebody asked for and an indefensible one for a cycle that
   * turns over by itself, on a clock, for as long as a study runs, unattended. The default used to
   * be `model`, which meant arming report cycles on a longitudinal study silently committed to that
   * bill for ever; the daily ceiling bounded the damage per day and not per study.
   *
   * So the paid judges are opt-in. Raise it to `model` for a digest a person is waiting on, or to
   * `typesafe` for a repeating cycle that still wants more than a mechanical comparison: the
   * question there is a classification over evidence that already exists, not a generative one, so
   * it can be asked as narrow typed judgements and composed in code rather than written out at high
   * effort. Whichever is set, `heuristicJudge` still settles the cases no judge needs a model for
   * before anything is paid for (`reports/src/verifier.ts`).
   */
  judge: z.enum(["model", "heuristic", "typesafe"]).default("heuristic"),
  /** Verify at most this many findings per digest run. */
  maxFindings: z.number().int().positive().default(50),
  /**
   * The judge's model, used only when `judge` is `model`. It decides what reaches the digest, so it
   * names an Opus at high effort rather than following `DEFAULT_MODEL` — the agents' default is a
   * Sonnet at `low`, and a judge inheriting that would be weaker than the thing it judges. Pinned
   * explicitly for that reason: it must not drift when the agents' default moves. Ignored by
   * `typesafe`, which names its own.
   */
  model: ModelOverrideSchema.prefault({ model: "claude-opus-5-5", effort: "high" }),
});
export type VerifierConfig = z.infer<typeof VerifierConfigSchema>;

/** A partial `VerifierConfig` carrying no defaults, for the same reason as `GuardrailsOverrideSchema`. */
export const VerifierOverrideSchema = z.object({
  judge: z.enum(["model", "heuristic", "typesafe"]).optional(),
  maxFindings: z.number().int().positive().optional(),
  model: ModelOverrideSchema.optional(),
});
export type VerifierOverride = z.infer<typeof VerifierOverrideSchema>;

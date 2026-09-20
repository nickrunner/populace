import { z } from "zod";
import { DurationSchema } from "../duration.js";
import { GuardrailsSchema } from "./guardrails.js";
import { IdentityConfigSchema } from "./identity-config.js";
import { ModelConfigSchema } from "./model.js";
import { PopulationSchema } from "./population.js";
import { SimulationContextSchema } from "./simulation.js";
import { TargetSchema } from "./target.js";
import { VerifierConfigSchema } from "./verifier.js";

export const StoreConfigSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sqlite"), path: z.string().min(1).default(".populace/populace.sqlite") }),
]);
export type StoreConfig = z.infer<typeof StoreConfigSchema>;

export const DaemonConfigSchema = z.object({
  /** How often the local daemon looks for due agents. */
  tick: DurationSchema.prefault("5s"),
  concurrency: z.number().int().positive().default(2),
});

/**
 * `version: 2` is the projects/simulations/cohorts/people shape. Snapshots are versioned and never
 * migrated: a run executes the config it froze, and a config written for the old shape is not one
 * this binary can run.
 */
export const PopulaceConfigSchema = z.object({
  version: z.literal(2).default(2),
  /** Which simulation this config belongs to, frozen alongside it. */
  simulation: SimulationContextSchema.prefault({}),
  target: TargetSchema,
  identity: IdentityConfigSchema,
  model: ModelConfigSchema.prefault({}),
  guardrails: GuardrailsSchema.prefault({}),
  store: StoreConfigSchema.prefault({ kind: "sqlite", path: ".populace/populace.sqlite" }),
  daemon: DaemonConfigSchema.prefault({}),
  verifier: VerifierConfigSchema.prefault({}),
  population: PopulationSchema,
  /** Where `populace digest` writes files. */
  digestDir: z.string().default("digests"),
});
export type PopulaceConfig = z.infer<typeof PopulaceConfigSchema>;
export type PopulaceConfigInput = z.input<typeof PopulaceConfigSchema>;

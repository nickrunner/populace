import { z } from "zod";
import { DurationSchema } from "../duration.js";
import { GuardrailsSchema } from "./guardrails.js";
import { IdentityConfigSchema } from "./identity-config.js";
import { ModelConfigSchema } from "./model.js";
import { PopulationSchema } from "./population.js";
import { TargetSchema } from "./target.js";

export const StoreConfigSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sqlite"), path: z.string().min(1).default(".populace/populace.sqlite") }),
]);
export type StoreConfig = z.infer<typeof StoreConfigSchema>;

export const DaemonConfigSchema = z.object({
  /** How often the local daemon looks for due agents. */
  tick: DurationSchema.prefault("5s"),
  concurrency: z.number().int().positive().default(2),
});

export const VerifierConfigSchema = z.object({
  /** `model` asks Claude to judge replay results; `heuristic` compares them mechanically. */
  judge: z.enum(["model", "heuristic"]).default("model"),
  /** Verify at most this many findings per digest run. */
  maxFindings: z.number().int().positive().default(50),
});

export const PopulaceConfigSchema = z.object({
  version: z.literal(1).default(1),
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

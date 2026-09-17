import { z } from "zod";
import { DurationSchema } from "../duration.js";
import { PersonaSpecSchema } from "./persona.js";

export const CadenceSchema = z.object({
  /** Time between wakes of one agent. */
  every: DurationSchema.prefault("10m"),
  /** Random extra delay added to each wake, 0..jitter. */
  jitter: DurationSchema.prefault("0s"),
  /** Delay before the first wake after an agent is created. */
  initialDelay: DurationSchema.prefault("0s"),
});
export type Cadence = z.infer<typeof CadenceSchema>;

export const PopulationMemberSchema = z.object({
  persona: PersonaSpecSchema,
  /** Number of agents for this persona before the scale factor. */
  count: z.number().int().positive().default(1),
  cadence: CadenceSchema.partial().optional(),
  /** Retire the agent after this many wakes. Unset means forever. */
  maxWakes: z.number().int().positive().optional(),
});
export type PopulationMember = z.infer<typeof PopulationMemberSchema>;

export const PopulationSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  members: z.array(PopulationMemberSchema).min(1),
  /** Multiplies every member count. Fractions round up so every persona keeps at least one agent. */
  scale: z.number().positive().default(1),
  cadence: CadenceSchema.prefault({ every: "10m", jitter: "0s", initialDelay: "0s" }),
  maxWakes: z.number().int().positive().optional(),
  /** Seed for trait sampling so the same config expands to the same agents. */
  seed: z.string().default("populace"),
});
export type Population = z.infer<typeof PopulationSchema>;

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

/** One person, frozen into the snapshot so an old run still renders the right cast. */
export const PersonProfileSchema = z.object({
  ordinal: z.number().int().nonnegative(),
  /** `${cohortSlug}#${ordinal + 1}` */
  id: z.string().min(1),
  name: z.string().min(1),
  details: z.string().default(""),
  /** Email local part for self-signup. Cohort-scoped, so two cohorts on one persona never collide. */
  handle: z.string().min(1),
});
export type PersonProfile = z.infer<typeof PersonProfileSchema>;

const PopulationMemberFields = z.object({
  /**
   * The cohort slug. Agent ids and per-person seeds are built from this, which is what makes two
   * cohorts on ONE persona two separate groups rather than one group counted twice.
   *
   * Left out, it falls back to the persona's id: a config that never heard of cohorts is a
   * population of one-cohort-per-persona, which is exactly what it always meant.
   */
  cohort: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  cohortName: z.string().min(1).optional(),
  persona: PersonaSpecSchema,
  /** How many people are in this cohort. */
  count: z.number().int().positive().default(1),
  /** The cohort's own seed, so expansion samples exactly what the person row sampled. */
  seed: z.string().min(1).default("populace"),
  /**
   * The frozen cast, in ordinal order. Resolution fills it from the roster; an ordinal with no row
   * is filled by the seeded name bank at expansion time, which is the same name the roster writer
   * would have written for that seed.
   */
  people: z.array(PersonProfileSchema).default([]),
  cadence: CadenceSchema.partial().optional(),
  /** Retire the agent after this many wakes. Unset means the population's cap applies. */
  maxWakes: z.number().int().positive().optional(),
});

export const PopulationMemberSchema = PopulationMemberFields.transform((member) => ({
  ...member,
  cohort: member.cohort ?? member.persona.id,
  cohortName: member.cohortName ?? member.persona.name,
}));
export type PopulationMember = z.infer<typeof PopulationMemberSchema>;

export const PopulationSchema = z.object({
  /** The population slug: the first segment of every agent id. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1).default("Everyone"),
  /** One entry per cohort. */
  members: z.array(PopulationMemberSchema).min(1),
  /** From the simulation. */
  cadence: CadenceSchema.prefault({ every: "10m", jitter: "0s", initialDelay: "0s" }),
  /** From the simulation's `visitsPerPerson`. Null means the run has no arithmetic end. */
  maxWakes: z.number().int().positive().nullable().default(null),
  /** The simulation's seed: cadence jitter only. People are seeded from their cohort. */
  seed: z.string().default("populace"),
});
export type Population = z.infer<typeof PopulationSchema>;

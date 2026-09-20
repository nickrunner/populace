import { z } from "zod";
import { CadenceSchema } from "./population.js";

/**
 * "25 people on persona 1." A cohort is project-level and reusable: the same cohort can sit in two
 * populations, and it is the SAME PEOPLE in both — which is what makes "did the power users hit
 * this in the other simulation too?" a question with an answer.
 *
 * That is why the cohort, not the population and not the simulation, owns `seed` and owns the
 * `people` rows.
 */
export const CohortSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  /**
   * IMMUTABLE and unique within the project. It is the middle segment of every agent id
   * (`populationSlug/cohortSlug#ordinal`) and the first segment of every person id
   * (`cohortSlug#ordinal`). Renaming it would orphan memory and silently empty a continuation.
   */
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  /** Mutable display name: "Weekend planners". */
  name: z.string().min(1),
  /** The row id of the `StoredPersona`, not its slug. */
  personaId: z.string().min(1),
  /** How many people. The ONLY number that decides headcount — there is no `scale` any more. */
  size: z.number().int().positive().default(1),
  /** Overrides the simulation's cadence field-wise (`cadenceFor`). */
  cadence: CadenceSchema.partial().optional(),
  /** Overrides the simulation's visit cap for this group only. */
  maxWakes: z.number().int().positive().optional(),
  /**
   * The seed every person in this cohort is drawn from: `${seed}:${slug}:${ordinal}` feeds both
   * `instantiatePersona` and the seeded name bank. Changing it does NOT rename anybody — the
   * people rows already exist. It decides who the NEXT ordinal is.
   */
  seed: z.string().default("populace"),
  notes: z.string().default(""),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Cohort = z.infer<typeof CohortSchema>;

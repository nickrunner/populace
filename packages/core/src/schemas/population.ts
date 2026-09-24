import { z } from "zod";
import { DurationSchema } from "../duration.js";
import { ModelOverrideSchema } from "./model.js";
import { PersonOverridesSchema, PersonaSpecSchema, TraitValueSchema } from "./persona.js";
import { ToolPolicySchema } from "./tool-policy.js";

export const CadenceSchema = z.object({
  /** Time between wakes of one agent. */
  every: DurationSchema.prefault("10m"),
  /**
   * Random extra delay added to each wake, 0..jitter — including the FIRST one, which is what
   * makes this the field that decides whether a population behaves like people or like a herd.
   *
   * It defaults to a tenth of the default interval rather than to zero, and zero is the wrong
   * default for a reason worth writing down. Every agent in a run is armed in the same loop, so
   * with no jitter they all carry the same `nextWakeAt` to the millisecond; `listDueAgents` then
   * returns them oldest-first, ties broken by the index, which is agent id — and an agent id
   * begins with its cohort slug. A population of six cohorts therefore ran one cohort at a time,
   * in alphabetical order, and looked like a scheduler that could not interleave. It was a
   * thundering herd being drained in whatever order the index happened to yield.
   *
   * `initialDelay` does NOT fix that: it shifts every agent by the same amount rather than
   * spreading them, so the herd arrives late instead of arriving staggered.
   *
   * 30 seconds, matching what `populace init` has always written into its template — which is why
   * a config-first user never saw this and a dashboard-first user always did. It spreads a
   * population widely enough to interleave its cohorts while keeping the wait before the FIRST
   * person shows up short, because jitter delays that one too.
   */
  jitter: DurationSchema.prefault("30s"),
  /**
   * Delay before the first wake after an agent is created. Zero by default on purpose — a first
   * run should produce something to look at, and staggering is `jitter`'s job.
   */
  initialDelay: DurationSchema.prefault("0s"),
});
export type Cadence = z.infer<typeof CadenceSchema>;

/** One person, frozen into the snapshot so an old run still renders the right cast. */
export const PersonProfileSchema = z.object({
  ordinal: z.number().int().nonnegative(),
  /** `${cohortSlug}.${personaSlug}#${ordinal + 1}` */
  id: z.string().min(1),
  name: z.string().min(1),
  details: z.string().default(""),
  /** Email local part for self-signup. Lane-scoped, so two cohorts on one persona never collide. */
  handle: z.string().min(1),
  /** What was set on this person by hand; applied last at expansion. */
  overrides: PersonOverridesSchema.prefault({}),
});
export type PersonProfile = z.infer<typeof PersonProfileSchema>;

/**
 * One LANE of the snapshot: one cohort, one of its personas, and the people apportioned to that
 * pair. A cohort mixing three personas resolves into three members that share `cohort`,
 * `context`, `traits`, `tools` and `model`, and differ in `persona` and `count`.
 */
const PopulationMemberFields = z.object({
  /**
   * The cohort slug. Lane slugs, agent ids and per-person seeds are built from this and the
   * persona's slug, which is what makes two cohorts on ONE persona two separate groups rather
   * than one group counted twice.
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
  /** How many people are in this lane. Apportioned from the population's size for the cohort. */
  count: z.number().int().positive().default(1),
  /** The cohort's shared condition, in prose. Handed to every person under the backstory. */
  context: z.string().default(""),
  /** The cohort's fixed trait overlay, applied over each person's sampled traits. */
  traits: z.record(z.string(), TraitValueSchema).default({}),
  /** The cohort's own tool policy. Narrows the persona's and the target's; never widens. */
  tools: ToolPolicySchema.prefault({}),
  /** The cohort's model override, layered over the persona's. */
  model: ModelOverrideSchema.prefault({}),
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
  /** One entry per lane: a cohort mixing N personas contributes N members. */
  members: z.array(PopulationMemberSchema).min(1),
  /** From the simulation. */
  /** From the simulation. Restating the field defaults here would be a second place to forget. */
  cadence: CadenceSchema.prefault({}),
  /** From the simulation's `visitsPerPerson`. Null means the run has no arithmetic end. */
  maxWakes: z.number().int().positive().nullable().default(null),
  /** The simulation's seed: cadence jitter only. People are seeded from their cohort. */
  seed: z.string().default("populace"),
});
export type Population = z.infer<typeof PopulationSchema>;

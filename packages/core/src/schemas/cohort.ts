import { z } from "zod";
import { ModelOverrideSchema } from "./model.js";
import { TraitValueSchema } from "./persona.js";
import { CadenceSchema } from "./population.js";
import { ToolPolicySchema } from "./tool-policy.js";

/** One persona's share of a cohort. Weights are a ratio, not percentages: `3 : 2` is legal. */
export const CohortMixEntrySchema = z.object({
  /** The row id of the `StoredPersona`, not its slug. */
  personaId: z.string().min(1),
  weight: z.number().positive().default(1),
});
export type CohortMixEntry = z.infer<typeof CohortMixEntrySchema>;

/**
 * A group of people who share a condition, drawn from a MIX of personas (ADR-0039).
 *
 * "Mobile-only signups", "everyone who arrived in launch week", "the pilot team": a cohort is
 * defined by what its people have in common, and `context` — required — says what that is, in
 * the words every one of them is handed under their persona's backstory. Within the cohort the
 * people are a ratio of personas, so one cohort can stand for a realistic slice of a user base
 * rather than for one kind of person counted N times.
 *
 * A cohort has NO headcount. The population that sends it says how many (`members[].size`), and
 * that number is apportioned across the mix per lane — one (cohort, persona) pair — so the same
 * cohort at two sizes in two populations is the same people up to the smaller size. That is why
 * the cohort, not the population and not the simulation, owns the seed and the `people` rows:
 * "did the mobile cohort hit this in the other simulation too?" is a question with an answer.
 */
export const CohortSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    /**
     * IMMUTABLE and unique within the project. It is the first half of every lane slug
     * (`cohortSlug.personaSlug`), and therefore of every person id and agent id. Renaming it would
     * orphan memory and silently empty a continuation.
     */
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    /** Mutable display name: "Mobile signups". */
    name: z.string().min(1),
    /**
     * What these people have in common, in one or two sentences addressed to them: "You only ever
     * use this on your phone, usually while doing something else." REQUIRED — a cohort with
     * nothing shared is a saved recipe, not a cohort — and inserted into every member's prompt
     * between the persona's backstory and the person's own line.
     */
    context: z.string().min(1),
    /** Which personas, and in what ratio. At least one; no persona twice. */
    mix: z.array(CohortMixEntrySchema).min(1),
    /** Fixed traits every person in the cohort carries, over whatever their persona sampled. */
    traits: z.record(z.string(), TraitValueSchema).default({}),
    /** Narrows the persona's and the target's policy further. Can never widen either. */
    tools: ToolPolicySchema.prefault({}),
    /** Layered over the persona's own override: global → persona → cohort → simulation. */
    model: ModelOverrideSchema.prefault({}),
    /** Overrides the simulation's cadence field-wise (`cadenceFor`). */
    cadence: CadenceSchema.partial().optional(),
    /** Overrides the simulation's visit cap for this group only. */
    maxWakes: z.number().int().positive().optional(),
    /**
     * The seed every person in this cohort is drawn from: `${seed}:${laneSlug}:${ordinal}` feeds
     * both `instantiatePersona` and the seeded name bank. Changing it does NOT rename anybody —
     * the people rows already exist. It decides who the NEXT ordinal is.
     */
    seed: z.string().default("populace"),
    notes: z.string().default(""),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .superRefine((cohort, ctx) => {
    const seen = new Set<string>();
    cohort.mix.forEach((entry, index) => {
      if (seen.has(entry.personaId)) ctx.addIssue({ code: "custom", path: ["mix", index, "personaId"], message: "a persona appears in a cohort's mix once" });
      seen.add(entry.personaId);
    });
  });
export type Cohort = z.infer<typeof CohortSchema>;

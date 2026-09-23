import { z } from "zod";
import { PersonOverridesSchema, PersonaSchema } from "./persona.js";

/**
 * One named individual. Written once per `(lane, ordinal)` and then frozen.
 *
 * Frozen is the whole point. Names are stable across executions because they are STORED, not
 * because the generator is deterministic — the model call that writes them is not deterministic at
 * all. That is what lets "the AI fills out each person" and "re-running meets the same cast" both
 * be true.
 *
 * A lane is one (cohort, persona) pair — `cohortSlug.personaSlug` — and ordinals count within it.
 * That is what keeps growing a mixed cohort from re-dealing anybody: the sixth first-timer in the
 * mobile cohort is the sixth first-timer whether the cohort is sent at ten people or at forty.
 * Shrinking does not delete people: an ordinal past the lane's count is simply inactive, so
 * growing back restores the same individuals.
 */
export const PersonSchema = z.object({
  /** `${laneSlug}#${ordinal + 1}` — e.g. `mobile-signups.first-timer#3`. Project-scoped. */
  id: z.string().min(1),
  projectId: z.string().min(1),
  /** `coh_…` row id; follows a cohort rename. */
  cohortId: z.string().min(1),
  /** Immutable, the id-forming key. */
  cohortSlug: z.string().min(1),
  personaId: z.string().min(1),
  personaSlug: z.string().min(1),
  /** `${cohortSlug}.${personaSlug}`: the lane this person is the `ordinal`-th member of. */
  laneSlug: z.string().min(1),
  /** 0-based within the lane; the id is 1-based, matching agent ids. */
  ordinal: z.number().int().nonnegative(),
  /** The generated name. Never typed by the user. */
  name: z.string().min(1),
  /**
   * One or two sentences of individuating specifics, handed to the model below the persona's
   * backstory. Deliberately short — it rides in the cached system prefix, where per-agent variance
   * is already the norm (traits are sampled per agent), so it costs no prompt-cache hit rate.
   */
  details: z.string().default(""),
  /**
   * Email local part. The old local part was `slugify(persona.id)-${ordinal + 1}`, which collides
   * the moment two cohorts share a persona; per-person and lane-scoped fixes that.
   */
  handle: z.string().min(1),
  /** The concrete persona for this person: traits, patience and budget sampled from the seed. */
  persona: PersonaSchema,
  /**
   * What somebody set on THIS person by hand: patience, budget, traits. As much or as little
   * individuality as wanted, applied over the sample and the cohort's overlay at expansion.
   */
  overrides: PersonOverridesSchema.prefault({}),
  /**
   * Where the row's name and details came from — and, for `authored`, the one value that means
   * HANDS OFF. A slot is only ever written over while it still holds what the seeded bank put
   * there, so a person somebody typed a name for has to be distinguishable from one nobody has
   * touched. Without it a rename with no details left the row looking exactly like a placeholder
   * and the next generate quietly took the name back.
   */
  generatedBy: z.enum(["model", "seeded", "authored"]).default("seeded"),
  /** Which model wrote it, so a regeneration is explainable. Empty when seeded. */
  generatedByModel: z.string().default(""),
  /** `${cohort.seed}:${laneSlug}:${ordinal}` */
  seed: z.string().min(1),
  archivedAt: z.iso.datetime().nullable().default(null),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Person = z.infer<typeof PersonSchema>;

import { z } from "zod";
import { PersonaSchema } from "./persona.js";

/**
 * One named individual. Written once per (cohort, ordinal) and then frozen.
 *
 * Frozen is the whole point. Names are stable across executions because they are STORED, not
 * because the generator is deterministic — the model call that writes them is not deterministic at
 * all. That is what lets "the AI fills out each person" and "re-running meets the same cast" both
 * be true.
 *
 * Shrinking a cohort does not delete people: an ordinal past `size` is simply inactive, so growing
 * back restores the same individuals.
 */
export const PersonSchema = z.object({
  /** `${cohortSlug}#${ordinal + 1}` — e.g. `weekend-planners#3`. Project-scoped, human-readable. */
  id: z.string().min(1),
  projectId: z.string().min(1),
  /** `coh_…` row id; follows a cohort rename. */
  cohortId: z.string().min(1),
  /** Immutable, the id-forming key. */
  cohortSlug: z.string().min(1),
  personaId: z.string().min(1),
  personaSlug: z.string().min(1),
  /** 0-based; the id is 1-based, matching agent ids. */
  ordinal: z.number().int().nonnegative(),
  /** The generated name. Never typed by the user. */
  name: z.string().min(1),
  /**
   * One or two sentences of individuating specifics, handed to the model below the persona's
   * backstory. Deliberately short — it rides in the cached system prefix, where per-agent variance
   * is already the norm (traits are sampled per agent today), so it costs no prompt-cache hit rate.
   */
  details: z.string().default(""),
  /**
   * Email local part. The old local part was `slugify(persona.id)-${ordinal + 1}`, which collides
   * the moment two cohorts share a persona; per-person and cohort-scoped fixes that.
   */
  handle: z.string().min(1),
  /** The concrete persona for this person: traits, patience and budget sampled from the seed. */
  persona: PersonaSchema,
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
  /** `${cohort.seed}:${cohortSlug}:${ordinal}` */
  seed: z.string().min(1),
  archivedAt: z.iso.datetime().nullable().default(null),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Person = z.infer<typeof PersonSchema>;

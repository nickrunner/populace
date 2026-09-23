import { z } from "zod";
import { CadenceSchema } from "./population.js";
import { DaemonConfigSchema } from "./config.js";
import { VerifierConfigSchema } from "./verifier.js";
import { GuardrailsSchema } from "./guardrails.js";
import { IdentityConfigSchema } from "./identity-config.js";
import { ModelConfigSchema } from "./model.js";
import { PersonaSpecSchema } from "./persona.js";
import { McpEndpointSchema, TargetResetSchema } from "./target.js";
import { ToolPolicySchema } from "./tool-policy.js";
import { FirstContactSchema } from "./first-contact.js";

/**
 * The authored layer (`DATA-MODEL.md` §5): what a person edits, mutable and versioned, never read
 * by the runner. The runner only ever sees a resolved `PopulaceConfig` assembled from these rows
 * — resolution is assembly, not translation, which is why YAML import and export stay lossless.
 *
 * `projectId` is required on every row. It used to default, which is what let the whole M2 layer
 * pretend one project existed; a row with no project is now a bug the compiler catches.
 */

export const DEFAULT_PROJECT_ID = "default";

export const ProjectSchema = z.object({
  id: z.string().min(1),
  /**
   * URL segment. Immutable: bookmarks and any future CI invocation name it. Required, with no
   * default — a default would be one constant string, so every project that omitted a slug would
   * answer to the same `/p/:proj` and the switcher would resolve to whichever came back first.
   */
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  /** One line under the name on the Projects index. */
  description: z.string().default(""),
  /** Soft delete. An archived project leaves the switcher and keeps every run. */
  archived: z.boolean().default(false),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime().default(() => new Date().toISOString()),
});
export type Project = z.infer<typeof ProjectSchema>;

export const StoredTargetSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  /** Immutable, for URLs, and unique within the project — so no default, for the same reason. */
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  mcp: z.array(McpEndpointSchema).min(1),
  webBaseUrl: z.url().optional(),
  /** "What the marketing says"; reaches the prompt. */
  description: z.string().optional(),
  identity: IdentityConfigSchema,
  /**
   * What anybody sent here may touch, whatever persona they wear. Resolved into `config.target`
   * and merged with each persona's own policy in the runner, where deny wins and allow intersects
   * — so this is a floor a persona can narrow and never widen.
   */
  tools: ToolPolicySchema.prefault({}),
  /**
   * The last first-contact check against this target, or null when nobody has run one.
   *
   * It is kept on the row because the question it answers — can a person actually get in here —
   * has to be visible on a screen that must not itself provision an account. Preflight is a GET;
   * making one account per page view on somebody's product is exactly what ADR-0023 forbids, so
   * preflight reads this and the POST that made it is the only thing that touches the target.
   */
  firstContact: FirstContactSchema.nullable().default(null),
  reset: TargetResetSchema.prefault({ kind: "none" }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type StoredTarget = z.infer<typeof StoredTargetSchema>;

/**
 * `slug` is immutable and is inlined as `persona.id` into every config snapshot. It is no longer
 * the id-forming key for agents (a cohort slug is), but a persona rename must still never move it:
 * the digest groups by it and `--continue-from` reads snapshots written before the rename.
 */
export const StoredPersonaSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "persona slugs are lowercase"),
  spec: PersonaSpecSchema,
  origin: z.enum(["starter", "authored", "imported"]).default("authored"),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type StoredPersona = z.infer<typeof StoredPersonaSchema>;

/** One cohort in a population, and how many of its people go. */
export const PopulationMemberRefSchema = z.object({
  cohortId: z.string().min(1),
  /** The headcount for this cohort in this population: apportioned across the cohort's mix. */
  size: z.number().int().positive().default(1),
});
export type PopulationMemberRef = z.infer<typeof PopulationMemberRefSchema>;

/**
 * Which cohorts go, and how many of each (ADR-0039). This is the ONLY place a headcount lives:
 * a cohort has no size of its own, and setting a member's size here is what instantiates its
 * people. The execution plan — cadence, cap, mode — belongs to the simulation, and the seed to
 * the cohort that owns the people.
 */
export const StoredPopulationSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    /** Immutable; the first segment of every agent id. */
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    /** Mutable: "Everyone", "Mobile only". */
    name: z.string().min(1).default("Everyone"),
    /** Ordered. Order is display order; it never affects ids or seeding. A cohort appears once. */
    members: z.array(PopulationMemberRefSchema).default([]),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .superRefine((population, ctx) => {
    const seen = new Set<string>();
    population.members.forEach((member, index) => {
      if (seen.has(member.cohortId)) ctx.addIssue({ code: "custom", path: ["members", index, "cohortId"], message: "a cohort is in a population once" });
      seen.add(member.cohortId);
    });
  });
export type StoredPopulation = z.infer<typeof StoredPopulationSchema>;

/**
 * Everything in `PopulaceConfig` that is neither the target nor the population. `store` and
 * `digestDir` are deliberately absent: where the database file lives is a property of the
 * process, not of the project, and a row that named its own database would be circular.
 *
 * `cadence`, `maxWakes` and `seed` are the execution plan. They belong to a `Simulation`; until
 * simulations are rows (stage 3) this project-level row is where the one implicit simulation keeps
 * them, so the Limits screen still has somewhere to write.
 */
export const StoredSettingsSchema = z.object({
  projectId: z.string().min(1),
  model: ModelConfigSchema.prefault({}),
  guardrails: GuardrailsSchema.prefault({}),
  verifier: VerifierConfigSchema.prefault({}),
  daemon: DaemonConfigSchema.prefault({}),
  cadence: CadenceSchema.prefault({}),
  maxWakes: z.number().int().positive().nullable().default(null),
  seed: z.string().default("populace"),
  updatedAt: z.iso.datetime(),
});
export type StoredSettings = z.infer<typeof StoredSettingsSchema>;

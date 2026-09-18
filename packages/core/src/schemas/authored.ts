import { z } from "zod";
import { CadenceSchema } from "./population.js";
import { DaemonConfigSchema, VerifierConfigSchema } from "./config.js";
import { GuardrailsSchema } from "./guardrails.js";
import { IdentityConfigSchema } from "./identity-config.js";
import { ModelConfigSchema } from "./model.js";
import { PersonaSpecSchema } from "./persona.js";
import { McpEndpointSchema } from "./target.js";

/**
 * The authored layer (`DATA-MODEL.md` §5): what a person edits, mutable and versioned, never read
 * by the runner. The runner only ever sees a resolved `PopulaceConfig` assembled from these rows
 * — resolution is assembly, not translation, which is why YAML import and export stay lossless.
 */

export const DEFAULT_PROJECT_ID = "default";

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.iso.datetime(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const StoredTargetSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1).default(DEFAULT_PROJECT_ID),
  name: z.string().min(1),
  mcp: z.array(McpEndpointSchema).min(1),
  webBaseUrl: z.url().optional(),
  description: z.string().optional(),
  identity: IdentityConfigSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type StoredTarget = z.infer<typeof StoredTargetSchema>;

/**
 * `slug` is immutable and is what agent ids are built from (`populationId/personaId#ordinal`).
 * The display name inside `spec` is mutable. Renaming a persona in the editor must never change
 * an agent id, because a continuation recognises the same person by that id and fix validation
 * is the product's differentiated feature.
 */
export const StoredPersonaSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1).default(DEFAULT_PROJECT_ID),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "persona slugs are lowercase"),
  spec: PersonaSpecSchema,
  origin: z.enum(["starter", "authored", "imported"]).default("authored"),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type StoredPersona = z.infer<typeof StoredPersonaSchema>;

/** Members reference personas by row id; a snapshot inlines the full spec (`DATA-MODEL.md` §5). */
export const StoredPopulationMemberSchema = z.object({
  personaId: z.string().min(1),
  count: z.number().int().positive().default(1),
  cadence: CadenceSchema.partial().optional(),
  maxWakes: z.number().int().positive().optional(),
});
export type StoredPopulationMember = z.infer<typeof StoredPopulationMemberSchema>;

export const StoredPopulationSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1).default(DEFAULT_PROJECT_ID),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  members: z.array(StoredPopulationMemberSchema).default([]),
  scale: z.number().positive().default(1),
  cadence: CadenceSchema.prefault({}),
  maxWakes: z.number().int().positive().optional(),
  seed: z.string().default("populace"),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type StoredPopulation = z.infer<typeof StoredPopulationSchema>;

/**
 * Everything in `PopulaceConfig` that is neither the target nor the population. `store` and
 * `digestDir` are deliberately absent: where the database file lives is a property of the
 * process, not of the project, and a row that named its own database would be circular.
 */
export const StoredSettingsSchema = z.object({
  projectId: z.string().min(1).default(DEFAULT_PROJECT_ID),
  model: ModelConfigSchema.prefault({}),
  guardrails: GuardrailsSchema.prefault({}),
  verifier: VerifierConfigSchema.prefault({}),
  daemon: DaemonConfigSchema.prefault({}),
  updatedAt: z.iso.datetime(),
});
export type StoredSettings = z.infer<typeof StoredSettingsSchema>;

/**
 * The whole authored layer of one project, as one value (`DATA-MODEL.md` §5). This is what a
 * config revision holds and what a restore writes back, so it has to be the complete set of rows
 * a person can edit: anything missing here silently survives a restore and makes history lie.
 */
export const AuthoredDocumentSchema = z.object({
  version: z.literal(1).default(1),
  targets: z.array(StoredTargetSchema).default([]),
  personas: z.array(StoredPersonaSchema).default([]),
  population: StoredPopulationSchema,
  settings: StoredSettingsSchema,
});
export type AuthoredDocument = z.infer<typeof AuthoredDocumentSchema>;

/**
 * One point in the authored layer's history: the state *after* a change, with a line saying what
 * the change was. Stored rather than derived, because the cheapest correct undo is a copy.
 *
 * These rows carry whatever credentials the target rows carry. That is not a new exposure — the
 * `targets` table in the same database already holds them — and it is the reason a restore can
 * put a working target back rather than a target that has forgotten how to authenticate. The
 * redaction rule in `redactConfig` is about the *frozen* snapshots, which get copied out of this
 * database and attached to bug reports; a revision never leaves it.
 */
export const ConfigRevisionSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1).default(DEFAULT_PROJECT_ID),
  at: z.iso.datetime(),
  /** One line in the words the history screen shows: "renamed Casey Morgan", "imported a file". */
  summary: z.string().min(1),
  source: z.enum(["editor", "import", "restore", "baseline"]),
  document: AuthoredDocumentSchema,
});
export type ConfigRevision = z.infer<typeof ConfigRevisionSchema>;

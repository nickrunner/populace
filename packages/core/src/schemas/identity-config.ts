import { z } from "zod";

export const SelfSignupConfigSchema = z.object({
  strategy: z.literal("self-signup"),
  /** Name of the target tool that creates an account. */
  signupTool: z.string().min(1),
  /** Dotted path to the bearer token in the signup tool result (structuredContent first, then parsed text). */
  tokenPath: z.string().min(1).default("token"),
  userIdPath: z.string().min(1).optional(),
  /** Optional tool that deletes the calling account, used by teardown. */
  teardownTool: z.string().min(1).optional(),
  /** Domain for generated emails; the run tag is embedded in the local part. */
  emailDomain: z.string().min(1).default("populace.test"),
});

export const StaticIdentityConfigSchema = z.object({
  strategy: z.literal("static"),
  /** JSON file: `{ "<personaId>": [ { bearerToken, userId?, email?, tags? } ] }` or a flat array. */
  file: z.string().min(1),
});

export const FirebaseAdminConfigSchema = z.object({
  strategy: z.literal("admin-mint"),
  provider: z.literal("firebase").default("firebase"),
  /** Path to a service account JSON, or omit to use GOOGLE_APPLICATION_CREDENTIALS. */
  serviceAccountFile: z.string().optional(),
  projectId: z.string().optional(),
  emailDomain: z.string().min(1).default("populace.test"),
  /** Optional HTTP endpoint that exchanges a custom token for the bearer the target accepts. Omit to use the custom token directly. */
  exchangeUrl: z.string().url().optional(),
});

export const IdentityConfigSchema = z.discriminatedUnion("strategy", [SelfSignupConfigSchema, StaticIdentityConfigSchema, FirebaseAdminConfigSchema]);
export type IdentityConfig = z.infer<typeof IdentityConfigSchema>;
export type SelfSignupConfig = z.infer<typeof SelfSignupConfigSchema>;
export type StaticIdentityConfig = z.infer<typeof StaticIdentityConfigSchema>;
export type FirebaseAdminConfig = z.infer<typeof FirebaseAdminConfigSchema>;

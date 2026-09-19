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

/**
 * admin-mint against Firebase: the service account creates the user, and the Web API key turns the
 * custom token that comes back into a session the target will actually accept.
 *
 * Both halves are needed. A Firebase CUSTOM token is not an ID token — anything calling
 * `verifyIdToken` rejects one — so the exchange is the normal path and not an optional extra, and
 * the provider refuses to MINT when it has neither `apiKey` nor `exchangeUrl` rather than handing
 * back a custom token that every tool call will bounce. It refuses at the mint and not at
 * construction so that teardown and `listByTag`, which need only the service account, still work
 * for a run that was configured this way and left users behind.
 */
export const FirebaseAdminConfigSchema = z.object({
  strategy: z.literal("admin-mint"),
  provider: z.literal("firebase").default("firebase"),
  /** Path to a service account JSON, or omit to use GOOGLE_APPLICATION_CREDENTIALS. */
  serviceAccountFile: z.string().optional(),
  projectId: z.string().optional(),
  emailDomain: z.string().min(1).default("populace.test"),
  /**
   * The Firebase Web API key (console → Project settings → General → Web API Key). With it the
   * provider builds Google's own endpoints itself: `accounts:signInWithCustomToken` to exchange,
   * and the secure-token endpoint to renew an ID token before it expires an hour later.
   */
  apiKey: z.string().min(1).optional(),
  /** An endpoint of your own that exchanges a custom token for the bearer the target accepts. Overrides `apiKey`'s exchange. */
  exchangeUrl: z.url().optional(),
});

export const IdentityConfigSchema = z.discriminatedUnion("strategy", [SelfSignupConfigSchema, StaticIdentityConfigSchema, FirebaseAdminConfigSchema]);
export type IdentityConfig = z.infer<typeof IdentityConfigSchema>;
export type SelfSignupConfig = z.infer<typeof SelfSignupConfigSchema>;
export type StaticIdentityConfig = z.infer<typeof StaticIdentityConfigSchema>;
export type FirebaseAdminConfig = z.infer<typeof FirebaseAdminConfigSchema>;

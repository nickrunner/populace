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

/**
 * A pool of accounts that already exist on the target, one per person.
 *
 * The preferred file shape is keyed by COHORT:
 *
 * ```json
 * { "byCohort": { "weekend-planners": [ { "bearerToken": "...", "email": "..." } ], "sceptics": [ ... ] } }
 * ```
 *
 * because an account is handed to a person by their ordinal within their cohort — the only index
 * that is the same in every process and after a restart — and an ordinal only identifies a person
 * once the list it indexes belongs to one cohort. The older shapes still work: a record keyed by
 * persona id (`{ "<personaId>": [ ... ] }`) and a flat array whose entries may carry `personaId`.
 * They are refused at run start when one of their pools would serve more than one cohort, because
 * two cohorts on one persona both have a person 1 and would be handed the same account.
 *
 * Entries are `{ bearerToken, userId?, email?, displayName?, expiresAt?, redeemable?, tags? }`.
 * `bearerToken` is required here even though `CredentialSchema` makes it optional: a static pool
 * derives nothing, so an entry without one would connect as whoever the endpoint's own gateway
 * token is. These accounts are NOT owned by populace — a sweep leaves them alone and says so.
 */
export const StaticIdentityConfigSchema = z.object({
  strategy: z.literal("static"),
  /** JSON file: `{ "byCohort": { "<cohortSlug>": [ { bearerToken, ... } ] } }` (preferred), a persona-keyed record, or a flat array. */
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

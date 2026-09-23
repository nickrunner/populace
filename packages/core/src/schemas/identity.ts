import { z } from "zod";

/**
 * `none` is a strategy with no identities: nobody is signed up, no row is written and there is
 * nothing to sweep (ADR-0038). It is here rather than modelled as an absent `identity` because
 * every row and every check that reports a strategy has to be able to report this one.
 */
export const IdentityStrategySchema = z.enum(["self-signup", "admin-mint", "static", "provision-url", "none"]);
export type IdentityStrategy = z.infer<typeof IdentityStrategySchema>;

/**
 * What a provider redeems for a fresh bearer token when the current one expires.
 *
 * The durable fact about a person is not the bearer: a bearer is minted, it rots (a Firebase ID
 * token lasts 3600 seconds), and a population that provisions once and wakes for a week would die
 * within the hour if the bearer were all that was kept. The durable fact is whatever the vendor
 * hands back alongside it, which is why this is modelled as a `kind` plus an opaque secret rather
 * than as a `refreshToken` field: OAuth and Firebase redeem a refresh token, Clerk and Supabase
 * redeem a sign-in ticket, and a hand-rolled target redeems a password.
 *
 * `secret` is a LONGER-LIVED credential than the bearer it mints. It is redacted, omitted or
 * handle-substituted everywhere `bearerToken` is: never on the wire, never in a config snapshot,
 * never in a trace.
 */
export const RedeemableSchema = z.object({
  kind: z.enum(["refresh-token", "ticket", "password"]),
  secret: z.string().min(1),
});
export type Redeemable = z.infer<typeof RedeemableSchema>;

export const CredentialSchema = z.object({
  /**
   * Bearer token presented to the target's MCP endpoints.
   *
   * Optional, because for an OAuth or Firebase target the bearer is DERIVED — it is minted from
   * `redeemable` and replaced whenever it expires — and a schema that made it required asserted
   * that a bearer is the durable fact about a person. A credential with no bearer and no
   * redeemable is an unauthenticated session, which is what a provider that could not mint one
   * should hand back rather than a token the target will reject.
   */
  bearerToken: z.string().min(1).optional(),
  /** When `bearerToken` stops being accepted. Null when it does not expire, or when nobody said. */
  expiresAt: z.iso.datetime().nullable().default(null),
  /** How to mint a fresh bearer once this one has expired. Null when the credential cannot be renewed. */
  redeemable: RedeemableSchema.nullable().default(null),
  /** The target's own user id, when known. */
  userId: z.string().optional(),
  email: z.string().optional(),
  displayName: z.string().optional(),
  /** Provider-specific extras (e.g. a vendor's account handle) kept for teardown. */
  extra: z.record(z.string(), z.string()).default({}),
});
export type Credential = z.infer<typeof CredentialSchema>;

/**
 * Ten minutes, which is a whole wake and then some.
 *
 * The margin has to cover the session, not the instant it starts: a wake runs up to
 * `guardrails.perWake.maxTurns` model calls with a tool round-trip between each, so a bearer with
 * three minutes left is judged fresh, connects, and then dies halfway through — and the whole
 * visit is thrown away for a renewal that costs one HTTP call off the model path.
 */
export const REDEEM_SKEW_MS = 10 * 60_000;

/**
 * Whether this credential should be redeemed before it is used again: it has an expiry and that
 * expiry is within `skewMs` of now. A credential with no `expiresAt` is taken at its word unless
 * it has no bearer at all — plenty of targets issue bearers that never expire, and redeeming one
 * on every wake would burn a vendor call per person per visit for nothing.
 *
 * `redeemable` is deliberately NOT consulted. Whether an expiring credential can be renewed is the
 * provider's question, not the schema's: Firebase can mint a fresh session for a known uid with
 * nothing from the old one, so a credential minted through a custom exchange endpoint that handed
 * back no refresh token is still renewable. A provider with genuinely nothing to redeem throws, and
 * the wake ends `auth-failed` instead of spending its budget on a bearer that is already dead.
 */
export function credentialNeedsRedeem(credential: Credential, now: Date, skewMs: number = REDEEM_SKEW_MS): boolean {
  if (credential.expiresAt === null) return credential.bearerToken === undefined;
  return Date.parse(credential.expiresAt) - skewMs <= now.getTime();
}

export const IdentitySchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  tag: z.string().min(1),
  agentId: z.string().min(1),
  personaId: z.string().min(1),
  strategy: IdentityStrategySchema,
  credential: CredentialSchema,
  createdAt: z.iso.datetime(),
  tornDownAt: z.iso.datetime().nullable().default(null),
});
export type Identity = z.infer<typeof IdentitySchema>;

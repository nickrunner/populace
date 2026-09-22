import { z } from "zod";

/**
 * What an OAuth authorization server handed back, normalised. The wire spellings are snake_case
 * and `expires_in` is a duration; both are converted at the boundary so a row read a week later
 * still says when the token dies rather than how long it lived when nobody was looking.
 */
export const OAuthTokenSetSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.string().min(1).default("Bearer"),
  /** Absent when the server issues no refresh token, which makes the sign-in die with the access token. */
  refreshToken: z.string().min(1).optional(),
  /** Null when the server did not say. */
  expiresAt: z.iso.datetime().nullable().default(null),
  scope: z.string().nullable().default(null),
});
export type OAuthTokenSet = z.infer<typeof OAuthTokenSetSchema>;

/**
 * A flow that has been started and not finished: the PKCE verifier and the `state` the
 * authorization server will hand back. It is kept on the row rather than in a map in memory
 * because the two halves of the flow are two HTTP requests with a browser and somebody else's
 * login screen in between, and a callback that cannot find its verifier is a dead end the user
 * cannot do anything about.
 */
export const PendingAuthorizationSchema = z.object({
  state: z.string().min(1),
  codeVerifier: z.string().min(1),
  startedAt: z.iso.datetime(),
});
export type PendingAuthorization = z.infer<typeof PendingAuthorizationSchema>;

/**
 * YOUR sign-in to a target's MCP endpoint — the OAuth grant populace holds so it can connect to a
 * server that will not talk to strangers (ADR-0036).
 *
 * This is deliberately NOT how a person in a population gets in. A grant is one human's account,
 * acquired at a browser by that human consenting; the people a simulation sends are supposed to be
 * strangers with accounts of their own, which is what `identity` on the target is for. The two are
 * kept apart by construction: `runWake` never sees one of these, and the only things that connect
 * with a grant are the ones acting as the user — checking the address and listing the tools.
 *
 * Keyed by `(projectId, url)`. Two targets in one project on the same address — a dev target and
 * the same dev server behind a second name — are the same server and the same sign-in. Two
 * projects are never the same sign-in, because nothing is shared across projects (ADR-0035).
 */
export const SignInGrantSchema = z.object({
  projectId: z.string().min(1),
  /** The MCP endpoint this signs in to, normalised (`new URL(...).href`). */
  url: z.url(),
  /** What the resource called itself in its RFC 9728 metadata. Null when it published no name. */
  resourceName: z.string().nullable().default(null),
  /** The authorization server discovery found, for the screen to name. Null before discovery. */
  authorizationServer: z.string().nullable().default(null),
  /**
   * The redirect URI this client was registered with. `populace serve` picks its port at boot, so
   * the same store opened on a different port is a client registration the authorization server
   * will refuse — comparing this is what makes that a re-registration instead of a mystery.
   */
  redirectUri: z.string().min(1),
  /** Dynamic client registration's answer (RFC 7591), or a client somebody configured by hand. */
  clientId: z.string().min(1),
  clientSecret: z.string().min(1).optional(),
  /** Scopes asked for, as the space-separated string OAuth uses. Null when the server named none. */
  scope: z.string().nullable().default(null),
  /** Null when the client is registered but nobody has consented yet. */
  tokens: OAuthTokenSetSchema.nullable().default(null),
  /** Null when no flow is in flight. */
  pending: PendingAuthorizationSchema.nullable().default(null),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type SignInGrant = z.infer<typeof SignInGrantSchema>;

/**
 * The same address written two ways is one sign-in. Everything that keys a grant goes through
 * here, so `https://mcp.dev.stays.co/mcp` and `https://mcp.dev.stays.co:443/mcp` do not become two
 * registrations and two consent screens.
 */
export function normalizeEndpointUrl(url: string): string {
  return new URL(url).href;
}

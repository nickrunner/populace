import { z } from "zod";
import type { JsonObject } from "./json.js";

/**
 * Every failure the kit reports, in the words the caller can act on.
 *
 * Three of these look alike from inside the app and are entirely different from outside it:
 *
 * - `refused` is the app saying no to something it could have done — the production guard, an
 *   email domain it will not accept. Change something and ask again.
 * - `unsupported` is the app saying it never could: a capability the handshake already reported
 *   `false`. Asking again will never work.
 * - `gone` is the app saying that PERSON is not there any more. Provision a new one; do not keep
 *   trying to renew a session for somebody who no longer exists.
 *
 * The last one is worth its own code because without it the first implementor reaches for
 * `refused` and the second for `internal`, and populace can never tell "make a new person" from
 * "stop" — which is the difference between a run that continues and a run that dies.
 */
export const TdkErrorCodeSchema = z.enum(["unauthorized", "bad_request", "refused", "unsupported", "gone", "internal"]);
export type TdkErrorCode = z.infer<typeof TdkErrorCodeSchema>;

export const ErrorBodySchema = z.object({
  error: z.object({
    code: TdkErrorCodeSchema,
    message: z.string(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

const STATUS: Record<TdkErrorCode, number> = {
  unauthorized: 401,
  bad_request: 400,
  refused: 403,
  gone: 404,
  unsupported: 501,
  internal: 500,
};

export function statusFor(code: TdkErrorCode): number {
  return STATUS[code];
}

/**
 * Thrown by an app's own hook to answer populace deliberately instead of by accident.
 *
 * An implementor who throws an ordinary `Error` gets `internal` and a message trimmed to one line;
 * one who throws this gets to choose the code and knows the message survives intact. `throw new
 * TdkError("refused", "This target only makes accounts for @example.com addresses")` reads to the
 * user as a decision, which it is, rather than as the product falling over.
 */
export class TdkError extends Error {
  constructor(
    readonly code: TdkErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TdkError";
  }
}

/** A JWT, the shape of it. Firebase ID tokens, Supabase sessions and Clerk tokens are all this. */
const JWT = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]+/g;

/**
 * Scrubs credentials out of anything on its way to a human.
 *
 * The message in an error body is shown verbatim in populace's UI, which means it ends up in
 * screenshots, in terminal scrollback and in bug reports. A vendor SDK that helpfully includes the
 * request it just made, or an implementor who interpolates the token into their own error, would
 * otherwise publish the secret that guards this route and the bearer of the account it just made.
 * The secret is known to us; bearers are matched by shape, because the ones we hold are not the
 * only ones that can appear in somebody else's error string.
 */
export function scrub(message: string, secrets: readonly (string | null | undefined)[]): string {
  let out = message.replace(JWT, "[redacted]");
  for (const secret of secrets) {
    // Below a few characters a "secret" is more likely to be a substring of ordinary prose than a
    // credential, and blanking every "a" in a sentence helps nobody.
    if (typeof secret !== "string" || secret.length < 6) continue;
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

/** Errors are one line and never a stack: the reader is a user of populace, not of this codebase. */
export function messageOf(err: Error): string {
  const firstLine = err.message.split("\n")[0] ?? "";
  return firstLine.length > 300 ? `${firstLine.slice(0, 299)}…` : firstLine;
}

export function errorBody(code: TdkErrorCode, message: string, secrets: readonly (string | null | undefined)[]): JsonObject {
  return { error: { code, message: scrub(message, secrets) } };
}

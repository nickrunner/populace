import { z } from "zod";
import { IdentityStrategySchema } from "./identity.js";

/**
 * How far one person got through the front door. The whole value of the check is that these are
 * different words rather than one "it did not work":
 *
 * - `unreachable`      — the MCP endpoint never answered, so nothing else could be tried.
 * - `provision-failed` — the endpoint answered, and the identity strategy could not make an
 *                        account; the provider's own error is in `detail`.
 * - `rejected`         — an account was made and the target refused its credential (401/403).
 *                        For admin-mint this is the "your backend may not accept this issuer's
 *                        tokens" case, and the summary says so in those words.
 * - `accepted`         — the account was made and a read-only tool answered it.
 * - `tool-failed`      — the credential got through (the target ran the handler) but the tool it
 *                        was tried on returned an error. The identity works; that tool did not.
 * - `connected-only`   — the target marks nothing `readOnlyHint`, so the connection was verified
 *                        and no tool was called. Nothing that could write is ever tried.
 */
export const FirstContactOutcomeSchema = z.enum(["unreachable", "provision-failed", "rejected", "accepted", "tool-failed", "connected-only"]);
export type FirstContactOutcome = z.infer<typeof FirstContactOutcomeSchema>;

/** An account the check made and could not remove. Named, because silence would leave it a secret. */
export const LeftBehindSchema = z.object({
  /** The account handle — an email or a user id. Never a token. */
  handle: z.string(),
  /** Why it is still there, in the user's words. */
  why: z.string(),
});

/**
 * One person, one account, one read-only call: what happens when this target is used for real,
 * found out before a run is started rather than after one has failed.
 *
 * No model is called, so this costs nothing in Anthropic spend, and no credential material ever
 * reaches this shape — the account HANDLE is the only thing carried out, exactly as everywhere
 * else in the product.
 */
export const FirstContactSchema = z.object({
  outcome: FirstContactOutcomeSchema,
  checkedAt: z.iso.datetime(),
  strategy: IdentityStrategySchema,
  /** One line, in the user's words, that says what happened and what to do about it. */
  summary: z.string(),
  /** The provider's or the target's own words, when there are any. */
  detail: z.string().nullable().default(null),
  /** The account this check made (or drew from a pool). Null when it never got one. */
  handle: z.string().nullable().default(null),
  /** The read-only tool that answered. Null when none was called. */
  tool: z.string().nullable().default(null),
  latencyMs: z.number().nonnegative().nullable().default(null),
  /** True when the account was removed again. False is only acceptable alongside `leftBehind`. */
  tornDown: z.boolean().default(false),
  leftBehind: LeftBehindSchema.nullable().default(null),
});
export type FirstContact = z.infer<typeof FirstContactSchema>;

/** Whether this result means a population could actually get in. */
export function firstContactWorked(result: FirstContact): boolean {
  return result.outcome === "accepted" || result.outcome === "connected-only" || result.outcome === "tool-failed";
}

import { z } from "zod";
import { matchesAny } from "../glob.js";

/**
 * What to do with tools the target annotates `destructiveHint: true` (ADR-0013). Ordered from
 * loosest to strictest, which is what `strictestDestructive` reads.
 */
export const DestructiveSettingSchema = z.enum(["allow", "confirm", "deny"]);
export type DestructiveSetting = z.infer<typeof DestructiveSettingSchema>;

const STRICTNESS: Record<DestructiveSetting, number> = { allow: 0, confirm: 1, deny: 2 };

/** The stricter of two settings. `deny` beats `confirm` beats `allow`, in either order. */
export function strictestDestructive(a: DestructiveSetting, b: DestructiveSetting): DestructiveSetting {
  return STRICTNESS[a] >= STRICTNESS[b] ? a : b;
}

export const ToolPolicySchema = z.object({
  /** Glob patterns. Empty means every target tool is allowed. */
  allow: z.array(z.string()).default([]),
  /** Glob patterns. Always wins over allow. */
  deny: z.array(z.string()).default([]),
  /** What to do with tools annotated `destructiveHint: true`. */
  destructive: DestructiveSettingSchema.default("confirm"),
});
export type ToolPolicy = z.infer<typeof ToolPolicySchema>;

/**
 * Several policies collapsed into the one decision a wake actually makes.
 *
 * `allow` is a list OF LISTS rather than a single list, and that is the whole point. Two allow
 * lists have to be intersected — a persona must never be able to widen what the target permits —
 * and the intersection of two glob sets is not a glob set: `list_*` ∩ `*_tasks` is neither
 * pattern, and flattening them into one list would union them, which is exactly the "fails OPEN"
 * mistake. So each source's list is kept as its own gate and a tool has to clear EVERY gate. An
 * empty list is no gate at all (the schema's "empty means everything"), so it is dropped on the
 * way in rather than mistaken for "nothing is allowed".
 *
 * `deny` is a plain union: a deny from any source is a deny.
 */
export interface EffectiveToolPolicy {
  /** Every allow list that must be satisfied. A tool must match all of them; an empty array gates nothing. */
  allow: readonly (readonly string[])[];
  deny: readonly string[];
  destructive: DestructiveSetting;
}

/**
 * The policy a wake runs under: the target's merged with the persona's.
 *
 * Deny always wins and allow intersects, so narrowing is the only direction a later policy can
 * move. A tool that is dangerous is dangerous whoever reaches for it, which is why the target's
 * policy is the floor and a persona can only ever tighten it.
 *
 * Order does not matter — the operation is commutative — so callers need not remember which
 * argument is which.
 */
export function effectiveToolPolicy(...policies: readonly ToolPolicy[]): EffectiveToolPolicy {
  const allow: string[][] = [];
  const deny: string[] = [];
  let destructive: DestructiveSetting = "allow";
  for (const policy of policies) {
    if (policy.allow.length > 0) allow.push([...policy.allow]);
    deny.push(...policy.deny);
    destructive = strictestDestructive(destructive, policy.destructive);
  }
  return { allow, deny, destructive };
}

/**
 * Whether a tool survives every policy that was merged in. The denylist wins, then every allow
 * gate has to pass; no gates means everything the target exposes.
 */
export function isToolPermitted(name: string, policy: EffectiveToolPolicy): boolean {
  if (matchesAny(name, policy.deny)) return false;
  return policy.allow.every((gate) => matchesAny(name, gate));
}

/** Why a tool is blocked, in the words a screen shows. Null when it is not blocked. */
export function blockedBecause(name: string, policy: EffectiveToolPolicy): string | null {
  if (matchesAny(name, policy.deny)) return "on the denylist";
  if (policy.allow.some((gate) => !matchesAny(name, gate))) return "not on the allowlist";
  return null;
}

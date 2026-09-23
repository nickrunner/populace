import type { Identity, IdentityProvider, ProvisionResult, TeardownDeps } from "@populace/core";

/**
 * Nobody needs an account here (ADR-0038).
 *
 * The other four providers all answer the question "how does this person get in". This one
 * answers a different question — "does anybody have to?" — with no. A documentation server, a
 * search index, an internal read-only tool: the MCP surface is a library rather than an account,
 * and every person who visits sees the same thing.
 *
 * It is a provider rather than an absent `identity` because everything downstream of provisioning
 * is written against one: the runner asks a provider, first contact asks a provider, a sweep asks
 * a provider what it left behind. A null identity was already the state `runWake` connects in —
 * it falls back to whatever the ADDRESS itself carries — and nothing could configure it. This is
 * the one variant that can.
 *
 * Every method is the empty answer, and each one is empty for its own reason:
 *
 * - `ownsAccounts = false`, so a sweep never reports a removal. There is nothing to remove, and
 *   "removed 0 accounts" and "left 0 accounts alone" are the same number saying two things.
 * - `teardown` is a no-op because no identity row is ever written for this strategy, so it can
 *   only ever be called with an identity from some earlier configuration — which this provider
 *   has no standing to delete.
 * - `listByTag` reads the store rather than returning `[]` outright: a run configured one way and
 *   then switched to this one still has its old identity rows, and a sweep that pretended they
 *   were not there would leave accounts on somebody's product with nothing left to name them.
 */
export class NoAccountsProvider implements IdentityProvider {
  readonly strategy = "none" as const;
  /** populace creates nothing here, so a sweep must never count anything as a removal. */
  readonly ownsAccounts = false;

  provision(): Promise<ProvisionResult> {
    return Promise.resolve({ kind: "none" });
  }

  teardown(): Promise<void> {
    return Promise.resolve();
  }

  listByTag(tag: string, deps: TeardownDeps): Promise<Identity[]> {
    return deps.listStoredIdentities(tag);
  }
}

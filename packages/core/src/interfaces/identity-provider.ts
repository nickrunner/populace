import type { Agent } from "../schemas/agent.js";
import type { Credential, Identity, IdentityStrategy } from "../schemas/identity.js";
import type { JsonValue } from "../json.js";

export interface ProvisionContext {
  agent: Agent;
  runId: string;
  tag: string;
}

/** What a provider hands back from `provision`. */
export type ProvisionResult =
  | { kind: "credential"; credential: Credential }
  | {
      /** The agent must obtain its own identity through the target (self-signup). */
      kind: "self-service";
      /** Tool the runner should watch for the credential. */
      signupTool: string;
      /** Deterministic values the runner should suggest to the agent so the identity carries the tag. */
      suggested: { email: string; displayName: string; password: string };
    }
  | {
      /**
       * There is no account and there will not be one (ADR-0038).
       *
       * Distinct from `self-service`, which is "the agent has to go and get one": nobody here is
       * going to. The runner leaves `identity` null and connects with whatever the ADDRESS itself
       * carries, which is the endpoint's own token or nothing at all — and no identity row is
       * written, so a sweep finds nothing to remove and correctly says so.
       */
      kind: "none";
    };

/**
 * What a target says it can do, asked rather than assumed.
 *
 * A provider may answer with more than this — `provision-url` answers with the kit's whole
 * handshake — and callers that only need to know whether teardown is possible read
 * `cannotRemove` afterwards rather than this shape.
 */
export interface ProviderDescription {
  capabilities: { refresh: boolean; teardown: boolean; listByTag: boolean };
}

export interface CaptureContext {
  tool: string;
  arguments: JsonValue;
  /** structuredContent when present, else the parsed text result, else the raw text. */
  result: JsonValue;
}

/**
 * Yields credentials for personas and can take them back (ADR-0010, ADR-0012).
 * Every provider supports teardown and listByTag so a sweep can remove leaked identities.
 */
export interface IdentityProvider {
  readonly strategy: IdentityStrategy;
  /**
   * False when the accounts this provider hands out EXIST ALREADY — a static pool is a list of
   * logins a human pasted in, on somebody's real product, and populace made none of them.
   *
   * Absent or true means populace created them and a sweep is expected to remove them. The
   * distinction is reporting, not policy: `teardown` on a provider that owns nothing is correctly
   * a no-op, but a sweep that counts a no-op as a removal tells the user their accounts are gone
   * when they are still there, and the "evidence is only deleted once every teardown succeeded"
   * guard becomes vacuous because nothing can fail.
   */
  readonly ownsAccounts?: boolean;
  /**
   * Why this provider cannot delete accounts it DID create, in the user's words; undefined when it
   * can. Distinct from `ownsAccounts: false`, which is about accounts populace never created.
   *
   * A self-signup target with no `teardownTool` is the common case and a supported one — `validate`
   * warns about it rather than refusing it — and on such a target `teardown` returns without
   * calling anything. A sweep that reads a resolved promise as a deletion then reports "tore down"
   * for every account the population signed up for while all of them are still on the product, and
   * `failures === 0` is again a guard that cannot fail, so the evidence naming those accounts is
   * dropped on the strength of it.
   */
  readonly cannotRemove?: string | undefined;
  /**
   * Ask the target what it can do, before anything is asked OF it. Absent when there is nothing
   * to ask, which is every provider whose capabilities are decided here rather than over a wire.
   *
   * `cannotRemove` on a provider that learns its answer from the target is `undefined` until this
   * has been called, and `undefined` reads as "it can remove them". A sweep that skipped this
   * attempted every teardown against an app that soft-deletes, got `unsupported` back from each
   * one, and reported N FAILURES where the truth is N accounts left behind — the outcome ADR-0037
   * promised in writing and did not deliver.
   */
  describe?(): Promise<ProviderDescription>;
  provision(ctx: ProvisionContext): Promise<ProvisionResult>;
  /**
   * Problems with serving this WHOLE population, in the user's words; empty when there are none.
   *
   * `provision` sees one agent at a time, so a property about the population — "every person gets
   * their own account" — cannot be checked there at all: a pool one entry short, or one pool
   * serving two cohorts that both number their people from 1, looks perfectly fine agent by agent
   * and collides across them. This is called where the population IS visible, when a run is
   * starting, before anything is spent. Starting a run that will collide is worse than refusing.
   */
  checkPopulation?(agents: readonly Agent[]): string[];
  /**
   * For self-service providers: inspect a successful call to the signup tool and
   * extract the credential. Returns undefined when nothing was captured.
   */
  capture?(ctx: CaptureContext): Credential | undefined;
  /**
   * Mint a fresh credential for an identity whose bearer has expired, from what
   * `credential.redeemable` holds. The runner calls this before a wake rather than after a 401,
   * so a person provisioned on Monday is still the same person on Friday.
   *
   * Absent when the strategy has nothing to redeem — a self-signup token the target never expires,
   * a static pool whose entries a human pasted in. Returns the whole credential, not just the
   * bearer, because a redemption usually rotates the redeemable too.
   */
  refresh?(identity: Identity): Promise<Credential>;
  /** Remove the identity from the target. Must be idempotent. */
  teardown(identity: Identity, deps: TeardownDeps): Promise<void>;
  /** Identities carrying the tag that this provider knows about (target-side where possible, store-side otherwise). */
  listByTag(tag: string, deps: TeardownDeps): Promise<Identity[]>;
}

/** What a provider may use during teardown/list: a way to call target tools with a bearer, and the store. */
export interface TeardownDeps {
  callTool(bearerToken: string | undefined, tool: string, args: JsonValue): Promise<{ isError: boolean; text: string }>;
  listStoredIdentities(tag: string): Promise<Identity[]>;
}

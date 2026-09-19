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
    };

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
  provision(ctx: ProvisionContext): Promise<ProvisionResult>;
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

import { createHash } from "node:crypto";
import {
  getPath,
  type CaptureContext,
  type Credential,
  type Identity,
  type IdentityProvider,
  type ProvisionContext,
  type ProvisionResult,
  type SelfSignupConfig,
  type TeardownDeps,
} from "@populace/core";

/**
 * The agent signs up through the target's own tools; the runner captures the
 * credential from the signup tool's result (ADR-0012).
 */
export class SelfSignupProvider implements IdentityProvider {
  readonly strategy = "self-signup" as const;

  constructor(private readonly config: SelfSignupConfig) {}

  /**
   * The local part is the PERSON's handle, not `slugify(persona.id)-${ordinal + 1}`: that collided
   * the moment two cohorts shared a persona, and a colliding signup email means the second cohort
   * cannot make an account at all. The display name is the person's name for the same reason — a
   * persona is a kind of person and does not have one.
   *
   * The handle is read off the agent rather than re-derived from the name. It was minted once, by
   * `handleFor`, when the person row was written, and frozen into the config snapshot; deriving a
   * second one here would mean a person whose handle came from anywhere else — a model, a rename —
   * signs up as somebody the roster does not know (SPEC §5.3.5).
   */
  provision(ctx: ProvisionContext): Promise<ProvisionResult> {
    const local = `${ctx.agent.handle}+${ctx.tag}`;
    const password = `Pw-${createHash("sha256").update(`${ctx.tag}:${ctx.agent.id}`).digest("base64url").slice(0, 14)}`;
    return Promise.resolve({
      kind: "self-service",
      signupTool: this.config.signupTool,
      suggested: { email: `${local}@${this.config.emailDomain}`, displayName: ctx.agent.name, password },
    });
  }

  capture(ctx: CaptureContext): Credential | undefined {
    if (ctx.tool !== this.config.signupTool) return undefined;
    const token = getPath(ctx.result, this.config.tokenPath);
    if (typeof token !== "string" || token.length === 0) return undefined;
    const userId = this.config.userIdPath ? getPath(ctx.result, this.config.userIdPath) : undefined;
    const email = typeof ctx.arguments === "object" && ctx.arguments !== null && !Array.isArray(ctx.arguments) ? ctx.arguments.email : undefined;
    return {
      bearerToken: token,
      // The target said nothing about an expiry or a way to renew, so neither is invented: a
      // self-signup token is taken at its word until the target refuses it (see `auth-failed`).
      expiresAt: null,
      redeemable: null,
      ...(typeof userId === "string" ? { userId } : {}),
      ...(typeof email === "string" ? { email } : {}),
      extra: {},
    };
  }

  async teardown(identity: Identity, deps: TeardownDeps): Promise<void> {
    if (!this.config.teardownTool) return;
    const result = await deps.callTool(identity.credential.bearerToken, this.config.teardownTool, {});
    // An already-deleted account answers with an auth error; that is success for an idempotent teardown.
    if (result.isError && !/token|unauthori|not found|no such/i.test(result.text)) throw new Error(`teardown of ${identity.id} failed: ${result.text}`);
  }

  listByTag(tag: string, deps: TeardownDeps): Promise<Identity[]> {
    return deps.listStoredIdentities(tag);
  }
}

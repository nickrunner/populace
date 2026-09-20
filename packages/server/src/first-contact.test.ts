import { SelfSignupProvider } from "@populace/adapters/self-signup";
import {
  StoredTargetSchema,
  type Credential,
  type Identity,
  type IdentityProvider,
  type ProvisionResult,
  type StoredTarget,
  type ToolPolicy,
} from "@populace/core";
import { startMockTarget, type RunningMockTarget } from "@populace/mock-target";
import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { firstContact } from "./first-contact.js";

let target: RunningMockTarget;
beforeEach(async () => {
  target = await startMockTarget({ quiet: true });
});
afterEach(async () => {
  await target.close();
});

const at = new Date("2026-09-18T12:00:00.000Z");

function storedTarget(overrides: Partial<StoredTarget> = {}): StoredTarget {
  return StoredTargetSchema.parse({
    id: "tgt_first_contact",
    projectId: "default",
    slug: "tasklet",
    name: "Tasklet",
    mcp: [{ name: "default", url: target.mcpUrl }],
    identity: { strategy: "self-signup", signupTool: "sign_up", tokenPath: "token", userIdPath: "user.id", teardownTool: "delete_account" },
    createdAt: at.toISOString(),
    updatedAt: at.toISOString(),
    ...overrides,
  });
}

/**
 * A provider that hands out one credential of the test's choosing and can be told it owns nothing
 * or cannot remove what it made. Injected rather than driven through a file, so these tests stay
 * offline and say exactly which provider property they are about.
 */
class FakeProvider implements IdentityProvider {
  readonly strategy = "admin-mint" as const;
  tornDownCount = 0;
  constructor(
    private readonly credential: Credential,
    readonly ownsAccounts?: boolean,
    readonly cannotRemove?: string,
    private readonly teardownError?: string,
  ) {}
  provision(): Promise<ProvisionResult> {
    return Promise.resolve({ kind: "credential", credential: this.credential });
  }
  teardown(_identity: Identity): Promise<void> {
    this.tornDownCount++;
    return this.teardownError === undefined ? Promise.resolve() : Promise.reject(new Error(this.teardownError));
  }
  listByTag(): Promise<Identity[]> {
    return Promise.resolve([]);
  }
}

/** Every account on the mock target right now, by email. */
const accounts = (): string[] => target.app.listUsers().map((u) => u.email);

describe("first contact: one person through the front door", () => {
  it("makes an account, calls a read-only tool with it, names both, and takes the account back down", async () => {
    const result = await firstContact(storedTarget(), { now: () => at });

    expect(result.outcome).toBe("accepted");
    expect(result.handle).toContain("@populace.test");
    // The tool it answered through is one Tasklet itself annotates readOnlyHint and that needs an
    // account to answer at all — which is what makes it evidence that the credential works.
    expect(result.tool).toBe("get_me");
    expect(result.summary).toContain("get_me");
    expect(result.latencyMs).not.toBeNull();
    // Cleaned up: it is gone from the product, not merely reported as gone.
    expect(result.tornDown).toBe(true);
    expect(result.leftBehind).toBeNull();
    expect(accounts()).toEqual([]);
  });

  it("makes no model call and leaves no run rows behind", async () => {
    // Nothing here is given a model provider or an API key, and the result carries no cost: the
    // check has to be runnable by somebody who has not decided to spend anything yet.
    const result = await firstContact(storedTarget(), { now: () => at });
    expect(result.outcome).toBe("accepted");
    expect(JSON.stringify(result)).not.toContain("usd");
  });

  it("says the endpoint could not be reached, and does not confuse that with a refused credential", async () => {
    const dead = storedTarget({ mcp: [{ name: "default", url: "http://127.0.0.1:1/mcp", headers: {} }] });
    const result = await firstContact(dead, { now: () => at });

    expect(result.outcome).toBe("unreachable");
    expect(result.handle).toBeNull();
    expect(result.tool).toBeNull();
    expect(result.detail).not.toBeNull();
    // Nothing was created, so there is nothing to have left behind.
    expect(result.leftBehind).toBeNull();
    expect(accounts()).toEqual([]);
  });

  it("distinguishes a token the target refuses from an endpoint that never answered", async () => {
    const provider = new FakeProvider({ bearerToken: "not-a-token-this-target-issued", expiresAt: null, redeemable: null, email: "probe@populace.test", extra: {} });
    const result = await firstContact(storedTarget(), { identityProvider: provider, now: () => at });

    expect(result.outcome).toBe("rejected");
    expect(result.handle).toBe("probe@populace.test");
    expect(result.tool).toBe("get_me");
    // admin-mint is the strategy that cannot be expected to infer why: the account is real and the
    // product simply does not accept this issuer's tokens, and the summary has to say so.
    expect(result.summary).toContain("does not accept this issuer's tokens");
    expect(result.detail).toContain("bearer token is not valid");
    expect(result.tornDown).toBe(true);
  });

  it("says the identity strategy could not provision, in the provider's own words", async () => {
    const wrongTool = storedTarget({
      identity: { strategy: "self-signup", signupTool: "enrol_me", tokenPath: "token", emailDomain: "populace.test" },
    });
    const result = await firstContact(wrongTool, { now: () => at });

    expect(result.outcome).toBe("provision-failed");
    expect(result.detail).toContain("enrol_me");
    expect(result.handle).toBeNull();
    expect(accounts()).toEqual([]);
  });

  it("names the account the sign-up tool made when the token path is wrong, instead of claiming nothing was left", async () => {
    // The likeliest misconfiguration there is: the sign-up tool works, and `tokenPath` points at
    // nothing. By then the account is on somebody's product, and there is no credential to
    // authenticate a deletion with — so the one thing that must not happen is silence.
    const wrongPath = storedTarget({
      identity: { strategy: "self-signup", signupTool: "sign_up", tokenPath: "accessToken", teardownTool: "delete_account", emailDomain: "populace.test" },
    });
    const result = await firstContact(wrongPath, { now: () => at });

    expect(result.outcome).toBe("provision-failed");
    expect(result.handle).not.toBeNull();
    expect(result.leftBehind?.handle).toBe(result.handle);
    expect(result.summary).not.toContain("Nothing was left behind");
    expect(result.summary).toContain(result.handle ?? "");
    // And it really is there. The result is not being cautious; it is describing the product.
    expect(accounts()).toEqual([result.handle]);
  });

  it("refuses to sign up with a tool the target's own policy blocks, and says why", async () => {
    // A run cannot reach a blocked tool either (`runWake` filters on the same merged policy), so a
    // check that signed up anyway would report "they can get in" for a configuration in which
    // nobody can get an account at all.
    const tools: ToolPolicy = { allow: [], deny: ["sign_up"], destructive: "confirm" };
    const result = await firstContact(storedTarget({ tools }), { now: () => at });

    expect(result.outcome).toBe("provision-failed");
    expect(result.summary).toContain("sign_up");
    expect(result.summary).toContain("tool policy");
    expect(result.handle).toBeNull();
    expect(result.leftBehind).toBeNull();
    // Nothing was created: the policy was checked before the call, not after it.
    expect(accounts()).toEqual([]);
  });

  it("is blocked by an allowlist that omits the sign-up tool, which is the realistic shape", async () => {
    const tools: ToolPolicy = { allow: ["get_*", "list_*"], deny: [], destructive: "confirm" };
    const result = await firstContact(storedTarget({ tools }), { now: () => at });

    expect(result.outcome).toBe("provision-failed");
    expect(result.summary).toContain("sign_up");
    expect(accounts()).toEqual([]);
  });

  it("never quotes the endpoint's own bearer token, even before an account exists", async () => {
    // A gateway that answers 401 with the Authorization header it received is a real thing, and
    // this detail is written onto the target row and rendered in the editor. The endpoint token is
    // reduced to `authenticated: boolean` everywhere else; it must not come back out through here.
    const gatewayToken = "gw_super_secret_gateway_token";
    const echo = createServer((req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `rejected credential ${req.headers.authorization ?? ""}` }));
    });
    await new Promise<void>((resolve) => echo.listen(0, "127.0.0.1", resolve));
    const address = echo.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    try {
      const behindGateway = storedTarget({ mcp: [{ name: "default", url: `http://127.0.0.1:${port}/mcp`, bearerToken: gatewayToken, headers: {} }] });
      const result = await firstContact(behindGateway, { now: () => at });

      expect(result.outcome).toBe("unreachable");
      expect(JSON.stringify(result)).not.toContain(gatewayToken);
      // The failure is still reported in full — the secret is replaced, not the message.
      expect(result.detail).toContain("[redacted]");
    } finally {
      await new Promise<void>((resolve) => echo.close(() => resolve()));
    }
  });

  it("says an account was left behind, and names it, when the provider cannot remove it", async () => {
    // Self-signup with no teardown tool: the account IS populace's and there is no way to delete
    // it. Silence here would leave a user on somebody's product with nobody told.
    const noTeardown = storedTarget({
      identity: { strategy: "self-signup", signupTool: "sign_up", tokenPath: "token", emailDomain: "populace.test" },
    });
    const result = await firstContact(noTeardown, { now: () => at });

    expect(result.outcome).toBe("accepted");
    expect(result.tornDown).toBe(false);
    expect(result.leftBehind?.handle).toBe(result.handle);
    expect(result.leftBehind?.why).toContain("teardown");
    // And it really is still there: the result is not being pessimistic, it is being accurate.
    expect(accounts()).toEqual([result.handle]);
  });

  it("says an account was left alone when the provider never owned it", async () => {
    const pooled = new FakeProvider({ bearerToken: "pool-entry-token", expiresAt: null, redeemable: null, email: "someone@real.example", extra: {} }, false);
    const result = await firstContact(storedTarget(), { identityProvider: pooled, now: () => at });

    expect(result.tornDown).toBe(false);
    expect(pooled.tornDownCount).toBe(0);
    expect(result.leftBehind?.handle).toBe("someone@real.example");
    expect(result.leftBehind?.why).toContain("existed before populace");
  });

  it("never puts a token, a refresh secret or an API key in the result — not even one an error quoted", async () => {
    const bearer = "tk_first_contact_bearer_secret";
    const refresh = "refresh_first_contact_secret";
    // The teardown failure quotes the credential it was handed, which is exactly how a real SDK
    // error leaks one.
    const leaky = new FakeProvider(
      { bearerToken: bearer, expiresAt: null, redeemable: { kind: "refresh-token", secret: refresh }, email: "probe@populace.test", extra: {} },
      undefined,
      undefined,
      `DELETE failed for Bearer ${bearer} (refresh ${refresh})`,
    );
    const result = await firstContact(storedTarget(), { identityProvider: leaky, now: () => at });

    const body = JSON.stringify(result);
    expect(body).not.toContain(bearer);
    expect(body).not.toContain(refresh);
    // The failure is still reported, with the account named and the secret replaced.
    expect(result.leftBehind?.handle).toBe("probe@populace.test");
    expect(result.leftBehind?.why).toContain("[redacted]");
  });

  it("respects the target's tool policy when it picks something to call", async () => {
    const tools: ToolPolicy = { allow: [], deny: ["get_me"], destructive: "confirm" };
    const result = await firstContact(storedTarget({ tools }), { now: () => at });

    expect(result.outcome).toBe("accepted");
    // get_me is the tool it would have chosen; the policy takes it away, so the next read-only
    // tool with no required arguments answers instead.
    expect(result.tool).toBe("get_product_info");
  });

  it("verifies the connection and says no tool was called when nothing is marked read-only", async () => {
    // Every read-only tool blocked: there is nothing safe left, and a check that reached for a
    // tool that might write would be worse than one that reports it called nothing.
    const tools: ToolPolicy = { allow: ["sign_up", "delete_account"], deny: [], destructive: "confirm" };
    const result = await firstContact(storedTarget({ tools }), { now: () => at });

    expect(result.outcome).toBe("connected-only");
    expect(result.tool).toBeNull();
    expect(result.summary).toContain("no tool was called");
    // And it says which of the three reasons it was: this target annotates `get_me` readOnlyHint
    // perfectly well, so "nothing is marked read-only" would send the reader off to add
    // annotations they already have instead of widening the allowlist they just wrote.
    expect(result.summary).toContain("tool policy");
    expect(result.summary).not.toContain("nothing here is marked read-only");
    expect(result.tornDown).toBe(true);
  });

  it("uses a fresh handle each time, so a second check is not a duplicate-account failure", async () => {
    const first = await firstContact(storedTarget(), { now: () => at });
    const second = await firstContact(storedTarget(), { now: () => new Date(at.getTime() + 60_000) });
    expect(first.outcome).toBe("accepted");
    expect(second.outcome).toBe("accepted");
    expect(second.handle).not.toBe(first.handle);
  });
});

/** The provider contract the check leans on, asserted directly so a change to it is caught here. */
describe("what a self-signup provider says about removal", () => {
  it("declares it cannot remove accounts when no teardown tool is configured", () => {
    const withTool = new SelfSignupProvider({ strategy: "self-signup", signupTool: "sign_up", tokenPath: "token", teardownTool: "delete_account", emailDomain: "populace.test" });
    const without = new SelfSignupProvider({ strategy: "self-signup", signupTool: "sign_up", tokenPath: "token", emailDomain: "populace.test" });
    expect(withTool.cannotRemove).toBeUndefined();
    expect(without.cannotRemove).toContain("teardown");
  });
});

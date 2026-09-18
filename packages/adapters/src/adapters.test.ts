import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, Identity, TeardownDeps } from "@populace/core";
import { describe, expect, it, vi } from "vitest";
import { FirebaseAdminProvider, SelfSignupProvider, StaticIdentityProvider, type FirebaseAuthLike } from "./index.js";

const agent: Agent = {
  id: "pop/casual#1",
  runId: "run_a_aaaaaa",
  populationId: "pop",
  persona: { id: "casual", name: "Casey", role: "r", backstory: "b", goals: ["g"], constraints: [], patience: 3, budgetUsd: 0, traits: {}, tools: { allow: [], deny: [], destructive: "confirm" }, model: {} },
  ordinal: 0,
  status: "active",
  retiredReason: null,
  continuedFrom: null,
  identityId: null,
  wakeCount: 0,
  maxWakes: null,
  nextWakeAt: null,
  lastWakeAt: null,
  createdAt: new Date().toISOString(),
};
const ctx = { agent, runId: "run_a_aaaaaa", tag: "populace:run_a_aaaaaa" };
const deps: TeardownDeps = { callTool: vi.fn(async () => ({ isError: false, text: "{}" })), listStoredIdentities: vi.fn(async () => []) };

describe("SelfSignupProvider", () => {
  const provider = new SelfSignupProvider({ strategy: "self-signup", signupTool: "sign_up", tokenPath: "token", userIdPath: "user.id", teardownTool: "delete_account", emailDomain: "populace.test" });

  it("suggests a tagged email and captures the credential from the signup result", async () => {
    const result = await provider.provision(ctx);
    expect(result.kind).toBe("self-service");
    if (result.kind !== "self-service") return;
    expect(result.suggested.email).toBe("casual-1+populace:run_a_aaaaaa@populace.test");
    const credential = provider.capture({ tool: "sign_up", arguments: { email: result.suggested.email }, result: { token: "tk_1", user: { id: "usr_1" } } });
    expect(credential).toEqual({ bearerToken: "tk_1", userId: "usr_1", email: result.suggested.email, extra: {} });
    expect(provider.capture({ tool: "other", arguments: {}, result: { token: "x" } })).toBeUndefined();
    expect(provider.capture({ tool: "sign_up", arguments: {}, result: { error: "nope" } })).toBeUndefined();
  });

  it("tears down through the configured tool", async () => {
    const identity: Identity = { id: "idn", runId: ctx.runId, tag: ctx.tag, agentId: agent.id, personaId: "casual", strategy: "self-signup", credential: { bearerToken: "tk", extra: {} }, createdAt: new Date().toISOString(), tornDownAt: null };
    await provider.teardown(identity, deps);
    expect(deps.callTool).toHaveBeenCalledWith("tk", "delete_account", {});
  });
});

describe("StaticIdentityProvider", () => {
  it("hands out credentials per persona", async () => {
    const dir = mkdtempSync(join(tmpdir(), "populace-static-"));
    const file = join(dir, "creds.json");
    writeFileSync(file, JSON.stringify({ casual: [{ bearerToken: "a" }, { bearerToken: "b" }], "*": [{ bearerToken: "z" }] }));
    const provider = new StaticIdentityProvider({ strategy: "static", file });
    const first = await provider.provision(ctx);
    const second = await provider.provision(ctx);
    const third = await provider.provision({ ...ctx, agent: { ...agent, persona: { ...agent.persona, id: "other" } } });
    expect([first, second, third].map((r) => (r.kind === "credential" ? r.credential.bearerToken : "?"))).toEqual(["a", "b", "z"]);
  });
});

describe("FirebaseAdminProvider", () => {
  it("creates a tagged user, mints a token, lists by claim and deletes", async () => {
    const users = new Map<string, { uid: string; email: string; customClaims?: Record<string, string> }>();
    const fake: FirebaseAuthLike = {
      createUser: vi.fn(async ({ email }) => {
        const uid = `uid_${users.size + 1}`;
        users.set(uid, { uid, email });
        return { uid };
      }),
      setCustomUserClaims: vi.fn(async (uid, claims) => {
        const u = users.get(uid);
        if (u) u.customClaims = claims;
      }),
      createCustomToken: vi.fn(async (uid) => `custom_${uid}`),
      listUsers: vi.fn(async () => ({ users: [...users.values()] })),
      deleteUser: vi.fn(async (uid) => {
        users.delete(uid);
      }),
    };
    const provider = new FirebaseAdminProvider({ strategy: "admin-mint", provider: "firebase", emailDomain: "populace.test" }, fake);
    const result = await provider.provision(ctx);
    expect(result.kind).toBe("credential");
    if (result.kind !== "credential") return;
    expect(result.credential.bearerToken).toBe("custom_uid_1");
    const listed = await provider.listByTag(ctx.tag, deps);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.credential.userId).toBe("uid_1");
    await provider.teardown(listed[0]!);
    expect(await provider.listByTag(ctx.tag, deps)).toHaveLength(0);
  });
});

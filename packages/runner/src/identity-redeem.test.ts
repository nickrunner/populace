import { createServer, type Server } from "node:http";
import { PopulaceConfigSchema, expandPopulation, newRunId, type Agent, type Credential, type Identity, type IdentityProvider, type PopulaceConfig, type ProvisionContext, type ProvisionResult, type TraceEvent } from "@populace/core";
import { startMockTarget, type RunningMockTarget } from "@populace/mock-target";
import { SqliteStore } from "@populace/store-sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { McpSession } from "./mcp/session.js";
import { ScriptedProvider, call, sequence } from "./testing/index.js";
import { looksLikeAuthRejection, runWake } from "./wake.js";

let target: RunningMockTarget;

type Ev<T extends TraceEvent["type"]> = Extract<TraceEvent, { type: T }>;
const ofType = <T extends TraceEvent["type"]>(trace: TraceEvent[], type: T): Ev<T>[] => trace.filter((e): e is Ev<T> => e.type === type);

beforeAll(async () => {
  target = await startMockTarget({ quiet: true });
});
afterAll(async () => {
  await target.close();
});

/** A real Tasklet account, made out of band, so a test can hand the runner a token the target accepts. */
async function realAccount(email: string): Promise<{ token: string; email: string }> {
  const session = new McpSession({ name: "default", url: target.mcpUrl, headers: {} }, undefined);
  await session.connect();
  const outcome = await session.call("sign_up", { email, displayName: "Ada Lovelace", password: "pw-12345678" });
  await session.close();
  const data = outcome.data;
  const token = typeof data === "object" && data !== null && !Array.isArray(data) ? data.token : undefined;
  if (typeof token !== "string") throw new Error(`no token in signup result: ${outcome.result.text}`);
  return { token, email };
}

/**
 * A provider whose bearer expires, in the shape every OAuth-ish vendor has: the durable fact is
 * the redeemable, and `refresh` mints the next bearer from it. The Firebase provider is this with
 * Google's two endpoints behind it; the fake keeps the wake test offline.
 */
class ExpiringProvider implements IdentityProvider {
  readonly strategy = "admin-mint" as const;
  refreshes = 0;

  constructor(
    private readonly first: Credential,
    private readonly next: Credential,
  ) {}

  provision(_ctx: ProvisionContext): Promise<ProvisionResult> {
    return Promise.resolve({ kind: "credential", credential: this.first });
  }

  refresh(_identity: Identity): Promise<Credential> {
    this.refreshes++;
    return Promise.resolve(this.next);
  }

  teardown(): Promise<void> {
    return Promise.resolve();
  }

  listByTag(): Promise<Identity[]> {
    return Promise.resolve([]);
  }
}

function makeConfig(): PopulaceConfig {
  return PopulaceConfigSchema.parse({
    target: { name: "Tasklet", mcp: [{ url: target.mcpUrl }], description: "A calm task list." },
    identity: { strategy: "admin-mint", provider: "firebase", emailDomain: "populace.test", apiKey: "web-key" },
    guardrails: { perWake: { maxTokens: 400_000, maxUsd: 3, maxTurns: 40 }, dailyUsd: 50 },
    population: {
      id: "test",
      cadence: { every: "1s" },
      members: [{ persona: { id: "casual", name: "Casual lister", role: "a hobbyist", backstory: "Has too many lists.", goals: ["keep a grocery list"] } }],
    },
  });
}

function firstAgent(config: PopulaceConfig, runId = newRunId()): Agent {
  const [expanded] = expandPopulation(config.population, runId, config.simulation.id);
  if (!expanded) throw new Error("no agent");
  return expanded.agent;
}

describe("a credential that expires", () => {
  /**
   * An identity is provisioned once and reused for every wake, so without this the population
   * works on Monday and spends every budget on 401s on Tuesday. The assertion is that the RENEWED
   * token is the one the target answered — checked against the target's own reply, not against the
   * store, because a refresh that never reached `McpSession` would still update the row.
   */
  it("is redeemed before the wake, and the new token is what reaches the target", async () => {
    const store = new SqliteStore(":memory:");
    const config = makeConfig();
    const agent = firstAgent(config);
    const account = await realAccount(`redeem-${Date.now()}@populace.test`);

    // What Firebase hands back: an ID token good for 3600 seconds and a refresh token that outlives it.
    const minted: Credential = {
      bearerToken: "id_token_minted_at_provision",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      redeemable: { kind: "refresh-token", secret: "refresh-token-one" },
      userId: "uid_1",
      email: account.email,
      extra: {},
    };
    const renewed: Credential = { ...minted, bearerToken: account.token, expiresAt: new Date(Date.now() + 7_400_000).toISOString(), redeemable: { kind: "refresh-token", secret: "refresh-token-two" } };
    const identityProvider = new ExpiringProvider(minted, renewed);

    // Wake 1 provisions; the token is still good, so nothing is redeemed.
    const provider = new ScriptedProvider(sequence([() => ({ calls: [call("get_product_info")] })]));
    const first = await runWake({ agent, config }, { store, provider, identityProvider });
    expect(first.identity?.credential.bearerToken).toBe(minted.bearerToken);
    expect(identityProvider.refreshes).toBe(0);

    // Wake 2 is an hour and a bit later — the same identity, now past its expiry.
    const later = new Date(Date.now() + 3_700_000);
    const second = await runWake(
      { agent: first.agent, config },
      { store, provider: new ScriptedProvider(sequence([() => ({ calls: [call("get_me")] })])), identityProvider, now: () => later },
    );

    expect(identityProvider.refreshes).toBe(1);
    expect(second.identity?.credential.bearerToken).toBe(account.token);
    expect((await store.getIdentity(second.identity!.id))?.credential.redeemable?.secret).toBe("refresh-token-two");

    const trace = await store.getTrace(second.wake.id);
    expect(ofType(trace, "identity").map((e) => e.event)).toContain("redeemed");
    // The target recognised the renewed token: `get_me` answers with this account, not an error.
    const me = ofType(trace, "tool.call").find((e) => e.tool === "get_me");
    expect(me?.result.isError).toBe(false);
    expect(me?.result.text).toContain(account.email);
    expect(second.wake.status).toBe("done");

    // A refresh token outlives the bearer it mints, so it must be nowhere in the evidence a digest
    // renders and a bug report carries.
    const written = JSON.stringify(trace);
    expect(written).not.toContain("refresh-token-one");
    expect(written).not.toContain("refresh-token-two");
  });

  /**
   * When the redemption itself fails there is no session to have, and grinding through forty turns
   * of refusals to discover that is the behaviour this replaces.
   */
  it("ends the wake as auth-failed when it cannot be redeemed", async () => {
    const store = new SqliteStore(":memory:");
    const config = makeConfig();
    const agent = firstAgent(config);
    const minted: Credential = {
      bearerToken: "id_token_minted_at_provision",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      redeemable: { kind: "refresh-token", secret: "refresh-token-one" },
      extra: {},
    };
    const identityProvider: IdentityProvider = {
      strategy: "admin-mint",
      provision: () => Promise.resolve({ kind: "credential", credential: minted }),
      refresh: () => Promise.reject(new Error("refreshing the ID token failed: HTTP 400 TOKEN_EXPIRED")),
      teardown: () => Promise.resolve(),
      listByTag: () => Promise.resolve([]),
    };
    const provider = new ScriptedProvider(sequence([() => ({ calls: [call("get_product_info")] })]));

    const first = await runWake({ agent, config }, { store, provider, identityProvider });
    expect(first.wake.status).toBe("done");
    const later = new Date(Date.now() + 3_700_000);
    const second = await runWake({ agent: first.agent, config }, { store, provider, identityProvider, now: () => later });

    expect(second.wake.status).toBe("auth-failed");
    expect(second.wake.summary).toMatch(/could not renew/i);
    // Nothing was spent: the wake stopped before its first model call.
    expect(second.wake.turns).toBe(0);
    expect(second.wake.costUsd).toBe(0);
  });
});

describe("a credential the target refuses", () => {
  /**
   * A 401 is a fact about the account, not a puzzle for the persona. Left as an ordinary tool
   * error the wake burns its whole budget being told no and then reports "ran out of turns",
   * which says nothing about the account being dead.
   */
  it("stops the wake as auth-failed instead of spending the budget on refusals", async () => {
    const store = new SqliteStore(":memory:");
    const config = makeConfig();
    const agent = firstAgent(config);
    const identityProvider: IdentityProvider = {
      strategy: "admin-mint",
      provision: () => Promise.resolve({ kind: "credential", credential: { bearerToken: "tk_not_a_real_token", expiresAt: null, redeemable: null, email: "nobody@populace.test", extra: {} } }),
      teardown: () => Promise.resolve(),
      listByTag: () => Promise.resolve([]),
    };
    // The persona keeps trying, the way a real one would; the runner is what stops it.
    const provider = new ScriptedProvider(() => ({ calls: [call("get_me")] }));

    const result = await runWake({ agent, config }, { store, provider, identityProvider });

    expect(result.wake.status).toBe("auth-failed");
    expect(result.wake.summary).toMatch(/rejected this account's credential/i);
    expect(result.wake.turns).toBe(3);
    expect(result.wake.turns).toBeLessThan(config.guardrails.perWake.maxTurns);

    const trace = await store.getTrace(result.wake.id);
    const rejected = ofType(trace, "identity").filter((e) => e.event === "rejected");
    expect(rejected).toHaveLength(3);
    expect(rejected[0]?.detail).toContain("get_me");
    expect(ofType(trace, "wake.end")[0]?.status).toBe("auth-failed");
  });
});

describe("a person with no bearer at all", () => {
  /**
   * `bearerToken` is optional on `Credential`, so "an identity exists but carries no token" is now
   * reachable. It must NOT reach `McpSession` as `undefined`: the session falls back to the
   * endpoint's own bearer, so the persona would drive the target with the OPERATOR's gateway
   * privileges — destructive tools included — while the trace said the account was provisioned.
   */
  it("ends the wake as auth-failed instead of borrowing the endpoint's token", async () => {
    const store = new SqliteStore(":memory:");
    const config = makeConfig();
    // The endpoint carries an operator token, which is the thing that must not be used on the
    // person's behalf.
    config.target.mcp[0]!.bearerToken = "operator-gateway-token";
    const agent = firstAgent(config);
    const identityProvider: IdentityProvider = {
      strategy: "admin-mint",
      provision: () => Promise.resolve({ kind: "credential", credential: { expiresAt: null, redeemable: null, email: "nobody@populace.test", extra: {} } }),
      teardown: () => Promise.resolve(),
      listByTag: () => Promise.resolve([]),
    };
    const provider = new ScriptedProvider(sequence([() => ({ calls: [call("get_me")] })]));

    const result = await runWake({ agent, config }, { store, provider, identityProvider });

    expect(result.wake.status).toBe("auth-failed");
    expect(result.wake.summary).toMatch(/no usable credential/i);
    // Nothing was spent and nothing was called: the wake stopped before it connected.
    expect(result.wake.turns).toBe(0);
    expect(result.wake.toolCalls).toBe(0);
    const trace = await store.getTrace(result.wake.id);
    expect(ofType(trace, "identity").map((e) => e.event)).toContain("rejected");
    expect(ofType(trace, "tool.call")).toHaveLength(0);
  });
});

describe("a target that refuses the bearer at the HTTP layer", () => {
  let refusing: Server;
  let url: string;

  beforeAll(async () => {
    // How a Firebase-authenticated MCP server behaves with a dead ID token: the `initialize` POST
    // is what fails, so no tool result ever exists to classify.
    refusing = createServer((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized: the ID token is expired" }));
    });
    await new Promise<void>((resolve) => refusing.listen(0, "127.0.0.1", resolve));
    const address = refusing.address();
    url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/mcp`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => refusing.close(() => resolve()));
  });

  /**
   * Left as a generic `error` this reads to the user as a bug in the harness — "errored" — rather
   * than as the one fact it is: this account's token is no longer accepted.
   */
  it("ends the wake as auth-failed, not as a connection error", async () => {
    const store = new SqliteStore(":memory:");
    const config = makeConfig();
    config.target.mcp[0]!.url = url;
    const agent = firstAgent(config);
    const identityProvider: IdentityProvider = {
      strategy: "admin-mint",
      provision: () => Promise.resolve({ kind: "credential", credential: { bearerToken: "id_token_revoked", expiresAt: null, redeemable: null, email: "nobody@populace.test", extra: {} } }),
      teardown: () => Promise.resolve(),
      listByTag: () => Promise.resolve([]),
    };
    const provider = new ScriptedProvider(sequence([() => ({ calls: [call("get_me")] })]));

    const result = await runWake({ agent, config }, { store, provider, identityProvider });

    expect(result.wake.status).toBe("auth-failed");
    expect(result.wake.summary).toMatch(/rejected this account's credential/i);
    const trace = await store.getTrace(result.wake.id);
    expect(ofType(trace, "identity").filter((e) => e.event === "rejected")).toHaveLength(1);
  });
});

describe("ordinary product errors that happen to read like a status code", () => {
  /**
   * The counter exists to stop a wake grinding on a dead account, and its cost when it fires wrongly
   * is not just a short wake: the user is told the token was rejected, and the persona never gets to
   * file the finding — a real defect is relabelled as a harness auth story and leaves the digest.
   * `task 403 not found` is the target's own not-found message with an id that looks like a status.
   */
  it("do not end the wake as auth-failed", async () => {
    const store = new SqliteStore(":memory:");
    const config = makeConfig();
    const agent = firstAgent(config);
    const account = await realAccount(`four-oh-three-${Date.now()}@populace.test`);
    const identityProvider: IdentityProvider = {
      strategy: "admin-mint",
      provision: () => Promise.resolve({ kind: "credential", credential: { bearerToken: account.token, expiresAt: null, redeemable: null, email: account.email, extra: {} } }),
      teardown: () => Promise.resolve(),
      listByTag: () => Promise.resolve([]),
    };
    const provider = new ScriptedProvider(
      sequence([
        () => ({ calls: [call("get_task", { taskId: "403" })] }),
        () => ({ calls: [call("get_task", { taskId: "403" })] }),
        () => ({ calls: [call("get_task", { taskId: "403" })] }),
        () => ({ calls: [call("get_task", { taskId: "403" })] }),
      ]),
    );

    const result = await runWake({ agent, config }, { store, provider, identityProvider });

    const trace = await store.getTrace(result.wake.id);
    const errors = ofType(trace, "tool.call").filter((e) => e.result.isError);
    // The premise: four refusing-looking errors really did come back, and they really do read "403".
    expect(errors.length).toBeGreaterThanOrEqual(4);
    expect(errors[0]?.result.text).toContain("403");
    expect(result.wake.status).toBe("done");
    expect(ofType(trace, "identity").filter((e) => e.event === "rejected")).toHaveLength(0);
  });
});

/**
 * The line between "your credential was not accepted" and "that did not work" decides whether a
 * wake stops and whether the user is told their account is dead. It is a text test, so it is worth
 * pinning on both sides: the numbers targets print in their own prose are not status codes.
 */
describe("looksLikeAuthRejection", () => {
  it.each([
    "error: unauthorized: bearer token is not valid",
    "Error POSTing to endpoint (HTTP 401): Unauthorized",
    "403 Forbidden",
    "Forbidden: this account cannot see that project",
    "the ID token has expired",
    "authentication required",
  ])("reads %s as a refusal", (text) => {
    expect(looksLikeAuthRejection(text)).toBe(true);
  });

  it.each(["error: not_found: task 403 not found", "project 401 not found", "dueDate must be YYYY-MM-DD", "the free plan allows 403 tasks", "title is required"])(
    "does not read %s as a refusal",
    (text) => {
      expect(looksLikeAuthRejection(text)).toBe(false);
    },
  );
});

import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { SignInStatusSchema, TargetCheckSchema, routes } from "@populace/contract";
import { normalizeEndpointUrl, type Store } from "@populace/core";
import { SqliteStore } from "@populace/store-sqlite";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { ensureProject, ensureSettings } from "./config-store.js";
import { EventHub, RecordingStore } from "./events.js";
import { JobRunner } from "./jobs.js";
import { RunController } from "./runs.js";

/**
 * Signing in to a target that will not talk to strangers (ADR-0036), end to end: a real HTTP
 * server that refuses anonymous callers the way an OAuth-protected MCP server does, and the whole
 * flow driven through the API the browser drives.
 *
 * The fixture is hand-written rather than an SDK server because what is under test is wire
 * behaviour — a `401` carrying `WWW-Authenticate`, RFC 9728 metadata, RFC 7591 registration, PKCE
 * at the token endpoint — and a fixture that got any of that from the same library as the client
 * would agree with it for the wrong reason.
 */

interface GatedTarget {
  origin: string;
  mcpUrl: string;
  /** How many times this installation registered itself. Pressing Check must not move it. */
  registrations: number;
  /** The last authorization request, so a test can act as the browser that received it. */
  authorize: URLSearchParams | null;
  /** Codes handed out at `/authorize`, against the PKCE challenge they were bound to. */
  codes: Map<string, string>;
  tokens: Set<string>;
  /** Refuse every access token, as a server does when a consent is revoked. */
  revokeAll(): void;
  close(): Promise<void>;
}

const CLIENT_ID = "client-for-populace";
const CLIENT_SECRET = "client-secret";

async function startGatedTarget(): Promise<GatedTarget> {
  const state: GatedTarget = {
    origin: "",
    mcpUrl: "",
    registrations: 0,
    authorize: null,
    codes: new Map(),
    tokens: new Set(),
    revokeAll: () => state.tokens.clear(),
    close: () =>
      new Promise<void>((done, failed) => {
        server.closeAllConnections();
        server.close((err) => (err ? failed(err) : done()));
      }),
  };

  const json = (res: ServerResponse, status: number, body: object, headers: Record<string, string> = {}): void => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };

  const body = async (req: IncomingMessage): Promise<string> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req as AsyncIterable<Buffer | string>) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    return Buffer.concat(chunks).toString("utf8");
  };

  const server: Server = createServer((req, res) => {
    void handle(req, res).catch((err: Error) => {
      if (!res.headersSent) json(res, 500, { error: err.message });
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", state.origin);

    if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      return json(res, 200, {
        resource: state.mcpUrl,
        authorization_servers: [`${state.origin}/`],
        scopes_supported: ["stays", "stays:self-write"],
        resource_name: "Fake Stays",
      });
    }

    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return json(res, 200, {
        issuer: `${state.origin}/`,
        authorization_endpoint: `${state.origin}/authorize`,
        token_endpoint: `${state.origin}/token`,
        registration_endpoint: `${state.origin}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_post"],
        scopes_supported: ["stays", "stays:self-write"],
      });
    }

    if (url.pathname === "/register" && req.method === "POST") {
      state.registrations += 1;
      return json(res, 201, { client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uris: [] });
    }

    if (url.pathname === "/token" && req.method === "POST") {
      const form = new URLSearchParams(await body(req));
      const code = form.get("code") ?? "";
      const challenge = state.codes.get(code);
      if (challenge === undefined) return json(res, 400, { error: "invalid_grant" });
      const verifier = form.get("code_verifier") ?? "";
      if (createHash("sha256").update(verifier).digest("base64url") !== challenge) return json(res, 400, { error: "invalid_grant" });
      if (form.get("client_id") !== CLIENT_ID) return json(res, 401, { error: "invalid_client" });
      state.codes.delete(code);
      const access = `access-${randomUUID()}`;
      state.tokens.add(access);
      return json(res, 200, { access_token: access, token_type: "Bearer", expires_in: 3600, refresh_token: `refresh-${randomUUID()}`, scope: "stays" });
    }

    if (url.pathname === "/mcp" && req.method === "POST") {
      const header = req.headers.authorization ?? "";
      const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
      if (!state.tokens.has(token)) {
        return json(
          res,
          401,
          { error: "Missing bearer token" },
          { "www-authenticate": `Bearer resource_metadata="${state.origin}/.well-known/oauth-protected-resource/mcp"` },
        );
      }
      const rpc = JSON.parse(await body(req)) as { id?: number; method?: string; params?: { protocolVersion?: string } };
      if (rpc.method === "initialize") {
        return json(res, 200, {
          jsonrpc: "2.0",
          id: rpc.id,
          result: {
            protocolVersion: rpc.params?.protocolVersion ?? "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "Fake Stays", version: "1.2.3" },
          },
        });
      }
      if (rpc.method === "tools/list") {
        return json(res, 200, {
          jsonrpc: "2.0",
          id: rpc.id,
          result: { tools: [{ name: "search_stays", description: "Search stays by city.", inputSchema: { type: "object", properties: {} } }] },
        });
      }
      // A notification (`notifications/initialized`) has no id and wants no body.
      res.writeHead(202);
      res.end();
      return;
    }

    json(res, 404, { error: "not found" });
  }

  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  state.origin = `http://127.0.0.1:${port}`;
  state.mcpUrl = `${state.origin}/mcp`;
  return state;
}

/** The user at the consent screen: takes the authorization URL, says yes, hands back the callback. */
function consent(authorizeUrl: string, target: GatedTarget): { code: string; state: string } {
  const params = new URL(authorizeUrl).searchParams;
  target.authorize = params;
  expect(params.get("code_challenge_method")).toBe("S256");
  expect(params.get("client_id")).toBe(CLIENT_ID);
  const code = `code-${randomUUID()}`;
  target.codes.set(code, params.get("code_challenge") ?? "");
  return { code, state: params.get("state") ?? "" };
}

/** Nothing in this file runs a simulation; the seams that would need one refuse out loud. */
const notInThisTest = (): never => {
  throw new Error("no config in this test");
};

interface Harness {
  app: Hono;
  store: Store;
  close: () => Promise<void>;
}

async function harness(): Promise<Harness> {
  const inner = new SqliteStore(":memory:");
  const hub = new EventHub();
  const store: Store = new RecordingStore(inner, hub.publish);
  await ensureProject(store);
  await ensureSettings(store);
  const processConfig = { store: { kind: "sqlite" as const, path: ":memory:" }, digestDir: "digests" };
  const app = createApp({
    store,
    storePath: ":memory:",
    version: "test",
    control: {
      store,
      processConfig,
      hasApiKey: () => false,
      jobs: new JobRunner(store),
      runs: new RunController({ store, provider: () => { throw new Error("no model in this test"); }, resolve: notInThisTest }),
      hub,
      configForRun: notInThisTest,
      sweep: () => Promise.resolve({ identities: 0, removed: 0, preExisting: 0, stranded: 0, failures: 0, lines: [] }),
    },
  });
  return {
    app,
    store,
    close: () => inner.close(),
  };
}

const P = "default";

const post = async (app: Hono, path: string, body: object = {}): Promise<Response> =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// eslint-disable-next-line no-restricted-syntax -- HTTP boundary: every caller parses with a contract schema.
type ResponseBody = unknown;

const json = async (res: Response): Promise<ResponseBody> => {
  expect(res.status, await res.clone().text()).toBeLessThan(400);
  return res.json();
};

let target: GatedTarget;
let h: Harness;
beforeEach(async () => {
  target = await startGatedTarget();
  h = await harness();
});
afterEach(async () => {
  await h.close();
  await target.close();
});

describe("signing in to an address that will not talk to strangers", () => {
  it("tells a gated address apart from a dead one, and registers nothing doing it", async () => {
    const gated = TargetCheckSchema.parse(await json(await post(h.app, routes.targetsCheck(P), { mcp: [{ name: "default", url: target.mcpUrl }] })));
    expect(gated.ok).toBe(false);
    expect(gated.signIn?.required).toBe(true);
    expect(gated.signIn?.supported).toBe(true);
    // The resource's own words, which is what the screen puts in the sentence.
    expect(gated.signIn?.resourceName).toBe("Fake Stays");
    expect(gated.signIn?.scopes).toContain("stays");
    expect(gated.signIn?.connected).toBe(false);
    // Pressing Check is a read. Registering this installation with somebody else's authorization
    // server is not, and it stays behind the button.
    expect(target.registrations).toBe(0);

    const dead = TargetCheckSchema.parse(await json(await post(h.app, routes.targetsCheck(P), { mcp: [{ name: "default", url: "http://127.0.0.1:1/mcp" }] })));
    expect(dead.ok).toBe(false);
    // Nothing answered at all, so there is no sign-in to offer and the screen says the other thing.
    expect(dead.signIn).toBeNull();
  });

  it("carries a browser through the whole flow, and then the check passes", async () => {
    const started = await json(await post(h.app, routes.signIn(P), { url: target.mcpUrl }));
    const authorizeUrl = (started as { authorizeUrl: string }).authorizeUrl;
    expect(authorizeUrl).toContain("/authorize");
    expect(target.registrations).toBe(1);

    const back = consent(authorizeUrl, target);
    const landed = await h.app.request(`${routes.signInCallback}?code=${back.code}&state=${back.state}`);
    expect(landed.status).toBe(200);
    expect(await landed.text()).toContain("Signed in");

    const status = SignInStatusSchema.parse(await json(await h.app.request(`${routes.signIn(P)}?url=${encodeURIComponent(target.mcpUrl)}`)));
    expect(status.connected).toBe(true);
    // A sign-in that can be renewed is the difference between one that lasts and one that dies in
    // an hour, and the screen says which this is.
    expect(status.renewable).toBe(true);
    expect(status.expiresAt).not.toBeNull();

    const check = TargetCheckSchema.parse(await json(await post(h.app, routes.targetsCheck(P), { mcp: [{ name: "default", url: target.mcpUrl }] })));
    expect(check.ok).toBe(true);
    expect(check.server?.name).toBe("Fake Stays");
    expect(check.tools.map((t) => t.name)).toEqual(["search_stays"]);
    expect(check.signIn).toBeNull();
  });

  it("never hands the token back, and forgetting the sign-in closes the door again", async () => {
    const started = await json(await post(h.app, routes.signIn(P), { url: target.mcpUrl }));
    const back = consent((started as { authorizeUrl: string }).authorizeUrl, target);
    await h.app.request(`${routes.signInCallback}?code=${back.code}&state=${back.state}`);

    // A credential goes up and never comes back down: the row holds one, the wire says so and no
    // more. This asserts on the raw body rather than the parsed view, because a schema that is
    // itself wrong would parse a leak quite happily.
    const raw = await (await h.app.request(`${routes.signIn(P)}?url=${encodeURIComponent(target.mcpUrl)}`)).text();
    const grant = await h.store.getSignInGrant("default", target.mcpUrl);
    expect(grant?.tokens?.accessToken).toBeTruthy();
    expect(raw).not.toContain(grant?.tokens?.accessToken ?? "impossible");
    expect(raw).not.toContain(grant?.tokens?.refreshToken ?? "impossible");

    const forgotten = SignInStatusSchema.parse(await json(await h.app.request(`${routes.signIn(P)}?url=${encodeURIComponent(target.mcpUrl)}`, { method: "DELETE" })));
    expect(forgotten.connected).toBe(false);
    expect(await h.store.getSignInGrant("default", target.mcpUrl)).toBeUndefined();

    const check = TargetCheckSchema.parse(await json(await post(h.app, routes.targetsCheck(P), { mcp: [{ name: "default", url: target.mcpUrl }] })));
    expect(check.ok).toBe(false);
    expect(check.signIn?.required).toBe(true);
  });

  it("refuses a callback whose state matches no flow in flight", async () => {
    const landed = await h.app.request(`${routes.signInCallback}?code=anything&state=not-a-flow`);
    expect(landed.status).toBe(400);
    expect(await landed.text()).toContain("not one this populace started");
  });

  it("keys a sign-in by address, so the same server under two targets is one sign-in", async () => {
    const started = await json(await post(h.app, routes.signIn(P), { url: target.mcpUrl }));
    const back = consent((started as { authorizeUrl: string }).authorizeUrl, target);
    await h.app.request(`${routes.signInCallback}?code=${back.code}&state=${back.state}`);

    // The same address, spelled with the port written out. One server, one sign-in, one row.
    const spelled = normalizeEndpointUrl(target.mcpUrl);
    expect(await h.store.getSignInGrant("default", spelled)).toBeDefined();
    expect(await h.store.listSignInGrants("default")).toHaveLength(1);
  });

  it("signs in again from nothing when the authorization server has forgotten the client", async () => {
    const first = await json(await post(h.app, routes.signIn(P), { url: target.mcpUrl }));
    const back = consent((first as { authorizeUrl: string }).authorizeUrl, target);
    await h.app.request(`${routes.signInCallback}?code=${back.code}&state=${back.state}`);
    expect(target.registrations).toBe(1);

    // The consent is revoked at the server. What populace holds is now a token nothing accepts.
    target.revokeAll();
    const check = TargetCheckSchema.parse(await json(await post(h.app, routes.targetsCheck(P), { mcp: [{ name: "default", url: target.mcpUrl }] })));
    expect(check.ok).toBe(false);
    // And the screen offers the way back in rather than a transport error nobody can act on.
    expect(check.signIn?.required).toBe(true);
  });
});

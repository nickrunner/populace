import { describe, expect, it } from "vitest";
import { ErrorBodySchema, TdkError } from "../errors.js";
import { HandshakeSchema, TDK_CONTRACT_VERSION } from "../handshake.js";
import type { TdkHandler, TdkRequest, TdkResponse } from "../http.js";
import type { JsonValue } from "../json.js";
import { PeopleListSchema, ProvisionedPersonSchema, RefreshResponseSchema, type CreatedPerson, type ProvisioningBackend } from "./contract.js";
import { createProvisioningHandler, type ProvisioningOptions } from "./handler.js";

/**
 * The wire contract, driven straight against the core handler.
 *
 * No port is bound and no network is touched: the auth vendor is a Map, and every assertion is
 * about what the vendor holds afterwards or what the response schema says, rather than about the
 * text of a message that will be reworded the first time a user misreads it.
 */

const SECRET = "a-dev-scoped-secret-32-characters";

interface FakeAccount {
  userId: string;
  email: string;
  displayName: string;
  tag: string;
}

/** A tiny auth vendor: accounts, bearers that expire, and refresh tokens that mint new ones. */
class FakeVendor {
  readonly accounts = new Map<string, FakeAccount>();
  readonly bearers = new Map<string, string>();
  readonly refreshTokens = new Map<string, string>();
  /** How many accounts were asked to be deleted, including ones that were already gone. */
  deleteCalls = 0;
  private next = 0;

  create(person: { email: string; displayName: string; tag: string }): { userId: string; bearerToken: string; refreshToken: string } {
    const userId = `uid-${++this.next}`;
    this.accounts.set(userId, { userId, ...person });
    return { userId, ...this.mint(userId) };
  }

  /** JWT-shaped, because that is what the vendors hand out and what a leak would look like. */
  mint(userId: string): { bearerToken: string; refreshToken: string } {
    const bearerToken = `eyJmaW5l.${Buffer.from(`${userId}:${++this.next}`).toString("base64url")}.signature-${this.next}`;
    const refreshToken = `refresh-${userId}-${this.next}`;
    this.bearers.set(bearerToken, userId);
    this.refreshTokens.set(refreshToken, userId);
    return { bearerToken, refreshToken };
  }

  remove(userId: string): void {
    this.deleteCalls += 1;
    this.accounts.delete(userId);
  }
}

/** The whole ladder's third rung: an app that implements all four hooks itself. */
function backendFor(vendor: FakeVendor): ProvisioningBackend {
  return {
    createPerson: (person) => {
      const created = vendor.create({ email: person.email, displayName: person.displayName, tag: person.tag });
      return { ...created, expiresAt: new Date(Date.now() + 3_600_000) };
    },
    removePerson: ({ userId }) => vendor.remove(userId),
    refreshPerson: ({ userId, refreshToken }) => {
      // Both paths a vendor can offer: redeem what populace held, or re-mint from the user id.
      const owner = refreshToken === null ? userId : (vendor.refreshTokens.get(refreshToken) ?? userId);
      return { ...vendor.mint(owner), expiresAt: new Date(Date.now() + 3_600_000) };
    },
    listPeople: ({ tag }) => [...vendor.accounts.values()].filter((account) => account.tag === tag),
  };
}

function handlerFor(options: Partial<ProvisioningOptions> & { backend: ProvisioningBackend }): TdkHandler {
  return createProvisioningHandler({ secret: SECRET, log: () => {}, ...options });
}

function request(method: string, path: string, extra: Partial<TdkRequest> & { secret?: string | null } = {}): TdkRequest {
  const secret = extra.secret === undefined ? SECRET : extra.secret;
  return {
    method,
    path,
    query: extra.query ?? {},
    headers: secret === null ? {} : { authorization: `Bearer ${secret}` },
    ...(extra.body === undefined ? {} : { body: extra.body }),
  };
}

const PERSON = { tag: "run-abc123", handle: "marta-2", email: "marta-2+run-abc123@populace.test", displayName: "Marta", password: "correct-horse-battery" };

async function provision(handle: TdkHandler, overrides: Partial<typeof PERSON> = {}): Promise<TdkResponse> {
  return await handle(request("POST", "/people", { body: { ...PERSON, ...overrides } }));
}

function remove(userId: string): TdkRequest {
  return request("POST", "/people/remove", { body: { userId } });
}

function errorOf(response: TdkResponse): { code: string; message: string } {
  return ErrorBodySchema.parse(response.body).error;
}

describe("the handshake", () => {
  it("names the contract version and answers honestly about what the app can do", async () => {
    const vendor = new FakeVendor();
    const full = handlerFor({ backend: backendFor(vendor) });
    const body = HandshakeSchema.parse((await full(request("GET", "/"))).body);

    expect(body.tdk).toBe(TDK_CONTRACT_VERSION);
    expect(body.capabilities).toEqual({ refresh: true, teardown: true, listByTag: true });
  });

  it("reports a capability the app did not implement as false", async () => {
    const vendor = new FakeVendor();
    const { createPerson } = backendFor(vendor);
    const bare = handlerFor({ backend: { createPerson } });
    const body = HandshakeSchema.parse((await bare(request("GET", "/"))).body);

    expect(body.capabilities).toEqual({ refresh: false, teardown: false, listByTag: false });
  });

  it("lets an app that soft-deletes turn teardown off without removing the hook", async () => {
    const vendor = new FakeVendor();
    const soft = handlerFor({ backend: backendFor(vendor), capabilities: { teardown: false } });
    const body = HandshakeSchema.parse((await soft(request("GET", "/"))).body);

    expect(body.capabilities.teardown).toBe(false);
    // The declaration can only subtract: what it cannot do is claim a hook that is not there.
    const lying = handlerFor({ backend: { createPerson: backendFor(vendor).createPerson }, capabilities: { teardown: true, refresh: true, listByTag: true } });
    expect(HandshakeSchema.parse((await lying(request("GET", "/"))).body).capabilities).toEqual({ refresh: false, teardown: false, listByTag: false });
  });
});

describe("the secret", () => {
  it("is required on every route, including the handshake", async () => {
    const handle = handlerFor({ backend: backendFor(new FakeVendor()) });
    for (const missing of [null, "not-the-secret", `${SECRET}x`, SECRET.slice(0, -1)]) {
      const response = await handle(request("GET", "/", { secret: missing }));
      expect(response.status).toBe(401);
      expect(errorOf(response).code).toBe("unauthorized");
    }
    expect((await handle(request("GET", "/"))).status).toBe(200);
  });

  it("refuses to mount at all without one, rather than mounting an open door", () => {
    const backend = backendFor(new FakeVendor());
    expect(() => createProvisioningHandler({ secret: "", log: () => {}, backend })).toThrow(/secret/i);
  });

  it("refuses to mount without a createPerson", () => {
    expect(() => createProvisioningHandler({ secret: SECRET, log: () => {}, backend: {} as ProvisioningBackend })).toThrow(/createPerson/);
  });
});

describe("provisioning a person", () => {
  it("creates the account and hands back a usable session", async () => {
    const vendor = new FakeVendor();
    const handle = handlerFor({ backend: backendFor(vendor) });
    const response = await provision(handle);

    expect(response.status).toBe(201);
    const person = ProvisionedPersonSchema.parse(response.body);
    expect(vendor.accounts.get(person.userId)?.email).toBe(PERSON.email);
    expect(vendor.bearers.get(person.bearerToken)).toBe(person.userId);
    expect(person.expiresAt).not.toBeNull();
  });

  it("round-trips the tag, which is the only way a sweep finds the run again", async () => {
    const vendor = new FakeVendor();
    const handle = handlerFor({ backend: backendFor(vendor) });
    await provision(handle);
    await provision(handle, { handle: "marta-3", email: "marta-3+run-abc123@populace.test" });
    await provision(handle, { tag: "run-other", handle: "sam-1", email: "sam-1+run-other@populace.test" });

    const listed = PeopleListSchema.parse((await handle(request("GET", "/people", { query: { tag: "run-abc123" } }))).body);
    expect(listed.people.map((p) => p.email)).toEqual(["marta-2+run-abc123@populace.test", "marta-3+run-abc123@populace.test"]);
    expect(listed.people.every((p) => p.tag === "run-abc123")).toBe(true);
  });

  it("makes one for a product that has no passwords at all", async () => {
    const vendor = new FakeVendor();
    const seen: (string | undefined)[] = [];
    const passwordless: ProvisioningBackend = {
      createPerson: (person) => {
        seen.push(person.password);
        return { ...vendor.create({ email: person.email, displayName: person.displayName, tag: person.tag }), expiresAt: null };
      },
    };
    const handle = handlerFor({ backend: passwordless });
    const { password: _password, ...withoutPassword } = PERSON;

    const response = await handle(request("POST", "/people", { body: withoutPassword }));
    expect(response.status).toBe(201);
    expect(seen).toEqual([undefined]);
  });

  it("refuses a request it cannot understand instead of making half a person", async () => {
    const vendor = new FakeVendor();
    const handle = handlerFor({ backend: backendFor(vendor) });
    const response = await handle(request("POST", "/people", { body: { handle: "marta-2" } }));

    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe("bad_request");
    expect(vendor.accounts.size).toBe(0);
  });

  it("names the hook when an app hands back a shape the kit cannot use", async () => {
    // An app that wrote `uid` where the kit wanted `userId` — which JavaScript is perfectly happy
    // to do, and which would otherwise reach the target as `Bearer undefined`.
    const misspelled: ProvisioningBackend = { createPerson: () => JSON.parse('{"uid":"u1","token":"t"}') as CreatedPerson };
    const handle = handlerFor({ backend: misspelled });
    const response = await provision(handle);

    expect(response.status).toBe(500);
    expect(errorOf(response).message).toContain("createPerson");
  });
});

describe("listing a run", () => {
  it("pages, and the cursor says where the next page starts", async () => {
    const vendor = new FakeVendor();
    const crowded: ProvisioningBackend = {
      ...backendFor(vendor),
      listPeople: ({ tag }) => Array.from({ length: 250 }, (_, i) => ({ userId: `uid-${i}`, email: `person-${i}@populace.test`, displayName: `Person ${i}`, tag })),
    };
    const handle = handlerFor({ backend: crowded });

    const seen: string[] = [];
    let cursor: string | null = null;
    let requests = 0;
    do {
      const query: Record<string, string> = { tag: "run-abc123", ...(cursor === null ? {} : { cursor }) };
      const listed = PeopleListSchema.parse((await handle(request("GET", "/people", { query }))).body);
      requests += 1;
      seen.push(...listed.people.map((person) => person.userId));
      cursor = listed.nextCursor;
    } while (cursor !== null && requests < 10);

    expect(seen).toHaveLength(250);
    expect(new Set(seen).size).toBe(250);
    expect(requests).toBe(3);
  });

  it("ends the walk rather than looping when everything fits in one page", async () => {
    const vendor = new FakeVendor();
    const handle = handlerFor({ backend: backendFor(vendor) });
    await provision(handle);

    const listed = PeopleListSchema.parse((await handle(request("GET", "/people", { query: { tag: "run-abc123" } }))).body);
    expect(listed.people).toHaveLength(1);
    expect(listed.nextCursor).toBeNull();
  });
});

describe("a populace newer than the kit", () => {
  it("is told to upgrade the package, rather than shown a schema error", async () => {
    const handle = handlerFor({ backend: backendFor(new FakeVendor()) });
    const attempt = request("POST", "/people", { body: PERSON });
    attempt.headers["x-populace-tdk-expects"] = "2";

    const response = await handle(attempt);
    expect(response.status).toBe(400);
    expect(errorOf(response).message).toMatch(/@populace\/tdk/);
  });

  it("can still read the handshake, which is how the disagreement is diagnosed", async () => {
    const handle = handlerFor({ backend: backendFor(new FakeVendor()) });
    const hello = request("GET", "/");
    hello.headers["x-populace-tdk-expects"] = "7";

    expect(HandshakeSchema.parse((await handle(hello)).body).tdk).toBe(TDK_CONTRACT_VERSION);
  });

  it("is not what a missing or unreadable header means", async () => {
    const vendor = new FakeVendor();
    const handle = handlerFor({ backend: backendFor(vendor) });

    const sameVersion = request("POST", "/people", { body: PERSON });
    sameVersion.headers["x-populace-tdk-expects"] = String(TDK_CONTRACT_VERSION);
    expect((await handle(sameVersion)).status).toBe(201);

    // A proxy that mangled the header is not a reason to stop making accounts.
    const mangled = request("POST", "/people", { body: { ...PERSON, handle: "marta-4", email: "marta-4+run-abc123@populace.test" } });
    mangled.headers["x-populace-tdk-expects"] = "banana";
    expect((await handle(mangled)).status).toBe(201);
  });
});

describe("renewing a session", () => {
  it("redeems the refresh token populace held", async () => {
    const vendor = new FakeVendor();
    const handle = handlerFor({ backend: backendFor(vendor) });
    const first = ProvisionedPersonSchema.parse((await provision(handle)).body);

    const renewed = RefreshResponseSchema.parse((await handle(request("POST", "/people/refresh", { body: { userId: first.userId, refreshToken: first.refreshToken } }))).body);
    expect(renewed.bearerToken).not.toBe(first.bearerToken);
    expect(vendor.bearers.get(renewed.bearerToken)).toBe(first.userId);
  });

  it("re-mints from the user id alone when there is no refresh token", async () => {
    const vendor = new FakeVendor();
    const handle = handlerFor({ backend: backendFor(vendor) });
    const first = ProvisionedPersonSchema.parse((await provision(handle)).body);

    const renewed = RefreshResponseSchema.parse((await handle(request("POST", "/people/refresh", { body: { userId: first.userId, refreshToken: null } }))).body);
    expect(vendor.bearers.get(renewed.bearerToken)).toBe(first.userId);
    // A missing field means the same thing as an explicit null: populace has nothing to redeem.
    const again = await handle(request("POST", "/people/refresh", { body: { userId: first.userId } }));
    expect(again.status).toBe(200);
  });
});

describe("teardown", () => {
  it("is idempotent: the second sweep of the same run succeeds as loudly as the first", async () => {
    const vendor = new FakeVendor();
    const handle = handlerFor({ backend: backendFor(vendor) });
    const person = ProvisionedPersonSchema.parse((await provision(handle)).body);

    expect((await handle(remove(person.userId))).status).toBe(204);
    expect((await handle(remove(person.userId))).status).toBe(204);
    expect((await handle(remove("uid-never-existed"))).status).toBe(204);
    expect(vendor.accounts.size).toBe(0);
    expect(vendor.deleteCalls).toBe(3);
  });

  it("takes the id in the body, because an id is the app's and need not survive a path", async () => {
    const vendor = new FakeVendor();
    const handle = handlerFor({ backend: backendFor(vendor) });
    // What a product that keys users by email hands out, and what a path would have mangled.
    vendor.accounts.set("marta@example.com/2", { userId: "marta@example.com/2", email: "m@e.test", displayName: "Marta", tag: "run-abc123" });

    expect((await handle(remove("marta@example.com/2"))).status).toBe(204);
    expect(vendor.accounts.size).toBe(0);
  });

  it("asks for the id when the body does not carry one", async () => {
    const handle = handlerFor({ backend: backendFor(new FakeVendor()) });
    const response = await handle(request("POST", "/people/remove", { body: {} }));
    expect(response.status).toBe(400);
    expect(errorOf(response).message).toContain("userId");
  });

  it("reads an app's `gone` as the outcome it wanted, so a vendor that throws stays idempotent", async () => {
    const vendor = new FakeVendor();
    const strict: ProvisioningBackend = {
      ...backendFor(vendor),
      removePerson: ({ userId }) => {
        // The shape of a vendor that refuses to delete what is not there.
        if (!vendor.accounts.has(userId)) throw new TdkError("gone", "There is no such user.");
        vendor.remove(userId);
      },
    };
    const handle = handlerFor({ backend: strict });
    const person = ProvisionedPersonSchema.parse((await provision(handle)).body);

    expect((await handle(remove(person.userId))).status).toBe(204);
    expect((await handle(remove(person.userId))).status).toBe(204);
  });
});

describe("a person who is not there any more", () => {
  it("is reported as gone, so populace provisions a replacement instead of retrying", async () => {
    const vendor = new FakeVendor();
    const forgetful: ProvisioningBackend = {
      ...backendFor(vendor),
      refreshPerson: ({ userId }) => {
        throw new TdkError("gone", `There is no account for ${userId} any more.`);
      },
    };
    const handle = handlerFor({ backend: forgetful });

    const response = await handle(request("POST", "/people/refresh", { body: { userId: "uid-1", refreshToken: null } }));
    expect(response.status).toBe(404);
    expect(errorOf(response).code).toBe("gone");
  });
});

describe("a capability the app does not have", () => {
  it("is refused as unsupported rather than crashing", async () => {
    const vendor = new FakeVendor();
    const { createPerson } = backendFor(vendor);
    const bare = handlerFor({ backend: { createPerson } });

    for (const attempt of [request("POST", "/people/refresh", { body: { userId: "uid-1", refreshToken: null } }), remove("uid-1"), request("GET", "/people", { query: { tag: "run-abc123" } })]) {
      const response = await bare(attempt);
      expect(response.status).toBe(501);
      expect(errorOf(response).code).toBe("unsupported");
    }
  });

  it("is refused when the app declared it off, even though the hook exists", async () => {
    const vendor = new FakeVendor();
    const soft = handlerFor({ backend: backendFor(vendor), capabilities: { teardown: false } });
    const person = ProvisionedPersonSchema.parse((await provision(soft)).body);

    const response = await soft(remove(person.userId));
    expect(errorOf(response).code).toBe("unsupported");
    expect(vendor.deleteCalls).toBe(0);
    expect(vendor.accounts.size).toBe(1);
  });
});

describe("the production guard", () => {
  it("refuses every route, so nothing can make a test account on a real deployment", async () => {
    const vendor = new FakeVendor();
    const handle = handlerFor({ backend: backendFor(vendor), environment: "production" });

    for (const attempt of [request("GET", "/"), request("POST", "/people", { body: PERSON })]) {
      const response = await handle(attempt);
      expect(response.status).toBe(403);
      expect(errorOf(response).code).toBe("refused");
    }
    expect(vendor.accounts.size).toBe(0);
  });

  it("follows NODE_ENV when the app says nothing", async () => {
    const before = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const guarded = handlerFor({ backend: backendFor(new FakeVendor()) });
      expect((await guarded(request("GET", "/"))).status).toBe(403);

      const allowed = handlerFor({ backend: backendFor(new FakeVendor()), allowProduction: true });
      expect((await allowed(request("GET", "/"))).status).toBe(200);
    } finally {
      process.env.NODE_ENV = before;
    }
  });

  it("says what it has done, in both directions, at mount time", () => {
    const said: string[] = [];
    handlerFor({ backend: backendFor(new FakeVendor()), environment: "production", log: (message) => said.push(message) });
    expect(said.join(" ")).toMatch(/REFUSE/);

    const allowed: string[] = [];
    handlerFor({ backend: backendFor(new FakeVendor()), environment: "production", allowProduction: true, log: (message) => allowed.push(message) });
    expect(allowed.join(" ")).toMatch(/allowProduction/);
  });
});

describe("what a message may contain", () => {
  it("never carries the secret or a bearer token out to a reader", async () => {
    const vendor = new FakeVendor();
    const backend = backendFor(vendor);
    const leaked = vendor.mint("uid-leaky").bearerToken;
    const chatty: ProvisioningBackend = {
      ...backend,
      createPerson: () => {
        // The shape of a vendor SDK that helpfully quotes the request it just made.
        throw new Error(`POST /admin/users failed (authorization: Bearer ${SECRET}, minted ${leaked})`);
      },
    };
    const handle = handlerFor({ backend: chatty });

    const message = errorOf(await provision(handle)).message;
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain(leaked);
    expect(message).toContain("[redacted]");
  });

  it("never carries them on any of the ordinary refusals either", async () => {
    const handle = handlerFor({ backend: backendFor(new FakeVendor()) });
    const attempts: TdkRequest[] = [
      request("GET", "/", { secret: `${SECRET}-guessed` }),
      request("POST", "/people", { body: {} }),
      request("GET", "/people"),
      request("POST", "/people/remove", { body: {} }),
      request("PATCH", "/people/uid-1"),
      request("GET", "/nowhere"),
    ];
    for (const attempt of attempts) {
      const body: JsonValue | undefined = (await handle(attempt)).body;
      expect(JSON.stringify(body)).not.toContain(SECRET);
    }
  });
});

import { describe, expect, it } from "vitest";
import { ErrorBodySchema } from "../errors.js";
import type { JsonValue } from "../json.js";
import { CreatedPersonSchema, RefreshedPersonSchema, type PersonRequest } from "./contract.js";
import { firebase, type FetchLike, type FirebaseAuthLike } from "./firebase.js";
import { createProvisioningHandler } from "./handler.js";

/**
 * Rung one of the ladder, offline.
 *
 * The Firebase Admin SDK and Google's two token endpoints are both fakes, because what is under
 * test is the thing the preset exists to get right: a Firebase CUSTOM token is not an ID token,
 * and a preset that handed one over would provision happily and then fail every call the
 * population made. The fake therefore keeps the two kinds of token apart and the assertions are
 * about which one came back.
 */

/** What firebase-admin throws: a stable `code`, and prose that says nothing useful on its own. */
class VendorError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface FakeUser {
  uid: string;
  email: string;
  displayName: string;
  password: string;
  customClaims?: Record<string, string>;
}

class FakeFirebase implements FirebaseAuthLike {
  readonly users = new Map<string, FakeUser>();
  /** Every custom token this fake has issued, and the uid it was issued for. */
  readonly customTokens = new Map<string, string>();
  deleteCalls = 0;
  private next = 0;

  async createUser(properties: { email: string; password: string; displayName: string; emailVerified: boolean }): Promise<{ uid: string }> {
    if ([...this.users.values()].some((user) => user.email === properties.email)) throw new VendorError("auth/email-already-exists", "Identity Toolkit rejected the request.");
    const uid = `uid-${++this.next}`;
    this.users.set(uid, { uid, email: properties.email, displayName: properties.displayName, password: properties.password });
    return { uid };
  }

  async setCustomUserClaims(uid: string, claims: Record<string, string>): Promise<void> {
    const user = this.users.get(uid);
    if (user === undefined) throw new VendorError("auth/user-not-found", "Identity Toolkit rejected the request.");
    user.customClaims = claims;
  }

  async createCustomToken(uid: string, claims?: Record<string, string>): Promise<string> {
    const token = `custom-token-${uid}-${++this.next}-${claims?.populaceTag ?? ""}`;
    this.customTokens.set(token, uid);
    return token;
  }

  async getUser(uid: string): Promise<FakeUser> {
    const user = this.users.get(uid);
    if (user === undefined) throw new VendorError("auth/user-not-found", "Identity Toolkit rejected the request.");
    return user;
  }

  /** Paged two at a time, because the real one pages and a preset that ignored that would lose accounts. */
  async listUsers(_maxResults?: number, pageToken?: string): Promise<{ users: FakeUser[]; pageToken?: string }> {
    const all = [...this.users.values()];
    const from = pageToken === undefined ? 0 : Number(pageToken);
    const page = all.slice(from, from + 2);
    const next = from + page.length;
    return next < all.length ? { users: page, pageToken: String(next) } : { users: page };
  }

  async deleteUser(uid: string): Promise<void> {
    this.deleteCalls += 1;
    if (!this.users.delete(uid)) throw new VendorError("auth/user-not-found", "Identity Toolkit rejected the request.");
  }
}

interface Google {
  fetch: FetchLike;
  /** Custom tokens presented at the exchange, in order. */
  exchanged: string[];
  /** Refresh tokens presented at the renewal, in order. */
  renewed: string[];
  /** Refuse the next renewal the way Google refuses a revoked refresh token. */
  refuseRenewal: boolean;
  sessions: Map<string, string>;
}

function google(admin: FakeFirebase): Google {
  let issued = 0;
  const state: Google = {
    exchanged: [],
    renewed: [],
    refuseRenewal: false,
    sessions: new Map(),
    fetch: async (url, init) => {
      const ok = (body: JsonValue) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
      const refused = (body: JsonValue) => ({ ok: false, status: 400, json: async () => body, text: async () => JSON.stringify(body) });

      if (url.startsWith("https://identitytoolkit.googleapis.com")) {
        const body = JSON.parse(init.body) as { token: string };
        state.exchanged.push(body.token);
        const uid = admin.customTokens.get(body.token);
        if (uid === undefined) return refused({ error: { message: "INVALID_CUSTOM_TOKEN" } });
        const idToken = `eyJhbGci.${Buffer.from(`${uid}:${++issued}`).toString("base64url")}.signed`;
        const refreshToken = `google-refresh-${uid}-${issued}`;
        state.sessions.set(refreshToken, uid);
        return ok({ idToken, refreshToken, expiresIn: "3600" });
      }

      const form = new URLSearchParams(init.body);
      const presented = form.get("refresh_token") ?? "";
      state.renewed.push(presented);
      const uid = state.sessions.get(presented);
      if (state.refuseRenewal || uid === undefined) return refused({ error: { message: "TOKEN_EXPIRED" } });
      const idToken = `eyJhbGci.${Buffer.from(`${uid}:${++issued}`).toString("base64url")}.signed`;
      return ok({ id_token: idToken, refresh_token: presented, expires_in: "3600" });
    },
  };
  return state;
}

const PERSON: PersonRequest = { tag: "run-abc123", handle: "marta-2", email: "marta-2+run-abc123@populace.test", displayName: "Marta", password: "correct-horse-battery" };

function preset(admin: FakeFirebase, endpoints: Google, extra: Partial<Parameters<typeof firebase>[0]> = {}) {
  return firebase({ apiKey: "web-api-key", auth: admin, fetch: endpoints.fetch, ...extra });
}

describe("the Firebase preset", () => {
  it("hands back the ID token, never the custom token that would fail every call", async () => {
    const admin = new FakeFirebase();
    const endpoints = google(admin);
    const created = CreatedPersonSchema.parse(await preset(admin, endpoints).createPerson(PERSON));

    expect(endpoints.exchanged).toHaveLength(1);
    expect(admin.customTokens.has(created.bearerToken)).toBe(false);
    expect(admin.customTokens.get(endpoints.exchanged[0] ?? "")).toBe(created.userId);
    expect(created.expiresAt).not.toBeNull();
    expect(created.refreshToken).not.toBeNull();
  });

  it("stores the run tag where a sweep can read it back", async () => {
    const admin = new FakeFirebase();
    const endpoints = google(admin);
    const backend = preset(admin, endpoints);
    await backend.createPerson(PERSON);
    await backend.createPerson({ ...PERSON, handle: "marta-3", email: "marta-3+run-abc123@populace.test" });
    await backend.createPerson({ ...PERSON, tag: "run-other", handle: "sam-1", email: "sam-1+run-other@populace.test" });

    const found = await backend.listPeople?.({ tag: "run-abc123" });
    expect(found?.map((person) => person.email)).toEqual(["marta-2+run-abc123@populace.test", "marta-3+run-abc123@populace.test"]);
  });

  it("runs the app's own afterCreate before populace is told the person exists", async () => {
    const admin = new FakeFirebase();
    const endpoints = google(admin);
    const written: string[] = [];
    const backend = preset(admin, endpoints, {
      afterCreate: (person) => {
        // The app-side row: by the time populace holds a bearer, this has to be there already.
        expect(endpoints.exchanged).toHaveLength(0);
        written.push(`${person.userId}:${person.tag}:${person.handle}`);
      },
    });

    const created = CreatedPersonSchema.parse(await backend.createPerson(PERSON));
    expect(written).toEqual([`${created.userId}:run-abc123:marta-2`]);
  });

  it("removes the half-made user when the app's own hook fails", async () => {
    const admin = new FakeFirebase();
    const backend = preset(admin, google(admin), {
      afterCreate: () => {
        throw new Error("the products table rejected the insert");
      },
    });

    await expect(backend.createPerson(PERSON)).rejects.toThrow(/products table/);
    // An account nobody will ever come back for is the mess this package exists to prevent.
    expect(admin.users.size).toBe(0);
  });

  it("renews with the refresh token when there is one", async () => {
    const admin = new FakeFirebase();
    const endpoints = google(admin);
    const backend = preset(admin, endpoints);
    const created = CreatedPersonSchema.parse(await backend.createPerson(PERSON));

    const renewed = RefreshedPersonSchema.parse(await backend.refreshPerson?.({ userId: created.userId, refreshToken: created.refreshToken }));
    expect(endpoints.renewed).toEqual([created.refreshToken]);
    expect(renewed.bearerToken).not.toBe(created.bearerToken);
    // One vendor round-trip, not a second user.
    expect(endpoints.exchanged).toHaveLength(1);
  });

  it("re-mints from the user id when the refresh token is gone, rather than losing the person", async () => {
    const admin = new FakeFirebase();
    const endpoints = google(admin);
    const backend = preset(admin, endpoints);
    const created = CreatedPersonSchema.parse(await backend.createPerson(PERSON));
    endpoints.refuseRenewal = true;

    const renewed = RefreshedPersonSchema.parse(await backend.refreshPerson?.({ userId: created.userId, refreshToken: created.refreshToken }));
    expect(renewed.bearerToken).not.toBe(created.bearerToken);
    expect(endpoints.exchanged).toHaveLength(2);
    // The second custom token carries the same run, read back off the user rather than remembered.
    expect(endpoints.exchanged[1]).toContain("run-abc123");
    expect(admin.users.size).toBe(1);
  });

  it("re-mints when populace has no refresh token at all", async () => {
    const admin = new FakeFirebase();
    const endpoints = google(admin);
    const backend = preset(admin, endpoints);
    const created = CreatedPersonSchema.parse(await backend.createPerson(PERSON));

    await backend.refreshPerson?.({ userId: created.userId, refreshToken: null });
    expect(endpoints.renewed).toEqual([]);
    expect(endpoints.exchanged).toHaveLength(2);
  });

  it("deletes idempotently, and lets the app delete its own row first", async () => {
    const admin = new FakeFirebase();
    const removed: string[] = [];
    const backend = preset(admin, google(admin), { beforeRemove: ({ userId }) => void removed.push(userId) });
    const created = CreatedPersonSchema.parse(await backend.createPerson(PERSON));

    await backend.removePerson?.({ userId: created.userId });
    await backend.removePerson?.({ userId: created.userId });
    await backend.removePerson?.({ userId: "uid-never-existed" });
    expect(admin.users.size).toBe(0);
    expect(removed).toEqual([created.userId, created.userId, "uid-never-existed"]);
  });
});

describe("what the vendor's own error codes are read for", () => {
  it("calls a collision a refusal, from the code and not from the prose around it", async () => {
    const admin = new FakeFirebase();
    const endpoints = google(admin);
    const backend = preset(admin, endpoints);
    await backend.createPerson(PERSON);

    // The fake's message says nothing a regex could find. Only `auth/email-already-exists` can
    // have produced this, which is the point: vendor prose is localised and gets reworded.
    await expect(backend.createPerson({ ...PERSON, handle: "marta-9" })).rejects.toMatchObject({ code: "refused" });
    expect(admin.users.size).toBe(1);
  });

  it("calls a person deleted outside populace gone, so a replacement is provisioned", async () => {
    const admin = new FakeFirebase();
    const endpoints = google(admin);
    const backend = preset(admin, endpoints);
    const created = CreatedPersonSchema.parse(await backend.createPerson(PERSON));
    admin.users.delete(created.userId);

    await expect(backend.refreshPerson?.({ userId: created.userId, refreshToken: null })).rejects.toMatchObject({ code: "gone" });
  });

  it("makes a password for a populace that sent none", async () => {
    const admin = new FakeFirebase();
    const { password: _password, ...passwordless } = PERSON;
    const created = CreatedPersonSchema.parse(await preset(admin, google(admin)).createPerson(passwordless));

    // A Firebase user with no password can only ever be signed in by an admin.
    expect(admin.users.get(created.userId)?.password ?? "").not.toHaveLength(0);
  });
});

describe("a Firebase preset with no Web API key", () => {
  it("refuses at the mint, names the key, and leaves no user behind", async () => {
    const admin = new FakeFirebase();
    const endpoints = google(admin);
    // What an unset environment variable looks like by the time it reaches the preset.
    const handle = createProvisioningHandler({ secret: "a-dev-scoped-secret-32-characters", log: () => {}, backend: firebase({ apiKey: "", auth: admin, fetch: endpoints.fetch }) });

    const response = await handle({
      method: "POST",
      path: "/people",
      query: {},
      headers: { authorization: "Bearer a-dev-scoped-secret-32-characters" },
      body: { ...PERSON },
    });

    const error = ErrorBodySchema.parse(response.body).error;
    expect(error.code).toBe("refused");
    expect(error.message).toMatch(/Web API key/i);
    expect(admin.users.size).toBe(0);
  });

  it("can still clean up after a run that was configured that way", async () => {
    const admin = new FakeFirebase();
    const endpoints = google(admin);
    // Provisioned while the key was set; swept after somebody removed it from the environment.
    const working = preset(admin, endpoints);
    const created = CreatedPersonSchema.parse(await working.createPerson(PERSON));

    const crippled = firebase({ apiKey: "", auth: admin, fetch: endpoints.fetch });
    expect(await crippled.listPeople?.({ tag: "run-abc123" })).toHaveLength(1);
    await crippled.removePerson?.({ userId: created.userId });
    expect(admin.users.size).toBe(0);
  });
});

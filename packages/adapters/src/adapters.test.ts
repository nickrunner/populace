import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, Credential, Identity, JsonValue, ProvisionResult, TeardownDeps } from "@populace/core";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FirebaseAdminProvider, SelfSignupProvider, StaticIdentityProvider, type FetchLike, type FirebaseAuthLike } from "./index.js";

const agent: Agent = {
  id: "pop/casual#1",
  runId: "run_a_aaaaaa",
  simulationId: "sim_test",
  populationId: "pop",
  cohortSlug: "casual",
  personId: "casual#1",
  name: "Ingrid Bergstrom",
  details: "",
  handle: "ingrid-bergstrom-casual-1",
  persona: { id: "casual", name: "Casual lister", role: "r", backstory: "b", goals: ["g"], constraints: [], patience: 3, budgetUsd: 0, traits: {}, tools: { allow: [], deny: [], destructive: "confirm" }, model: {} },
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
    expect(result.suggested.email).toBe("ingrid-bergstrom-casual-1+run_a_aaaaaa@populace.test");
    // The RUN ID and not the tag, because a tag is `populace:run_…` and a colon is not legal in an
    // unquoted local part — every address populace generated used to be invalid, and the one
    // target that validated rather than tolerated refused them all (ADR-0037).
    expect(result.suggested.email).not.toContain(":");
    expect(z.email().safeParse(result.suggested.email).success).toBe(true);
    expect(result.suggested.displayName).toBe("Ingrid Bergstrom");
    const credential = provider.capture({ tool: "sign_up", arguments: { email: result.suggested.email }, result: { token: "tk_1", user: { id: "usr_1" } } });
    expect(credential).toEqual({ bearerToken: "tk_1", expiresAt: null, redeemable: null, userId: "usr_1", email: result.suggested.email, extra: {} });
    expect(provider.capture({ tool: "other", arguments: {}, result: { token: "x" } })).toBeUndefined();
    expect(provider.capture({ tool: "sign_up", arguments: {}, result: { error: "nope" } })).toBeUndefined();
  });

  /**
   * The defect this replaces: the local part was `slugify(persona.id)-${ordinal + 1}`, so two
   * cohorts sharing one persona both asked for `casual-1@…` and the second could not sign up at
   * all. The handle is the person's and is cohort-scoped, so they cannot collide.
   */
  it("gives two cohorts on one persona two distinct signup emails", async () => {
    const weekenders = { ...agent, id: "pop/weekenders#1", cohortSlug: "weekenders", personId: "weekenders#1", name: "Ingrid Bergstrom", handle: "ingrid-bergstrom-weekenders-1" };
    const sceptics = { ...agent, id: "pop/sceptics#1", cohortSlug: "sceptics", personId: "sceptics#1", name: "Ingrid Bergstrom", handle: "ingrid-bergstrom-sceptics-1" };
    const a = await provider.provision({ ...ctx, agent: weekenders });
    const b = await provider.provision({ ...ctx, agent: sceptics });
    if (a.kind !== "self-service" || b.kind !== "self-service") throw new Error("expected self-service");
    expect(a.suggested.email).not.toBe(b.suggested.email);
    expect(a.suggested.email).toBe("ingrid-bergstrom-weekenders-1+run_a_aaaaaa@populace.test");
    expect(b.suggested.email).toBe("ingrid-bergstrom-sceptics-1+run_a_aaaaaa@populace.test");
  });

  it("tears down through the configured tool", async () => {
    const identity: Identity = { id: "idn", runId: ctx.runId, tag: ctx.tag, agentId: agent.id, personaId: "casual", strategy: "self-signup", credential: { bearerToken: "tk", expiresAt: null, redeemable: null, extra: {} }, createdAt: new Date().toISOString(), tornDownAt: null };
    await provider.teardown(identity, deps);
    expect(deps.callTool).toHaveBeenCalledWith("tk", "delete_account", {});
  });

  /**
   * The handle is READ, not re-derived. The two agree today because both come from `handleFor`,
   * so a provider that recomputed one from the name would pass every assertion above; a handle the
   * roster wrote by any other route — a model, a rename — is what separates them (SPEC §5.3.5).
   */
  it("signs up with the handle the roster froze, not one derived from the name", async () => {
    const renamed = { ...agent, name: "Ingrid Bergström-Okonkwo", handle: "ingrid-b-casual-1" };
    const result = await provider.provision({ ...ctx, agent: renamed });
    if (result.kind !== "self-service") throw new Error("expected self-service");
    expect(result.suggested.email).toBe("ingrid-b-casual-1+run_a_aaaaaa@populace.test");
    expect(result.suggested.displayName).toBe("Ingrid Bergström-Okonkwo");
  });
});

describe("StaticIdentityProvider", () => {
  /** Writes a pool file and returns its path; each test gets its own directory. */
  function poolFile(contents: JsonValue): string {
    const dir = mkdtempSync(join(tmpdir(), "populace-static-"));
    const file = join(dir, "creds.json");
    writeFileSync(file, JSON.stringify(contents));
    return file;
  }

  /** Person `ordinal` of `cohortSlug`, on `personaId`. */
  function person(cohortSlug: string, ordinal: number, personaId = "casual"): Agent {
    return {
      ...agent,
      id: `pop/${cohortSlug}#${ordinal + 1}`,
      cohortSlug,
      personId: `${cohortSlug}#${ordinal + 1}`,
      handle: `person-${cohortSlug}-${ordinal + 1}`,
      ordinal,
      persona: { ...agent.persona, id: personaId },
    };
  }

  const bearerOf = (result: ProvisionResult): string => (result.kind === "credential" ? (result.credential.bearerToken ?? "?") : "?");

  it("hands out credentials per persona, one per person in cohort order", async () => {
    const file = poolFile({ casual: [{ bearerToken: "a" }, { bearerToken: "b" }], "*": [{ bearerToken: "z" }] });
    const provider = new StaticIdentityProvider({ strategy: "static", file });
    const first = await provider.provision({ ...ctx, agent: person("casual", 0) });
    const second = await provider.provision({ ...ctx, agent: person("casual", 1) });
    const third = await provider.provision({ ...ctx, agent: person("other-cohort", 0, "other") });
    expect([first, second, third].map(bearerOf)).toEqual(["a", "b", "z"]);
  });

  /**
   * The defect this replaces: `list[index % list.length]`. Ten people against three entries meant
   * people 4-10 silently reused accounts 1-3 — several simulated people were literally the same
   * account on the target, seeing each other's data, and a per-user-state defect was
   * indistinguishable from two people sharing a login. Exhaustion is an error now.
   */
  it("refuses to wrap when the pool runs out, and says what to add", async () => {
    const file = poolFile({ byCohort: { casual: [{ bearerToken: "a" }, { bearerToken: "b" }, { bearerToken: "c" }] } });
    const provider = new StaticIdentityProvider({ strategy: "static", file });
    const people = Array.from({ length: 10 }, (_, ordinal) => person("casual", ordinal));

    const handed: string[] = [];
    const failures: string[] = [];
    for (const who of people) {
      try {
        handed.push(bearerOf(await provider.provision({ ...ctx, agent: who })));
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err));
      }
    }
    // Nobody got somebody else's account, and the seven who had none were told so.
    expect(handed).toEqual(["a", "b", "c"]);
    expect(new Set(handed).size).toBe(handed.length);
    expect(failures).toHaveLength(7);
    expect(failures[0]).toContain('"casual"');
    expect(failures[0]).toContain("3 entries");
    expect(failures[0]).toContain("4 people need an account");

    // And the whole population is refused before a run starts, with the real shortfall.
    const problems = provider.checkPopulation(people);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"casual"');
    expect(problems[0]).toContain("3 entries");
    expect(problems[0]).toContain("10 people need an account");
    expect(problems[0]).toContain("add 7 more entries");
  });

  /**
   * The restart. The hand-out counter was a per-instance `Map`, so four people provisioning, a
   * process restart and a fifth person meant entry 1 went out twice — and pause/resume makes a
   * restart a routine part of a longitudinal simulation rather than an accident. Assignment is
   * derived from the agent (cohort + ordinal), so a brand-new provider agrees with the old one.
   */
  it("assigns the same entry to the same person across provider instances", async () => {
    const file = poolFile({ byCohort: { casual: [{ bearerToken: "a" }, { bearerToken: "b" }, { bearerToken: "c" }, { bearerToken: "d" }, { bearerToken: "e" }] } });
    const people = Array.from({ length: 5 }, (_, ordinal) => person("casual", ordinal));

    const before = new StaticIdentityProvider({ strategy: "static", file });
    const early = await Promise.all(people.slice(0, 4).map((who) => before.provision({ ...ctx, agent: who }).then(bearerOf)));

    // The process dies here. Nothing of it survives but the file.
    const after = new StaticIdentityProvider({ strategy: "static", file });
    const late = await Promise.all(people.slice(4).map((who) => after.provision({ ...ctx, agent: who }).then(bearerOf)));
    const again = await Promise.all(people.slice(0, 4).map((who) => after.provision({ ...ctx, agent: who }).then(bearerOf)));

    expect(new Set([...early, ...late]).size).toBe(5);
    expect(again).toEqual(early);
  });

  /**
   * Indexing by ordinal is only unambiguous when the pool belongs to ONE cohort: two cohorts on
   * one persona both have a person 1. Cohort-keyed files are the answer and the preferred shape.
   */
  it("gives two cohorts sharing one persona two distinct entries from a cohort-keyed file", async () => {
    const file = poolFile({ byCohort: { weekenders: [{ bearerToken: "w1" }, { bearerToken: "w2" }], sceptics: [{ bearerToken: "s1" }] } });
    const provider = new StaticIdentityProvider({ strategy: "static", file });
    const people = [person("weekenders", 0), person("weekenders", 1), person("sceptics", 0)];
    const handed = await Promise.all(people.map((who) => provider.provision({ ...ctx, agent: who }).then(bearerOf)));
    expect(handed).toEqual(["w1", "w2", "s1"]);
    expect(provider.checkPopulation(people)).toEqual([]);
  });

  /** The legacy shapes are the shipped format and must keep working. */
  it("still reads a flat array whose entries name their persona", async () => {
    const file = poolFile([
      { bearerToken: "a", personaId: "casual" },
      { bearerToken: "b", personaId: "casual" },
      { bearerToken: "z" },
    ]);
    const provider = new StaticIdentityProvider({ strategy: "static", file });
    expect(bearerOf(await provider.provision({ ...ctx, agent: person("casual", 1) }))).toBe("b");
    expect(bearerOf(await provider.provision({ ...ctx, agent: person("others", 0, "nobody") }))).toBe("z");
  });

  /**
   * A persona-keyed pool serving two cohorts cannot be resolved by ordinal, and the provider —
   * which sees one agent at a time — cannot tell. Refusing is the only honest answer.
   */
  it("refuses a persona-keyed pool that serves more than one cohort", () => {
    const file = poolFile({ casual: [{ bearerToken: "a" }, { bearerToken: "b" }, { bearerToken: "c" }, { bearerToken: "d" }] });
    const provider = new StaticIdentityProvider({ strategy: "static", file });
    const problems = provider.checkPopulation([person("weekenders", 0), person("weekenders", 1), person("sceptics", 0), person("sceptics", 1)]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("sceptics");
    expect(problems[0]).toContain("weekenders");
    expect(problems[0]).toContain("byCohort");
  });

  /**
   * A key the user WROTE is a key the error should name. `add` only created a pool key when it
   * pushed an entry, so a persona list emptied out — rotated away, or left as `[]` — was not in
   * the pool at all and the lookup fell through to the `"*"` fallback: the message then told them
   * to add entries under a key their file does not contain, and never mentioned the one it does.
   */
  it("names the persona key the user wrote, even when they left its list empty", async () => {
    const file = poolFile({ casual: [], other: [{ bearerToken: "o" }] });
    const provider = new StaticIdentityProvider({ strategy: "static", file });
    await expect(provider.provision({ ...ctx, agent: person("casual", 0) })).rejects.toThrow(/"casual"/);
    const problems = provider.checkPopulation([person("casual", 0)]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"casual"');
    expect(problems[0]).not.toContain('under "*"');
  });

  it("refuses a pool that lists the same credential twice", () => {
    const file = poolFile({ byCohort: { casual: [{ bearerToken: "same" }, { bearerToken: "same" }] } });
    const provider = new StaticIdentityProvider({ strategy: "static", file });
    const problems = new StaticIdentityProvider({ strategy: "static", file }).checkPopulation([person("casual", 0), person("casual", 1)]);
    expect(provider.strategy).toBe("static");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("same static credential");
  });

  /**
   * Two bearers, one account: a second API key for the same user, or a rotated token pasted in
   * beside the one it replaced. Matching on the bearer alone waved those through, and the two
   * people holding them were then the same login on the target — seeing each other's data, filing
   * "independent" reports that were nothing of the kind — while the run-start error claimed the
   * stronger property that everyone had their own account.
   */
  it("refuses two entries that name one account with different bearer tokens", () => {
    const file = poolFile({
      byCohort: {
        casual: [
          { bearerToken: "old-key", userId: "u_1", email: "sam@example.test" },
          { bearerToken: "rotated-key", userId: "u_1", email: "sam@example.test" },
        ],
      },
    });
    const problems = new StaticIdentityProvider({ strategy: "static", file }).checkPopulation([person("casual", 0), person("casual", 1)]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("same static credential");
    expect(problems[0]).toContain("u_1");
    // Never the token itself: these messages are printed and logged.
    expect(problems[0]).not.toContain("rotated-key");
  });

  /**
   * The limitation of this way in that is otherwise invisible (ADR-0038).
   *
   * There is no `refresh` on this provider and nothing to redeem, so `wake.ts` skips renewal
   * entirely: the visit connects with a dead bearer and ends `auth-failed`, for every person, with
   * nothing anywhere having said a word. Every `expiresAt` is in hand at run start, and this is the
   * one moment before any money is spent.
   */
  it("refuses to start on a pool whose tokens are already dead, naming the entries rather than the tokens", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const file = poolFile({ byCohort: { casual: [{ bearerToken: "stale-token", expiresAt: past }, { bearerToken: "b" }] } });
    const problems = new StaticIdentityProvider({ strategy: "static", file }).checkPopulation([person("casual", 0), person("casual", 1)]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"casual" entry 1');
    expect(problems[0]).toContain("cannot renew");
    // Never the token itself: these messages are printed and logged.
    expect(problems[0]).not.toContain("stale-token");
  });

  /**
   * Within the margin a visit is given, not merely past. A bearer with three minutes on it is
   * judged fresh by anything looking at the clock, connects, and dies halfway through a session of
   * up to `maxTurns` model calls — the whole reason `REDEEM_SKEW_MS` exists.
   */
  it("counts a token that dies during the visit, and leaves one with real time on it alone", () => {
    const soon = new Date(Date.now() + 3 * 60_000).toISOString();
    const later = new Date(Date.now() + 48 * 60 * 60_000).toISOString();
    const dying = poolFile({ byCohort: { casual: [{ bearerToken: "a", expiresAt: soon }] } });
    expect(new StaticIdentityProvider({ strategy: "static", file: dying }).checkPopulation([person("casual", 0)])).toHaveLength(1);
    const fine = poolFile({ byCohort: { casual: [{ bearerToken: "a", expiresAt: later }] } });
    expect(new StaticIdentityProvider({ strategy: "static", file: fine }).checkPopulation([person("casual", 0)])).toEqual([]);
  });

  /** Static logins existed before populace and belong to whoever pasted them in; a sweep must not claim it removed them. */
  it("declares that it does not own the accounts it hands out", () => {
    const file = poolFile({ byCohort: { casual: [{ bearerToken: "a" }] } });
    expect(new StaticIdentityProvider({ strategy: "static", file }).ownsAccounts).toBe(false);
  });

  /**
   * `bearerToken` is optional on `Credential` because a Firebase bearer is derived from a
   * redeemable. A static pool derives nothing: an entry with a typo'd key must still fail at
   * construction, or the wake connects with the endpoint's own gateway token and every agent
   * authenticates as the same shared account instead of as its pool entry.
   */
  it("rejects a credentials file whose entry has no bearer token", () => {
    const dir = mkdtempSync(join(tmpdir(), "populace-static-"));
    const file = join(dir, "creds.json");
    writeFileSync(file, JSON.stringify([{ token: "tk_1", email: "a@b.c" }]));
    expect(() => new StaticIdentityProvider({ strategy: "static", file })).toThrow();
  });
});

describe("FirebaseAdminProvider", () => {
  interface Sent {
    url: string;
    headers: Record<string, string>;
    body: string;
  }

  /** A fake Firebase Auth plus a fake fetch for Google's two token endpoints. No network, no key. */
  function harness(answer?: (url: string) => { ok: boolean; status: number; body: JsonValue } | undefined): {
    auth: FirebaseAuthLike;
    fetchImpl: FetchLike;
    sent: Sent[];
    users: Map<string, { uid: string; email: string; displayName: string; customClaims?: Record<string, string> }>;
  } {
    const users = new Map<string, { uid: string; email: string; displayName: string; customClaims?: Record<string, string> }>();
    const auth: FirebaseAuthLike = {
      createUser: vi.fn(async ({ email, displayName }) => {
        // The real SDK throws `auth/email-already-exists` on a duplicate, which is why two cohorts
        // sharing one persona could not both provision under the old naming scheme.
        if ([...users.values()].some((u) => u.email === email)) throw new Error("auth/email-already-exists");
        const uid = `uid_${users.size + 1}`;
        users.set(uid, { uid, email, displayName });
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
    const sent: Sent[] = [];
    const fetchImpl: FetchLike = (url, init) => {
      sent.push({ url, headers: init.headers, body: init.body });
      const override = answer?.(url);
      if (override) return Promise.resolve({ ok: override.ok, status: override.status, json: () => Promise.resolve(override.body), text: () => Promise.resolve(JSON.stringify(override.body)) });
      // Google answers the exchange in camelCase and the refresh in snake_case. The fake answers
      // each endpoint the way the documented one does, and NOTHING in the other casing, so a
      // provider that parsed either response with the wrong schema fails here rather than in prod.
      const body: JsonValue = url.startsWith("https://securetoken.googleapis.com/")
        ? { id_token: "id_from_refresh", refresh_token: "refresh_2", expires_in: "3600", user_id: "uid_1", project_id: "p", token_type: "Bearer" }
        : { idToken: "id_from_exchange", refreshToken: "refresh_1", expiresIn: "3600" };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
    };
    return { auth, fetchImpl, sent, users };
  }

  const config = { strategy: "admin-mint", provider: "firebase", emailDomain: "populace.test", apiKey: "web-key" } as const;

  const identityOf = (credential: Credential): Identity => ({
    id: "idn_1",
    runId: ctx.runId,
    tag: ctx.tag,
    agentId: agent.id,
    personaId: "casual",
    strategy: "admin-mint",
    credential,
    createdAt: new Date().toISOString(),
    tornDownAt: null,
  });

  const unmintable = { strategy: "admin-mint", provider: "firebase", emailDomain: "populace.test" } as const;

  /**
   * A custom token is not an ID token: any backend calling `verifyIdToken` rejects one, so a
   * provider that quietly handed one back would provision every person and then fail every call.
   * It refuses BEFORE `createUser`, so the refusal does not itself leave a user behind.
   */
  it("refuses to mint when it has neither an api key nor an exchange endpoint", async () => {
    const { auth, fetchImpl, users, sent } = harness();
    const provider = new FirebaseAdminProvider(unmintable, auth, fetchImpl);
    await expect(provider.provision(ctx)).rejects.toThrow(/custom token is not an ID token/i);
    await expect(provider.provision(ctx)).rejects.toThrow(/identity\.apiKey/);
    expect(users.size).toBe(0);
    expect(sent).toHaveLength(0);
  });

  /**
   * The refusal must not be in the constructor. `identityProviderFor` builds this provider eagerly
   * for every CLI command and as the first statement of `sweepRun`, and neither `listByTag` nor
   * `teardown` needs an exchange — they go through the service account. A constructor that threw
   * would break `populace sweep` on exactly the configuration that leaves real users behind.
   */
  it("still lists and tears down users when it has nothing to mint with", async () => {
    const { auth, fetchImpl } = harness();
    const minting = new FirebaseAdminProvider(config, auth, fetchImpl);
    const made = await minting.provision(ctx);
    if (made.kind !== "credential") throw new Error("expected a credential");

    const sweeper = new FirebaseAdminProvider(unmintable, auth, fetchImpl);
    const listed = await sweeper.listByTag(ctx.tag, deps);
    expect(listed).toHaveLength(1);
    await sweeper.teardown(listed[0]!);
    expect(await sweeper.listByTag(ctx.tag, deps)).toHaveLength(0);
  });

  it("exchanges the custom token at the identity toolkit and reads the camelCase response", async () => {
    const { auth, fetchImpl, sent } = harness();
    const provider = new FirebaseAdminProvider(config, auth, fetchImpl);
    const result = await provider.provision(ctx);
    if (result.kind !== "credential") throw new Error("expected a credential");

    expect(sent).toHaveLength(1);
    const [exchange] = sent;
    expect(exchange?.url).toBe("https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=web-key");
    expect(exchange?.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(exchange?.body ?? "{}")).toEqual({ token: "custom_uid_1", returnSecureToken: true });

    // The ID token, not the custom token, is what the target is handed.
    expect(result.credential.bearerToken).toBe("id_from_exchange");
    expect(result.credential.redeemable).toEqual({ kind: "refresh-token", secret: "refresh_1" });
    const expiresAt = result.credential.expiresAt;
    expect(expiresAt).not.toBeNull();
    expect(Date.parse(expiresAt ?? "") - Date.now()).toBeGreaterThan(3_500_000);
    expect(Date.parse(expiresAt ?? "") - Date.now()).toBeLessThanOrEqual(3_600_000);
  });

  it("renews through the secure-token endpoint, form-encoded, reading the SNAKE_CASE response", async () => {
    const { auth, fetchImpl, sent } = harness();
    const provider = new FirebaseAdminProvider(config, auth, fetchImpl);
    const result = await provider.provision(ctx);
    if (result.kind !== "credential") throw new Error("expected a credential");
    const identity: Identity = {
      id: "idn_1",
      runId: ctx.runId,
      tag: ctx.tag,
      agentId: agent.id,
      personaId: "casual",
      strategy: "admin-mint",
      credential: result.credential,
      createdAt: new Date().toISOString(),
      tornDownAt: null,
    };

    const renewed = await provider.refresh(identity);
    const refresh = sent[1];
    expect(refresh?.url).toBe("https://securetoken.googleapis.com/v1/token?key=web-key");
    expect(refresh?.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(refresh?.body ?? ""))).toEqual({ grant_type: "refresh_token", refresh_token: "refresh_1" });

    // Asserted on the VALUE, not on "a token came back": reading that response as camelCase yields
    // undefined, and a test that only checked for truthiness would pass while `Bearer undefined`
    // went out on every call.
    expect(renewed.bearerToken).toBe("id_from_refresh");
    expect(renewed.redeemable).toEqual({ kind: "refresh-token", secret: "refresh_2" });
    expect(renewed.userId).toBe("uid_1");
  });

  /**
   * The regression this replaces: the email was `slugify(persona.id)-${ordinal + 1}` and the
   * display name was the PERSONA's. Two cohorts on one persona therefore asked Firebase for the
   * same address, and `createUser` throws on a duplicate — so the second cohort could not provision
   * at all — while every user in the project was called "Casual lister" rather than by their name.
   */
  it("gives two cohorts on one persona two distinct Firebase users, named after the people", async () => {
    const { auth, fetchImpl, users } = harness();
    const provider = new FirebaseAdminProvider(config, auth, fetchImpl);
    const weekenders = { ...agent, id: "pop/weekenders#1", cohortSlug: "weekenders", personId: "weekenders#1", name: "Ahmed Castillo", handle: "ahmed-castillo-weekenders-1" };
    const sceptics = { ...agent, id: "pop/sceptics#1", cohortSlug: "sceptics", personId: "sceptics#1", name: "Ingrid Bergstrom", handle: "ingrid-bergstrom-sceptics-1" };

    const a = await provider.provision({ ...ctx, agent: weekenders });
    const b = await provider.provision({ ...ctx, agent: sceptics });
    if (a.kind !== "credential" || b.kind !== "credential") throw new Error("expected credentials");

    expect(a.credential.email).toBe("ahmed-castillo-weekenders-1+run_a_aaaaaa@populace.test");
    expect(b.credential.email).toBe("ingrid-bergstrom-sceptics-1+run_a_aaaaaa@populace.test");
    expect(a.credential.email).not.toBe(b.credential.email);
    expect([...users.values()].map((u) => u.displayName)).toEqual(["Ahmed Castillo", "Ingrid Bergstrom"]);
    expect([...users.values()].map((u) => u.displayName)).not.toContain(agent.persona.name);
  });

  /**
   * With both an `apiKey` and an `exchangeUrl` the bearer comes from the USER's endpoint, and so
   * does the refresh token. Google's secure-token endpoint only knows refresh tokens Google issued:
   * posting a foreign one there answers INVALID_REFRESH_TOKEN, and every wake for every person ends
   * `auth-failed` from the first hour onward. The renewal has to follow where the session was
   * minted, not what happens to be configured.
   */
  it("renews an exchangeUrl session through that endpoint, never posting its refresh token to Google", async () => {
    const custom = { ...config, exchangeUrl: "https://my-own.example/exchange" } as const;
    const { auth, fetchImpl, sent } = harness((url) =>
      url.startsWith("https://my-own.example/") ? { ok: true, status: 200, body: { token: "my_own_id", refreshToken: "MY_OWN_VENDOR_REFRESH", expiresIn: "3600" } } : undefined,
    );
    const provider = new FirebaseAdminProvider(custom, auth, fetchImpl);
    const made = await provider.provision(ctx);
    if (made.kind !== "credential") throw new Error("expected a credential");
    expect(made.credential.bearerToken).toBe("my_own_id");

    const renewed = await provider.refresh(identityOf(made.credential));
    expect(sent.map((s) => new URL(s.url).host)).toEqual(["my-own.example", "my-own.example"]);
    expect(sent.some((s) => s.body.includes("MY_OWN_VENDOR_REFRESH"))).toBe(false);
    expect(renewed.bearerToken).toBe("my_own_id");
  });

  /**
   * A refresh token can be revoked, disabled or expired outright. `createCustomToken` needs nothing
   * from the old session, so that costs one vendor round-trip — not the person's remaining visits,
   * which is what happens when the wake ends `auth-failed` and the dead redeemable stays on the row.
   */
  it("re-mints when Google refuses the refresh token", async () => {
    const { auth, fetchImpl, sent } = harness((url) =>
      url.startsWith("https://securetoken.googleapis.com/") ? { ok: false, status: 400, body: { error: { message: "TOKEN_EXPIRED" } } } : undefined,
    );
    const provider = new FirebaseAdminProvider(config, auth, fetchImpl);
    const made = await provider.provision(ctx);
    if (made.kind !== "credential") throw new Error("expected a credential");

    const renewed = await provider.refresh(identityOf(made.credential));
    expect(sent.map((s) => new URL(s.url).host)).toEqual(["identitytoolkit.googleapis.com", "securetoken.googleapis.com", "identitytoolkit.googleapis.com"]);
    expect(renewed.bearerToken).toBe("id_from_exchange");
  });

  it("creates a tagged user, lists by claim and deletes", async () => {
    const { auth, fetchImpl } = harness();
    const provider = new FirebaseAdminProvider(config, auth, fetchImpl);
    const result = await provider.provision(ctx);
    expect(result.kind).toBe("credential");
    if (result.kind !== "credential") return;
    const listed = await provider.listByTag(ctx.tag, deps);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.credential.userId).toBe("uid_1");
    await provider.teardown(listed[0]!);
    expect(await provider.listByTag(ctx.tag, deps)).toHaveLength(0);
  });
});

import { newIdentityId, type Agent, type Identity, type ProvisionContext } from "@populace/core";
import { createProvisioningHandler, JsonValueSchema, type ProvisioningBackend, type TdkHandler, type TdkRequest } from "@populace/tdk";
import { describe, expect, it } from "vitest";
import { ProvisionUrlProvider, TdkRefusal, type FetchLike } from "./provision-url/index.js";

/**
 * The handshake, proved: populace's provider driving `@populace/tdk`'s own handler.
 *
 * Both halves of a wire are usually tested against a fixture of the same author's imagination,
 * which is how two implementations of one contract come to agree about something neither one
 * does. Here the fake is only the app's `createPerson` — everything between it and the provider is
 * the real kit, so a field either side spells differently fails here rather than on a live target
 * halfway through a run (ADR-0037).
 */

const SECRET = "shared-secret-for-tests";

/** The app's own half: an in-memory product that makes users, renews them and deletes them. */
function fakeProduct(options: { capabilities?: { refresh?: boolean; teardown?: boolean; listByTag?: boolean } } = {}) {
  const people = new Map<string, { userId: string; email: string; displayName: string; tag: string; bearer: string; attributes: Record<string, string | number | boolean> }>();
  let minted = 0;
  const backend: ProvisioningBackend = {
    createPerson: (person) => {
      minted += 1;
      const userId = `user-${minted}`;
      people.set(userId, { userId, email: person.email, displayName: person.displayName, tag: person.tag, bearer: `bearer-${userId}-1`, attributes: person.attributes });
      return { userId, bearerToken: `bearer-${userId}-1`, expiresAt: new Date(Date.now() + 3_600_000), refreshToken: `refresh-${userId}` };
    },
    refreshPerson: ({ userId, refreshToken }) => {
      const person = people.get(userId);
      if (!person) throw new Error(`no such person ${userId}`);
      const next = `bearer-${userId}-2`;
      people.set(userId, { ...person, bearer: next });
      // The redeemed token comes back so a test can prove populace sent the one it was holding.
      return { bearerToken: next, expiresAt: new Date(Date.now() + 3_600_000), refreshToken: refreshToken ?? null };
    },
    removePerson: ({ userId }) => {
      people.delete(userId);
    },
    listPeople: ({ tag }) => [...people.values()].filter((person) => person.tag === tag),
  };
  return { people, backend, capabilities: options.capabilities };
}

/**
 * `fetch`, as the kit's handler. No port is bound and nothing is mocked in between: the request
 * the provider builds is parsed by the kit exactly as an HTTP one would be.
 */
function wire(handler: TdkHandler, at = "https://app.test/populace"): FetchLike {
  return async (url, init) => {
    const parsed = new URL(url);
    const base = new URL(at);
    const request: TdkRequest = {
      method: init.method,
      path: parsed.pathname.slice(base.pathname.length) || "/",
      query: Object.fromEntries(parsed.searchParams),
      headers: Object.fromEntries(Object.entries(init.headers).map(([key, value]) => [key.toLowerCase(), value])),
      ...(init.body === undefined ? {} : { body: JsonValueSchema.parse(JSON.parse(init.body)) }),
    };
    const response = await handler(request);
    return {
      ok: response.status < 400,
      status: response.status,
      text: () => Promise.resolve(response.body === undefined ? "" : JSON.stringify(response.body)),
    };
  };
}

function providerFor(product: ReturnType<typeof fakeProduct>, secret: string = SECRET): ProvisionUrlProvider {
  const handler = createProvisioningHandler({
    secret: SECRET,
    environment: "development",
    ...(product.capabilities ? { capabilities: product.capabilities } : {}),
    backend: product.backend,
  });
  return new ProvisionUrlProvider(
    { strategy: "provision-url", url: "https://app.test/populace", secret, emailDomain: "populace.test" },
    wire(handler),
  );
}

/** Only the fields provisioning reads; an agent row is much larger than this. */
const agent = (handle: string, name: string, traits: Record<string, string | number | boolean> = {}): Agent =>
  // eslint-disable-next-line no-restricted-syntax -- a test fixture standing in for one row, narrowed to the fields under test.
  ({ id: `pop/cohort#${handle}`, handle, name, persona: { traits } }) as unknown as Agent;

const context = (handle = "marta-1", tag = "populace:run_abc_123456", traits: Record<string, string | number | boolean> = {}): ProvisionContext => ({
  agent: agent(handle, "Marta", traits),
  runId: "run-1",
  tag,
});

const identityFor = (credential: Identity["credential"], tag = "populace:run_abc_123456"): Identity => ({
  id: newIdentityId(),
  runId: "run-1",
  tag,
  agentId: "a",
  personaId: "p",
  strategy: "provision-url",
  credential,
  createdAt: new Date().toISOString(),
  tornDownAt: null,
});

const noStoredIdentities = { listStoredIdentities: () => Promise.resolve([]), callTool: () => Promise.reject(new Error("no target in this test")) };

describe("the app makes its own people", () => {
  it("provisions one, and carries back everything a wake needs to be that person", async () => {
    const product = fakeProduct();
    const result = await providerFor(product).provision(context());
    expect(result.kind).toBe("credential");
    if (result.kind !== "credential") throw new Error("unreachable");
    expect(result.credential.bearerToken).toBe("bearer-user-1-1");
    expect(result.credential.userId).toBe("user-1");
    // The run tag reaches the app, which is the only way a sweep finds this account again.
    expect(product.people.get("user-1")?.tag).toBe("populace:run_abc_123456");
    // The email carries the run too, for an app with nowhere else to put it — as the RUN ID, not
    // the raw tag, because a tag's colon is not legal in a local part and the kit refuses it.
    expect(result.credential.email).toBe("marta-1+run_abc_123456@populace.test");
    // A refresh token comes back as a redeemable, which is what keeps a person alive past an hour.
    expect(result.credential.redeemable).toEqual({ kind: "refresh-token", secret: "refresh-user-1" });
    expect(result.credential.expiresAt).not.toBeNull();
  });

  /**
   * What makes one person different from another on the way in.
   *
   * Every other field is the same shape for everybody — a handle, a name, an address, the run. The
   * attributes are the person: a persona's traits, sampled per person and merged with the cohort's,
   * which is the only thing that lets "half of these people are on the paid plan" reach an app's
   * own `createPerson` instead of being a sentence in a prompt nobody's database ever sees.
   */
  it("carries the person's own traits through to the app that makes them", async () => {
    const product = fakeProduct();
    const provider = providerFor(product);
    await provider.provision(context("marta-1", "populace:run_abc_123456", { plan: "paid", seats: 12, trialed: false }));
    expect(product.people.get("user-1")?.attributes).toEqual({ plan: "paid", seats: 12, trialed: false });

    // Two people of the same run differ by exactly this and nothing else.
    await provider.provision(context("ingrid-2", "populace:run_abc_123456", { plan: "free", seats: 1, trialed: true }));
    expect(product.people.get("user-2")?.attributes).toEqual({ plan: "free", seats: 1, trialed: true });
  });

  it("sends an empty bag rather than nothing when a person has no traits", async () => {
    const product = fakeProduct();
    await providerFor(product).provision(context());
    // The kit defaults it, so an app can destructure without guarding — and a person with no
    // traits is a normal person, not a malformed request.
    expect(product.people.get("user-1")?.attributes).toEqual({});
  });

  it("renews with the redeemable it is holding, and keeps the person's other fields", async () => {
    const product = fakeProduct();
    const provider = providerFor(product);
    const provisioned = await provider.provision(context());
    if (provisioned.kind !== "credential") throw new Error("unreachable");
    const renewed = await provider.refresh(identityFor(provisioned.credential));
    expect(renewed.bearerToken).toBe("bearer-user-1-2");
    expect(renewed.userId).toBe("user-1");
    expect(renewed.email).toBe(provisioned.credential.email);
    // The refresh token populace held is the one the app was handed.
    expect(renewed.redeemable).toEqual({ kind: "refresh-token", secret: "refresh-user-1" });
  });

  it("tears down, and tearing down twice is still a success", async () => {
    const product = fakeProduct();
    const provider = providerFor(product);
    const provisioned = await provider.provision(context());
    if (provisioned.kind !== "credential") throw new Error("unreachable");
    const identity = identityFor(provisioned.credential);
    await provider.teardown(identity);
    expect(product.people.size).toBe(0);
    // A sweep runs more than once and does not care: the second pass finding nothing is the same
    // success as the first pass finding somebody.
    await expect(provider.teardown(identity)).resolves.toBeUndefined();
  });

  it("follows the cursor to the last page, which is the bug that would look like a clean sweep", async () => {
    const product = fakeProduct();
    const provider = providerFor(product);
    // Past the kit's page size on purpose. A provider that took page one and believed it would
    // report every one of these swept while leaving 150 accounts on somebody's product.
    for (let n = 0; n < 250; n++) await provider.provision(context(`person-${n}`));
    const found = await provider.listByTag("populace:run_abc_123456", noStoredIdentities);
    expect(found).toHaveLength(250);
    expect(new Set(found.map((identity) => identity.credential.userId)).size).toBe(250);
  });

  it("answers a wrong secret with the kit's own words rather than a bare status", async () => {
    const product = fakeProduct();
    const provider = providerFor(product, "not-the-secret");
    // eslint-disable-next-line no-restricted-syntax -- a rejection's reason is untyped by construction; it is narrowed by the assertions below.
    const failure: unknown = await provider.provision(context()).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(TdkRefusal);
    expect(failure).toMatchObject({ code: "unauthorized", status: 401 });
    expect(product.people.size).toBe(0);
  });

  it("reads what the target can and cannot do from its own handshake", async () => {
    const full = providerFor(fakeProduct());
    expect(await full.describe()).toMatchObject({ tdk: 1, capabilities: { refresh: true, teardown: true, listByTag: true } });
    // An app that cannot delete says so, and the provider then has a sentence for the sweep
    // instead of counting a no-op as a removal.
    const soft = providerFor(fakeProduct({ capabilities: { refresh: true, teardown: false, listByTag: true } }));
    expect(soft.cannotRemove).toBeUndefined();
    await soft.describe();
    expect(soft.cannotRemove).toContain("cannot delete accounts");
  });

  it("refuses to call anything at all when no secret is set", async () => {
    const product = fakeProduct();
    const handler = createProvisioningHandler({ secret: SECRET, environment: "development", backend: product.backend });
    const provider = new ProvisionUrlProvider({ strategy: "provision-url", url: "https://app.test/populace", emailDomain: "populace.test" }, wire(handler));
    await expect(provider.provision(context())).rejects.toThrow(/no secret set/);
  });
});

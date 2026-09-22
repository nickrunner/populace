import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { HandshakeSchema } from "./handshake.js";
import { locate, relativize, type ExpressRequestLike, type ExpressResponseLike, type Mounted } from "./mount.js";
import { populaceProvisioning } from "./provisioning/index.js";
import { ProvisionedPersonSchema, type ProvisioningBackend } from "./provisioning/contract.js";

/**
 * The adapters, which are the only code in the kit that knows what an HTTP library looks like.
 *
 * Still no port: a `Request` is a value and an Express request is an object with three fields the
 * kit reads, so both adapters can be driven in memory. What is under test is the path arithmetic —
 * a mount point is invisible to a `fetch` handler and stripped by Express, and getting that wrong
 * turns every route into the handshake.
 */

const SECRET = "a-dev-scoped-secret-32-characters";
const PERSON = { tag: "run-abc123", handle: "marta-2", email: "marta-2+run-abc123@populace.test", displayName: "Marta", password: "correct-horse-battery" };

const people = new Map<string, { email: string; tag: string }>();

const backend: ProvisioningBackend = {
  createPerson: (person) => {
    const userId = `uid-${people.size + 1}`;
    people.set(userId, { email: person.email, tag: person.tag });
    return { userId, bearerToken: `bearer-${userId}`, expiresAt: null, refreshToken: null };
  },
  removePerson: ({ userId }) => void people.delete(userId),
};

function kit(basePath?: string): Mounted {
  return populaceProvisioning({ secret: SECRET, log: () => {}, backend, ...(basePath === undefined ? {} : { basePath }) });
}

/** A response object with the three members the adapter touches, and a promise that it finished. */
function fakeResponse(): ExpressResponseLike & { headers: Record<string, string>; text: string | undefined; finished: Promise<void> } {
  let done = (): void => {};
  const finished = new Promise<void>((resolve) => (done = resolve));
  return {
    statusCode: 0,
    headers: {},
    text: undefined,
    finished,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(chunk?: string) {
      this.text = chunk;
      done();
    },
  };
}

async function throughExpress(middleware: Mounted, req: ExpressRequestLike): Promise<{ statusCode: number; text: string | undefined }> {
  const res = fakeResponse();
  middleware(req, res);
  await res.finished;
  return { statusCode: res.statusCode, text: res.text };
}

describe("finding the route inside the path", () => {
  it("strips a mount point it was told about", () => {
    expect(relativize("/populace/people", { basePath: "/populace" })).toBe("/people");
    expect(relativize("/populace/", { basePath: "/populace/" })).toBe("/");
    // Express has already stripped its own mount path, so an unconfigured path is left alone.
    expect(relativize("/people", {})).toBe("/people");
    expect(relativize("/nowhere", {})).toBe("/nowhere");
  });

  it("finds the kit's own path inside a longer one when nobody said where the mount was", () => {
    expect(locate("/api/populace/people/refresh", { knownSegments: ["people"] })).toBe("/people/refresh");
    expect(locate("/api/populace", { knownSegments: ["people"] })).toBe("/");
  });

  it("leaves a path a configured mount point does not match alone, so it fails where it can be read", () => {
    // Better a "nothing here answers that", which names the routes, than a handshake served from
    // the wrong place and a POST that silently did nothing.
    expect(locate("/elsewhere/people", { basePath: "/populace" })).toBe("/elsewhere/people");
  });
});

describe("the fetch adapter", () => {
  it("serves the whole contract from a mount point it was told about", async () => {
    const app = kit("/populace");
    const auth = { authorization: `Bearer ${SECRET}` };

    const hello = await app.fetch(new Request("https://app.test/populace", { headers: auth }));
    expect(HandshakeSchema.parse(await hello.json()).tdk).toBe(1);

    const made = await app.fetch(new Request("https://app.test/populace/people", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(PERSON) }));
    expect(made.status).toBe(201);
    const person = ProvisionedPersonSchema.parse(await made.json());

    const gone = await app.fetch(
      new Request("https://app.test/populace/people/remove", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ userId: person.userId }) }),
    );
    expect(gone.status).toBe(204);
    expect(await gone.text()).toBe("");
    expect(people.has(person.userId)).toBe(false);
  });

  it("finds its routes under a catch-all route nobody configured", async () => {
    const app = kit();
    const response = await app.fetch(new Request("https://app.test/api/populace/people?tag=run-abc123", { headers: { authorization: `Bearer ${SECRET}` } }));
    // listPeople is not implemented by this backend, so the honest answer is that it cannot —
    // which is the proof the request was routed rather than mistaken for the handshake.
    expect(response.status).toBe(501);
  });

  it("refuses an unauthenticated caller with a status the framework will pass through", async () => {
    const response = await kit("/populace").fetch(new Request("https://app.test/populace"));
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toBe("application/json");
  });
});

describe("the Express adapter", () => {
  it("reads a body a parser already parsed", async () => {
    const app = kit();
    const response = await throughExpress(app, { method: "POST", url: "/people", headers: { authorization: `Bearer ${SECRET}` }, body: PERSON });

    expect(response.statusCode).toBe(201);
    const person = ProvisionedPersonSchema.parse(JSON.parse(response.text ?? ""));
    expect(people.get(person.userId)?.tag).toBe("run-abc123");
  });

  it("reads the body off the stream when no parser ran", async () => {
    const app = kit();
    const stream = Readable.from([Buffer.from(JSON.stringify({ ...PERSON, handle: "marta-9", email: "marta-9+run-abc123@populace.test" }))]);
    const req: ExpressRequestLike = Object.assign(stream, { method: "POST", url: "/people", headers: { authorization: `Bearer ${SECRET}` } });

    const response = await throughExpress(app, req);
    expect(response.statusCode).toBe(201);
  });

  it("answers a path nothing serves by naming the ones it does", async () => {
    const response = await throughExpress(kit(), { method: "GET", url: "/nowhere", headers: { authorization: `Bearer ${SECRET}` } });
    expect(response.statusCode).toBe(400);
    expect(response.text ?? "").toContain("/people");
  });

  it("reads a query string off the url Express hands it", async () => {
    const response = await throughExpress(kit(), { method: "GET", url: "/people?tag=run-abc123", headers: { authorization: `Bearer ${SECRET}` } });
    // Routed, and refused for the honest reason rather than for a missing tag.
    expect(response.statusCode).toBe(501);
  });
});

import { createServer, type Server } from "node:http";
import { describe, expect, it } from "vitest";
import { checkProvisioning } from "./provisioning-check.js";

/**
 * "Did I wire the kit up right?" — the four answers, and that each one sends a reader somewhere
 * different (ADR-0038).
 *
 * The app on the other end is hand-written rather than `@populace/tdk` itself, and deliberately:
 * the contract between the two halves is tested against the real kit in `provision-url.test.ts`,
 * and what is under test HERE is what populace says about what came back. A stub is what lets a
 * test produce the wrong secret, the wrong shape and no server at all, which the kit correctly
 * will not do.
 */
function app(answer: (path: string, secret: string | undefined) => { status: number; body: object | string }): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    const header = req.headers.authorization;
    const { status, body } = answer(path, header?.startsWith("Bearer ") ? header.slice(7) : undefined);
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => server.close(() => { done(); })),
      });
    });
  });
}

const SECRET = "not-a-real-secret-at-all";

describe("asking an app's provisioning endpoint what it can do", () => {
  it("reads back what the app implemented, in words, including what it cannot do", async () => {
    const it_ = await app(() => ({ status: 200, body: { tdk: 1, environment: "development", capabilities: { refresh: true, teardown: false, listByTag: true } } }));

    const found = await checkProvisioning(it_.url, SECRET);

    expect(found.outcome).toBe("answered");
    expect(found.tdk).toBe(1);
    expect(found.environment).toBe("development");
    expect(found.capabilities).toEqual({ refresh: true, teardown: false, listByTag: true });
    // The sentence is where a reader meets `teardown: false`, which is not a setting: it is the
    // promise that a sweep will report accounts left behind rather than claim it removed them.
    expect(found.summary).toContain("development");
    expect(found.summary).toContain("It cannot remove an account");
    await it_.close();
  });

  it("says the secret is wrong rather than that the address is", async () => {
    const it_ = await app((_path, secret) =>
      secret === SECRET
        ? { status: 200, body: { tdk: 1, capabilities: { refresh: true, teardown: true, listByTag: true } } }
        : { status: 401, body: { error: { code: "unauthorized", message: "The secret was missing or wrong." } } },
    );

    const found = await checkProvisioning(it_.url, "the-wrong-one");

    expect(found.outcome).toBe("refused");
    expect(found.summary).toContain("POPULACE_SECRET");
    // The kit's own words are quoted, never paraphrased.
    expect(found.detail).toContain("missing or wrong");
    await it_.close();
  });

  it("tells a server that is not the kit apart from no server at all", async () => {
    const notTheKit = await app(() => ({ status: 404, body: "<!doctype html><title>Not found</title>" }));

    const wrongThing = await checkProvisioning(notTheKit.url, SECRET);
    expect(wrongThing.outcome).toBe("not-a-kit");
    expect(wrongThing.summary).toContain("mount point");
    await notTheKit.close();

    // Nothing listening at all: the port is closed now, so this is the real failure and not a fake.
    const nothing = await checkProvisioning(notTheKit.url, SECRET);
    expect(nothing.outcome).toBe("unreachable");
    expect(nothing.summary).toContain("Nothing answered");
  });

  /**
   * Asked before there is a secret to ask with. It is a refusal rather than a request with an
   * empty bearer, because the app would answer that `unauthorized` and the reader would go looking
   * for a mismatch between two values, one of which does not exist.
   */
  it("refuses to ask at all with no secret, and says which field is empty", async () => {
    const found = await checkProvisioning("https://dev.example.test/populace", undefined);
    expect(found.outcome).toBe("refused");
    expect(found.summary).toContain("POPULACE_SECRET");
    expect(found.detail).toBeNull();
  });
});

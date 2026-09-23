import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The kit is installed into somebody else's server, and **most Express apps are still CommonJS.**
 *
 * An ESM-only package is unreachable from them: `require("@populace/tdk")` fails with
 * ERR_PACKAGE_PATH_NOT_EXPORTED on every Node version, because the exports map offers no `require`
 * condition for the resolver to pick. It is not a warning and not an old-Node problem — the
 * package simply cannot be loaded, and the README's own "mount one route" example is an Express
 * app. This shipped that way in 0.1.0 and 0.2.0.
 *
 * So this test loads the BUILT package the way a stranger would, through its exports map, in both
 * module systems. It runs against `dist/`, which the other suites never touch — a dual build is a
 * property of what is published, and nothing about the source would notice it breaking.
 */

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A throwaway app with the kit linked in, so resolution goes through the exports map. */
function appWith(file: string, source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "tdk-dual-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "stranger", version: "1.0.0" }));
  mkdirSync(join(dir, "node_modules", "@populace"), { recursive: true });
  symlinkSync(pkg, join(dir, "node_modules", "@populace", "tdk"));
  writeFileSync(join(dir, file), source);
  return execFileSync(process.execPath, [join(dir, file)], { encoding: "utf8" }).trim();
}

describe("the package a stranger installs", () => {
  it("can be required from a CommonJS app", () => {
    const out = appWith(
      "app.cjs",
      `const { populaceProvisioning, TDK_CONTRACT_VERSION } = require("@populace/tdk");
       if (typeof populaceProvisioning !== "function") throw new Error("no mount function");
       console.log("cjs:" + TDK_CONTRACT_VERSION);`,
    );
    expect(out).toContain("cjs:1");
  });

  it("can be imported from an ESM app", () => {
    const out = appWith(
      "app.mjs",
      `import { populaceProvisioning, TDK_CONTRACT_VERSION } from "@populace/tdk";
       if (typeof populaceProvisioning !== "function") throw new Error("no mount function");
       console.log("esm:" + TDK_CONTRACT_VERSION);`,
    );
    expect(out).toContain("esm:1");
  });

  it("mounts and answers from CommonJS, not merely loads", () => {
    // Loading is half the promise. This is the other half: the handler the README tells a reader
    // to mount actually serves its handshake when it was reached through `require`.
    const out = appWith(
      "mount.cjs",
      `const { populaceProvisioning } = require("@populace/tdk");
       const kit = populaceProvisioning({
         secret: "x".repeat(32),
         environment: "development",
         createPerson: () => ({ userId: "u1", bearerToken: "b1" }),
       });
       kit.handle({ method: "GET", path: "/", query: {}, headers: { authorization: "Bearer " + "x".repeat(32) } })
         .then((r) => { console.log("tdk:" + r.body.tdk); });`,
    );
    expect(out).toContain("tdk:1");
  });
});

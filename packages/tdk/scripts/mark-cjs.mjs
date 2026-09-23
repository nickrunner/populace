import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Tell Node that `dist/cjs` is CommonJS.
 *
 * The package itself is `"type": "module"`, and Node decides a `.js` file's format from the
 * nearest `package.json` — so without this marker every file the CommonJS build emits would be
 * read back as ESM, and `require()` would fail in a way that looks like the build never ran.
 *
 * Two lines rather than a bundler: this repo builds everything with `tsc`, and a toolchain earns
 * its place by doing something `tsc` cannot.
 */
const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, "../dist/cjs/package.json"), `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);

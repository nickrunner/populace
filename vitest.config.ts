import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@populace\/adapters\/(.+)$/, replacement: `${root}packages/adapters/src/$1/index.ts` },
      { find: /^@populace\/runner\/testing$/, replacement: `${root}packages/runner/src/testing/index.ts` },
      { find: /^@populace\/([^/]+)$/, replacement: `${root}packages/$1/src/index.ts` },
    ],
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: "forks",
  },
});

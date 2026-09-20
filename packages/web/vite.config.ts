import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * The dashboard builds into `@populace/server`'s `public/`, which `populace serve` hosts, so a
 * user runs one command rather than two processes (ADR-0021, ADR-0022).
 *
 * Workspace packages resolve to source rather than `dist` so a change in `contract` is picked up
 * without a rebuild, the same aliasing the vitest config uses.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@populace\/core\/isomorphic$/, replacement: `${root}../core/src/isomorphic.ts` },
      { find: /^@populace\/contract$/, replacement: `${root}../contract/src/index.ts` },
    ],
  },
  build: { outDir: `${root}../server/public`, emptyOutDir: true },
  server: { port: 4312, proxy: { "/api": "http://127.0.0.1:4311" } },
});

import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * `VITE_FONT_SOURCE=cdn|local`, default `cdn` (DESIGN-SYSTEM §8.4).
 *
 * With `local`, the font-service `<link>`s are stripped from the head and nothing is fetched
 * over the network: Space Grotesk is self-hosted from `/fonts/` and same-origin either way, and
 * Source Serif 4 and IBM Plex Mono resolve to the metric-matched fallbacks declared in
 * `theme.css`. The naming / saying / machine law is built on family *class*, not on a specific
 * face, so it survives intact — the page is quieter, not broken.
 *
 * The dashboard is local-first and routinely runs against localhost with no network, so this
 * flag has to exist as code rather than as a paragraph; otherwise the first air-gapped install
 * silently ships Georgia and nobody decided that.
 */
function fontSource(): Plugin {
  const CDN_BLOCK = /[ \t]*<!--FONT_CDN_START-->[\s\S]*?<!--FONT_CDN_END-->\n?/g;
  return {
    name: "populace-font-source",
    transformIndexHtml(html) {
      const source = process.env.VITE_FONT_SOURCE ?? "cdn";
      return source === "local" ? html.replace(CDN_BLOCK, "") : html;
    },
  };
}

/**
 * The dashboard builds into `@populace/server`'s `public/`, which `populace serve` hosts, so a
 * user runs one command rather than two processes (ADR-0021, ADR-0022).
 *
 * Workspace packages resolve to source rather than `dist` so a change in `contract` is picked up
 * without a rebuild, the same aliasing the vitest config uses.
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), fontSource()],
  resolve: {
    alias: [
      { find: /^@populace\/core\/isomorphic$/, replacement: `${root}../core/src/isomorphic.ts` },
      { find: /^@populace\/contract$/, replacement: `${root}../contract/src/index.ts` },
    ],
  },
  build: { outDir: `${root}../server/public`, emptyOutDir: true },
  server: { port: 4312, proxy: { "/api": "http://127.0.0.1:4311" } },
});

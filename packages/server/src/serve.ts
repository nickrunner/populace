import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import { createApp, type ServerDeps } from "./app.js";

export interface ServeOptions extends ServerDeps {
  port?: number;
  /**
   * Defaults to loopback. The process reads a store that can name a target's credentials and, from
   * M2, can spend money on request, so exposing it takes a deliberate flag (ADR-0023).
   */
  host?: string;
  /** Where the built dashboard lives. Defaults to this package's `public/`. */
  webRoot?: string;
  log?: (line: string) => void;
}

export interface RunningServer {
  url: string;
  app: Hono;
  close(): Promise<void>;
}

const here = dirname(fileURLToPath(import.meta.url));

function placeholder(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>populace</title></head>
<body style="font-family: system-ui; max-width: 40rem; margin: 4rem auto">
<h1>populace</h1>
<p>The API is running. The dashboard has not been built into this install yet.</p>
<p>Try <code>/api/v1/runs</code>, or run <code>pnpm build</code> from a checkout to build the dashboard.</p>
</body></html>`;
}

export async function startServer(options: ServeOptions): Promise<RunningServer> {
  const app = createApp(options);
  const webRoot = options.webRoot ?? resolve(here, "../public");

  if (existsSync(webRoot)) {
    app.use("/*", serveStatic({ root: webRoot }));
    // The dashboard is a single-page app: any path it owns has to resolve to index.html.
    app.get("/*", serveStatic({ root: webRoot, path: "index.html" }));
  } else {
    app.get("/", (c) => c.html(placeholder()));
  }

  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4311;
  const server: ServerType = await new Promise((ready) => {
    const s = serve({ fetch: app.fetch, hostname: host, port }, () => {
      ready(s);
    });
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;
  const url = `http://${host}:${actualPort}`;
  options.log?.(`populace serve: ${url} (read-only; store ${options.storePath})`);
  return {
    url,
    app,
    close: () =>
      new Promise<void>((done, failed) => {
        server.close((err) => {
          if (err) failed(err);
          else done();
        });
      }),
  };
}

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { PRODUCT_INFO, TaskletApp, type Repairable } from "./app.js";
import { buildMcpServer } from "./mcp.js";

export interface MockTargetOptions {
  port?: number;
  host?: string;
  /** Mirror state to this JSON file so restarts keep accounts. */
  stateFile?: string;
  /** Planted defects to repair; see `REPAIRABLE`. Empty means the app ships broken, as intended. */
  repaired?: ReadonlySet<Repairable>;
  adminToken?: string;
  quiet?: boolean;
}

export interface RunningMockTarget {
  app: TaskletApp;
  url: string;
  mcpUrl: string;
  adminToken: string;
  close(): Promise<void>;
}

function landingPage(): string {
  const features = PRODUCT_INFO.features.map((f) => `<li>${f}</li>`).join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${PRODUCT_INFO.name}</title></head>
<body>
<h1>${PRODUCT_INFO.name}</h1>
<p><em>${PRODUCT_INFO.tagline}</em></p>
<p>${PRODUCT_INFO.description}</p>
<h2>Features</h2>
<ul>
${features}
</ul>
<h2>Plans</h2>
<p>Free: ${PRODUCT_INFO.plans[0]?.projects} projects. Pro: $6/month, unlimited projects.</p>
<h2>Developers</h2>
<p>Everything in Tasklet is available over MCP at <code>/mcp</code>. Sign up with the <code>sign_up</code> tool and use the returned token as a bearer token.</p>
</body></html>`;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer | string>) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function send(res: ServerResponse, status: number, body: string, type = "application/json"): void {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

export async function startMockTarget(options: MockTargetOptions = {}): Promise<RunningMockTarget> {
  const app = new TaskletApp(options.stateFile, options.repaired);
  const adminToken = options.adminToken ?? process.env.MOCK_TARGET_ADMIN_TOKEN ?? "admin";
  const host = options.host ?? "127.0.0.1";

  const server: Server = createServer((req, res) => {
    void handle(req, res).catch((err: Error) => {
      if (!res.headersSent) send(res, 500, JSON.stringify({ error: err.message }));
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/mcp") {
      // Stateless Streamable HTTP: one server + transport per request.
      const header = req.headers.authorization;
      const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;
      const auth: AuthInfo | undefined = token ? { token, clientId: "populace", scopes: [] } : undefined;
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      const mcp = buildMcpServer(app);
      await mcp.connect(transport);
      const bodyText = req.method === "POST" ? await readBody(req) : "";
      // eslint-disable-next-line no-restricted-syntax -- JSON-RPC body is validated by the MCP transport.
      const parsed: unknown = bodyText ? JSON.parse(bodyText) : undefined;
      res.on("close", () => {
        void transport.close();
        void mcp.close();
      });
      await transport.handleRequest(Object.assign(req, { auth }), res, parsed);
      return;
    }
    if (url.pathname === "/" && req.method === "GET") return send(res, 200, landingPage(), "text/html; charset=utf-8");
    if (url.pathname === "/health") return send(res, 200, JSON.stringify({ ok: true, name: PRODUCT_INFO.name }));
    if (url.pathname.startsWith("/admin/")) {
      if (req.headers["x-admin-token"] !== adminToken) return send(res, 401, JSON.stringify({ error: "admin token required" }));
      if (url.pathname === "/admin/users" && req.method === "GET") {
        const tag = url.searchParams.get("tag") ?? undefined;
        return send(res, 200, JSON.stringify({ users: app.listUsers(tag ? { emailContains: tag } : undefined) }));
      }
      const userMatch = /^\/admin\/users\/([^/]+)$/.exec(url.pathname);
      if (userMatch && req.method === "DELETE") {
        const deleted = app.adminDeleteUser(decodeURIComponent(userMatch[1] ?? ""));
        return send(res, deleted ? 200 : 404, JSON.stringify({ deleted }));
      }
      if (url.pathname === "/admin/reset" && req.method === "POST") {
        app.reset();
        return send(res, 200, JSON.stringify({ reset: true }));
      }
    }
    send(res, 404, JSON.stringify({ error: "not found" }));
  }

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, host, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : (options.port ?? 0);
  const url = `http://${host}:${port}`;
  if (!options.quiet) console.log(`[mock-target] ${PRODUCT_INFO.name} listening on ${url} (MCP at ${url}/mcp)`);

  return {
    app,
    url,
    mcpUrl: `${url}/mcp`,
    adminToken,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

import type { McpEndpoint, PopulaceConfig } from "@populace/core";
import type { TargetView } from "@populace/contract";
import { McpSession, type SignInProvider } from "@populace/runner";

/**
 * The configured target, plus its live tool list when it can be reached.
 *
 * Bearer tokens and custom headers are deliberately absent: a view of config reports that an
 * endpoint is authenticated, never with what (`DATA-MODEL.md` §4). A target that is down is a
 * normal state for a dashboard, so it is reported as a message rather than an error response.
 *
 * `signIn` is the user's own OAuth grant for an address, and this is one of the places ADR-0036
 * meant by "the things acting AS the user — the check and the tool list behind it". Every caller
 * here is showing a tool list to the operator: preflight, a run's coverage. None of them is a
 * wake, and a wake still cannot reach one of these — `runWake` builds its own sessions.
 *
 * It was missing, and the symptom was that signing in to a gated target got you through the
 * connect screen and then `Missing bearer token` on the simulation you set up with it.
 */
export async function targetView(
  config: PopulaceConfig,
  connect = true,
  signIn?: (endpoint: McpEndpoint) => SignInProvider | undefined,
): Promise<TargetView> {
  const target = config.target;
  const base: TargetView = {
    name: target.name,
    endpoints: target.mcp.map((e) => ({ name: e.name, url: e.url, authenticated: e.bearerToken !== undefined || Object.keys(e.headers).length > 0 })),
    webBaseUrl: target.webBaseUrl ?? null,
    description: target.description ?? null,
    identityStrategy: config.identity.strategy,
    tools: null,
    toolsError: null,
  };
  if (!connect) return base;

  const tools: TargetView["tools"] = [];
  const errors: string[] = [];
  for (const endpoint of target.mcp) {
    const session = new McpSession(endpoint, undefined, signIn?.(endpoint));
    try {
      await session.connect();
      for (const t of session.listTools()) tools.push({ name: t.name, description: t.description, endpoint: endpoint.name, destructive: t.destructive });
    } catch (err) {
      errors.push(`${endpoint.name}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await session.close();
    }
  }
  return { ...base, tools: errors.length === target.mcp.length ? null : tools, toolsError: errors.length ? errors.join("; ") : null };
}

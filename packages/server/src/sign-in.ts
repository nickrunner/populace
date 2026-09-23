import type { SignInStatus } from "@populace/contract";
import { normalizeEndpointUrl, type SignInGrant, type Store } from "@populace/core";
import { probeEndpoint, SignInProvider, type GrantStore, type SignInRequirement } from "@populace/runner";
import type { Context } from "hono";

/**
 * YOUR sign-in to a target's address (ADR-0036) — the server half: where the grant is kept, how
 * the callback URL is worked out, and what the browser is told.
 *
 * The flow is two requests with somebody else's login screen in between. `POST /sign-in` discovers,
 * registers this installation as an OAuth client if it has not already, and answers with a URL;
 * the browser goes there, consents, and the authorization server sends it back to
 * `GET /sign-in/callback`, which exchanges the code. Nothing here is a model call and nothing here
 * costs money.
 */

/**
 * A syntactically valid address. Everything below normalises the URL it is handed, and
 * normalising a string that is not a URL throws — so the routes check here first and answer with a
 * sentence instead of a 500.
 */
export function isAddress(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/** The store, as one address's grant. */
export function grantStoreFor(store: Store, projectId: string, url: string): GrantStore {
  const address = normalizeEndpointUrl(url);
  return {
    read: () => store.getSignInGrant(projectId, address),
    write: (grant) => store.saveSignInGrant(grant),
    clear: () => store.deleteSignInGrant(projectId, address),
  };
}

export function providerFor(store: Store, projectId: string, url: string, redirectUri: string): SignInProvider {
  return new SignInProvider({ projectId, url, redirectUri, store: grantStoreFor(store, projectId, url) });
}

/**
 * Where the authorization server sends the browser back to, taken from the request the browser
 * just made.
 *
 * `serve` picks its port at boot and can be reached on more than one name, so there is no single
 * right answer to bake in — but the two halves of one flow come from the same browser on the same
 * origin, so the origin it is using IS the answer. A registration made against a different one is
 * detected and redone rather than failing at the authorization server (`SignInProvider`).
 */
export function callbackUri(c: Context, callbackPath: string): string {
  return new URL(callbackPath, new URL(c.req.url).origin).href;
}

/** What is known about an address without connecting to it: the row, and nothing else. */
export function statusOf(url: string, grant: SignInGrant | undefined, probe?: SignInRequirement): SignInStatus {
  const tokens = grant?.tokens ?? null;
  return {
    url: normalizeEndpointUrl(url),
    required: probe?.required ?? tokens !== null,
    supported: probe?.supported ?? grant !== undefined,
    connected: tokens !== null,
    resourceName: probe?.resourceName ?? grant?.resourceName ?? null,
    authorizationServer: probe?.authorizationServer ?? grant?.authorizationServer ?? null,
    scopes: probe?.scopes ?? (grant?.scope ? grant.scope.split(" ").filter(Boolean) : []),
    expiresAt: tokens?.expiresAt ?? null,
    renewable: tokens?.refreshToken !== undefined,
    error: probe?.error ?? null,
  };
}

/**
 * The status of one address, asking the address itself when there is no grant to answer from.
 * Probing is read-only and registers nothing, which is what lets the check screen call it.
 */
export async function signInStatus(store: Store, projectId: string, url: string, options: { probe: boolean }): Promise<SignInStatus> {
  const grant = await store.getSignInGrant(projectId, url);
  if (!options.probe) return statusOf(url, grant);
  // What the endpoint says now wins over what the row remembers, except about the grant itself:
  // a resource that has stopped requiring a sign-in should stop asking for one on screen.
  return statusOf(url, grant, (await probeEndpoint(url)).signIn);
}

/**
 * The whole diagnosis, for the check screen: what is at the address AND what a sign-in to it would
 * look like, from one probe rather than two round trips at somebody else's server.
 */
export async function examine(store: Store, projectId: string, url: string): Promise<{ signIn: SignInStatus; reached: { kind: "nothing" | "not-mcp" | "gated" | "mcp"; says: string | null } }> {
  const grant = await store.getSignInGrant(projectId, url);
  const probe = await probeEndpoint(url);
  return { signIn: statusOf(url, grant, probe.signIn), reached: { kind: probe.reached, says: probe.says } };
}

/**
 * The page the browser lands on when it comes back from the authorization server. It is the last
 * thing the user sees of a flow they started in another tab, so it says which of the two things
 * happened in a sentence, and closes itself when the browser will allow it.
 */
export function callbackPage(outcome: { ok: true; resource: string | null } | { ok: false; message: string }): string {
  const heading = outcome.ok ? `Signed in${outcome.resource ? ` to ${escapeHtml(outcome.resource)}` : ""}.` : "That sign-in did not finish.";
  const detail = outcome.ok
    ? "You can close this tab and go back to populace."
    : `${escapeHtml(outcome.message)}<br>Nothing was saved. Go back to populace and try again.`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>populace</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 ui-serif, Georgia, serif; max-width: 34rem; margin: 6rem auto; padding: 0 1rem; }
  h1 { font-size: 1.4rem; font-weight: 600; margin: 0 0 .5rem; }
  p { margin: 0; opacity: .8; }
</style></head>
<body><h1>${heading}</h1><p>${detail}</p>
${outcome.ok ? '<script>setTimeout(() => { window.close(); }, 1200);</script>' : ""}
</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}

/**
 * The flow this callback belongs to, found by the `state` the authorization server echoed back.
 *
 * The callback is outside every project — it is one registered URL for the whole installation —
 * so `state` is the only thing linking it to a project and an address, which is exactly the job
 * OAuth's `state` is for. The scan is over a table with one row per address signed in to.
 */
export async function pendingFor(store: Store, state: string): Promise<SignInGrant | undefined> {
  const grants = await store.listSignInGrants();
  return grants.find((grant) => grant.pending?.state === state);
}

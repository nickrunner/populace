import { auth, extractWWWAuthenticateParams, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { normalizeEndpointUrl, type SignInGrant } from "@populace/core";
import { z } from "zod";

/**
 * RFC 9728 protected resource metadata, as much of it as a screen needs. Loose, because it is
 * somebody else's document and the fields we do not read are none of our business.
 */
const ProtectedResourceMetadataSchema = z
  .object({
    resource_name: z.string().optional(),
    authorization_servers: z.array(z.string()).optional(),
    scopes_supported: z.array(z.string()).optional(),
  })
  .loose();

/**
 * Signing in to a target that will not talk to strangers (ADR-0036).
 *
 * An MCP server may answer `401` with a `WWW-Authenticate` header naming where its OAuth metadata
 * lives, and the SDK ships the whole client: RFC 9728 discovery, RFC 7591 dynamic registration,
 * authorization code with PKCE, and refresh. What it does not ship is anywhere to keep the result
 * or anyone to open a browser, which is what this file is.
 *
 * **This is the user's sign-in and nobody else's.** A grant is one human's account, consented to at
 * a browser. The people a population sends are supposed to be strangers holding accounts of their
 * own — that is `identity` on the target, and it is a different mechanism on purpose. Nothing
 * under `runWake` constructs one of these: the callers are the ones acting AS the user, which is
 * the connection check and the tool list behind it. A grant that leaked into a wake would send
 * forty people to the target wearing the owner's face, and every finding they filed would be about
 * an account the product's real users do not have.
 */

/** Where a grant is read and written. The server backs this with the store; a test backs it with a variable. */
export interface GrantStore {
  read(): Promise<SignInGrant | undefined>;
  write(grant: SignInGrant): Promise<void>;
  /** Forget the registration entirely, so the next attempt registers a new client. */
  clear(): Promise<void>;
}

export interface SignInProviderOptions {
  projectId: string;
  /** The MCP endpoint being signed in to. */
  url: string;
  /** Where the authorization server sends the browser back to. Registered with the client. */
  redirectUri: string;
  store: GrantStore;
  /** Overridable so a test can be deterministic. */
  randomState?: () => string;
  now?: () => Date;
}

const CLIENT_NAME = "populace";

export class SignInProvider implements OAuthClientProvider {
  /**
   * Where the user has to go, once a flow has been started. There is no browser in this process —
   * `serve` hands this to the browser that asked, which is the one place a consent screen can
   * honestly appear.
   */
  authorizationUrl: URL | null = null;

  private grant: SignInGrant | undefined;
  private loaded = false;
  private chosenState: string | undefined;
  private readonly url: string;

  constructor(private readonly options: SignInProviderOptions) {
    this.url = normalizeEndpointUrl(options.url);
  }

  get redirectUrl(): string {
    return this.options.redirectUri;
  }

  /**
   * What populace registers itself as. `client_name` is what the consent screen shows the user, so
   * it says the product's name and not a package id — the screen is the one moment the user is
   * asked whether to trust this, and "populace" is the only answer that helps them decide.
   */
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: CLIENT_NAME,
      redirect_uris: [this.options.redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    };
  }

  /** The grant as it stands, for a caller that wants to report on it without connecting. */
  async load(): Promise<SignInGrant | undefined> {
    if (!this.loaded) {
      this.grant = await this.options.store.read();
      this.loaded = true;
    }
    return this.grant;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const grant = await this.load();
    if (!grant) return undefined;
    // A registration made for a different callback is not this process's registration. `serve`
    // takes whatever port it was given, so this is the ordinary case of opening the same store on
    // a different port — registering again is the repair, and pretending otherwise produces a
    // `redirect_uri` mismatch at the authorization server with nothing local to explain it.
    if (grant.redirectUri !== this.options.redirectUri) return undefined;
    return grant.clientSecret === undefined ? { client_id: grant.clientId } : { client_id: grant.clientId, client_secret: grant.clientSecret };
  }

  async saveClientInformation(information: OAuthClientInformationMixed): Promise<void> {
    const at = this.at().toISOString();
    const existing = await this.load();
    await this.put({
      projectId: this.options.projectId,
      url: this.url,
      resourceName: existing?.resourceName ?? null,
      authorizationServer: existing?.authorizationServer ?? null,
      redirectUri: this.options.redirectUri,
      clientId: information.client_id,
      ...(information.client_secret === undefined ? {} : { clientSecret: information.client_secret }),
      scope: existing?.scope ?? null,
      // A new registration invalidates whatever the old one was holding.
      tokens: null,
      pending: null,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const grant = await this.load();
    if (!grant?.tokens) return undefined;
    const held = grant.tokens;
    return {
      access_token: held.accessToken,
      token_type: held.tokenType,
      ...(held.refreshToken === undefined ? {} : { refresh_token: held.refreshToken }),
      ...(held.scope === null ? {} : { scope: held.scope }),
    };
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const grant = await this.required("saving what the authorization server sent back");
    // `expires_in` is a duration measured from now and the row is read days later, so it is
    // resolved to an instant here. A refresh that comes back WITHOUT a new refresh token keeps the
    // one we hold: the server is saying it is still good, and dropping it would end the sign-in
    // silently at the next expiry, which reads from every screen as the target going down.
    const refreshToken = tokens.refresh_token ?? grant.tokens?.refreshToken;
    await this.put({
      ...grant,
      tokens: {
        accessToken: tokens.access_token,
        tokenType: tokens.token_type,
        ...(refreshToken === undefined ? {} : { refreshToken }),
        expiresAt: tokens.expires_in === undefined ? null : new Date(this.at().getTime() + tokens.expires_in * 1000).toISOString(),
        scope: tokens.scope ?? grant.scope,
      },
      scope: tokens.scope ?? grant.scope,
      pending: null,
      updatedAt: this.at().toISOString(),
    });
  }

  /** One `state` per flow, remembered so `saveCodeVerifier` files the verifier under the same one. */
  state(): string {
    this.chosenState ??= (this.options.randomState ?? defaultState)();
    return this.chosenState;
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    const grant = await this.required("starting a sign-in");
    await this.put({ ...grant, pending: { state: this.state(), codeVerifier, startedAt: this.at().toISOString() }, updatedAt: this.at().toISOString() });
  }

  async codeVerifier(): Promise<string> {
    const grant = await this.load();
    if (!grant?.pending) throw new Error("this sign-in was not started here, or it has already been finished; start it again");
    return grant.pending.codeVerifier;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.authorizationUrl = authorizationUrl;
  }

  /**
   * The SDK calls this when the server rejects what we hold. Losing the tokens and keeping the
   * registration is the common repair — a consent that was revoked — while `all` and `client` mean
   * the authorization server has forgotten us, and the row goes so the next attempt registers
   * again from nothing.
   */
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    if (scope === "all" || scope === "client") {
      await this.options.store.clear();
      this.grant = undefined;
      this.loaded = true;
      return;
    }
    const grant = await this.load();
    if (!grant) return;
    if (scope === "tokens") await this.put({ ...grant, tokens: null, updatedAt: this.at().toISOString() });
    if (scope === "verifier") await this.put({ ...grant, pending: null, updatedAt: this.at().toISOString() });
  }

  private async required(what: string): Promise<SignInGrant> {
    const grant = await this.load();
    if (!grant) throw new Error(`no sign-in to this address is registered, so ${what} has nothing to write to`);
    return grant;
  }

  private async put(grant: SignInGrant): Promise<void> {
    this.grant = grant;
    this.loaded = true;
    await this.options.store.write(grant);
  }

  private at(): Date {
    return (this.options.now ?? ((): Date => new Date()))();
  }
}

function defaultState(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/** What a `401` from an MCP endpoint says about how to get in. */
export interface SignInRequirement {
  /** The endpoint asked for a bearer token. */
  required: boolean;
  /** RFC 9728 metadata named an authorization server, so populace can run the flow itself. */
  supported: boolean;
  /** What the resource calls itself, for the screen to name. */
  resourceName: string | null;
  authorizationServer: string | null;
  scopes: string[];
  /** What went wrong looking, when something did. */
  error: string | null;
}

const NOT_REQUIRED: SignInRequirement = { required: false, supported: false, resourceName: null, authorizationServer: null, scopes: [], error: null };
const GATED: SignInRequirement = { ...NOT_REQUIRED, required: true };

/**
 * Ask an endpoint, without credentials, whether it wants a sign-in and whether populace can run
 * one — read-only, and nothing is registered with anybody.
 *
 * The check screen calls this after a failed connection, so that "could not reach it" and "it will
 * not talk to strangers" stop being the same sentence. Registering a client is a write on somebody
 * else's authorization server, so that stays behind the sign-in button and never happens here.
 */
export async function probeSignIn(url: string): Promise<SignInRequirement> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      // A real initialize, because a server that authenticates before it parses answers this the
      // same way it answers the SDK, and one that parses first should not be sent a malformed frame.
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: CLIENT_NAME, version: "0.1.0" } } }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return { ...NOT_REQUIRED, error: err instanceof Error ? err.message : String(err) };
  }
  if (response.status !== 401 && response.status !== 403) return NOT_REQUIRED;

  const { resourceMetadataUrl, scope } = extractWWWAuthenticateParams(response);
  const scopes = scope ? scope.split(" ").filter(Boolean) : [];
  // The SDK's own discovery is deliberately not reused here: it throws on a shape it does not
  // like, and this is a probe whose whole job is to report rather than to fail. A resource that
  // publishes nothing is still gated — the screen says so, and says populace cannot do it for you.
  const metadataUrl = resourceMetadataUrl?.href ?? wellKnownFor(url);
  if (metadataUrl === null) return { ...GATED, scopes };
  let metadata: z.infer<typeof ProtectedResourceMetadataSchema>;
  try {
    const found = await fetch(metadataUrl, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!found.ok) return { ...GATED, scopes };
    const parsed = ProtectedResourceMetadataSchema.safeParse(await found.json());
    // A document that does not parse is a resource that published something we cannot use, which
    // is the same position as one that published nothing: gated, and not ours to sign in to.
    if (!parsed.success) return { ...GATED, scopes };
    metadata = parsed.data;
  } catch (err) {
    return { ...GATED, scopes, error: err instanceof Error ? err.message : String(err) };
  }
  const servers = metadata.authorization_servers ?? [];
  return {
    required: true,
    supported: servers.length > 0,
    resourceName: metadata.resource_name ?? null,
    authorizationServer: servers[0] ?? null,
    scopes: scopes.length > 0 ? scopes : (metadata.scopes_supported ?? []),
    error: null,
  };
}

/** RFC 9728's default location, for a server that gates without saying where its metadata is. */
function wellKnownFor(url: string): string | null {
  try {
    const endpoint = new URL(url);
    const path = endpoint.pathname === "/" ? "" : endpoint.pathname;
    return new URL(`/.well-known/oauth-protected-resource${path}`, endpoint.origin).href;
  } catch {
    return null;
  }
}

/**
 * Start a sign-in: discover, register if this is the first time, and produce the URL the user has
 * to visit. `null` means the grant already held was enough — a refresh that still works — and
 * there is nothing to send anybody to.
 */
export async function startSignIn(provider: SignInProvider, url: string): Promise<URL | null> {
  provider.authorizationUrl = null;
  const result = await auth(provider, { serverUrl: url });
  return result === "AUTHORIZED" ? null : provider.authorizationUrl;
}

/** Finish a sign-in: exchange the code the authorization server sent the browser back with. */
export async function finishSignIn(provider: SignInProvider, url: string, authorizationCode: string): Promise<void> {
  const result = await auth(provider, { serverUrl: url, authorizationCode });
  if (result !== "AUTHORIZED") throw new Error("the authorization server did not finish the sign-in");
}

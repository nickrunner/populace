import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  emailTagFor,
  JsonValueSchema,
  newIdentityId,
  type Credential,
  type FirebaseAdminConfig,
  type Identity,
  type IdentityProvider,
  type JsonValue,
  type ProvisionContext,
  type ProvisionResult,
  type TeardownDeps,
} from "@populace/core";
import { z } from "zod";

/** The slice of firebase-admin's Auth we use, so the SDK stays an optional peer and tests can inject a fake. */
export interface FirebaseAuthLike {
  createUser(properties: { email: string; password: string; displayName: string; emailVerified: boolean }): Promise<{ uid: string }>;
  setCustomUserClaims(uid: string, claims: Record<string, string>): Promise<void>;
  createCustomToken(uid: string, claims?: Record<string, string>): Promise<string>;
  listUsers(maxResults?: number, pageToken?: string): Promise<{ users: { uid: string; email?: string; displayName?: string; customClaims?: Record<string, string> }[]; pageToken?: string }>;
  deleteUser(uid: string): Promise<void>;
}

/** The slice of `fetch` the token endpoints need, so a test can hand in a fake and stay offline. */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<JsonValue>; text(): Promise<string> }>;

/** The default: the platform `fetch`, with the response body parsed at the boundary (ADR-0002). */
const platformFetch: FetchLike = async (url, init) => {
  const response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    // The body is JSON at an HTTP boundary, so it is parsed here; each caller then re-parses it
    // with the schema for the endpoint it called, because the two endpoints disagree on casing.
    json: async () => JsonValueSchema.parse(await response.json()),
    text: () => response.text(),
  };
};

const CLAIM = "populaceTag";

/** Exchange a custom token for a session: `POST …/accounts:signInWithCustomToken?key=…`, JSON in, camelCase out. */
const IDENTITY_TOOLKIT_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken";
/** Renew an ID token: `POST …/v1/token?key=…`, FORM-ENCODED in, snake_case out. The casing differs from the exchange. */
const SECURE_TOKEN_URL = "https://securetoken.googleapis.com/v1/token";

/**
 * Google answers the exchange in camelCase and the refresh in snake_case, so each response gets
 * its own schema. Parsing one with the other's casing yields `undefined` and then a literal
 * `Bearer undefined` on every call, which the target reports as an ordinary auth failure — the
 * two schemas exist so that mistake is a parse error here instead of a mystery there.
 */
const ExchangeResponseSchema = z.object({
  idToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  /** Seconds, as a STRING. */
  expiresIn: z.coerce.number().int().positive().optional(),
});

const RefreshResponseSchema = z.object({
  id_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.coerce.number().int().positive(),
});

/** A custom exchange endpoint is somebody else's route; take whichever of the two token spellings it uses. */
const CustomExchangeResponseSchema = z
  .object({
    idToken: z.string().min(1).optional(),
    token: z.string().min(1).optional(),
    refreshToken: z.string().min(1).optional(),
    expiresIn: z.coerce.number().int().positive().optional(),
  })
  .transform((body) => ({ idToken: body.idToken ?? body.token, refreshToken: body.refreshToken, expiresIn: body.expiresIn }));

/** What one exchange or renewal produced: the bearer, when it dies, and what mints the next one. */
interface Minted {
  bearerToken: string;
  expiresAt: string | null;
  refreshToken: string | null;
}

async function loadFirebaseAuth(config: FirebaseAdminConfig): Promise<FirebaseAuthLike> {
  // eslint-disable-next-line no-restricted-syntax -- optional peer dependency loaded dynamically; narrowed to the slice we use.
  let appModule: unknown;
  // eslint-disable-next-line no-restricted-syntax -- see above.
  let authModule: unknown;
  // Specifiers are variables so TypeScript does not require the optional package to be installed.
  const appSpecifier = "firebase-admin/app";
  const authSpecifier = "firebase-admin/auth";
  try {
    appModule = await import(appSpecifier);
    authModule = await import(authSpecifier);
  } catch {
    throw new Error("identity strategy admin-mint needs the optional dependency firebase-admin: pnpm add firebase-admin");
  }
  const app = appModule as { initializeApp(options?: object): object; cert(json: object): object; getApps(): object[] };
  const auth = authModule as { getAuth(app?: object): FirebaseAuthLike };
  if (app.getApps().length === 0) {
    const options: Record<string, object | string> = {};
    if (config.serviceAccountFile) {
      options.credential = app.cert(JSON.parse(readFileSync(config.serviceAccountFile, "utf8")) as object);
    }
    if (config.projectId) options.projectId = config.projectId;
    app.initializeApp(options);
  }
  return auth.getAuth();
}

/**
 * admin-mint via Firebase Admin: creates a user tagged with the run in its custom claims, mints a
 * custom token and exchanges it for the ID token the target accepts. `listByTag` reads the claim
 * back from Firebase, so leaked users are discoverable even when the store is gone.
 *
 * The exchange is not optional. `createCustomToken` returns a CUSTOM token, which is an
 * authentication *ticket*: every Firebase backend verifies ID tokens, and `verifyIdToken` rejects
 * a custom token. A provider that skipped the exchange would provision happily and then fail every
 * single tool call, so a configuration with nothing to exchange with is refused — loudly, at the
 * moment a session is minted, rather than at construction. The difference matters: `teardown` and
 * `listByTag` go through the service account alone and need no exchange at all, and the provider is
 * constructed eagerly by every CLI command and by `sweepRun`. Refusing in the constructor would
 * have made `populace sweep` throw on exactly the misconfiguration that leaves real users behind on
 * someone's Firebase project.
 */
export class FirebaseAdminProvider implements IdentityProvider {
  readonly strategy = "admin-mint" as const;
  private auth: FirebaseAuthLike | null;

  constructor(
    private readonly config: FirebaseAdminConfig,
    auth?: FirebaseAuthLike,
    private readonly fetchImpl: FetchLike = platformFetch,
  ) {
    this.auth = auth ?? null;
  }

  /**
   * Where a custom token is exchanged, or the loud refusal. Called from the two operations that
   * actually mint a session, never from the constructor — see the note on the class.
   */
  private exchangeTarget(): string {
    if (this.config.exchangeUrl !== undefined) return this.config.exchangeUrl;
    if (this.config.apiKey !== undefined) return `${IDENTITY_TOOLKIT_URL}?key=${encodeURIComponent(this.config.apiKey)}`;
    throw new Error(
      "identity strategy admin-mint cannot mint a usable session: a Firebase custom token is not an ID token, and any backend that calls verifyIdToken will reject it. " +
        "Set identity.apiKey to your Firebase Web API key (console → Project settings → General → Web API Key), or identity.exchangeUrl to an endpoint of your own that exchanges a custom token.",
    );
  }

  private async client(): Promise<FirebaseAuthLike> {
    this.auth ??= await loadFirebaseAuth(this.config);
    return this.auth;
  }

  /**
   * The local part is the PERSON's handle and the display name is the PERSON's name, exactly as
   * self-signup does it. `slugify(persona.id)-${ordinal + 1}` collided the moment two cohorts
   * shared a persona, and a collision here is fatal rather than cosmetic: Firebase `createUser`
   * throws `auth/email-already-exists`, so the second cohort could not provision at all. A persona
   * is a kind of person and has no name of its own, so every user would also have been called
   * "Sceptical evaluator".
   *
   * The handle is READ off the agent, not re-derived: it was minted once by `handleFor` when the
   * person row was written and frozen into the snapshot (SPEC §5.3.5).
   */
  async provision(ctx: ProvisionContext): Promise<ProvisionResult> {
    // Checked before `createUser`, so a misconfigured run refuses instead of leaving a Firebase
    // user behind that it could never mint a session for.
    this.exchangeTarget();
    const auth = await this.client();
    const email = `${ctx.agent.handle}+${emailTagFor(ctx.tag)}@${this.config.emailDomain}`;
    const password = `Pw-${createHash("sha256").update(`${ctx.tag}:${ctx.agent.id}`).digest("base64url").slice(0, 14)}`;
    const { uid } = await auth.createUser({ email, password, displayName: ctx.agent.name, emailVerified: true });
    await auth.setCustomUserClaims(uid, { [CLAIM]: ctx.tag });
    const minted = await this.mint(uid, ctx.tag);
    return {
      kind: "credential",
      credential: {
        bearerToken: minted.bearerToken,
        expiresAt: minted.expiresAt,
        redeemable: minted.refreshToken === null ? null : { kind: "refresh-token", secret: minted.refreshToken },
        userId: uid,
        email,
        displayName: ctx.agent.name,
        extra: {},
      },
    };
  }

  /**
   * Renews an expiring ID token.
   *
   * The path is chosen by where the credential was MINTED, not by what is configured. Google's
   * secure-token endpoint only knows refresh tokens Google issued: with both `apiKey` and
   * `exchangeUrl` set the bearer came from the user's own endpoint, and posting its refresh token
   * to Google answers `INVALID_REFRESH_TOKEN` — every person, every wake, from the first hour on.
   * So an `exchangeUrl` deployment always renews the way it provisioned, by minting a second custom
   * token and exchanging that; the cheap secure-token path is only for sessions Google itself made.
   *
   * A refresh token can also be revoked, disabled or expired outright. That is not the end of the
   * person: `createCustomToken` needs nothing from the old session, so a failed redemption falls
   * back to a re-mint and costs one vendor round-trip instead of the rest of the agent's visits.
   */
  async refresh(identity: Identity): Promise<Credential> {
    const { credential } = identity;
    const redeemable = credential.redeemable;
    const googleMinted = this.config.exchangeUrl === undefined && this.config.apiKey !== undefined;
    const minted =
      redeemable !== null && redeemable.kind === "refresh-token" && googleMinted
        ? await this.redeemOrRemint(redeemable.secret, identity)
        : await this.remint(identity);
    return {
      ...credential,
      bearerToken: minted.bearerToken,
      expiresAt: minted.expiresAt,
      redeemable: minted.refreshToken === null ? credential.redeemable : { kind: "refresh-token", secret: minted.refreshToken },
    };
  }

  /** A revoked or expired refresh token costs one round-trip, not the person's remaining visits. */
  private async redeemOrRemint(refreshToken: string, identity: Identity): Promise<Minted> {
    try {
      return await this.redeem(refreshToken);
    } catch (err) {
      if (identity.credential.userId === undefined) throw err;
      return this.remint(identity);
    }
  }

  private async remint(identity: Identity): Promise<Minted> {
    const uid = identity.credential.userId;
    if (uid === undefined) throw new Error(`identity ${identity.id} has no Firebase uid, so its session cannot be renewed`);
    return this.mint(uid, identity.tag);
  }

  private async mint(uid: string, tag: string): Promise<Minted> {
    const auth = await this.client();
    const customToken = await auth.createCustomToken(uid, { [CLAIM]: tag });
    return this.exchange(customToken);
  }

  /** `POST accounts:signInWithCustomToken` — JSON body, camelCase response. */
  private async exchange(customToken: string): Promise<Minted> {
    const custom = this.config.exchangeUrl !== undefined;
    const url = this.exchangeTarget();
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    });
    if (!response.ok) throw new Error(`custom token exchange failed: HTTP ${response.status} ${await this.detail(response)}`);
    const body = await response.json();
    const parsed = custom ? CustomExchangeResponseSchema.parse(body) : ExchangeResponseSchema.parse(body);
    if (parsed.idToken === undefined) throw new Error(`custom token exchange at ${url} returned no idToken`);
    return { bearerToken: parsed.idToken, expiresAt: expiryFrom(parsed.expiresIn), refreshToken: parsed.refreshToken ?? null };
  }

  /** `POST securetoken/v1/token` — FORM-ENCODED body, snake_case response. Neither matches the exchange above. */
  private async redeem(refreshToken: string): Promise<Minted> {
    // Only reached for a session Google minted, which is the branch that required `apiKey`.
    const apiKey = this.config.apiKey ?? "";
    const response = await this.fetchImpl(`${SECURE_TOKEN_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
    });
    if (!response.ok) throw new Error(`refreshing the ID token failed: HTTP ${response.status} ${await this.detail(response)}`);
    const parsed = RefreshResponseSchema.parse(await response.json());
    return { bearerToken: parsed.id_token, expiresAt: expiryFrom(parsed.expires_in), refreshToken: parsed.refresh_token };
  }

  /** Google puts the useful part of a failure in the body; a bare status code is not a diagnosis. */
  private async detail(response: { text(): Promise<string> }): Promise<string> {
    try {
      return (await response.text()).slice(0, 300);
    } catch {
      return "";
    }
  }

  async teardown(identity: Identity): Promise<void> {
    if (!identity.credential.userId) return;
    const auth = await this.client();
    try {
      await auth.deleteUser(identity.credential.userId);
    } catch (err) {
      if (!(err instanceof Error && /not.?found|no user/i.test(err.message))) throw err;
    }
  }

  async listByTag(tag: string, deps: TeardownDeps): Promise<Identity[]> {
    const auth = await this.client();
    const stored = await deps.listStoredIdentities(tag);
    const byUid = new Map(stored.map((i) => [i.credential.userId, i]));
    const out: Identity[] = [];
    let pageToken: string | undefined;
    do {
      const page = await auth.listUsers(1000, pageToken);
      for (const user of page.users) {
        if (user.customClaims?.[CLAIM] !== tag) continue;
        const known = byUid.get(user.uid);
        out.push(
          known ?? {
            id: newIdentityId(),
            runId: tag.replace(/^populace:/, ""),
            tag,
            agentId: "(unknown)",
            personaId: "(unknown)",
            strategy: "admin-mint",
            credential: { userId: user.uid, expiresAt: null, redeemable: null, ...(user.email ? { email: user.email } : {}), extra: {} },
            createdAt: new Date(0).toISOString(),
            tornDownAt: null,
          },
        );
      }
      pageToken = page.pageToken;
    } while (pageToken);
    return out;
  }
}

/** Google reports a lifetime in seconds; the store keeps the instant, so a later wake can compare. */
function expiryFrom(seconds: number | undefined): string | null {
  return seconds === undefined ? null : new Date(Date.now() + seconds * 1000).toISOString();
}

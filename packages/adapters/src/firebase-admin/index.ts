import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  newIdentityId,
  slugify,
  type FirebaseAdminConfig,
  type Identity,
  type IdentityProvider,
  type ProvisionContext,
  type ProvisionResult,
  type TeardownDeps,
} from "@populace/core";

/** The slice of firebase-admin's Auth we use, so the SDK stays an optional peer and tests can inject a fake. */
export interface FirebaseAuthLike {
  createUser(properties: { email: string; password: string; displayName: string; emailVerified: boolean }): Promise<{ uid: string }>;
  setCustomUserClaims(uid: string, claims: Record<string, string>): Promise<void>;
  createCustomToken(uid: string, claims?: Record<string, string>): Promise<string>;
  listUsers(maxResults?: number, pageToken?: string): Promise<{ users: { uid: string; email?: string; displayName?: string; customClaims?: Record<string, string> }[]; pageToken?: string }>;
  deleteUser(uid: string): Promise<void>;
}

const CLAIM = "populaceTag";

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
 * admin-mint via Firebase Admin: creates a user tagged with the run in its
 * custom claims and mints a custom token. `listByTag` reads the claim back from
 * Firebase, so leaked users are discoverable even when the store is gone.
 */
export class FirebaseAdminProvider implements IdentityProvider {
  readonly strategy = "admin-mint" as const;
  private auth: FirebaseAuthLike | null;

  constructor(
    private readonly config: FirebaseAdminConfig,
    auth?: FirebaseAuthLike,
  ) {
    this.auth = auth ?? null;
  }

  private async client(): Promise<FirebaseAuthLike> {
    this.auth ??= await loadFirebaseAuth(this.config);
    return this.auth;
  }

  async provision(ctx: ProvisionContext): Promise<ProvisionResult> {
    const auth = await this.client();
    const email = `${slugify(ctx.agent.persona.id)}-${ctx.agent.ordinal + 1}+${ctx.tag}@${this.config.emailDomain}`;
    const password = `Pw-${createHash("sha256").update(`${ctx.tag}:${ctx.agent.id}`).digest("base64url").slice(0, 14)}`;
    const { uid } = await auth.createUser({ email, password, displayName: ctx.agent.persona.name, emailVerified: true });
    await auth.setCustomUserClaims(uid, { [CLAIM]: ctx.tag });
    const customToken = await auth.createCustomToken(uid, { [CLAIM]: ctx.tag });
    const bearerToken = this.config.exchangeUrl ? await this.exchange(customToken) : customToken;
    return { kind: "credential", credential: { bearerToken, userId: uid, email, displayName: ctx.agent.persona.name, extra: { customToken } } };
  }

  private async exchange(customToken: string): Promise<string> {
    if (!this.config.exchangeUrl) return customToken;
    const response = await fetch(this.config.exchangeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    });
    if (!response.ok) throw new Error(`token exchange failed: HTTP ${response.status}`);
    const body = (await response.json()) as { idToken?: string; token?: string };
    const token = body.idToken ?? body.token;
    if (!token) throw new Error("token exchange returned no idToken");
    return token;
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
            credential: { bearerToken: "(leaked)", userId: user.uid, ...(user.email ? { email: user.email } : {}), extra: {} },
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

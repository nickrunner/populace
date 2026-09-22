import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { TdkError } from "../errors.js";
import { JsonValueSchema, type JsonValue } from "../json.js";
import type { CreatedPerson, ListedPerson, MaybePromise, PersonRequest, ProvisioningBackend, RefreshedPerson, RefreshRequest } from "./contract.js";

/**
 * Rung one of the ladder: a Firebase-backed product with no functions to write at all.
 *
 * ```ts
 * app.use("/populace", populaceProvisioning({ secret, backend: firebase({ serviceAccount, apiKey }) }));
 * ```
 *
 * It creates the user, tags it, exchanges the token, renews it and deletes it again. Rung two is
 * the same call with `afterCreate`, which is where a product whose API resolves callers against
 * its OWN database writes the row that makes a Firebase user a user of the product — the common
 * real case, and the reason a bare preset is not the end of the story.
 */

/** The slice of firebase-admin's Auth the preset uses, so the SDK stays an optional peer and a test can inject a fake. */
export interface FirebaseAuthLike {
  createUser(properties: { email: string; password: string; displayName: string; emailVerified: boolean }): Promise<{ uid: string }>;
  setCustomUserClaims(uid: string, claims: Record<string, string>): Promise<void>;
  createCustomToken(uid: string, claims?: Record<string, string>): Promise<string>;
  getUser(uid: string): Promise<{ uid: string; email?: string; displayName?: string; customClaims?: Record<string, string> }>;
  listUsers(maxResults?: number, pageToken?: string): Promise<{ users: { uid: string; email?: string; displayName?: string; customClaims?: Record<string, string> }[]; pageToken?: string }>;
  deleteUser(uid: string): Promise<void>;
}

/** The slice of `fetch` the token endpoints need, so a test can hand in a fake and stay offline. */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<JsonValue>; text(): Promise<string> }>;

export interface FirebasePerson {
  userId: string;
  email: string;
  displayName: string;
  /** The run this person belongs to. Stored as a custom claim, which is what makes the sweep work. */
  tag: string;
  handle: string;
}

export interface FirebaseOptions {
  /** A service account JSON path, or the parsed object. Omit to use `GOOGLE_APPLICATION_CREDENTIALS`. */
  serviceAccount?: string | Record<string, string>;
  projectId?: string;
  /**
   * The Firebase Web API key (console → Project settings → General → Web API Key).
   *
   * Not optional in practice, and the reason is the whole difficulty of this preset: see `mint`.
   */
  apiKey: string;
  /** Rung two. Runs before populace is told the person exists, so the account is usable the moment it is handed over. */
  afterCreate?(person: FirebasePerson): MaybePromise<void>;
  /** The other half of rung two: delete your own row here, while the uid still resolves to something. */
  beforeRemove?(person: { userId: string }): MaybePromise<void>;
  /** The custom claim the run tag is stored in. */
  tagClaim?: string;
  /** Injected by tests; the real ones are loaded and used by default. */
  auth?: FirebaseAuthLike;
  fetch?: FetchLike;
}

/** Exchange a custom token for a session: JSON in, camelCase out. */
const IDENTITY_TOOLKIT_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken";
/** Renew an ID token: FORM-ENCODED in, snake_case out. Neither half matches the exchange above. */
const SECURE_TOKEN_URL = "https://securetoken.googleapis.com/v1/token";

/**
 * Google answers the exchange in camelCase and the renewal in snake_case, so each gets its own
 * schema. Parsing one with the other's casing yields `undefined` and then a literal
 * `Bearer undefined` on every call, which the product reports as an ordinary auth failure — two
 * schemas make that mistake a parse error here instead of a mystery there.
 */
const ExchangeResponseSchema = z.object({
  idToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  /** Seconds, as a STRING. */
  expiresIn: z.coerce.number().int().positive().optional(),
});

const RenewResponseSchema = z.object({
  id_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.coerce.number().int().positive(),
});

const platformFetch: FetchLike = async (url, init) => {
  const response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    // JSON at an HTTP boundary, parsed here and re-parsed by the caller with the schema for the
    // endpoint it called, because the two endpoints disagree on casing (ADR-0002).
    json: async () => JsonValueSchema.parse(await response.json()),
    text: () => response.text(),
  };
};

/**
 * Loads firebase-admin, which is an OPTIONAL peer dependency: a Supabase or Clerk product installs
 * this kit and must not be made to carry a Google SDK it will never call. The specifiers are
 * variables so TypeScript does not require the package to be installed to compile.
 */
async function loadFirebaseAuth(options: FirebaseOptions): Promise<FirebaseAuthLike> {
  // eslint-disable-next-line no-restricted-syntax -- optional peer dependency loaded dynamically; narrowed to the slice we use.
  let appModule: unknown;
  // eslint-disable-next-line no-restricted-syntax -- see above.
  let authModule: unknown;
  const appSpecifier = "firebase-admin/app";
  const authSpecifier = "firebase-admin/auth";
  try {
    appModule = await import(appSpecifier);
    authModule = await import(authSpecifier);
  } catch {
    throw new TdkError("internal", "The Firebase preset needs the optional peer dependency firebase-admin, which is not installed here: npm install firebase-admin");
  }
  const app = appModule as { initializeApp(options?: object): object; cert(json: object): object; getApps(): object[] };
  const auth = authModule as { getAuth(app?: object): FirebaseAuthLike };
  if (app.getApps().length === 0) {
    const init: Record<string, object | string> = {};
    if (options.serviceAccount !== undefined) {
      // eslint-disable-next-line no-restricted-syntax -- a service account file is somebody else's JSON; firebase-admin validates it.
      const json: unknown = typeof options.serviceAccount === "string" ? JSON.parse(readFileSync(options.serviceAccount, "utf8")) : options.serviceAccount;
      init.credential = app.cert(json as object);
    }
    if (options.projectId !== undefined) init.projectId = options.projectId;
    app.initializeApp(init);
  }
  return auth.getAuth();
}

/**
 * firebase-admin attaches a stable `code` to everything it throws. The prose beside it is
 * localised, reworded between releases and occasionally absent; the code is neither, so it is what
 * this preset reads. A custom backend with nothing but prose falls back to the kit's own
 * heuristic, which is exactly what a heuristic of last resort is for.
 */
const VendorErrorSchema = z.object({ code: z.string().min(1) });

function vendorCode(err: Error): string {
  const parsed = VendorErrorSchema.safeParse(err);
  return parsed.success ? parsed.data.code : "";
}

const MISSING_USER = "auth/user-not-found";

/** A vendor error that means the account cannot be made, told apart from one that means it broke. */
function refusalFor(err: Error, email: string): Error {
  const code = vendorCode(err);
  if (code === "auth/email-already-exists" || code === "auth/uid-already-exists") {
    return new TdkError(
      "refused",
      `Firebase already has an account for ${email}. A previous run left it behind: sweep that run, or start this one under a different tag so the addresses do not collide.`,
    );
  }
  return err;
}

/** One exchange or renewal: the bearer, when it dies, and what mints the next one. */
interface Minted {
  bearerToken: string;
  expiresAt: string | null;
  refreshToken: string | null;
}

export function firebase(options: FirebaseOptions): ProvisioningBackend {
  const claim = options.tagClaim ?? "populaceTag";
  const call = options.fetch ?? platformFetch;
  let cached: FirebaseAuthLike | null = options.auth ?? null;

  const client = async (): Promise<FirebaseAuthLike> => {
    cached ??= await loadFirebaseAuth(options);
    return cached;
  };

  /**
   * The exchange is not an optional extra.
   *
   * `createCustomToken` returns a CUSTOM token, which is an authentication *ticket*: every
   * Firebase backend verifies ID tokens, and `verifyIdToken` rejects a custom token. A preset that
   * handed one over would provision happily and then fail every single tool call the population
   * made, with an auth error naming nothing. So the Web API key is checked HERE, at the mint, and
   * not when `firebase()` is called — `removePerson` and `listPeople` need only the service
   * account, and a deployment misconfigured this way must still be able to clean up after itself.
   */
  const mint = async (uid: string, tag: string): Promise<Minted> => {
    if (typeof options.apiKey !== "string" || options.apiKey.length === 0) {
      throw new TdkError(
        "refused",
        "The Firebase preset has no apiKey, so it can only mint a custom token — and a Firebase custom token is not an ID token, so anything calling verifyIdToken will reject it. Set apiKey to your Firebase Web API key (console → Project settings → General → Web API Key).",
      );
    }
    const auth = await client();
    const customToken = await auth.createCustomToken(uid, { [claim]: tag });
    const response = await call(`${IDENTITY_TOOLKIT_URL}?key=${encodeURIComponent(options.apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    });
    if (!response.ok) throw new TdkError("internal", `Firebase refused to exchange the custom token (HTTP ${response.status}): ${await detail(response)}`);
    const parsed = ExchangeResponseSchema.parse(await response.json());
    return { bearerToken: parsed.idToken, expiresAt: expiryFrom(parsed.expiresIn), refreshToken: parsed.refreshToken ?? null };
  };

  const renew = async (refreshToken: string): Promise<Minted> => {
    const response = await call(`${SECURE_TOKEN_URL}?key=${encodeURIComponent(options.apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
    });
    if (!response.ok) throw new TdkError("internal", `Firebase refused to renew the ID token (HTTP ${response.status}): ${await detail(response)}`);
    const parsed = RenewResponseSchema.parse(await response.json());
    return { bearerToken: parsed.id_token, expiresAt: expiryFrom(parsed.expires_in), refreshToken: parsed.refresh_token };
  };

  return {
    /**
     * The tag goes in a custom claim, which is what makes a sweep possible after the local store is
     * gone: `listPeople` reads it back out of Firebase itself.
     *
     * Everything after `createUser` is rolled back if it fails. A Firebase user that exists while
     * populace believes provisioning failed is an account nobody will ever come back for, which is
     * the exact mess this package is supposed to stop happening.
     */
    async createPerson(person: PersonRequest): Promise<CreatedPerson> {
      const auth = await client();
      // populace need not send a password — plenty of products have none — but a Firebase user
      // without one can only ever be signed in by an admin, so this preset always sets one.
      const password = person.password ?? randomBytes(18).toString("base64url");
      let uid: string;
      try {
        ({ uid } = await auth.createUser({ email: person.email, password, displayName: person.displayName, emailVerified: true }));
      } catch (err) {
        throw err instanceof Error ? refusalFor(err, person.email) : err;
      }
      try {
        await auth.setCustomUserClaims(uid, { [claim]: person.tag });
        await options.afterCreate?.({ userId: uid, email: person.email, displayName: person.displayName, tag: person.tag, handle: person.handle });
        const minted = await mint(uid, person.tag);
        return { userId: uid, ...minted };
      } catch (err) {
        throw await rollback(auth, uid, err instanceof Error ? err : null);
      }
    },

    /**
     * Renews from whichever half populace had.
     *
     * A refresh token can be revoked, disabled or expire outright, and that is not the end of the
     * person: `createCustomToken` needs nothing from the old session, so a failed renewal costs one
     * round-trip and mints a fresh one instead of costing the person every visit they had left.
     */
    async refreshPerson(request: RefreshRequest): Promise<RefreshedPerson> {
      if (request.refreshToken !== null) {
        try {
          return await renew(request.refreshToken);
        } catch {
          // Falls through to a fresh mint below.
        }
      }
      const tag = await tagOf(await client(), request.userId, claim);
      return await mint(request.userId, tag);
    },

    async removePerson({ userId }): Promise<void> {
      await options.beforeRemove?.({ userId });
      const auth = await client();
      try {
        await auth.deleteUser(userId);
      } catch (err) {
        // Idempotent: a sweep runs twice, and the second run finding nothing is the same success.
        if (!(err instanceof Error) || !isMissingUser(err)) throw err;
      }
    },

    async listPeople({ tag }): Promise<ListedPerson[]> {
      const auth = await client();
      const found: ListedPerson[] = [];
      let pageToken: string | undefined;
      do {
        const page = await auth.listUsers(1000, pageToken);
        for (const user of page.users) {
          if (user.customClaims?.[claim] !== tag) continue;
          found.push({ userId: user.uid, email: user.email ?? null, displayName: user.displayName ?? null, tag });
        }
        pageToken = page.pageToken;
      } while (pageToken !== undefined);
      return found;
    },
  };
}

/**
 * Undoes a half-made person, and says so when it cannot.
 *
 * A rollback that itself fails is worse news than the original failure, because now there IS an
 * account and nobody knows: the message has to name it, since the uid is the only thing the user
 * can search their Firebase console for.
 */
async function rollback(auth: FirebaseAuthLike, uid: string, cause: Error | null): Promise<Error> {
  const because = cause === null ? "Provisioning failed after the Firebase user was created" : cause.message;
  try {
    await auth.deleteUser(uid);
  } catch {
    return new TdkError("internal", `${because} — and the half-made Firebase user could not be removed either. Delete uid ${uid} by hand.`);
  }
  return cause instanceof TdkError ? cause : new TdkError("internal", because);
}

/**
 * The tag lives on the user, so a re-mint carries the claim the first mint set.
 *
 * Read back rather than remembered: nothing in this preset holds state between requests, because
 * the app it is mounted in may be three processes behind a load balancer and the person being
 * renewed was very likely made by a different one.
 */
async function tagOf(auth: FirebaseAuthLike, uid: string, claim: string): Promise<string> {
  try {
    const user = await auth.getUser(uid);
    return user.customClaims?.[claim] ?? "";
  } catch (err) {
    // A person who is not there any more cannot be renewed, and saying so as `gone` is what lets
    // populace provision a replacement instead of retrying a uid that will never come back.
    if (err instanceof Error && isMissingUser(err)) {
      throw new TdkError("gone", `Firebase has no account for ${uid} any more; it was deleted outside populace. A new person will have to be provisioned.`);
    }
    throw err;
  }
}

/** Keyed on the vendor's code, with the prose as a fallback for a fake or an older SDK. */
function isMissingUser(err: Error): boolean {
  return vendorCode(err) === MISSING_USER || /not.?found|no user/i.test(err.message);
}

/** Google puts the useful part of a failure in the body; a bare status code is not a diagnosis. */
async function detail(response: { text(): Promise<string> }): Promise<string> {
  try {
    return (await response.text()).slice(0, 200);
  } catch {
    return "";
  }
}

/** Google reports a lifetime in seconds; populace keeps the instant, so a later visit can compare. */
function expiryFrom(seconds: number | undefined): string | null {
  return seconds === undefined ? null : new Date(Date.now() + seconds * 1000).toISOString();
}

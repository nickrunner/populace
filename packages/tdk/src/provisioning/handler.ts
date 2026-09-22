import { z } from "zod";
import { messageOf, TdkError, type TdkErrorCode } from "../errors.js";
import { handshake, TDK_CONTRACT_VERSION } from "../handshake.js";
import { bearerOf, failure, json, noContent, normalizePath, page, secretMatches, type TdkHandler, type TdkRequest, type TdkResponse } from "../http.js";
import {
  CreatedPersonSchema,
  ListedPersonSchema,
  ListQuerySchema,
  PeopleListSchema,
  PersonRequestSchema,
  ProvisionedPersonSchema,
  RefreshedPersonSchema,
  RefreshRequestSchema,
  RefreshResponseSchema,
  RemoveRequestSchema,
  type ProvisioningBackend,
  type ProvisioningCapabilities,
} from "./contract.js";

export interface ProvisioningServerOptions {
  /**
   * The shared secret populace presents on every request, as `Authorization: Bearer …`.
   *
   * Dev-scoped, revocable and single-purpose: the whole point of the kit is that populace holds
   * THIS instead of your vendor's admin credentials. Rotate it by changing one environment
   * variable; the worst a leak can do is make and delete test accounts on a dev deployment.
   */
  secret: string;
  /** What to call where this is running. Defaults to `NODE_ENV`, then `development`. */
  environment?: string;
  /** Serve even when the environment is production. See the guard on `createProvisioningHandler`. */
  allowProduction?: boolean;
  /**
   * Turn a capability OFF that the app could otherwise do.
   *
   * It can only subtract. An app whose delete is a soft delete sets `teardown: false`, and
   * populace then tells the user their accounts must be removed by hand — which is exactly what it
   * already says for a self-signup target with no teardown tool. Turning something ON that has no
   * hook behind it would be a lie the kit is not able to keep, so it is ignored.
   */
  capabilities?: Partial<ProvisioningCapabilities>;
  /** Where this is mounted, for the `fetch` adapter. Express strips its own mount path already. */
  basePath?: string;
  /** Where the mount-time notices go. Defaults to `console.warn`. */
  log?: (message: string) => void;
}

/**
 * Either the app's own functions inline, or a preset in `backend`.
 *
 * A union and not an optional pair, so the compiler still insists on a `createPerson` in both
 * spellings — the two rungs of the ladder are the same mount, and neither of them should be able
 * to start without the one function that only the app can write.
 */
export type ProvisioningOptions = (ProvisioningServerOptions & ProvisioningBackend) | (ProvisioningServerOptions & { backend: ProvisioningBackend });

function backendOf(options: ProvisioningOptions): ProvisioningBackend {
  return "backend" in options ? options.backend : options;
}

/** Honest by construction: a capability is on only when there is a function behind it. */
function capabilitiesOf(backend: ProvisioningBackend, declared: Partial<ProvisioningCapabilities> | undefined): ProvisioningCapabilities {
  return {
    refresh: backend.refreshPerson !== undefined && declared?.refresh !== false,
    teardown: backend.removePerson !== undefined && declared?.teardown !== false,
    listByTag: backend.listPeople !== undefined && declared?.listByTag !== false,
  };
}

/** People per page. Large enough that an ordinary run is one request, small enough to be a page. */
const PAGE_SIZE = 100;

const CAPABILITY_WORDS: Record<keyof ProvisioningCapabilities, string> = {
  refresh: "renew an expiring bearer token",
  teardown: "delete the accounts it made",
  listByTag: "list the accounts it made, by run",
};

/**
 * Says out loud what has just been mounted, every time, in both directions.
 *
 * A test-user factory that nobody remembers mounting is the failure this package must not have,
 * so there is no quiet configuration: the production refusal announces itself and so does the
 * override that switches it off.
 */
function announce(log: (message: string) => void, environment: string, production: boolean, allowed: boolean, capabilities: ProvisioningCapabilities): void {
  const prefix = "[populace tdk]";
  if (production && !allowed) {
    log(
      `${prefix} mounted with environment=${environment} and will REFUSE every request. This route creates real accounts on your product; if that is genuinely what you want here, pass allowProduction: true.`,
    );
    return;
  }
  if (production) {
    log(`${prefix} mounted with environment=${environment} and allowProduction: true. Anyone holding the secret can create and delete accounts on this deployment.`);
  }
  const cannot = (Object.keys(CAPABILITY_WORDS) as (keyof ProvisioningCapabilities)[]).filter((key) => !capabilities[key]);
  const tail = cannot.length === 0 ? "" : ` It cannot ${cannot.map((key) => CAPABILITY_WORDS[key]).join(", or ")}.`;
  log(`${prefix} provisioning mounted (environment=${environment}). populace can create accounts here with the secret you configured.${tail}`);
}

/**
 * The provisioning routes, as a function of a request to a response.
 *
 * No framework, no port, no globals: the adapters in `mount.ts` are the only code that knows what
 * an HTTP library looks like, and every test in this package drives this function directly.
 *
 * **Dev-only unless told otherwise.** In production the handler answers `refused` to everything,
 * including the handshake, so that populace's own error message is the explanation rather than a
 * silence the user has to guess at.
 */
export function createProvisioningHandler(options: ProvisioningOptions): TdkHandler {
  const log = options.log ?? ((message: string) => console.warn(message));
  const secret = options.secret;
  // Typed `string`, and still checked: the value nearly always comes from an environment variable,
  // and `secret: process.env.POPULACE_SECRET` with the variable unset would otherwise mount an
  // account factory that anybody can call. Refusing to start beats starting with the door open.
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("[populace tdk] needs a secret: pass the same value populace is configured with (for example secret: process.env.POPULACE_SECRET). It was empty.");
  }
  if (secret.length < 16) {
    log(`[populace tdk] the secret is only ${secret.length} characters. It is the one thing guarding a route that creates accounts; 32 random characters cost nothing.`);
  }

  const backend = backendOf(options);
  if (typeof backend.createPerson !== "function") {
    throw new Error("[populace tdk] needs a createPerson: populace cannot know how your app makes a user, so that one function is the part only you can write.");
  }
  const capabilities = capabilitiesOf(backend, options.capabilities);
  const environment = options.environment ?? process.env.NODE_ENV ?? "development";
  const production = environment === "production";
  const allowed = options.allowProduction === true;
  announce(log, environment, production, allowed, capabilities);

  return async function handle(request: TdkRequest): Promise<TdkResponse> {
    // What the caller presented, so a credential that turns up inside somebody else's error
    // message can be blanked on the way out even when we never minted it.
    const secrets: (string | null | undefined)[] = [secret, bearerOf(request.headers)];

    if (!secretMatches(bearerOf(request.headers), secret)) {
      return failure(
        "unauthorized",
        "This is a populace target development kit. It expects the header `Authorization: Bearer <secret>`, carrying the same secret the app was mounted with and populace was configured with.",
        secrets,
      );
    }
    if (production && !allowed) {
      return failure(
        "refused",
        `This kit is mounted in ${environment} and refuses to serve there: it creates real accounts. Point populace at a development deployment, or mount it with allowProduction: true if this really is where the test accounts belong.`,
        secrets,
      );
    }

    const path = normalizePath(request.path);
    const method = request.method.toUpperCase();

    // The handshake answers whatever the version disagreement is, because the handshake is how a
    // version disagreement gets diagnosed. Refusing it on the strength of one would be circular.
    if (path === "/" && method === "GET") return json(200, handshake(environment, { ...capabilities }));

    const stale = versionRefusal(request.headers["x-populace-tdk-expects"], secrets);
    if (stale) return stale;

    if (path === "/people" && method === "POST") return provision(backend, request, secrets);
    if (path === "/people" && method === "GET") return list(backend, capabilities, request, secrets);
    if (path === "/people/refresh" && method === "POST") return refresh(backend, capabilities, request, secrets);
    if (path === "/people/remove" && method === "POST") return remove(backend, capabilities, request, secrets);

    return failure(
      "bad_request",
      `Nothing here answers ${method} ${path}. This kit serves GET / (handshake), POST /people, POST /people/refresh, POST /people/remove and GET /people?tag=…, all relative to where it is mounted.`,
      secrets,
    );
  };
}

/**
 * The other direction of the version question, and the reason it is a header.
 *
 * The handshake tells populace which contract this kit speaks. Nothing told the KIT which contract
 * populace speaks, so a newer populace sending a differently shaped body would be answered with a
 * zod path — a reader staring at `→ at people.0.locale` when the sentence they needed was "upgrade
 * the package". A kit already installed in somebody's server cannot be taught this later, which is
 * why it is here now rather than in version two.
 *
 * Optional on the wire: no header means the caller speaks this contract. A header that is not an
 * integer is no signal at all and is ignored rather than refused, because a mangled header from a
 * proxy is not a reason to stop making accounts.
 */
function versionRefusal(header: string | undefined, secrets: (string | null | undefined)[]): TdkResponse | null {
  if (header === undefined) return null;
  const expects = Number.parseInt(header.trim(), 10);
  if (!Number.isInteger(expects) || expects <= TDK_CONTRACT_VERSION) return null;
  return failure(
    "bad_request",
    `This populace speaks TDK contract ${expects}; this kit implements ${TDK_CONTRACT_VERSION}. Upgrade @populace/tdk in the app you are pointing it at.`,
    secrets,
  );
}

async function provision(backend: ProvisioningBackend, request: TdkRequest, secrets: (string | null | undefined)[]): Promise<TdkResponse> {
  const parsed = PersonRequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) return failure("bad_request", `populace asked for a person in a shape this kit does not recognise: ${z.prettifyError(parsed.error)}`, secrets);

  return await guarded(secrets, async () => {
    const created = await backend.createPerson(parsed.data);
    const person = validate("createPerson", CreatedPersonSchema, created);
    // Recorded before the response is built so that anything failing from here on — a serialiser,
    // a validation of our own output — cannot put this person's bearer in an error body.
    secrets.push(person.bearerToken, person.refreshToken);
    return json(201, ProvisionedPersonSchema.parse(person));
  });
}

async function refresh(backend: ProvisioningBackend, capabilities: ProvisioningCapabilities, request: TdkRequest, secrets: (string | null | undefined)[]): Promise<TdkResponse> {
  const refuse = unsupported(capabilities, "refresh", "renew a bearer token", "the kit it mounts implements no refreshPerson, so a session that expires part-way through a run cannot be renewed");
  if (refuse) return refuse;

  const parsed = RefreshRequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) return failure("bad_request", `populace asked to renew a session in a shape this kit does not recognise: ${z.prettifyError(parsed.error)}`, secrets);
  secrets.push(parsed.data.refreshToken);

  return await guarded(secrets, async () => {
    // Called through the backend rather than pulled off it: an app whose hooks are methods on a
    // class of their own would otherwise lose `this` on the way in.
    if (backend.refreshPerson === undefined) throw new TdkError("unsupported", "This kit cannot renew a bearer token.");
    const renewed = validate("refreshPerson", RefreshedPersonSchema, await backend.refreshPerson(parsed.data));
    secrets.push(renewed.bearerToken, renewed.refreshToken);
    return json(200, RefreshResponseSchema.parse(renewed));
  });
}

/**
 * `POST /people/remove` and not `DELETE /people/{userId}`.
 *
 * The id is the app's, not ours: a uuid from Supabase, `user_2ab…` from Clerk — and an email or a
 * URN from anything that keys users by one. Those do not survive a path reliably. Percent-encoding
 * round-trips differently through proxies, frameworks and routers, and the failure is silent and
 * looks like a person who was never there. The body has no such opinion about what an id is.
 */
async function remove(backend: ProvisioningBackend, capabilities: ProvisioningCapabilities, request: TdkRequest, secrets: (string | null | undefined)[]): Promise<TdkResponse> {
  const refuse = unsupported(capabilities, "teardown", "delete an account", "the accounts populace created here will have to be removed by hand, and populace will name them");
  if (refuse) return refuse;

  const parsed = RemoveRequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) return failure("bad_request", "Removing a person needs the id of the one to remove: POST /people/remove with {\"userId\": \"…\"}.", secrets);

  return await guarded(secrets, async () => {
    if (backend.removePerson === undefined) throw new TdkError("unsupported", "This kit cannot delete accounts.");
    try {
      await backend.removePerson(parsed.data);
    } catch (err) {
      // "That person is gone" is the outcome teardown wanted. An app whose vendor throws on a
      // missing user says so with `gone` and gets the same 204 as an app that swallowed it, which
      // is what keeps this route idempotent without every implementor writing the same catch.
      if (!(err instanceof TdkError) || err.code !== "gone") throw err;
    }
    // 204 whether or not it existed. A sweep runs more than once, and the second run finding
    // nothing is the same success as the first run finding something.
    return noContent();
  });
}

async function list(backend: ProvisioningBackend, capabilities: ProvisioningCapabilities, request: TdkRequest, secrets: (string | null | undefined)[]): Promise<TdkResponse> {
  const refuse = unsupported(capabilities, "listByTag", "list the accounts it made", "a sweep has to work from populace's own records instead, so do not delete its data directory before sweeping");
  if (refuse) return refuse;

  const parsed = ListQuerySchema.safeParse(request.query);
  if (!parsed.success) return failure("bad_request", "GET /people needs the run to list: /people?tag=run-….", secrets);
  const { tag, cursor } = parsed.data;

  return await guarded(secrets, async () => {
    if (backend.listPeople === undefined) throw new TdkError("unsupported", "This kit cannot list accounts.");
    const all = (await backend.listPeople({ tag })).map((person) => {
      const parsedPerson = validate("listPeople", ListedPersonSchema, person);
      return { ...parsedPerson, tag: parsedPerson.tag ?? tag };
    });
    // Paged here rather than by the app: what must not be unbounded is the response crossing
    // somebody else's network, and asking every implementor to grow a cursor to satisfy that would
    // put the kit's own problem back in their hands.
    const { items, nextCursor } = page(all, cursor, PAGE_SIZE);
    return json(200, PeopleListSchema.parse({ people: items, nextCursor }));
  });
}

/**
 * The answer to a capability the handshake already said `false` to.
 *
 * `unsupported` and not a crash: populace asked a fair question and the honest answer is "this
 * target cannot", which it already knows how to report to a reader. The second sentence says what
 * follows for them, because "unsupported" on its own leaves them to work that out themselves.
 */
function unsupported(capabilities: ProvisioningCapabilities, capability: keyof ProvisioningCapabilities, what: string, consequence: string): TdkResponse | null {
  if (capabilities[capability]) return null;
  return failure("unsupported", `This target cannot ${what}: ${consequence}.`);
}

/** An app's hook is somebody else's code; whatever it throws becomes an error a human can read. */
async function guarded(secrets: (string | null | undefined)[], run: () => Promise<TdkResponse>): Promise<TdkResponse> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof TdkError) return failure(err.code, err.message, secrets);
    if (err instanceof Error) return failure(internalOr(err), messageOf(err), secrets);
    return failure("internal", "The app's own hook threw something that was not an error, so there is nothing to report but that it failed.", secrets);
  }
}

/**
 * A vendor's "that email is taken" is the app refusing, not the app breaking.
 *
 * The distinction is worth having: populace shows a `refused` as something the user can act on and
 * an `internal` as something that went wrong, and a run colliding with accounts a previous run
 * left behind is the single most common way this route fails.
 *
 * **A heuristic of last resort.** It reads vendor prose, which is the wrong thing to read whenever
 * there is anything better — the Firebase preset branches on `auth/email-already-exists` and
 * throws the right `TdkError` itself, and any backend that knows its vendor's codes should do the
 * same. This is for the ones that hand out nothing but a sentence.
 */
function internalOr(err: Error): TdkErrorCode {
  return /already[- ]?exists|already in use|duplicate|taken/i.test(err.message) ? "refused" : "internal";
}

/**
 * A hook's return value crossing back into the kit, parsed so the mistake is named where it was
 * made. Typed by the schema's own INPUT type rather than by `unknown`, so an implementor writing
 * TypeScript hears about a misspelled field from the compiler and only an implementor writing
 * JavaScript has to hear about it from this parse (ADR-0001, ADR-0002).
 */
function validate<Out, In>(hook: string, schema: z.ZodType<Out, In>, value: In): Out {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new TdkError("internal", `${hook} returned something this kit cannot use: ${z.prettifyError(parsed.error)}`);
}

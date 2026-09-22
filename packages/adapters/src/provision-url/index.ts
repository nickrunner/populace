import {
  newIdentityId,
  runIdFromTag,
  slugify,
  type Credential,
  type Identity,
  type IdentityProvider,
  type ProvisionContext,
  type ProvisionResult,
  type ProvisionUrlConfig,
  type TeardownDeps,
} from "@populace/core";
import { z } from "zod";

/**
 * The app makes its own people (ADR-0037): the populace half of the wire `@populace/tdk` serves.
 *
 * Everything here is one HTTP call to an endpoint the target owns, authenticated by one shared
 * secret. populace holds no vendor credential at all — which is the point, and is why this is the
 * strategy to reach for on any product whose accounts are not made through an MCP tool.
 *
 * The kit is deliberately tolerant of a populace older than itself, so every field this sends is
 * one the kit has always understood. The one place that tolerance could hide a bug is the sweep,
 * and it is handled: `listByTag` follows `nextCursor` to the end rather than taking page one and
 * believing it, because a sweep that stops at a hundred reports success while leaving the rest of
 * a large run's accounts on somebody's product.
 */

/** The contract version this populace speaks. The kit refuses, in words, when it is older. */
const CONTRACT_VERSION = 1;

/** A page at a time, and every page: the wire is paged so an unbounded answer never crosses it. */
const MAX_PAGES = 1000;

const CapabilitiesSchema = z.object({ refresh: z.boolean(), teardown: z.boolean(), listByTag: z.boolean() });

const HandshakeSchema = z.object({
  tdk: z.number().int().positive(),
  environment: z.string().optional(),
  capabilities: CapabilitiesSchema,
});
export type TdkHandshake = z.infer<typeof HandshakeSchema>;

const ProvisionedSchema = z.object({
  userId: z.string().min(1),
  bearerToken: z.string().min(1),
  expiresAt: z.string().nullable(),
  refreshToken: z.string().nullable(),
});

const RefreshedSchema = z.object({
  bearerToken: z.string().min(1),
  expiresAt: z.string().nullable(),
  refreshToken: z.string().nullable(),
});

const ListedSchema = z.object({
  people: z.array(
    z.object({
      userId: z.string().min(1),
      email: z.string().nullable(),
      displayName: z.string().nullable(),
      tag: z.string().min(1),
    }),
  ),
  nextCursor: z.string().nullable(),
});

/** What the kit says when it refuses. `code` is what decides whether a caller can do anything. */
const RefusalSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** The slice of `fetch` this needs, so a test can hand in the kit's own handler and stay offline. */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/**
 * A refusal the kit named, carried with its code so a caller can tell the four apart: `gone` means
 * make a new person, `unsupported` means never ask again, `refused` means change something first,
 * and anything else is the app's own failure.
 */
export class TdkRefusal extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TdkRefusal";
  }
}

export class ProvisionUrlProvider implements IdentityProvider {
  readonly strategy = "provision-url" as const;

  private capabilities: z.infer<typeof CapabilitiesSchema> | undefined;

  constructor(
    private readonly config: ProvisionUrlConfig,
    private readonly fetchImpl: FetchLike = defaultFetch,
  ) {}

  /**
   * Why this provider cannot clean up, when it cannot — read from the target's own handshake
   * rather than assumed. An app that soft-deletes says `teardown: false` and a sweep then reports
   * the accounts it left behind instead of counting a no-op as a removal.
   */
  get cannotRemove(): string | undefined {
    return this.capabilities !== undefined && !this.capabilities.teardown
      ? "the target's provisioning endpoint says it cannot delete accounts, so the ones this run created are still on it"
      : undefined;
  }

  /**
   * The handshake, cached for the process. It is what tells a misconfigured run apart from a
   * misbehaving one before any person is made: a wrong address answers nothing, a wrong secret
   * answers `unauthorized`, and a kit older than this populace says so in a sentence.
   */
  async describe(): Promise<TdkHandshake> {
    const body = await this.call("GET", "", undefined);
    const handshake = HandshakeSchema.parse(body);
    this.capabilities = handshake.capabilities;
    return handshake;
  }

  async provision(ctx: ProvisionContext): Promise<ProvisionResult> {
    const email = `${ctx.agent.handle}+${emailTag(ctx.tag)}@${this.config.emailDomain}`;
    const body = await this.call("POST", "/people", {
      tag: ctx.tag,
      handle: ctx.agent.handle,
      email,
      displayName: ctx.agent.name,
      // Sent for the apps that have passwords; the kit's own contract marks it optional, and a
      // passwordless target ignores it.
      password: passwordFor(ctx),
    });
    const person = ProvisionedSchema.parse(body);
    return {
      kind: "credential",
      credential: {
        bearerToken: person.bearerToken,
        expiresAt: person.expiresAt,
        redeemable: person.refreshToken === null ? null : { kind: "refresh-token", secret: person.refreshToken },
        userId: person.userId,
        email,
        displayName: ctx.agent.name,
        extra: {},
      },
    };
  }

  /**
   * Renew, sending both halves every time. Which one the app uses is the app's business: some
   * vendors re-mint from the user id alone and others can only redeem a refresh token, and the
   * kit's contract says so rather than making populace guess which kind of product this is.
   */
  async refresh(identity: Identity): Promise<Credential> {
    const { credential } = identity;
    const userId = credential.userId;
    if (userId === undefined) throw new Error(`identity ${identity.id} has no user id, so the target cannot be asked to renew it`);
    const redeemable = credential.redeemable;
    const body = await this.call("POST", "/people/refresh", {
      userId,
      refreshToken: redeemable !== null && redeemable.kind === "refresh-token" ? redeemable.secret : null,
    });
    const renewed = RefreshedSchema.parse(body);
    return {
      ...credential,
      bearerToken: renewed.bearerToken,
      expiresAt: renewed.expiresAt,
      redeemable: renewed.refreshToken === null ? credential.redeemable : { kind: "refresh-token", secret: renewed.refreshToken },
    };
  }

  /**
   * Remove the account. The route is idempotent by contract, so a second sweep is a success and
   * not a failure — and a person who was never provisioned has nothing to remove.
   */
  async teardown(identity: Identity): Promise<void> {
    const userId = identity.credential.userId;
    if (userId === undefined) return;
    await this.call("POST", "/people/remove", { userId });
  }

  /**
   * Every account the target knows carrying this run's tag, to the last page.
   *
   * This is the way home for a sweep whose local rows are gone, so stopping at the first page
   * would be the worst kind of bug: it would report a clean sweep while leaving everyone past the
   * hundredth on somebody's product. The kit's cursor is opaque and is passed back untouched.
   */
  async listByTag(tag: string, deps: TeardownDeps): Promise<Identity[]> {
    const stored = await deps.listStoredIdentities(tag);
    const known = new Map(stored.map((identity) => [identity.credential.userId, identity]));
    const out: Identity[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = `?tag=${encodeURIComponent(tag)}${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
      const listed: z.infer<typeof ListedSchema> = ListedSchema.parse(await this.call("GET", `/people${query}`, undefined));
      for (const person of listed.people) {
        const seen = known.get(person.userId);
        out.push(seen ?? this.strangerFrom(person, tag));
      }
      cursor = listed.nextCursor;
      if (cursor === null) return out;
    }
    throw new Error(`the target's provisioning endpoint is still paging accounts for ${tag} after ${MAX_PAGES} pages; it may be handing back a cursor that never ends`);
  }

  /**
   * An account the target knows about and this store does not — a run whose rows were deleted, or
   * one swept from another machine. It is reported so a human can see it, with the fields nobody
   * can recover marked as unknown rather than invented.
   */
  private strangerFrom(person: { userId: string; email: string | null; displayName: string | null }, tag: string): Identity {
    return {
      id: newIdentityId(),
      runId: tag.replace(/^populace:/, ""),
      tag,
      agentId: "(unknown)",
      personaId: "(unknown)",
      strategy: "provision-url",
      credential: {
        userId: person.userId,
        expiresAt: null,
        redeemable: null,
        ...(person.email === null ? {} : { email: person.email }),
        ...(person.displayName === null ? {} : { displayName: person.displayName }),
        extra: {},
      },
      createdAt: new Date(0).toISOString(),
      tornDownAt: null,
    };
  }

  /**
   * One call to the kit. Every failure comes back as a sentence the kit itself wrote, because the
   * kit is where the app's own words are — a bare `HTTP 403` tells a reader nothing they can act
   * on, and this endpoint was built to be readable.
   */
  // eslint-disable-next-line no-restricted-syntax -- HTTP boundary: every caller parses what this returns with its own schema, on the line after the call.
  private async call(method: "GET" | "POST", path: string, body: object | undefined): Promise<unknown> {
    if (this.config.secret === undefined) {
      throw new Error("this target's provisioning endpoint has no secret set, so populace cannot ask it for anybody; set it on the target");
    }
    const url = `${this.config.url.replace(/\/$/, "")}${path}`;
    let response: { ok: boolean; status: number; text(): Promise<string> };
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${this.config.secret}`,
          "content-type": "application/json",
          // What this populace speaks. A kit older than the contract answers with a sentence
          // naming the upgrade instead of a schema error about a field it has never heard of.
          "x-populace-tdk-expects": String(CONTRACT_VERSION),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (err) {
      throw new Error(`the target's provisioning endpoint at ${url} could not be reached: ${err instanceof Error ? err.message : String(err)}`);
    }
    const text = await response.text();
    if (!response.ok) throw this.refusalFrom(response.status, text, url);
    if (text.trim() === "") return {};
    try {
      // eslint-disable-next-line no-restricted-syntax -- HTTP boundary: every caller parses this with its own schema on the next line.
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`the target's provisioning endpoint at ${url} answered with something that is not JSON: ${text.slice(0, 200)}`);
    }
  }

  private refusalFrom(status: number, text: string, url: string): Error {
    let parsed: z.infer<typeof RefusalSchema> | undefined;
    try {
      // eslint-disable-next-line no-restricted-syntax -- HTTP boundary: narrowed by RefusalSchema on the next line.
      const candidate = RefusalSchema.safeParse(JSON.parse(text) as unknown);
      if (candidate.success) parsed = candidate.data;
    } catch {
      /* a refusal that is not the kit's own shape; the status and the body are all there is */
    }
    if (parsed) return new TdkRefusal(parsed.error.code, parsed.error.message, status);
    return new TdkRefusal("unknown", `the target's provisioning endpoint at ${url} refused with HTTP ${status}: ${text.slice(0, 200)}`, status);
  }
}

/**
 * The run, as an email local part can carry it.
 *
 * A tag is `populace:run_x_y` and a colon is not legal in an unquoted local part (RFC 5321), so
 * the raw tag makes an address that a strict validator refuses — `@populace/tdk` does, which is
 * how this was found. The run id alone is legal, stable and recoverable: prefix it with
 * `populace:` to get the tag back.
 *
 * The email is only ever the FALLBACK copy, for an app with nowhere else to keep the tag. The
 * authoritative one goes in the request body and is untouched.
 */
function emailTag(tag: string): string {
  return runIdFromTag(tag) ?? slugify(tag);
}

/**
 * Deterministic per person and per run, so a re-provision of the same person is the same password
 * rather than a second account nobody can log into. Derived, not stored: it is the app's to keep
 * if the app has passwords at all.
 */
function passwordFor(ctx: ProvisionContext): string {
  const seed = `${ctx.tag}:${ctx.agent.id}`;
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return `Pw-${Math.abs(hash).toString(36)}-${ctx.agent.handle}`;
}

const defaultFetch: FetchLike = async (url, init) => {
  const response = await fetch(url, { method: init.method, headers: init.headers, ...(init.body === undefined ? {} : { body: init.body }), signal: AbortSignal.timeout(30_000) });
  return { ok: response.ok, status: response.status, text: () => response.text() };
};

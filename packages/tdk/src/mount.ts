import { JsonValueSchema, type JsonValue } from "./json.js";
import { errorBody } from "./errors.js";
import { normalizePath, type TdkHandler, type TdkRequest, type TdkResponse } from "./http.js";

/**
 * The thin bit. Everything above this file is a function from a request to a response; this is the
 * only place that knows what an HTTP library looks like, and there are two of them because the
 * world has settled on two shapes: Node's `(req, res)` and the platform's `Request → Response`.
 */

/** As much of an Express request as the kit reads — which a bare Node `IncomingMessage` also is. */
export interface ExpressRequestLike {
  method?: string | undefined;
  /** Mount-relative when Express matched a mount path, absolute otherwise. `basePath` covers the second case. */
  url?: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  /** Present when a body parser ran first. Absent is fine: the stream is read instead. */
  body?: ExpressBody;
  [Symbol.asyncIterator]?: () => AsyncIterator<Buffer | string>;
}

/** Whatever a body parser left behind: a parsed object, a Buffer, a string, or nothing. */
// eslint-disable-next-line no-restricted-syntax -- HTTP boundary: parsed with `JsonValueSchema` in `bodyOf` below (ADR-0002).
type ExpressBody = unknown;

export interface ExpressResponseLike {
  statusCode: number;
  /** Present on a real response; the guard below is what stops a late failure writing twice. */
  headersSent?: boolean;
  setHeader(name: string, value: string): void;
  end(chunk?: string): void;
}

export type ExpressMiddleware = (req: ExpressRequestLike, res: ExpressResponseLike) => void;

/**
 * What a mount returns: an Express middleware you can hand straight to `app.use`, carrying the
 * other two shapes on it.
 *
 * One value and not three exports because the reader wiring this into their app should not have to
 * pick a spelling before they know which one their framework wants. `app.use("/populace", kit)`,
 * `export const POST = kit.fetch`, and `kit.handle(request)` in a test are the same mount.
 */
export type Mounted = ExpressMiddleware & {
  /** For Next route handlers, Hono, Cloudflare Workers, Deno and Bun. */
  fetch(request: Request): Promise<Response>;
  /** The framework-free core, for tests and for anything shaped like neither of the above. */
  handle: TdkHandler;
};

export interface MountOptions {
  /**
   * Where this is mounted, when the path the adapter sees still carries it — a `fetch` handler is
   * always given the whole pathname, and Express only strips a mount path it matched itself.
   */
  basePath?: string;
  /**
   * The first segment of every route this mount serves (`people`).
   *
   * Used only when there is no `basePath`, to find the contract's own path inside a longer one:
   * a Next route at `app/api/populace/[...tdk]/route.ts` hands over `/api/populace/people` and
   * nothing in the request says which part of that was the mount. Configuring `basePath` is the
   * exact answer and this is the good guess for everybody who did not.
   */
  knownSegments?: readonly string[];
}

/**
 * Strips a mount point the kit was told about. What Express has already done for itself.
 *
 * A configured `basePath` that does not match is left alone rather than guessed at: the request
 * then falls through to "nothing here answers that", which names the routes and is a far better
 * thing to read than a handshake served from the wrong place.
 */
export function relativize(pathname: string, options: MountOptions = {}): string {
  const path = normalizePath(pathname);
  if (options.basePath === undefined) return path;
  const base = normalizePath(options.basePath);
  if (base === "/") return path;
  if (path === base) return "/";
  return path.startsWith(`${base}/`) ? path.slice(base.length) : path;
}

/**
 * The same, for an adapter that is handed the WHOLE pathname and no mount point.
 *
 * A `fetch` handler never learns where it was mounted — a Next route at
 * `app/api/populace/[...tdk]/route.ts` is given `/api/populace/people` and nothing in the request
 * says which part of that was the mount — so with no `basePath` the kit finds its own route by its
 * own segments, and treats everything else as the mount root. That last part is a guess, and the
 * reason `basePath` exists: with it, a path that is not a route is named as one.
 */
export function locate(pathname: string, options: MountOptions = {}): string {
  if (options.basePath !== undefined) return relativize(pathname, options);
  const path = normalizePath(pathname);
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const known = options.knownSegments ?? [];
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (segment !== undefined && known.includes(segment)) return `/${segments.slice(i).join("/")}`;
  }
  return "/";
}

function headersOf(headers: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return out;
}

/** A body that is not JSON at all is no body: the route's own schema then says what was expected. */
function parseJson(text: string): JsonValue | undefined {
  if (text.trim().length === 0) return undefined;
  try {
    // eslint-disable-next-line no-restricted-syntax -- HTTP boundary: handed straight to the schema on the next line.
    const raw: unknown = JSON.parse(text);
    const parsed = JsonValueSchema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function bodyOf(req: ExpressRequestLike): Promise<JsonValue | undefined> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "string") return parseJson(req.body);
    if (Buffer.isBuffer(req.body)) return parseJson(req.body.toString("utf8"));
    const parsed = JsonValueSchema.safeParse(req.body);
    return parsed.success ? parsed.data : undefined;
  }
  if (req[Symbol.asyncIterator] === undefined) return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer | string>) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return parseJson(Buffer.concat(chunks).toString("utf8"));
}

function send(res: ExpressResponseLike, response: TdkResponse): void {
  res.statusCode = response.status;
  for (const [name, value] of Object.entries(response.headers)) res.setHeader(name, value);
  res.end(response.body === undefined ? undefined : JSON.stringify(response.body));
}

/** The last net. A handler that threw has already failed the request; it must not also fail the app. */
const CRASHED = errorBody("internal", "The populace kit itself failed while answering. Check the app's logs: whatever went wrong is there and is not shown here, because an unexpected failure is the one place a credential could end up in a message.", []);

export function mount(handle: TdkHandler, options: MountOptions = {}): Mounted {
  const middleware: ExpressMiddleware = (req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://mount.invalid");
      const request: TdkRequest = {
        method: req.method ?? "GET",
        path: relativize(url.pathname, options),
        query: Object.fromEntries(url.searchParams),
        headers: headersOf(req.headers),
        body: await bodyOf(req),
      };
      send(res, await handle(request));
    })().catch(() => {
      if (res.headersSent === true) return;
      send(res, { status: 500, headers: { "content-type": "application/json" }, body: CRASHED });
    });
  };

  return Object.assign(middleware, {
    handle,
    fetch: async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      const headers: Record<string, string | undefined> = {};
      for (const [name, value] of request.headers.entries()) headers[name.toLowerCase()] = value;
      let body: JsonValue | undefined;
      try {
        const text = await request.text();
        body = parseJson(text);
      } catch {
        body = undefined;
      }
      const response = await handle({
        method: request.method,
        path: locate(url.pathname, options),
        query: Object.fromEntries(url.searchParams),
        headers,
        ...(body === undefined ? {} : { body }),
      });
      return new Response(response.body === undefined ? null : JSON.stringify(response.body), { status: response.status, headers: response.headers });
    },
  });
}

import { createHash, timingSafeEqual } from "node:crypto";
import { errorBody, statusFor, type TdkErrorCode } from "./errors.js";
import type { JsonValue } from "./json.js";

/**
 * One request, reduced to what the kit reads.
 *
 * The core is a function from this to `TdkResponse` and touches no framework at all, so every
 * route is testable without binding a port — and so Express, a Next route handler, Hono, Deno and
 * a Cloudflare Worker are thin adapters over one implementation rather than five of them.
 */
export interface TdkRequest {
  method: string;
  /** Mount-relative: `/people`, not `/populace/people`. The adapters do the stripping. */
  path: string;
  query: Record<string, string>;
  /** Keys lowercased by the adapter, because Node lowercases and `fetch` does not. */
  headers: Record<string, string | undefined>;
  /** The parsed JSON body, or undefined when there was none. */
  body?: JsonValue;
}

export interface TdkResponse {
  status: number;
  headers: Record<string, string>;
  /** Absent for `204`, which is the only answer in this contract with no body. */
  body?: JsonValue;
}

export type TdkHandler = (request: TdkRequest) => Promise<TdkResponse>;

export function json(status: number, body: JsonValue): TdkResponse {
  return { status, headers: { "content-type": "application/json" }, body };
}

export function noContent(): TdkResponse {
  return { status: 204, headers: {} };
}

export function failure(code: TdkErrorCode, message: string, secrets: readonly (string | null | undefined)[] = []): TdkResponse {
  return json(statusFor(code), errorBody(code, message, secrets));
}

export function bearerOf(headers: Record<string, string | undefined>): string | undefined {
  const header = headers.authorization;
  if (header === undefined) return undefined;
  const match = /^bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim();
}

/**
 * Constant-time comparison of the shared secret.
 *
 * Both sides are hashed first, which is not decoration: `timingSafeEqual` throws outright on
 * buffers of different lengths, so a naive guard would answer a wrong-length guess faster than a
 * right-length one and leak the secret's length to anyone who can time a request. Digests are
 * always 32 bytes, so the comparison is the same work every time.
 */
export function secretMatches(presented: string | undefined, expected: string): boolean {
  if (presented === undefined || expected.length === 0) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * One page of a list, and where the next one starts.
 *
 * The cursor is an opaque offset, the same shape and the same promise as every list populace's own
 * API serves, so a reader who has seen one has seen both. Opaque because it will not always be an
 * offset: an app that grows real paging of its own should be able to put its vendor's page token
 * here without anything on the wire changing.
 *
 * An offset does mean a page can shift under a sweep that is reading it. That costs a re-read and
 * never a loss: teardown is idempotent, and a sweep that runs twice is the design.
 */
export function page<T>(items: readonly T[], cursor: string | undefined, limit: number): { items: T[]; nextCursor: string | null } {
  const start = cursor === undefined ? 0 : Number.parseInt(cursor, 10);
  const from = Number.isFinite(start) && start > 0 ? start : 0;
  const slice = items.slice(from, from + limit);
  const next = from + slice.length;
  return { items: slice, nextCursor: next < items.length ? String(next) : null };
}

/** Leading slash, no trailing slash, no empty segments: `/people/` and `people` both become `/people`. */
export function normalizePath(path: string): string {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

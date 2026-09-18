import { ErrorBodySchema, type ErrorBody } from "@populace/contract";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

const STATUS = { not_found: 404, bad_request: 400, conflict: 409, unavailable: 503, internal: 500 } as const;

/**
 * A path parameter, narrowed. Hono cannot infer parameter names from a path built out of the
 * shared route table, so every `c.req.param(...)` there is typed `string | undefined`; a route
 * that matched always has the segment it matched on.
 */
export function param(c: Context, name: string): string {
  return c.req.param(name) ?? "";
}

export function fail(c: Context, code: ErrorBody["error"]["code"], message: string): Response {
  const body = ErrorBodySchema.parse({ error: { code, message } });
  return c.json(body, STATUS[code] satisfies ContentfulStatusCode);
}

/**
 * Query parameters arrive as repeated keys or single ones; collapsing a single-element array to
 * its value lets one schema accept both without every route knowing which it got.
 */
export function query(c: Context): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, values] of Object.entries(c.req.queries())) {
    const first = values[0];
    if (first === undefined) continue;
    out[key] = values.length === 1 ? first : values;
  }
  return out;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; response: Response };

export function parseQuery<T>(c: Context, schema: z.ZodType<T>): Parsed<T> {
  const result = schema.safeParse(query(c));
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, response: fail(c, "bad_request", z.prettifyError(result.error)) };
}

/** Parses a JSON request body. A body that is not JSON at all is a bad request, not a crash. */
export async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<Parsed<T>> {
  let raw: unknown;
  try {
    // eslint-disable-next-line no-restricted-syntax -- HTTP boundary: parsed against the contract schema below.
    raw = (await c.req.json()) as unknown;
  } catch {
    raw = {};
  }
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, response: fail(c, "bad_request", z.prettifyError(result.error)) };
}

/**
 * The cursor is an opaque offset into the result list. It is opaque on purpose: M2 replaces it
 * with the event-log sequence (ADR-0026) and no client should have encoded an assumption about
 * what it means.
 */
export function page<T>(items: T[], cursor: string | undefined, limit: number): { items: T[]; nextCursor: string | null } {
  const start = cursor === undefined ? 0 : Number.parseInt(cursor, 10);
  const from = Number.isFinite(start) && start > 0 ? start : 0;
  const slice = items.slice(from, from + limit);
  const next = from + slice.length;
  return { items: slice, nextCursor: next < items.length ? String(next) : null };
}

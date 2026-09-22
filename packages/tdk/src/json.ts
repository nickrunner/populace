import { z } from "zod";

/**
 * Any JSON value.
 *
 * Inlined rather than imported from `@populace/core` on purpose: the TDK is installed into
 * somebody else's server, and a dependency on populace's own schema layer would drag the whole
 * harness into a product that only wanted a route.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)]),
);

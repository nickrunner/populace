import { z } from "zod";
import { JsonValueSchema } from "../json.js";

export const McpEndpointSchema = z.object({
  /** Stable name used in traces when a target has more than one endpoint. */
  name: z.string().min(1).default("default"),
  url: z.url(),
  /** Static bearer token for endpoints that are not per-identity (e.g. a QA gateway). Identity tokens take precedence. */
  bearerToken: z.string().optional(),
  headers: z.record(z.string(), z.string()).default({}),
});
export type McpEndpoint = z.infer<typeof McpEndpointSchema>;

/**
 * How to put the target back to a known state. This is not about determinism — outcomes vary
 * between executions by design. It is about "re-run from a fresh clean slate": populace already
 * gives fresh memory and fresh accounts by itself, and the target's own database is the one thing
 * outside its reach.
 *
 * `http` exists because the reference target's reset is an HTTP route, not an MCP tool
 * (`packages/mock-target/src/server.ts`, `POST /admin/reset`). A tool-only field would not have
 * driven the one target we ship.
 */
export const TargetResetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("tool"),
    /** Which `McpEndpoint`, by name. */
    endpoint: z.string().default("default"),
    tool: z.string().min(1),
    arguments: z.record(z.string(), JsonValueSchema).default({}),
  }),
  z.object({
    kind: z.literal("http"),
    url: z.url(),
    method: z.enum(["POST", "DELETE"]).default("POST"),
  }),
]);
export type TargetReset = z.infer<typeof TargetResetSchema>;

export const TargetSchema = z.object({
  name: z.string().min(1),
  mcp: z.array(McpEndpointSchema).min(1),
  /** Optional web base URL the agent may fetch pages from (same-origin only). */
  webBaseUrl: z.url().optional(),
  /** Optional product description shown to the agent as "what the marketing says". */
  description: z.string().optional(),
  /** How an ephemeral execution puts the target back to a known state before its first visit. */
  reset: TargetResetSchema.prefault({ kind: "none" }),
});
export type Target = z.infer<typeof TargetSchema>;

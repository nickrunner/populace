import { z } from "zod";

export const McpEndpointSchema = z.object({
  /** Stable name used in traces when a target has more than one endpoint. */
  name: z.string().min(1).default("default"),
  url: z.url(),
  /** Static bearer token for endpoints that are not per-identity (e.g. a QA gateway). Identity tokens take precedence. */
  bearerToken: z.string().optional(),
  headers: z.record(z.string(), z.string()).default({}),
});
export type McpEndpoint = z.infer<typeof McpEndpointSchema>;

export const TargetSchema = z.object({
  name: z.string().min(1),
  mcp: z.array(McpEndpointSchema).min(1),
  /** Optional web base URL the agent may fetch pages from (same-origin only). */
  webBaseUrl: z.url().optional(),
  /** Optional product description shown to the agent as "what the marketing says". */
  description: z.string().optional(),
});
export type Target = z.infer<typeof TargetSchema>;

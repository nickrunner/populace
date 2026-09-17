import { z } from "zod";

export const IdentityStrategySchema = z.enum(["self-signup", "admin-mint", "static"]);
export type IdentityStrategy = z.infer<typeof IdentityStrategySchema>;

export const CredentialSchema = z.object({
  /** Bearer token presented to the target's MCP endpoints. */
  bearerToken: z.string().min(1),
  /** The target's own user id, when known. */
  userId: z.string().optional(),
  email: z.string().optional(),
  displayName: z.string().optional(),
  /** Provider-specific extras (e.g. a Firebase custom token) kept for teardown. */
  extra: z.record(z.string(), z.string()).default({}),
});
export type Credential = z.infer<typeof CredentialSchema>;

export const IdentitySchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  tag: z.string().min(1),
  agentId: z.string().min(1),
  personaId: z.string().min(1),
  strategy: IdentityStrategySchema,
  credential: CredentialSchema,
  createdAt: z.iso.datetime(),
  tornDownAt: z.iso.datetime().nullable().default(null),
});
export type Identity = z.infer<typeof IdentitySchema>;

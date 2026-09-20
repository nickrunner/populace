import { z } from "zod";
import { UsageSchema } from "./trace.js";

/**
 * `auth-failed` is its own outcome rather than an `error`: the target rejected this person's
 * credential, which is a fact about the account and not about populace, and a wake that answers
 * "errored" for it reads as a bug in the harness while quietly spending a budget on 401s.
 */
export const WakeStatusSchema = z.enum(["running", "done", "gave-up", "budget-exceeded", "killed", "max-turns", "auth-failed", "error"]);
export type WakeStatus = z.infer<typeof WakeStatusSchema>;

export const WakeSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  tag: z.string().min(1),
  agentId: z.string().min(1),
  personaId: z.string().min(1),
  populationId: z.string().min(1),
  /** 1-based count of this agent's wakes. */
  wakeNumber: z.number().int().positive(),
  status: WakeStatusSchema,
  summary: z.string().default(""),
  model: z.string(),
  effort: z.string(),
  usage: UsageSchema,
  costUsd: z.number().nonnegative(),
  turns: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  findingCount: z.number().int().nonnegative(),
  /** What the agent said on `done`/`give_up` about coming back. Null when it never got to say. */
  wouldReturn: z.boolean().nullable().default(null),
  error: z.string().nullable().default(null),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable().default(null),
});
export type Wake = z.infer<typeof WakeSchema>;

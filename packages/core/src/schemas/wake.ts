import { z } from "zod";
import { UsageSchema } from "./trace.js";

export const WakeStatusSchema = z.enum(["running", "done", "gave-up", "budget-exceeded", "killed", "max-turns", "error"]);
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
  error: z.string().nullable().default(null),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable().default(null),
});
export type Wake = z.infer<typeof WakeSchema>;

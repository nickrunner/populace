import { z } from "zod";
import { PersonaSchema } from "./persona.js";

export const AgentStatusSchema = z.enum(["active", "retired", "paused"]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/**
 * Why an agent stopped waking. `gave-up` is the agent's own decision and is final;
 * the other two are limits the operator sets and are lifted by raising them.
 */
export const RetiredReasonSchema = z.enum(["gave-up", "max-wakes", "scaled-down"]);
export type RetiredReason = z.infer<typeof RetiredReasonSchema>;

/** Set when an agent is carried into a continuation run: which run it came from, and at which wake. */
export const ContinuedFromSchema = z.object({
  runId: z.string().min(1),
  atWake: z.number().int().nonnegative(),
  /** True when the agent had walked away and is being given another look. */
  gaveUp: z.boolean().default(false),
});
export type ContinuedFrom = z.infer<typeof ContinuedFromSchema>;

export const AgentSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  populationId: z.string().min(1),
  persona: PersonaSchema,
  /** Index within the persona's agents (0-based). */
  ordinal: z.number().int().nonnegative(),
  status: AgentStatusSchema.default("active"),
  /** Set when status is `retired`; null while active. */
  retiredReason: RetiredReasonSchema.nullable().default(null),
  /** Provenance for `--continue-from`; null for an agent that started in this run. */
  continuedFrom: ContinuedFromSchema.nullable().default(null),
  identityId: z.string().nullable().default(null),
  wakeCount: z.number().int().nonnegative().default(0),
  maxWakes: z.number().int().positive().nullable().default(null),
  nextWakeAt: z.iso.datetime().nullable().default(null),
  lastWakeAt: z.iso.datetime().nullable().default(null),
  createdAt: z.iso.datetime(),
});
export type Agent = z.infer<typeof AgentSchema>;

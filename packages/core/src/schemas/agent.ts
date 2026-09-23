import { z } from "zod";
import { PersonaSchema } from "./persona.js";
import { ToolPolicySchema } from "./tool-policy.js";

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
  /**
   * `${populationSlug}/${cohortSlug}.${personaSlug}#${ordinal + 1}`. Unique WITHIN A RUN, not
   * globally.
   */
  id: z.string().min(1),
  runId: z.string().min(1),
  simulationId: z.string().min(1),
  /** The population slug. */
  populationId: z.string().min(1),
  /** The cohort this participant belongs to. A cohort mixes personas; two cohorts may share one. */
  cohortSlug: z.string().min(1),
  /** `${cohortSlug}.${personaSlug}#${ordinal + 1}` — the durable person this participant is an instance of. */
  personId: z.string().min(1),
  /** What the cohort's people have in common, in prose; goes under the persona's backstory. */
  context: z.string().default(""),
  /** The cohort's own tool policy, merged with the target's and the persona's at the wake. */
  cohortTools: ToolPolicySchema.prefault({}),
  /** The generated person name, copied in so a run renders without joining the people table. */
  name: z.string().min(1),
  /** The person's individuating line, inserted under the persona's backstory in the prompt. */
  details: z.string().default(""),
  /**
   * The person's email local part, copied from the frozen roster. The signup provider uses this
   * rather than deriving one, so a handle written by anything other than `handleFor` — a model, a
   * rename — is the handle the account is actually made with (SPEC §5.3.5).
   */
  handle: z.string().min(1),
  persona: PersonaSchema,
  /** Index within the lane (0-based). */
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

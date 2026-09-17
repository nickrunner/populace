import { z } from "zod";
import { PersonaSchema } from "./persona.js";

export const AgentStatusSchema = z.enum(["active", "retired", "paused"]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const AgentSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  populationId: z.string().min(1),
  persona: PersonaSchema,
  /** Index within the persona's agents (0-based). */
  ordinal: z.number().int().nonnegative(),
  status: AgentStatusSchema.default("active"),
  identityId: z.string().nullable().default(null),
  wakeCount: z.number().int().nonnegative().default(0),
  maxWakes: z.number().int().positive().nullable().default(null),
  nextWakeAt: z.string().datetime().nullable().default(null),
  lastWakeAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
});
export type Agent = z.infer<typeof AgentSchema>;

import { z } from "zod";

export const GuardrailsSchema = z.object({
  perWake: z
    .object({
      maxTokens: z.number().int().positive().default(400_000),
      maxUsd: z.number().positive().default(3),
      maxTurns: z.number().int().positive().default(40),
    })
    .prefault({}),
  /** Per-population trailing-24h dollar ceiling. */
  dailyUsd: z.number().positive().default(50),
  /** Maximum free-form notes kept in memory. */
  maxMemoryNotes: z.number().int().positive().default(60),
  /** Characters of a tool result shown to the model before truncation. */
  maxToolResultChars: z.number().int().positive().default(12_000),
  /** Allow the agent to fetch pages under the target's web base URL. */
  webFetch: z.boolean().default(true),
});
export type Guardrails = z.infer<typeof GuardrailsSchema>;

import { z } from "zod";

export const TriageStateSchema = z.enum(["untriaged", "accepted", "fixed", "wont-fix", "duplicate"]);
export type TriageState = z.infer<typeof TriageStateSchema>;

/**
 * Human judgement about a problem, keyed by signature so it survives a re-execution. Without it a
 * longitudinal simulation meant to be left running shows the same forty problems at execution 40
 * that it showed at execution 1 — the difference between a firehose and a product.
 */
export const TriageSchema = z.object({
  projectId: z.string().min(1),
  signature: z.string().min(1),
  state: TriageStateSchema.default("untriaged"),
  note: z.string().default(""),
  /** A link out: an issue url, a commit, whatever the user pastes. */
  externalRef: z.string().default(""),
  /** The signature's title when it was triaged, so a drifted signature is visible as an orphan. */
  titleAtTriage: z.string().default(""),
  updatedAt: z.iso.datetime(),
});
export type Triage = z.infer<typeof TriageSchema>;

import { z } from "zod";
import { FindingKindSchema, FindingSchema, SeveritySchema } from "./finding.js";

export const ClusterSchema = z.object({
  id: z.string(),
  kind: FindingKindSchema,
  title: z.string(),
  severity: SeveritySchema,
  tool: z.string().optional(),
  representative: FindingSchema,
  findings: z.array(FindingSchema),
  personaIds: z.array(z.string()),
  wakeIds: z.array(z.string()),
  confirmedCount: z.number().int().nonnegative(),
  notReproducedCount: z.number().int().nonnegative(),
  inconclusiveCount: z.number().int().nonnegative(),
  unverifiedCount: z.number().int().nonnegative(),
});
export type Cluster = z.infer<typeof ClusterSchema>;

export const DigestSchema = z.object({
  id: z.string(),
  targetName: z.string(),
  runIds: z.array(z.string()),
  window: z.object({ from: z.iso.datetime(), to: z.iso.datetime() }),
  generatedAt: z.iso.datetime(),
  totals: z.object({
    wakes: z.number().int().nonnegative(),
    agents: z.number().int().nonnegative(),
    findings: z.number().int().nonnegative(),
    clusters: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
  }),
  clusters: z.array(ClusterSchema),
});
export type Digest = z.infer<typeof DigestSchema>;

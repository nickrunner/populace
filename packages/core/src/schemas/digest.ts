import { z } from "zod";
import { FindingKindSchema, FindingSchema, SeveritySchema } from "./finding.js";

/** How hard one cohort was hit, at population scale. The headline on the results screen. */
export const ClusterCohortSchema = z.object({
  slug: z.string(),
  name: z.string(),
  peopleHit: z.number().int().nonnegative(),
  peopleTotal: z.number().int().nonnegative(),
  reports: z.number().int().nonnegative(),
});
export type ClusterCohort = z.infer<typeof ClusterCohortSchema>;

export const ClusterSchema = z.object({
  /** Positional, for in-page anchors. The join key across executions is `signature`. */
  id: z.string(),
  /** The representative's `signature`; stable across executions. */
  signature: z.string().min(1),
  kind: FindingKindSchema,
  title: z.string(),
  severity: SeveritySchema,
  tool: z.string().optional(),
  representative: FindingSchema,
  findings: z.array(FindingSchema),
  personaIds: z.array(z.string()),
  cohorts: z.array(ClusterCohortSchema).default([]),
  /** Person ids (`cohortSlug#n`), not agent ids: the same individual across executions. */
  personIds: z.array(z.string()).default([]),
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

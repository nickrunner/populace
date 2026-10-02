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
  /** Positional, for in-page anchors. Renumbered by every clustering pass; never an identity. */
  id: z.string(),
  /**
   * The representative's `signature` — a display key and an in-page anchor, and NOT an identity.
   *
   * It MOVES, and it moves for a reason worth knowing before keying anything off it:
   * `pickRepresentative` (`packages/reports/src/cluster.ts:25-31`) sorts on verdict score FIRST,
   * and verdicts are written by the digest AFTER the run. So the same cluster over the same
   * findings presents under a DIFFERENT signature once a verdict lands — inside one execution,
   * before anybody has reworded a title. Across executions it is worse: an identical signature
   * recurs at 0% (ADR-0028's amendment measures it).
   *
   * Anything durable that keys off this field therefore records the same problem twice. What is
   * stable is the individual finding's own `signature`, computed once at file time and never
   * recomputed, which is why the identity of a problem over time is the member signature SET:
   * `FiledIssueSchema.signatures` in `./github.js`, matched by intersection and grown on a match.
   */
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

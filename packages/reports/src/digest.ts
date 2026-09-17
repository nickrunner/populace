import { type Digest, type PopulaceConfig, type Store } from "@populace/core";
import { clusterFindings } from "./cluster.js";

export interface DigestOptions {
  store: Store;
  config: PopulaceConfig;
  since: Date;
  until: Date;
  runIds?: string[];
  /** Include findings whose verification failed ("not-reproduced"). Default false: they are listed in a footnote count only. */
  includeNotReproduced?: boolean;
  clusterThreshold?: number;
  now?: () => Date;
}

export async function buildDigest(options: DigestOptions): Promise<Digest> {
  const now = options.now ?? (() => new Date());
  const query = { runIds: options.runIds, since: options.since, until: options.until };
  const findings = await options.store.listFindings(query);
  const wakes = await options.store.listWakes(query);
  const kept = options.includeNotReproduced ? findings : findings.filter((f) => f.verification?.verdict !== "not-reproduced");
  const clusters = clusterFindings(kept, options.clusterThreshold);
  return {
    id: `digest_${now().getTime().toString(36)}`,
    targetName: options.config.target.name,
    runIds: [...new Set([...wakes.map((w) => w.runId), ...findings.map((f) => f.runId)])].sort(),
    window: { from: options.since.toISOString(), to: options.until.toISOString() },
    generatedAt: now().toISOString(),
    totals: {
      wakes: wakes.length,
      agents: new Set(wakes.map((w) => w.agentId)).size,
      findings: findings.length,
      clusters: clusters.length,
      costUsd: Number((wakes.reduce((sum, w) => sum + w.costUsd, 0) + findings.reduce((sum, f) => sum + (f.verification?.costUsd ?? 0), 0)).toFixed(4)),
    },
    clusters,
  };
}

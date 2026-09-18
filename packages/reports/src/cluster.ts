import { SEVERITY_RANK, titleTokens, type Cluster, type Finding, type Severity } from "@populace/core";

// `titleTokens` moved into core so the runner can compute a finding's signature at file time from
// exactly the tokens the clusterer will later group on. Re-exported because this is where the rest
// of the reports package has always imported it from.
export { titleTokens };

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export function primaryTool(finding: Finding): string {
  return finding.tool ?? finding.reproduction[finding.reproduction.length - 1]?.tool ?? "";
}

function maxSeverity(findings: Finding[]): Severity {
  let best: Severity = "low";
  for (const f of findings) if (SEVERITY_RANK[f.severity] < SEVERITY_RANK[best]) best = f.severity;
  return best;
}

function verdictScore(f: Finding): number {
  const v = f.verification?.verdict;
  return v === "confirmed" ? 3 : v === "inconclusive" ? 1 : v === undefined ? 2 : 0;
}

function pickRepresentative(findings: Finding[]): Finding {
  return [...findings].sort((a, b) => verdictScore(b) - verdictScore(a) || b.confidence - a.confidence || b.reproduction.length - a.reproduction.length || a.createdAt.localeCompare(b.createdAt))[0] as Finding;
}

/**
 * Groups findings that describe the same thing (ADR-0017): same kind, same
 * primary tool, similar title. Greedy single pass; order-independent enough
 * for a digest.
 */
export function clusterFindings(findings: Finding[], threshold = 0.3): Cluster[] {
  const groups: { key: string; tokens: Set<string>; members: Finding[] }[] = [];
  for (const finding of [...findings].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const key = `${finding.kind}|${primaryTool(finding)}`;
    const tokens = titleTokens(finding.title);
    let best: { group: (typeof groups)[number]; score: number } | null = null;
    for (const group of groups) {
      if (group.key !== key) continue;
      const score = jaccard(group.tokens, tokens);
      if (score >= threshold && (!best || score > best.score)) best = { group, score };
    }
    if (best) {
      best.group.members.push(finding);
      for (const t of tokens) best.group.tokens.add(t);
    } else groups.push({ key, tokens: new Set(tokens), members: [finding] });
  }
  const clusters = groups.map((group, index): Cluster => {
    const representative = pickRepresentative(group.members);
    const verdicts = group.members.map((f) => f.verification?.verdict ?? null);
    return {
      id: `cluster-${index + 1}`,
      // Written at file time by the runner (`signatureOf`), required by `FindingSchema`, and taken
      // from the representative as-is: recomputing here would be a second definition of the key.
      signature: representative.signature,
      kind: representative.kind,
      title: representative.title,
      severity: maxSeverity(group.members),
      ...(primaryTool(representative) ? { tool: primaryTool(representative) } : {}),
      representative,
      findings: group.members,
      personaIds: [...new Set(group.members.map((f) => f.personaId))].sort(),
      cohorts: [],
      personIds: [],
      wakeIds: [...new Set(group.members.map((f) => f.wakeId))],
      confirmedCount: verdicts.filter((v) => v === "confirmed").length,
      notReproducedCount: verdicts.filter((v) => v === "not-reproduced").length,
      inconclusiveCount: verdicts.filter((v) => v === "inconclusive").length,
      unverifiedCount: verdicts.filter((v) => v === null).length,
    };
  });
  clusters.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.personaIds.length - a.personaIds.length || b.findings.length - a.findings.length || a.title.localeCompare(b.title));
  return clusters.map((c, i) => ({ ...c, id: `cluster-${i + 1}` }));
}

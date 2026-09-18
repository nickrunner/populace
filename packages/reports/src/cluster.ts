import { SEVERITY_RANK, cohortSlugOfAgentId, personIdOfAgentId, titleTokens, type Cluster, type ClusterCohort, type Finding, type Severity } from "@populace/core";

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
 * One cohort as the clusterer needs to know it: how it is called, and how many people are in it.
 *
 * Without this the clusterer can say how many reports it got and from whom, but not how many of
 * the people who COULD have hit a problem did — and "3 of 12 weekenders" is the number the results
 * screen is built around. Passing the census in keeps the arithmetic here, where the members are,
 * rather than re-deriving it per card in the read model.
 */
export interface CohortCensus {
  slug: string;
  name: string;
  /** Everybody in the cohort, whether or not they filed anything. */
  people: number;
}

export interface ClusterOptions {
  /** Jaccard floor for two titles of the same kind and tool to be the same problem. */
  threshold?: number;
  /**
   * The cohorts the findings came from. Given, every cohort gets a row — including the ones that
   * hit nothing, which is half of what an incidence bar says. Omitted (the digest, which has no
   * roster to hand), only the cohorts that actually reported appear, and `peopleTotal` falls back
   * to the people seen in the findings themselves.
   */
  census?: readonly CohortCensus[];
}

/** Per-cohort incidence for one cluster, read out of the members' agent ids. */
function incidenceOf(members: readonly Finding[], census: readonly CohortCensus[] | undefined): ClusterCohort[] {
  const hit = new Map<string, Set<string>>();
  const reports = new Map<string, number>();
  for (const finding of members) {
    const slug = cohortSlugOfAgentId(finding.agentId);
    if (slug === "") continue;
    const people = hit.get(slug) ?? new Set<string>();
    people.add(personIdOfAgentId(finding.agentId));
    hit.set(slug, people);
    reports.set(slug, (reports.get(slug) ?? 0) + 1);
  }
  const rows: CohortCensus[] = census ? [...census] : [];
  const known = new Set(rows.map((c) => c.slug));
  // A cohort that reported but is not in the census still gets a row: a config that changed under
  // a past execution must not make its reports invisible.
  for (const slug of [...hit.keys()].sort()) if (!known.has(slug)) rows.push({ slug, name: slug, people: hit.get(slug)?.size ?? 0 });
  return rows.map((cohort) => ({
    slug: cohort.slug,
    name: cohort.name,
    peopleHit: hit.get(cohort.slug)?.size ?? 0,
    peopleTotal: cohort.people,
    reports: reports.get(cohort.slug) ?? 0,
  }));
}

/**
 * Groups findings that describe the same thing (ADR-0017): same kind, same
 * primary tool, similar title. Greedy single pass; order-independent enough
 * for a digest.
 */
export function clusterFindings(findings: Finding[], options: ClusterOptions = {}): Cluster[] {
  const threshold = options.threshold ?? 0.3;
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
      cohorts: incidenceOf(group.members, options.census),
      // People, not agents: the same individual in two executions is one person id, so this number
      // is the one that can be compared across them.
      personIds: [...new Set(group.members.map((f) => personIdOfAgentId(f.agentId)))].sort(),
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

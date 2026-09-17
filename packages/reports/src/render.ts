import { truncate, type Cluster, type Digest, type Finding, type FindingKind, type ToolCallRecord } from "@populace/core";

const KIND_ORDER: FindingKind[] = ["bug", "coverage-gap", "abandonment", "friction", "suggestion", "praise"];
const KIND_TITLE: Record<FindingKind, string> = {
  bug: "Bugs",
  "coverage-gap": "Coverage gaps in the MCP surface",
  abandonment: "Abandonment",
  friction: "Friction",
  suggestion: "Suggestions",
  praise: "Praise",
};

function verificationLabel(c: Cluster): string {
  const parts: string[] = [];
  if (c.confirmedCount) parts.push(`${c.confirmedCount} confirmed`);
  if (c.notReproducedCount) parts.push(`${c.notReproducedCount} not reproduced`);
  if (c.inconclusiveCount) parts.push(`${c.inconclusiveCount} inconclusive`);
  if (c.unverifiedCount) parts.push(`${c.unverifiedCount} unverified`);
  return parts.join(", ") || "unverified";
}

function code(text: string): string {
  return `\`${text.replace(/`/g, "'")}\``;
}

function step(record: ToolCallRecord, index: number): string {
  const args = JSON.stringify(record.arguments);
  const result = truncate(record.result.text.replace(/\s+/g, " ").trim(), 400);
  return `${index + 1}. ${code(`${record.tool}(${args})`)}\n   ${record.result.isError ? "**error** " : ""}→ ${code(result)}`;
}

function renderFinding(f: Finding): string[] {
  const lines: string[] = [];
  lines.push(`**Expected:** ${f.expected}`);
  lines.push("");
  lines.push(`**Observed:** ${f.observed}`);
  lines.push("");
  lines.push(f.description);
  lines.push("");
  if (f.reproduction.length > 0) {
    lines.push(`**Reproduction** (persona ${code(f.personaId)}, wake ${code(f.wakeId)}, endpoint ${code(f.endpoint)}):`);
    lines.push("");
    lines.push(...f.reproduction.map(step));
    lines.push("");
  }
  if (f.verification) {
    lines.push(`**Verification:** ${f.verification.verdict} (${f.verification.judge} judge, ${f.verification.verifiedAt.slice(0, 16).replace("T", " ")}). ${f.verification.reason}`);
    lines.push("");
  }
  return lines;
}

/** Markdown digest, the first (and for now only) rendering. */
export function renderDigestMarkdown(digest: Digest): string {
  const out: string[] = [];
  out.push(`# ${digest.targetName}: population digest`);
  out.push("");
  out.push(`Window ${digest.window.from.slice(0, 16).replace("T", " ")} to ${digest.window.to.slice(0, 16).replace("T", " ")} UTC. Generated ${digest.generatedAt.slice(0, 16).replace("T", " ")} UTC.`);
  out.push("");
  out.push("| Wakes | Agents | Findings | Clusters | Cost |");
  out.push("| --- | --- | --- | --- | --- |");
  out.push(`| ${digest.totals.wakes} | ${digest.totals.agents} | ${digest.totals.findings} | ${digest.totals.clusters} | $${digest.totals.costUsd.toFixed(2)} |`);
  out.push("");
  if (digest.clusters.length === 0) {
    out.push("No findings in this window.");
    return out.join("\n");
  }
  out.push("## At a glance");
  out.push("");
  out.push("| # | Kind | Severity | Title | Tool | Personas | Reports | Verification |");
  out.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  digest.clusters.forEach((c, i) => {
    out.push(`| ${i + 1} | ${c.kind} | ${c.severity} | ${c.title} | ${c.tool ? code(c.tool) : ""} | ${c.personaIds.length} | ${c.findings.length} | ${verificationLabel(c)} |`);
  });
  out.push("");
  for (const kind of KIND_ORDER) {
    const clusters = digest.clusters.filter((c) => c.kind === kind);
    if (clusters.length === 0) continue;
    out.push(`## ${KIND_TITLE[kind]}`);
    out.push("");
    for (const c of clusters) {
      const n = digest.clusters.indexOf(c) + 1;
      out.push(`### ${n}. ${c.title}`);
      out.push("");
      out.push(`Severity **${c.severity}**${c.tool ? `, tool ${code(c.tool)}` : ""}. Reported ${c.findings.length} time${c.findings.length === 1 ? "" : "s"} by ${c.personaIds.length} persona${c.personaIds.length === 1 ? "" : "s"} (${c.personaIds.map(code).join(", ")}) across ${c.wakeIds.length} wake${c.wakeIds.length === 1 ? "" : "s"}. ${verificationLabel(c)}. Confidence ${(c.representative.confidence * 100).toFixed(0)}%.`);
      out.push("");
      out.push(...renderFinding(c.representative));
      const others = c.findings.filter((f) => f.id !== c.representative.id);
      if (others.length > 0) {
        out.push("Also reported as:");
        out.push("");
        for (const f of others) out.push(`- ${f.title} (${f.personaId}, ${f.severity}${f.verification ? `, ${f.verification.verdict}` : ""})`);
        out.push("");
      }
    }
  }
  out.push("## Runs");
  out.push("");
  out.push(digest.runIds.map(code).join(", ") || "(none)");
  out.push("");
  return out.join("\n");
}

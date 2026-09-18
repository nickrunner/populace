import { Link } from "react-router-dom";
import type { Cluster } from "../api.js";
import { clusterVerdict, inTheirWords } from "../format.js";
import { Severity, ToolName, Verdict } from "./ui.jsx";

/**
 * One row is one thing that is actually wrong, not one report: the same complaint from three
 * people is a single row here, which is the whole point of clustering (ADR-0017).
 */
export function ClusterRow({ cluster, runId, people }: { cluster: Cluster; runId: string; people: number }) {
  const verdict = clusterVerdict(cluster);
  const missing = cluster.kind === "coverage-gap";
  return (
    <Link
      to={`/runs/${encodeURIComponent(runId)}/findings/${encodeURIComponent(cluster.id)}`}
      className="block bg-card border border-rule rounded-lg p-4 hover:border-rule-strong transition-colors"
    >
      <div className="flex items-center gap-2.5 mb-1.5">
        <Severity value={cluster.severity} kind={cluster.kind} />
        {cluster.tool ? <ToolName name={cluster.tool} missing={missing} /> : null}
      </div>
      <h3 className="t-finding mb-1.5">{cluster.title}</h3>
      <p className="t-body text-ink-soft mb-3 max-w-[78ch]">{inTheirWords(cluster.representative)}</p>
      <div className="flex items-center gap-4 t-meta text-ink-muted">
        <Verdict value={verdict} />
        <span>
          {cluster.personaIds.length} of {people} {people === 1 ? "person" : "people"}
        </span>
        <span>
          {cluster.findings.length} {cluster.findings.length === 1 ? "report" : "reports"}
        </span>
      </div>
    </Link>
  );
}

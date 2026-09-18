import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api.js";
import { KIND_SECTIONS } from "../format.js";
import { ClusterRow } from "../components/ClusterRow.jsx";
import { Failed, Loading, PageHeader } from "../components/ui.jsx";

function Chip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`t-meta rounded-full border px-3 py-1 ${active ? "bg-accent-wash border-accent/30 text-accent" : "bg-card border-rule text-ink-soft hover:border-rule-strong"}`}
    >
      {label} <span className="tabular-nums text-ink-muted">{count}</span>
    </button>
  );
}

export function Findings({ runId }: { runId: string }) {
  const [only, setOnly] = useState<string | null>(null);
  const digest = useQuery({ queryKey: ["digest", runId], queryFn: () => api.digest(runId) });
  const run = useQuery({ queryKey: ["run", runId], queryFn: () => api.run(runId) });
  const participants = useQuery({ queryKey: ["participants", runId], queryFn: () => api.participants(runId) });

  if (digest.isError) return <Failed error={digest.error} />;
  const digestData = digest.data;
  const runData = run.data;
  const participantData = participants.data;
  if (!digestData || !runData || !participantData) return <Loading what="the findings" />;

  const clusters = digestData.clusters;
  const people = participantData.items.length;
  const shown = only === null ? clusters : clusters.filter((c) => c.kind === only);
  // The digest drops findings the verifier could not reproduce before it clusters, so the number
  // of reports on this page is smaller than the run's. Say so rather than leaving the reader to
  // notice that the sidebar's count and this page's do not agree.
  const clustered = clusters.reduce((sum, c) => sum + c.findings.length, 0);
  const dropped = Math.max(0, runData.totals.findings - clustered);

  return (
    <>
      <PageHeader
        title="Findings"
        lede={`${runData.totals.findings} reports from ${runData.totals.wakes} visits, gathered into ${clusters.length} things that are actually wrong. The same complaint from three people is one row here.`}
      />

      <div className="flex flex-wrap gap-2 mb-7">
        <Chip label="Everything" count={clusters.length} active={only === null} onClick={() => setOnly(null)} />
        {KIND_SECTIONS.map(({ kinds, title }) => {
          const kind = kinds[0];
          const count = clusters.filter((c) => c.kind === kind).length;
          return count === 0 ? null : (
            <Chip key={kind} label={title} count={count} active={only === kind} onClick={() => setOnly(only === kind ? null : kind)} />
          );
        })}
      </div>

      {KIND_SECTIONS.map(({ kinds, title, sub }) => {
        const rows = shown.filter((c) => (kinds as readonly string[]).includes(c.kind));
        if (rows.length === 0) return null;
        return (
          <section key={title} className="mb-9">
            <div className="flex items-baseline gap-3 mb-3">
              <h2 className="t-section">{title}</h2>
              <span className="t-meta text-ink-muted">{sub}</span>
            </div>
            <div className="flex flex-col gap-3">
              {rows.map((cluster) => (
                <ClusterRow key={cluster.id} cluster={cluster} runId={runId} people={people} />
              ))}
            </div>
          </section>
        );
      })}

      {shown.length === 0 ? <p className="t-body text-ink-muted italic">Nothing of that kind in this run.</p> : null}

      {dropped > 0 ? (
        <p className="t-meta text-ink-muted border-t border-rule pt-4">
          {dropped} more {dropped === 1 ? "report" : "reports"} did not recur when we replayed the calls, so {dropped === 1 ? "it is" : "they are"} left out
          above. The run filed {runData.totals.findings} in all.
        </p>
      ) : null}
    </>
  );
}

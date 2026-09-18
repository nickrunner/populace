import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { inTheirWords } from "../format.js";
import { Avatar, Card, Failed, Loading, PageHeader } from "../components/ui.jsx";

/**
 * Who walked away, and whether they said they would come back. The second half is what M3's
 * fix-validation loop runs on: a continuation only brings back the people who said they would
 * return (ADR-0020), so this screen is where that promise is recorded.
 */
export function WhoLeft({ runId }: { runId: string }) {
  const findings = useQuery({ queryKey: ["findings", runId, "abandonment"], queryFn: () => api.findings(runId, "?kind=abandonment") });
  const agents = useQuery({ queryKey: ["agents", runId], queryFn: () => api.agents(runId) });

  if (findings.isError) return <Failed error={findings.error} />;
  const findingData = findings.data;
  const agentData = agents.data;
  if (!findingData || !agentData) return <Loading what="who left" />;

  const left = findingData.items;

  return (
    <>
      <PageHeader
        title="Who walked away"
        lede="The people who stopped coming back, what it was over, and whether they said a fix would bring them back."
      />

      {left.length === 0 ? (
        <p className="t-body text-ink-muted italic">Nobody has walked away. Everyone we sent is still coming back.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {left.map((finding) => {
            const agent = agentData.items.find((a) => a.id === finding.agentId);
            const name = agent?.personaName ?? finding.personaId;
            return (
              <Card key={finding.id} className="p-5">
                <div className="flex gap-3.5">
                  <Avatar name={name} />
                  <div className="min-w-0 flex-1">
                    <h2 className="t-finding mb-1.5">{finding.title}</h2>
                    <p className="t-body text-ink italic mb-3">“{inTheirWords(finding)}”</p>
                    <div className="flex flex-wrap items-center gap-4 t-meta text-ink-muted">
                      <span>
                        {name} · visit {agent?.wakeCount ?? "—"}
                      </span>
                      <span className={agent?.wouldReturn === true ? "text-confirmed" : undefined}>
                        {agent?.wouldReturn === true
                          ? "said she would come back if it were fixed"
                          : agent?.wouldReturn === false
                            ? "said she would not come back"
                            : "did not say whether she would come back"}
                      </span>
                      <Link
                        to={`/runs/${encodeURIComponent(runId)}/wakes/${encodeURIComponent(finding.wakeId)}`}
                        className="text-accent hover:underline"
                      >
                        watch the visit she left on
                      </Link>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

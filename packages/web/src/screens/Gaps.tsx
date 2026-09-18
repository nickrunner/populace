import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { inTheirWords } from "../format.js";
import { Avatar, Card, Failed, Loading, Mono, PageHeader, Section, ToolName } from "../components/ui.jsx";

/**
 * The part of the report about what to build next rather than what to fix. Two halves: what people
 * came to do and found no way to do, and the tools the target exposes that nobody reached for.
 */
export function Gaps({ runId }: { runId: string }) {
  const digest = useQuery({ queryKey: ["digest", runId], queryFn: () => api.digest(runId) });
  const agents = useQuery({ queryKey: ["agents", runId], queryFn: () => api.agents(runId) });
  const tools = useQuery({ queryKey: ["tools", runId], queryFn: () => api.tools(runId) });

  if (digest.isError) return <Failed error={digest.error} />;
  const digestData = digest.data;
  const agentData = agents.data;
  if (!digestData || !agentData) return <Loading what="the coverage gaps" />;

  const gaps = digestData.clusters.filter((c) => c.kind === "coverage-gap");
  const nameOf = (personaId: string): string => agentData.items.find((a) => a.personaId === personaId)?.personaName ?? personaId;
  const untouched = (tools.data?.items ?? []).filter((t) => t.exposed && t.calls === 0);

  return (
    <>
      <PageHeader
        title="Coverage gaps"
        lede="What people came here to do and found no way to do. This is the part of the report that is about what to build next rather than what to fix."
      />

      {gaps.length === 0 ? (
        <p className="t-body text-ink-muted italic mb-10">Nobody went looking for a tool that is not there.</p>
      ) : (
        <div className="flex flex-col gap-4 mb-12">
          {gaps.map((cluster) => (
            <Card key={cluster.id} className="p-5">
              <div className="flex items-center gap-2.5 mb-2">
                {cluster.tool ? <ToolName name={cluster.tool} missing /> : <Mono className="text-[12.5px] text-evidence">nothing exposes this</Mono>}
                <span className="t-meta text-ink-muted ml-auto">
                  {cluster.personaIds.length} {cluster.personaIds.length === 1 ? "person" : "people"} · {cluster.findings.length}{" "}
                  {cluster.findings.length === 1 ? "ask" : "asks"}
                </span>
              </div>
              <h2 className="t-finding mb-2">{cluster.title}</h2>
              <p className="t-body text-ink-soft mb-4 max-w-[78ch]">{cluster.representative.expected}</p>

              <div className="flex flex-col gap-3 mb-4">
                {cluster.findings.map((finding) => (
                  <div key={finding.id} className="flex gap-3">
                    <Avatar name={nameOf(finding.personaId)} />
                    <div className="min-w-0">
                      <p className="t-body italic">“{inTheirWords(finding)}”</p>
                      <div className="t-meta text-ink-muted mt-0.5">{nameOf(finding.personaId)}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-rule pt-3">
                <div className="t-label text-ink-muted mb-1">What they did instead</div>
                <p className="t-body text-ink-soft">{cluster.representative.observed}</p>
              </div>
              <Link
                to={`/runs/${encodeURIComponent(runId)}/findings/${encodeURIComponent(cluster.id)}`}
                className="inline-block mt-3 t-meta text-accent hover:underline"
              >
                the calls behind this
              </Link>
            </Card>
          ))}
        </div>
      )}

      <Section
        title="Tools you expose that nobody reached for"
        sub={tools.data ? `${untouched.length} of your ${tools.data.exposedCount} tools were never called in this run` : undefined}
      >
        {tools.isPending ? (
          <Loading what="the tool list" />
        ) : tools.data?.toolsError !== null && tools.data?.toolsError !== undefined ? (
          <p className="t-body text-ink-muted italic">
            The target could not be reached, so we cannot say which of its tools went untouched. ({tools.data.toolsError})
          </p>
        ) : untouched.length === 0 ? (
          <p className="t-body text-ink-muted italic">Every tool you expose was called at least once.</p>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="t-label text-ink-muted border-b border-rule">
                  <th className="text-left font-semibold px-4 py-2.5">Tool</th>
                  <th className="text-right font-semibold px-4 py-2.5 w-20">Calls</th>
                  <th className="text-left font-semibold px-4 py-2.5">Also worth noting</th>
                </tr>
              </thead>
              <tbody>
                {untouched.map((tool) => (
                  <tr key={tool.name} className="border-b border-rule last:border-0">
                    <td className="px-4 py-2.5">
                      <ToolName name={tool.name} />
                    </td>
                    <td className="px-4 py-2.5 text-right t-meta text-ink-muted tabular-nums">0</td>
                    <td className="px-4 py-2.5 t-meta text-ink-muted">
                      {tool.destructive ? "destructive, so nobody was allowed to try it" : "never discovered, never asked for"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </Section>
    </>
  );
}

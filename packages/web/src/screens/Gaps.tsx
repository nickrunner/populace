import { useQuery } from "@tanstack/react-query";
import type { ToolUsageView } from "../api.js";
import { q } from "../queries.js";
import { useProject, useSimulation } from "../context.jsx";
import { ClusterRow } from "../components/ClusterRow.jsx";
import { Card, DataTable, Empty, Failed, Loading, PageHeader, Section, ToolName } from "../components/ui.jsx";

type Tool = ToolUsageView["items"][number];

/**
 * The part of the report about what to build next rather than what to fix. Two halves: what people
 * came to do and found no way to do, and the tools the target exposes that nobody reached for.
 *
 * It names nobody. A coverage gap is a fact about the product's surface and about how many people
 * in which cohorts wanted it; who said it is on the problem's own page, one click away, where a
 * name is attribution rather than decoration (SPEC §7.1).
 */
export function Gaps() {
  const { key } = useProject();
  const { key: sim, simulation } = useSimulation();
  const results = useQuery(q.results(key, sim));

  if (results.isPending) return <Loading what="the coverage gaps" />;
  if (results.isError) return <Failed error={results.error} />;

  const data = results.data;
  const seqs = data.history.map((entry) => entry.seq).sort((a, b) => a - b);
  const gaps = [...data.clusters, ...data.known].filter((card) => card.kind === "coverage-gap");
  const untouched = data.coverage.items.filter((tool) => tool.exposed && tool.calls === 0);

  return (
    <>
      <PageHeader
        title="Coverage gaps"
        lede="What people came here to do and found no way to do. This is the part of the report that is about what to build next rather than what to fix."
      />

      {gaps.length === 0 ? (
        <p className="t-body text-ink-muted italic mb-12">Nobody went looking for a tool that is not there.</p>
      ) : (
        <div className="flex flex-col gap-3 mb-12">
          {gaps.map((card) => (
            <ClusterRow key={card.signature} card={card} seqs={seqs} mode={simulation.mode} />
          ))}
        </div>
      )}

      <Section
        title="Tools you expose that nobody reached for"
        sub={`${untouched.length} of your ${data.coverage.exposedCount} tools were never called in this execution`}
      >
        {data.coverage.toolsError !== null ? (
          <Card className="p-4">
            <Empty>The target could not be reached, so we cannot say which of its tools went untouched. ({data.coverage.toolsError})</Empty>
          </Card>
        ) : untouched.length === 0 ? (
          <Card className="p-4">
            <Empty>Every tool you expose was called at least once.</Empty>
          </Card>
        ) : (
          <DataTable<Tool>
            rows={untouched}
            keyOf={(tool) => tool.name}
            empty="Every tool you expose was called at least once."
            columns={[
              { header: "Tool", cell: (tool) => <ToolName name={tool.name} /> },
              { header: "Calls", align: "right", width: "w-20", cell: () => <span className="t-meta text-ink-muted">0</span> },
              {
                header: "Also worth noting",
                cell: (tool) => (
                  <span className="t-meta text-ink-muted">{tool.destructive ? "destructive, so nobody was allowed to try it" : "never discovered, never asked for"}</span>
                ),
              },
            ]}
          />
        )}
      </Section>
    </>
  );
}

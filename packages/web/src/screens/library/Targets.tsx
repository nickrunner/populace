import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { q } from "../../queries.js";
import { useProject } from "../../context.jsx";
import { Card, Chip, Empty, Failed, Loading, Mono, PageHeader, Section } from "../../components/ui.jsx";

/**
 * The targets a project can send people to. One is the normal case and the list is then one row,
 * which is the point of splitting the old single-target screen in two: a project with a staging
 * and a production endpoint is a project with two rows, not two installs (SPEC §7.6).
 */
export function Targets() {
  const { key, project, href } = useProject();
  const targets = useQuery(q.targets(key));

  if (targets.isPending) return <Loading what="your targets" />;
  if (targets.isError) return <Failed error={targets.error} />;

  const items = targets.data.items;
  const usedBy = (id: string): string[] => project.simulations.filter((s) => s.target.id === id).map((s) => s.name);

  return (
    <>
      <PageHeader
        title={items.length === 1 ? "The target" : "The targets"}
        lede="Where the people go. What a target says about itself is what they are told before their first visit, and its tool list is everything they are able to reach."
      />

      <Section title="Connected">
        {items.length === 0 ? (
          <Card className="p-4">
            <Empty>Nothing connected yet.</Empty>
          </Card>
        ) : (
          <Card className="divide-y divide-rule">
            {items.map((target) => {
              const used = usedBy(target.id);
              return (
                <Link key={target.id} to={href(`library/target/${encodeURIComponent(target.id)}`)} className="block p-3.5 hover:bg-well">
                  <div className="flex items-baseline gap-3">
                    <span className="t-body text-ink">{target.name}</span>
                    {target.mcp.some((endpoint) => endpoint.authenticated) ? <Chip>token stored</Chip> : null}
                    <span className="flex-1" />
                    <span className="t-meta text-ink-muted">
                      {used.length === 0 ? "no simulation uses it yet" : `used by ${used.join(", ")}`}
                    </span>
                  </div>
                  <Mono className="text-[11px] text-ink-muted block break-all mt-1">{target.mcp.map((endpoint) => endpoint.url).join("  ")}</Mono>
                  {target.description ? <p className="t-meta text-ink-muted mt-1 max-w-[68ch] truncate">{target.description}</p> : null}
                </Link>
              );
            })}
          </Card>
        )}
        <Link to={href("library/target/new")} className="inline-block mt-3 t-body text-accent hover:underline">
          Connect another
        </Link>
      </Section>
    </>
  );
}

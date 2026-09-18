import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api.js";
import { usd } from "../format.js";
import { Mono } from "./ui.jsx";

/**
 * One navigation, no role switch and no expert mode. The two groups are labelled by what the
 * reader wants rather than by who they are: "What we found" is the evidence surface, "How it ran"
 * is the instrument surface, and everyone sees both.
 */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="t-label text-ink-muted px-3 mb-2">{title}</div>
      <nav className="flex flex-col gap-0.5">{children}</nav>
    </div>
  );
}

function Item({ to, label, count, end = false }: { to: string; label: string; count?: number; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-baseline justify-between gap-2 px-3 py-1.5 rounded-md t-body ${
          isActive ? "bg-accent-wash text-accent font-medium" : "text-ink-soft hover:bg-well"
        }`
      }
    >
      <span>{label}</span>
      {count === undefined ? null : <span className="t-meta text-ink-muted tabular-nums">{count}</span>}
    </NavLink>
  );
}

export function Sidebar({ runId }: { runId: string }) {
  const run = useQuery({ queryKey: ["run", runId], queryFn: () => api.run(runId) });
  const spend = useQuery({ queryKey: ["spend", runId], queryFn: () => api.spend(runId) });
  const target = useQuery({ queryKey: ["target"], queryFn: () => api.target() });

  const base = `/runs/${encodeURIComponent(runId)}`;
  const kinds = run.data?.findingsByKind;
  const ceiling = spend.data?.dailyCeilingUsd ?? 0;
  const spent = spend.data?.spentTodayUsd ?? 0;
  const proportion = ceiling > 0 ? Math.min(1, spent / ceiling) : 0;

  return (
    <aside className="w-[236px] shrink-0 border-r border-rule bg-card flex flex-col h-full overflow-y-auto">
      <div className="px-3 py-5">
        <div className="t-section">populace</div>
        <div className="t-meta text-ink-muted">running on this machine</div>
      </div>

      <div className="px-0 flex-1">
        <Group title="">
          <Item to={base} label="Overview" end />
        </Group>
        <Group title="What we found">
          <Item to={`${base}/findings`} label="Findings" count={run.data?.totals.findings} />
          <Item to={`${base}/gaps`} label="Coverage gaps" count={kinds?.["coverage-gap"]} />
          <Item to={`${base}/left`} label="Who walked away" count={kinds?.abandonment} />
        </Group>
        <Group title="How it ran">
          <Item to={`${base}/population`} label="Population" count={run.data?.totals.agents} />
          <Item to={`${base}/wakes`} label="Wakes" count={run.data?.totals.wakes} />
        </Group>

        <div className="px-3 mb-6">
          <div className="t-label text-ink-muted mb-2">Cost</div>
          <div className="t-meta text-ink-muted">Spent today</div>
          <div className="t-section tabular-nums">{usd(spent)}</div>
          <div className="h-1 bg-well rounded mt-2 overflow-hidden">
            <div className="h-full bg-accent" style={{ width: `${(proportion * 100).toFixed(1)}%` }} />
          </div>
          <div className="t-meta text-ink-muted mt-1.5">of the {usd(ceiling)} daily ceiling</div>
        </div>
      </div>

      <div className="px-3 py-4 border-t border-rule">
        <div className="t-label text-ink-muted mb-1">{target.data?.name ?? "Target"}</div>
        <Mono className="text-[11px] text-ink-muted block break-all">{target.data?.endpoints[0]?.url ?? "—"}</Mono>
        <div className="t-label text-ink-muted mt-3 mb-1">Run</div>
        <Mono className="text-[11px] text-ink-muted block break-all">{runId}</Mono>
        <div className="mt-3 inline-block t-label text-ink-muted border border-rule rounded px-1.5 py-0.5">Read-only</div>
      </div>
    </aside>
  );
}

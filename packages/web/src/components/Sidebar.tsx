import { Link, NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api.js";
import { usd } from "../format.js";
import { Chip, Mono } from "./ui.jsx";

/**
 * One navigation, no role switch and no expert mode. The groups are labelled by what the reader
 * wants rather than by who they are: "What we found" is the evidence surface, "How it ran" is the
 * instrument surface, "Set up" is what produces both, and everyone sees all three.
 */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      {title ? <div className="t-label text-ink-muted px-3 mb-2">{title}</div> : null}
      <nav className="flex flex-col gap-0.5">{children}</nav>
    </div>
  );
}

function Item({ to, label, count, end = false }: { to: string; label: string; count?: number; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `flex items-baseline justify-between gap-2 px-3 py-1.5 rounded-md t-body ${isActive ? "bg-accent-wash text-accent font-medium" : "text-ink-soft hover:bg-well"}`}
    >
      <span>{label}</span>
      {count === undefined ? null : <span className="t-meta text-ink-muted tabular-nums">{count}</span>}
    </NavLink>
  );
}

export function Sidebar({ runId }: { runId: string | null }) {
  const run = useQuery({ queryKey: ["run", runId], queryFn: () => api.run(runId ?? ""), enabled: runId !== null });
  const spend = useQuery({ queryKey: ["spend", runId], queryFn: () => api.spend(runId ?? ""), enabled: runId !== null });
  const setup = useQuery({ queryKey: ["setup"], queryFn: () => api.setup(), refetchInterval: 15_000 });
  const targets = useQuery({ queryKey: ["targets"], queryFn: () => api.targets() });

  const base = runId === null ? null : `/runs/${encodeURIComponent(runId)}`;
  const kinds = run.data?.findingsByKind;
  const ceiling = spend.data?.dailyCeilingUsd ?? 0;
  const spent = spend.data?.spentTodayUsd ?? 0;
  const proportion = ceiling > 0 ? Math.min(1, spent / ceiling) : 0;
  const target = targets.data?.items[0];
  const running = (setup.data?.runningRunIds ?? [])[0] ?? null;

  return (
    <aside className="w-[236px] shrink-0 border-r border-rule bg-card flex flex-col h-full overflow-y-auto">
      <div className="px-3 py-5">
        <Link to="/" className="t-section block">
          populace
        </Link>
        <div className="t-meta text-ink-muted">running on this machine</div>
      </div>

      <div className="px-3 mb-5">
        {running !== null ? (
          <Link to={`/runs/${encodeURIComponent(running)}/live`} className="flex items-center justify-center gap-2 t-body px-3 py-1.5 rounded-md border border-accent/40 bg-accent-wash text-accent">
            Watch the run
          </Link>
        ) : (
          <Link
            to="/start"
            className={`flex items-center justify-center gap-2 t-body px-3 py-1.5 rounded-md border ${setup.data?.ready ? "bg-accent text-white border-accent hover:opacity-90" : "bg-card text-ink-muted border-rule"}`}
          >
            Start a run
          </Link>
        )}
      </div>

      <div className="px-0 flex-1">
        {base ? (
          <>
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
          </>
        ) : null}

        <Group title="Set up">
          <Item to="/setup/target" label="The target" />
          <Item to="/setup/people" label="The people" count={setup.data?.peopleCount} />
          <Item to="/setup/limits" label="Limits and spending" />
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
        <Link to="/setup/target" className="block">
          <div className="flex items-center gap-2 mb-1">
            <span className="t-label text-ink-muted">{target?.name ?? "No target yet"}</span>
            {/* Checking reachability opens a connection to somebody else's server, so it is a
                POST the target screen makes on request — never a timer in the shell. */}
            {setup.data?.killSwitch.engaged ? <Chip tone="bad">stopped</Chip> : !target ? null : <Chip>configured</Chip>}
          </div>
          <Mono className="text-[11px] text-ink-muted block break-all">{target?.mcp[0]?.url ?? "connect one to begin"}</Mono>
        </Link>
        {runId === null ? null : (
          <>
            <div className="t-label text-ink-muted mt-3 mb-1">Run</div>
            <Mono className="text-[11px] text-ink-muted block break-all">{runId}</Mono>
          </>
        )}
      </div>
    </aside>
  );
}

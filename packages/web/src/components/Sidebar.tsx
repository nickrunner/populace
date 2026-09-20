import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useMatch } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { q } from "../queries.js";
import { useProject } from "../context.jsx";
import { people, plural, usd } from "../format.js";
import { Bar, Chip, Mono } from "./ui.jsx";

/**
 * One navigation, no role switch and no expert mode. The grammar is unchanged from M1 — a group
 * title in `t-label`, items with their counts right-aligned in `t-meta tabular-nums`, the active
 * one in `bg-accent-wash text-accent` — and what changed is only what it holds: the brand block
 * became a project switcher, and the run-scoped groups became simulation-scoped ones that appear
 * when the URL is inside a simulation (SPEC §7.2).
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

/**
 * The switcher. The project's name is the heading of the rail, because a project is the thing
 * everything below it belongs to; the `populace` mark is a 20px line above it, which is as much
 * room as a product name needs once the product is open.
 */
function ProjectSwitcher() {
  const { key, project, href } = useProject();
  const projects = useQuery(q.projects());
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent): void => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const others = (projects.data?.items ?? []).filter((p) => p.slug !== key && p.id !== key);

  return (
    <div className="px-3 py-4 relative" ref={box}>
      <Link to="/projects" className="t-meta text-ink-muted block leading-5 h-5">
        populace
      </Link>
      <button type="button" onClick={() => setOpen(!open)} className="flex items-baseline gap-1.5 t-section text-left w-full hover:text-accent" aria-expanded={open}>
        <span className="truncate">{project.name}</span>
        <span className="t-meta text-ink-muted shrink-0" aria-hidden="true">
          ▾
        </span>
      </button>
      <Link to={href()} className="t-meta text-ink-muted block truncate hover:text-accent">
        {project.description || `${people(project.counts.people)} · ${plural(project.counts.simulations, "simulation")}`}
      </Link>

      {open ? (
        <div className="absolute left-3 right-3 top-[68px] z-10 bg-card border border-rule rounded-lg shadow-sm py-1">
          {others.length === 0 ? <p className="t-meta text-ink-muted px-3 py-1.5">No other projects yet.</p> : null}
          {others.map((other) => (
            <Link key={other.id} to={`/p/${encodeURIComponent(other.slug)}`} onClick={() => setOpen(false)} className="flex items-baseline justify-between gap-2 px-3 py-1.5 t-body text-ink-soft hover:bg-well">
              <span className="truncate">{other.name}</span>
              <span className="t-meta text-ink-muted tabular-nums">{other.counts.people}</span>
            </Link>
          ))}
          <Link to="/projects?new=1" onClick={() => setOpen(false)} className="block px-3 py-1.5 t-body text-accent hover:bg-well border-t border-rule mt-1 pt-2">
            New project
          </Link>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A rail item that is a place on the page below rather than a page of its own. It is never in the
 * active state — nothing about the current URL makes it "where you are" — and it scrolls its
 * section into view itself, because a hash alone moves nothing in an app that scrolls its main
 * pane rather than the window.
 */
function Jump({ to, hash, label, count }: { to: string; hash: string; label: string; count?: number }) {
  return (
    <Link
      to={`${to}#${hash}`}
      onClick={() => {
        // After the navigation, so the section exists to be scrolled to when this is pressed from
        // another screen in the project.
        window.setTimeout(() => document.getElementById(hash)?.scrollIntoView({ block: "start" }), 0);
      }}
      className="flex items-baseline justify-between gap-2 px-3 py-1.5 rounded-md t-body text-ink-soft hover:bg-well"
    >
      <span>{label}</span>
      {count === undefined ? null : <span className="t-meta text-ink-muted tabular-nums">{count}</span>}
    </Link>
  );
}

export function Sidebar() {
  const { key, project, href } = useProject();
  const targets = useQuery(q.targets(key));
  const populations = useQuery(q.populations(key));
  const inSimulation = useMatch("/p/:proj/s/:sim/*");
  const simulationKey = inSimulation?.params.sim ?? null;
  const simulation = project.simulations.find((s) => s.slug === simulationKey || s.id === simulationKey);

  const target = targets.data?.items[0];
  const spent = project.spentTodayUsd;
  const ceiling = project.dailyCeilingUsd;
  const running = project.runningRunIds.length > 0;
  const base = simulation === undefined ? null : `${href()}/s/${encodeURIComponent(simulation.slug)}`;
  const live = simulation?.status === "running" || simulation?.status === "paused";

  return (
    <aside className="w-[236px] shrink-0 border-r border-rule bg-card flex flex-col h-full overflow-y-auto">
      <ProjectSwitcher />

      <div className="px-0 flex-1">
        <Group title="">
          <Item to={href()} label="Simulations" count={project.counts.simulations} end />
          {/* Not "Problems": the number is the signatures seen in MORE THAN ONE simulation, which
              for the common shape — one project, one simulation — is permanently nought while the
              product has found a dozen. It is labelled for what it counts, it only appears when
              there is a second simulation for something to be seen in, and it scrolls to the
              section rather than trusting a fragment this router does not act on. */}
          {project.simulations.length > 1 ? (
            <Jump to={href()} hash="problems" label="Seen in more than one" count={project.crossSimulation.length} />
          ) : null}
        </Group>

        {base && simulation ? (
          <Group title={simulation.name}>
            <Item to={base} label="Results" end />
            {live ? <Item to={`${base}/live`} label="Live" /> : null}
            <Item to={`${base}/coverage`} label="Coverage gaps" />
            <Item to={`${base}/left`} label="Who walked away" />
            {/* The headcount is who is CONFIGURED to go; the screen behind it reads one execution.
                Before there is one, a number beside a page that says nobody has been sent is two
                answers to the same question. */}
            <Item to={`${base}/population`} label="Population" {...(simulation.latest === null ? {} : { count: simulation.population.people })} />
            <Item to={`${base}/executions`} label={simulation.mode === "longitudinal" ? "Its life so far" : "Executions"} count={simulation.latest?.seq} />
            <Item to={`${base}/visits`} label="Visits" count={simulation.latest?.totals.wakes} />
          </Group>
        ) : null}

        <Group title="Set up">
          <Item to={href("library/target")} label={project.counts.targets > 1 ? "The targets" : "The target"} count={project.counts.targets > 1 ? project.counts.targets : undefined} />
          <Item to={href("library/personas")} label="Personas" count={project.counts.personas} />
          <Item to={href("library/people")} label="The people" count={project.counts.people} />
          {/* A population is a concept with no payoff while there is one of them, so it stays
              implicit and unnamed until a second one exists (SPEC §7.2). */}
          {(populations.data?.items.length ?? 0) > 1 ? <Item to={href("library/people#populations")} label="Populations" count={populations.data?.items.length} /> : null}
          <Item to={href("settings")} label="Settings" />
        </Group>

        <div className="px-3 mb-6">
          <div className="t-meta text-ink-muted">Spent today</div>
          <div className="t-section tabular-nums">{usd(spent)}</div>
          <div className="mt-2">
            <Bar value={spent} of={ceiling} />
          </div>
          <div className="t-meta text-ink-muted mt-1.5">of the {usd(ceiling)} daily ceiling</div>
        </div>
      </div>

      <div className="px-3 py-4 border-t border-rule">
        <Link to={target ? href(`library/target/${encodeURIComponent(target.id)}`) : href("library/target")} className="block">
          <div className="flex items-center gap-2 mb-1">
            <span className="t-label text-ink-muted truncate">{target?.name ?? "No target yet"}</span>
            {/* Checking reachability opens a connection to somebody else's server, so it is a
                POST the target screen makes on request — never a timer in the shell. */}
            {project.killSwitch.engaged ? <Chip tone="bad">stopped</Chip> : running ? <Chip tone="live">running</Chip> : !target ? null : <Chip>configured</Chip>}
          </div>
          <Mono className="text-[11px] text-ink-muted block break-all">{target?.mcp[0]?.url ?? "connect one to begin"}</Mono>
        </Link>
      </div>
    </aside>
  );
}

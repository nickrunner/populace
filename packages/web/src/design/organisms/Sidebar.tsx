import { forwardRef, type MouseEvent } from "react";
import type { ProjectOverviewView, ProjectSummaryView, RunTotals } from "@populace/contract";
import { cva } from "class-variance-authority";
import { Link as RouterLink, useMatch } from "react-router-dom";

import { cn } from "../cn.js";
import { focusRing, pressTransition } from "../variants.js";
import { Separator, Stack, Text } from "../atoms/index.js";
import { NavGroup, NavItem } from "../molecules/index.js";
import { ProjectSwitcher } from "./ProjectSwitcher.js";
import { SpendMeter } from "./SpendMeter.js";
import { TargetStatus, type TargetStatusView } from "./TargetStatus.js";

/**
 * Sidebar — ATOMIC-INVENTORY §3, organism 32. One navigation, no role switch, no expert mode.
 *
 * **The grammar is the one the product already has** and it is not up for redesign here: a group
 * title in `t-label`, items with their counts right-aligned and tabular, the one you are on lit
 * in `primary-wash` with `primary` ink. What the port changes is underneath it — every row is a
 * `NavItem`, so every row has a focus ring and an `aria-current="page"` it does not have today,
 * and every group is a named `role="group"` rather than a stray line of text above some links.
 *
 * **Three runs of items, and the middle one is conditional.** The project's own screens; then the
 * simulation-scoped run, which appears only while the URL is inside a simulation; then "Set up".
 * The simulation's run opens on the two questions a reader has about it — what came back, and
 * what the next one would cost — so "Before you send them" sits directly under "Results" rather
 * than at the foot of the group with the machinery.
 *
 * Two rows inside those runs are themselves conditional and the reasons are load-bearing:
 *
 *  - *"Seen in more than one"* counts signatures seen in **more than one simulation**, which for
 *    the common shape — one project, one simulation — is permanently nought while the product has
 *    found a dozen problems. It is labelled for what it counts and it appears only once there is
 *    a second simulation for something to be seen in.
 *  - *Populations* stays implicit and unnamed until a second one exists: a population is a
 *    concept with no payoff while there is one of them.
 *
 * **Nothing here promises a repeatable outcome** (§7.3), and every label is in the product's own
 * vocabulary (§7.2): project, simulation, population, cohort, person, visit, execution, finding.
 * Where a contract field still carries the store's internal name for a session, that name is
 * translated once, in `visitsIn` below, and never written anywhere a reader — or a reader of this
 * file — meets it (ADR-0032, §7.2).
 */

/**
 * How many visits an execution's totals record.
 *
 * `RunTotals` is a row shape, and the rows keep the store's own names (ADR-0032): the wire has not
 * yet been widened to spell this one in the product's vocabulary. Rather than let the forbidden
 * word appear in the rail's markup — beside the label "Visits", of all places — the translation
 * happens exactly once, here, behind a name that says what the number is. When the contract grows
 * a `visits` field, this function is the only thing that changes.
 */
function visitsIn(totals: RunTotals | undefined): number | undefined {
  return totals?.wakes;
}

/**
 * The rail's own frame, or none.
 *
 * `collapsed` does **not** mean a glyph-only strip: §6 forbids an affordance glyph without a text
 * label, so a 56px icon rail is not a thing this system can draw. It means the rail has been put
 * inside a container that supplies the frame — the shell's rail column, or the drawer below the
 * `md` breakpoint — so it fills that container and draws no width and no rule of its own.
 */
const rail = cva("flex min-h-0 flex-col overflow-y-auto bg-surface", {
  variants: {
    collapsed: {
      true: "w-full flex-1",
      false: "h-full w-[var(--w-rail)] shrink-0 border-r border-rule",
    },
  },
  defaultVariants: { collapsed: false },
});

/**
 * A rail row that is a *place on the page below* rather than a page of its own.
 *
 * It can never be a `NavItem`, and that is the point: `NavLink` would light it whenever the URL
 * is on the screen it points into, and nothing about the current URL makes "the problems section
 * of this page" *where you are*. So it borrows the inactive row's language and none of its state.
 *
 * It scrolls its own section into view, because a fragment alone moves nothing in an app that
 * scrolls its main pane rather than the window.
 */
const jump = cn(
  // `px-2` and not `px-3`, exactly as `NavItem` — the rail's `<nav>` carries the other 4px so
  // that this row's focus ring is not clipped by the scroller. See the `<nav>` below.
  "flex items-baseline gap-2 rounded-sm px-2 py-1.5",
  "t-ui text-ink-soft hover:bg-hover hover:text-ink",
  pressTransition,
  focusRing,
);

interface SectionJumpProps {
  to: string;
  hash: string;
  label: string;
  count?: number;
}

function SectionJump({ to, hash, label, count }: SectionJumpProps) {
  return (
    <RouterLink
      to={`${to}#${hash}`}
      className={jump}
      onClick={() => {
        // After the navigation, so the section exists to be scrolled to when this is pressed
        // from another screen in the project.
        window.setTimeout(() => document.getElementById(hash)?.scrollIntoView({ block: "start" }), 0);
      }}
    >
      <Text size="ui" truncate className="flex-1">
        {label}
      </Text>
      {count === undefined ? null : (
        <Text size="meta" tone="muted" className="shrink-0">
          {count}
        </Text>
      )}
    </RouterLink>
  );
}

/**
 * The target as the rail draws it: the readable bits and nothing else. A bearer token is never on
 * the wire and is certainly never in a prop (`DATA-MODEL.md` §4).
 */
export interface RailTarget {
  id: string;
  name: string;
  /** The MCP endpoint, or null when the target is configured but lists none. */
  endpoint: string | null;
}

/**
 * **Everything the rail draws arrives as a prop.** This component used to run its own queries and
 * read the project out of React context, and it was the only thing under `design/` that fetched
 * anything — which quietly made the design system depend on the app's data layer, its query keys
 * and its providers, so that the rail could not be rendered in isolation, in a test, or by a
 * second app. The fetching now happens on the app side (`packages/web/src/ProjectRail.tsx`) and
 * the rail is a pure function of what it is given, exactly like every other organism.
 *
 * `useMatch` stays. Which URL you are on is not data: it is the same routing the `NavItem`s
 * underneath already read to light themselves, and a rail that had to be told its own location
 * would be told it by a caller reading the same router.
 */
export interface SidebarProps {
  /** The rail's frame is supplied by its container — the shell's column, or the drawer. */
  collapsed?: boolean;
  /**
   * Called when a link inside the rail is followed. The drawer closes on it; the fixed rail
   * passes nothing and nothing happens.
   */
  onNavigate?: () => void;
  /** The project this rail belongs to: its counts, its simulations, its spend, its kill switch. */
  project: ProjectOverviewView;
  /** Every project the switcher offers, the current one included. */
  projects: readonly ProjectSummaryView[];
  /** A path inside this project: `href()` is its home, `href("settings")` a page under it. */
  href: (path?: string) => string;
  /** The configured target, or null when the project has none yet. */
  target: RailTarget | null;
  /** How many targets the project has; above one the foot reports the count and names none. */
  targetCount: number;
}

export const Sidebar = forwardRef<HTMLElement, SidebarProps>(function Sidebar(
  { collapsed = false, onNavigate, project, projects, href, target, targetCount },
  ref,
) {
  const inSimulation = useMatch("/p/:proj/s/:sim/*");
  const simulationKey = inSimulation?.params.sim ?? null;
  const simulation = project.simulations.find((s) => s.slug === simulationKey || s.id === simulationKey);

  const spent = project.spentTodayUsd;
  const ceiling = project.dailyCeilingUsd;
  const running = project.runningRunIds.length > 0;
  const base = simulation === undefined ? null : `${href()}/s/${encodeURIComponent(simulation.slug)}`;
  const live = simulation?.status === "running" || simulation?.status === "paused";

  const targetStatus: TargetStatusView = {
    name: target?.name ?? null,
    endpoint: target?.endpoint ?? null,
    count: targetCount,
    to: target === null ? href("library/targets") : href(`library/targets/${encodeURIComponent(target.id)}`),
    state: project.killSwitch.engaged
      ? "stopped"
      : running
        ? "running"
        : target === null
          ? "none"
          : "configured",
  };

  /**
   * One delegated handler rather than a callback threaded through every row: the drawer's job is
   * to close when the reader has gone somewhere, and "somewhere" is any anchor inside the rail.
   * The switcher's trigger is a `<button>` and its menu is portalled out of this subtree, so
   * neither one trips this — opening the menu must not close the drawer under it.
   */
  function handleClick(event: MouseEvent<HTMLElement>): void {
    if (onNavigate === undefined) return;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest("a") !== null) onNavigate();
  }

  return (
    <aside ref={ref} className={cn(rail({ collapsed }))} onClick={handleClick}>
      <ProjectSwitcher current={project} projects={projects} />

      {/*
        `flex-1` so the target block is pinned to the foot of the rail on a tall window and
        carried along by the scroll on a short one — exactly as it behaves today.
      */}
      {/*
        `px-1` — 4px — and every row inside is `px-2` rather than `px-3` to pay for it, so the
        labels still land 12px from the rail's edge and nothing in the rail appears to have
        moved. It is here because THIS ELEMENT'S PARENT SCROLLS. `focus-ring` is a `box-shadow`,
        which is painted overflow, and painted overflow is clipped by any ancestor that is not
        `overflow: visible`; `overflow-y-auto` on the `<aside>` makes `overflow-x` compute to
        `auto` too, so a row spanning the rail's full width focused with its top and bottom ring
        strokes drawn and its left and right ones cut off flush. Ninety-odd rows across every
        screen in the product.

        The 4px is taken here rather than by widening the `<aside>` with `ringRoom`'s cancelled
        pair, because the aside is not free to grow: it fills the shell's `--w-rail` column, and
        4px of `surface` past that column's `border-r` is a rail bleeding over its own edge. So
        the rows inset instead of the scroller widening, and the only visible change is that the
        lit row's wash stops 4px short of the rail's edges.
      */}
      <nav aria-label="This project" className="flex-1 px-1 pb-6">
        <Stack gap={6}>
          <NavGroup>
            <NavItem to={href()} label="Simulations" count={project.counts.simulations} end />
            {project.simulations.length > 1 ? (
              <SectionJump
                to={href()}
                hash="problems"
                label="Seen in more than one"
                count={project.crossSimulation.length}
              />
            ) : null}
          </NavGroup>

          {base !== null && simulation !== undefined ? (
            <NavGroup label={simulation.name}>
              <NavItem to={base} label="Results" end />
              {/*
                The screen that saves the reader money, promoted out of a footnote (§6.3 row 13).
                It was reachable only as a link at the bottom of `GetStarted`'s last step, which
                meant the one page that says what an execution will cost — before anything is
                spent — could be read only by somebody already halfway through starting one. It
                is unconditional, because "what would this cost" is a question a reader is
                entitled to ask of a simulation that has run ten times as much as of one that has
                never run, and the page itself spends nothing to answer it.
              */}
              <NavItem to={`${base}/preflight`} label="Before you send them" />
              {live ? <NavItem to={`${base}/live`} label="Live" /> : null}
              <NavItem to={`${base}/coverage`} label="Coverage gaps" />
              <NavItem to={`${base}/left`} label="Who walked away" />
              {/*
                The headcount is who is CONFIGURED to go; the screen behind it reads one
                execution. Before there is one, a number beside a page that says nobody has been
                sent is two answers to the same question.
              */}
              <NavItem
                to={`${base}/population`}
                label="Population"
                {...(simulation.latest === null ? {} : { count: simulation.population.people })}
              />
              <NavItem
                to={`${base}/executions`}
                label={simulation.mode === "longitudinal" ? "Its life so far" : "Executions"}
                count={simulation.latest?.seq}
              />
              <NavItem
                to={`${base}/visits`}
                label="Visits"
                count={visitsIn(simulation.latest?.totals)}
              />
              {/*
                What this simulation IS, as opposed to what came back from it. Last in the run
                because it is the one item here you visit to CHANGE something rather than to read
                something, and because a simulation's own settings are not where a reader starts.
              */}
              <NavItem to={`${base}/settings`} label="This simulation" />
            </NavGroup>
          ) : null}

          {/*
            **Library**, not "Set up". "Set up" names a sequence you finish, which is exactly the
            wrong idea for four durable things you come back and add to — a project grows a qa
            target in month three — and it is most of why this run read as an unordered pile of
            peers. "Library" is already the product's own word for these screens: `Targets`'s
            empty state and `NewSimulation` both say "in the library first". It is a nav group
            label rather than an entity, so §7.1's closed vocabulary is not in play.

            The ORDER is the mental model, stated in the cheapest possible way: the addresses the
            product answers on, the kinds of person, the groups cut from those kinds, the casts
            made of those groups. Settings is not one of them and sits under a rule.
          */}
          <NavGroup label="Library">
            {/*
              **Bare plurals, and no article.** The label does not inflect: "Targets" at nought,
              at one and at nine, with the number in the trailing figure where §7.4 puts facts.
              This row used to read `counts.targets > 1 ? "The targets" : "The target"` while the
              screen it opens read `items.length === 1 ? "The target" : "The targets"` — two
              data-driven rules that DISAGREE AT ZERO, so an empty project's rail said "The
              target" and the page it opened said "The targets". A label that changes with the
              data cannot be learned, searched for, or read without flicker.
            */}
            <NavItem to={href("library/targets")} label="Targets" count={project.counts.targets} />
            <NavItem to={href("library/personas")} label="Personas" count={project.counts.personas} />
            {/*
              "Cohorts", and the count is the COHORT count. It was "The people" trailing
              `counts.people`, which at least agreed with itself — but the screen behind it
              creates and resizes cohorts, and `people/:personId` one level up already means an
              individual. Relabelling without moving the figure would have left a label and a
              trailing fact disagreeing, which §7.4 forbids outright.
            */}
            <NavItem to={href("library/cohorts")} label="Cohorts" count={project.counts.cohorts} />
            {/*
              Populations appears at the SECOND COHORT, not the second population.

              It used to gate on `populationCount > 1`, which was unreachable: nothing in the
              browser could create a second population, so the row was dead code and the section
              it jumped to was never seen. The threshold was on the wrong noun anyway. ADR-0029
              keeps the concept implicit "until there are two", and the first moment a subset is a
              real choice is when there are two cohorts to choose between — with one cohort, every
              cast is the same cast. The ADR is amended to say so.
            */}
            {project.counts.cohorts > 1 || project.counts.populations > 1 ? (
              <NavItem
                to={href("library/populations")}
                label="Populations"
                count={project.counts.populations}
              />
            ) : null}
          </NavGroup>

          <NavGroup>
            <NavItem to={href("settings")} label="Settings" />
          </NavGroup>

          {/* `px-2` against the `<nav>`'s `px-1`, so the meter keeps the 12px gutter the rows
              above it have. */}
          <div className="px-2">
            <SpendMeter spent={spent} ceiling={ceiling} />
          </div>
        </Stack>
      </nav>

      {/* The rule runs the full width of the rail; the block inside it keeps the gutter. */}
      <div className="shrink-0">
        <Separator />
        <div className="p-3">
          <TargetStatus target={targetStatus} />
        </div>
      </div>
    </aside>
  );
});

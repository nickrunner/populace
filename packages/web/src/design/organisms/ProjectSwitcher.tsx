import { forwardRef } from "react";
import type { ProjectSummaryView } from "@populace/contract";

import { cn } from "../cn.js";
import { focusRing, pressTransition } from "../variants.js";
import { Icon, Link, Stack, Text } from "../atoms/index.js";
import { MetaLine } from "../molecules/index.js";
import { DropdownMenu, type DropdownMenuItem } from "./DropdownMenu.js";

/**
 * ProjectSwitcher — ATOMIC-INVENTORY §3, organism 32. The head of the rail.
 *
 * The project's name is the heading of the rail, because a project is the thing everything below
 * it belongs to. The product's own name is not in here at all: it is in the shell's header bar,
 * above the rail, on every screen and as a link.
 *
 * **What changes is not the look, it is that the menu can be closed.** Today this is a
 * `<button aria-expanded>` next to an absolutely positioned `<div>` with a `mousedown` listener
 * on `document` and no Escape handler, no focus trap and no focus return: a keyboard reader can
 * open it and never get out (DESIGN-SYSTEM §6). Radix's `DropdownMenu` supplies Escape, the
 * outside click, focus return to the trigger, typeahead and arrow-key roving — one tab stop for
 * the whole menu rather than one per project.
 *
 * **Two destinations and a menu.** The name opens the menu; the line beneath goes to this
 * project's home. The menu lists every *other* project and ends with the two acts that are not a
 * project — "All projects" and "New project".
 *
 * There used to be a third: the word `populace`, set in the smallest chrome step above the
 * project's name, linking to the projects index. It is gone, and "All projects" in the menu is
 * where that destination lives now. The word was the product's name doing a navigation label's
 * job, in the one place on the screen where the *project's* name is supposed to be the heading —
 * and since `AppShell` grew a header bar with the real lockup in it, a link to the index, the
 * word was also the second brand mark on the same screen.
 *
 * **No heading element.** `PageHeader` owns the page's single `<h1>` (§6, heading order) and the
 * rail is chrome beside it, not above it; a rail that declared an `<h1>` of its own would give
 * every screen in the product two.
 *
 * **Two facts on one line are separated by a hairline, never by a middle dot** (§4.5). Both of
 * this organism's two-fact lines — the count under the project's name, and a project's headcount
 * inside the switcher's menu — are `MetaLine`s. The menu one is why `DropdownMenuItem.label` is a
 * `ReactNode`: a menu row that can only hold a string has nowhere to put the rule, and the dot
 * comes back by default.
 */

/**
 * The trigger keeps the rail's own type and takes the control radius, because it opens
 * something (§5.2). It is never `primary` at rest: the rail's lit thing is where you *are*, and
 * that is a `NavItem` further down.
 */
const trigger = cn(
  "flex w-full items-baseline gap-1.5 rounded-sm text-left",
  "t-name text-ink hover:text-link",
  pressTransition,
  focusRing,
);

export interface ProjectSwitcherProps {
  /** The project the rail is scoped to. */
  current: ProjectSummaryView;
  /** Every project the reader has, including `current`, which is filtered out of the menu. */
  projects: readonly ProjectSummaryView[];
}

/** `/p/checkout`. The slug, encoded, is the one spelling of a project's route. */
function projectHref(project: ProjectSummaryView): string {
  return `/p/${encodeURIComponent(project.slug)}`;
}

function peopleWord(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

function simulationsWord(n: number): string {
  return `${n} ${n === 1 ? "simulation" : "simulations"}`;
}

export const ProjectSwitcher = forwardRef<HTMLDivElement, ProjectSwitcherProps>(
  function ProjectSwitcher({ current, projects }, ref) {
    const others = projects.filter((project) => project.id !== current.id);

    /*
      The headcount rides in the row's own label rather than in a second, count-bearing item shape
      that would fork the organism for one call site — but it rides there as a `MetaLine`, so the
      name and the count are separated by the hairline §4.5 specifies. `textValue` carries the
      project's name to Radix's typeahead, which a nested element would otherwise hide from it.
    */
    const items: readonly DropdownMenuItem[] =
      others.length === 0
        ? [
            { label: "No other projects yet", disabled: true },
            { label: "All projects", to: "/projects" },
            { label: "New project", to: "/projects?new=1" },
          ]
        : [
            ...others.map(
              (project): DropdownMenuItem => ({
                label: (
                  <MetaLine
                    size="ui"
                    facts={[
                      { key: "name", node: <span className="text-ink">{project.name}</span> },
                      { key: "people", node: peopleWord(project.counts.people) },
                    ]}
                  />
                ),
                textValue: project.name,
                to: projectHref(project),
              }),
            ),
            { label: "All projects", to: "/projects" },
            { label: "New project", to: "/projects?new=1" },
          ];

    return (
      <div ref={ref} className="px-3 py-4">
        <Stack gap={1}>
          <DropdownMenu
            label="Projects"
            items={items}
            trigger={
              <button type="button" className={trigger}>
                <Text size="name" truncate className="min-w-0 flex-1">
                  {current.name}
                </Text>
                {/*
                  The glyph is not the carrier of anything: Radix puts `aria-haspopup` and
                  `aria-expanded` on the trigger, and the name beside it says what opens
                  (§6, icons).
                */}
                <Icon name="chevron-down" size={12} className="shrink-0 text-ink-muted" />
              </button>
            }
          />

          {/*
            The project's own words if it has any; otherwise what it is made of, as two facts with
            the rule between them (§4.5). Either way the line is the second destination — this
            project's home — so the `MetaLine` sits inside the link rather than beside it.
          */}
          <Link to={projectHref(current)} size="meta" tone="quiet" className="block truncate">
            {current.description || (
              <MetaLine
                facts={[
                  { key: "people", node: peopleWord(current.counts.people) },
                  { key: "simulations", node: simulationsWord(current.counts.simulations) },
                ]}
              />
            )}
          </Link>
        </Stack>
      </div>
    );
  },
);

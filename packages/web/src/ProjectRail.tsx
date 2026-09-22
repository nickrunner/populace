import { useQuery } from "@tanstack/react-query";

import { Sidebar } from "./design/index.js";
import { q } from "./queries.js";
import { useProject } from "./context.jsx";

/**
 * ProjectRail — the app's navigation rail: `Sidebar` with the project's own data behind it.
 *
 * `Sidebar` used to do this itself, and it was the only component under `packages/web/src/design/`
 * that fetched anything. A design system that imports the app's query keys and the app's React
 * context is not a design system any more: the rail could not be rendered in a test, in a
 * storybook, or by a second app, and every screen that mounted it inherited three queries it had
 * not asked for. So the seam is here, in the app, where the data layer already lives — one small
 * component whose entire job is to turn queries into props.
 *
 * It is deliberately NOT in `design/`. The rule it keeps is the same one `AppShell` keeps: a
 * template and an organism own layout and behaviour; the app owns where the numbers come from.
 *
 * **Where the mark went, and why it is no longer here.** This component used to open with a 20px
 * `Mark` linking to `/`, because the rail was the only chrome a wide product screen had and the
 * product wore its name nowhere else. `AppShell` now draws a header bar on every screen at every
 * width, with the 168px lockup in it and that lockup a link (see the shell's item 7), so a mark
 * here would be the second lockup on the same screen pointing at a different address — two
 * answers to "where does this take me". The rail starts at the project's name again, which is
 * what DESIGN-SYSTEM §7.2 asks of it: the *project* is the heading of this rail.
 *
 * **It reads two queries, not three.** The populations query went when `counts.populations`
 * arrived on the project payload: the rail was fetching a whole list to learn its length, for a
 * row that gated on a condition nothing could satisfy.
 *
 * **The frame is the container's, and only the container's.** The mark needed a box to sit in, so
 * this component wrapped `Sidebar` in one — and that box carried `w-[var(--w-rail)]` and
 * `border-r` while the shell's own rail column carried them too, which is a second 236px width
 * and a second hairline inside the first. With the mark gone there is nothing left to wrap, so
 * the rail is handed straight to whatever holds it (the shell's column at `md` and up, the drawer
 * below it) and fills it — which is what `collapsed` has always meant.
 */
export interface ProjectRailProps {
  /** Called when a link inside the rail is followed, so a drawer can close behind it. */
  onNavigate?: () => void;
}

export function ProjectRail({ onNavigate }: ProjectRailProps) {
  const { key, project, href } = useProject();
  const projects = useQuery(q.projects());
  const targets = useQuery(q.targets(key));

  const first = targets.data?.items[0];

  return (
    <Sidebar
      collapsed
      onNavigate={onNavigate}
      project={project}
      projects={projects.data?.items ?? []}
      href={href}
      // The readable bits of the target and nothing else: a bearer token is not on the wire and
      // is certainly not in a prop (`DATA-MODEL.md` §4).
      target={
        first === undefined
          ? null
          : { id: first.id, name: first.name, endpoint: first.mcp[0]?.url ?? null }
      }
      targetCount={targets.data?.items.length ?? 0}
    />
  );
}

import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";

import { cn, focusRing, Mark, pressTransition, Sidebar } from "./design/index.js";
import { q } from "./queries.js";
import { useProject } from "./context.jsx";

/**
 * ProjectRail — the app's navigation rail: `Sidebar` with the project's own data behind it, and
 * the product's own mark above it.
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
 * **Where the mark went, and why here.** The rail is the product's own chrome and it carried no
 * artwork at all — the word `populace` in the switcher's smallest type was the whole of the
 * brand inside `/app`. DESIGN-SYSTEM §7.2 makes the *project's name* the heading of this rail,
 * so the product's name cannot be the loudest thing in it: the mark goes in above everything,
 * **20px**, on the rail's own left gutter, with the switcher's 16px of air under it. That is the
 * standalone mark and not the horizontal lockup because the lockup's floor is 160px of a 236px
 * rail (§8.3, and the kit's "below that, use the standalone mark") — at which width it would be
 * the loudest thing on the screen and the project's name the second.
 *
 * It is a link to `/`, the public page. The `populace` word inside the switcher below it goes
 * somewhere else — the index of every project — so the two carry their own names rather than
 * sharing one, and the artwork itself is decorative inside the link that names it.
 *
 * The mark is placed here rather than inside `Sidebar` for the same reason the queries are: the
 * organism draws a rail out of what it is given, and *whose* rail it is — which product, linking
 * where — is the app's to say.
 *
 * **The frame moved out one level with it.** `Sidebar` draws its own width and border only when
 * nothing around it does; because this component now wraps it, the wrapper takes that frame and
 * the rail fills it. The classes are `Sidebar`'s own, unchanged, so the fixed column at `md` and
 * the drawer below it both look exactly as they did.
 */
export interface ProjectRailProps {
  /** The rail's frame comes from its container — the shell's column, or the drawer. */
  collapsed?: boolean;
  /** Called when a link inside the rail is followed, so a drawer can close behind it. */
  onNavigate?: () => void;
}

export function ProjectRail({ collapsed = false, onNavigate }: ProjectRailProps) {
  const { key, project, href } = useProject();
  const projects = useQuery(q.projects());
  const targets = useQuery(q.targets(key));
  const populations = useQuery(q.populations(key));

  const first = targets.data?.items[0];

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col bg-surface",
        collapsed ? "w-full flex-1" : "h-full w-[var(--w-rail)] shrink-0 border-r border-rule",
      )}
    >
      {/*
        In flow and above the scroller, never over it: the rail scrolls its navigation on a short
        window, and a mark pinned in the corner would have counts sliding under it. `shrink-0` so
        it keeps its line when the rest is squeezed.
      */}
      <div className="shrink-0 px-3 pt-3">
        <RouterLink
          to="/"
          aria-label="Populace, home"
          className={cn("inline-flex rounded-sm", pressTransition, focusRing)}
        >
          <Mark size="sm" on="surface" label={null} />
        </RouterLink>
      </div>

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
        populationCount={populations.data?.items.length ?? 0}
      />
    </div>
  );
}

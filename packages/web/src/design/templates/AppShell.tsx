import { useEffect, useRef, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as VisuallyHiddenPrimitive from "@radix-ui/react-visually-hidden";
import { useLocation } from "react-router-dom";

import { cn } from "../cn.js";
import { surfaceBase } from "../variants.js";
import { Button, SkipLink } from "../atoms/index.js";
import { Logo } from "../brand/index.js";
import { TooltipProvider } from "../atoms/Tooltip.js";
import { ThemeToggle } from "../molecules/index.js";
import { ToastRegion } from "../organisms/index.js";
import { RouteAnnouncer } from "./RouteAnnouncer.js";

/**
 * AppShell — ATOMIC-INVENTORY §4, template 1. Everything in the product renders inside this.
 *
 * It owns seven things and no others. A template owns layout, max-width, heading placement and the
 * state slot; it fetches nothing and it knows no product nouns.
 *
 *  1. **The skip link**, as the first focusable element on the page (§6). The rail is thirty-odd
 *     tab stops wide, and without this, reaching the transcript on a keyboard means traversing
 *     every one of them on every single route.
 *  2. **The `<main>` landmark**, with `tabindex="-1"` so focus can be *put* there, and the app's
 *     one scroll container. `PageHeader` owns the single `<h1>` inside it; this template declares
 *     no heading of its own, so every screen's heading order starts where it should (§6).
 *  3. **`RouteAnnouncer`**, and the focus move that goes with it. React Router moves neither
 *     focus nor the reading position; between them these two do both.
 *  4. **The toast viewport, mounted exactly once.** `ToastRegion` is both the Radix provider
 *     every `Toast` needs and the single viewport they all portal into, so a toast rendered
 *     anywhere beneath the shell lands in one stack with one tab stop.
 *  5. **The theme toggle's placement**: the foot of the rail on a wide window, the top bar on a
 *     narrow one — and the top bar at every width when there is no rail to sit in. Exactly one of
 *     the two is ever rendered, because two of the same control on one screen is two answers to
 *     one question.
 *  6. **The tooltip provider, mounted exactly once**, for the same reason as the toast viewport.
 *     `skipDelayDuration` is a property of a *group* of triggers — move along a toolbar of
 *     `IconButton`s and the second tooltip should open instantly — and a provider per tooltip
 *     has one trigger under it, so the window never applies.
 *  7. **The lockup on a railless screen.** The rail is where the product wears its name, so a
 *     screen without one wore it nowhere: `/projects` shipped with no artwork on it at all. When
 *     there is no rail the header bar stays at every width and carries §8.3's sidebar-header
 *     lockup, and the empty rail column is not drawn.
 *
 * **The rail becomes a drawer below `md`.** DESIGN-SYSTEM §5.3 names 900px for that switch and
 * the token set has no 900px breakpoint — the four are 640 / 860 / 1000 / 1240 — so it happens at
 * `--breakpoint-md`, 860px, the nearest of them and the same threshold at which the ledger stub
 * collapses. The drawer is a Radix `Dialog`, so Escape, the focus trap and focus return to the
 * trigger all come free (§6), and it closes on a navigation as well, because a rail still
 * covering the screen you just asked for is a rail in the way.
 *
 * **No route transition** (§5.1). The page is there or it is not.
 */

export interface AppShellProps {
  /**
   * The navigation rail — the app's `ProjectRail`, which is `Sidebar` with its data behind it.
   * The shell renders it twice (the fixed column at `md` and up, the drawer below it) and knows
   * nothing else about it.
   *
   * It is a prop rather than a rail mounted in here because a template fetches nothing: the
   * rail's data comes from the app, so the app composes the rail and hands it over. Without one
   * the shell draws the frame and no navigation, which is what a route outside a project wants.
   */
  rail?: ReactNode;
  children: ReactNode;
}

/** The id the skip link jumps to, and the landmark the announcer reads the heading out of. */
const MAIN_ID = "main";

/**
 * The rail's own box, drawn once and used twice: by the fixed column at `md` and up, and by the
 * drawer panel below it. The `rail` prop fills whichever of the two it is given.
 */
const RAIL = "flex min-h-0 flex-col bg-surface";

/**
 * The drawer travels in from the edge it is anchored to, per §5.1's overlay tempo: 240ms in on
 * `--ease`, 180ms — 0.75× — out on `--ease-exit`. The scrim only fades; a moving backdrop drags
 * the eye away from the thing it exists to reveal.
 *
 * Under `prefers-reduced-motion` theme.css collapses the durations to 0.01ms and
 * `animation-fill-mode: both` holds the final frame, so the rail simply appears.
 */
const DRAWER_CSS = `
.populace-drawer[data-state="open"] {
  animation: populace-drawer-in var(--dur-enter) var(--ease) both;
}
.populace-drawer[data-state="closed"] {
  animation: populace-drawer-out calc(var(--dur-enter) * 0.75) var(--ease-exit) both;
}
.populace-drawer-scrim[data-state="open"] {
  animation: populace-drawer-scrim-in var(--dur-enter) var(--ease) both;
}
.populace-drawer-scrim[data-state="closed"] {
  animation: populace-drawer-scrim-out calc(var(--dur-enter) * 0.75) var(--ease-exit) both;
}

@keyframes populace-drawer-in {
  from { opacity: 0; transform: translateX(-16px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes populace-drawer-out {
  from { opacity: 1; transform: translateX(0); }
  to   { opacity: 0; transform: translateX(-16px); }
}
@keyframes populace-drawer-scrim-in  { from { opacity: 0; } to { opacity: 1; } }
@keyframes populace-drawer-scrim-out { from { opacity: 1; } to { opacity: 0; } }
`;

export function AppShell({ rail, children }: AppShellProps) {
  /*
    A railless shell is a whole screen with no chrome down its left-hand side, so the one place
    the product wears its name is not rendered at all — `/projects`, the product's own index, had
    no artwork on it anywhere. Railless is therefore not merely "the rail is missing": it is the
    header bar becoming the brand's site, at every width rather than only below `md`.
  */
  const railless = rail === undefined;
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);

  // Focus follows the route into the content (§6). Not on the first paint: the browser has just
  // read the document, and taking focus over that is a stutter rather than a courtesy.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    main.current?.focus();
  }, [pathname]);

  // A navigation closes the drawer. The delegated listener on the drawer's contents covers the
  // rest: a link back to the screen the reader is already on changes no pathname, and would
  // otherwise leave the rail standing over the answer.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <TooltipProvider>
      <ToastRegion>
        {/* The first focusable thing in the document, before the rail and before the drawer. */}
        <SkipLink targetId={MAIN_ID} />
        <RouteAnnouncer mainId={MAIN_ID} />

        <div className="flex h-full min-h-0 flex-col">
          {/*
            The bar. With a rail it is the narrow-window one, holding the two controls the rail
            took with it — the way back to the navigation, and the theme — and it is gone at `md`
            where the rail itself is back. Without a rail it stays at every width, because it is
            then the only chrome on the screen and the only thing carrying the product's name.

            Its gutter matches the page frame's (`px-4 md:px-8`) in that case, so the lockup hangs
            on the same left edge the heading under it does rather than on an inset of its own.
          */}
          <header
            className={cn(
              "flex shrink-0 items-center gap-3 border-b border-rule bg-surface py-2",
              railless ? "px-4 md:px-8" : "px-3 md:hidden",
            )}
          >
            {/*
              The lockup, on a railless shell only — §8.3's sidebar-header entry, which is the
              168px horizontal logo (`size="md"`). A railless page has the whole width rather than
              a 236px rail, so it takes the lettered lockup rather than the bare mark the rail's
              own head uses. `on="surface"` is the bar's ground and the component picks the cut;
              nothing here asks which theme it is in. It is named rather than decorative: on these
              routes there is no other artwork and no rail naming the product.
            */}
            {railless ? <Logo size="md" on="surface" /> : null}
            {/*
              No rail, no way in to one. A railless shell is what a route outside a project wants
              — the projects index, a 404, a shell whose record did not load — and a "Menu" that
              opens an empty panel is a control that names something that is not there. The theme
              toggle below is the bar's other reason to exist and it stays either way.
            */}
            {railless ? null : (
            <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
              <DialogPrimitive.Trigger asChild>
                <Button variant="quiet" size="sm">
                  Menu
                </Button>
              </DialogPrimitive.Trigger>

              <DialogPrimitive.Portal>
                {/*
                  The scrim, as a wash of a token rather than of a hard-coded ground, and spelled
                  twice because it must DARKEN: in light the darkest token is `ink`; in dark, `ink`
                  is the paper-coloured text and `sunk` is the one token below the page ground.
                  The same recipe `Dialog` uses — two scrims a few percent apart read as a bug.
                */}
                <DialogPrimitive.Overlay
                  className={cn(
                    "populace-drawer-scrim fixed inset-0 z-[var(--z-dialog)]",
                    "bg-ink/45 dark:bg-sunk/75",
                  )}
                />
                <DialogPrimitive.Content
                  className={cn(
                    "populace-drawer",
                    RAIL,
                    surfaceBase({ level: "overlay" }),
                    "fixed inset-y-0 left-0 z-[var(--z-dialog)] outline-none",
                    // Only the edge the reader can see is drawn, and only the corners that are on
                    // screen are rounded (§5.2).
                    "border-y-0 border-l-0 rounded-none rounded-r-md",
                    "w-[min(var(--w-rail),calc(100vw-3rem))]",
                  )}
                >
                  {/*
                    Radix requires a title on every dialog. The rail names itself in its contents,
                    so this one is for the screen reader alone.
                  */}
                  <VisuallyHiddenPrimitive.Root asChild>
                    <DialogPrimitive.Title>Navigation</DialogPrimitive.Title>
                  </VisuallyHiddenPrimitive.Root>
                  {/*
                    The rail, given to us. The drawer closes when a link inside it is followed:
                    one delegated listener rather than a callback the shell has to thread into
                    something it did not build. A same-route link changes no pathname, so the
                    effect above would not otherwise fire and the rail would stand over the
                    answer. The switcher's trigger is a `<button>` and its menu portals out of
                    this subtree, so opening it does not close the drawer under it.
                  */}
                  <div
                    className="contents"
                    onClick={(event) => {
                      if (!(event.target instanceof Element)) return;
                      if (event.target.closest("a") !== null) setDrawerOpen(false);
                    }}
                  >
                    {rail}
                  </div>
                </DialogPrimitive.Content>
              </DialogPrimitive.Portal>
            </DialogPrimitive.Root>
            )}

            <div className="ml-auto">
              <ThemeToggle compact />
            </div>
          </header>

          <div className="flex min-h-0 flex-1">
            {/*
              The fixed rail. This div is the column and the rail is its scrolling contents,
              which is what lets the theme toggle sit at the foot of the rail without scrolling
              away with the navigation above it.
            */}
            {/*
              Railless, there is no column: an empty 236px of `surface` with a theme toggle at the
              foot of it is a rail drawn around nothing. The toggle is in the bar above instead,
              which is exactly the rule this template already keeps — one of the two, never both.
            */}
            {railless ? null : (
              <div className={cn(RAIL, "hidden h-full w-[var(--w-rail)] shrink-0 border-r border-rule md:flex")}>
                {rail}
                <div className="shrink-0 border-t border-rule px-3 py-3">
                  <ThemeToggle compact />
                </div>
              </div>
            )}

            {/*
              The app's one scroll container, and the landmark focus lands in.

              It carries no gutter, no cap and no padding of its own, deliberately. `DocumentPage`
              and its siblings own the page frame — `--w-page`, the gutter pair and the vertical
              rhythm — and a second cap here would halve the measure and double the gutters on
              every screen in the product. The shell owns the scrolling and the rail; the templates
              own the frame.

              `outline-none` is legal here and nowhere else: `<main>` is not in the tab order —
              `tabindex="-1"` means it can only ever be focused programmatically, by the route
              effect above — so this is not one of §6's focusable controls, and a 2px ring drawn
              around the entire viewport on every navigation would be an alarm about nothing.
            */}
            <main
              ref={main}
              id={MAIN_ID}
              tabIndex={-1}
              className="min-h-0 flex-1 overflow-y-auto outline-none"
            >
              {children}
            </main>
          </div>
        </div>

        {/* React 19 hoists and de-duplicates this by `href`, so the shell emits one rule set. */}
        <style href="populace-drawer" precedence="medium">
          {DRAWER_CSS}
        </style>
      </ToastRegion>
    </TooltipProvider>
  );
}

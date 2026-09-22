import { useEffect, useRef, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as VisuallyHiddenPrimitive from "@radix-ui/react-visually-hidden";
import { Link as RouterLink, useLocation } from "react-router-dom";

import { cn } from "../cn.js";
import { focusRing, pressTransition, surfaceBase } from "../variants.js";
import { Button, SkipLink } from "../atoms/index.js";
import { Logo, Mark } from "../brand/index.js";
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
 *  5. **The theme toggle**, in the header bar, on every screen and at every width. It used to
 *     move — the foot of the rail on a wide window, the bar on a narrow one — which meant the
 *     one control a reader learns the position of was in two positions. One site, always.
 *  6. **The tooltip provider, mounted exactly once**, for the same reason as the toast viewport.
 *     `skipDelayDuration` is a property of a *group* of triggers — move along a toolbar of
 *     `IconButton`s and the second tooltip should open instantly — and a provider per tooltip
 *     has one trigger under it, so the window never applies.
 *  7. **The header bar, and the lockup in it — on every screen, at every width, and a link.**
 *     This is the one that changed. The bar used to be `md:hidden` whenever there was a rail, so
 *     a wide product screen had no bar at all and wore the product's name only as a 20px mark
 *     tucked into the head of the rail; and on a railless screen the bar did carry the lockup but
 *     carried it as *artwork* — a `<Logo>` with nothing around it, so clicking the product's name
 *     did nothing. Both are gone. The bar is unconditional, the lockup is always in it, and it is
 *     always a `RouterLink` to `HOME` below. The rail no longer draws a mark of its own, because
 *     two lockups on one screen is two answers to "where does this take me".
 *
 * **The rail becomes a drawer below `md`.** DESIGN-SYSTEM §5.3 names 900px for that switch and
 * the token set has no 900px breakpoint — the four are 640 / 860 / 1000 / 1240 — so it happens at
 * `--breakpoint-md`, 860px, the nearest of them and the same threshold at which the ledger stub
 * collapses. The drawer is a Radix `Dialog`, so Escape, the focus trap and focus return to the
 * trigger all come free (§6), and it closes on a navigation as well, because a rail still
 * covering the screen you just asked for is a rail in the way.
 *
 * **What the bar deliberately does not hold.** No search, no account menu, no breadcrumb and no
 * page title: the `<h1>` belongs to `PageHeader` inside `<main>` (§6, heading order), and a bar
 * that repeated it would give every screen two. Three things and no others — the way back into
 * the navigation on a narrow window, the product's name as the way home, and the theme.
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
 * Where the lockup goes, and why it is not `/`.
 *
 * `/` is the public landing page — the brochure. A reader who is inside the product and clicks
 * the product's name is asking to go up, not out, and landing on the marketing site is the most
 * disorienting thing that address could do. `/projects` is the product's own top: the index of
 * every project this install has, and the one screen that is above all the others rather than
 * beside them. The public pages keep their own lockup, in `MarketingShell`, and that one does
 * point at `/`, because there it IS home.
 */
const HOME = "/projects";

/** The lockup's hit area: a link, so it takes the control radius, the press and the ring (§5.2, §6). */
const LOCKUP_LINK = cn("inline-flex shrink-0 rounded-sm", pressTransition, focusRing);

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
            The bar, on every screen and at every width. It used to be `md:hidden` whenever there
            was a rail, on the argument that a wide product screen has the rail and needs nothing
            above it — which left the product with two different frames depending on the window,
            and left the wide one with no place to wear its own name but a 20px mark inside the
            navigation. One bar, always, is the frame; what is *in* it still varies by exactly one
            control, the drawer trigger, which has nothing to open when there is no rail.

            Its gutter follows what is underneath it. Railless, that is the page frame
            (`px-4 md:px-8`), so the lockup hangs on the same left edge as the heading below it.
            With a rail it is the rail's own `px-3`, so the lockup sits over the rail's content
            column rather than on an inset of its own.
          */}
          <header
            className={cn(
              "flex shrink-0 items-center gap-3 border-b border-rule bg-surface py-2",
              railless ? "px-4 md:px-8" : "px-3",
            )}
          >
            {/*
              The way back into the navigation, on a narrow window. It leads the bar because that
              is where a reader reaches for it, and it is `md:hidden` because at `md` the rail it
              opens is already on the screen — one of the two, never both.

              Railless there is nothing to open, and a "Menu" that opens an empty panel is a
              control that names something that is not there, so it is not rendered at all.
            */}
            {railless ? null : (
            <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
              <DialogPrimitive.Trigger asChild>
                <Button variant="quiet" size="sm" className="md:hidden">
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

            {/*
              The product's name, and the way home. It is a LINK, which is the whole point of this
              bar: a lockup that goes nowhere is a sticker. The link carries the accessible name
              and the artwork inside it is therefore decorative (`label={null}`) — two names for
              one destination is the commonest way a logo goes wrong for a screen reader. On
              `HOME` itself it is still a link, but `aria-current="page"` stops it claiming to
              lead anywhere new.

              **Two lockups, and the cascade picks**, the same way `Logo` picks between the light
              and the dark cut. At `md` and up it is §8.3's sidebar-header entry, the 168px
              horizontal logo, which fits the 236px rail's content column with its clear space and
              has the whole width to itself on a railless page. Below `md` it is §8.3's
              mobile-header entry, the 24px mark: the bar there also holds the drawer trigger and
              the theme toggle, and 168px of lettering between them is more than a 360px phone
              has. This is a media query rather than a branch in TypeScript because the window can
              be resized after paint, and a component that had asked how wide it was would have to
              re-render to find out it was wrong. `hidden` is `display: none`, so exactly one of
              the two is in the accessibility tree as well as on the page — and both are
              `aria-hidden` regardless, because the link above them is what has the name.
            */}
            <RouterLink
              to={HOME}
              aria-label="Populace, your projects"
              aria-current={pathname === HOME ? "page" : undefined}
              className={LOCKUP_LINK}
            >
              <Mark size="md" on="surface" label={null} className="md:hidden" />
              <Logo size="md" on="surface" label={null} className="hidden md:inline-block" />
            </RouterLink>

            {/*
              The theme, at the right-hand end of the bar on every screen. It used to live at the
              foot of the rail on a wide window and here on a narrow one, which put the one
              control whose position a reader memorises in two positions. One site, always.
            */}
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
              Railless, there is no column: an empty 236px of `surface` is a rail drawn around
              nothing, and the bar above is then the only chrome on the screen.

              The theme toggle used to sit at the foot of this column. It is in the bar now, at
              every width — see the bar above — so the column holds the navigation and nothing
              else, and the rail's scroll runs the full height of it.
            */}
            {railless ? null : (
              <div className={cn(RAIL, "hidden h-full w-[var(--w-rail)] shrink-0 border-r border-rule md:flex")}>
                {rail}
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

import { forwardRef, useEffect, useRef, type ReactNode } from "react";
import { Link as RouterLink, useLocation } from "react-router-dom";

import { cn } from "../cn.js";
import { focusRing, pressTransition } from "../variants.js";
import { Link, Measure, Separator, SkipLink, Text } from "../atoms/index.js";
import { Logo, Mark } from "../brand/index.js";
import { ThemeToggle } from "../molecules/index.js";
import { RouteAnnouncer } from "./RouteAnnouncer.js";

/**
 * MarketingShell — ATOMIC-INVENTORY §4, template 8. Five screens: `Landing` at `/`, and the four
 * public pages at `/how-it-works`, `/concepts`, `/use-cases` and `/why-agents`.
 *
 * The public route's frame, and the one place in the product where **the window scrolls rather
 * than a pane**: there is no `AppShell`, no sidebar and no scrolling `<main>` inside a grid. The
 * page is a document in a browser, which is what a marketing page is.
 *
 * What it owns (DESIGN-SYSTEM §9):
 *
 *  - **`--w-landing`, left-aligned.** 1080px, centred as a *measure* with every line inside it
 *    ranged left. A centred landing is a brochure and this product is a readout (§9.2).
 *  - **No spine, and no stub column.** This shell used to draw `LedgerSpine` — one continuous
 *    hairline at `--w-stub` + 3px running the full height of the page — on the argument that the
 *    landing and the product should be visibly the same instrument. **That argument was wrong,
 *    and the rule is gone.** A ledger spine is the right edge of a *stub column*: it exists to
 *    give a column of locators — a rank, a call ref, an execution number — one alignment edge, so
 *    a reader can run an eye down it. A marketing page has no locators and therefore no stub, so
 *    the line aligned nothing. What it did instead was cross every section heading on the page at
 *    a fixed 75px, which reads as a stray rule slicing the headings rather than as structure.
 *    The instrument's signature survives where it means something (`Ledger`, `DataTable`, the
 *    transcript) and the public pages sit in an ordinary reading column. §9.2 is amended to
 *    match. **Do not reintroduce it here**, and do not reintroduce the geometry either: nothing
 *    in these five screens should indent to `--w-stub`.
 *  - **The transparent nav.** No fill, no shadow, no sticky bar: the wordmark, the four public
 *    pages, one link into the product, and the page begins. The hero is paper, not a forest cover
 *    (§9.3), and a chrome bar over it would be the first thing to say otherwise.
 *
 *    **What the four page links are allowed to cost.** They are `tone="quiet"` at the `ui` step —
 *    `ink-soft` glyphs on a `rule-strong` underline — so the only emphatic link in the header is
 *    still the one that goes into the product. No pill, no fill, no separator, no dropdown, no
 *    hover panel, and no `position: sticky`: the reason this bar has no ground is that whatever
 *    the page puts under it is the first fill on the page, and four more words at the soft ink do
 *    not change that. A wrap, on a narrow window, is the layout — there is no hamburger, because
 *    a menu button is chrome and this bar's whole argument is that it is not chrome.
 *
 *    **The current page is not a link.** It is the label alone, at full `ink`, carrying
 *    `aria-current="page"`. That is two channels rather than a hue — the present item is darker
 *    *and* is the only one without an underline — which is §1.3 rule 4, and it is also simply
 *    true: you cannot navigate to where you are. `/` is marked on the wordmark, which is the
 *    landing's only entry in this bar.
 *  - **Route announcement and the focus move**, exactly as `AppShell` does them and with the same
 *    two components. React Router moves neither focus nor the reading position, so without these
 *    a navigation between the five public pages announces nothing and leaves focus in the header
 *    — the reader tabs forward and is still in the nav bar of a page they have already left.
 *    Neither fires on the first paint: the browser has just read the document.
 *  - **The footer**, per §9.8: the 24px mark, the descriptor verbatim, one row of links and the
 *    theme toggle. The row is the four public pages plus the one way into the product — the site,
 *    and the door — and that is the whole set. It shipped seven links for a five-page site, two
 *    of which ("Your projects", "Back to top") said nothing the page above them had not already
 *    said. §9.8's "three links" is amended to name this set, since which links a footer carries
 *    follows from how many pages there are. Still no newsletter, no logo strip and no
 *    testimonials: the product has none of those and inventing them is the fastest way to look
 *    generated.
 *
 * **"Agents", and where the line is.** `/why-agents` is a brand surface and the approved brand
 * messaging uses the word, so the nav label says it. That is the carve-out's whole extent: this
 * template is mounted by the five public screens and by nothing under `/app` (§4's template table
 * names its screens, and `AppShell` is the product's frame), so the word reaches no product UI
 * from here. **If this shell is ever rendered inside the product, that label goes first** — in
 * product copy the words are project, simulation, population, cohort, person, visit, execution
 * and finding, and there is no exception.
 *
 * **`radius-lg` is legal here and nowhere else** (§5.2, §1.3 rule 8), and the shell *owns* it
 * rather than merely permitting it: `LANDING_PANEL` below is the one spelling of the 20px corner
 * in the product. The hero panel, the diagram plates and the final CTA are the screen's to place,
 * but they take the radius from here, so `rounded-lg` appears once instead of four times and a
 * 20px corner inside `/app` has nowhere to have been copied from. A `rounded-lg` written by hand
 * anywhere is a review stop.
 *
 * **The lockups follow §8.3, and this template no longer spells them.** It used to carry four
 * `<img>` tags and two hand-written light/dark pairs; it now asks `Logo` and `Mark` for artwork
 * on a named ground and gets the kit's rules — which cut is legal on which ground, the 160px
 * floor, the circle-diameter of clear space, the intrinsic dimensions that stop a flex row
 * squashing the mark — without restating one of them. The flip is still CSS and only CSS: both
 * artworks are in the DOM and the cascade picks, because the theme can change after paint and a
 * component that asked which theme it was in would have to re-render to find out.
 */

/** The landing measure. Centred as a column; nothing inside it is centred. */
const FRAME = "mx-auto w-full max-w-[var(--w-landing)] px-4 md:px-8";

/** The id the skip link jumps to, the announcer reads out of, and the focus move lands in. */
const MAIN_ID = "main";

/**
 * **The landing's 20px corner**, and the only place `radius-lg` is written (§4's template table
 * names it as one of the two things this shell owns). The hero panel, the diagram plates and the
 * final CTA compose it; nothing under `/app` may import it, because outside this route a 20px
 * radius is not a scale of the container radius but a different kind of object (§5.2).
 */
export const LANDING_PANEL = "rounded-lg";

/**
 * The four public pages, in the order a reader meets them: the mechanism, then the words, then
 * the evidence, then the case and its costs. The landing is deliberately absent — it is the
 * wordmark, which every one of these pages already carries at the top left.
 *
 * Declared once and rendered twice, by the header and by the footer, so the two can never come to
 * disagree about which pages exist. `as const` keeps `to` a literal union, which is what lets the
 * current-page test below be an ordinary string comparison rather than a cast.
 */
const PAGES = [
  { to: "/how-it-works", label: "How it works" },
  { to: "/concepts", label: "Concepts" },
  { to: "/use-cases", label: "Use cases" },
  { to: "/why-agents", label: "Why agents" },
] as const;

/**
 * One item in either bar. A link everywhere except on its own page, where it is the label alone
 * with `aria-current="page"` — see the header note above for why that is two channels and not a
 * hue.
 *
 * `size` is passed through rather than fixed because the two bars sit at two steps: the header at
 * `ui`, the footer at `meta`, which is what the footer's existing links are already set at.
 */
function PageLink({
  to,
  label,
  current,
  size,
}: {
  to: string;
  label: string;
  current: boolean;
  size: "ui" | "meta";
}) {
  if (current)
    return (
      <span aria-current="page" className="inline-flex">
        <Text size={size} tone="ink">
          {label}
        </Text>
      </span>
    );
  return (
    <Link to={to} size={size} tone="quiet">
      {label}
    </Link>
  );
}

export interface MarketingShellProps {
  children: ReactNode;
}

export const MarketingShell = forwardRef<HTMLDivElement, MarketingShellProps>(
  function MarketingShell({ children }, ref) {
    // The one read of the router this template makes for its own layout. `useLocation` rather
    // than `NavLink`'s own `isActive`, because what the bars need is a boolean they can render
    // two different ELEMENTS from — a link, or a label that is not one — and `NavLink` can only
    // vary a class. The focus effect below reads the same value.
    const { pathname } = useLocation();
    const onLanding = pathname === "/";

    const main = useRef<HTMLElement>(null);
    const first = useRef(true);

    // Focus follows the route into the content (§6), the same move `AppShell` makes. Not on the
    // first paint: the browser has just read the document, and taking focus over that is a
    // stutter rather than a courtesy.
    useEffect(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      main.current?.focus();
    }, [pathname]);

    return (
      <div ref={ref} className="min-h-full bg-bg">
        {/* The first focusable thing on the page, here as in `AppShell`. */}
        <SkipLink targetId={MAIN_ID} />
        {/* The half of a route change a screen reader can hear. Mounted from the first render. */}
        <RouteAnnouncer mainId={MAIN_ID} />

        <header
          className={cn(
            FRAME,
            // `flex-wrap`, and no hamburger: below `md` the nav drops to its own line under the
            // lockup and the bar grows by one row. A menu button would be the chrome this bar
            // exists not to have.
            "flex flex-wrap items-center justify-between gap-x-8 gap-y-4 py-6 md:py-8",
          )}
        >
          <RouterLink
            to="/"
            aria-label="Populace, home"
            // The landing's own entry in this bar. It is not repeated as a word beside the four
            // pages, so it is marked here or nowhere.
            aria-current={onLanding ? "page" : undefined}
            className={cn("inline-flex shrink-0 rounded-sm", pressTransition, focusRing)}
          >
            {/*
              The nav lockup at the kit's 160px floor, on the page's own ground. The link already
              names itself, so the artwork is decorative — `label={null}` — rather than offering
              a second accessible name for the same destination.
            */}
            <Logo size="sm" on="paper" label={null} />
          </RouterLink>

          {/*
            Named, because a document with two `<nav>`s owes each of them a name or a screen
            reader's landmark list reads "navigation, navigation". This one is the pages; the
            footer's is the whole site.
          */}
          <nav aria-label="Pages" className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {PAGES.map((page) => (
              <PageLink
                key={page.to}
                to={page.to}
                label={page.label}
                current={pathname === page.to}
                size="ui"
              />
            ))}
            {/*
              The header's one emphatic link, and it stays the only one: everything to its left is
              `quiet`. It is last because it is the thing you do after reading, and because a
              reader scanning left to right meets the argument before the ask.
            */}
            <Link to="/app" size="ui">
              Open the dashboard
            </Link>
          </nav>
        </header>

        {/*
          `tabindex="-1"` so the skip link and the route effect have somewhere to land; the window
          is the scroller, so there is no `overflow` here and no height to pin.

          `outline-none` is legal here for the same reason it is in `AppShell`: `<main>` is not in
          the tab order, so this is not one of §6's focusable controls, and a ring drawn around
          the whole viewport on every navigation would be an alarm about nothing.

          No `relative` wrapper. There is nothing absolutely positioned at page scope any more —
          the spine is gone — and a containing block kept for no occupant is an invitation to put
          one back.
        */}
        <main id={MAIN_ID} ref={main} tabIndex={-1} className="outline-none">
          <div className={FRAME}>{children}</div>
        </main>

        <footer className={cn(FRAME, "pt-10 pb-16 md:pt-12")}>
          <Separator />
          <div className="mt-8 flex flex-wrap items-start justify-between gap-x-10 gap-y-8">
            <div className="flex min-w-0 items-start gap-4">
              {/*
                The 146:152 mark at 24px — §8.3's footer lockup. Decorative: the descriptor
                beside it says the product's name in the first three words.
              */}
              <Mark size="md" on="paper" label={null} className="mt-1" />
              {/* The descriptor, verbatim, at the lede measure. */}
              <Measure as="p" width="lede">
                <Text size="read-sm" tone="soft" as="span">
                  Populace deploys a population of AI people who use your app through its MCP
                  server, uncover bugs, and reveal usability and discoverability problems.
                </Text>
              </Measure>
            </div>

            {/*
              One row: the four pages, then the door. Not two rows and not seven links — see the
              footer note above. The theme toggle is the page's only theme control, because two
              would each hold their own copy of the choice, and the `storage` event that keeps
              windows in step fires in every document except the one that wrote it.
            */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <nav aria-label="Site" className="flex flex-wrap items-center gap-x-6 gap-y-3">
                {PAGES.map((page) => (
                  <PageLink
                    key={page.to}
                    to={page.to}
                    label={page.label}
                    current={pathname === page.to}
                    size="meta"
                  />
                ))}
                <Link to="/app" size="meta" tone="quiet">
                  Open the dashboard
                </Link>
              </nav>
              {/* Outside the landmark: a theme control is not a destination. */}
              <ThemeToggle compact />
            </div>
          </div>
        </footer>
      </div>
    );
  },
);

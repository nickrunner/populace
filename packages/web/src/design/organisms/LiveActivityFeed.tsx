import { forwardRef, memo } from "react";
import type { ReactElement, ReactNode } from "react";

import { cn } from "../cn.js";
import { rowBase } from "../variants.js";
import { ScrollArea, Separator, Text, VisuallyHidden } from "../atoms/index.js";
import { StateBlock } from "../molecules/index.js";
import { plural } from "../../format.js";

/**
 * LiveActivityFeed — what is happening, in the feed's own words (ATOMIC-INVENTORY §3, organism 28).
 *
 * The live screen renders eleven kinds of event today, each with its own ad-hoc markup, and the
 * feed is where a reader watches an execution happen. This is the ledger form of it.
 *
 * **Sans, all of it** (§3.1, exception 2). A streaming list is scanned as it arrives, so
 * family-as-channel beats sentence-ness and no row here is set in the serif — even though every
 * row *is* a sentence. The caller composes the sentence, which is how a person's name keeps its
 * weight inside the line without this component knowing what a person is.
 *
 * **The stub carries the clock** (§1.2 M2). A feed row's locator is when it happened, so the 72px
 * right-aligned stub holds the time in mono and the sentence gets the whole content column. Below
 * `--breakpoint-md` the stub collapses into a leading line, as every ledger's does.
 *
 * **Freshness is painted, never inserted** (§5.1). A row that has just arrived shows a 3px edge on
 * its content column, painted instantly and faded out over 900ms linear. The edge is absolutely
 * positioned, so nothing about a row's arrival moves anything already on screen, and rows
 * themselves have no enter animation: this list is re-rendered whenever an event lands, and an
 * animated entry would be a strobe. Rows are keyed by event id and memoised so a re-render costs
 * only the rows that changed.
 *
 * **The edge is `primary`, and the specification now says so.** §5.1 used to specify an `accent`
 * edge. Measured against §2.2 and §2.3, `accent` is lime on paper at **1.08:1** in light and
 * forest on ink at **1.55:1** in dark — a 3px edge in that token is invisible in *both* themes,
 * and §5.4 forbids a lime bar or border for exactly this reason: lime is a ground, and the five
 * sanctioned appearances do not include a rule. `primary` is the one token that is an ink in both
 * (8.63:1 light, 12.35:1 dark), and in dark it *is* the lime §5.1 asked for. So the mark reads in
 * both themes and no new hue was introduced to get it.
 *
 * `bg-accent` here would render the real lime — precisely the 1.08:1 edge this component must
 * not draw. §5.1's table was amended to `primary` rather than left contradicting the one
 * implementation of it; see the amendment note under that table.
 *
 * **Reduced motion keeps the meaning** (§5.1). The global override would collapse the fade to
 * nothing and take the freshness mark with it, so the rule here switches the animation off and
 * leaves the edge painted; it disappears on the next state change, when the caller stops calling
 * the row fresh.
 *
 * **It announces a count, not a row** (§6). Reading every arriving event aloud is unusable, so a
 * polite status says how many there are and the rows themselves are quiet.
 */

/** The kinds of thing that happen during an execution, in the product's own words only. */
export type FeedEventKind =
  | "run.started"
  | "run.ended"
  | "run.status"
  | "run.config"
  | "visit.started"
  | "visit.ended"
  | "finding.filed"
  | "guardrail.tripped"
  | "identity.created"
  | "job.updated";

export interface FeedEvent {
  id: string;
  kind: FeedEventKind;
  at: string;
  sentence: ReactNode;
  fresh: boolean;
}

export interface LiveActivityFeedProps {
  events: readonly FeedEvent[];
  cap?: number;
  label: string;
}

/**
 * The freshness fade, scoped to this organism. It is a `<style>` with a stable `href` so React
 * hoists and de-duplicates it however many feeds are on the page.
 */
const FRESH_CSS = `
@keyframes populace-feed-fade {
  from { opacity: 1 }
  to   { opacity: 0 }
}
.populace-feed-fresh {
  animation: populace-feed-fade var(--dur-hero) linear both;
}
@media (prefers-reduced-motion: reduce) {
  .populace-feed-fresh {
    animation: none !important;
    opacity: 1 !important;
  }
}`;

/** Time only. A feed row is read within the hour it happened; the date is noise in 72px. */
function clockOf(at: string): string {
  const parsed = new Date(at);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

const FeedRow = memo(function FeedRow({ event }: { event: FeedEvent }): ReactElement {
  return (
    <li
      className={cn(
        rowBase({ density: "tight", interactive: false }),
        // Padding lives on the CELLS, never on the row: padding on the row would move the stub
        // column off the spine the list draws at `--w-stub`.
        "grid grid-cols-1 py-1.5",
        // The same 3px gutter `Ledger` and `TranscriptList` reserve, so the stub column sits in
        // one place across the product whichever list a reader is looking at.
        "border-l-[3px] border-l-transparent",
        "md:grid-cols-[var(--w-stub)_minmax(0,1fr)]",
      )}
    >
      <span className="flex items-baseline pl-2 md:justify-end md:pl-0 md:pr-2.5">
        <Text size="meta" tone="muted">
          <time dateTime={event.at}>{clockOf(event.at)}</time>
        </Text>
      </span>
      <span className="relative min-w-0 pl-2 pr-2 md:pl-3">
        {event.fresh ? (
          <span
            aria-hidden="true"
            className="populace-feed-fresh absolute inset-y-0 left-0 w-[3px] bg-primary"
          />
        ) : null}
        <Text size="ui" tone="soft" as="span" className="block">
          {event.sentence}
        </Text>
      </span>
    </li>
  );
});

export const LiveActivityFeed = forwardRef<HTMLDivElement, LiveActivityFeedProps>(
  function LiveActivityFeed({ events, cap = 200, label }, ref) {
    // The caller hands these over newest-first, which is the order a feed is read in; capping takes
    // the most recent rather than re-sorting somebody else's list.
    const shown = events.slice(0, cap);

    return (
      <div ref={ref} className="min-w-0">
        <style href="populace-live-feed" precedence="default">
          {FRESH_CSS}
        </style>

        <div
          className={cn(
            "grid grid-cols-1 items-baseline pb-1.5 pl-[3px]",
            "md:grid-cols-[var(--w-stub)_minmax(0,1fr)]",
          )}
        >
          <Text size="label" tone="muted" className="pl-2 md:pl-0 md:pr-2.5 md:text-right">
            time
          </Text>
          <span className="pl-2 pr-2 md:pl-3">
            <Text size="meta" tone="muted">
              {label}
            </Text>
          </span>
        </div>
        <Separator />

        {shown.length === 0 ? (
          <StateBlock kind="empty" what="the feed">
            Nothing has happened yet. This fills in as people arrive, file and leave.
          </StateBlock>
        ) : (
          <ScrollArea maxHeight="52vh">
            <ul
              aria-label={label}
              className={cn(
                "relative rounded-none",
                // One spine for the whole feed, at the stub's right edge — offset by the 3px
                // gutter every row reserves, exactly as `Ledger` and `TranscriptList` place it.
                "md:before:absolute md:before:inset-y-0 md:before:left-[calc(var(--w-stub)+3px)]",
                "md:before:w-px md:before:bg-rule md:before:content-['']",
              )}
            >
              {shown.map((event) => (
                <FeedRow key={event.id} event={event} />
              ))}
            </ul>
          </ScrollArea>
        )}

        <VisuallyHidden>
          <span role="status" aria-live="polite">
            {plural(shown.length, "event")}
          </span>
        </VisuallyHidden>
      </div>
    );
  },
);

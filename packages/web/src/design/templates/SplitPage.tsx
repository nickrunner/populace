import { cva } from "class-variance-authority";
import { forwardRef, type ReactNode } from "react";

import { cn } from "../cn.js";
import type { StateKind } from "../tokens.js";
import { PAGE_FRAME, pageStateSlot, type PageStateSlots } from "./DocumentPage.js";

/**
 * SplitPage — ATOMIC-INVENTORY §4, template 4. Five screens.
 *
 * An index and the thing it indexes, side by side: a list of steps and the current step, a
 * finding and its evidence, a roster and one person. Two rules carry the whole template.
 *
 * **The right pane sticks.** The left pane is long — 200 transcript steps, a roster, a table of
 * visits — and the right pane is what the reader is actually reading. It pins at the top of the
 * scroll container so scrolling the index never scrolls the detail out of sight.
 *
 * **Below 1000px it stacks with the detail ABOVE the list** (DESIGN-SYSTEM §5.3). A narrow reader
 * wants the current step, not the index. The reorder is a CSS `order` on one node rather than two
 * renders of the same content, so nothing is mounted twice and no id appears twice; the cost is
 * that in the stacked layout the tab order reaches the list before the detail it visually sits
 * under, which is the lesser of the two harms and the one the direction asked for.
 *
 * `ratio` is the only variant. `even` is the reading split — a transcript beside its detail, a
 * finding beside its evidence. `narrow-right` is the sidecar: a person's visits beside their
 * identity and memory, where the right pane is a fixed column of facts rather than a second
 * reading column. Its 22rem is the width the `Person` screen carries today, kept so the port is a
 * render-layer change rather than a relayout.
 *
 * Like every page template, it owns layout and the state slot and nothing else: no fetching, no
 * product nouns, no screen content.
 */
const split = cva("mt-8 grid gap-8 lg:gap-10", {
  variants: {
    ratio: {
      even: "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]",
      "narrow-right": "lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]",
    },
  },
  defaultVariants: { ratio: "even" },
});

export interface SplitPageProps extends PageStateSlots {
  /** A `PageHeader`. It owns the screen's single `<h1>` and spans both panes. */
  header: ReactNode;
  /** The index: the list, the roster, the table. Second in the stacked layout. */
  left: ReactNode;
  /** The detail. Sticky beside the list at ≥1000px, above it below that. */
  right: ReactNode;
  ratio?: "even" | "narrow-right";
  /** When set, the matching slot renders INSTEAD of both panes. */
  state?: StateKind;
}

export const SplitPage = forwardRef<HTMLDivElement, SplitPageProps>(function SplitPage(
  { header, left, right, ratio = "even", state, loading, error, empty, gone },
  ref,
) {
  return (
    <div ref={ref} className={cn(PAGE_FRAME, "py-10 md:py-12")}>
      {header}

      {state === undefined ? (
        <div className={cn(split({ ratio }))}>
          <div className="min-w-0">{left}</div>
          {/*
            `order-first` only matters while the grid is one column; at `lg` both panes return to
            source order and the grid places them left then right.
          */}
          <div className="order-first min-w-0 lg:order-none lg:sticky lg:top-10 lg:self-start">
            {right}
          </div>
        </div>
      ) : (
        <div className="mt-8">{pageStateSlot(state, { loading, error, empty, gone })}</div>
      )}
    </div>
  );
});

import { forwardRef, useId, type ReactNode } from "react";

import { cn } from "../cn.js";
import { Heading, Inline, Separator } from "../atoms/index.js";
import { textStyles } from "../atoms/Text.js";

/**
 * Section — ATOMIC-INVENTORY §3, organism 2. 39 `<Section>`s plus the five hand-rolled
 * `mb-7 flex items-start justify-between` headers that bypassed it.
 *
 * **THE SECTION RULE**, stated once so no screen re-derives it: a 12px **sentence-case** eyebrow,
 * a hairline running from the end of that eyebrow to the content width, and an optional trailing
 * fact at the far right of the rule.
 *
 * Three things in that sentence are load-bearing:
 *
 *  - **The eyebrow is `t-eyebrow`, not `t-label`.** Tracked-out caps are the commonest decorative
 *    tic in a generated interface, and at 12px in a face with a 0.700 cap height they render as a
 *    grey stripe. §3.3 confines caps to `t-label`'s four *data-label* roles — field labels, stat
 *    labels, column heads, stub units — and a section heading is none of them. Space Grotesk's
 *    personality lives in its lowercase, and all-caps discards every bit of it.
 *  - **The rule is the structure.** §1.4's third defence is "the ground is ruled, not empty": a
 *    section is a label set *into* a hairline, not a title floating above white space. That is
 *    also why `Section` draws no box — the boxed version of this is `Card level="boxed"`, and it
 *    is the exception.
 *  - **`level` is semantics, `size` is not offered.** `PageHeader` owns the single `<h1>`, a
 *    `Section` owns the `<h2>`, and a `Card` title inside one is the `<h3>` (§6, "Heading
 *    order"). A nested section passes `level={3}` and keeps the same appearance, because the
 *    eyebrow's job does not change with its depth.
 *
 * `trailing` is **a fact**, set in the 12px muted chrome register — "12 of 47", "last seen four
 * minutes ago". `actions` is a control. They are separate props because they sit in the same
 * place and must never be confused: a fact that is clickable is an action that has lost its verb.
 *
 * `id` is what two screens copy verbatim today to get an in-page anchor. It goes on the
 * `<section>` along with the scroll offset, so a jump lands with the rule visible rather than
 * flush against the top of the viewport.
 */
export interface SectionProps {
  /** The eyebrow, sentence case. A string, because a section's label is a name. */
  title: string;
  /** In-page anchor target; the section also reserves the scroll offset the jump needs. */
  id?: string;
  /** The fact at the far right of the rule. Never a control. */
  trailing?: ReactNode;
  /** Controls at the far right of the rule. Never a fact. */
  actions?: ReactNode;
  /** `2` inside a page, `3` inside another section. Appearance does not change with depth. */
  level?: 2 | 3;
  children: ReactNode;
}

export const Section = forwardRef<HTMLElement, SectionProps>(function Section(
  { title, id, trailing, actions, level = 2, children },
  ref,
) {
  /**
   * The heading names the region even when the caller gives no `id`, so the section is a labelled
   * landmark in an outline rather than an anonymous `<section>`.
   */
  const generated = useId();
  const headingId = id === undefined ? generated : `${id}-title`;

  return (
    <section ref={ref} id={id} aria-labelledby={headingId} className="scroll-mt-6">
      {/*
        `items-center` puts the rule on the eyebrow's optical middle rather than on its baseline.
        A `Separator` at `flex-1` is the rule: one hairline atom, so a section and a ledger spine
        are drawn by the same thing.

        **The row wraps, and the eyebrow is the thing that gives.** This used to read "all three
        children keep their intrinsic width and it is the rule that gives" — every child
        `shrink-0`, the rule `flex-1 min-w-4`, nothing allowed to wrap. That is only true while
        the rule is above its floor. Once `title + trailing + gaps + 16px` exceeds the viewport
        the rule is already at `min-w-4`, has nothing left to give, and the row pushes the whole
        DOCUMENT wide — a horizontal scrollbar on every screen that happens to carry a long
        section title and a long trailing fact at phone width. Three changes fix it and none of
        them is visible above the point where the old row overflowed:

         - **`flex-wrap`.** The fact and the controls travel together and drop to a second line
           rather than overflow. `ml-auto` puts them back at the far right when they do, which is
           where §3's rule says a trailing fact lives.
         - **The eyebrow may shrink and wrap.** `min-w-0` in place of `shrink-0`: flex shrink only
           engages once a line has overflowed, so at every width where the old row fitted this
           changes nothing, and at the widths where it did not the title now takes a second line
           instead of the page taking a scrollbar.
         - **The fact keeps `min-w-0` too**, so a long one alone on the second line wraps inside
           its own box rather than running off the end of it.
      */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Heading level={level} size="eyebrow" id={headingId} className="min-w-0">
          {title}
        </Heading>
        <Separator className="w-auto min-w-4 flex-1" />
        {trailing === undefined && actions === undefined ? null : (
          <div className="ml-auto flex min-w-0 items-center gap-3">
            {trailing === undefined ? null : (
              <div className={cn("min-w-0", textStyles({ size: "meta", tone: "muted" }))}>
                {trailing}
              </div>
            )}
            {actions === undefined ? null : (
              <Inline gap={2} align="center" className="shrink-0">
                {actions}
              </Inline>
            )}
          </div>
        )}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
});

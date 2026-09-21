import { forwardRef } from "react";

import { Button, Text, VisuallyHidden } from "../atoms/index.js";

/**
 * Pagination — moving through a long ledger (ATOMIC-INVENTORY §2, molecule 34).
 *
 * New in the rebuild, for the two screens that currently render every row they have: the visits
 * table and the executions history. Both are instrument-class, both poll, and both can run to
 * hundreds of rows.
 *
 * **Words, not arrows.** There is no left chevron in `Icon`, and that is the icon policy working
 * rather than a gap in it (§8.6): the eight glyphs are affordances, and anything they cannot say
 * a word says. §7.4 is the other half of it — no arrows appended to link text, an arrow is drawn
 * only where something literally moves. So the two controls are labelled "Previous" and "Next",
 * which is also what a screen reader would have had to be told anyway.
 *
 * **The position is a live region.** Paging is the one interaction where the thing that changed —
 * which slice you are looking at — is nowhere near the control you pressed. `role="status"`
 * announces "Page 4 of 12" when it changes without stealing focus from the button the reader is
 * still sitting on.
 *
 * **One page is not a pager.** With nothing to move between, the whole strip renders nothing
 * rather than two dead buttons under a sentence that states the obvious.
 *
 * No count-up, no transition on the figure (§5.1): a number that animates is lying about a
 * measurement for half a second.
 */
export interface PaginationProps {
  /** One-based. */
  page: number;
  /** The total number of pages, one-based. */
  pages: number;
  onChange: (p: number) => void;
  /** What is being paged — "visits", "executions". Names the navigation landmark. */
  label: string;
}

export const Pagination = forwardRef<HTMLElement, PaginationProps>(function Pagination(
  { page, pages, onChange, label },
  ref,
) {
  if (pages <= 1) return null;

  const atStart = page <= 1;
  const atEnd = page >= pages;

  return (
    <nav ref={ref} aria-label={label} className="flex items-center justify-end gap-3">
      <Button
        variant="secondary"
        size="sm"
        disabled={atStart}
        onClick={() => {
          onChange(Math.max(1, page - 1));
        }}
      >
        Previous
        <VisuallyHidden> page of {label}</VisuallyHidden>
      </Button>

      {/*
       * `role="status"` is implicitly `aria-live="polite"`, so the new position is read after the
       * press settles rather than interrupting it. The figures are tabular by construction —
       * `t-meta` carries `tabular-nums slashed-zero`, so nothing here applies it (§4.4).
       */}
      <span role="status">
        <Text size="meta" tone="muted">
          Page {page} of {pages}
        </Text>
      </span>

      <Button
        variant="secondary"
        size="sm"
        disabled={atEnd}
        onClick={() => {
          onChange(Math.min(pages, page + 1));
        }}
      >
        Next
        <VisuallyHidden> page of {label}</VisuallyHidden>
      </Button>
    </nav>
  );
});

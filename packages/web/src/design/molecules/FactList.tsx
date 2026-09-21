import { forwardRef, type ReactNode } from "react";

import { Text } from "../atoms/index.js";

/**
 * FactList — a description list of labelled facts about one record.
 *
 * The steady column beside a record: patience, budget, traits, the model it ran on, the account
 * it signed up with. It is a real `<dl>`, because that is what it is, and the two columns are a
 * grid so that every value starts at one left edge instead of eleven copies of
 * `flex items-baseline gap-3 w-24` agreeing by eye.
 *
 * **It exists because the track was written by hand on a screen.** `Person` carried a live
 * `grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)]` while its own docstring said the screen's hand-rolled
 * grids were gone — ATOMIC-INVENTORY §0.2's rule is that a layout with a measurement in it lives
 * in `design/`, where one change reaches every use of it. The label column is fixed and narrow
 * so the values line up; `minmax(0,…)` on both tracks is what lets a long account address wrap
 * rather than push the grid wider than the card around it.
 *
 * The label is `t-meta` in `ink-muted` and the value is `t-read-sm` in `ink-soft` — the quiet
 * half and the read half, the same pairing `MetaLine` uses — and neither is ever a heading: a
 * fact about a record is not a section of the page.
 */
export interface FactListProps {
  /** `Fact` elements. Each one publishes its own `<dt>`/`<dd>` pair into this grid. */
  children: ReactNode;
}

export const FactList = forwardRef<HTMLDListElement, FactListProps>(function FactList(
  { children },
  ref,
) {
  return (
    <dl
      ref={ref}
      className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5"
    >
      {children}
    </dl>
  );
});

export interface FactProps {
  /** What the value is. Sentence case, and a word rather than an id. */
  label: string;
  children: ReactNode;
}

/**
 * One labelled fact. A fragment rather than a wrapper, so the `<dt>` and the `<dd>` land in the
 * list's own grid tracks instead of in a box of their own.
 */
export function Fact({ label, children }: FactProps): ReactNode {
  return (
    <>
      <Text as="dt" size="meta" tone="muted" truncate>
        {label}
      </Text>
      <Text as="dd" size="read-sm" tone="soft" className="min-w-0 break-words">
        {children}
      </Text>
    </>
  );
}

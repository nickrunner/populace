import { forwardRef, type ReactNode } from "react";

import { Measure, Text } from "../atoms/index.js";

/**
 * MetaSentence — the same facts, written as a sentence — ATOMIC-INVENTORY §2, molecule 26,
 * DESIGN-SYSTEM §4.5.
 *
 * > *"Nine of twelve people hit this, first in execution 2 and last four minutes ago."*
 *
 * The counterpart to `MetaLine`, and the split is about how the line is read. Where a fact line
 * is **compared across rows** the reader is scanning, and hairline-separated fragments are what
 * a scale looks like. Where it is **read once** — a detail pane, a lede, an empty state, an
 * `aria-label` — fragments are a shorthand nobody asked for, and the product should just say the
 * thing. `format.ts` already has `people()`, `plural()`, `ago()` and `lasted()`, so real
 * pluralisation costs a caller nothing and "1 people" never reaches a screen.
 *
 * **Banned from table rows and list rows.** Prose cannot be compared down a column, and a
 * sentence in a 32px row has to shrink below the 13px serif floor to fit, which §1.3 rule 6
 * forbids outright. If a row seems to want this component, the row wants `MetaLine`.
 *
 * Set in `t-read`, upright, in `ink-soft`. Upright because **the PRODUCT is speaking, not a
 * person**: italic exists only in `t-voice` and belongs to somebody's verbatim words (§4.7).
 * `ink-soft` rather than the muted tier because the serif's thin strokes make a paragraph read
 * lighter than a sans one — the one place in the system where a family changes a colour choice
 * (§3.6). And it sets at `--measure-read`, 62 characters, because a sentence that runs the full
 * width of a page is a sentence nobody finishes.
 *
 * Two rules the caller owns, and both are review stops: never name a persona where a person has
 * a name, and never report a problem's absence from the newest execution as a repair. The
 * vocabulary for the second is fixed — *"gone quiet"*, *"not reported"* — and the word "fixed"
 * belongs to the triage control, where a human asserts it about their own product (§7.3).
 */
export interface MetaSentenceProps {
  children: ReactNode;
}

export const MetaSentence = forwardRef<HTMLElement, MetaSentenceProps>(function MetaSentence(
  { children },
  ref,
) {
  return (
    <Measure ref={ref} width="read">
      <Text as="p" size="read" tone="soft">
        {children}
      </Text>
    </Measure>
  );
});

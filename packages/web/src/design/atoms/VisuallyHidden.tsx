import { forwardRef, type ReactNode } from "react";
import * as RadixVisuallyHidden from "@radix-ui/react-visually-hidden";

/**
 * Text for the screen reader alone — ATOMIC-INVENTORY §1 atom 31.
 *
 * Twenty-five sites need it: a `RadioGroup`'s legend when a `Field` already carries the visible
 * label, the note after an external `Link`, the sentence naming what a `Spinner` is waiting on,
 * a dialog title the design draws as a heading of its own, and the unit words that keep a column
 * of bare figures meaningful out of context.
 *
 * It is Radix's implementation rather than Tailwind's `sr-only`, because the clip-path version
 * keeps the text selectable by assistive technology *and* keeps it out of the layout even inside
 * a flex container, which `sr-only` on a flex child does not reliably do.
 *
 * It is never a substitute for a visible label on a control. §6 is explicit: an instrument is
 * labelled, and the only glyph allowed to stand alone is an `IconButton`'s — which still owes
 * both an `aria-label` and a `Tooltip`.
 */
export interface VisuallyHiddenProps {
  children: ReactNode;
}

export const VisuallyHidden = forwardRef<HTMLSpanElement, VisuallyHiddenProps>(
  function VisuallyHidden({ children }, ref) {
    return <RadixVisuallyHidden.Root ref={ref}>{children}</RadixVisuallyHidden.Root>;
  },
);

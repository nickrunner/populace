import { cva } from "class-variance-authority";
import { forwardRef, type ReactNode, type Ref } from "react";
import { cn } from "../cn.js";

/**
 * Measure — the reading column, as one of four named widths.
 *
 * The four `ch` values are layout constants in `theme.css` (§2.4), not numbers chosen per screen,
 * and they are `ch` rather than `px` because `ch` is a property of the *face*: the serif sets
 * ~11% more characters per line than the sans (§3.6), so a pixel width would give the two
 * families two different line lengths while a `ch` width gives them the same one.
 *
 * **The hazard that argument hides, and where the correction lives.** `ch` resolves against the
 * element it is declared on — and that element is *this wrapper*, which inherits the body's
 * 13px chrome sans, not the 30px serif the statement inside it is set in. `read` is right by
 * coincidence (Space Grotesk 13 and Source Serif 15 have nearly the same "0"), which is why this
 * went unnoticed while `read` is ~two thirds of every measure in the product; `statement` was
 * rendering at 283px against an intended 520px and broke a one-sentence headline every three
 * words. The per-variant correction is in `theme.css` beside the tokens, with the measurements
 * that produced it. Do not "simplify" it away, and do not fix it by putting a font on this
 * wrapper — that was simulated and it retypesets 26 labels and links that rely on inheriting the
 * chrome sans.
 *
 *   read      62ch  serif prose — the default, and the document-class reading column
 *   statement 34ch  a `t-statement` headline, which wants to break as a sentence
 *   lede      52ch  a `t-lede` intro
 *   wide      78ch  payload wells and transcripts, where the line is machine output
 *
 * This replaces the 12 hand-written `max-w-[68ch]` sites and the four other `ch` values the
 * survey found.
 */
const measureStyles = cva("", {
  variants: {
    width: {
      read: "max-w-[var(--measure-read)]",
      statement: "max-w-[var(--measure-statement)]",
      lede: "max-w-[var(--measure-lede)]",
      wide: "max-w-[var(--measure-wide)]",
    },
  },
  defaultVariants: { width: "read" },
});

export type MeasureWidth = "read" | "statement" | "lede" | "wide";
export type MeasureElement = "div" | "p" | "section";

export interface MeasureProps {
  width?: MeasureWidth;
  as?: MeasureElement;
  children: ReactNode;
}

export const Measure = forwardRef<HTMLElement, MeasureProps>(function Measure(
  { width = "read", as = "div", children },
  ref,
) {
  // JSX given a union of intrinsic tags asks for the intersection of their ref types, which no
  // single element satisfies. Erase the union to one tag and narrow the ref to match it —
  // `HTMLDivElement` is an `HTMLElement`, so both casts stay in the family and neither is `any`
  // or `unknown`. The public ref type stays `HTMLElement`, which is what a caller holds.
  const Component = as as "div";
  return (
    <Component ref={ref as Ref<HTMLDivElement>} className={cn(measureStyles({ width }))}>
      {children}
    </Component>
  );
});

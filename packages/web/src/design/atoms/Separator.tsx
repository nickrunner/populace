import { forwardRef } from "react";
import * as RadixSeparator from "@radix-ui/react-separator";
import { cva } from "class-variance-authority";
import { cn } from "../cn.js";

/**
 * The hairline — ATOMIC-INVENTORY §1 atom 22, DESIGN-SYSTEM §4.5.
 *
 * Two jobs, one atom. Horizontal, it is the section rule and the spine a ledger list draws
 * between its rows; it replaces `border-t border-rule` at 32 sites. Vertical, it is a 12px tick
 * between facts on a meta line, and it is what retires the middle dot:
 *
 * ```
 * ephemeral │ Early adopters (12 people) → Checkout │ execution 3 │ 14 Mar 09:41
 * ```
 *
 * A dot-joined meta string is the generic default; a hairline tick between facts is what a scale
 * looks like, and it costs the same markup.
 *
 * `weight="provisional"` says *this has not happened yet* — a cohort that has not run, a pending
 * verdict, an execution still in progress (§8.6). It is the mark's own 2/7 dash rhythm, the same
 * `2 7` the landing's exploration béziers are stroked with.
 */

/**
 * Radius is `none` by rule: a separator is data furniture, not a container (§5.2).
 *
 * The provisional dash is drawn as a repeating gradient rather than `border-style: dashed`,
 * because CSS gives no control over a border's dash length and the 2/7 rhythm is the whole point
 * of the variant. It is also drawn in `rule-strong` rather than `rule`: a provisional rule
 * carries meaning, and a meaningful non-text mark owes 3:1 (§6), which the hairline does not
 * meet. The plain `hair` weight is decorative furniture and correctly stays on `rule`.
 */
const separator = cva("shrink-0 rounded-none border-0", {
  variants: {
    orientation: {
      horizontal: "h-px w-full",
      vertical: "h-3 w-px self-center",
    },
    weight: {
      hair: "bg-rule",
      provisional: "bg-transparent",
    },
  },
  compoundVariants: [
    {
      orientation: "horizontal",
      weight: "provisional",
      class:
        "[background-image:repeating-linear-gradient(to_right,var(--color-rule-strong)_0_2px,transparent_2px_9px)]",
    },
    {
      orientation: "vertical",
      weight: "provisional",
      class:
        "[background-image:repeating-linear-gradient(to_bottom,var(--color-rule-strong)_0_2px,transparent_2px_9px)]",
    },
  ],
  defaultVariants: { orientation: "horizontal", weight: "hair" },
});

export interface SeparatorProps {
  orientation?: "horizontal" | "vertical";
  /** `provisional` = dashed at the mark's own 2/7 rhythm — this has not happened yet. */
  weight?: "hair" | "provisional";
  /**
   * Furniture by default. Set `false` only where the rule genuinely divides two things a screen
   * reader should be told apart, which then emits `role="separator"` and `aria-orientation`.
   */
  decorative?: boolean;
  className?: string;
}

export const Separator = forwardRef<HTMLDivElement, SeparatorProps>(function Separator(
  { orientation = "horizontal", weight = "hair", decorative = true, className },
  ref,
) {
  return (
    <RadixSeparator.Root
      ref={ref}
      orientation={orientation}
      decorative={decorative}
      className={cn(separator({ orientation, weight }), className)}
    />
  );
});

import { forwardRef, type ReactNode } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../cn.js";

/**
 * The row — ATOMIC-INVENTORY §1 atom 25.
 *
 * Replaces ~40 hand-written `flex items-baseline gap-*` strings, and like `Stack` its `gap` is a
 * **closed token scale** rather than a raw number.
 *
 * The default alignment is `baseline`, not `center`, and that is the whole reason this atom is
 * separate from `Stack`. Two families sit side by side all over this product — a serif phrase
 * beside a sans figure, a name beside a count, a label beside a value — and `items-center`
 * centres their *boxes*, which leaves their baselines a pixel or two apart and makes the line
 * look broken (§3.6). `center` is correct only when one of the items is a glyph or a control
 * with no baseline of its own: a dot, an avatar, a chip, a button.
 */
const inline = cva("flex", {
  variants: {
    /** The 4px base scale: 1→4px, 2→8px, 3→12px, 4→16px, 6→24px, 8→32px. */
    gap: {
      1: "gap-1",
      2: "gap-2",
      3: "gap-3",
      4: "gap-4",
      6: "gap-6",
      8: "gap-8",
    },
    align: {
      baseline: "items-baseline",
      center: "items-center",
      start: "items-start",
      end: "items-end",
    },
    wrap: {
      true: "flex-wrap",
      false: "min-w-0",
    },
  },
  defaultVariants: { gap: 2, align: "baseline", wrap: false },
});

export interface InlineProps {
  gap?: 1 | 2 | 3 | 4 | 6 | 8;
  align?: "baseline" | "center" | "start" | "end";
  wrap?: boolean;
  className?: string;
  children: ReactNode;
}

export const Inline = forwardRef<HTMLDivElement, InlineProps>(function Inline(
  { gap = 2, align = "baseline", wrap = false, className, children },
  ref,
) {
  return (
    <div ref={ref} className={cn(inline({ gap, align, wrap }), className)}>
      {children}
    </div>
  );
});

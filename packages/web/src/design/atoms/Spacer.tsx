import { forwardRef } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../cn.js";

/**
 * The push — ATOMIC-INVENTORY §1 atom 23.
 *
 * Replaces the 19 `<span className="flex-1" />` sites that shove a trailing action to the far
 * edge of a header row or the foot of a column. It exists so that intent is readable: a reader
 * sees "everything after this goes to the end" rather than a bare utility whose meaning depends
 * on the parent's `flex-direction`.
 *
 * It is a gap and nothing else, so it is `aria-hidden` and never a layout of its own. Where the
 * distance is a fixed one, use `Stack`'s or `Inline`'s `gap` instead: this atom is only for the
 * *remaining* distance.
 */
const spacer = cva("block shrink-0", {
  variants: {
    /** Which axis the parent flexes along. `min-*-0` lets the push collapse rather than overflow. */
    axis: {
      x: "flex-1 min-w-0",
      y: "flex-1 min-h-0",
    },
  },
  defaultVariants: { axis: "x" },
});

export interface SpacerProps {
  axis?: "x" | "y";
}

export const Spacer = forwardRef<HTMLSpanElement, SpacerProps>(function Spacer({ axis = "x" }, ref) {
  return <span ref={ref} aria-hidden="true" className={cn(spacer({ axis }))} />;
});

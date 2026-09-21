import { forwardRef, type ReactNode } from "react";
import { cva } from "class-variance-authority";

import { cn } from "../cn.js";

/**
 * FieldGrid — ATOMIC-INVENTORY §2 molecule 2. Replaces `grid grid-cols-2|3 gap-4`, written out
 * at roughly 25 sites, none of which has a breakpoint.
 *
 * The gap is fixed at 16px, which is the one rhythm a row of controls is allowed: `Stack` and
 * `Inline` close their gap scales for the same reason, and a form that chose its own gutter per
 * screen is how the survey found twelve vertical rhythms on one page.
 *
 * **`cols` is the desktop count**, exactly as `StatGroup`'s is. DESIGN-SYSTEM §5.3 is explicit
 * that every literal `grid-cols-N` becomes a token with breakpoints, so a two-column form is one
 * column on a narrow viewport and a three-column form steps 3 → 2 → 1 rather than squeezing
 * three 32px controls into 320px. Cutting a column is always right here; shrinking the type
 * never is.
 *
 * `align` defaults to `start`, so a field carrying an error and a warning does not stretch the
 * control beside it to match its height. `end` is for the row that ends in a button, where the
 * controls share a baseline edge rather than a top edge.
 */
const fieldGrid = cva("grid gap-4", {
  variants: {
    cols: {
      2: "grid-cols-1 md:grid-cols-2",
      3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
    },
    align: {
      start: "items-start",
      end: "items-end",
    },
  },
  defaultVariants: { cols: 2, align: "start" },
});

export interface FieldGridProps {
  /** The desktop column count. It steps down at `lg` and `md`. */
  cols: 2 | 3;
  align?: "start" | "end";
  children: ReactNode;
}

export const FieldGrid = forwardRef<HTMLDivElement, FieldGridProps>(function FieldGrid(
  { cols, align = "start", children },
  ref,
) {
  return (
    <div ref={ref} className={cn(fieldGrid({ cols, align }))}>
      {children}
    </div>
  );
});

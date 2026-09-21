import { forwardRef } from "react";
import { cva } from "class-variance-authority";

import { cn } from "../cn.js";

/**
 * Skeleton — atom 29. New to the app, which today has none.
 *
 * **Ruled, not shimmering.** Two rules from the design system decide everything here:
 *
 *  - §5.1, *what must never animate*: "Skeleton → content. Swap, do not cross-fade. Skeletons
 *    are built to the exact height of what they replace, so there is no reflow to hide." A
 *    shimmer exists to distract from a reflow that this system does not have, and a sweeping
 *    gradient would be the only gradient in a brand that has none.
 *  - §8.6, the mark's grammar: a **dashed 2/7 stroke** is how this product says *this has not
 *    happened yet* — a cohort that has not run, a pending verdict, an execution in progress, and
 *    the skeleton. So the `lattice` variant is a field of dashed rings rather than grey pills:
 *    a population whose dots have not been filled in yet.
 *
 * Because it is motionless by construction there is nothing for `prefers-reduced-motion` to turn
 * off — the reduced-motion rendering and the default rendering are the same drawing, which is the
 * strongest form of respecting it.
 *
 * The bars use the `skeleton-line` utility from theme.css: square (radius 0 — this is the shape
 * of data, §5.2), `sunk`, `color: transparent`, `user-select: none`.
 *
 * `role="status"` + `aria-busy` with the sentence visually hidden (§6, live regions).
 */
export interface SkeletonProps {
  /**
   * `line` a run of reading text · `block` a panel · `row` a ledger of ruled rows ·
   * `lattice` a population that has not been filled in yet.
   */
  variant: "line" | "block" | "row" | "lattice";
  /** The bar's share of the container. Defaults to `full`, or `half` for a `row`'s inner bar. */
  width?: "full" | "wide" | "half" | "short";
  /** Pixels. Build it to the exact height of what it replaces; ignored by `lattice`. */
  height?: number;
  /** How many lines, blocks, rows or dots. Defaults to 1, or 12 for a `lattice`. */
  count?: number;
  /** The `role="status"` sentence — "Reading the transcript". */
  label: string;
  /** Additive, for placement only. */
  className?: string;
}

/** Heights that match what each variant stands in for (§5.3 row heights). */
const DEFAULT_HEIGHT = { line: 14, block: 96, row: 32 } as const;

/** A row's inner bar is a line of text inside the row, not the row itself. */
const ROW_BAR_HEIGHT = 12;

const LATTICE_DOT_COUNT = 12;

/** Proportions, not pixels, so a skeleton adapts to whatever column it is dropped into. */
const bar = cva("skeleton-line", {
  variants: {
    width: {
      full: "w-full",
      wide: "w-3/4",
      half: "w-1/2",
      short: "w-1/4",
    },
  },
  defaultVariants: { width: "full" },
});

/**
 * The layout of the repeats.
 *
 * `row` has no gap and no fill of its own: the hairline under each row *is* the skeleton, which
 * is the ledger's one continuous spine showing through before the rows arrive. `lattice` is four
 * high, because the mark is four high and so is every lattice (`--lat-rows`).
 */
const group = cva("", {
  variants: {
    variant: {
      line: "flex flex-col gap-2",
      block: "flex flex-col gap-3",
      row: "flex flex-col",
      lattice:
        "grid grid-flow-col grid-rows-4 justify-start gap-[calc(var(--lat-pitch)_-_var(--lat-dot))] text-rule-strong",
    },
  },
  defaultVariants: { variant: "line" },
});

export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(function Skeleton(
  { variant, width, height, count, label, className },
  ref,
) {
  const repeats = count ?? (variant === "lattice" ? LATTICE_DOT_COUNT : 1);
  const resolvedWidth = width ?? (variant === "row" ? "half" : "full");
  const slots = Array.from({ length: Math.max(repeats, 1) }, (_, i) => i);

  return (
    <div ref={ref} role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className={cn(group({ variant }))}>
        {slots.map((i) =>
          variant === "lattice" ? (
            <ProvisionalDot key={i} />
          ) : variant === "row" ? (
            <div
              key={i}
              className="flex items-center border-b border-rule"
              style={{ height: height ?? DEFAULT_HEIGHT.row }}
            >
              <span
                className={cn(bar({ width: resolvedWidth }))}
                style={{ height: ROW_BAR_HEIGHT }}
              />
            </div>
          ) : (
            <span
              key={i}
              className={cn(bar({ width: resolvedWidth }))}
              style={{ height: height ?? DEFAULT_HEIGHT[variant] }}
            />
          ),
        )}
      </div>
    </div>
  );
});

/**
 * One lattice cell that has not happened yet: a ring drawn in the mark's 2/7 dashed rhythm.
 *
 * `pathLength` normalises the circumference to 81 so nine 2-on-7-off periods close exactly,
 * whatever the rendered diameter is. Circles and axis-aligned lines only — no diagonals, no
 * varying-radius arcs, per §8.6's geometric discipline.
 */
function ProvisionalDot() {
  return (
    <svg viewBox="0 0 26 26" className="size-[var(--lat-dot)] shrink-0" focusable="false">
      <circle
        cx="13"
        cy="13"
        r="12.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        pathLength={81}
        strokeDasharray="2 7"
      />
    </svg>
  );
}

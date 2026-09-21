import { forwardRef, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../cn.js";

/**
 * StatGroup — the strip of figures that measures a screen — ATOMIC-INVENTORY §2, molecule 14.
 *
 * Replaces the five hand-rolled stat strips the survey found, each of which had written its own
 * literal `grid-cols-N` and none of which had a breakpoint. Here the column count is a token and
 * **`cols` is the DESKTOP count**: the molecule owns the wrap, which §5.3 fixes as
 * **5 → 3 (lg) → 2 (md)**. Read against `theme.css`'s four breakpoints — 640 / 860 / 1000 / 1240 —
 * that is `grid-cols-2` below 860, three across from 860, and the full count from 1000.
 *
 * `ruled` is §1.4's third defence written as a prop: *"the ground is ruled, not empty."* A strip
 * of figures divided by hairlines is a ledger's summary band; the same figures floating in white
 * space are the floating-card-kit cliché the direction is defined against.
 *
 * **How the hairline is drawn, and why not `divide-x`.** The rule is a 1px `gap` with the
 * container's own `rule` ground showing through it, and opaque cells over the top. `divide-x`
 * and a per-child `border-l` both draw on the wrong edges the moment the grid wraps — every
 * row-leading cell gets a stray line against the container edge — and the `nth-child` fix would
 * need a `border-l` and a `border-l-0` to win over each other at three breakpoints, which is a
 * cascade race inside one utility group. The gap draws hairlines **between** cells and never at
 * an edge, at any column count, with no ordering assumption at all. It also gives the wrapped
 * rows their horizontal rule for free.
 *
 * **The cells' ground has its own name: `--stat-ground`.** What an opaque cell needs is *the
 * colour immediately behind the strip*, and the only channel the system publishes for that today
 * is `--focus-sep` (§4.6) — which `surfaceBase` sets on a card, a well and an overlay for the
 * focus ring's separator band. Reading it directly in the cells would make one variable mean two
 * unrelated things, and the day a container wants a different separator band from its ground, the
 * hairlines change with it. So the strip declares its own variable, **seeded** from that channel
 * and falling back to the page: `--stat-ground: var(--focus-sep, var(--color-bg))`. The cells
 * depend on `--stat-ground` alone, a caller on an unusual ground overrides one name in one place,
 * and nothing here asks TypeScript what the theme or the container is.
 */
const statGroup = cva("grid", {
  variants: {
    /** The DESKTOP count. Everything below 1000px is the molecule's business, not a caller's. */
    cols: {
      2: "grid-cols-2",
      3: "grid-cols-2 md:grid-cols-3",
      4: "grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
      5: "grid-cols-2 md:grid-cols-3 lg:grid-cols-5",
    },
    ruled: {
      true: [
        "[--stat-ground:var(--focus-sep,var(--color-bg))]",
        "gap-px bg-rule [&>*]:bg-[var(--stat-ground)] [&>*]:px-4 [&>*]:py-3",
      ].join(" "),
      false: "gap-x-8 gap-y-6",
    },
  },
  defaultVariants: { cols: 4, ruled: false },
});

export type StatGroupVariants = VariantProps<typeof statGroup>;

export interface StatGroupProps {
  /** The desktop column count; the strip wraps 5 → 3 → 2 on its own (§5.3). */
  cols: 2 | 3 | 4 | 5;
  /** Hairlines between the figures — the ruled ground of §1.4. */
  ruled?: boolean;
  /** `Stat`s. */
  children: ReactNode;
}

export const StatGroup = forwardRef<HTMLDivElement, StatGroupProps>(function StatGroup(
  { cols, ruled = false, children },
  ref,
) {
  return (
    <div ref={ref} className={cn(statGroup({ cols, ruled }))}>
      {children}
    </div>
  );
});

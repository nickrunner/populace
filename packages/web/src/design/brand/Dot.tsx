import { forwardRef } from "react";
import type { CSSProperties } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../cn.js";
import type { PersonDotState } from "../tokens.js";
import {
  MARK_FILL_LAYER,
  MARK_R,
  MARK_RING_R,
  MARK_STROKE_LAYER,
  MARK_VIEWBOX,
  markState,
  markTone,
  markUnit,
} from "./Ring.js";
import type { BrandSize, BrandTone } from "./Ring.js";

/**
 * Dot — the mark's first letter: one circle is one individual (DESIGN-SYSTEM §8.6).
 *
 * Six readings, one element structure. A core circle carries the fill, a ring circle carries the
 * stroke, and the state chooses which of the two is painted by publishing `--mark-fill` and
 * `--mark-stroke`. Nothing here branches on the theme, and nothing here branches on the state to
 * pick an element — the state is a class, which is what keeps `theOne`'s two very different
 * drawings a `dark:` flip rather than a `useTheme()`.
 *
 * | state | drawing | reads as |
 * |---|---|---|
 * | `present` | filled, `primary` | a person who was there |
 * | `absent` | 1px ring, `rule-strong` | a person who was not |
 * | `left` | filled, `ink-muted` | a person who walked away |
 * | `theOne` | see below | the one that matters |
 * | `provisional` | dashed ring at the mark's 2/7 rhythm | this has not happened yet |
 * | `selected` | `primary-wash` fill, 2px `primary` ring | picked — the same sentence `rowBase` says |
 *
 * **`theOne` is the lime law, and it is not negotiable** (§2.2, §5.4). In light it is a lime fill
 * carrying a **mandatory 1.5px `mark-ring` (ink) ring**, which is the only structural answer to
 * lime's 1.22:1 on white. In dark, where lime is already the primary ink, it inverts to a **2px
 * lime ring on transparent** rather than becoming a second lime language. `tone` is ignored for
 * this state by construction: the one dot that matters is not recolourable.
 *
 * `tone` recolours the other five — that is how `SeverityStack` lights four dots from the bottom
 * and how the live dot is lime on a forest pill.
 */

const dot = cva("block shrink-0 overflow-visible w-[var(--mark-unit)] h-[var(--mark-unit)]");

/**
 * The live dot's two-second breath (§5.1), and its reduced-motion substitution (§5.1, end):
 * the pulse stops and a 1px lime ring appears, so "live" is still visibly different from a
 * static dot when the animation is gone.
 */
const PULSE_CSS = `
@keyframes populace-dot-breath { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }
.populace-dot-breath { animation: populace-dot-breath 2000ms var(--ease) infinite }
.populace-dot-breath-ring { opacity: 0 }
@media (prefers-reduced-motion: reduce) {
  .populace-dot-breath { animation: none; opacity: 1 }
  .populace-dot-breath-ring { opacity: 1 }
}`;

export type DotTone = BrandTone;

export interface DotProps {
  /** Default `present`. The mark's grammar, not a colour. */
  state?: PersonDotState;
  /**
   * Recolours the state. Ignored by `theOne`, and by `selected`'s wash — both are fixed.
   * This is the axis `SeverityStack` lights its column on.
   */
  tone?: DotTone;
  size?: BrandSize;
  /** The live dot only: opacity 1 → 0.35 → 1, 2000ms, forever. One per screen at most. */
  pulse?: boolean;
  /** Names the shape. Without one the dot is `aria-hidden` — right inside a `role="img"` lattice. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

export const Dot = forwardRef<SVGSVGElement, DotProps>(function Dot(
  { state = "present", tone, size = "md", pulse = false, label, className, style },
  ref,
) {
  return (
    <>
      {pulse ? (
        <style href="populace-brand-dot" precedence="default">
          {PULSE_CSS}
        </style>
      ) : null}
      <svg
        ref={ref}
        viewBox={MARK_VIEWBOX}
        className={cn(
          markUnit({ size }),
          markState({ state }),
          tone ? markTone({ tone }) : "",
          dot(),
          className,
        )}
        style={style}
        role={label ? "img" : undefined}
        aria-hidden={label ? undefined : true}
        focusable="false"
      >
        {label ? <title>{label}</title> : null}
        <circle
          cx={MARK_R}
          cy={MARK_R}
          r={MARK_R}
          className={cn(MARK_FILL_LAYER, pulse ? "populace-dot-breath" : "")}
        />
        <circle
          cx={MARK_R}
          cy={MARK_R}
          r={MARK_RING_R}
          vectorEffect="non-scaling-stroke"
          className={MARK_STROKE_LAYER}
        />
        {pulse ? (
          <circle
            cx={MARK_R}
            cy={MARK_R}
            r={MARK_RING_R}
            vectorEffect="non-scaling-stroke"
            // `markTone({ tone: "lime" })` rather than a second `accent`/`primary` pair written
            // out here: lime is `accent` in light and `primary` in dark, and that flip has one
            // spelling in this layer (§5.4). It publishes `--mark-paint` on this circle alone,
            // so the dot's own fill beside it is untouched.
            className={cn(
              "populace-dot-breath-ring",
              markTone({ tone: "lime" }),
              "[fill:none] [stroke-width:1px] [stroke:var(--mark-paint)]",
            )}
          />
        ) : null}
      </svg>
    </>
  );
});

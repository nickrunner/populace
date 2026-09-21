import { forwardRef } from "react";
import type { CSSProperties } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../cn.js";
import type { PersonDotState } from "../tokens.js";
import {
  MARK_FILL_LAYER,
  MARK_PITCH,
  MARK_R,
  MARK_RING_R,
  MARK_STROKE_LAYER,
  markState,
  markTone,
  markUnit,
} from "./Ring.js";
import type { BrandSize, BrandTone } from "./Ring.js";

/**
 * Capsule — individuals merged into one body: a **cohort** (DESIGN-SYSTEM §8.6).
 *
 * The mark fuses two lattice cells into a stadium twice: once horizontally, once vertically. This
 * is that shape, generalised to `cells` and to either axis, and it is what `CohortCapsule`,
 * `AvatarGroup` and the disclosure glyph are all drawn from.
 *
 * **Geometry.** A capsule of *n* cells is `26 + (n-1) × 31` units long — its two ends sit exactly
 * on the lattice's dot centres, so a capsule and a lattice tile together. The mark's own
 * horizontal capsule is 52 rather than 57, and its vertical one 40 rather than 57; both are
 * optically tightened by hand for the letterform. A capsule that has to line up with real dots
 * cannot be, so the pitch wins here and the deviation is deliberate.
 *
 * The six states are `Dot`'s six, because a cohort is a body of people and the same six things
 * can be true of it: present, absent, left, the one, provisional, selected. `theOne` carries the
 * lime law — 1.5px ink ring in light, 2px lime ring on transparent in dark (§5.4) — exactly as a
 * dot does.
 */

const capsule = cva("block shrink-0 overflow-visible");

export interface CapsuleProps {
  /** How many lattice cells the capsule fuses. Default 2 — the mark's own. */
  cells?: number;
  orientation?: "horizontal" | "vertical";
  size?: BrandSize;
  /** Default `present`. `provisional` is a cohort that has not run yet. */
  state?: PersonDotState;
  /** Recolours the state. Ignored by `theOne` and by `selected`'s wash. */
  tone?: BrandTone;
  /** Names the shape. Without one the capsule is `aria-hidden`. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

export const Capsule = forwardRef<SVGSVGElement, CapsuleProps>(function Capsule(
  {
    cells = 2,
    orientation = "horizontal",
    size = "md",
    state = "present",
    tone,
    label,
    className,
    style,
  },
  ref,
) {
  const span = Math.max(1, Math.round(cells));
  /** The long axis, in the mark's units. One cell is a circle; each further cell adds a pitch. */
  const length = MARK_R * 2 + (span - 1) * MARK_PITCH;
  const ratio = length / (MARK_R * 2);
  const horizontal = orientation === "horizontal";

  const w = horizontal ? length : MARK_R * 2;
  const h = horizontal ? MARK_R * 2 : length;
  const along = `calc(var(--mark-unit) * ${ratio})`;

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${w} ${h}`}
      className={cn(
        markUnit({ size }),
        markState({ state }),
        tone ? markTone({ tone }) : "",
        capsule(),
        className,
      )}
      style={{
        width: horizontal ? along : "var(--mark-unit)",
        height: horizontal ? "var(--mark-unit)" : along,
        ...style,
      }}
      role={label ? "img" : undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {label ? <title>{label}</title> : null}
      <rect x={0} y={0} width={w} height={h} rx={MARK_R} className={MARK_FILL_LAYER} />
      <rect
        x={1}
        y={1}
        width={w - 2}
        height={h - 2}
        rx={MARK_RING_R}
        vectorEffect="non-scaling-stroke"
        className={MARK_STROKE_LAYER}
      />
    </svg>
  );
});

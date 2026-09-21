import { forwardRef } from "react";
import type { CSSProperties } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../cn.js";

/**
 * Ring — the mark's second letter: a circle that is *not* filled (DESIGN-SYSTEM §8.6).
 *
 * A filled circle is an individual who was there; a ring is an individual who was not. Everything
 * in the brand is a circle or a stadium, so this and `Dot` are the two atoms the whole mark
 * grammar is spelled with. `Ring` is also the free-standing ring wherever one is needed with no
 * person attached to it: an empty roster slot, the 2px ring that says "here, now", the 1px lime
 * ring the live dot falls back to under reduced motion. Its default weight is the mark's own
 * **1px** absent ring (§1.2 M4); 1.5px and 2px are asked for by name.
 *
 * ---------------------------------------------------------------------------------------------
 * THIS FILE ALSO HOSTS THE GRAMMAR THE OTHER FOUR SHARE.
 *
 * `Dot`, `Capsule`, `Lattice` and `Fan` all need the same drawing space, the same size tokens and
 * the same colour protocol. They live here, in the lowest of the five primitives, rather than in
 * a sixth file, because this wave ships exactly five files. A later wave may lift them into
 * `brand/marks.ts` with no change to any call site — everything below is exported by name.
 *
 * **The drawing space.** Every brand primitive draws in the mark's own units: pitch 31, dot
 * diameter 26 (r=13), gap 5. The rendered size is a CSS token (`--lat-dot*`), so a viewBox of
 * `0 0 26 26` scales to whatever the token says and nothing in TypeScript knows a pixel. Strokes
 * carry `vector-effect="non-scaling-stroke"`, which is what keeps a 1.5px ring 1.5px at 6px and
 * at 15px instead of scaling into a smear at one end and a hairline at the other.
 *
 * **The colour protocol.** A shape's paint is never a class on the shape — it is the custom
 * property `--mark-paint`, set on the root by `markTone()`, and read by the layers as
 * `--mark-fill` / `--mark-stroke`. That is what lets one element structure carry six states
 * without a compound-variant explosion, and it is why the theme flip is a `dark:` class on a
 * custom property rather than a branch in TypeScript.
 * ---------------------------------------------------------------------------------------------
 */

/** The mark's drawing space, in the mark's own units. */
export const MARK_VIEWBOX = "0 0 26 26";
/** Dot radius: the mark's 26 diameter. */
export const MARK_R = 13;
/** Ring radius: inset by one unit so a stroke straddling it stays inside the pitch. */
export const MARK_RING_R = 12;
/** The mark's pitch — centre to centre. 26/31 = 0.839, the ratio every lattice keeps. */
export const MARK_PITCH = 31;
/** The air the mark leaves between two adjacent dots: a pitch less a diameter. Five units. */
export const MARK_GAP = MARK_PITCH - MARK_R * 2;
/**
 * Half that air — the inset from a cell's corner to the dot inside it, 2.5 units.
 *
 * It is the number anything laying the mark out **on its own grid** needs: a `<pattern>` tile in
 * `LatticeField`, a hand-drawn cell grid in `ReachDiagram`. Both had written `2.5` or re-derived
 * it locally, which is a geometry constant with two homes and therefore two chances to drift.
 */
export const MARK_INSET = MARK_GAP / 2;
/**
 * The same five units **as a CSS length**, for a row of `Dot`s laid out by flexbox rather than by
 * the lattice grid.
 *
 * It is written against the two properties `markUnit()` and `markPitch()` publish, so a container
 * that applies both gets the mark's own gap at whichever of the three sizes it asked for, and
 * nothing multiplies a ratio by hand. **A container using this must publish both** — `markUnit`
 * alone leaves `--mark-pitch` unset and the gap collapses.
 */
export const MARK_CELL_GAP = "calc(var(--mark-pitch) - var(--mark-unit))";
/** The mark's own dashed rhythm. "This has not happened yet." */
export const MARK_DASH = "2 7";

/** sm 6px · md 10px · lg 15px — the three lattice dot tokens, and nothing in between. */
export type BrandSize = "sm" | "md" | "lg";

/**
 * The colour register a mark shape is speaking in.
 *
 * `lime` is the one that needs saying out loud: lime is `accent` in light and `primary` in dark —
 * the same colour under a different token name (§5.4). Anything that must be lime in *both*
 * themes, such as a shape sitting on a forest ground, asks for `lime` and gets the flip in CSS.
 */
export type BrandTone =
  | "primary"
  | "lime"
  | "ink"
  | "muted"
  | "rule"
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "confirmed"
  | "evidence"
  | "current";

/** Publishes `--mark-unit`, the rendered diameter, from the lattice tokens in theme.css. */
export const markUnit = cva("", {
  variants: {
    size: {
      sm: "[--mark-unit:var(--lat-dot-sm)]",
      md: "[--mark-unit:var(--lat-dot)]",
      lg: "[--mark-unit:var(--lat-dot-lg)]",
    },
  },
  defaultVariants: { size: "md" },
});

/** Publishes `--mark-pitch`, centre to centre, paired to the same three sizes. */
export const markPitch = cva("", {
  variants: {
    size: {
      sm: "[--mark-pitch:var(--lat-pitch-sm)]",
      md: "[--mark-pitch:var(--lat-pitch)]",
      lg: "[--mark-pitch:var(--lat-pitch-lg)]",
    },
  },
  defaultVariants: { size: "md" },
});

/** Publishes `--mark-paint`. Every fill and every stroke in the brand resolves through it. */
export const markTone = cva("", {
  variants: {
    tone: {
      primary: "[--mark-paint:var(--color-primary)]",
      lime: "[--mark-paint:var(--color-accent)] dark:[--mark-paint:var(--color-primary)]",
      ink: "[--mark-paint:var(--color-ink)]",
      muted: "[--mark-paint:var(--color-ink-muted)]",
      rule: "[--mark-paint:var(--color-rule-strong)]",
      critical: "[--mark-paint:var(--color-critical)]",
      high: "[--mark-paint:var(--color-high)]",
      medium: "[--mark-paint:var(--color-medium)]",
      low: "[--mark-paint:var(--color-low)]",
      confirmed: "[--mark-paint:var(--color-confirmed)]",
      evidence: "[--mark-paint:var(--color-evidence)]",
      current: "[--mark-paint:currentColor]",
    },
  },
  defaultVariants: { tone: "primary" },
});

/**
 * The six readings of the mark's grammar, as classes rather than as elements (§8.6).
 *
 * A shape publishes `--mark-fill` and `--mark-stroke`; the layers of `Dot` and `Capsule` read
 * them. One element structure therefore carries all six states, and `theOne`'s two genuinely
 * different drawings — a lime fill inside a mandatory 1.5px ink ring in light, a 2px lime ring on
 * transparent in dark (§5.4) — are a `dark:` flip on a custom property, not a branch in
 * TypeScript. Five of the six take a `markTone()` override; `theOne` paints itself.
 */
export const markState = cva("", {
  variants: {
    state: {
      present: "[--mark-paint:var(--color-primary)] [--mark-fill:var(--mark-paint)]",
      absent:
        "[--mark-paint:var(--color-rule-strong)] [--mark-stroke:var(--mark-paint)] [--mark-stroke-w:1px]",
      left: "[--mark-paint:var(--color-ink-muted)] [--mark-fill:var(--mark-paint)]",
      theOne: [
        "[--mark-fill:var(--color-accent)]",
        "[--mark-stroke:var(--color-mark-ring)] [--mark-stroke-w:1.5px]",
        "dark:[--mark-fill:transparent]",
        "dark:[--mark-stroke:var(--color-primary)] dark:[--mark-stroke-w:2px]",
      ].join(" "),
      provisional:
        "[--mark-paint:var(--color-rule-strong)] [--mark-stroke:var(--mark-paint)] [--mark-dash:2_7]",
      selected: [
        "[--mark-paint:var(--color-primary)]",
        "[--mark-fill:var(--color-primary-wash)]",
        "[--mark-stroke:var(--mark-paint)] [--mark-stroke-w:2px]",
      ].join(" "),
    },
  },
  defaultVariants: { state: "present" },
});

/** The classes the stroked layer of a `Dot` or a `Capsule` reads the protocol with. */
export const MARK_STROKE_LAYER = [
  "[fill:none]",
  "[stroke:var(--mark-stroke,transparent)]",
  "[stroke-width:var(--mark-stroke-w,1.5px)]",
  "[stroke-dasharray:var(--mark-dash,none)]",
].join(" ");

/** The classes the filled layer reads the protocol with. */
export const MARK_FILL_LAYER = "[fill:var(--mark-fill,none)]";

/**
 * 1px the mark's own ring · 1.5px a ring that has to carry against a fill · 2px "here, now" and
 * "the one" in dark.
 *
 * **`hair` is the default, and that is M4 rather than taste** (§1.2 M4, §2.6): the lattice's
 * *absent* dot is a **1px** `rule-strong` ring, and a free-standing `Ring` is the same reading
 * with no person attached to it — an empty roster slot. `rule-strong` is ≥3:1 on every ground in
 * both themes, so 1px is legible, and the incidence reading a roster carries depends on an
 * un-hit person looking like a ring rather than like a thick outline of a dot.
 */
export type RingWeight = "hair" | "ring" | "strong";

const ring = cva(
  [
    "block shrink-0 overflow-visible",
    "w-[var(--mark-unit)] h-[var(--mark-unit)]",
    "[fill:none] [stroke:var(--mark-paint)]",
  ].join(" "),
  {
    variants: {
      weight: {
        hair: "[stroke-width:1px]",
        ring: "[stroke-width:1.5px]",
        strong: "[stroke-width:2px]",
      },
      /** The mark's 2/7 rhythm: this has not happened yet. */
      dashed: {
        true: "[stroke-dasharray:2_7]",
        false: "",
      },
    },
    defaultVariants: { weight: "hair", dashed: false },
  },
);

export interface RingProps {
  size?: BrandSize;
  /** Default `rule` — an empty slot is drawn in the boundary colour, not in a person's. */
  tone?: BrandTone;
  /** Default `hair` — the mark's 1px absent ring (§1.2 M4). */
  weight?: RingWeight;
  dashed?: boolean;
  /** Names the shape. Without one the ring is `aria-hidden`, which is right inside a lattice. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

export const Ring = forwardRef<SVGSVGElement, RingProps>(function Ring(
  { size = "md", tone = "rule", weight = "hair", dashed = false, label, className, style },
  ref,
) {
  return (
    <svg
      ref={ref}
      viewBox={MARK_VIEWBOX}
      className={cn(markUnit({ size }), markTone({ tone }), ring({ weight, dashed }), className)}
      style={style}
      role={label ? "img" : undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {label ? <title>{label}</title> : null}
      <circle cx={MARK_R} cy={MARK_R} r={MARK_RING_R} vectorEffect="non-scaling-stroke" />
    </svg>
  );
});

import { forwardRef } from "react";
import type { CSSProperties } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../cn.js";
import { MARK_FILL_LAYER, MARK_R, MARK_RING_R, MARK_STROKE_LAYER, markState } from "./Ring.js";

/**
 * Fan — a population exploring: a **run** (DESIGN-SYSTEM §8.6).
 *
 * Nine dashed béziers leaving one body and ending somewhere different, which is the whole product
 * in one picture. The geometry is the shipped exploration pattern's, translated so the fan starts
 * at its own left edge: one origin, control points that hold the line flat before it turns, and
 * terminal dots on three columns. There is not one diagonal, one arc of varying radius or one
 * gradient in it, because the brand has none.
 *
 * **Colour, and the lime law.** The strokes are **`rule-strong`**, which is the token §9.3 names
 * for them ("nine dashed béziers … 1.5px, `rule-strong`"). They were `currentColor` at
 * `stroke-opacity: 0.5` — the one alpha-over-a-hard-ground in the brand code, and the house rule
 * against that is not fussiness: half of a colour over an unknown ground is a contrast nobody has
 * measured, and these lines are a meaningful non-text mark, which §7 holds to 3:1. The token is
 * 3.51 on paper and 3.20 on sunk in light, 4.92 and 5.45 in dark, so the same one class clears
 * the bar in both themes without anything being halved. It is a **page-ground** mark: the fan is
 * drawn on paper or on a card (§9.3, "Hero: paper, not a forest cover"), never on the forest
 * band, where `rule-strong` would be 2.5:1. The terminal dots keep their own paint, which does
 * belong to the ground; they are drawn through the mark's own protocol (`markState`, the fill layer
 * and the stroke layer), so an ending is spelled in the same grammar a lattice dot is and no
 * second language is invented here:
 *
 * - `filed` — **the mark's `theOne`, borrowed whole**: in light a lime fill carrying the
 *   mandatory 1.5px `--color-mark-ring` (ink) ring, in dark a 2px lime ring on transparent
 *   (§1.2 M5, §5.4 appearance 4). Lime on forest is 7.97:1 and lime on paper is 1.08:1, so the
 *   ring is what keeps the fan's primary information visible in light **wherever it is set** —
 *   an empty state and `NotFound` sit on paper, not on the landing's forest band. Without it the
 *   fan's key is legible and the thing it keys is not.
 * - `done` — a hollow ring in `currentColor`: §9.3's "three hollow (got their errand done)", and
 *   the grammar's ring, which is an individual who is not the point.
 * - `gaveUp` — clay, and clay is allowed **only beside a word** (§4.1, §9.3, ATOMIC-INVENTORY §3).
 *   An end whose label is not rendered gets `ink-muted` — the grammar's `left`, a person who
 *   walked away — which is why the paint is a compound variant of the outcome and whether the end
 *   is named. `fanNamesItsEnds()` is that condition, exported so the legend beside the picture
 *   cannot drift from the picture.
 *
 * **Labels.** They are SVG text, so they scale with the viewBox, and at `panel` and `inline` they
 * would land at 5–6px. They are therefore rendered at `hero` only; at the two smaller sizes the
 * ends live in the `label` sentence instead. That is a resolution of a genuine ambiguity in the
 * spec, not a simplification of it.
 *
 * **Motion.** `animate` is the landing's one orchestrated moment (§5.1): each line arrives, then
 * its terminal dot lands, 70ms apart, ~900ms in total. The spec says the lines are drawn by
 * `stroke-dashoffset`; a 2/7 dashed stroke cannot literally be drawn that way — a dash offset on
 * a dashed line marches it — so the offset is paired with an opacity rise, which reads as the
 * line travelling outward. Reduced motion is handled globally in theme.css and both animations
 * hold their final frame.
 */

/** The fan's own drawing space, translated from the shipped pattern by -180 on x. */
const ORIGIN_X = 30;
const ORIGIN_Y = 315;
const CTRL_1_X = 350;
const CTRL_2_X = 410;
const FIRST_Y = 65;
const LAST_Y = 565;
const VIEW_H = 630;
/** Just enough for the widest terminal dot. */
const VIEW_W = 940;
/** Room for a word beside each terminal dot. */
const VIEW_W_LABELLED = 1140;
const END_R = 8;
/** The terminal ring, inset from the dot by the same fraction the mark insets its own (12/13). */
const END_RING_R = (END_R * MARK_RING_R) / MARK_R;
const ORIGIN_R = 13;

/** Three columns, so nine ends do not read as a straight edge. */
function endX(i: number): number {
  const column = i % 3;
  return column === 0 ? 760 : column === 1 ? 845 : 930;
}

/**
 * The three sizes, on the spacing scale rather than as pixel literals.
 *
 * `max-w-[520px]` and `w-[220px]` were two more of the one-off widths DESIGN-SYSTEM §2.4's layout
 * constants exist to have got rid of: a number in a class string that no token backs and nothing
 * else agrees with. Neither is a page measure, so neither is a `--w-*`; both are multiples of
 * `--spacing`, which is the token that governs every other size in the system. 130 × 4 = 520 and
 * 55 × 4 = 220, so the drawing is unchanged and the numbers now move with the scale.
 */
const fan = cva("block h-auto max-w-full", {
  variants: {
    size: {
      hero: "w-full",
      panel: "w-full max-w-130",
      inline: "w-55",
    },
  },
  defaultVariants: { size: "panel" },
});

/**
 * What an ending is painted in, published as `--mark-fill` / `--mark-stroke` on the end's group so
 * the two circles below read it exactly as a `Dot`'s two layers do.
 */
const fanEnd = cva("", {
  variants: {
    outcome: {
      /** The lime law, taken from the mark rather than restated: fill + mandatory ring / ring. */
      filed: markState({ state: "theOne" }),
      done: "[--mark-stroke:currentColor]",
      gaveUp: "",
    },
    /** Whether this end's word is on the page beside it. Clay's one condition (§4.1). */
    named: { true: "", false: "" },
  },
  compoundVariants: [
    { outcome: "gaveUp", named: true, class: "[--mark-fill:var(--pop-clay)]" },
    { outcome: "gaveUp", named: false, class: "[--mark-fill:var(--color-ink-muted)]" },
  ],
  defaultVariants: { outcome: "done", named: false },
});

const DRAW_CSS = `
@keyframes populace-fan-draw {
  from { opacity: 0; stroke-dashoffset: 120px }
  to   { opacity: 1; stroke-dashoffset: 0 }
}
@keyframes populace-fan-land {
  from { transform: scale(0) }
  to   { transform: none }
}
.populace-fan-line {
  animation: populace-fan-draw 220ms var(--ease) both;
  animation-delay: calc(var(--fan-i) * 70ms);
}
.populace-fan-land {
  transform-box: fill-box;
  transform-origin: center;
  animation: populace-fan-land 120ms var(--ease) both;
  animation-delay: calc(var(--fan-i) * 70ms + 220ms);
}`;

/** What became of one person's visit. The three endings the product has. */
export type FanOutcome = "filed" | "done" | "gaveUp";

export interface FanEnd {
  outcome: FanOutcome;
  /** Rendered beside the terminal dot at `hero`, and folded into the sentence at every size. */
  label?: string;
}

/** The hero on the landing, a panel inside a screen, an inline mark beside a sentence. */
export type FanSize = "hero" | "panel" | "inline";

/**
 * Whether this fan renders its ends' words — and therefore whether clay is licensed (§4.1, §9.3).
 *
 * SVG text scales with the viewBox, so at `panel` and `inline` a word would land at 5–6px and is
 * not drawn; only the landing's hero fan names its ends. Clay may never be anything at all inside
 * `/app`, and the fan has no route of its own to check, so **the word is the licence**: where the
 * fan says "gave up" beside the dot, the dot may be clay; everywhere else it is `ink-muted`.
 * `ExplorationFan` asks this same question for its legend swatch, which is why it is exported —
 * a key painted in clay beside a picture painted in ink-muted is exactly the tell §1.4 names.
 */
export function fanNamesItsEnds(ends: readonly FanEnd[], size: FanSize): boolean {
  return size === "hero" && ends.some((end) => end.label !== undefined);
}

export interface FanProps {
  ends: readonly FanEnd[];
  animate?: boolean;
  size?: FanSize;
  /** Draw the body the lines leave from. */
  origin?: "dot" | "none";
  /** The sentence that describes the picture. Without one the fan is `aria-hidden`. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

export const Fan = forwardRef<SVGSVGElement, FanProps>(function Fan(
  { ends, animate = false, size = "panel", origin = "dot", label, className, style },
  ref,
) {
  const labelled = fanNamesItsEnds(ends, size);
  const width = labelled ? VIEW_W_LABELLED : VIEW_W;
  const step = ends.length > 1 ? (LAST_Y - FIRST_Y) / (ends.length - 1) : 0;

  return (
    <>
      {animate ? (
        <style href="populace-brand-fan" precedence="default">
          {DRAW_CSS}
        </style>
      ) : null}
      <svg
        ref={ref}
        viewBox={`0 0 ${width} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        className={cn(fan({ size }), className)}
        style={style}
        role={label ? "img" : undefined}
        aria-hidden={label ? undefined : true}
        focusable="false"
      >
        {label ? <title>{label}</title> : null}
        {origin === "dot" ? (
          <circle cx={ORIGIN_X} cy={ORIGIN_Y} r={ORIGIN_R} className="[fill:currentColor]" />
        ) : null}
        {ends.map((end, i) => {
          const y = ends.length > 1 ? FIRST_Y + i * step : ORIGIN_Y;
          const x = endX(i);
          const named = labelled && end.label !== undefined;
          return (
            <g
              key={`${x}-${y}-${i}`}
              style={{ "--fan-i": i } as CSSProperties}
              className={cn(
                fanEnd({ outcome: end.outcome, named }),
                animate ? "populace-fan-line" : "",
              )}
            >
              <path
                d={`M ${ORIGIN_X} ${ORIGIN_Y} C ${CTRL_1_X} ${ORIGIN_Y} ${CTRL_2_X} ${y} ${x} ${y}`}
                vectorEffect="non-scaling-stroke"
                className={cn(
                  "[fill:none] [stroke:var(--color-rule-strong)]",
                  "[stroke-width:1.5px] [stroke-dasharray:2_7]",
                )}
              />
              <circle
                cx={x}
                cy={y}
                r={END_R}
                className={cn(MARK_FILL_LAYER, animate ? "populace-fan-land" : "")}
              />
              <circle
                cx={x}
                cy={y}
                r={END_RING_R}
                vectorEffect="non-scaling-stroke"
                className={cn(MARK_STROKE_LAYER, animate ? "populace-fan-land" : "")}
              />
              {named && end.label ? (
                <text
                  x={x + 18}
                  y={y}
                  dominantBaseline="central"
                  className={cn(
                    // Sentence case, untracked. §3.3 confines tracked-out caps to four roles —
                    // field labels, stat labels, table column heads, stub unit labels — and a
                    // terminal's word is none of them; §7.4 says labels are sentence case.
                    "[fill:currentColor] [font-family:var(--font-display)]",
                    "[font-size:14px]",
                  )}
                >
                  {end.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </>
  );
});

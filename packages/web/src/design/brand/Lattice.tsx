import { forwardRef } from "react";
import type { CSSProperties } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../cn.js";
import { focusRing } from "../variants.js";
import type { PersonDotState } from "../tokens.js";
import { markPitch, markUnit } from "./Ring.js";
import type { BrandSize, BrandTone } from "./Ring.js";
import { Dot } from "./Dot.js";

/**
 * Lattice — an ordered set of individuals: a **population** (DESIGN-SYSTEM §8.6).
 *
 * The mark is four dots high at pitch 31 with a dot of 26, and so is every lattice in the
 * product. This primitive owns that geometry and nothing else: it is a CSS grid whose track size
 * is `--mark-pitch` and whose cells hold `Dot`s, filling column by column so the set grows
 * rightwards the way the mark does. `RosterLattice` adds the sentence, the degradation rules and
 * the product's vocabulary on top; `Spinner` is this at `rows={1}` with three dots.
 *
 * **Naming.** With `onSelect` the dots are buttons, so the container is a `group` and each button
 * carries its own name — a `role="img"` container would hide them from assistive technology
 * altogether, and each button takes the 24/44px target §6 asks of a control. Without `onSelect`
 * the whole lattice is one image: `label` is the sentence that describes it and the dots
 * themselves are `aria-hidden`, so a roster is announced once rather than person by person. That split is why `label` means slightly different things in the two modes, and
 * it is deliberate.
 *
 * **Motion.** `animate` is the landing hero's one orchestrated moment (§5.1): opacity plus
 * `scale(.6) → 1`, 28ms stagger capped at 24 dots, ~1200ms in total. It runs on first paint only
 * — the animation is a CSS one keyed to the element, and dots are keyed by id, so a re-poll that
 * re-renders the same people never restarts it. Live screens poll every 2s; a lattice that
 * re-animated would strobe.
 */

const lattice = cva("grid");

/** The hero's entrance. Reduced motion is handled globally in theme.css: it lands at 100%. */
const ENTER_CSS = `
@keyframes populace-lattice-enter {
  from { opacity: 0; transform: scale(0.6) }
  to   { opacity: 1; transform: none }
}
.populace-lattice-enter { animation: populace-lattice-enter 520ms var(--ease) both }`;

/**
 * The selectable dot's tap target: 24px for a mouse, 44px on a coarse pointer (DESIGN-SYSTEM §6),
 * drawn as a centred `::after` box so the dot's own geometry is untouched. Same pattern as
 * `Button`'s `COARSE_HIT_AREA`, with the 24px floor added because a dot is never 24px wide.
 */
const HIT_AREA = [
  "after:absolute after:top-1/2 after:left-1/2",
  "after:size-6 after:-translate-x-1/2 after:-translate-y-1/2",
  "after:content-['']",
  "pointer-coarse:after:size-11",
].join(" ");

/** The stagger is capped at 24 dots, so a 200-person lattice does not take eight seconds. */
const STAGGER_MS = 28;
const STAGGER_CAP = 24;

/**
 * One dot, one individual. **`LatticeDot` is the only name for this shape**: the organism layer
 * used to restate it as a second interface with the same three fields, so a caller that reached
 * past `RosterLattice` to `Lattice` had to translate between two identical types for no reason.
 * The primitive owns the geometry and therefore owns the shape; `RosterLattice` re-exports this
 * one under the name ATOMIC-INVENTORY §3 organism 12 already gives it.
 */
export interface LatticeDot {
  id: string;
  state: PersonDotState;
  /** The person's name, or what the dot stands for. Never an id, never a slug. */
  label: string;
  /** Optional recolour, for the columns that are a reading rather than a roster. */
  tone?: BrandTone;
}

export interface LatticeProps {
  dots: readonly LatticeDot[];
  size?: BrandSize;
  /** Default 4 — the mark is four high, and so is every lattice. */
  rows?: number;
  /** The sentence that describes the set, or the group's name when the dots are selectable. */
  label?: string;
  onSelect?: (id: string) => void;
  animate?: boolean;
  className?: string;
  style?: CSSProperties;
}

export const Lattice = forwardRef<HTMLDivElement, LatticeProps>(function Lattice(
  { dots, size = "md", rows = 4, label, onSelect, animate = false, className, style },
  ref,
) {
  const trackCount = Math.max(1, Math.round(rows));

  return (
    <>
      {animate ? (
        <style href="populace-brand-lattice" precedence="default">
          {ENTER_CSS}
        </style>
      ) : null}
      <div
        ref={ref}
        className={cn(markUnit({ size }), markPitch({ size }), lattice(), className)}
        style={{
          gridTemplateRows: `repeat(${trackCount}, var(--mark-pitch))`,
          gridAutoFlow: "column",
          gridAutoColumns: "var(--mark-pitch)",
          placeItems: "center",
          ...style,
        }}
        role={onSelect ? "group" : label ? "img" : undefined}
        aria-label={label}
      >
        {dots.map((d, i) => {
          const enter = animate
            ? {
                className: "populace-lattice-enter",
                style: { animationDelay: `${Math.min(i, STAGGER_CAP) * STAGGER_MS}ms` },
              }
            : { className: "", style: undefined };

          if (onSelect) {
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => onSelect(d.id)}
                aria-label={d.label}
                className={cn(
                  "relative inline-flex cursor-pointer items-center justify-center rounded-full p-0",
                  "focus-visible:z-10",
                  focusRing,
                  // A dot is 6, 10 or 15px across and §6's floor for a control is 24 — so the
                  // target is an `::after` box, 24 for a mouse and 44 on a coarse pointer,
                  // exactly as `Button` draws it. It does not touch layout, so the lattice keeps
                  // the mark's 26:31 geometry. At these pitches neighbouring targets overlap;
                  // the later sibling paints over the earlier one, so a press in the seam picks
                  // the dot on the right — which is the direction the set reads in.
                  HIT_AREA,
                  enter.className,
                )}
                style={enter.style}
              >
                <Dot state={d.state} tone={d.tone} size={size} />
              </button>
            );
          }

          return (
            <Dot
              key={d.id}
              state={d.state}
              tone={d.tone}
              size={size}
              // §6: inside a `role="img"` lattice the dots are `aria-hidden`, and the sentence
              // on the container is the whole of what is announced. A name on each dot would
              // read a 200-person roster out one person at a time, and cost 200 `<title>` nodes.
              className={enter.className}
              style={enter.style}
            />
          );
        })}
      </div>
    </>
  );
});

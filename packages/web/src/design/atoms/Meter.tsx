import { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../cn.js";

/**
 * Meter — a proportion, drawn (ATOMIC-INVENTORY §1, atom 27). Replaces `Bar`.
 *
 * Three rules, and all three are review stops.
 *
 * 1. **The width never transitions** (§5.1). Live screens poll every two seconds; an animated
 *    width means every meter on the screen twitches twice a second forever. `transition-none` is
 *    written out rather than merely omitted, so a parent's `transition-all` cannot reach it.
 * 2. **It is never colour alone** (§6). `role="progressbar"` with real `aria-valuenow/min/max`
 *    and an `aria-valuetext` that is a SENTENCE — today the spend meter's number reaches nobody.
 *    The same sentence names the meter, so one prop carries both.
 * 3. **The fill is `graph`, not a highlight** (§4.1). `graph` exists for exactly this: a non-text
 *    mark whose meaning is also written. A meter is a reading, not an alarm, so there are **two
 *    fills, not four**: the graph mark, and `critical` once the reading is past its ceiling —
 *    `critical` being the one severity token that doubles as the error ink, and it never travels
 *    without the word beside it (§4.2).
 *
 *    That is why `attention` and `spent` paint the graph mark too. Neither `primary` (§4.1: never
 *    a chart series; it means the thing you act on and the person who is here) nor `medium` (§4.1:
 *    severity means severity, never a highlight) may be a bar fill, and the system has no third
 *    mark token — deliberately, because a meter that changes hue to say "look at me" is saying it
 *    in the one channel a reader may not have. **The caption beside the meter says it instead**:
 *    `SpendMeter` writes "of the $20.00 daily ceiling" and then "past the $20.00 daily ceiling".
 *    The two names are kept so a caller can still record what its reading MEANS at the call site.
 *
 * Full radius on the track (§5.2: the meter track is one of the five "people and states" shapes).
 * The lattice draws people; the meter is what a count degrades to past 200 of them, and what a
 * budget against a ceiling looks like at any size.
 */

const meterTrack = cva("block w-full overflow-hidden rounded-full bg-sunk", {
  variants: {
    size: {
      sm: "h-1",
      md: "h-2",
    },
  },
  defaultVariants: { size: "md" },
});

const meterFill = cva("block h-full rounded-full transition-none", {
  variants: {
    tone: {
      /** The default. A graph, not a highlight. */
      measure: "bg-graph",
      /** Worth looking at — a budget most of the way through, a cohort mostly hit. The WORD says
          so; the mark is the same mark, because a highlight has no token here (§4.1). */
      attention: "bg-graph",
      /** Money already gone against a ceiling. Also the graph mark: spend is a reading. */
      spent: "bg-graph",
      /** Past the ceiling. Always accompanied by the word. */
      over: "bg-critical",
    },
  },
  defaultVariants: { tone: "measure" },
});

export type MeterVariants = VariantProps<typeof meterFill>;

export interface MeterProps {
  value: number;
  of: number;
  tone?: "measure" | "attention" | "spent" | "over";
  /** A sentence: "Spent $4.12 of the $20.00 ceiling." It becomes the name AND the value text. */
  label: string;
  size?: "sm" | "md";
}

export const Meter = forwardRef<HTMLDivElement, MeterProps>(function Meter(
  { value, of, tone = "measure", label, size = "md" },
  ref,
) {
  const proportion = of > 0 ? Math.min(1, Math.max(0, value / of)) : 0;

  return (
    <div
      ref={ref}
      role="progressbar"
      aria-label={label}
      aria-valuetext={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={of}
      className={cn(meterTrack({ size }))}
    >
      {/*
        The one inline style in the atom, because the width IS the datum. One decimal place: a
        meter is a reading and the sub-pixel noise of a full float is not information.
      */}
      <span
        className={cn(meterFill({ tone }))}
        style={{ width: `${(proportion * 100).toFixed(1)}%` }}
      />
    </div>
  );
});

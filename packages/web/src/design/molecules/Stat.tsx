import { forwardRef, type ReactNode } from "react";

import { Text } from "../atoms/index.js";

/**
 * Stat — one measurement, labelled — ATOMIC-INVENTORY §2, molecule 13.
 *
 * Three lines at most, and the middle one is the whole point: a `t-figure` at 32px, which is the
 * step the type scale reserves for exactly this ("a `Stat` value", §3.3). The label above it is
 * `t-label` — one of the **four** roles allowed to set tracked-out caps (§3.3), all of which are
 * data labels on an instrument, which is precisely what this is.
 *
 * **Nothing here writes `tabular-nums`.** Every sans step already carries `"tnum" 1, "lnum" 1,
 * "zero" 1`, so the figure, the count in the sub-line and the label's own digits are tabular and
 * slash-zeroed by construction (§4.4). The port's success condition is that the string
 * `tabular-nums` appears zero times outside the type utilities, so a `Stat` that applied it by
 * hand would be the regression.
 *
 * **The 6px between the label and the figure is not written here either.** `theme.css` carries
 * `.t-label + .t-figure { margin-top: 6px }`, which is why the two `Text`es below are DOM
 * siblings with nothing between them — insert a wrapper and the gap silently disappears.
 *
 * **No number ever animates** (§5.1). There is no count-up here and there must never be one: a
 * figure that spins from 0 to 47 is lying about a measurement for half a second, and in a product
 * whose honesty clause is "outcomes vary between executions" a spinning number is a lie about
 * precision.
 *
 * `marked` is appearance 1 of the five sanctioned limes (§5.4) — the marker band behind the ink
 * in light, a 2px lime rule beneath it in dark, flipped entirely in the cascade. **Exactly one
 * marked thing per screen**, which is the screen's call to make, not this molecule's.
 */
export interface StatProps {
  /** The `t-label` caption. Sentence content, rendered in caps by the type step (§3.3). */
  label: string;
  /** The figure. A `Money`, a `RelativeTime`, a count, a fraction — anything that measures. */
  value: ReactNode;
  /** One `t-meta` line beneath, for what the figure is out of or where it came from. */
  sub?: ReactNode;
  /** The lime marker. One per screen, across every component on it (§5.4). */
  marked?: boolean;
}

export const Stat = forwardRef<HTMLDivElement, StatProps>(function Stat(
  { label, value, sub, marked = false },
  ref,
) {
  return (
    // `min-w-0` so a long value truncates inside its grid track rather than widening the strip
    // and pushing its neighbours off the row.
    <div ref={ref} className="min-w-0">
      <Text as="div" size="label" tone="muted">
        {label}
      </Text>
      <Text as="div" size="figure" marked={marked}>
        {value}
      </Text>
      {sub === undefined ? null : (
        <Text as="div" size="meta" tone="muted" className="mt-1">
          {sub}
        </Text>
      )}
    </div>
  );
});

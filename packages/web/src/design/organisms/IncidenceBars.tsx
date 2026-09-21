import { forwardRef } from "react";
import type { ClusterCardView } from "@populace/contract";

import { people } from "../../format.js";
import { Meter, Text } from "../atoms/index.js";

/**
 * IncidenceBars — how far a problem reached, cohort by cohort (ATOMIC-INVENTORY §3, organism 22).
 *
 * It replaces the two divergent proportion markups the app carries today: the finding row's
 * wrapping strip of 128px bars, and the "who missed it" list on the finding page, which measure
 * the same quantity in two different shapes so the eye cannot carry a reading from one to the
 * other. One shape, used in both places: a column of rows, name on the left, the measurement
 * across the middle, the fraction on the right. A column is what lets a reader compare *down*
 * — which is the entire question this component answers.
 *
 * **The bar is `graph`, never lime.** `accent` may never be a bar fill (§4.1), and on paper
 * `#D7F56B` is 1.08:1 — a lime bar in light mode is literally invisible (§1.2 M5). So "the one"
 * is not drawn by tinting a bar. It takes the **marker band** instead, which is appearance 1 of
 * the five sanctioned limes (§5.4): a band behind the fraction in light, a 2px lime rule beneath
 * it in dark, both flipped in the cascade with no TypeScript branch. §5.4 also fixes which
 * element earns it per screen — on the results screen it is the incidence peak of the worst
 * cluster — and **exactly one marked thing per screen** is the screen's call, not this
 * component's, which is why `theOne` is a prop and not a computation.
 *
 * **Never colour alone** (§4.2, §6). Every row says its reading three ways: the length of the
 * fill, the fraction beside it, and a sentence on the `Meter` itself — "Early adopters: 3 of 12
 * people hit this." — which is the meter's accessible name *and* its `aria-valuetext`, so the
 * number reaches a screen reader rather than being a width nobody can read.
 *
 * Nothing animates (§5.1): `Meter` pins its width to `transition-none` precisely because the
 * screens that carry this poll every two seconds, and a proportion that eases to its new value
 * is a chart lying about a measurement twice a second.
 *
 * **Not for a table cell** (§1.3 rule 10): cells hold values, not bars. This belongs beside a
 * finding or under a "who hit it" heading.
 */

/**
 * One cohort's incidence, taken from the wire rather than restated (§0.2). It is the element
 * type of `ClusterCardView["cohorts"]`, so a card's array can be passed straight through.
 */
export type CohortIncidence = ClusterCardView["cohorts"][number];

export interface IncidenceBarsProps {
  cohorts: readonly CohortIncidence[];
  /** The `slug` of the cohort that carries the screen's one marker band. */
  theOne?: string;
}

export const IncidenceBars = forwardRef<HTMLUListElement, IncidenceBarsProps>(
  function IncidenceBars({ cohorts, theOne }, ref) {
    /**
     * No cohorts is not an empty state — a finding with no breakdown simply has nothing to draw,
     * and an "empty" card here would be furniture around an absence. The sentence that belongs in
     * that case is the caller's, next to its own heading.
     */
    if (cohorts.length === 0) return null;

    return (
      <ul ref={ref} className="flex flex-col gap-2">
        {cohorts.map((cohort) => {
          const sentence = `${cohort.name}: ${cohort.hit} of ${people(cohort.total)} hit this.`;
          return (
            <li key={cohort.slug} className="flex items-center gap-3">
              {/*
                A fixed name column, so the bars all start on the same vertical and the lengths can
                be compared. `truncate` rather than a smaller step: §1.3 rule 6 — if the container
                cannot afford the type, the container is wrong, and the name is repeated in the
                meter's sentence for anyone the truncation loses.
              */}
              <Text as="span" size="meta" tone="muted" truncate className="w-36 shrink-0">
                {cohort.name}
              </Text>

              <span className="min-w-0 flex-1">
                <Meter value={cohort.hit} of={cohort.total} label={sentence} size="sm" />
              </span>

              {/*
                The figure. Tabular by construction — `t-meta` carries `tnum/lnum/zero`, so nothing
                here writes `tabular-nums` (§4.4). A cohort nobody hit reads `0/12` in muted ink:
                the absence is a reading too, and it is written rather than left as a bare track.
              */}
              <Text
                as="span"
                size="meta"
                tone={cohort.hit === 0 ? "muted" : "ink"}
                marked={cohort.slug === theOne}
                className="shrink-0"
              >
                {cohort.hit}/{cohort.total}
              </Text>
            </li>
          );
        })}
      </ul>
    );
  },
);

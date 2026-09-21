import { forwardRef, type ReactNode } from "react";

import { people, plural } from "../../../format.js";
import { Inline, Measure, Separator, Stack, Text } from "../../atoms/index.js";
import { CohortCapsule, RosterLattice } from "../../organisms/index.js";
import { Dot } from "../Dot.js";
import type { LatticeDot } from "../Lattice.js";
import { DiagramFigure, type DiagramDetail, type DiagramSize } from "./Figure.js";

/**
 * CompositionDiagram — how a population is composed, in the only three readings it has:
 * **a person, a cohort, a population** (DESIGN-SYSTEM §1.2 M4, §8.6; ADR-0029).
 *
 * M4 describes what a population should look like in one line — *"a column of bars of different
 * lengths made of visible individuals"* — and this figure is that sentence, drawn. It is the
 * picture that makes cohort-versus-population-versus-person click, because all three are on the
 * page at once and the *same people* appear in each: one circle, then those circles fused into
 * stadiums of different lengths, then every stadium's circles laid out as one ordered set.
 *
 * **It draws the real components, not pictures of them.** The bars are `CohortCapsule` — the
 * organism a cohort row on `RunCohorts` renders — and the field is `RosterLattice`, the organism
 * every incidence reading in the product is drawn with. Nothing here is a mock-up, which means
 * the figure cannot drift from the screens it explains, and it inherits their degradation ladder
 * for free: one dot per person to 40, one dot per five to 200, a `Meter` and a caption above
 * that (§1.2 M4). A reader looking at a 200-person population sees exactly what the product
 * would show them.
 *
 * **What it is careful not to claim.** Composition is fixed by the cohorts — the same cohorts
 * make the same number of people, in the same order, which is what `expandPopulation` is for.
 * What those people then *do* varies between executions by design (ADR-0028/0030), and the
 * caption says so rather than letting a tidy diagram imply otherwise.
 *
 * Phone width is the components' own: the capsules are `w-fit max-w-full` and stack in a column
 * whose lengths stay comparable, the cohort name truncates before the bar does, and the lattice
 * is a fixed-track grid that hugs its contents and never wraps past four rows.
 *
 * **Two axes, never one.** `size` is how much room the figure has; `detail` is how much of itself
 * it draws. Both are the folder's own unions, from `Figure.js`, and it is set in the folder's one
 * frame — `DiagramFigure` — rather than in a `<figure>` of its own.
 */

/** One cohort, as this figure needs it: a name a person typed, and a headcount. */
export interface CompositionCohort {
  /** The cohort's name. Never its slug (§7.4). */
  name: string;
  /** The headcount. The capsule's length IS this number. */
  size: number;
  /** A route to the cohort, where the figure is a way in. */
  to?: string;
}

/**
 * The sample the concepts page draws when it has no real population to hand — three cohorts of
 * visibly different lengths, because two of the same length would make the figure's own point
 * badly.
 */
const SAMPLE: readonly CompositionCohort[] = [
  { name: "Early adopters", size: 12 },
  { name: "Reluctant switchers", size: 7 },
  { name: "Power users", size: 4 },
];

/**
 * The people, grouped exactly as the population composes them.
 *
 * One pass, and the groups are kept rather than recovered by filtering, because the population
 * below is *the same array* flattened — which is the figure's whole claim. A label says who a
 * dot stands for and never an id or a slug (§0.2); these dots have no names because they stand
 * for a shape rather than for anyone.
 */
function compose(cohorts: readonly CompositionCohort[]): LatticeDot[][] {
  return cohorts.map((cohort, c) =>
    Array.from({ length: Math.max(0, Math.round(cohort.size)) }, (_, i) => ({
      id: `c${c}-${i}`,
      state: "present" as const,
      label: `someone in ${cohort.name}`,
    })),
  );
}

/** A band: its label, a hairline under it, and whatever the band is showing. */
function Band({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <Stack gap={3}>
      <Stack gap={2}>
        <Text size="eyebrow" tone="muted">
          {label}
        </Text>
        <Separator />
      </Stack>
      {children}
    </Stack>
  );
}

export interface CompositionDiagramProps {
  /** The cohorts, in the order the population composes them. Defaults to a three-cohort sample. */
  cohorts?: readonly CompositionCohort[];
  /** The population's name, where the figure is about a real one. */
  population?: string;
  /** How much room the figure has. */
  size?: DiagramSize;
  /**
   * `full` draws all three readings and their sentences; `compact` drops the single person and
   * the prose and keeps the two that carry the comparison.
   */
  detail?: DiagramDetail;
  id?: string;
  className?: string;
}

/**
 * The figure's own caption. **There is no `caption` prop, and that is §7.3 rather than an
 * oversight.** Every figure in this folder ends on the clause that keeps it honest — outcomes
 * vary between executions by design, and a problem that stops appearing is an absence rather
 * than a repair — and a prop that replaces the caption is a prop that deletes the clause. The
 * six mechanism and honesty figures never had one; these three did, and they do not now. A page
 * that wants to say more says it in its own prose beside the figure.
 */
const DEFAULT_CAPTION =
  "The same people appear in all three readings. Composition is fixed by the cohorts; what those people do on a visit varies between executions by design.";

export const CompositionDiagram = forwardRef<HTMLElement, CompositionDiagramProps>(
  function CompositionDiagram(
    {
      cohorts = SAMPLE,
      population,
      size = "panel",
      detail = "full",
      id,
      className,
    },
    ref,
  ) {
    const groups = compose(cohorts);
    const dots = groups.flat();
    const total = dots.length;
    const named = population === undefined ? "This population" : population;

    return (
      <DiagramFigure
        ref={ref}
        id={id}
        size={size}
        className={className}
        sample={cohorts === SAMPLE}
        name="A person, a cohort, a population"
        lede="The same people in all three readings: one circle, those circles fused into stadiums of different lengths, and every stadium's circles laid out again as one ordered set."
        trailing={`${people(total)}, ${plural(cohorts.length, "cohort")}`}
        caption={DEFAULT_CAPTION}
      >
        <Stack gap={8}>
          {detail === "full" ? (
            <Band label="One person">
              {/* `start`, not `center`: at phone width the sentence is four lines and a dot
                  centred against them reads as decoration. Hanging at the top-left it reads as
                  what it is — one person, and the sentence is about them. */}
              <Inline gap={3} align="start">
                <Dot state="present" size="lg" label="one person" className="mt-1.5" />
                <Measure width="read">
                  <Text as="p" size="read-sm" tone="soft">
                    One filled circle is one person — a durable individual with a stored name.
                    Every drawing below is made of these.
                  </Text>
                </Measure>
              </Inline>
            </Band>
          ) : null}

          <Band label={`A cohort is people on one persona — ${plural(cohorts.length, "cohort")} here`}>
            <Stack gap={2} align="start">
              {cohorts.map((cohort, c) => (
                <CohortCapsule
                  key={cohort.name}
                  name={cohort.name}
                  dots={groups[c] ?? []}
                  to={cohort.to}
                />
              ))}
            </Stack>
            {detail === "full" ? (
              <Measure width="read">
                <Text as="p" size="read-sm" tone="soft">
                  The stadium is the cohort and its length is the headcount — a bar made, visibly,
                  of the individuals inside it.
                </Text>
              </Measure>
            ) : null}
          </Band>

          <Band label="A population is those cohorts, in order">
            <RosterLattice
              dots={dots}
              size="md"
              sentence={`${named} is ${people(total)}, composed from ${plural(cohorts.length, "cohort")}`}
            />
            {detail === "full" ? (
              <Measure width="read">
                <Text as="p" size="read-sm" tone="soft">
                  Composition and nothing else: the same {people(total)} again, with the stadiums
                  taken away. The bar was the people all along.
                </Text>
              </Measure>
            ) : null}
          </Band>
        </Stack>
      </DiagramFigure>
    );
  },
);

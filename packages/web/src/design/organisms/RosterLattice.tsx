import { forwardRef } from "react";

import { people } from "../../format.js";
import { Lattice } from "../brand/index.js";
import type { LatticeDot } from "../brand/index.js";
import { Meter, Stack } from "../atoms/index.js";
import { MetaLine } from "../molecules/index.js";
import type { PersonDotState } from "../tokens.js";

/**
 * RosterLattice — signature move M4 (DESIGN-SYSTEM §1.2, §8.6), and the grafted heart of the
 * brand: the mark's own modular grid, rendered as a field of actual people.
 *
 * **Any count of people is drawn.** One circle is one individual; a ring is an individual who
 * was not there. Four rows always, because the mark is four high, at the mark's exact
 * proportions (dot ÷ pitch = 26 ÷ 31 = 0.839). The geometry, the six states and the lime law
 * all live in `brand/Lattice` and `brand/Dot`; this organism adds the three things that make it
 * a product component rather than a shape:
 *
 *  1. **The sentence.** A lattice is `role="img"` and the sentence is its name, so a reader is
 *     told "Nine of twelve people hit this" rather than counting circles (§6). The `n of N`
 *     text the contract asks for adjacent to it is the screen's, except in the two degraded
 *     modes below, where the scale itself has to be stated and this component states it.
 *  2. **The degradation ladder** (§1.2 M4). One dot per person to 40; **block mode** at 1 dot =
 *     5 people to 200; a `Meter` plus the count above that. It never scrolls, never wraps past
 *     four rows, and never shrinks the dot below the smallest lattice token.
 *  3. **The product's reading of the states.** `present`, `theOne` and `selected` are people who
 *     were *there*; that is what the meter measures when there are too many to draw.
 *
 * **It is forbidden inside a table cell** (§1.3 rule 10). Cells hold values.
 *
 * **Nothing here animates.** `brand/Lattice` can play the landing hero's entrance, and this
 * component deliberately never asks for it: a roster sits on screens that poll every two
 * seconds (§5.1), and a lattice that re-animated on each poll would strobe.
 *
 * **Compare stacks two of these** — execution A's above execution B's — so a problem that was
 * not reported in the newer one reads as a row of rings under a row of filled dots. That is
 * ADR-0028's claim drawn rather than described, and it is an **absence, never a repair**
 * (§7.3). It works because the grid is fixed-track and the container hugs its contents: two
 * lattices of the same length line up column for column with no coordination between them.
 */

/**
 * One person, as one circle. `id` is the React key, so it is who they are, not where they sit.
 *
 * The shape is `brand/Lattice`'s own and is re-exported rather than restated: the primitive owns
 * the geometry, so it owns the record the geometry is drawn from, and a second interface here
 * with the same fields under a second name was two names for one thing (§0.2). Callers keep
 * importing `LatticeDot` from this module, which is where ATOMIC-INVENTORY §3 organism 12 names
 * it, and anything reaching for the primitive directly now meets the same type.
 */
export type { LatticeDot };

export interface RosterLatticeProps {
  dots: readonly LatticeDot[];
  size?: "sm" | "md" | "lg";
  /** `role="img"`'s name — a sentence, with a number in it (§7.4). */
  sentence: string;
  /** Selectable dots become buttons, each named. Only ever offered at one dot per person. */
  onSelect?: (id: string) => void;
}

/** The ladder's two thresholds, and the fold (§1.2 M4). Exported because `CohortCapsule` folds
 *  by the same rule — a capsule and a lattice that disagreed about what one dot meant would be
 *  two scales on one screen. */
export const ROSTER_ONE_TO_ONE_MAX = 40;
export const ROSTER_PEOPLE_PER_BLOCK = 5;
export const ROSTER_BLOCK_MAX = ROSTER_ONE_TO_ONE_MAX * ROSTER_PEOPLE_PER_BLOCK;

/** Which rung of the ladder a count lands on. */
export type RosterScale = "one" | "block" | "meter";

export function rosterScale(count: number): RosterScale {
  if (count <= ROSTER_ONE_TO_ONE_MAX) return "one";
  if (count <= ROSTER_BLOCK_MAX) return "block";
  return "meter";
}

/**
 * The states that mean *this person was there*. `theOne` is present and singled out; `selected`
 * is present and picked. `left`, `absent` and `provisional` are the three ways of not being.
 */
const THERE: readonly PersonDotState[] = ["present", "theOne", "selected"];

export function rosterPresent(dots: readonly LatticeDot[]): number {
  return dots.filter((dot) => THERE.includes(dot.state)).length;
}

/**
 * Which state a block of five takes: `theOne` if it holds the one that matters — folding that
 * away would lose the single thing the screen was pointing at — and otherwise the commonest
 * state in the block, ties going to the more present reading.
 */
const FOLD_PRECEDENCE: readonly PersonDotState[] = [
  "present",
  "selected",
  "left",
  "provisional",
  "absent",
];

function foldState(block: readonly LatticeDot[]): PersonDotState {
  if (block.some((dot) => dot.state === "theOne")) return "theOne";

  const counts = new Map<PersonDotState, number>();
  for (const dot of block) counts.set(dot.state, (counts.get(dot.state) ?? 0) + 1);

  let chosen: PersonDotState = "absent";
  let best = -1;
  for (const state of FOLD_PRECEDENCE) {
    const count = counts.get(state) ?? 0;
    if (count > best) {
      chosen = state;
      best = count;
    }
  }
  return chosen;
}

/** Folds a roster into blocks of `per` people, in order, keeping every name in the block's own
 *  label so nothing a reader could have been told is thrown away. */
export function foldRoster(
  dots: readonly LatticeDot[],
  per: number = ROSTER_PEOPLE_PER_BLOCK,
): LatticeDot[] {
  const blocks: LatticeDot[] = [];
  for (let start = 0; start < dots.length; start += per) {
    const block = dots.slice(start, start + per);
    blocks.push({
      id: `block-${start / per}`,
      state: foldState(block),
      label: block.map((dot) => dot.label).join(", "),
    });
  }
  return blocks;
}

/** The caption the two degraded modes owe the reader: what they are looking at, and at what
 *  scale. Hairline-separated facts, never a middle dot (§4.5). */
function scaleFacts(total: number, scale: RosterScale): { key: string; node: string }[] {
  if (scale === "block") {
    return [
      { key: "people", node: people(total) },
      { key: "scale", node: `1 dot = ${people(ROSTER_PEOPLE_PER_BLOCK)}` },
    ];
  }
  return [
    { key: "people", node: people(total) },
    { key: "scale", node: "too many to draw one by one" },
  ];
}

export const RosterLattice = forwardRef<HTMLElement, RosterLatticeProps>(function RosterLattice(
  { dots, size = "md", sentence, onSelect },
  ref,
) {
  const total = dots.length;
  const scale = rosterScale(total);

  if (scale === "meter") {
    return (
      <Stack ref={ref} gap={1} align="stretch" className="w-full">
        <Meter value={rosterPresent(dots)} of={total} label={sentence} size="md" />
        <MetaLine facts={scaleFacts(total, scale)} />
      </Stack>
    );
  }

  const drawn = scale === "block" ? foldRoster(dots) : dots;

  return (
    <Stack ref={ref} gap={1} align="start" className="w-fit">
      <Lattice
        dots={drawn}
        size={size}
        label={sentence}
        // A folded dot is five people, so there is nobody for a click to mean. Selection is
        // offered only where one circle is one person.
        onSelect={scale === "one" ? onSelect : undefined}
      />
      {scale === "block" ? <MetaLine facts={scaleFacts(total, scale)} /> : null}
    </Stack>
  );
});

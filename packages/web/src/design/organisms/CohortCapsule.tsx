import { forwardRef, type ForwardedRef, type ReactElement } from "react";
import { cva } from "class-variance-authority";

import { people } from "../../format.js";
import { cn } from "../cn.js";
import { Capsule, Dot, MARK_PITCH, MARK_R, markUnit } from "../brand/index.js";
import { Link, Meter, Text } from "../atoms/index.js";
import { MetaLine } from "../molecules/index.js";
import { focusRing, pressTransition } from "../variants.js";
import {
  foldRoster,
  rosterPresent,
  rosterScale,
  ROSTER_PEOPLE_PER_BLOCK,
  type LatticeDot,
} from "./RosterLattice.js";

/**
 * CohortCapsule — a cohort, drawn as the mark draws one (DESIGN-SYSTEM §1.2 M4, §8.6).
 *
 * The mark fuses lattice cells into stadiums; the grammar reads a capsule as *individuals merged
 * into one body*, which is exactly what a cohort is — N people of one persona, and the only
 * place a headcount lives. So a cohort is a **stadium that hugs its contents**, and a population
 * is a column of those stadiums at different lengths, each visibly made of individuals. That is
 * the whole reason the population screens do not need a bar chart: the bar *is* the people.
 *
 * **The bar is `brand/Capsule`, not a CSS pill.** The stadium around the people is the mark's own
 * shape at the mark's own geometry — a capsule of *n* cells is `26 + (n-1) × 31` units long, so
 * its two ends land exactly on the first and last dot centres — and its length is therefore the
 * **headcount**, which is what makes M4's "a column of bars of different lengths" readable down a
 * list. The row of dots is spaced by the mark's own 5-unit gap expressed against the dot token
 * (`gap = unit × 5/26`), so the row and the capsule are the same length by construction rather
 * than by a pixel that happens to match: the token pitch is rounded to whole pixels and the
 * capsule's is not, and the two would drift a little further apart with every person.
 *
 * The body is drawn as a **ring**, because the fill belongs to the individuals inside it — a
 * filled stadium would erase the very thing it is made of. In the grammar that drawing is
 * `absent`: a shape that is not filled.
 *
 * The outer shell is the *record* — the thing you can open — and the capsule inside it is the
 * *measurement*. Full radius on both, because people and states are round and data is square
 * (§1.2 M6, §5.2). The shell's hairline is `rule` when the capsule is only telling you something
 * and `rule-strong` when it is a destination, which is §2.6's rule rather than a taste: anything
 * clickable is bounded at 3:1.
 *
 * **One row, not four.** The lattice's four rows are the mark's proportion for a *population*;
 * a capsule is one cell high in the mark, and a cohort read along a single row is what makes two
 * cohorts comparable at a glance by length. The degradation ladder is `RosterLattice`'s own,
 * imported rather than re-derived — a capsule and a lattice that disagreed about what one dot
 * meant would put two scales on one screen. Past its last rung there is no honest way to draw one
 * circle per person in a row, so the capsule gives way to a `Meter` and says what the bar is of.
 *
 * The fraction is the cohort's incidence when the screen has one — "9 of 12 hit" — and its
 * headcount when it does not. Never a bare number without its noun (§7.4).
 */

const capsule = cva(
  [
    "inline-flex w-fit max-w-full items-center gap-3",
    "rounded-full border bg-surface px-3 py-1.5",
    "[--focus-sep:var(--color-surface)]",
    pressTransition,
  ].join(" "),
  {
    variants: {
      /** A capsule you can open takes the interactive boundary and the hover ground (§2.6). */
      interactive: {
        true: `border-rule-strong no-underline hover:bg-hover ${focusRing}`,
        false: "border-rule",
      },
    },
    defaultVariants: { interactive: false },
  },
);

export interface CohortCapsuleProps {
  /** The cohort's name. Never its slug (§7.4). */
  name: string;
  dots: readonly LatticeDot[];
  /** How many of them hit the thing this screen is about. */
  hit?: number;
  /** The cohort's headcount, where it is larger than the roster drawn. */
  total?: number;
  to?: string;
}

/** The fraction, and the sentence that names the dots to a screen reader. Both say what the
 *  number is *of*, because a figure without its noun is not a fact. */
function readings(
  dots: readonly LatticeDot[],
  hit: number | undefined,
  total: number | undefined,
): { fraction: string; sentence: string } {
  const headcount = total ?? dots.length;
  if (hit !== undefined) {
    return {
      fraction: `${hit} of ${headcount} hit`,
      sentence: `${hit} of ${people(headcount)} in this cohort hit this`,
    };
  }
  return { fraction: people(headcount), sentence: `${people(headcount)} in this cohort` };
}

/** The mark's gap between two cells, in the mark's own units: a pitch less a dot. */
const MARK_GAP = MARK_PITCH - MARK_R * 2;

/**
 * The cohort's body: one stadium of `dots.length` fused cells with its individuals visible inside
 * it (§1.2 M4). The capsule is laid under the row rather than around it, which is what lets both
 * take their width from the same token — the row's gap and the capsule's length are both the
 * mark's units scaled by `--mark-unit`, so the stadium's ends sit on the outer dots' centres at
 * every size and at every headcount.
 *
 * The whole thing is one `role="img"` with the sentence as its name; the dots carry no label of
 * their own, because twelve names read one after another is not a reading (§6).
 */
function CohortBody({
  dots,
  sentence,
}: {
  dots: readonly LatticeDot[];
  sentence: string;
}): ReactElement {
  if (dots.length === 0) {
    return <Capsule cells={1} size="sm" state="absent" label={sentence} />;
  }

  return (
    <span
      role="img"
      aria-label={sentence}
      className={cn(markUnit({ size: "sm" }), "relative inline-flex shrink-0 items-center")}
    >
      <Capsule cells={dots.length} size="sm" state="absent" className="absolute top-0 left-0" />
      <span
        className="relative flex items-center"
        style={{ gap: `calc(var(--mark-unit) * ${MARK_GAP} / ${MARK_R * 2})` }}
      >
        {dots.map((dot) => (
          <Dot key={dot.id} state={dot.state} size="sm" />
        ))}
      </span>
    </span>
  );
}

/**
 * One callback that satisfies both branches' `ref` slots. The capsule is a `<div>` when it is
 * only telling you something and an `<a>` when it is a destination; a callback taking the
 * element both extend is assignable to each by ordinary parameter contravariance, which keeps
 * the public ref type honest without a cast.
 */
function assignTo(ref: ForwardedRef<HTMLElement>): (node: HTMLElement | null) => void {
  return (node) => {
    if (typeof ref === "function") ref(node);
    else if (ref !== null) ref.current = node;
  };
}

export const CohortCapsule = forwardRef<HTMLElement, CohortCapsuleProps>(function CohortCapsule(
  { name, dots, hit, total, to },
  ref,
) {
  const attach = assignTo(ref);
  const scale = rosterScale(dots.length);
  const { fraction, sentence } = readings(dots, hit, total);

  const body = (
    <>
      <Text size="name" truncate>
        {name}
      </Text>

      {scale === "meter" ? (
        // Past the ladder's second rung there is no honest way to draw one circle per person in
        // a single row, so the capsule carries the proportion instead and says so in words.
        <span className="inline-block w-24 shrink-0">
          <Meter value={rosterPresent(dots)} of={dots.length} label={sentence} size="sm" />
        </span>
      ) : (
        <CohortBody dots={scale === "block" ? foldRoster(dots) : dots} sentence={sentence} />
      )}

      <MetaLine
        facts={[
          { key: "fraction", node: fraction },
          {
            key: "scale",
            node: scale === "one" ? "" : `1 dot = ${people(ROSTER_PEOPLE_PER_BLOCK)}`,
          },
        ]}
      />
    </>
  );

  if (to === undefined) {
    return (
      <div ref={attach} className={cn(capsule())}>
        {body}
      </div>
    );
  }

  // `Link` carries the router, the focus ring and the underline law; the capsule's own shell is
  // merged over it, and `cn()` resolves display, radius and decoration in the caller's favour —
  // the documented mechanism, not a workaround.
  return (
    <Link ref={attach} to={to} tone="quiet" className={cn(capsule({ interactive: true }))}>
      {body}
    </Link>
  );
});

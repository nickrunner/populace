import { forwardRef, type ReactNode } from "react";
import { cva } from "class-variance-authority";

import { cn } from "../../cn.js";
import { Text } from "../../atoms/index.js";
import type { PersonDotState } from "../../tokens.js";
import { Dot } from "../Dot.js";
import {
  MARK_FILL_LAYER,
  MARK_INSET,
  MARK_PITCH,
  MARK_R,
  MARK_RING_R,
  MARK_STROKE_LAYER,
  Ring,
  markState,
} from "../Ring.js";
import { DiagramKey } from "./DiagramKey.js";
import { DiagramFigure, type DiagramSize } from "./Figure.js";

/**
 * ReachDiagram — **the product's whole argument, in one glance** (DESIGN-SYSTEM §1.2 M4, §8.6,
 * §9.3).
 *
 * One surface, drawn twice. On the left, the cells a suite touches: a single straight run of
 * them, joined by one line, because a test is an assertion about a path somebody already thought
 * of. On the right, the same surface after a population has been through it: no line at all, and
 * cells lit all over, because nobody told these people where to go.
 *
 * **This replaces paragraphs, and that is its job.** The argument it makes was previously made in
 * prose — a page of it — and prose is the wrong instrument for a comparison of two shapes. A
 * reader gets the point from the silhouette before reading a word, which is what a marketing
 * page's first figure owes them.
 *
 * **The grammar is the mark's, not an invention** (§8.6). A filled circle is somewhere that was
 * reached; a ring is somewhere that was not; the one lime dot with its mandatory ink ring is the
 * finding that came back. Every cell is drawn exactly as `Dot` draws one — the same two layers
 * reading the same `--mark-fill` / `--mark-stroke` protocol — so nothing here can drift from the
 * roster lattice on the dashboard, and `theOne`'s two very different drawings stay a `dark:`
 * flip rather than a branch in TypeScript.
 *
 * **The numbers are the picture's own.** `5 of 32` is counted off the mask that is drawn, so the
 * caption cannot claim something the figure does not show. Nothing here is a measurement of
 * anything, and the figure says so the one way this folder says it: `sample`, which prints
 * *illustrative* on the rule. There is no data prop, so the marker is unconditional (§9.6).
 *
 * **What it must never imply.** That a suite is wrong, or that a population is exhaustive. The
 * left half is a suite doing the job a suite is for, and the right half is one execution — a
 * different cast takes a different route, so the lit cells move (§7.3, ADR-0030). The caption
 * says both in a line each, and there is no third line.
 *
 * **Degradation.** Two columns at `md`, stacked below it, and each half keeps its own name, its
 * own count and its own sentence, so the comparison survives the stack. The shared key is at the
 * foot: shape first, word second, colour last, which is what makes the figure read in greyscale.
 */

/** The three readings a cell of the surface can have. A subset of the mark's six (§8.6). */
type SurfaceCell = Extract<PersonDotState, "present" | "absent" | "theOne">;

/** `#` reached · `*` reached, and something came back · `.` never reached. */
function cellOf(char: string): SurfaceCell {
  return char === "#" ? "present" : char === "*" ? "theOne" : "absent";
}

/**
 * Four rows, because the mark is four high and so is every lattice in this system (§1.2 M4).
 * Eight columns is the widest run that still leaves a 15px dot legible inside a phone's measure.
 */
const SUITE_MASK = [
  "........",
  ".#####..",
  "........",
  "........",
] as const;

const POPULATION_MASK = [
  "##.###.#",
  ".####.##",
  "##.#*##.",
  ".##.##.#",
] as const;

/**
 * The run the suite's one line joins, in mask coordinates. It is written here rather than
 * inferred from the mask so the line and the lit cells cannot come apart: a connector that
 * misses a dot by a cell is the kind of error a reader sees instantly and cannot name.
 */
const SUITE_PATH = { row: 1, from: 1, to: 5 } as const;

interface Half {
  id: string;
  /** The half's name. Sans — it names rather than says (§3.1). */
  title: string;
  /** One line under the count. Five or six words; this is a caption, not a paragraph. */
  note: string;
  mask: readonly string[];
  /** The sentence a screen reader is given for the picture. */
  sentence: string;
  path: typeof SUITE_PATH | null;
}

const HALVES: readonly Half[] = [
  {
    id: "suite",
    title: "A suite",
    note: "the path somebody wrote down",
    mask: SUITE_MASK,
    sentence:
      "A grid of everything somebody could try in a product. One straight run of it is lit and joined by a line: the path a test asserts. The rest is unlit.",
    path: SUITE_PATH,
  },
  {
    id: "population",
    title: "A population",
    note: "wherever the errands went",
    mask: POPULATION_MASK,
    sentence:
      "The same grid after a population has been through it. Lit cells all over it, joined by no line at all, and one of them is the finding that came back.",
    path: null,
  },
];

/**
 * Where cell *n*'s centre sits, in the mark's own units: `n` pitches, plus the dot's radius,
 * plus the half-gap the mark leaves around a 26 dot inside a 31 cell (`MARK_INSET`).
 *
 * It was written out six times as `n * MARK_PITCH + MARK_R + 2.5`, which put the one number in
 * this figure that the line and the dots must agree about in six places. They now cannot
 * disagree, and the `2.5` is the mark's constant rather than a literal.
 */
function centre(n: number): number {
  return n * MARK_PITCH + MARK_R + MARK_INSET;
}

function reachedIn(mask: readonly string[]): number {
  return mask.reduce((n, row) => n + row.replaceAll(".", "").length, 0);
}

function cellsIn(mask: readonly string[]): number {
  return mask.reduce((n, row) => n + row.length, 0);
}

/** The drawn width of one half. Neither is a page measure, so both are on the spacing scale. */
const surface = cva("block h-auto w-full", {
  variants: {
    size: { hero: "max-w-110", panel: "max-w-80" },
  },
  defaultVariants: { size: "panel" },
});

export interface ReachDiagramProps {
  size?: DiagramSize;
  id?: string;
  /**
   * The mechanism, after the picture. Defaults to **no caption at all**: the two halves name
   * themselves and the key says the rest, and a figure whose point lands in one glance does not
   * need a paragraph under it (§9.3).
   */
  caption?: ReactNode;
  className?: string;
}

export const ReachDiagram = forwardRef<HTMLElement, ReachDiagramProps>(function ReachDiagram(
  { size = "panel", id, caption = null, className },
  ref,
) {
  return (
    <DiagramFigure
      ref={ref}
      id={id}
      size={size}
      className={className}
      name="The same surface, twice"
      lede="A test checks a path somebody thought of. A population goes wherever its errand takes it."
      sample
      caption={caption}
    >
      <div className="grid gap-8 md:grid-cols-2 md:gap-10">
        {HALVES.map((half) => {
          const total = cellsIn(half.mask);
          const reached = reachedIn(half.mask);
          const cols = half.mask[0]?.length ?? 0;
          const rows = half.mask.length;

          return (
            <div key={half.id} className="grid gap-3 justify-items-start">
              <Text size="label" tone="muted">
                {half.title}
              </Text>

              <svg
                viewBox={`0 0 ${cols * MARK_PITCH} ${rows * MARK_PITCH}`}
                className={cn(surface({ size }), "overflow-visible")}
                role="img"
                focusable="false"
              >
                <title>{half.sentence}</title>

                {/*
                  Drawn before the cells so the dots sit on top of it, and axis-aligned because
                  there is not one diagonal anywhere in this brand (§8.6). It is the assertion:
                  one line, through the cells somebody already named.
                */}
                {half.path === null ? null : (
                  <line
                    x1={centre(half.path.from)}
                    x2={centre(half.path.to)}
                    y1={centre(half.path.row)}
                    y2={centre(half.path.row)}
                    vectorEffect="non-scaling-stroke"
                    className="[stroke:var(--color-primary)] [stroke-width:1.5px]"
                  />
                )}

                {half.mask.map((row, r) =>
                  Array.from(row, (char, c) => {
                    const cx = centre(c);
                    const cy = centre(r);
                    return (
                      // The two layers of a `Dot`, drawn in place: the state publishes
                      // `--mark-fill` and `--mark-stroke` and the circles read them, so one
                      // structure carries all three readings and lime keeps its ring (§5.4).
                      <g key={`${half.id}-${r}-${c}`} className={markState({ state: cellOf(char) })}>
                        <circle cx={cx} cy={cy} r={MARK_R} className={MARK_FILL_LAYER} />
                        <circle
                          cx={cx}
                          cy={cy}
                          r={MARK_RING_R}
                          vectorEffect="non-scaling-stroke"
                          className={MARK_STROKE_LAYER}
                        />
                      </g>
                    );
                  }),
                )}
              </svg>

              <Text size="meta" tone="muted">
                {reached} of {total} reached &middot; {half.note}
              </Text>
            </div>
          );
        })}
      </div>

      <DiagramKey
        ruled
        items={[
          { id: "reached", glyph: <Dot state="present" size="sm" />, label: "somebody got here" },
          { id: "unreached", glyph: <Ring size="sm" />, label: "nobody did" },
          {
            id: "filed",
            glyph: <Dot state="theOne" size="sm" />,
            label: "and filed a finding",
          },
        ]}
      />
    </DiagramFigure>
  );
});

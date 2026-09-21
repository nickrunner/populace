import { forwardRef, type ReactNode } from "react";
import type { ClusterCardView } from "@populace/contract";

import { people, plural } from "../../../format.js";
import type { SeverityLevel } from "../../tokens.js";
import { Measure, Meter, Text } from "../../atoms/index.js";
import {
  MetaLine,
  SeverityStack,
  SeverityTag,
  ToolName,
  type MetaFact,
} from "../../molecules/index.js";
import {
  Ledger,
  LedgerRow,
  ROSTER_PEOPLE_PER_BLOCK,
  foldRoster,
  rosterScale,
  type RosterScale,
} from "../../organisms/index.js";
import { Dot } from "../Dot.js";
import { Lattice, type LatticeDot } from "../Lattice.js";
import { Ring } from "../Ring.js";
import { DiagramKey } from "./DiagramKey.js";
import { DiagramFigure, EXECUTIONS_ARE_INDEPENDENT, type DiagramSize } from "./Figure.js";

/**
 * VarianceDiagram — one simulation, sent in twice, producing **overlapping but different**
 * results (DESIGN-SYSTEM §7.3; ADR-0030; ADR-0028 amendment).
 *
 * **This figure exists to make variance read as a designed property rather than as noise.**
 * There is no determinism subsystem in Populace and none is planned: the model is sampled, the
 * cadence jitters, the target's state moves, and two executions of one simulation *will* produce
 * different prose, different counts and different costs. A diagram that drew two identical
 * columns would be a lie the reader would not catch until their second execution. So the
 * difference is drawn as the subject of the picture, not as an error bar around it.
 *
 * **The drawing is the paired lattice** — the direction's established device, and the same one
 * `ExecutionCompare` uses on real data. Per problem, the earlier execution's dots sit **above**
 * the later one's, so a reader sees a row of **rings under a row of filled dots** before a word
 * is read: the mark's own grammar, where a filled circle is somebody who was there and a ring is
 * somebody who was not (§8.6). Overlap is a block of filled-over-filled; a difference at the
 * edges is a ring under a dot, or a dot under a ring. Nothing is drawn in a second language and
 * nothing is drawn in colour alone — every row carries the two headcounts in words beneath it.
 *
 * **What this figure must never imply.** That the second execution *checked* the first one's
 * findings; that a shorter row is an improvement; that a missing row was repaired. The row that
 * is reported in the first execution and not in the second is drawn, labelled and explained as
 * an **absence** here, and `AbsenceDiagram` is the whole figure about it.
 *
 * **Real parts, not a drawing of them.** The stub holds a real `SeverityStack`, the tool is a
 * real `ToolName` (with the coverage gap's `— not exposed`), the rows are a real `Ledger` with
 * the product's own 72px stub and continuous spine, and the roster folds by `RosterLattice`'s
 * own ladder so one dot never means five people here and one person there (§1.2 M4).
 *
 * **Degradation.** Below `md` the ledger stub collapses and the severity stack becomes a leading
 * line above its row (M2), the execution labels stay beside their lattices, and the figure is a
 * single column. Above 40 people the roster folds to `1 dot = 5 people` and says so; above 200 it
 * becomes a `Meter`, also captioned. At every width the numbers are in the `MetaLine`, so the
 * picture is never the only place a reading exists.
 */

/**
 * One problem, drawn twice.
 *
 * `inFirst` / `inSecond` are **headcounts, or `null` for "not reported in that execution"**, and
 * the distinction is the whole point: `0` would mean a problem reported by nobody, which is not
 * a thing the store can hold, and rendering a null as a zero is exactly how an absence gets
 * quietly turned into a measurement.
 */
export interface VarianceProblem {
  /** The cluster signature — the key a problem is matched by across executions (ADR-0028). */
  signature: string;
  title: string;
  tool: string;
  /** Taken from the contract's own union, so a diagram cannot invent a seventh kind. */
  kind: ClusterCardView["kind"];
  severity: SeverityLevel;
  /** How many of the cast reported it in the earlier execution. `null` — not reported. */
  inFirst: number | null;
  /** How many reported it in the later one. `null` — not reported. */
  inSecond: number | null;
}

/**
 * Five example problems, drawn to show all three shapes variance takes: reported either side
 * with different incidence, reported only the first time, reported only the second time. Any
 * fewer and the figure shows one of the three and implies the others do not happen. The numbers
 * are illustrative and the figure says so on its own rule; a caller with a real execution pair
 * passes its own.
 */
const SAMPLE_PROBLEMS: readonly VarianceProblem[] = [
  {
    signature: "sig1:4f2a91c7be03",
    title: "Searching in lower case finds nothing",
    tool: "search",
    kind: "bug",
    severity: "high",
    inFirst: 9,
    inSecond: 7,
  },
  {
    signature: "sig1:9c14ab77d520",
    title: "The second page comes back empty",
    tool: "list_items",
    kind: "bug",
    severity: "medium",
    inFirst: 4,
    inSecond: 6,
  },
  {
    signature: "sig1:2b80fe4a1c96",
    title: "Nothing here deletes anything, and the product page says you can",
    tool: "delete_item",
    kind: "coverage-gap",
    severity: "medium",
    inFirst: 5,
    inSecond: 8,
  },
  {
    signature: "sig1:71d0c3e85a4f",
    title: "A changed date is accepted and never saved",
    tool: "update_item",
    kind: "bug",
    severity: "high",
    inFirst: 3,
    inSecond: null,
  },
  {
    signature: "sig1:c6e2470ba931",
    title: "The plan limit only appears once you have hit it",
    tool: "create_item",
    kind: "friction",
    severity: "low",
    inFirst: null,
    inSecond: 2,
  },
];

/** The cast the example population draws: two cohorts of six. */
const SAMPLE_CAST = 12;

/**
 * One execution's half of a pair: the execution number, then the people, on one row.
 *
 * A single row, not the roster's four, because the pair has to read as *a row of rings under a
 * row of filled dots* — which is a one-row reading by definition. The sentence is the lattice's
 * own `aria-label`, so the pair reads to a screen reader the way it looks.
 */
function ExecutionRowSide({
  seq,
  hit,
  total,
  scale,
}: {
  seq: number;
  hit: number | null;
  total: number;
  scale: RosterScale;
}): ReactNode {
  const filled = hit === null ? 0 : Math.min(hit, total);
  const sentence =
    hit === null
      ? `Not reported in execution ${seq}.`
      : `Reported in execution ${seq}, by ${filled} of ${people(total)}.`;

  const dots: LatticeDot[] = Array.from({ length: total }, (_, index) => ({
    id: `${seq}-${index}`,
    state: index < filled ? "present" : "absent",
    label: index < filled ? "a person who reported it" : "a person who did not",
  }));

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
      <Text size="meta" tone="muted" className="whitespace-nowrap">
        {`execution ${seq}`}
      </Text>
      {scale === "meter" ? (
        <Meter value={filled} of={total} tone="measure" size="sm" label={sentence} />
      ) : (
        <Lattice
          dots={scale === "block" ? foldRoster(dots) : dots}
          rows={1}
          size="sm"
          label={sentence}
        />
      )}
    </div>
  );
}

/** The two headcounts in words. The picture is never the only place a reading exists (§4.2). */
function incidenceFacts(
  problem: VarianceProblem,
  cast: number,
  first: number,
  second: number,
  scale: RosterScale,
): readonly MetaFact[] {
  const read = (hit: number | null, seq: number): string =>
    hit === null
      ? `not reported in execution ${seq}`
      : `${hit} of ${people(cast)} in execution ${seq}`;

  return [
    { key: "first", node: read(problem.inFirst, first) },
    { key: "second", node: read(problem.inSecond, second) },
    { key: "scale", node: scale === "block" ? `1 dot = ${people(ROSTER_PEOPLE_PER_BLOCK)}` : null },
  ];
}

export interface VarianceDiagramProps {
  /** The problems, drawn in the order given. Defaults to an example pair of executions. */
  problems?: readonly VarianceProblem[];
  /**
   * How many people each execution sent. The same cast both times — a cohort's seed draws the
   * same traits per ordinal, so the *people* are comparable even though what they do is not
   * (ADR-0030). That is the one thing about an execution pair that does hold still, and saying
   * so is what keeps the rest of the figure from reading as chaos.
   */
  cast?: number;
  /** The two execution numbers, earlier first. Default `[1, 2]`. */
  executions?: readonly [number, number];
  size?: DiagramSize;
  id?: string;
  className?: string;
}

export const VarianceDiagram = forwardRef<HTMLElement, VarianceDiagramProps>(
  function VarianceDiagram(
    {
      problems = SAMPLE_PROBLEMS,
      cast = SAMPLE_CAST,
      executions = [1, 2],
      size = "panel",
      id,
      className,
    },
    ref,
  ) {
    const [first, second] = executions;
    const scale = rosterScale(cast);

    const both = problems.filter(
      (problem) => problem.inFirst !== null && problem.inSecond !== null,
    ).length;

    return (
      <DiagramFigure
        ref={ref}
        id={id}
        size={size}
        className={className}
        sample={problems === SAMPLE_PROBLEMS}
        name="The same simulation, sent in twice"
        lede={`Two executions of one simulation against one build, ${plural(cast, "person", "people")} each time. The cast is the same — a cohort's seed draws the same people — and what they do with your product is not.`}
        trailing={`${plural(problems.length, "problem")}, ${both} reported in both`}
        caption={
          <>
            <Text as="p" size="read" tone="ink">
              {EXECUTIONS_ARE_INDEPENDENT}
            </Text>
            <Text as="p" size="read-sm" tone="soft" className="mt-2">
              The overlap is the reading: two executions agree about what is badly wrong and part
              company at the edges. A row filled above and ringed below is not a repair and not a
              regression — it is a problem this execution did not happen to reach.
            </Text>
          </>
        }
      >
        <div className="grid gap-4">
          <Ledger as="ul" stubKind="mark">
            {problems.map((problem) => (
              <LedgerRow key={problem.signature} stub={<SeverityStack level={problem.severity} />}>
                <div className="grid gap-2">
                  {/*
                    The stack in the stub carries the count and the hue; this carries the word.
                    Severity is three redundant channels and a stub glyph on its own is two of
                    them (§1.2 M3, §4.2) — `ClusterRow` pairs them in exactly this arrangement on
                    the real results screen.
                  */}
                  <div className="flex flex-wrap items-baseline gap-2.5">
                    <SeverityTag level={problem.severity} />
                    <ToolName name={problem.tool} missing={problem.kind === "coverage-gap"} />
                  </div>

                  <Text as="div" size="read-sm" tone="ink">
                    {problem.title}
                  </Text>

                  <div className="grid gap-1">
                    <ExecutionRowSide
                      seq={first}
                      hit={problem.inFirst}
                      total={cast}
                      scale={scale}
                    />
                    <ExecutionRowSide
                      seq={second}
                      hit={problem.inSecond}
                      total={cast}
                      scale={scale}
                    />
                  </div>

                  <MetaLine facts={incidenceFacts(problem, cast, first, second, scale)} />
                </div>
              </LedgerRow>
            ))}
          </Ledger>

          {/*
            The key. Shape first, word second, colour last — so the figure survives greyscale, a
            monochrome print and a reader who cannot separate the two inks (§4.2).
          */}
          <DiagramKey
            ruled
            items={[
              {
                id: "present",
                glyph: <Dot state="present" size="sm" />,
                label: "a person who reported it",
              },
              { id: "absent", glyph: <Ring size="sm" />, label: "a person who did not" },
            ]}
          />

          <Measure width="read" as="div">
            <Text as="p" size="meta" tone="muted">
              {`Nothing in execution ${second} checked what execution ${first} found. A problem on one row and not the other is an absence on that row — nothing more.`}
            </Text>
          </Measure>
        </div>
      </DiagramFigure>
    );
  },
);

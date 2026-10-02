import { forwardRef, type ReactNode } from "react";
import type { ClusterCardView, ExecutionHistoryEntry } from "@populace/contract";

import { people, plural } from "../../format.js";
import { Lattice } from "../brand/index.js";
import { Measure, Meter, Text } from "../atoms/index.js";
import {
  MetaLine,
  Money,
  RelativeTime,
  SeverityTag,
  StateBlock,
  ToolName,
  type MetaFact,
} from "../molecules/index.js";
import { Card } from "./Card.js";
import { Section } from "./Section.js";
import {
  ROSTER_PEOPLE_PER_BLOCK,
  foldRoster,
  rosterScale,
  type LatticeDot,
  type RosterScale,
} from "./RosterLattice.js";

/**
 * ExecutionCompare — two executions side by side (ATOMIC-INVENTORY §3, organism 31).
 *
 * This is the one screen in the product that has to be careful about what it claims, and §7.3 is
 * the reason: **a problem absent from the newest execution is an absence, never a fix.** A problem
 * is matched across executions by its SIGNATURE — a hash of its kind, its primary tool and the
 * sorted content words of its title (ADR-0028). Stage 5 measured what that buys and the result is
 * a cliff rather than a curve: identical or punctuation-varied wording recurs 100% of the time,
 * and a complaint the model rewords from scratch recurs 0% of the time, because one different
 * content word is a different key by construction. So a signature that stops appearing may be a
 * silence in the *language*, not a change in the *product*, and this component cannot say
 * otherwise. The word "fixed" belongs to `TriageForm`, where a human types it about their own
 * software.
 *
 * **The paired lattice is that claim drawn rather than described.** Per problem, the earlier
 * execution's dots sit above the later one's, so "not reported in the newer one" renders as a row
 * of **rings under a row of filled dots** — the mark's own grammar, where a filled circle is
 * somebody who was there and a ring is somebody who was not (§8.6). A reader sees an absence as
 * an absence before a word is read, which is exactly the reading the copy is protecting.
 *
 * **What the wire cannot tell us, this component does not claim.** `ClusterCardView` carries one
 * incidence — the headcount the problem was reported with — and not one per execution. The dots
 * are drawn from it, and the group that holds problems reported either side says so out loud
 * rather than implying two separate measurements. **Which group a problem is in is the server's
 * answer, passed through** — `compareReadings` below says why that is not a detail.
 *
 * The contract has no `ExecutionCompareSideView`; `ExecutionHistoryEntry` is the record an
 * execution is summarised by, and it is the only one that carries the `seq` a reader recognises.
 */

/**
 * The honesty clause, preserved verbatim from the screen this replaces (§7.3). It is not small
 * print: a reader comparing two numbers without it reads noise as a change they caused.
 */
const CAVEAT =
  "A problem is matched between executions by the exact words in its title, so a complaint worded differently the second time reads as gone and as new at once. Open one and read the evidence before you call anything fixed.";

/** Also verbatim: two executions disagree by design, and nothing here is a regression test. */
const INDEPENDENT =
  "Executions are independent. Different people do different things, so expect the numbers to move even when nothing about your product changed.";

/** The three readings, in the order they are read. The key is React's and nothing else reads it. */
export type CompareReadingKey = "both" | "only-earlier" | "only-later";

/** The server's partition of the problems, exactly as `ExecutionCompareView` carries it. */
export interface ComparePartition {
  a: ExecutionHistoryEntry;
  b: ExecutionHistoryEntry;
  /** What both executions reported. */
  persisting: readonly ClusterCardView[];
  /** What `a` reported and `b` did not. The wire's field name, kept so the hand-off is visible. */
  fixed: readonly ClusterCardView[];
  /** What `b` reported and `a` did not. */
  appeared: readonly ClusterCardView[];
}

/** One group of problems, with the copy that says what being in it means. */
export interface CompareReading {
  key: CompareReadingKey;
  title: string;
  sub: string;
  note: string | undefined;
  empty: string;
  clusters: readonly ClusterCardView[];
  /** Did the earlier execution report these? A property of the GROUP, not of any card in it. */
  reportedEarlier: boolean;
  reportedLater: boolean;
}

/**
 * The three readings, taken from the partition the SERVER sent rather than re-derived here.
 *
 * This component used to compute the partition itself, asking each card whether its `seenIn` list
 * contained an execution's `seq`. It went wrong first in a way nothing on the screen showed: when
 * ADR-0045 scoped the signature history to report WINDOWS, `seenIn` briefly carried window
 * ordinals, so the filter compared two different countings and cards fell out of all three at once
 * and were dropped on the floor. `seenIn` counts executions again and `seenInWindows` carries the
 * ordinals (`ClusterCardView`), so that particular arithmetic no longer misfires.
 *
 * The re-derivation is still the defect, because the two questions were never the same question.
 * `compare()` partitions by RUN ID — it clusters each execution's own findings and asks which
 * representative signatures the two sets share — while `seenIn` is the study-wide GROUP's history
 * (`historiesOf(windows, groupsOf(findings))`), and a group deliberately holds every wording of
 * one problem. So the same bug worded one way in the earlier execution and another way in the
 * later one is two cards, one an absence and one an arrival, whose shared group was reported in
 * both: asked of `seenIn` each lands under "Reported in both", which is the opposite of what the
 * server's own record says and the very confusion `resultClusters` exists to prevent. A client
 * that recomputes an answer the server sent authoritatively can only ever drift from it. So
 * nothing here filters: the lists arrive and are rendered.
 *
 * What this DOES decide is which list is which. The server's `fixed` means "in `a`, not in `b`"
 * and `appeared` the reverse, both keyed to the argument order, while this screen reads earlier
 * and later off the sequence numbers so that a caller handing the pair over newest-first does not
 * get copy saying the opposite. When that happens the two lists swap with the two sides. Getting
 * it wrong would print "not reported in execution 7" over the problems only execution 7 reported,
 * which is the reverse claim and the worst sentence this screen could say.
 */
export function compareReadings(partition: ComparePartition): {
  earlier: ExecutionHistoryEntry;
  later: ExecutionHistoryEntry;
  readings: readonly CompareReading[];
} {
  const aIsEarlier = partition.a.seq <= partition.b.seq;
  const earlier = aIsEarlier ? partition.a : partition.b;
  const later = aIsEarlier ? partition.b : partition.a;
  const onlyEarlier = aIsEarlier ? partition.fixed : partition.appeared;
  const onlyLater = aIsEarlier ? partition.appeared : partition.fixed;

  return {
    earlier,
    later,
    readings: [
      {
        key: "both",
        title: "Reported in both",
        sub: "The same problem came up either side. This is the reliable half of the comparison.",
        note: "The headcount is the incidence the problem was reported with. It is not measured separately for each execution.",
        empty: "Nothing was reported in both executions.",
        clusters: partition.persisting,
        reportedEarlier: true,
        reportedLater: true,
      },
      {
        key: "only-earlier",
        title: `Not reported in execution ${later.seq}`,
        sub: "An absence, and only an absence. It may be gone, or it may have been described in different words this time.",
        note: undefined,
        empty: `Everything execution ${earlier.seq} reported came up again.`,
        clusters: onlyEarlier,
        reportedEarlier: true,
        reportedLater: false,
      },
      {
        key: "only-later",
        title: `Only in execution ${later.seq}`,
        sub: "Either genuinely new, or the same problem worded differently. Read one and see.",
        note: undefined,
        empty: `Execution ${later.seq} reported nothing execution ${earlier.seq} had not.`,
        clusters: onlyLater,
        reportedEarlier: false,
        reportedLater: true,
      },
    ],
  };
}

/**
 * One execution's half of the pair: the execution number in the stub position, then the people.
 *
 * **One row, not four.** `RosterLattice` is the four-row roster of a whole population and is the
 * right component nearly everywhere; here the pair has to read as *a row of rings under a row of
 * filled dots*, which is a single row by definition, so this draws the brand `Lattice` at
 * `rows={1}` directly. It borrows `RosterLattice`'s own degradation ladder rather than inventing
 * a second one — a screen where one dot meant five people in one place and one person in another
 * would be two scales at once (§1.2 M4).
 *
 * The sentence is the lattice's `aria-label`, so the row reads to a screen reader the way it
 * looks: *"reported in execution 2"* over *"not reported in execution 3"*.
 */
function LatticeSide({
  seq,
  reported,
  hit,
  total,
  scale,
}: {
  seq: number;
  reported: boolean;
  hit: number;
  total: number;
  scale: RosterScale;
}): ReactNode {
  const filled = reported ? Math.min(hit, total) : 0;
  /**
   * The figure names NO execution, and that is the fix for a real defect rather than a style
   * choice. One `ClusterCardView` is drawn on both sides, and its incidence belongs to whichever
   * execution's census built it: a `persisting` card comes from execution B, a `fixed` card from
   * execution A. So "Reported in execution 7, by 3 of 12" put one execution's number above the
   * other's roster — a second, invented measurement, which this component's own header says it
   * will not imply. The `execution ${seq}` stub beside the row still says WHICH side this is;
   * only the reach is left unattributed, because reach is the half that is not per-side.
   */
  const sentence = reported
    ? `Reported here, by ${filled} of ${people(total)}.`
    : `Not reported here.`;

  const dots: LatticeDot[] = Array.from({ length: total }, (_, index) => ({
    id: `${seq}-${index}`,
    state: index < filled ? "present" : "absent",
    label: index < filled ? "a person who reported it" : "a person who did not",
  }));

  return (
    <div className="grid grid-cols-[var(--w-stub)_minmax(0,1fr)] items-center gap-3">
      <Text size="meta" tone="muted" className="text-right">
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

/** One problem, drawn twice. No link: the row that navigates to a problem is `ClusterRow`. */
function PairedProblem({
  cluster,
  earlier,
  later,
  reportedEarlier,
  reportedLater,
}: {
  cluster: ClusterCardView;
  earlier: number;
  later: number;
  /**
   * Which side reported it, from the GROUP this card is in — the server's own partition by run
   * id — and never asked of the card itself. See `compareReadings`.
   */
  reportedEarlier: boolean;
  reportedLater: boolean;
}): ReactNode {
  const scale = rosterScale(cluster.peopleTotal);
  const facts: readonly MetaFact[] = [
    { key: "people", node: `${cluster.peopleHit} of ${people(cluster.peopleTotal)}` },
    { key: "reports", node: plural(cluster.reports, "report") },
    {
      key: "scale",
      node: scale === "block" ? `1 dot = ${people(ROSTER_PEOPLE_PER_BLOCK)}` : null,
    },
  ];

  return (
    <li className="grid gap-2 py-3.5">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <SeverityTag level={cluster.severity} kind={cluster.kind} />
        {cluster.tool === null ? null : (
          <ToolName name={cluster.tool} missing={cluster.kind === "coverage-gap"} />
        )}
      </div>

      <Text as="div" size="read-sm" tone="ink">
        {cluster.title}
      </Text>

      <div className="grid gap-1">
        <LatticeSide
          seq={earlier}
          reported={reportedEarlier}
          hit={cluster.peopleHit}
          total={cluster.peopleTotal}
          scale={scale}
        />
        <LatticeSide
          seq={later}
          reported={reportedLater}
          hit={cluster.peopleHit}
          total={cluster.peopleTotal}
          scale={scale}
        />
      </div>

      <MetaLine facts={facts} />
    </li>
  );
}

/**
 * One of the three readings, as a `Section`: the eyebrow set into a hairline with the count as the
 * trailing fact. The sub-line is serif, because it is the product saying what this group means —
 * and on this screen what it means is the whole point.
 */
function Group({
  reading,
  earlier,
  later,
}: {
  reading: CompareReading;
  earlier: number;
  later: number;
}): ReactNode {
  return (
    <Section title={reading.title} level={3} trailing={reading.clusters.length}>
      <Measure width="read" as="div">
        <Text as="p" size="read-sm" tone="soft">
          {reading.sub}
        </Text>
        {reading.note === undefined ? null : (
          <Text as="p" size="meta" tone="muted" className="mt-1">
            {reading.note}
          </Text>
        )}
      </Measure>

      {reading.clusters.length === 0 ? (
        <StateBlock kind="empty" what="this comparison">
          {reading.empty}
        </StateBlock>
      ) : (
        <ul className="mt-2 divide-y divide-rule">
          {reading.clusters.map((cluster) => (
            <PairedProblem
              key={cluster.signature}
              cluster={cluster}
              earlier={earlier}
              later={later}
              reportedEarlier={reading.reportedEarlier}
              reportedLater={reading.reportedLater}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

/** The numbers one execution finished with. Facts, not a comparison — the comparison is below. */
function SideSummary({
  role,
  execution,
}: {
  role: string;
  execution: ExecutionHistoryEntry;
}): ReactNode {
  const facts: readonly MetaFact[] = [
    { key: "status", node: execution.status },
    { key: "visits", node: plural(execution.visits, "visit") },
    { key: "findings", node: plural(execution.findings, "finding") },
    { key: "confirmed", node: `${execution.confirmed} confirmed` },
    { key: "cost", node: <Money usd={execution.costUsd} /> },
  ];

  return (
    <div className="grid min-w-0 gap-1">
      <Text size="eyebrow" tone="muted">
        {role}
      </Text>
      <Text size="name" tone="ink">
        {`execution ${execution.seq}`}
      </Text>
      <Text size="meta" tone="muted">
        {execution.startedAt === null ? (
          "never started"
        ) : (
          <RelativeTime at={execution.startedAt} mode="absolute" />
        )}
      </Text>
      <MetaLine facts={facts} />
    </div>
  );
}

/**
 * The props are the partition itself: `ExecutionCompareView`'s three lists and the two executions
 * they were computed over. There is deliberately no single `clusters` prop — one list plus a rule
 * for splitting it is what made this component re-derive the server's own answer.
 */
export type ExecutionCompareProps = ComparePartition;

export const ExecutionCompare = forwardRef<HTMLDivElement, ExecutionCompareProps>(
  function ExecutionCompare({ a, b, persisting, fixed, appeared }, ref) {
    // Which is earlier is read off the sequence rather than off the argument order, so a screen
    // that hands them over the other way round does not get copy that says the opposite — and the
    // three lists are the server's own, not a partition taken again here.
    const { earlier, later, readings } = compareReadings({ a, b, persisting, fixed, appeared });

    return (
      <div ref={ref} className="grid gap-8">
        <div className="grid gap-6 border-b border-rule pb-7 md:grid-cols-2">
          <SideSummary role="Earlier" execution={earlier} />
          <SideSummary role="Later" execution={later} />
        </div>

        {/* The quiet aside, in the inventory's own words for this block: `Card tone="sunk"`. */}
        <Card tone="sunk" pad="default">
          <Measure width="read" as="div">
            <Text as="p" size="read" tone="ink">
              {CAVEAT}
            </Text>
            <Text as="p" size="read-sm" tone="soft" className="mt-2">
              {INDEPENDENT}
            </Text>
            <Text as="p" size="read-sm" tone="soft" className="mt-2">
              Nothing below says a problem was repaired. A problem the later execution did not
              report is an absence, not a repair.
            </Text>
          </Measure>
        </Card>

        {readings.map((reading) => (
          <Group key={reading.key} reading={reading} earlier={earlier.seq} later={later.seq} />
        ))}
      </div>
    );
  },
);

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
 * rather than implying two separate measurements.
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

/** Was this problem reported in that execution? The `seenIn` list is the only record of it. */
function reportedIn(cluster: ClusterCardView, seq: number): boolean {
  return cluster.seenIn.includes(seq);
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
  const sentence = reported
    ? `Reported in execution ${seq}, by ${filled} of ${people(total)}.`
    : `Not reported in execution ${seq}.`;

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
}: {
  cluster: ClusterCardView;
  earlier: number;
  later: number;
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
          reported={reportedIn(cluster, earlier)}
          hit={cluster.peopleHit}
          total={cluster.peopleTotal}
          scale={scale}
        />
        <LatticeSide
          seq={later}
          reported={reportedIn(cluster, later)}
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
  title,
  sub,
  note,
  empty,
  clusters,
  earlier,
  later,
}: {
  title: string;
  sub: string;
  note?: string;
  empty: string;
  clusters: readonly ClusterCardView[];
  earlier: number;
  later: number;
}): ReactNode {
  return (
    <Section title={title} level={3} trailing={clusters.length}>
      <Measure width="read" as="div">
        <Text as="p" size="read-sm" tone="soft">
          {sub}
        </Text>
        {note === undefined ? null : (
          <Text as="p" size="meta" tone="muted" className="mt-1">
            {note}
          </Text>
        )}
      </Measure>

      {clusters.length === 0 ? (
        <StateBlock kind="empty" what="this comparison">
          {empty}
        </StateBlock>
      ) : (
        <ul className="mt-2 divide-y divide-rule">
          {clusters.map((cluster) => (
            <PairedProblem
              key={cluster.signature}
              cluster={cluster}
              earlier={earlier}
              later={later}
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

export interface ExecutionCompareProps {
  a: ExecutionHistoryEntry;
  b: ExecutionHistoryEntry;
  /**
   * Every problem either execution reported. The component partitions them by `seenIn`; a problem
   * neither execution reported is not part of this comparison and is dropped.
   */
  clusters: readonly ClusterCardView[];
}

export const ExecutionCompare = forwardRef<HTMLDivElement, ExecutionCompareProps>(
  function ExecutionCompare({ a, b, clusters }, ref) {
    // Which is earlier is read off the sequence rather than off the argument order, so a screen
    // that hands them over the other way round does not get copy that says the opposite.
    const earlier = a.seq <= b.seq ? a : b;
    const later = a.seq <= b.seq ? b : a;

    const both = clusters.filter(
      (cluster) => reportedIn(cluster, earlier.seq) && reportedIn(cluster, later.seq),
    );
    const onlyEarlier = clusters.filter(
      (cluster) => reportedIn(cluster, earlier.seq) && !reportedIn(cluster, later.seq),
    );
    const onlyLater = clusters.filter(
      (cluster) => !reportedIn(cluster, earlier.seq) && reportedIn(cluster, later.seq),
    );

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

        <Group
          title="Reported in both"
          sub="The same problem came up either side. This is the reliable half of the comparison."
          note="The headcount is the incidence the problem was reported with. It is not measured separately for each execution."
          empty="Nothing was reported in both executions."
          clusters={both}
          earlier={earlier.seq}
          later={later.seq}
        />

        <Group
          title={`Not reported in execution ${later.seq}`}
          sub="An absence, and only an absence. It may be gone, or it may have been described in different words this time."
          empty={`Everything execution ${earlier.seq} reported came up again.`}
          clusters={onlyEarlier}
          earlier={earlier.seq}
          later={later.seq}
        />

        <Group
          title={`Only in execution ${later.seq}`}
          sub="Either genuinely new, or the same problem worded differently. Read one and see."
          empty={`Execution ${later.seq} reported nothing execution ${earlier.seq} had not.`}
          clusters={onlyLater}
          earlier={earlier.seq}
          later={later.seq}
        />
      </div>
    );
  },
);

import { forwardRef } from "react";
import type { ReactNode } from "react";
import type { ClusterCardView } from "@populace/contract";

import { Inline, Mono, Stack, Text } from "../../atoms/index.js";
import { SeverityStack, SeverityTag, VerdictTag } from "../../molecules/index.js";
import { ExplorationFan, FindingCard, Ledger, LedgerRow } from "../../organisms/index.js";
import type { SeverityLevel, VerdictValue } from "../../tokens.js";
import type { FanEnd } from "../Fan.js";
import { Lattice } from "../Lattice.js";
import type { LatticeDot } from "../Lattice.js";
import { DiagramFlow } from "./DiagramFlow.js";
import { DiagramKey, type DiagramKeyItem } from "./DiagramKey.js";
import { DiagramSays } from "./DiagramSays.js";
import { DiagramStage } from "./DiagramStage.js";
import {
  AN_ABSENCE_ONLY,
  DIAGRAM_CARD_SCALE,
  DiagramFigure,
  NOT_A_REPAIR,
  type DiagramSize,
} from "./Figure.js";

/**
 * PipelineDiagram — findings → verify → cluster by signature → digest (ADR-0028, ADR-0017).
 *
 * The figure exists for its third stage. Clustering is keyed by a **signature** — `sig1:` plus a
 * hash of the finding's kind, its primary tool and its normalised title — and that key, not the
 * wording and not a row id, is what makes a problem the same problem in execution 1 and in
 * execution 4. Triage hangs off it, "what is new" and "what came back" are joins rather than
 * heuristics, and the finding page is addressed by it.
 *
 * **It draws the limit of the key as well as the key**, because the limit is the reason §7.3
 * exists. ADR-0028's amendment measured it: reports whose words agree under punctuation and
 * filler recur at 100%, and the same complaint reworded from scratch recurs at 0%, because a
 * signature is a hash of an exact token set. So the figure shows three reports landing on one key
 * **and a fourth, describing the same behaviour in its own words, landing on its own** — and says
 * in as many words why that makes an absence an absence rather than a repair. A diagram that
 * collapsed four differently-worded reports into one key would be selling a mechanism the
 * product does not have.
 *
 * **Real components, not drawings of them** (§9.3): the severities are real `SeverityStack`s, the
 * verdicts real `VerdictTag`s, the clustered result a real `FindingCard`, and the incidence a
 * real `Lattice` at the mark's own 26:31 geometry. The execution the reports came out of is drawn
 * by `ExplorationFan` — nine dashed béziers leaving one body and ending somewhere different,
 * which is the mark's own word for a population exploring (§8.6) — and the organism rather than
 * the bare `Fan`, because the legend and the sentence beside the picture are what stop three
 * endings from being carried by shape and hue alone (§1.3 rule 4).
 *
 * **The ordinals are the flow, and there is no rule** (§9.2). Four stages hung off one `Ledger`
 * until its spine was measured at 1,183px down `/use-cases`, aligning nothing: the stages are a
 * `Stack as="ol"` now and each prints its own ordinal as a `t-ref` eyebrow above its name. The
 * brand still draws no arrowheads because it has no diagonal. Inside stage three, where the
 * movement is genuinely sideways — many reports
 * into one key — a `DiagramFlow` turns the corner with the layout: a row at `md` and above, a
 * stack below it, where two columns would put a finding sentence under the 13px floor.
 */

/** One report as it arrived, before anything was done to it. */
export interface PipelineReport {
  /** The person who filed it. A name, never a slug (§7.4). */
  person: string;
  severity: SeverityLevel;
  title: string;
  /** What the judge's replay concluded. */
  verdict: VerdictValue;
  /** The key it hashes to. Reports sharing one are one problem. */
  signature: string;
}

/**
 * Four example reports out of one execution.
 *
 * The first three are the same complaint under different punctuation and filler, which lands on
 * one key; the fourth is the same behaviour described from scratch, which lands on its own. Both
 * halves of that are true of the signature, and the figure shows both rather than only the
 * flattering one.
 */
const REPORTS: readonly PipelineReport[] = [
  {
    person: "Ada Fenwick",
    severity: "high",
    title: "Search says it is case-insensitive and is not",
    verdict: "confirmed",
    signature: "sig1:1f0c9a2e41b7",
  },
  {
    person: "Noor Haddad",
    severity: "high",
    title: "Search says it is case insensitive, and is not.",
    verdict: "confirmed",
    signature: "sig1:1f0c9a2e41b7",
  },
  {
    person: "Jonah Rees",
    severity: "high",
    title: "Search says it is case-insensitive — and is not",
    verdict: "inconclusive",
    signature: "sig1:1f0c9a2e41b7",
  },
  {
    person: "Priya Mehta",
    severity: "high",
    title: "Capitals matter in search when the description says they do not",
    verdict: "confirmed",
    signature: "sig1:b40e77c2d915",
  },
];

/**
 * Where nine of the execution's visits ended. No end is named, so `fanNamesItsEnds()` is false
 * and the two that gave up are drawn in the grammar's `left` — `ink-muted`, a person who walked
 * away — rather than in clay, which is licensed on the landing's forest band and nowhere else
 * (§4.1, §9.3).
 */
const ENDS: readonly FanEnd[] = [
  { outcome: "filed" },
  { outcome: "done" },
  { outcome: "filed" },
  { outcome: "gaveUp" },
  { outcome: "done" },
  { outcome: "filed" },
  { outcome: "done" },
  { outcome: "gaveUp" },
  { outcome: "filed" },
];

/** Nine of twelve people hit it: nine filled circles, three rings (§1.2 M4). */
const INCIDENCE: readonly LatticeDot[] = Array.from(
  { length: 12 },
  (_, i): LatticeDot => ({
    id: `p${i}`,
    state: i < 9 ? "present" : "absent",
    label: i < 9 ? "a person who hit this" : "a person who did not",
  }),
);

const HOUR = 60 * 60 * 1000;

/**
 * What the three clustered reports become. `seenIn` skips execution 3 on purpose: the figure says
 * out loud that the gap is an absence and not a repair (§7.3, ADR-0028 amendment).
 */
const CLUSTER: ClusterCardView = {
  signature: "sig1:1f0c9a2e41b7",
  title: "Search says it is case-insensitive and is not",
  severity: "high",
  kind: "bug",
  tool: "search",
  verdict: "confirmed",
  peopleHit: 9,
  peopleTotal: 12,
  reports: 14,
  cohorts: [
    { slug: "early-adopters", name: "Early adopters", hit: 5, total: 6 },
    { slug: "reluctant-switchers", name: "Reluctant switchers", hit: 4, total: 6 },
  ],
  state: "open",
  seenIn: [1, 2, 4],
  firstSeenAt: new Date(Date.now() - 51 * HOUR).toISOString(),
  lastSeenAt: new Date(Date.now() - 2 * HOUR).toISOString(),
  triage: null,
};

/**
 * The fan's own sizes, mapped onto the figure's. Never `hero` — the hero fan is the landing's,
 * and it is the only one that names its ends and therefore the only one licensed to draw clay
 * (§4.1, §9.3).
 */
const FAN_SIZE = {
  hero: "panel",
  panel: "inline",
} satisfies Record<DiagramSize, "inline" | "panel">;

/**
 * Many reports on the left, one key on the right — sideways at `md` and above, stacked below it,
 * where two columns would put a finding sentence under §1.3 rule 6's 13px floor.
 */
const clusterGroup = "flex flex-col md:flex-row md:items-center";

/**
 * One report, as a row: the severity stack in the locator column, the complaint in the serif, and
 * the person under it.
 *
 * **The stack never stands alone** (§1.2 M3, §4.2). Severity is three redundant channels — the
 * count of lit dots, the word, and the hue — and a stack in a stub with no `SeverityTag` beside
 * it is two of the three. `ClusterRow` pairs them in exactly this arrangement on the real
 * results screen, so the figure is drawn the way the product draws it.
 */
function ReportRow({ report }: { report: PipelineReport }): ReactNode {
  return (
    <LedgerRow stub={<SeverityStack level={report.severity} />} density="tight">
      <Stack gap={1}>
        <Text as="div" size="read-sm" tone="ink">
          {report.title}
        </Text>
        <Inline gap={2} align="baseline" wrap>
          <SeverityTag level={report.severity} />
          <Text size="meta" tone="muted">
            {report.person}
          </Text>
        </Inline>
      </Stack>
    </LedgerRow>
  );
}

/**
 * How many reports concluded each way, as a `DiagramKey`: a count in the figure step, then the
 * verdict's own word. A count beside a word, never a colour alone (§4.2).
 */
function verdictCounts(reports: readonly PipelineReport[]): readonly DiagramKeyItem[] {
  const order: readonly VerdictValue[] = [
    "confirmed",
    "not-reproduced",
    "inconclusive",
    "unchecked",
  ];
  return order
    .map((value) => ({
      value,
      count: reports.filter((report) => report.verdict === value).length,
    }))
    .filter((row) => row.count > 0)
    .map((row) => ({
      id: row.value,
      glyph: (
        <Text size="figure-sm" tone="ink">
          {row.count}
        </Text>
      ),
      label: <VerdictTag value={row.value} />,
    }));
}

/** The reports that share a key, in the order they arrived, grouped without reordering. */
function bySignature(
  reports: readonly PipelineReport[],
): readonly { signature: string; reports: readonly PipelineReport[] }[] {
  const keys: string[] = [];
  for (const report of reports) {
    if (!keys.includes(report.signature)) keys.push(report.signature);
  }
  return keys.map((signature) => ({
    signature,
    reports: reports.filter((report) => report.signature === signature),
  }));
}

export interface PipelineDiagramProps {
  size?: DiagramSize;
  /** The reports one execution produced, before verification and clustering. */
  reports?: readonly PipelineReport[];
  /** What the largest group of them becomes once clustered. */
  cluster?: ClusterCardView;
  id?: string;
  className?: string;
}

export const PipelineDiagram = forwardRef<HTMLElement, PipelineDiagramProps>(
  function PipelineDiagram(
    { size = "panel", reports = REPORTS, cluster = CLUSTER, id, className },
    ref,
  ) {
    const groups = bySignature(reports);
    const counts = verdictCounts(reports);

    return (
      <DiagramFigure
        ref={ref}
        id={id}
        size={size}
        className={className}
        sample={reports === REPORTS && cluster === CLUSTER}
        name="Findings, verified, clustered, read"
        lede="One report per thing one person ran into. A judge replays each, a signature groups the ones that are the same problem, and the digest is what that leaves you reading."
        trailing={`${reports.length} reports, ${groups.length} keys`}
        caption={
          <>
            <Text as="p" size="read" tone="ink">
              {`Clustering is keyed by signature, which is what makes a problem the same problem across executions — and what makes a problem that stops appearing ${NOT_A_REPAIR}.`}
            </Text>
            <Text as="p" size="read-sm" tone="soft" className="mt-2">
              {AN_ABSENCE_ONLY}
            </Text>
          </>
        }
      >
        {/*
          A `Stack as="ol"`, not a `Ledger`: the stages are numbered but they are not a column
          of locators, so there is nothing for a spine to align (§9.2). The ordinal is the
          stage's own eyebrow, and the `<ol>` keeps the sequence in the document too.
        */}
        <Stack as="ol" gap={8}>
          <DiagramStage n="01" title="Findings arrive from many visits">
            <DiagramSays>
              Every person goes on their own visit. Some finish the errand, some file what stopped
              them, some leave. Nothing is aggregated yet — one report per thing one person ran
              into, each carrying the calls it rests on.
            </DiagramSays>
            {/*
              `ExplorationFan`, not the bare `Fan`: the organism is the picture **plus its
              legend and its sentence**, and a fan without them carries its three endings in
              shape and hue alone. It also builds the sentence out of the product's own counting
              words, and it paints the legend swatch by the same rule that paints the terminal it
              keys — including clay's one condition, which is not met here (§4.1, §9.3).
            */}
            <ExplorationFan ends={ENDS} size={FAN_SIZE[size]} />
            <Ledger as="ul" spine={false} stubKind="mark">
              {reports.map((report) => (
                <ReportRow key={report.person} report={report} />
              ))}
            </Ledger>
          </DiagramStage>

          <DiagramStage n="02" title="Each one is replayed and given a verdict">
            <DiagramSays>
              A judge re-runs the calls each report cited and records what came back. Nothing is
              dropped: the inconclusive one keeps its receipts and its verdict beside them.
            </DiagramSays>
            <DiagramKey items={counts} />
          </DiagramStage>

          <DiagramStage n="03" title="Clustering is keyed by signature">
            <DiagramSays>
              A signature is a hash of the finding&rsquo;s shape — its kind, its tool, the content
              words of its title — so the key survives punctuation and filler. Triage hangs off
              it, and &ldquo;new&rdquo; and &ldquo;here again&rdquo; are joins rather than guesses.
            </DiagramSays>

            <Stack gap={4}>
              {groups.map((group) => (
                <div key={group.signature} className={clusterGroup}>
                  <div className="min-w-0 flex-1">
                    <Stack as="ul" gap={1}>
                      {group.reports.map((report) => (
                        <Text key={report.person} as="li" size="read-sm" tone="soft">
                          {report.title}
                        </Text>
                      ))}
                    </Stack>
                  </div>

                  <DiagramFlow label="keyed by signature" />

                  <div className="min-w-0 flex-1">
                    <Stack gap={1}>
                      <Mono size="code-sm">{group.signature}</Mono>
                      <Text size="meta" tone="muted">
                        {group.reports.length === 1
                          ? "one report, on a key of its own"
                          : `${group.reports.length} reports, one problem`}
                      </Text>
                    </Stack>
                  </div>
                </div>
              ))}
            </Stack>

            <DiagramSays>
              One different content word is a different key: the last report describes the same
              behaviour in its own words and lands on its own. That is why a problem missing from
              the newest execution is reported as an absence and never as a repair.
            </DiagramSays>
          </DiagramStage>

          <DiagramStage n="04" title="The digest is what you read">
            <DiagramSays>
              One row per problem: how many people hit it, which executions it appeared in, and
              the calls behind it. One circle per person — filled for those who hit it, a ring for
              those who did not.
            </DiagramSays>
            <Inline gap={4} align="center" wrap>
              <Lattice
                dots={INCIDENCE}
                size="lg"
                label={`${cluster.peopleHit} of ${cluster.peopleTotal} people hit this.`}
              />
              <Text size="meta" tone="muted">
                {cluster.peopleHit} of {cluster.peopleTotal} people
              </Text>
            </Inline>
            <FindingCard cluster={cluster} scale={DIAGRAM_CARD_SCALE[size]} />
            <DiagramSays>
              {`Seen in executions ${cluster.seenIn.join(", ")}. Execution 3 did not report it. ${AN_ABSENCE_ONLY}`}
            </DiagramSays>
          </DiagramStage>
        </Stack>
      </DiagramFigure>
    );
  },
);

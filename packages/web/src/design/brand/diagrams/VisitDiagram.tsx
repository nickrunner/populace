import { forwardRef } from "react";
import type { ClusterCardView, ToolCallRecord } from "@populace/contract";

import { cn } from "../../cn.js";
import { Inline, Mono, Separator, Stack, Text } from "../../atoms/index.js";
import { CallRef, ToolName } from "../../molecules/index.js";
import { CohortCapsule, FindingCard, Ledger, LedgerRow } from "../../organisms/index.js";
import { surfaceBase } from "../../variants.js";
import { Ring } from "../Ring.js";
import type { LatticeDot } from "../Lattice.js";
import { DiagramSays } from "./DiagramSays.js";
import { DiagramStage } from "./DiagramStage.js";
import {
  DIAGRAM_CARD_SCALE,
  DiagramFigure,
  EXECUTIONS_ARE_INDEPENDENT,
  type DiagramSize,
} from "./Figure.js";

/**
 * VisitDiagram — what actually happens on one visit (ADR-0007, ADR-0015, DESIGN-SYSTEM §4.3).
 *
 * This is **the** figure for the how-it-works page, because the four things it draws are the
 * product's central mechanism and none of them is obvious from the outside:
 *
 *  1. a **person** comes out of a cohort, which comes out of a population;
 *  2. **two toolsets reach them as one list** — the target's own MCP tools passed through
 *     untouched, plus the five reporting tools Populace adds (ADR-0007);
 *  3. **every result the target returns is numbered** `[c1]`, `[c2]` … as the person reads it,
 *     accumulating through the visit (ADR-0015);
 *  4. the **finding cites the numbers**, and that citation is what a judge can replay.
 *
 * **It is built out of the product's own components, not out of drawings of them** (§9.3). The
 * refs are real `CallRef`s, the tool names are real `ToolName`s wearing the evidence seam's face
 * and ink, the cohorts are real `CohortCapsule`s drawing the mark's stadium, and the finding at
 * the end is a real `FindingCard` with a real `ToolCallRecord[]` behind it — the same props
 * `SimulationResults` hands it. A reader who then opens the dashboard sees the same objects.
 *
 * **The ordinals are the flow, and there is no rule** (§9.2). The four stages were hung off one
 * `Ledger` until its spine was measured at 1,673px down `/how-it-works` — a column rule with no
 * column of locators beside it, which is the line the marketing shell had already had removed for
 * the same reason. They are a `Stack as="ol"` now: each stage prints its own ordinal as a `t-ref`
 * eyebrow above its name, which is how `StepStrip` sequences the landing page, and the brand still
 * draws no arrowheads because it has no diagonal (§1.2 M2, §8.6). The nested call-ref ledger in
 * stage three keeps its stub and keeps `spine={false}` — those refs are a real locator column.
 *
 * **Nothing here promises a repeat** (§7.3). The caption says the opposite in as many words: a
 * different person on a different visit does something different, and that is the design.
 */

/**
 * The reporting toolset, verbatim from ADR-0007 and the runner's own dispatch. Five tools, and
 * the list is the point: a reader who has just been told "two toolsets, one list" needs to see
 * that the added half is small, named, and about reporting rather than about the target.
 */
const REPORTER_TOOLS = ["file_finding", "remember", "fetch_page", "give_up", "done"] as const;

/**
 * An example target's tools, under names anyone recognises. Ordered as a person meets them —
 * find out what this is, get an account, make something, look for it again — because that
 * ordering is itself part of the explanation.
 */
const TARGET_TOOLS = [
  "get_product_info",
  "sign_up",
  "create_item",
  "list_items",
  "search",
  "update_item",
  "add_comment",
] as const;

/** How many of the target's tools are named, by how much room the figure has. */
const TARGET_TOOLS_SHOWN = {
  hero: TARGET_TOOLS.length,
  panel: 5,
} satisfies Record<DiagramSize, number>;

/** Two cohorts, twelve people, one of them the one this figure follows (§1.2 M4, §8.6). */
function cohortDots(slug: string, size: number, theOne: number | null): readonly LatticeDot[] {
  return Array.from(
    { length: size },
    (_, i): LatticeDot => ({
      id: `${slug}#${i + 1}`,
      state: i === theOne ? "theOne" : "present",
      label: i === theOne ? "the person this figure follows" : "a person in this cohort",
    }),
  );
}

const HOUR = 60 * 60 * 1000;
const AT = new Date(Date.now() - 2 * HOUR).toISOString();

/**
 * The visit's calls, as the records the product actually stores. `c4` and `c5` are the pair the
 * finding cites: the same query in two cases, one of which comes back empty. Everything a reader
 * needs to believe the finding is in those two records, which is the whole argument of ADR-0015.
 */
const ENDPOINT = "https://your-app.example/mcp";

const CALLS: readonly ToolCallRecord[] = [
  {
    ref: "c3",
    endpoint: ENDPOINT,
    tool: "create_item",
    arguments: { title: "Quarterly Review" },
    result: { text: '{"id":"itm_3a1","title":"Quarterly Review","done":false}', isError: false },
    latencyMs: 41,
    traceSeq: 18,
    at: AT,
  },
  {
    ref: "c4",
    endpoint: ENDPOINT,
    tool: "search",
    arguments: { query: "quarterly", limit: 20 },
    result: { text: '{"results":[],"total":0,"query":"quarterly"}', isError: false },
    latencyMs: 29,
    traceSeq: 21,
    at: AT,
  },
  {
    ref: "c5",
    endpoint: ENDPOINT,
    tool: "search",
    arguments: { query: "Quarterly", limit: 20 },
    result: {
      text: '{"results":[{"id":"itm_3a1","title":"Quarterly Review"}],"total":1,"query":"Quarterly"}',
      isError: false,
    },
    latencyMs: 27,
    traceSeq: 24,
    at: AT,
  },
];

/** The refs the person passed to `file_finding`. The card's evidence is resolved from these. */
const CITED = ["c4", "c5"] as const;

/**
 * The finding the visit ends on, in the shape `ClusterCardView` has on the wire — so the card in
 * stage four is doing exactly what it does on the results screen, with no figure-only props.
 */
const FINDING: ClusterCardView = {
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
  seenIn: [1, 2, 3],
  firstSeenAt: new Date(Date.now() - 51 * HOUR).toISOString(),
  lastSeenAt: AT,
  triage: null,
};

export interface VisitDiagramProps {
  size?: DiagramSize;
  /**
   * The calls the visit made against the target, in order. Every one of them is numbered; the
   * ones named in `cites` are the ones the finding rests on. Defaults to an example visit.
   */
  calls?: readonly ToolCallRecord[];
  /** The refs the person passed to `file_finding`. Resolved against `calls` for the card. */
  cites?: readonly string[];
  /** The finding filed at the end of the visit. */
  finding?: ClusterCardView;
  id?: string;
  className?: string;
}

export const VisitDiagram = forwardRef<HTMLElement, VisitDiagramProps>(function VisitDiagram(
  { size = "panel", calls = CALLS, cites = CITED, finding = FINDING, id, className },
  ref,
) {
  const tools = TARGET_TOOLS.slice(0, TARGET_TOOLS_SHOWN[size]);
  const evidence = calls.filter((call) => cites.includes(call.ref));

  return (
    <DiagramFigure
      ref={ref}
      id={id}
      size={size}
      className={className}
      sample={calls === CALLS && finding === FINDING}
      name="One visit, end to end"
      lede="A person arrives with an errand of their own, meets your tools and ours as one list, and leaves behind a finding that cites the exact calls it rests on."
      trailing={`${calls.length} calls, ${cites.length} cited`}
      caption={
        <>
          <Text as="p" size="read" tone="ink">
            {EXECUTIONS_ARE_INDEPENDENT}
          </Text>
          <Text as="p" size="read-sm" tone="soft" className="mt-2">
            The mechanism holds: two toolsets as one list, every result from your server numbered,
            a finding that cites numbers. What a person does inside it does not — another person,
            on another visit, meets the same tools and goes somewhere else entirely.
          </Text>
        </>
      }
    >
      {/*
        A `Stack as="ol"`, not a `Ledger`: the stages are numbered but they are not a column
        of locators, so there is nothing for a spine to align and no 72px stub to hang one on
        (§9.2). The ordinal is the stage's own eyebrow. The `<ol>` keeps the sequence in the
        document as well as in the ink.
      */}
      <Stack as="ol" gap={8}>
        <DiagramStage n="01" title="One person, out of the population">
          <DiagramSays>
            A cohort is people cast from one persona; a population is an ordered set of cohorts.
            The lime circle is the one this figure follows.
          </DiagramSays>
          <Inline gap={6} wrap>
            <CohortCapsule
              name="Early adopters"
              dots={cohortDots("early-adopters", 6, 2)}
              total={6}
            />
            <CohortCapsule
              name="Reluctant switchers"
              dots={cohortDots("reluctant-switchers", 6, null)}
              total={6}
            />
          </Inline>
        </DiagramStage>

        <DiagramStage n="02" title="Two toolsets reach them as one list">
          <DiagramSays>
            Your MCP tools are passed through untouched. Five more are added so a person can
            report what they find. The hairline between them is a seam only you can see.
          </DiagramSays>
          <div className={cn(surfaceBase({ level: "well" }), "p-3")}>
            <Stack gap={2}>
              <Text as="div" size="label" tone="muted">
                From your target
              </Text>
              <Inline gap={3} wrap>
                {tools.map((tool) => (
                  <ToolName key={tool} name={tool} />
                ))}
                {tools.length < TARGET_TOOLS.length ? (
                  <Text size="meta" tone="muted">
                    and the rest of your tool list
                  </Text>
                ) : null}
              </Inline>

              <Separator />

              <Text as="div" size="label" tone="muted">
                Added for reporting
              </Text>
              <Inline gap={3} wrap>
                {REPORTER_TOOLS.map((tool) => (
                  <ToolName key={tool} name={tool} />
                ))}
              </Inline>
            </Stack>
          </div>
        </DiagramStage>

        <DiagramStage n="03" title="Every result from your server is numbered">
          <DiagramSays>
            Each result from your server is prefixed with a call ref as the person reads it —{" "}
            <CallRef callRef="c1" /> <CallRef callRef="c2" /> — so the numbers accumulate through
            the visit. Nothing a reporting tool returns is numbered.
          </DiagramSays>
          {/*
            A nested ledger, with no second spine: the refs need M2's right-aligned locator column
            to be scannable, which is the ergonomic bug §1.2 M2 exists to fix, but two vertical
            rules 72px apart would read as a mistake.
          */}
          <Ledger as="ul" spine={false} stubKind="mark">
            {calls.map((call) => (
              <LedgerRow key={call.ref} stub={<CallRef callRef={call.ref} />} density="tight">
                <Stack gap={1}>
                  <ToolName name={call.tool} />
                  <div className="min-w-0 [overflow-wrap:anywhere]">
                    <Mono size="code-sm">{call.result.text}</Mono>
                  </div>
                </Stack>
              </LedgerRow>
            ))}
            <LedgerRow stub={<Ring size="md" weight="ring" label="no call ref" />} density="tight">
              <Stack gap={1}>
                <ToolName name="file_finding" />
                {/* The ring says "absent" in the mark's grammar, and the word says it too —
                    rule 4 forbids a glyph carrying a state on its own. */}
                <Text size="meta" tone="muted">
                  ours, not yours — so it gets no ref
                </Text>
              </Stack>
            </LedgerRow>
          </Ledger>
        </DiagramStage>

        <DiagramStage n="04" title="The finding cites the numbers">
          <DiagramSays>
            <Mono size="code">file_finding</Mono> takes the refs. Each resolves into the whole
            call — sent, returned, how long it took — stored as the finding&rsquo;s reproduction
            steps. That citation is what makes a replay possible.
          </DiagramSays>
          <FindingCard cluster={finding} evidence={evidence} scale={DIAGRAM_CARD_SCALE[size]} />
        </DiagramStage>
      </Stack>
    </DiagramFigure>
  );
});

import { forwardRef, type ReactNode } from "react";
import type { ClusterCardView, ToolCallRecord } from "@populace/contract";

import { people } from "../../../format.js";
import { Badge, Inline, Measure, Text } from "../../atoms/index.js";
import { FindingCard } from "../../organisms/index.js";
import { Lattice, type LatticeDot } from "../Lattice.js";
import { Ring } from "../Ring.js";
import { DiagramKey } from "./DiagramKey.js";
import {
  AN_ABSENCE_ONLY,
  DIAGRAM_CARD_SCALE,
  DiagramFigure,
  NOT_A_REPAIR,
  type DiagramSize,
} from "./Figure.js";

/**
 * AbsenceDiagram — **the honesty graphic** (DESIGN-SYSTEM §7.3, §9.6; ADR-0028 amendment;
 * ADR-0030).
 *
 * A problem reported in one execution and not reported in the next is an **absence**. It is not
 * a fix, not a repair, not a verification and not a regression test passing. This figure exists
 * to draw that distinction so plainly that no reader can come away believing Populace checks
 * whether anything was mended — because the pressure to imply otherwise is constant, the implied
 * claim is the one a buyer most wants to hear, and it would be false.
 *
 * **Two bands, and the first one is the whole argument.**
 *
 * 1. *The pair.* The left is what execution 1 filed: a **real `FindingCard`**, with a real
 *    severity stack, a real tool name and real call refs the verifier replays (ADR-0015). The
 *    right is execution 2, and it is deliberately **not** a card: a row of rings where the left
 *    has a roster, and one sentence. **The asymmetry is the information** — a record was produced
 *    on one side and no record was produced on the other, and drawing a second card would invent
 *    one. That reading survives with no prose at all, which is why this figure leads with it.
 * 2. *The two readings*, in words, side by side: what the absence says, and what it does not. The
 *    word **fixed** appears in this product in exactly one place — the triage field, where a
 *    human asserts it about their own software — and the right-hand column says that outright.
 *
 * **What used to be a third band.** It drew ADR-0028's recurrence measurements as three meters
 * and explained signature matching in three paragraphs. `PipelineDiagram` draws that mechanism —
 * three reports on one key, a fourth on its own — and drawing it twice bought a page of prose and
 * no new reading. The clause it existed to support (`AN_ABSENCE_ONLY`: *it may be gone, or it may
 * have been described in different words this time*) is still here, in the band the reader
 * actually looks at.
 *
 * **Colour carries nothing here.** The two states are a filled roster against a ring roster, and
 * every one of them is labelled in words. The figure is readable in greyscale, in print and at
 * phone width, where the pair stacks into one column separated by a hairline and the card keeps
 * its own internal layout.
 */

/**
 * The problem the left half files. An example, in the exact shape the wire carries, so the card
 * is the product's own component doing its own job rather than a drawing of one.
 *
 * **`firstSeenAt` and `lastSeenAt` are null on purpose.** `FindingCard` renders them as *"first
 * reported three days ago"*, which is correct for a live record and wrong for a figure: a fixed
 * timestamp in a diagram drifts into "eleven months ago" and quietly dates the page. A caller
 * passing a real `ClusterCardView` gets the real relative times, which is right for them.
 *
 * **`state` is `open`, not `fixed`.** The wire's `fixed` is its word for *the newest execution
 * did not report it*, and `FindingCard` renders it with §7.3's own sentence. Here the card is
 * execution 1's record of its own execution, and it may not carry a claim about the next one.
 */
const SAMPLE_FINDING: ClusterCardView = {
  signature: "sig1:4f2a91c7be03",
  title: "Searching in lower case finds nothing",
  severity: "high",
  kind: "bug",
  tool: "search",
  verdict: "confirmed",
  peopleHit: 9,
  peopleTotal: 12,
  reports: 11,
  cohorts: [
    { slug: "early-adopters", name: "Early adopters", hit: 5, total: 6 },
    { slug: "reluctant-switchers", name: "Reluctant switchers", hit: 4, total: 6 },
  ],
  state: "open",
  seenIn: [1],
  firstSeenAt: null,
  lastSeenAt: null,
  triage: null,
};

/**
 * The two calls the finding rests on, as the records the runner stored and the verifier replays.
 * `[c3]` created something with a capital letter in its title; `[c4]` searched for it in lower
 * case and got nothing back. That pair *is* the reproduction — which is the reason evidence is
 * cited by call ref and not described in prose (ADR-0015, §4.3).
 */
const SAMPLE_EVIDENCE: readonly ToolCallRecord[] = [
  {
    ref: "c3",
    endpoint: "https://your-app.example/mcp",
    tool: "create_item",
    arguments: { title: "Quarterly Review" },
    result: { text: '{"id":"itm_41","title":"Quarterly Review"}', isError: false },
    latencyMs: 24,
    traceSeq: 14,
    at: "2026-09-18T10:14:02.000Z",
  },
  {
    ref: "c4",
    endpoint: "https://your-app.example/mcp",
    tool: "search",
    arguments: { query: "quarterly" },
    result: { text: '{"results":[],"total":0}', isError: false },
    latencyMs: 19,
    traceSeq: 17,
    at: "2026-09-18T10:14:05.000Z",
  },
];

/** One reading of the absence, as a word in a badge over a sentence. Words, never a hue (§4.2). */
function Reading({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="grid content-start gap-1.5">
      <div>
        <Badge variant="kind">{label}</Badge>
      </div>
      <Measure width="read" as="div">
        {children}
      </Measure>
    </div>
  );
}

export interface AbsenceDiagramProps {
  /** The problem the earlier execution reported. Defaults to an example finding. */
  cluster?: ClusterCardView;
  /** Its reproduction steps — the records the verifier replays. */
  evidence?: readonly ToolCallRecord[];
  /** The two execution numbers, earlier first. Default `[1, 2]`. */
  executions?: readonly [number, number];
  size?: DiagramSize;
  id?: string;
  className?: string;
}

export const AbsenceDiagram = forwardRef<HTMLElement, AbsenceDiagramProps>(function AbsenceDiagram(
  {
    cluster = SAMPLE_FINDING,
    evidence = SAMPLE_EVIDENCE,
    executions = [1, 2],
    size = "panel",
    id,
    className,
  },
  ref,
) {
  const [first, second] = executions;
  const total = cluster.peopleTotal;

  /** The later execution's roster: every dot a ring, because nobody reported it. */
  const nobody: LatticeDot[] = Array.from({ length: total }, (_, index) => ({
    id: `absent-${index}`,
    state: "absent",
    label: "a person who did not report it",
  }));

  return (
    <DiagramFigure
      ref={ref}
      id={id}
      size={size}
      className={className}
      sample={cluster === SAMPLE_FINDING}
      name="A problem that stops being reported"
      lede={`Filed in execution ${first} with the calls that reproduce it. Not filed in execution ${second}. That second fact is an absence, and Populace reports it as one.`}
      trailing={`${people(total)}, two executions`}
      caption={
        <>
          <Text as="p" size="read" tone="ink">
            {`A problem that stops appearing is reported as ${NOT_A_REPAIR}. Whether your product is fixed is your call, and there is a field to record it in.`}
          </Text>
          <Text as="p" size="read-sm" tone="soft" className="mt-2">
            Nothing here replays the earlier finding against the newer build. The evidence on the
            left is kept exactly as it was collected so that you can.
          </Text>
        </>
      }
    >
      <div className="grid gap-6">
        {/* ---- Band 1: the pair. A record on one side, and no record on the other. ---- */}
        <div className="grid gap-6 md:grid-cols-2">
          <div className="grid content-start gap-2">
            <Inline gap={2} align="center" wrap>
              <Text size="meta" tone="muted">
                {`execution ${first}`}
              </Text>
              <Badge variant="status">reported</Badge>
            </Inline>
            <FindingCard cluster={cluster} evidence={evidence} scale={DIAGRAM_CARD_SCALE[size]} />
          </div>

          <div className="grid content-start gap-2 border-t border-rule pt-6 md:border-t-0 md:border-l md:pt-0 md:pl-6">
            <Inline gap={2} align="center" wrap>
              <Text size="meta" tone="muted">
                {`execution ${second}`}
              </Text>
              <Badge variant="status">not reported</Badge>
            </Inline>

            {/*
              No card. A card is a discrete record you can open (§1.2 M6) and execution 2
              produced no record — drawing an empty one would invent the thing the whole figure
              is about. What is drawn instead is the roster in the mark's own grammar: every
              person a ring, because not one of them reported it this time.
            */}
            <div className="grid gap-3 pt-1">
              <Lattice
                dots={nobody}
                rows={1}
                size="sm"
                label={`Nobody reported it in execution ${second}.`}
              />
              <Measure width="read" as="div">
                <Text as="p" size="read" tone="ink">
                  {AN_ABSENCE_ONLY}
                </Text>
                <Text as="p" size="read-sm" tone="soft" className="mt-2">
                  No finding was filed, so there is nothing to open and nothing to replay. The
                  same cast went in, and went somewhere else.
                </Text>
              </Measure>
              <DiagramKey
                items={[
                  {
                    id: "absent",
                    glyph: <Ring size="sm" />,
                    label: "a person who did not report it",
                  },
                ]}
              />
            </div>
          </div>
        </div>

        {/* ---- Band 2: the two readings, in words. ---- */}
        <div className="grid gap-5 border-t border-rule pt-5 md:grid-cols-2 md:gap-8">
          <Reading label="what it says">
            <Text as="p" size="read" tone="ink">
              {`Execution ${second} did not report this problem.`}
            </Text>
            <Text as="p" size="read-sm" tone="soft" className="mt-2">
              That is the entire claim: this execution, this cast, this build.
            </Text>
          </Reading>

          <Reading label="what it does not say">
            <Text as="p" size="read" tone="ink">
              That it was fixed, repaired or verified.
            </Text>
            <Text as="p" size="read-sm" tone="soft" className="mt-2">
              The word <em>fixed</em> appears in one place in Populace: the triage field, where
              you record your own judgement. Nothing the population does writes it for you.
            </Text>
          </Reading>
        </div>
      </div>
    </DiagramFigure>
  );
});

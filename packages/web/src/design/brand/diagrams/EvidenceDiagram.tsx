import { forwardRef } from "react";
import type { ReactNode } from "react";
import type { ToolCallRecord, Verification } from "@populace/contract";

import { Inline, Mono, Stack, Text } from "../../atoms/index.js";
import { CallRef, VerdictTag } from "../../molecules/index.js";
import { EvidenceSteps, PayloadBlock, ReplayVerdict } from "../../organisms/index.js";
import type { VerdictValue } from "../../tokens.js";
import { Dot } from "../Dot.js";
import { Ring } from "../Ring.js";
import { DiagramFlow } from "./DiagramFlow.js";
import { DiagramKey, type DiagramKeyItem } from "./DiagramKey.js";
import { DiagramSays } from "./DiagramSays.js";
import { DiagramStage } from "./DiagramStage.js";
import { DiagramFigure, type DiagramSize } from "./Figure.js";

/**
 * EvidenceDiagram — the seam between *a person said this happened* and *a judge ran it again and
 * this is what happened then* (DESIGN-SYSTEM §4.3, ADR-0015, ADR-0007).
 *
 * The product's strongest claim is not that somebody reported a problem. It is that the calls
 * they cited were stored whole and run again. This figure is the three moves that make that
 * claim checkable rather than assertable:
 *
 *  1. a person files through `file_finding` and **cites refs**, never prose (ADR-0007);
 *  2. each ref is **resolved into the whole call** — tool, arguments, result, error flag, latency,
 *     trace position — and stored as the finding's reproduction steps (ADR-0015);
 *  3. a judge **replays those exact calls** and records what came back.
 *
 * **Machine speech wears the evidence ink throughout** (§4.3, §4.7). The filed call is a
 * `PayloadBlock` — `sunk` ground, 2px `evidence` left edge, square, mono in `evidence` — the
 * stored steps are real `EvidenceSteps`, and the replay is a real `ReplayVerdict`. The only
 * things set in the serif are the sentences *we* are saying about them. Family alone tells a
 * reader which is which, with no colour read at all, which is the seam surviving greyscale.
 *
 * **The flow is vertical at every width**, because each stage is a full-measure artefact and a
 * horizontal connector between two stacked blocks points at nothing. `DiagramFlow` carries the
 * verb of the transformation in its label, so the figure reads without its prose.
 *
 * **A verdict is a word, never a hue** (§4.2). The key at the foot draws the mark's own grammar
 * beside `VerdictTag`'s four words — a filled dot for a replay that reproduced, a ring for one
 * that did not, the dashed 2/7 stroke for one that has not been run — and the word is what
 * carries it. *Not reproduced* is recorded as exactly that and never as a repair (§7.3).
 */

const HOUR = 60 * 60 * 1000;
const FILED_AT = new Date(Date.now() - 2 * HOUR).toISOString();
const JUDGED_AT = new Date(Date.now() - 90 * 60 * 1000).toISOString();

/**
 * The `file_finding` call as it was made. Printed verbatim through `PayloadBlock`, which
 * pretty-prints JSON at two spaces and never truncates — the hard cut §4.3 complains about is
 * exactly the thing that would make this figure dishonest.
 */
const FILED_CALL = JSON.stringify({
  kind: "bug",
  title: "Search says it is case-insensitive and is not",
  expected: 'Searching "quarterly" finds the item called "Quarterly Review".',
  observed: "Nothing comes back. The same search capitalised finds it immediately.",
  severity: "high",
  confidence: 0.9,
  evidence_calls: ["c4", "c5"],
});

/** An example target. A reader should see the shape of their own server here, not somebody's. */
const ENDPOINT = "https://your-app.example/mcp";

/** The two calls the refs resolve to, as the records the store actually holds. */
const SEARCH_LOWER: ToolCallRecord = {
  ref: "c4",
  endpoint: ENDPOINT,
  tool: "search",
  arguments: { query: "quarterly", limit: 20 },
  result: { text: '{"results":[],"total":0,"query":"quarterly"}', isError: false },
  latencyMs: 29,
  traceSeq: 21,
  at: FILED_AT,
};

const SEARCH_UPPER: ToolCallRecord = {
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
  at: FILED_AT,
};

const STEPS: readonly ToolCallRecord[] = [SEARCH_LOWER, SEARCH_UPPER];

/**
 * The judge's own run. Aligned by index with the steps above, which is what lets a reader read
 * the second list against the first line for line — the fresh latencies differ and the results
 * do not, and both of those facts are the reading.
 */
const VERIFICATION: Verification = {
  verdict: "confirmed",
  reason:
    "I sent both searches to the target again. The lower-case query returned an empty result set and the capitalised query returned the item, so the behaviour described in the report happened when I ran it.",
  judge: "model",
  replay: [
    { ...SEARCH_LOWER, latencyMs: 24, at: JUDGED_AT },
    { ...SEARCH_UPPER, latencyMs: 31, at: JUDGED_AT },
  ],
  verifiedAt: JUDGED_AT,
  costUsd: 0.0031,
};

/**
 * How many stored steps the figure draws. `panel` shows the pair the finding cites and says in
 * words how many more are stored, because a figure that silently drops evidence is the exact
 * failure §4.3 complains about in the 600-character cut.
 */
const STEPS_SHOWN = {
  hero: Number.POSITIVE_INFINITY,
  panel: 2,
} satisfies Record<DiagramSize, number>;

/**
 * What a replay can conclude, in the mark's grammar and in `VerdictTag`'s words.
 *
 * The glyph is never the carrier — the word beside it is (§1.3 rule 4, §4.2) — but the grammar is
 * the right one to say it in: a filled circle is a thing that was there, a ring is a thing that
 * was not, and the dashed 2/7 stroke is the mark's own "this has not happened yet" (§8.6).
 */
const VERDICT_KEY: readonly DiagramKeyItem[] = (
  [
    { value: "confirmed", glyph: <Dot tone="confirmed" /> },
    { value: "not-reproduced", glyph: <Ring weight="ring" /> },
    { value: "inconclusive", glyph: <Dot tone="medium" /> },
    { value: "unchecked", glyph: <Dot state="provisional" /> },
  ] satisfies readonly { value: VerdictValue; glyph: ReactNode }[]
).map((row) => ({ id: row.value, glyph: row.glyph, label: <VerdictTag value={row.value} /> }));

export interface EvidenceDiagramProps {
  size?: DiagramSize;
  /** The `file_finding` call as it was made, verbatim. Pretty-printed by the well, not here. */
  filedCall?: string;
  /** The records the cited refs resolve to — the finding's reproduction steps. */
  steps?: readonly ToolCallRecord[];
  /** The stored verification: the verdict, the judge's reason, and the calls it ran. */
  verification?: Verification;
  id?: string;
  className?: string;
}

export const EvidenceDiagram = forwardRef<HTMLElement, EvidenceDiagramProps>(
  function EvidenceDiagram(
    {
      size = "panel",
      filedCall = FILED_CALL,
      steps = STEPS,
      verification = VERIFICATION,
      id,
      className,
    },
    ref,
  ) {
    const shown = steps.slice(0, STEPS_SHOWN[size]);
    const elided = steps.length - shown.length;

    return (
      <DiagramFigure
        ref={ref}
        id={id}
        size={size}
        className={className}
        sample={steps === STEPS && verification === VERIFICATION}
        name="How a call ref becomes a replay"
        lede="A person cites the calls a finding rests on. Each ref is resolved into the whole call and stored, and a judge sends those exact calls to your target again."
        trailing={`${steps.length} steps, ${verification.replay.length} replayed`}
        caption={
          <>
            <Text as="p" size="read" tone="ink">
              Findings carry their evidence by call ref, which is the whole reason a replay is
              possible at all.
            </Text>
            <Text as="p" size="read-sm" tone="soft" className="mt-2">
              A verdict reads one replay and nothing more. It does not say what the next execution
              will find.
            </Text>
          </>
        }
      >
        <Stack gap={4}>
          <DiagramStage title="A person says this happened">
            <DiagramSays>
              A finding exists only through <Mono size="code">file_finding</Mono>. Nothing is
              parsed out of prose — write a beautiful bug report without calling the tool and
              there is no finding.
            </DiagramSays>
            <Inline gap={2} wrap>
              <Text size="label" tone="muted">
                The refs it cites
              </Text>
              {steps.map((step) => (
                <CallRef key={step.ref} callRef={step.ref} />
              ))}
            </Inline>
            <PayloadBlock caption="What they filed" value={filedCall} copyable={false} />
          </DiagramStage>

          <DiagramFlow orientation="vertical" label="resolved into" />

          <DiagramStage title="Each ref becomes the whole call">
            <DiagramSays>
              A ref is an address. Each resolves into the full record — what was sent, what came
              back, whether it errored, how long it took — stored as the finding&rsquo;s
              reproduction steps. Cite nothing and the last five calls are attached anyway, so no
              finding is evidence-free.
            </DiagramSays>
            <EvidenceSteps steps={shown} title="Reproduction steps" />
            {elided > 0 ? (
              <Text size="meta" tone="muted">
                {elided === 1 ? "One more step is stored." : `${elided} more steps are stored.`}
              </Text>
            ) : null}
          </DiagramStage>

          <DiagramFlow orientation="vertical" label="replayed by a judge" />

          <DiagramStage title="A judge replays those exact calls">
            <DiagramSays>
              The stored calls go to your target again and what comes back is read against what
              was reported. One side is a person saying something happened; the other is a second
              run with its own receipts. Both are kept.
            </DiagramSays>
            <ReplayVerdict verification={verification} />
          </DiagramStage>

          <DiagramStage title="What a replay can conclude">
            <DiagramKey items={VERDICT_KEY} />
            <DiagramSays>
              A replay that does not reproduce is recorded as exactly that, never as a repair.
            </DiagramSays>
          </DiagramStage>
        </Stack>
      </DiagramFigure>
    );
  },
);

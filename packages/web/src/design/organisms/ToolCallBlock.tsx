import { forwardRef } from "react";
import type { ClusterCardView, ToolCallRecord } from "@populace/contract";

import { Inline, Mono, Separator, Stack, Text } from "../atoms/index.js";
import {
  CallRef,
  Duration,
  MetaLine,
  RelativeTime,
  SeverityTag,
  ToolName,
  VerdictTag,
  type MetaFact,
} from "../molecules/index.js";
import { PayloadBlock } from "./PayloadBlock.js";

/**
 * ToolCallBlock — one call to the target, with what went out and what came back
 * (DESIGN-SYSTEM §4.3).
 *
 * This is the atom of evidence in the product, and the reason the whole seam exists: the runner
 * prefixes every target tool result the model sees with `[c1]`, `[c2]`…, a finding cites those
 * refs, and the refs resolve back into exactly these records. So the block leads with its
 * **locator** — the `CallRef` — and then its **name** — the `ToolName` — because those are the
 * two things a reader uses to find their way between a transcript, a finding and a replay.
 *
 * Everything below the header is machine output and is therefore a `PayloadBlock`: *what they
 * sent* is the arguments, *what came back* is the result text exactly as the model received it,
 * carrying the `error` word when the target said so. Nothing is truncated and nothing is
 * paraphrased — §7.4 is explicit that the machine's own words are quoted in a mono well rather
 * than summarised into prose.
 *
 * **The facts are separated by a hairline, not a middle dot** (§4.5). The endpoint, the latency
 * and the instant are compared across calls, so they are a `MetaLine` rather than a sentence, and
 * the endpoint is mono because the target is what names it.
 *
 * **`cited` is the reverse link, stated rather than drawn twice.** A call that a problem rests on
 * is a more important call, and the block says so with the problems' own words, severities and
 * verdicts. It deliberately does **not** re-implement `CitedAsEvidence`: that organism knows
 * which step of which finding *this* ref is and makes every sibling ref selectable, and it takes
 * the refs to do it. A `ClusterCardView` carries no refs, so what can honestly be said here is
 * *which problems cite this call*, and that is what is said.
 */

export interface ToolCallBlockProps {
  /** The record itself: ref, tool, endpoint, arguments, result, latency, instant. */
  call: ToolCallRecord;
  /** Problems whose reproduction steps include this call. */
  cited?: readonly ClusterCardView[];
  /** Makes the header's `CallRef` selectable — a transcript scrolling to this step. */
  onSelectRef?: (ref: string) => void;
}

export const ToolCallBlock = forwardRef<HTMLDivElement, ToolCallBlockProps>(function ToolCallBlock(
  { call, cited, onSelectRef },
  ref,
) {
  const facts: readonly MetaFact[] = [
    // The endpoint is the target speaking its own name, so it keeps the seam's face.
    { key: "endpoint", node: <Mono size="code-sm">{call.endpoint}</Mono> },
    { key: "latency", node: <Duration ms={call.latencyMs} /> },
    { key: "at", node: <RelativeTime at={call.at} /> },
  ];

  return (
    <Stack ref={ref} gap={3}>
      <Inline gap={2} align="baseline" wrap>
        {/*
          `current` is deliberately not asserted here. It means "the ref you are looking at",
          which is a selection the SCREEN owns — a transcript has exactly one shown step, and a
          reproduction list of four steps does not. Marking every block's own ref would put
          `aria-pressed="true"` on all four. The locator still reads as the locator; the header's
          tool name is what carries this block's emphasis.
        */}
        <CallRef
          callRef={call.ref}
          onSelect={
            onSelectRef === undefined
              ? undefined
              : () => {
                  onSelectRef(call.ref);
                }
          }
        />
        <ToolName name={call.tool} />
      </Inline>

      <MetaLine facts={facts} />

      <PayloadBlock caption="What they sent" value={JSON.stringify(call.arguments)} />
      <PayloadBlock
        caption="What came back"
        value={call.result.text}
        error={call.result.isError}
      />

      {cited !== undefined && cited.length > 0 ? (
        <Stack gap={2}>
          <Separator />
          <Text size="label" tone="muted">
            Cited as evidence by
          </Text>
          <Stack as="ul" gap={3}>
            {cited.map((cluster) => (
              <li key={cluster.signature}>
                <Inline gap={2} align="baseline" wrap>
                  <SeverityTag level={cluster.severity} kind={cluster.kind} />
                  {cluster.verdict === null ? null : <VerdictTag value={cluster.verdict} />}
                </Inline>
                <Text as="p" size="finding">
                  {cluster.title}
                </Text>
                <MetaLine
                  facts={[
                    {
                      key: "people",
                      node: `${cluster.peopleHit} of ${cluster.peopleTotal} people`,
                    },
                    {
                      key: "reports",
                      node: `${cluster.reports} ${cluster.reports === 1 ? "report" : "reports"}`,
                    },
                  ]}
                />
              </li>
            ))}
          </Stack>
        </Stack>
      ) : null}
    </Stack>
  );
});

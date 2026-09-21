import { forwardRef, type ReactElement, type ReactNode } from "react";
import type { JsonValue, TraceEvent } from "@populace/contract";

import { Badge, Heading, Mono, Stack, Text } from "../atoms/index.js";
import {
  CallRef,
  Duration,
  MetaLine,
  Money,
  RelativeTime,
  SeverityStack,
  ToolName,
} from "../molecules/index.js";
import type { MetaFact } from "../molecules/index.js";
import { PayloadBlock } from "./PayloadBlock.js";
import type { TranscriptKind, TranscriptStep } from "./TranscriptRow.js";

/**
 * TranscriptDetail — the pane beside the transcript (ATOMIC-INVENTORY §3, organism 27).
 *
 * Three layouts and no more: **a call to the target app**, **a turn of thought**, and the generic
 * one. The generic layout is the one that matters most, because it is where today's screen prints
 * `event.type` raw and puts an internal event name on the page in front of a reader (§7.2). Here the step's
 * kind is looked up as a human noun and the raw type never reaches the DOM.
 *
 * **The evidence seam is drawn by position, face and ink at once** (§4.3). What the person sent
 * and what came back are recessed `sunk` wells with the system's one 2px `evidence` left edge,
 * set square in `t-code-sm`, pretty-printed at two spaces — the organism does the printing, not
 * the caller — with a `t-label` caption above and a copy affordance that is always present to a
 * screen reader. An error result additionally carries the word `error` in a `Badge`, because a
 * colour change alone is not a state (§1.3 rule 4).
 *
 * **What is said is serif; what the machine emitted is mono** (§3.1). A model turn's own words are
 * `t-read` prose at the reading measure; the tool name, the endpoint, the call ref and both
 * payloads are Plex Mono in `evidence`. That is the whole typographic argument of the product
 * visible in one pane.
 *
 * **On the type of `detail`.** It is `TraceEvent`, imported from `@populace/contract`. The
 * inventory used to call it `TraceDetailView` and this file used to ship that name as an alias,
 * which was a second name for one shape and exactly the thing §0.2 forbids. A trace event has no
 * second vocabulary — it is a trace event on both sides of the wire — so the contract re-exports
 * the record and the component names it. ATOMIC-INVENTORY §3 organism 27 has been amended.
 */

export interface TranscriptDetailProps {
  step: TranscriptStep;
  detail: TraceEvent;
}

/**
 * Kind → a human noun. This is the lookup §0.2 asks for, and the reason no component in this
 * layer prints a raw event type. It is words, not classes, so it is a map rather than a variant.
 */
const NOUNS: Record<TranscriptKind, string> = {
  "visit.start": "The visit begins",
  memory: "A note to themselves",
  "model.turn": "A turn of thought",
  "tool.call": "A call to the app",
  "reporter.call": "Something reported",
  guardrail: "A guardrail stopped them",
  identity: "Their account on the app",
  finding: "Something filed",
  note: "A note on the record",
  "visit.end": "The visit ends",
};

/**
 * A model turn's content arrives as JSON blocks. Only the text ones are words; everything else in
 * there is the machine's own bookkeeping and belongs in neither the prose nor the well.
 */
function spokenText(content: JsonValue): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null || Array.isArray(block)) continue;
    const type = block["type"];
    const text = block["text"];
    if (type === "text" && typeof text === "string") parts.push(text);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** The pane's own heading band: what this step is, and the locators that name it. */
function Title({
  children,
  step,
  facts,
}: {
  children: ReactNode;
  step: TranscriptStep;
  facts: readonly MetaFact[];
}): ReactElement {
  return (
    <div>
      <div className="flex items-baseline gap-2.5">
        {step.callRef === undefined ? null : <CallRef callRef={step.callRef} current />}
        {step.severity === undefined ? null : <SeverityStack level={step.severity} size="md" />}
        {children}
        {step.severity === undefined ? null : (
          <Badge variant="severity" tone={step.severity}>
            {step.severity}
          </Badge>
        )}
        {step.suspect === true ? <Badge variant="bad">suspect</Badge> : null}
      </div>
      <div className="mt-1.5">
        <MetaLine facts={facts} />
      </div>
    </div>
  );
}

export const TranscriptDetail = forwardRef<HTMLElement, TranscriptDetailProps>(
  function TranscriptDetail({ step, detail }, ref) {
    if (detail.type === "tool.call") {
      return (
        <Stack ref={ref} gap={4}>
          <Title
            step={step}
            facts={[
              { key: "endpoint", node: <Mono size="code-sm">{detail.endpoint}</Mono> },
              { key: "latency", node: <Duration ms={detail.latencyMs} /> },
              { key: "at", node: <RelativeTime at={detail.at} mode="absolute" /> },
            ]}
          >
            <ToolName name={detail.tool} />
          </Title>
          {/* Pretty-printing, the 24-line fold, the copy affordance and the `error` word all
              belong to `PayloadBlock` (organism 15) — the one spelling of the evidence well. */}
          <PayloadBlock caption="What they sent" value={JSON.stringify(detail.arguments)} />
          <PayloadBlock
            caption="What came back"
            value={detail.result.text}
            error={detail.result.isError}
          />
        </Stack>
      );
    }

    if (detail.type === "model.call") {
      const said = spokenText(detail.response.content);
      return (
        <Stack ref={ref} gap={4}>
          <Title
            step={step}
            facts={[
              { key: "model", node: <Mono size="code-sm">{detail.model}</Mono> },
              { key: "effort", node: <Text size="meta" tone="muted">{detail.effort}</Text> },
              { key: "latency", node: <Duration ms={detail.latencyMs} /> },
              { key: "cost", node: <Money usd={detail.costUsd} precision={4} /> },
              {
                key: "tokens",
                node: (
                  <Text size="meta" tone="muted">
                    {detail.usage.inputTokens.toLocaleString()} in /{" "}
                    {detail.usage.outputTokens.toLocaleString()} out
                  </Text>
                ),
              },
            ]}
          >
            <Heading level={3} size="name">
              Turn {detail.turn}
            </Heading>
          </Title>

          <div>
            <Text size="label" tone="muted" as="div" className="mb-1.5">
              What they were thinking
            </Text>
            <Text size="read" tone="soft" as="p">
              {said === ""
                ? "They went straight to a tool call without saying anything."
                : said}
            </Text>
          </div>

          <PayloadBlock
            caption="What they had just been told"
            value={detail.request.lastUserContent}
          />
        </Stack>
      );
    }

    return (
      <Stack ref={ref} gap={4}>
        <Title
          step={step}
          facts={[
            { key: "kind", node: <Text size="meta" tone="muted">{NOUNS[step.kind]}</Text> },
            { key: "at", node: <RelativeTime at={detail.at} mode="absolute" /> },
          ]}
        >
          <Heading level={3} size="name">
            {step.title}
          </Heading>
        </Title>

        <Text size="read" tone="soft" as="p" className="whitespace-pre-wrap">
          {step.sub === undefined || step.sub === ""
            ? "Nothing more was recorded for this step."
            : step.sub}
        </Text>

        {step.meta === undefined || step.meta === "" ? null : (
          <Text size="meta" tone="muted" as="div">
            {step.meta}
          </Text>
        )}
      </Stack>
    );
  },
);

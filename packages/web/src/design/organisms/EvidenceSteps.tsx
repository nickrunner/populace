import { forwardRef } from "react";
import type { ToolCallRecord } from "@populace/contract";

import { Heading, Measure, Stack, Text } from "../atoms/index.js";
import { ToolCallBlock } from "./ToolCallBlock.js";

/**
 * EvidenceSteps — the calls that produced a finding, in the order they were made
 * (DESIGN-SYSTEM §4.3, ADR-0015).
 *
 * The runner never parses prose: a person files a finding by naming the calls it rests on
 * (`evidence_calls: ["c3","c4"]`), and the runner resolves those refs into whole tool-call
 * records. **This list is that resolution, drawn.** It is also what makes a replay possible at
 * all, which is why it is an `<ol>` rather than a stack of cards — the order is part of the
 * evidence, and a screen reader is told "3 of 4" by the list itself rather than by a printed
 * ordinal that would then have to be kept in step with the array.
 *
 * Each step is a `ToolCallBlock`, so a step here and a step in a replay and a step in the
 * transcript are the same object drawn the same way. That is the whole point of the seam: the
 * reader learns one shape and then recognises it in three places.
 *
 * **The empty state is a sentence, not an apology** (§7.4). A finding filed with no cited calls
 * is a real and legible thing — somebody described a problem they could not pin to a call — and
 * the copy says exactly that, upright and in `ink-soft`, because the *product* is speaking and
 * italic belongs to people (§4.7).
 */

/** The heading this list carries when the screen does not name it. */
const DEFAULT_TITLE = "Steps that reproduce it";

export interface EvidenceStepsProps {
  /** The resolved tool-call records, in the order they were made. */
  steps: readonly ToolCallRecord[];
  /** Overrides the heading — a replay passes its own. */
  title?: string;
  /** Makes each step's `CallRef` selectable, for a screen showing a transcript beside this. */
  onSelectRef?: (ref: string) => void;
}

export const EvidenceSteps = forwardRef<HTMLElement, EvidenceStepsProps>(function EvidenceSteps(
  { steps, title = DEFAULT_TITLE, onSelectRef },
  ref,
) {
  return (
    <Stack ref={ref} gap={4}>
      {/* `Section` owns <h2>; a block inside one is <h3>, which is what keeps the two lists in a
          replay readable against each other as siblings rather than as a nest. */}
      <Heading level={3} size="name">
        {title}
      </Heading>

      {steps.length === 0 ? (
        <Measure width="read">
          <Text as="p" size="read" tone="soft">
            Nobody cited a call when they filed this, so there is nothing to replay.
          </Text>
        </Measure>
      ) : (
        <Stack as="ol" gap={6}>
          {steps.map((step) => (
            // What the record IS, not where it sits in the array. The ref alone is unique within
            // a visit; the trace sequence is carried too so that a replay — whose fresh records
            // are aligned by index with the originals and may reuse a ref — cannot collide.
            <li key={`${step.ref}:${step.traceSeq}`}>
              <ToolCallBlock call={step} onSelectRef={onSelectRef} />
            </li>
          ))}
        </Stack>
      )}
    </Stack>
  );
});

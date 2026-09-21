import { forwardRef, type ReactNode } from "react";

import { Measure, Stack, Text } from "../atoms/index.js";
import { PayloadBlock } from "./PayloadBlock.js";

/**
 * SamplePreview — what a spec can produce, shown rather than described.
 *
 * ATOMIC-INVENTORY §5 page 11 names it on `PersonaEditor`, where a trait can be a distribution
 * rather than a value and the reader is deciding whether that distribution is the one they meant.
 * A sentence about a distribution is a claim; five draws from it are evidence, and the difference
 * is the same one §4.3 draws between the product talking and the machine talking.
 *
 * **The draws are machine output and are set as such**: the evidence well, IBM Plex Mono, the
 * evidence ink. They are also what the prompt will literally contain, which is the other reason
 * they belong in the well rather than in prose.
 *
 * **The note says what the samples are and are not.** These are examples of what the spec *can*
 * produce, drawn here, in the browser, now. The real draws are made per person from the cohort's
 * seed — so the note never says a sample is what anybody will get, which would be a promise about
 * an execution (§7.3).
 */

export interface SamplePreviewProps {
  /** The `t-label` caption — "Five draws from this". */
  label: string;
  /** One line per draw, already in the form the prompt will carry. */
  samples: readonly string[];
  /** What the samples are, and what they are not. */
  note?: ReactNode;
}

export const SamplePreview = forwardRef<HTMLElement, SamplePreviewProps>(function SamplePreview(
  { label, samples, note },
  ref,
) {
  return (
    <Stack ref={ref} gap={2}>
      {/*
        Not copyable: these are drawn afresh on every render, so what the clipboard held would not
        be what the page shows by the time it was pasted.
      */}
      <PayloadBlock caption={label} value={samples.join("\n")} copyable={false} />
      {note === undefined ? null : (
        <Measure width="read">
          <Text as="p" size="meta" tone="muted">
            {note}
          </Text>
        </Measure>
      )}
    </Stack>
  );
});

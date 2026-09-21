import { forwardRef } from "react";

import type { SeverityLevel } from "../tokens.js";
import { Heading, Inline, Stack, Text } from "../atoms/index.js";
import { CallRef, SeverityTag } from "../molecules/index.js";

/**
 * CitedAsEvidence — the reverse link: which problems rest on the call you are looking at
 * (DESIGN-SYSTEM §4.3).
 *
 * Evidence runs in one direction on every other screen — a finding cites `c3`, and you follow it
 * to the call. This block runs the other way. Standing in a transcript on `[c3]`, it answers
 * *"who used this, and where does it sit in their case?"*, which is the question a reader
 * actually has once they have found the response that was wrong.
 *
 * Two things make it more than a list of titles.
 *
 * **Every sibling ref is reachable.** A problem's whole case is drawn as its refs in order, the
 * current one marked and the rest selectable, so a reader can walk `c3 → c4 → c5` without
 * leaving the transcript. `CallRef` already carries the marked state properly — a strengthened
 * border plus `aria-pressed`, because which ref you are looking at is a selection rather than a
 * fact about the record — so nothing here draws a second selected language.
 *
 * **The position is stated.** `step 2 of 4` is the difference between "this call is involved" and
 * "this call is where it went wrong", and it costs a phrase.
 *
 * Severity carries its word through `SeverityTag` (§4.2), and the block renders nothing at all
 * when nothing cites the call — an empty "Cited as evidence" heading would be a false promise
 * that something is folded away below it.
 */

/**
 * One problem that cites the current call. This is the inventory's own shape, given a name so a
 * screen can build the array against a type rather than against a comment.
 */
export interface CitedFinding {
  /** ADR-0028's `sig1:` key. The React key here; never printed — a signature is an id (§0.2). */
  signature: string;
  title: string;
  severity: SeverityLevel;
  /** Every call this problem rests on, in the order it cites them. */
  refs: readonly string[];
  /** Where `currentRef` sits in `refs`, counting from zero. Printed as `step index + 1 of N`. */
  index: number;
}

export interface CitedAsEvidenceProps {
  findings: readonly CitedFinding[];
  /** The call the reader is standing on. Marked wherever it appears in a `refs` list. */
  currentRef: string;
  onSelectRef: (ref: string) => void;
}

export const CitedAsEvidence = forwardRef<HTMLElement, CitedAsEvidenceProps>(
  function CitedAsEvidence({ findings, currentRef, onSelectRef }, ref) {
    // Nothing cites this call. Say nothing, rather than heading an empty region.
    if (findings.length === 0) return null;

    return (
      <Stack ref={ref} gap={4}>
        <Heading level={3} size="name">
          Cited as evidence
        </Heading>

        <Stack as="ul" gap={4}>
          {findings.map((finding) => (
            <li key={finding.signature}>
              <Stack gap={2}>
                <SeverityTag level={finding.severity} />
                <Text as="p" size="finding">
                  {finding.title}
                </Text>
                <Inline gap={2} align="baseline" wrap>
                  <Text size="meta" tone="muted">
                    step {finding.index + 1} of {finding.refs.length}
                  </Text>
                  {finding.refs.map((candidate) => (
                    <CallRef
                      key={candidate}
                      callRef={candidate}
                      current={candidate === currentRef}
                      onSelect={() => {
                        onSelectRef(candidate);
                      }}
                    />
                  ))}
                </Inline>
              </Stack>
            </li>
          ))}
        </Stack>
      </Stack>
    );
  },
);

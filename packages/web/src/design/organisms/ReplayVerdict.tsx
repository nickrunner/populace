import { forwardRef } from "react";
import type { Verification } from "@populace/contract";

import { Heading, Inline, Measure, Stack, Text } from "../atoms/index.js";
import { MetaLine, Money, RelativeTime, VerdictTag, type MetaFact } from "../molecules/index.js";
import { EvidenceSteps } from "./EvidenceSteps.js";

/**
 * ReplayVerdict — what happened when a judge ran the same calls again (ADR-0015, §4.2, §7.3).
 *
 * The product's strongest claim is not that somebody reported a problem; it is that the calls
 * they cited were **run again, by a different model, and this is what came back**. The store has
 * held `verification.replay[]` since the verifier existed and **no screen has ever drawn it** —
 * the app prints the verdict word and the judge's reason, and throws away the receipts. This
 * component is where they land.
 *
 * The shape is deliberately the shape of the original evidence: the verdict and the reason, then
 * the fresh calls under **"What happened when we tried it again"**, rendered by the same
 * `EvidenceSteps` that draws the finding's own reproduction. The replay records are aligned by
 * index with the originals, so a reader with both on screen can read the second list against the
 * first line for line — which is the only way "it reproduced" or "it did not" is checkable rather
 * than assertable.
 *
 * **The verdict is a word in a square badge, never a hue** (§4.2). `VerdictTag` owns that, and
 * owns the fact that `confirmed` is distinguished from `primary` by shape and word rather than by
 * colour — `confirmed` means *a judge replayed it and it reproduced*, which is a far narrower
 * claim than "good".
 *
 * **Nothing here promises a repeat** (§7.3). Outcomes vary between executions by design, so every
 * string in this component is past tense and singular: *we ran those calls again ourselves*, and
 * this is what that one replay did. The verdict words are `VerdictTag`'s four and no others, so
 * this component cannot emit the claim a triage state reserves for a human asserting it about
 * their own product, and an absence in a later execution is never reported here as a repair.
 */

/** The heading the inventory names, verbatim. */
const REPLAY_TITLE = "What happened when we tried it again";

/**
 * Who ruled. The enum spelling is not the reader's word: a `heuristic` is a rule we wrote, and
 * saying so is more honest about how much weight the verdict carries than the enum is.
 */
const JUDGE_WORDS = {
  model: "judged by a model",
  heuristic: "judged by a rule",
} satisfies Record<Verification["judge"], string>;

export interface ReplayVerdictProps {
  /** The stored verification: the verdict, the reason, the judge, and the replayed calls. */
  verification: Verification;
}

export const ReplayVerdict = forwardRef<HTMLElement, ReplayVerdictProps>(function ReplayVerdict(
  { verification },
  ref,
) {
  const facts: readonly MetaFact[] = [
    { key: "judge", node: JUDGE_WORDS[verification.judge] },
    { key: "at", node: <RelativeTime at={verification.verifiedAt} /> },
    // Zero is the heuristic judge, which costs nothing; printing `$0.0000` there would invite a
    // reader to wonder what went wrong, so the fact drops out and `MetaLine` drops its hairline.
    {
      key: "cost",
      node: verification.costUsd === 0 ? null : <Money usd={verification.costUsd} precision={4} />,
    },
  ];

  return (
    <Stack ref={ref} gap={6}>
      <Stack gap={3}>
        <Inline gap={3} align="baseline" wrap>
          <Heading level={3} size="name">
            We ran those calls again ourselves
          </Heading>
          <VerdictTag value={verification.verdict} />
        </Inline>

        <MetaLine facts={facts} />

        {/* The judge's own words, at the reading measure. Serif, because this is a sentence
            somebody wrote about the product — not something the machine emitted (§4.7). */}
        <Measure width="read">
          <Text as="p" size="read" tone="soft">
            {verification.reason}
          </Text>
        </Measure>
      </Stack>

      {verification.replay.length === 0 ? (
        <Measure width="read">
          <Text as="p" size="read" tone="soft">
            The judge ruled on the report itself; it did not run any calls, so there is nothing to
            read against the original steps.
          </Text>
        </Measure>
      ) : (
        <EvidenceSteps steps={verification.replay} title={REPLAY_TITLE} />
      )}
    </Stack>
  );
});

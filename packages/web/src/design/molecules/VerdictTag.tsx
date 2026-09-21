import { forwardRef } from "react";

import type { VerdictValue } from "../tokens.js";
import { Badge, type BadgeTone } from "../atoms/index.js";

/**
 * VerdictTag — what a judge's replay concluded, in words (DESIGN-SYSTEM §4.1, §4.2).
 *
 * A verdict is **always a square `Badge` carrying the word**. That sentence is the rule, and it
 * exists because `confirmed` and `primary` must never be told apart by hue: `confirmed` means *a
 * judge replayed it and it reproduced*, which is a far narrower claim than "good", and the only
 * honest way to make the difference legible is shape plus word (§4.1).
 *
 * The four words are §4.2's own: `confirmed`, `not reproduced`, `inconclusive`,
 * `not checked yet`. They are deliberately flat. **None of them promises that an outcome repeats**
 * — outcomes vary between executions by design (§7.3) — so a verdict says what one replay did,
 * never what the next one will do, and "verified fixed" is not a phrase this component can emit.
 *
 * Only `confirmed` takes a colour of its own. The other three are `ink-soft` and `ink-muted`
 * against `rule-strong` and `rule`, so the eye is drawn to the one verdict that carries evidence
 * behind it and the rest read as the record they are.
 */

/** §4.2's four words, verbatim. Sentence case, because labels are (§7.4). */
const VERDICT_WORDS = {
  confirmed: "confirmed",
  "not-reproduced": "not reproduced",
  inconclusive: "inconclusive",
  unchecked: "not checked yet",
} satisfies Record<VerdictValue, string>;

/**
 * The register each verdict speaks in. `confirmed` alone has a hue; `unchecked` drops to the
 * quietest boundary the system has, which is the nearest thing `Badge` can say to the mark's
 * dashed 2/7 "this has not happened yet".
 */
const VERDICT_TONE = {
  confirmed: "confirmed",
  "not-reproduced": undefined,
  inconclusive: undefined,
  unchecked: "neutral",
} satisfies Record<VerdictValue, BadgeTone | undefined>;

export interface VerdictTagProps {
  value: VerdictValue;
}

export const VerdictTag = forwardRef<HTMLSpanElement, VerdictTagProps>(function VerdictTag(
  { value },
  ref,
) {
  return (
    <Badge ref={ref} variant="verdict" tone={VERDICT_TONE[value]}>
      {VERDICT_WORDS[value]}
    </Badge>
  );
});

import { forwardRef } from "react";

import { verdictWords } from "../../format.js";
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
 * **The four words come from `verdictWords`, and this component no longer spells its own.** They
 * are deliberately flat, and **none of them promises that an outcome repeats** — outcomes vary
 * between executions by design (§7.3) — so a verdict says what one replay did, never what the next
 * one will do, and "verified fixed" is not a phrase this component can emit.
 *
 * `verdictWords` lives in `@populace/fix-prompt` and reaches here through `format.js`, which is the
 * same route `plural` and `ago` take into `design/`. Before that there were **three** spellings of
 * one verdict in the product — this file's `not reproduced`, `verdictWords`' `did not recur`, and
 * the enum's `not-reproduced` — and which one a reader saw depended on whether the screen they
 * were on happened to render a badge or a sentence. There is one definition now, and it is the one
 * the GitHub issue body is also written from, so a verdict cannot read one way on a screen and
 * another way in somebody's tracker.
 *
 * The one seam worth naming: `verdictWords` takes `null` for "no judge has looked at this", where
 * the token layer's word for the same state is `unchecked`. Both produce *not checked yet*, and
 * this is where the two vocabularies are joined.
 *
 * Only `confirmed` takes a colour of its own. The other three are `ink-soft` and `ink-muted`
 * against `rule-strong` and `rule`, so the eye is drawn to the one verdict that carries evidence
 * behind it and the rest read as the record they are.
 */

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
      {verdictWords(value === "unchecked" ? null : value)}
    </Badge>
  );
});

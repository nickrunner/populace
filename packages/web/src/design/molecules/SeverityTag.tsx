import { forwardRef } from "react";

import type { SeverityLevel } from "../tokens.js";
import { Badge, Text } from "../atoms/index.js";
import { SeverityStack } from "./SeverityStack.js";

/**
 * SeverityTag — severity, carrying its word (DESIGN-SYSTEM §4.2).
 *
 * The binding rule is that severity is never a colour on its own, so this is the component that
 * makes the rule true at 5 call sites: a square `Badge` in the severity ink, printing the word,
 * optionally preceded by the `SeverityStack`'s count. Word, count, hue — three redundant
 * channels, and the tag survives greyscale, colour blindness and a total webfont failure.
 *
 * **Square, not a stadium** (§1.2 M6, §5.2). A severity is a fact recorded about a record, and a
 * fact does not change while you look at it; a stadium in this system means a *person* or a
 * *state*. `Badge` owns that geometry and owns the 1px left rule in the semantic colour, which is
 * why nothing here writes a class: `variant="severity"` with `tone={level}` is the whole styling
 * decision, and `Badge` resolves the tone over the variant's default through `cn()`.
 *
 * **The stack is hidden from assistive technology here, and only here.** Standing alone, a
 * `SeverityStack` is a `role="img"` that names its own severity; inside this tag the word is
 * right beside it, so announcing both would read "critical severity critical". The glyph becomes
 * decoration precisely because the word is present — which is §4.2 working, not being dodged.
 *
 * `kind` is a finding's category, and it is printed as a human noun rather than as the enum's
 * spelling — `coverage-gap` is a *gap* to a reader. An unknown kind prints verbatim rather than
 * disappearing, because swallowing a value the server sent is worse than showing an odd word.
 */

/** The six finding kinds, in the reader's words. Copy, not styling — no variant belongs here. */
const KIND_WORDS: Record<string, string> = {
  bug: "bug",
  friction: "friction",
  "coverage-gap": "gap",
  suggestion: "suggestion",
  abandonment: "abandonment",
  praise: "praise",
};

export interface SeverityTagProps {
  level: SeverityLevel;
  /** A finding's category, printed after the word in `ink-muted`. */
  kind?: string;
  /** Draw the four-dot count as well as the word. Default false. */
  withStack?: boolean;
}

export const SeverityTag = forwardRef<HTMLSpanElement, SeverityTagProps>(function SeverityTag(
  { level, kind, withStack = false },
  ref,
) {
  return (
    <Badge ref={ref} variant="severity" tone={level}>
      {withStack ? (
        <span aria-hidden="true" className="flex">
          <SeverityStack level={level} size="sm" />
        </span>
      ) : null}
      {level}
      {kind === undefined ? null : (
        <Text size="label" tone="muted">
          {KIND_WORDS[kind] ?? kind}
        </Text>
      )}
    </Badge>
  );
});

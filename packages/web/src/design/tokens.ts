/**
 * Typed mirrors of the token names — ATOMIC-INVENTORY §0.3.
 *
 * Values-free by design. Every value lives in `theme.css`, where the cascade can flip it between
 * themes; a value here would be a second source of truth that no `data-theme` change can reach.
 * These unions exist so a component cannot be handed a state the design system has no drawing
 * for, and so the compiler finds every site when a state is added.
 */

/** The semantic register a chip, badge or row is speaking in. */
export type Tone = "neutral" | "good" | "bad" | "warn" | "live" | "selected";

/** Severity, and only severity. The stack lights from the bottom: critical 4 … low 1. */
export type SeverityLevel = "critical" | "high" | "medium" | "low";

/** What a judge's replay concluded. Always carried by a word as well as a hue (§4.2). */
export type VerdictValue = "confirmed" | "not-reproduced" | "inconclusive" | "unchecked";

/** sm 24px · md 32px · lg 40px. */
export type ControlSize = "sm" | "md" | "lg";

export type Density = "default" | "tight";

/** The mark's own grammar: a filled circle was there, a ring was not (§8.6). */
export type PersonDotState =
  | "present"
  | "absent"
  | "left"
  | "theOne"
  | "provisional"
  | "selected";

export type StateKind = "loading" | "empty" | "failed" | "gone";

/** Which of the two density regimes a screen declares itself to be (§5.3). */
export type ScreenClass = "document" | "instrument";

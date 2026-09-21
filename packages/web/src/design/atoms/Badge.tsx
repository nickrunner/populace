import { forwardRef, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../cn.js";
import type { SeverityLevel, Tone } from "../tokens.js";

/**
 * Badge — a FACT about the row (ATOMIC-INVENTORY §1, atom 18).
 *
 * Rectangular, square corners, `t-label`, **no fill**, and a 1px left border in the semantic
 * colour, so it reads as a tab on a file rather than as a pill. That geometry is the whole
 * badge/chip split doing semantic work (§1.2 M6): **square = data, stadium = state**. A verdict,
 * a severity, a mode, an `error` caption above a payload well — those are facts recorded about a
 * record, and a record does not change while you look at it.
 *
 * The badge always prints a WORD (§4.2). Colour is the third redundant channel behind the word
 * and the shape, never the only one; a badge with no children is a bug, which is why `children`
 * is required.
 */

/**
 * What KIND of fact the badge states. It picks the register — and therefore the default ink —
 * so most call sites pass a variant alone and never think about colour.
 */
export type BadgeVariant =
  | "severity"
  | "verdict"
  | "mode"
  | "kind"
  | "status"
  | "neutral"
  | "bad";

/**
 * The ink and the left rule. Optional: it OVERRIDES the variant's default, which is how one
 * `variant="severity"` badge is critical and the next is low without a second component.
 */
export type BadgeTone = Tone | SeverityLevel | "confirmed" | "evidence";

/**
 * `tone` is declared after `variant` deliberately: CVA emits variant classes in declaration
 * order and `cn()` resolves the conflict in favour of the last one, so a supplied tone wins over
 * the variant's default without a compound-variant matrix or a hand-written lookup.
 */
const badge = cva(
  [
    "inline-flex shrink-0 items-center gap-1",
    "rounded-none border-l pl-1.5 pr-1 py-px",
    "t-label whitespace-nowrap",
  ].join(" "),
  {
    variants: {
      variant: {
        /** Lit by `tone`; `low` is the quiet default so an unspecified severity is not alarming. */
        severity: "border-l-low text-low",
        /** A judge's reading. `confirmed` is the only one with a colour of its own. */
        verdict: "border-l-rule-strong text-ink-soft",
        /** ephemeral / longitudinal. Structural, never alarming. */
        mode: "border-l-rule text-ink-muted",
        /** What a thing IS — a step kind, a tool policy, a finding category. */
        kind: "border-l-rule text-ink-muted",
        /** Where something got to — running, paused, killed, done. */
        status: "border-l-rule-strong text-ink-soft",
        neutral: "border-l-rule text-ink-muted",
        /** The `error` caption over a payload well, and the `suspect` step (§4.2). */
        bad: "border-l-critical text-critical",
      },
      tone: {
        neutral: "border-l-rule text-ink-muted",
        good: "border-l-confirmed text-confirmed",
        bad: "border-l-critical text-critical",
        warn: "border-l-medium text-medium",
        /** A badge never carries the live pill's forest ground; it states that it is live. */
        live: "border-l-primary text-primary",
        selected: "border-l-primary text-primary",
        critical: "border-l-critical text-critical",
        high: "border-l-high text-high",
        medium: "border-l-medium text-medium",
        low: "border-l-low text-low",
        confirmed: "border-l-confirmed text-confirmed",
        /** The machine is speaking — a tool name, a call ref, an endpoint (§4.3). */
        evidence: "border-l-evidence text-evidence",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export type BadgeVariants = VariantProps<typeof badge>;

export interface BadgeProps {
  variant?: BadgeVariant;
  tone?: BadgeTone;
  /** Always a word. Never empty — colour alone is not a state (§1.3 rule 4). */
  children: ReactNode;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { variant = "neutral", tone, children },
  ref,
) {
  return (
    <span ref={ref} className={cn(badge({ variant, tone }))}>
      {children}
    </span>
  );
});

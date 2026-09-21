import { forwardRef } from "react";
import { cva } from "class-variance-authority";

import { cn } from "../cn.js";

/**
 * Spinner — atom 28.
 *
 * **There is no spinner in this brand** (DESIGN-SYSTEM §8.6). The mark is made entirely of
 * circles and stadiums; it contains no arc of varying radius and no rotation, so a rotating arc
 * would be the one glyph in the product that does not belong to the mark's grammar. The busy
 * indicator is therefore **three dots on the lattice pitch**, the active one `primary`, advancing
 * every 400ms — the population walking, drawn in the same vocabulary as `RosterLattice`.
 *
 * Never lime: §5.4 sanctions exactly five lime appearances and a busy indicator is not one of
 * them, and lime on paper is 1.08:1 — a lime dot on the light ground cannot be seen at all.
 *
 * The inactive dots are `rule-strong` **rings**, which is the mark's own word for an individual
 * who was not there (§8.6) and is the one token allowed to bound a meaningful non-text mark at
 * 3:1 (§6). So the glyph reads as "one of three is here, and which one keeps changing".
 *
 * `role="status"` with the label visually hidden, per §8.6 and the live-regions rule in §6: a
 * screen reader hears what is loading, not that something spins.
 */
export interface SpinnerProps {
  /** Names what is loading — "Reading the transcript". Visually hidden, announced by `status`. */
  label: string;
  /** `sm` is the inline pitch (6px dots); `md` is the panel pitch (10px dots). Default `md`. */
  size?: "sm" | "md";
  /** Additive, for placement only. Never for colour: the dots are token-driven. */
  className?: string;
}

/**
 * The advance, and the reduced-motion substitution.
 *
 * A blanket `prefers-reduced-motion` override (theme.css §10) freezes every animation at its
 * final frame, which for this glyph would leave three identical rings — the meaning is gone. So
 * this carries one of §5.1's deliberate substitutions: with motion off, the first dot is simply
 * filled and stays filled, and the glyph still reads as an indicator rather than as decoration.
 *
 * Both flips happen in CSS. Nothing here is branched on in TypeScript.
 *
 * Delays are negative so all three dots start mid-cycle on the first frame rather than sitting
 * inert for their first 400ms: dot n is lit during [400n, 400n+400) of a 1200ms loop.
 */
const SPINNER_CSS = `
.populace-spinner-dot {
  animation: populace-spinner-advance 1200ms linear infinite;
}
.populace-spinner-dot-1 { animation-delay: -1200ms; }
.populace-spinner-dot-2 { animation-delay: -800ms; }
.populace-spinner-dot-3 { animation-delay: -400ms; }

@keyframes populace-spinner-advance {
  0%, 33.333% {
    background-color: var(--color-primary);
    border-color: var(--color-primary);
  }
  33.334%, 100% {
    background-color: transparent;
    border-color: var(--color-rule-strong);
  }
}

@media (prefers-reduced-motion: reduce) {
  .populace-spinner-dot {
    animation: none !important;
  }
  .populace-spinner-dot-1 {
    background-color: var(--color-primary);
    border-color: var(--color-primary);
  }
}
`;

/**
 * The gap is `pitch − diameter`, so the dots sit on the mark's own lattice: 26/31 in viewBox
 * units, 6/7 inline and 10/12 in a panel. Writing the gap as the subtraction rather than as 1px
 * and 2px means a change to the lattice module moves the spinner with it.
 */
const spinner = cva("inline-flex items-center", {
  variants: {
    size: {
      sm: "gap-[calc(var(--lat-pitch-sm)_-_var(--lat-dot-sm))]",
      md: "gap-[calc(var(--lat-pitch)_-_var(--lat-dot))]",
    },
  },
  defaultVariants: { size: "md" },
});

/** Base state is the ring — "not here". The animation lights one dot at a time. */
const spinnerDot = cva(
  "populace-spinner-dot shrink-0 rounded-full border-rule-strong bg-transparent",
  {
    variants: {
      size: {
        sm: "size-[var(--lat-dot-sm)] border",
        md: "size-[var(--lat-dot)] border-[1.5px]",
      },
    },
    defaultVariants: { size: "md" },
  },
);

export const Spinner = forwardRef<HTMLSpanElement, SpinnerProps>(function Spinner(
  { label, size = "md", className },
  ref,
) {
  return (
    <span ref={ref} role="status" className={cn(spinner({ size }), className)}>
      <span aria-hidden="true" className={cn(spinnerDot({ size }), "populace-spinner-dot-1")} />
      <span aria-hidden="true" className={cn(spinnerDot({ size }), "populace-spinner-dot-2")} />
      <span aria-hidden="true" className={cn(spinnerDot({ size }), "populace-spinner-dot-3")} />
      <span className="sr-only">{label}</span>
      {/* React 19 hoists and de-duplicates this by `href`, so N spinners emit one rule set. */}
      <style href="populace-spinner" precedence="medium">
        {SPINNER_CSS}
      </style>
    </span>
  );
});

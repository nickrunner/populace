import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The one class-merging helper — ATOMIC-INVENTORY §0.1.
 *
 * `clsx` flattens the conditional forms; `tailwind-merge` resolves conflicts so the LAST class
 * wins rather than whichever the stylesheet happened to emit later. That is the whole reason a
 * `className` prop on an atom is safe: `cn(variantClasses, className)` means a caller's
 * `bg-surface` beats the variant's `bg-sunk` deterministically.
 *
 * tailwind-merge only knows about Tailwind's default theme, so two things are taught to it here:
 *
 *  1. **Our colour names.** `bg-surface`, `text-ink-muted`, `border-rule-strong` and the rest are
 *     not in the default palette, so without this `cn("bg-sunk", "bg-surface")` would keep both.
 *  2. **The type steps.** `t-read` and `t-ui` are custom utilities that both set font-family,
 *     size, leading, weight and tracking. They are mutually exclusive by construction — a step
 *     IS the family — so they form one class group and the last one wins. Without this a `Text`
 *     atom could not be overridden at its call site at all.
 */

/** Every colour token published by `@theme inline` in theme.css. */
const COLORS = [
  "bg",
  "surface",
  "sunk",
  "hover",
  "ink",
  "ink-soft",
  "ink-muted",
  "rule",
  "rule-strong",
  "primary",
  "on-primary",
  "accent",
  "on-accent",
  "accent-wash",
  "primary-wash",
  "mark-ring",
  "focus",
  "link",
  "evidence",
  "evidence-wash",
  "critical",
  "high",
  "medium",
  "low",
  "confirmed",
  "on-critical",
  "graph",
];

/** The type scale. One step per element: serif, sans and mono steps all live in one group. */
const TYPE_STEPS = [
  "t-statement",
  "t-lede",
  "t-finding",
  "t-read",
  "t-read-sm",
  "t-voice",
  "t-masthead",
  "t-title",
  "t-figure",
  "t-figure-sm",
  "t-name",
  "t-ui",
  "t-eyebrow",
  "t-meta",
  "t-label",
  "t-code",
  "t-code-inline",
  "t-code-sm",
  "t-ref",
];

/** The four eyebrow gaps from §3.7. They all set margin-top, so only one may apply. */
const EYEBROW_GAPS = [
  "eyebrow-statement",
  "eyebrow-masthead",
  "eyebrow-lede",
  "eyebrow-finding",
];

const twMerge = extendTailwindMerge<"type-step" | "eyebrow-gap">({
  extend: {
    theme: {
      color: COLORS,
      font: ["display", "text", "mono"],
    },
    classGroups: {
      "type-step": TYPE_STEPS,
      "eyebrow-gap": EYEBROW_GAPS,
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

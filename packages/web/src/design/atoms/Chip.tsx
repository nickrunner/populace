import { forwardRef, useCallback, type CSSProperties, type ReactNode } from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../cn.js";
import { Dot } from "../brand/index.js";
import { focusRing, pressTransition } from "../variants.js";
import type { Tone } from "../tokens.js";

/**
 * Chip — a STATE you can sometimes act on (ATOMIC-INVENTORY §1, atom 19).
 *
 * Stadium, full radius, `t-meta`, a 1px border. The counterpart to `Badge`, and the split is the
 * geometry rule doing semantic work (§1.2 M6): **square = data, stadium = state**. A run status,
 * a filter, a selection, "someone is here" — things that are true right now and may not be true
 * in a minute.
 *
 * The state is always carried by a WORD as well as a hue (§4.2): `killed` and `failed` share an
 * ink, and it is the word that tells them apart.
 *
 * `live` is the product's sanctioned lime (§5.4, appearance 2): a **forest** pill with paper text
 * and a 6px lime dot in BOTH themes. Forest is `primary` in light and `accent` in dark — the same
 * colour under two token names — so the pair is spelled with a `dark:` utility rather than with a
 * `useTheme()`, and the dot's lime is 7.97:1 on it. Lime on paper is 1.08:1, which is why the
 * ground never flips to the page's.
 *
 * The dot itself is `brand/Dot` — one circle, the mark's own geometry, and the owner of the
 * two-second breath and of its reduced-motion substitution. See `liveDot` below for why its
 * paint is pinned by name rather than asked for with `tone`.
 */

const chip = cva(
  [
    "inline-flex min-h-6 shrink-0 items-center justify-center",
    "rounded-full border px-2 py-0.5",
    "t-meta whitespace-nowrap",
    pressTransition,
  ].join(" "),
  {
    variants: {
      tone: {
        neutral: "border-rule-strong text-ink-muted",
        good: "border-confirmed text-confirmed",
        bad: "border-critical text-critical",
        warn: "border-medium text-medium",
        /**
         * Forest ground, paper ink, in both themes — and `--chip-live-dot`, the lime the dot on
         * it is painted with, declared here so the theme flip is an ordinary `dark:` utility.
         */
        live: [
          "border-primary bg-primary text-on-primary",
          "dark:border-accent dark:bg-accent dark:text-on-accent",
          "[--chip-live-dot:var(--color-accent)] dark:[--chip-live-dot:var(--color-primary)]",
        ].join(" "),
        selected: "border-primary bg-primary-wash text-primary",
      },
      interactive: {
        true: `cursor-pointer hover:bg-hover ${focusRing}`,
        false: "",
      },
    },
    /**
     * The live pill keeps its forest ground on hover; `bg-hover` is a page-ground tint and would
     * knock the only legal lime ground out from under the dot.
     */
    compoundVariants: [
      {
        tone: "live",
        interactive: true,
        class: "hover:bg-primary dark:hover:bg-accent",
      },
    ],
    defaultVariants: { tone: "neutral", interactive: false },
  },
);

export type ChipVariants = VariantProps<typeof chip>;

/**
 * The live dot's paint, pinned to the pill's own `--chip-live-dot` rather than asked for with
 * `<Dot tone="lime">`.
 *
 * `markTone` and `markState` both publish `--mark-paint` as arbitrary-property utilities at
 * identical specificity, so which of the two lands last in the sheet is Tailwind's sort order and
 * not the caller's intent — and as the emitted CSS stands, `state="present"`'s
 * `[--mark-paint:var(--color-primary)]` sorts after `tone="lime"`'s `[--mark-paint:var(--color-accent)]`
 * and wins. §5.4's lime is law and may not depend on a sort, so the fill is handed over as an
 * inline custom property, which outranks every class whatever order they are written in. The
 * value is a reference, so the theme flip still happens in CSS on the pill's root and nothing
 * here branches on the theme.
 */
const liveDot = { "--mark-fill": "var(--chip-live-dot)" } as CSSProperties;

/**
 * The count is tabular by construction (`t-meta` carries `tnum`/`zero`) and muted — except on the
 * live pill, where `ink-muted` would be unreadable on forest and it inherits the paper ink.
 */
const chipCount = cva("ml-2", {
  variants: {
    tone: {
      neutral: "text-ink-muted",
      good: "text-ink-muted",
      bad: "text-ink-muted",
      warn: "text-ink-muted",
      live: "text-on-primary dark:text-on-accent",
      selected: "text-ink-muted",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export interface ChipProps {
  tone?: Tone;
  /** Tabular, muted, after an 8px gap. */
  count?: number;
  /** So a `<Link>` can BE the chip rather than copy its class string. */
  asChild?: boolean;
  onClick?: () => void;
  /** Renders `aria-pressed` when the chip is interactive. */
  pressed?: boolean;
  /** Always a word. */
  children: ReactNode;
}

export const Chip = forwardRef<HTMLElement, ChipProps>(function Chip(
  { tone = "neutral", count, asChild = false, onClick, pressed, children },
  ref,
) {
  const interactive = asChild || onClick !== undefined;
  const className = cn(chip({ tone, interactive }));

  /**
   * A callback ref, because the rendered node is a `<span>`, a `<button>` or whatever the caller
   * slots in. `RefObject` is invariant in its element type and could not be handed to all three;
   * a callback taking `HTMLElement` satisfies every one of them.
   */
  const setRef = useCallback(
    (node: HTMLElement | null) => {
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  /**
   * §5.1: the live dot breathes 1 → 0.35 → 1 over 2s, and under `prefers-reduced-motion` it stops
   * and takes a 1px lime ring instead, so "live" still reads as different from a static dot.
   *
   * Both of those belong to `brand/Dot`, which owns the keyframe, so this composes it rather than
   * writing a second one. It used to be Tailwind's own pulse utility, whose opacity floor is 0.5 —
   * a shallower breath than the 0.35 §5.1 specifies, and a different one from the lattice's.
   *
   * `size="sm"` is the mark's 6px dot, which is the diameter §5.4 names.
   */
  const dot =
    tone === "live" ? <Dot size="sm" pulse className="mr-1.5" style={liveDot} /> : null;

  const tail =
    count === undefined ? null : (
      <span className={cn(chipCount({ tone }))}>{count}</span>
    );

  const live = tone === "live" ? "polite" : undefined;

  if (asChild) {
    return (
      <Slot
        ref={setRef}
        className={className}
        aria-live={live}
        aria-pressed={pressed}
        onClick={onClick}
      >
        {dot}
        <Slottable>{children}</Slottable>
        {tail}
      </Slot>
    );
  }

  if (onClick !== undefined) {
    return (
      <button
        ref={setRef}
        type="button"
        className={className}
        aria-live={live}
        aria-pressed={pressed}
        onClick={onClick}
      >
        {dot}
        {children}
        {tail}
      </button>
    );
  }

  return (
    <span ref={setRef} className={className} aria-live={live}>
      {dot}
      {children}
      {tail}
    </span>
  );
});

import { forwardRef, useCallback, type ReactNode } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../cn.js";
import { surfaceBase } from "../variants.js";
import { Heading, Inline } from "../atoms/index.js";
import { textStyles } from "../atoms/Text.js";

/**
 * Card — ATOMIC-INVENTORY §3, organism 1. 85 sites today, ~25 after the port.
 *
 * **The whole point of this component is that most of those 85 stop being boxes.** The direction
 * is explicit (§1.1, §1.4): structure is carried by rules and alignment, not by rounded
 * rectangles, and a card means exactly one thing — *a discrete record you can open*. A finding, a
 * form, an error and a stat strip arriving as the same rounded rectangle is the bug being fixed.
 *
 * The collapse happens at the CALL SITES — most of those 85 become `Ledger` rows, `Section`s and
 * ruled bands — so what survives as a `<Card>` really is a discrete record, and **`<Card>` with
 * no props draws one**: §2.5's *card* level, `surface` + a hairline + the near-invisible
 * `shadow-card`, which is literally `none` in dark because `#2C3730` on `#202823` is 1.22:1 and
 * the hairline has to do all of it. That is what the inventory's signature means by a card, and
 * it is why `level` is not in it.
 *
 * `level="flat"` is the opt-in for the band form — no fill, no border, no shadow, square, aligned
 * to the column it sits in (§2.5's *flat* row). Two things follow from that alignment:
 *
 *  - **A flat card has no horizontal padding.** Inset content would break the left alignment that
 *    replaces the box, so `pad` becomes padding-block alone and the band runs the full width of
 *    its column. That is also why the hover ground of an interactive flat card is edge to edge.
 *  - **The hairline is drawn above, and suppressed on the first child**, so a column of flat
 *    cards is ruled *between* its records and never opens on a stray line — the same reason
 *    `StatGroup` draws its rules with a gap rather than with `divide-x`.
 *
 * `tone="sunk"` is the quiet aside — Compare's caveat block is the canonical site. It is NOT
 * §2.5's *well*: a well means machine output and carries the 2px `evidence` left edge, which
 * belongs to `PayloadBlock` and to nothing else (§4.3).
 *
 * `asChild` is what stops a screen copying this class string onto a `<Link>` (§0.2), and
 * `interactive` adds the hover language and the shared `focusRing` — never a hand-rolled one.
 */

/** 0 / 14 / 16 / 24, as the inventory fixes them. */
export type CardPad = "none" | "tight" | "default" | "roomy";

/** `boxed` is the discrete record you can open, and the default; `flat` is the ruled band. */
export type CardLevel = "flat" | "boxed";

export type CardTone = "surface" | "sunk";

/**
 * Padding, the flat band's hairline, and the sunk ground.
 *
 * `inset` is not a prop — it is `level === "boxed"`, lifted into a variant so the four padding
 * steps can be paired with it in `compoundVariants` rather than in a hand-written lookup (§0.2).
 * Each inset step also publishes `--card-pad-x`, which `CardFooter` reads to bleed its rule out
 * to the card's edges without either component being told what the other chose.
 */
const card = cva("", {
  variants: {
    level: {
      /** Square, unfilled, ruled between siblings. */
      flat: "rounded-none border-t border-rule first:border-t-0",
      boxed: "",
    },
    tone: {
      surface: "",
      sunk: "",
    },
    /** Padding-block. The inline half is the `inset` compound below. */
    pad: {
      none: "py-0",
      tight: "py-3.5",
      default: "py-4",
      roomy: "py-6",
    },
    inset: {
      true: "",
      /** A flat band aligns to its column, so it never indents its content. */
      false: "px-0 [--card-pad-x:0px]",
    },
  },
  compoundVariants: [
    { inset: true, pad: "none", class: "px-0 [--card-pad-x:0px]" },
    { inset: true, pad: "tight", class: "px-3.5 [--card-pad-x:14px]" },
    { inset: true, pad: "default", class: "px-4 [--card-pad-x:16px]" },
    { inset: true, pad: "roomy", class: "px-6 [--card-pad-x:24px]" },
    /**
     * A quiet aside. `shadow-none` because a recessed ground that also casts a shadow is
     * incoherent, and `--focus-sep` so a control focused inside it draws its separator band in
     * the colour immediately behind it (§4.6).
     */
    {
      level: "boxed",
      tone: "sunk",
      class: "bg-sunk shadow-none [--focus-sep:var(--color-sunk)]",
    },
  ],
  defaultVariants: { level: "boxed", tone: "surface", pad: "default", inset: true },
});

export type CardVariants = VariantProps<typeof card>;

export interface CardProps {
  /** `boxed` — a discrete record you can open, and the default. `flat` — a ruled band. */
  level?: CardLevel;
  /** 0 / 14 / 16 / 24. On a flat card this is padding-block only. */
  pad?: CardPad;
  tone?: CardTone;
  /** The hover language and the shared focus ring. */
  interactive?: boolean;
  /** So a `<Link>` can BE the card rather than copy its class string. */
  asChild?: boolean;
  className?: string;
  children: ReactNode;
}

export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  {
    level = "boxed",
    pad = "default",
    tone = "surface",
    interactive = false,
    asChild = false,
    className,
    children,
  },
  ref,
) {
  const classes = cn(
    surfaceBase({ level: level === "boxed" ? "card" : "flat", interactive }),
    card({ level, tone, pad, inset: level === "boxed" }),
    className,
  );

  /**
   * A callback ref, because the rendered node is a `<div>` or whatever the caller slots in.
   * `RefObject` is invariant in its element type and could not be handed to both; a callback
   * taking `HTMLElement` satisfies either.
   */
  const setRef = useCallback(
    (node: HTMLElement | null) => {
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  if (asChild) {
    return (
      <Slot ref={setRef} className={classes}>
        {children}
      </Slot>
    );
  }

  return (
    <div ref={setRef} className={classes}>
      {children}
    </div>
  );
});

export interface CardHeaderProps {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  /**
   * `3` inside a `Section`, and the default. `2` when the card is the first thing under a
   * `PageHeader`, so the outline does not jump 1 → 3. Appearance does not change with depth —
   * the step stays `name`, exactly as `Section`'s stays `eyebrow`.
   */
  level?: 2 | 3;
}

/**
 * The card's own heading band. `<h3>` by default: `PageHeader` owns the single `<h1>` and
 * `Section` owns the `<h2>`, so a card title inside a section is the third level and an outline
 * reader walks 1 → 2 → 3 without a gap (§6, "Heading order").
 *
 * The exception the `level` prop exists for is a card that sits **directly** under a
 * `PageHeader` with no section between them — several screens have one — where a fixed `<h3>`
 * makes the document read h1 then h3, which is a skipped level and a real regression for an
 * outline reader. The prop is `2 | 3` and nothing else: there is no level a card can legally
 * take that `PageHeader` and `Section` have not already spoken for.
 *
 * `sub` takes its step on a `<div>` rather than inside a `Text`, so a bare string gets the serif
 * reading floor while a `MetaLine` or a `Chip` handed in as the sub keeps its own register.
 */
export const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(function CardHeader(
  { title, sub, actions, level = 3 },
  ref,
) {
  return (
    <div ref={ref} className="mb-3">
      <div className="flex items-start justify-between gap-3">
        <Heading level={level} size="name" className="min-w-0">
          {title}
        </Heading>
        {actions === undefined ? null : (
          <Inline gap={2} align="center" className="shrink-0">
            {actions}
          </Inline>
        )}
      </div>
      {sub === undefined ? null : (
        <div className={cn("mt-1", textStyles({ size: "read-sm", tone: "soft" }))}>{sub}</div>
      )}
    </div>
  );
});

export interface CardFooterProps {
  children: ReactNode;
}

/**
 * The footer's hairline runs to the card's edges rather than to its text column, which is what
 * makes it read as the bottom of a record instead of as one more rule inside it. It gets there
 * by reading `--card-pad-x`, the variable `Card` publishes with its padding step — so the two
 * components agree without either being told what the other chose, and nothing here asks
 * TypeScript which `pad` was passed. On a flat card the variable is `0px` and the bleed is a
 * no-op, which is correct: a flat band has no edges to reach.
 */
export const CardFooter = forwardRef<HTMLDivElement, CardFooterProps>(function CardFooter(
  { children },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "mt-4 border-t border-rule pt-3",
        "[margin-inline:calc(var(--card-pad-x,0px)*-1)]",
        "[padding-inline:var(--card-pad-x,0px)]",
      )}
    >
      <Inline
        gap={2}
        align="center"
        wrap
        className={cn(textStyles({ size: "meta", tone: "muted" }))}
      >
        {children}
      </Inline>
    </div>
  );
});

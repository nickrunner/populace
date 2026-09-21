import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ReactNode } from "react";
import { cn } from "../cn.js";

/**
 * Text — the type atom, and the busiest component in the system (~250 sites).
 *
 * DESIGN-SYSTEM §3.1 is the law this file encodes as an API:
 *
 *   a name, a number, a label or a control → Space Grotesk
 *   a sentence the product or a person says → Source Serif 4
 *   what the machine emitted or is named by → IBM Plex Mono
 *
 * **The family follows from the step, and the step is the only lever.** There is no `family`
 * prop and no `font-*` class anywhere below, so a label cannot be set in the serif by accident:
 * `size="label"` IS `t-label`, which IS Space Grotesk. The three sub-unions below make that
 * visible in the type system — `SerifTextSize` and `SansTextSize` are the two halves of
 * `TextSize`, and mono is not in `TextSize` at all, because machine speech goes through `Mono`
 * or `Code`, never through `Text`.
 *
 * Every step also carries its own tabular lining figures and slashed zero (§4.4), so nothing
 * here writes `tabular-nums`.
 */

/** Sentences — a thing the product or a person is saying (§3.2). */
export type SerifTextSize = "statement" | "lede" | "finding" | "read" | "read-sm" | "voice";

/** Names, numbers, labels, controls (§3.3). */
export type SansTextSize = "figure" | "figure-sm" | "name" | "ui" | "eyebrow" | "meta" | "label";

/**
 * What `Text` may be set in. `title` and `masthead` are deliberately absent: they are headings,
 * and headings go through `Heading`, which owns the document's heading order.
 */
export type TextSize = SerifTextSize | SansTextSize;

/**
 * Every step in the scale, including the two heading steps and the four mono steps. This is the
 * shared vocabulary of `textStyles`; the *props* of each atom narrow it to the steps that atom
 * is allowed to set, which is where the §3.1 law is actually enforced.
 */
export type TypeStep =
  | TextSize
  | "masthead"
  | "title"
  | "code"
  | "code-inline"
  | "code-sm"
  | "ref";

/**
 * The inks a piece of text may take. `soft` is the serif's body colour — §3.6's one place where
 * a family changes a colour choice — and `muted` is the sans's secondary tier.
 */
export type TextTone =
  | "ink"
  | "soft"
  | "muted"
  | "primary"
  | "evidence"
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "confirmed"
  | "on-primary"
  | "on-accent";

/**
 * The marker, appearance 1 of the five sanctioned limes (§5.4). **One per screen.**
 *
 * In light it is a band behind the ink at the x-height — ink on lime is 12.35:1. In dark it
 * inverts to a 2px rule under the text, because a lime fill big enough to sit behind a word is a
 * flashlight in a dark room. Both states are the same mechanism at two sizes, so the flip is two
 * `dark:` utilities in the cascade and nothing in TypeScript asks what the theme is.
 *
 * Written as longhands rather than the `background` shorthand of §5.4 on purpose: the shorthand
 * needs a `/` between position and size, and a `/` inside an arbitrary value is Tailwind's
 * opacity modifier. Same computed result, no ambiguity.
 */
const markerBand = [
  "[background-image:linear-gradient(var(--color-accent),var(--color-accent))]",
  "[background-repeat:no-repeat]",
  "[background-position:0_0.72em]",
  "[background-size:100%_0.5em]",
  "dark:[background-position:0_100%]",
  "dark:[background-size:100%_2px]",
  "[box-decoration-break:clone]",
  "[-webkit-box-decoration-break:clone]",
].join(" ");

/**
 * The one type cva. `Heading`, `Mono` and `Code` call it too, so there is exactly one mapping
 * from a step name to a `t-*` utility and one from a tone name to an ink token in the app.
 *
 * `cn()` teaches tailwind-merge that the `t-*` utilities are a single class group, so a caller's
 * `className` can override the step at the call site and win deterministically.
 */
export const textStyles = cva("", {
  variants: {
    size: {
      // serif — saying
      statement: "t-statement",
      lede: "t-lede",
      finding: "t-finding",
      read: "t-read",
      "read-sm": "t-read-sm",
      voice: "t-voice",
      // sans — naming
      masthead: "t-masthead",
      title: "t-title",
      figure: "t-figure",
      "figure-sm": "t-figure-sm",
      name: "t-name",
      ui: "t-ui",
      eyebrow: "t-eyebrow",
      meta: "t-meta",
      label: "t-label",
      // mono — the machine
      code: "t-code",
      "code-inline": "t-code-inline",
      "code-sm": "t-code-sm",
      ref: "t-ref",
    } satisfies Record<TypeStep, string>,
    tone: {
      ink: "text-ink",
      soft: "text-ink-soft",
      muted: "text-ink-muted",
      primary: "text-primary",
      evidence: "text-evidence",
      critical: "text-critical",
      high: "text-high",
      medium: "text-medium",
      low: "text-low",
      confirmed: "text-confirmed",
      "on-primary": "text-on-primary",
      "on-accent": "text-on-accent",
    } satisfies Record<TextTone, string>,
    marked: {
      true: markerBand,
      false: "",
    },
    /** Needs a block box to clip in, which an inline `<span>` does not have. */
    truncate: {
      true: "block min-w-0 truncate",
      false: "",
    },
  },
  defaultVariants: { size: "ui", tone: "ink", marked: false, truncate: false },
});

export type TextStyleVariants = VariantProps<typeof textStyles>;

/** The elements `Text` may be. Headings are not among them; that is `Heading`'s job. */
export type TextElement = "span" | "p" | "div" | "dd" | "dt" | "li" | "figcaption";

export interface TextProps {
  /** The step, which decides the family. Default `"ui"` — the chrome default (§3.3). */
  size?: TextSize;
  tone?: TextTone;
  as?: TextElement;
  /** The lime marker band. Exactly one per screen (§5.4). */
  marked?: boolean;
  truncate?: boolean;
  className?: string;
  id?: string;
  children: ReactNode;
}

export const Text = forwardRef<HTMLElement, TextProps>(function Text(
  {
    size = "ui",
    tone = "ink",
    as = "span",
    marked = false,
    truncate = false,
    className,
    id,
    children,
  },
  ref,
) {
  // JSX given a union of intrinsic tags asks for the *intersection* of their ref types, which no
  // single element satisfies (an `HTMLSpanElement` has no `align`). Erasing the union to one tag
  // is the whole fix; the cast stays inside `HTMLElement`, so no `any` and no `unknown`, and the
  // public ref type stays honest: callers get `HTMLElement`, which is what they hold.
  const Component = as as "span";
  return (
    <Component
      ref={ref}
      id={id}
      className={cn(textStyles({ size, tone, marked, truncate }), className)}
    >
      {children}
    </Component>
  );
});

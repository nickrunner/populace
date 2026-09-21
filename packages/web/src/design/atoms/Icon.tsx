import { forwardRef, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../cn.js";

/**
 * Icon — eight utility glyphs, affordance only, never meaning (ATOMIC-INVENTORY §1, atom 21;
 * DESIGN-SYSTEM §8.6, "The icon policy").
 *
 * **There is no icon library.** The system has two glyph tiers, and this is the second one: the
 * brand shapes (dot, ring, capsule, lattice, fan, severity stack) are the only glyphs allowed to
 * *be* the information, and anything the eight below cannot say, a **word** says. So there is no
 * "info", no "warning", no "trash", no "settings" here — a missing glyph is the signal that the
 * label was supposed to be prose.
 *
 * Drawn to §8.6's discipline: a 16-unit grid, 1.5 stroke, round caps and joins, `currentColor`
 * and nothing else, no gradient, no fill, and no diagonal except the one `external` needs to mean
 * "away from here".
 *
 * **Sizing is em by default.** With no `size`, the glyph is `1em` square, so a chevron beside
 * `t-meta` is 12px and the same chevron beside `t-ui` is 13px with nothing passed and nothing to
 * keep in sync. `size` pins it to the three fixed steps when a glyph must line up with a control
 * rather than with a sentence.
 *
 * An affordance glyph never appears without a text label (§6, "Icons"). The exception is
 * `IconButton`, which requires both an `aria-label` and a `Tooltip`; there, and anywhere else the
 * neighbouring text already says it, leave `title` unset and the glyph is `aria-hidden`.
 */

export type IconName =
  | "chevron-right"
  | "chevron-down"
  | "check"
  | "x"
  | "plus"
  | "minus"
  | "copy"
  | "external";

/**
 * `size-[1em]` is the base; the fixed steps override it and `cn()` resolves the conflict, so
 * there is no `defaultVariants` entry and "unset" keeps its own meaning.
 */
const icon = cva("inline-block size-[1em] shrink-0", {
  variants: {
    size: {
      12: "size-3",
      16: "size-4",
      20: "size-5",
    },
  },
});

export type IconVariants = VariantProps<typeof icon>;

export interface IconProps {
  name: IconName;
  /** 12 / 16 / 20px. Unset means `1em` — the glyph takes the size of the text beside it. */
  size?: 12 | 16 | 20;
  className?: string;
  /** Set this ONLY when the glyph is the sole carrier of its meaning; otherwise it is hidden. */
  title?: string;
}

/**
 * The geometry, on a 16-unit grid. Every corner is a 1.5-radius arc, which is the brand's "no
 * sharp inside corner" rule at glyph scale.
 */
function glyph(name: IconName): ReactNode {
  switch (name) {
    case "chevron-right":
      return <path d="M6.25 3.5 10.75 8l-4.5 4.5" />;
    case "chevron-down":
      return <path d="M3.5 6.25 8 10.75l4.5-4.5" />;
    case "check":
      return <path d="m3.25 8.25 3.25 3.25 6.25-6.75" />;
    case "x":
      return (
        <>
          <path d="m4 4 8 8" />
          <path d="m12 4-8 8" />
        </>
      );
    case "plus":
      return (
        <>
          <path d="M8 3.25v9.5" />
          <path d="M3.25 8h9.5" />
        </>
      );
    case "minus":
      return <path d="M3.25 8h9.5" />;
    case "copy":
      return (
        <>
          {/* the sheet behind, open where the front sheet covers it */}
          <path d="M9.5 6.5V4A1.5 1.5 0 0 0 8 2.5H4A1.5 1.5 0 0 0 2.5 4v4A1.5 1.5 0 0 0 4 9.5h2.5" />
          {/* the sheet in front */}
          <path d="M8 6.5h4A1.5 1.5 0 0 1 13.5 8v4a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 12V8A1.5 1.5 0 0 1 8 6.5Z" />
        </>
      );
    case "external":
      return (
        <>
          <path d="M9 3.5H5A1.5 1.5 0 0 0 3.5 5v6A1.5 1.5 0 0 0 5 12.5h6a1.5 1.5 0 0 0 1.5-1.5V7" />
          <path d="M9.75 3.5h2.75v2.75" />
          {/* the system's one sanctioned diagonal: "away from here" */}
          <path d="M12.5 3.5 8 8" />
        </>
      );
  }
}

export const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
  { name, size, className, title },
  ref,
) {
  const labelled = title !== undefined;
  return (
    <svg
      ref={ref}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      role={labelled ? "img" : undefined}
      aria-hidden={labelled ? undefined : "true"}
      className={cn(icon({ size }), className)}
    >
      {labelled ? <title>{title}</title> : null}
      {glyph(name)}
    </svg>
  );
});

import { forwardRef } from "react";
import { cva } from "class-variance-authority";

import { cn } from "../cn.js";
import type { SeverityLevel } from "../tokens.js";
import { Dot, Ring } from "../brand/index.js";

/**
 * SeverityStack — signature move M3 (DESIGN-SYSTEM §1.2), and the product's core semantic glyph.
 *
 * Severity is a **vertical column of four dots at the mark's own pitch**, lit from the bottom up:
 * critical 4, high 3, medium 2, low 1. Lit dots are filled in the severity colour; unlit dots are
 * 1px rings in `rule-strong` (3.2:1 — visible, unlike a hairline segment).
 *
 * This is not an invented glyph. The mark's own stem *is* four circles in a vertical column at
 * (13,13) (13,44) (13,75) (13,106), so the stack is literally the logo's stem carrying a reading,
 * and the unlit state is the same "ring = absent" grammar the lattice uses (§8.6). It therefore
 * composes `Dot` and `Ring` and draws nothing itself: the column is a flex box, the circles are
 * the brand primitives, and the paint is the mark protocol's `--mark-paint`.
 *
 * **Three redundant channels, and this is only one of them** (§4.2). The stack carries the
 * *count*, the word carries the name and the hue carries the register; remove any one and
 * severity still reads. **The word always accompanies it** — that is `SeverityTag`'s job, and a
 * stack standing alone in a ledger stub still names itself to assistive technology through
 * `role="img"`, so no reader is ever left with colour alone.
 *
 * Nothing here animates (§5.1) and nothing here branches on the theme: the severity tokens and
 * `rule-strong` flip in the cascade.
 */

/** How many of the four are lit, from the bottom. The whole semantics of the glyph. */
const LIT: Record<SeverityLevel, number> = { critical: 4, high: 3, medium: 2, low: 1 };

/** Top to bottom, as positions counted from the bottom — so index 0 is drawn highest. */
const POSITIONS = [4, 3, 2, 1] as const;

/**
 * The column's own two sizes, published as `--stack-dot` and `--stack-pitch` and read by every
 * circle in it. They are lengths, not colours, so they are written where the design system wrote
 * them rather than resolved through a colour token.
 *
 * `sm` is §1.2 M3's own measurement — 4px dots at the mark's pitch, 19px tall and **5px of row
 * width**, which is what makes the glyph affordable in a 32px instrument row and beside an 11px
 * `t-label` word. `md` is §10's stated fallback — the 6px `--lat-dot-sm` at `--lat-pitch-sm`, for
 * a detail pane or a document-class stub where the 4px rings would be asking too much of a
 * non-retina LCD.
 */
const stack = cva("inline-flex shrink-0 flex-col items-center", {
  variants: {
    size: {
      sm: "[--stack-dot:4px] [--stack-pitch:5px]",
      md: "[--stack-dot:var(--lat-dot-sm)] [--stack-pitch:var(--lat-pitch-sm)]",
    },
  },
  defaultVariants: { size: "sm" },
});

/** Every circle takes the column's unit, overriding the primitive's own size token. */
const UNIT = "[--mark-unit:var(--stack-dot)]";

export interface SeverityStackProps {
  level: SeverityLevel;
  /** `sm` 4px dots — rows and tags. `md` 6px — detail panes. Default `sm`. */
  size?: "sm" | "md";
}

export const SeverityStack = forwardRef<HTMLSpanElement, SeverityStackProps>(
  function SeverityStack({ level, size = "sm" }, ref) {
    const lit = LIT[level];
    return (
      <span
        ref={ref}
        role="img"
        aria-label={`${level} severity`}
        className={cn(stack({ size }), "gap-[calc(var(--stack-pitch)_-_var(--stack-dot))]")}
      >
        {POSITIONS.map((position) =>
          position <= lit ? (
            <Dot key={position} state="present" tone={level} className={UNIT} />
          ) : (
            <Ring key={position} weight="hair" tone="rule" className={UNIT} />
          ),
        )}
      </span>
    );
  },
);

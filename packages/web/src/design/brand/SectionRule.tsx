import { forwardRef } from "react";
import type { CSSProperties } from "react";
import { cn } from "../cn.js";
import { MARK_CELL_GAP, markPitch, markUnit } from "./Ring.js";
import type { BrandSize } from "./Ring.js";
import { Dot } from "./Dot.js";
import { Capsule } from "./Capsule.js";
import { ornamentGround } from "./LatticeField.js";
import type { OrnamentGround } from "./LatticeField.js";

/**
 * SectionRule — the brand's own divider, for the seam between two **marketing** sections
 * (DESIGN-SYSTEM §8.6, §9.2).
 *
 * A hairline with the mark's first cells set into its left end: two or three dots at the mark's
 * own pitch, then the rule runs to the edge. It is the same sentence the ledger stub says on
 * every screen in the product — *a locator on the left, a measure to the right* — said once, in
 * the brand's shapes, at the size a section break needs.
 *
 * **It is marketing-only, and that is a rule rather than a suggestion.** The product's dense
 * screens keep the plain `Separator` hairline: at 13px chrome and `py-2` rows, a divider with
 * ornament on it is one more thing between a reader and a number, and §1.3 rule 10 already
 * forbids ornament inside a cell. This component is not exported to any `/app` screen's
 * vocabulary and has no business on one.
 *
 * **Why the dots are not dashed.** The obvious "brand hairline" is the mark's 2/7 dash — and it
 * is taken: `Separator weight="provisional"` draws that rhythm and it *means* **this has not
 * happened yet** (§8.6). A dashed divider between two finished sections would spend a word of
 * the grammar on furniture. The cells at the end of the line say nothing at all; they are
 * `aria-hidden` ornament, and they are why the divider still reads as ours.
 *
 * **Colour.** Ink and rule, through the shared ground protocol in `LatticeField.js` — correct on
 * paper and on the landing's forest band, flipped entirely in the cascade. **No lime**: the
 * lime budget is 24×24px per viewport and belongs to the screen's one marked thing (§5.4), not
 * to a divider that may appear four times on a page. **No clay**: clay exists in this product
 * only as `Fan`'s `gaveUp` terminal beside its own word (§4.1), and there is no prop here that
 * spells it, on any ground.
 *
 * **Motion.** None, and no prop to turn any on.
 *
 * The gap between two cells is the mark's own — `MARK_CELL_GAP`, a pitch less a diameter, read
 * from the two properties `markUnit` and `markPitch` publish. Nothing here knows a pixel, and the
 * run therefore keeps the mark's 26:31 ratio at all three sizes.
 */

/**
 * The glyph at the rule's left end, in the mark's grammar.
 *
 * - `dots` — a short run of individuals. The default.
 * - `capsule` — the mark's fused stadium, for a seam before a section about a *group*.
 * - `none` — a plain hairline that still carries the protocol, for a page that wants the rhythm
 *   without the glyph on every seam. Three ornamented rules in a row is ornament; one is a mark.
 */
export type SectionRuleGlyph = "dots" | "capsule" | "none";

export interface SectionRuleProps {
  /** The ground it is drawn on. `forest` is the landing's band, and nothing else (§9.9). */
  on?: OrnamentGround;
  /** What sits at the left end. Default `dots`. */
  glyph?: SectionRuleGlyph;
  /** How many cells the glyph spans. Default 3 for dots; a capsule is always the mark's 2. */
  count?: number;
  /** The drawn size of a cell: 6 / 10 / 15px. Default `sm` — a section break, not a headline. */
  size?: BrandSize;
  /**
   * Furniture by default, exactly as the `Separator` atom is. Set `false` only where the rule
   * genuinely divides two things a screen reader should be told apart, which emits
   * `role="separator"` instead of hiding the whole element.
   */
  decorative?: boolean;
  className?: string;
  style?: CSSProperties;
}

export const SectionRule = forwardRef<HTMLDivElement, SectionRuleProps>(function SectionRule(
  { on = "paper", glyph = "dots", count = 3, size = "sm", decorative = true, className, style },
  ref,
) {
  const span = Math.max(1, Math.round(count));

  return (
    <div
      ref={ref}
      role={decorative ? undefined : "separator"}
      aria-orientation={decorative ? undefined : "horizontal"}
      aria-hidden={decorative ? true : undefined}
      className={cn(
        // The ground's ink becomes `currentColor` here, which is what the cells below are painted
        // with. Pinning it rather than inheriting it is the difference between a divider that is
        // correct on the forest band and one that happens to be correct because of what is
        // around it.
        "flex w-full items-center [color:var(--orn-ink)]",
        markUnit({ size }),
        markPitch({ size }),
        ornamentGround({ on }),
        className,
      )}
      style={style}
    >
      {glyph === "dots" ? (
        <div className="flex shrink-0 items-center" style={{ gap: MARK_CELL_GAP }}>
          {Array.from({ length: span }, (_, i) => (
            // `tone="current"` paints the cell in whatever ink the ground published, so one
            // drawing is correct on paper and on forest with no branch here: `primary` would be
            // forest on forest, and an explicit ink would need a `dark:` pair per ground.
            <Dot key={i} state="present" tone="current" size={size} />
          ))}
        </div>
      ) : null}

      {glyph === "capsule" ? (
        <Capsule cells={2} orientation="horizontal" state="present" tone="current" size={size} />
      ) : null}

      {/*
        The measure. A 1px line in the ground's own hairline ink — `rule` on paper, the band's
        paper ink at 0.3 on forest, where `rule` is a page-ground token and would be invisible.
        `flex-1` and `min-w-0` are what make the rule the thing that gives way at phone width:
        the cells are `shrink-0`, so the line shortens and the glyph never crushes.
      */}
      <span
        className={cn(
          "h-px min-w-0 flex-1",
          "bg-[var(--orn-rule)] [opacity:var(--orn-rule-a)]",
          glyph === "none" ? "" : "ml-3",
        )}
      />
    </div>
  );
});

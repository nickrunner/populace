import { forwardRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "../cn.js";
import { ornamentGround } from "./LatticeField.js";
import type { OrnamentGround } from "./LatticeField.js";

/**
 * StatFigure — the moment a **marketing** page states a number (DESIGN-SYSTEM §3.3, §4.4, §1.4).
 *
 * A label, the figure, optionally the thing the figure counts *drawn*, and one serif line under
 * it. It is `Stat`'s marketing sibling: the same three-line shape, on a page that is read rather
 * than scanned, with two things `Stat` has no use for — a rule above it, and a slot for the
 * mark-grammar drawing of whatever it is counting.
 *
 * **There is no bigger step, and that is the point.** The temptation on a marketing page is a
 * 96px number over an empty cream field, which is precisely the generated-design tell §1.4 is
 * defined against. The scale has one step for a figure — `t-figure`, 32/36 at weight 500 (§3.3)
 * — and `t-masthead` is the landing headline, once per site. So this figure is `t-figure` on
 * every page, and the emphasis a marketing moment wants comes from **air, a rule and a
 * sentence**, not from a larger number. A number that is loud because it is big is a design; a
 * number that is loud because the page cleared a space for it is an instrument.
 *
 * **Numerals.** Tabular and slashed-zero by construction — every sans step in `theme.css` carries
 * `"tnum" 1, "lnum" 1, "zero" 1`, so the string `tabular-nums` does not appear here and must not
 * (§4.4). A fraction, a duration, a count and a sum all line up down a column of these.
 *
 * **Nothing counts up.** §5.1 forbids an animating number outright, and in a product whose
 * honesty clause is *"outcomes vary between executions"* a figure that spins from 0 to 47 is a
 * lie about precision for half a second. There is no `animate` prop, so there is nothing to
 * reduce under `prefers-reduced-motion`.
 *
 * **The honest-number rule (§7.3, ADR-0028/0030).** A figure on a marketing page is exactly where
 * repeatability gets implied by accident. The `note` exists to say what the number is a
 * measurement *of* — which execution, how many people, over what — and copy that passes through
 * it must never promise the same number next time. *"Twelve people, one execution; nine of them
 * filed something"* is a reading. *"Finds nine, every time"* is a promise this product does not
 * make, and a problem that stops appearing is an absence, not a repair. On a marketing page the
 * number is usually authored rather than counted, and `FigureStrip` is the row that says so.
 *
 * **Why there is no `marked`.** The lime marker band is appearance 1 of five (§5.4) and it is
 * `Text`'s — one spelling, in `atoms/Text.tsx`. The brand layer sits *below* atoms (a `Chip`
 * imports `brand/Dot`, so `brand` may never import an atom), so a `marked` here would be a
 * **second** spelling of the lime treatment, and two spellings of a lime is how a 24×24px budget
 * becomes a page with lime on it. A marketing page's one marked thing is a `Text` in its prose.
 * There is likewise no clay: clay exists only as `Fan`'s `gaveUp` terminal beside its own word.
 *
 * **Both grounds.** Ink through the shared protocol in `LatticeField.js`, so the same figure is
 * correct on paper and on the landing's forest band, flipped in the cascade with no branch here.
 */

export interface StatFigureProps {
  /** The caption above the figure. Sentence content; the type step sets the caps (§3.3). */
  label: string;
  /** The figure. A count, a fraction, a sum, a duration — anything that measures. */
  value: ReactNode;
  /**
   * The thing the figure counts, **drawn**.
   *
   * M4 is not decoration: *any count of people is drawn*, in the mark's grammar, not as a bar. So
   * where this figure counts people, hand it the real component — a `RosterLattice`, a
   * `SeverityStack`, a `CohortCapsule` — rather than a picture of one. A drawing carries the
   * reading before the number resolves, which is what §9.3's *graphic first* asks of a marketing
   * page, and it is also the only version that cannot drift from what the dashboard renders.
   *
   * (This used to cite *artefact before explanation*, §9.4. That rule is **retired** — it put a
   * specimen of this repo's development fixture in front of the reader and then explained it,
   * which is how five marketing pages became technical documentation. §9 was rewritten; the
   * figure comes first, the caption is a line, and no page names a fixture.)
   */
  drawing?: ReactNode;
  /** One serif line under it: what the number is a measurement of. Never a promise (§7.3). */
  note?: ReactNode;
  /** A hairline above the label — §1.4's *"the ground is ruled, not empty"*, as a prop. */
  ruled?: boolean;
  /** The ground it is set on. `forest` is the landing's band, and nothing else (§9.9). */
  on?: OrnamentGround;
  className?: string;
  style?: CSSProperties;
}

export const StatFigure = forwardRef<HTMLElement, StatFigureProps>(function StatFigure(
  { label, value, drawing, note, ruled = false, on = "paper", className, style },
  ref,
) {
  return (
    // `min-w-0` so a long value wraps inside its track instead of widening a grid of these and
    // pushing its neighbours off the row — the same guard `Stat` carries.
    <figure
      ref={ref}
      className={cn("m-0 min-w-0", ornamentGround({ on }), className)}
      style={style}
    >
      {ruled ? (
        <span
          aria-hidden="true"
          className="mb-3 block h-px w-full bg-[var(--orn-rule)] [opacity:var(--orn-rule-a)]"
        />
      ) : null}

      {/*
        These two are DOM siblings on purpose: `theme.css` carries `.t-label + .t-figure {
        margin-top: 6px }`, so a wrapper between them silently deletes the gap (§3.7).
      */}
      <div className="t-label [color:var(--orn-quiet)]">{label}</div>
      <div className="t-figure [color:var(--orn-ink)]">{value}</div>

      {drawing === undefined ? null : <div className="mt-3">{drawing}</div>}

      {note === undefined ? null : (
        <figcaption className="t-read mt-2 max-w-[var(--measure-lede)] [color:var(--orn-soft)]">
          {note}
        </figcaption>
      )}
    </figure>
  );
});

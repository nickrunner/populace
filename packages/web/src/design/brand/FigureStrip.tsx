import { forwardRef, type CSSProperties, type ReactNode } from "react";
import { cva } from "class-variance-authority";

import { cn } from "../cn.js";
import { ornamentGround } from "./LatticeField.js";
import type { OrnamentGround } from "./LatticeField.js";
import { StatFigure } from "./StatFigure.js";

/**
 * FigureStrip — **a row of numbers that cannot pretend to be a measurement** (DESIGN-SYSTEM §4.4,
 * §7.3, §9.6).
 *
 * Two to four figures across, in the display face, tabular by construction, on one hairline. It
 * is the moment a page states scale, and it is `StatFigure`'s row: each cell is the real
 * `StatFigure`, so the label, the step, the numerals and the serif note are the same ones a lone
 * figure elsewhere on the site draws, and a strip and a single figure on one page cannot drift.
 *
 * ---------------------------------------------------------------------------------------------
 * WHERE THE NUMBER CAME FROM IS A REQUIRED PART OF THE COMPONENT, NOT A CAPTION SOMEBODY MIGHT
 * WRITE.
 *
 * `basis` is a discriminated union with two arms and no third. `illustrative` prints the word
 * **Illustrative** at the head of the strip's own rule, in the same column the reader's eye
 * starts in, before it reaches the first figure. `measured` will not compile without a `source`
 * — the execution, the population, the window the figures were counted over — and prints it in
 * the same place.
 *
 * This is structural because the alternative failed in the field: a previous pass at these pages
 * printed authored counts, described them as the result of a real run against a real target, and
 * invited the reader to go and verify them. Nothing in this repo could support them. A figure on
 * a marketing page is exactly where repeatability gets promised by accident, and §7.3 binds a
 * brand surface as hard as it binds the product: outcomes vary between executions **by design**,
 * so a number here is either visibly an example or it names what it is a count of.
 * ---------------------------------------------------------------------------------------------
 *
 * **Nothing counts up, and nothing here is bigger than the scale allows** (§5.1, §3.3). There is
 * one figure step, `t-figure` at 32/36, and the emphasis a strip wants comes from the air around
 * it and the rule above it. A 96px number over an empty field is the generated-design tell §1.4
 * is defined against, and an animating one is a lie about precision for half a second.
 *
 * **Both grounds.** The strip passes `on` through to every figure and paints its own rule and
 * label from the same `--orn-*` protocol, so it is correct on paper and on the landing's one
 * forest band with no branch on the theme anywhere (§9.9).
 */

/**
 * Two, three or four tracks. Written out rather than interpolated: a class Tailwind's scanner
 * never sees in the source is a class that is never generated.
 */
const row = cva("grid gap-x-8 gap-y-10 sm:grid-cols-2", {
  variants: {
    count: {
      two: "",
      three: "lg:grid-cols-3",
      four: "lg:grid-cols-4",
    },
  },
  defaultVariants: { count: "two" },
});

/**
 * What the numbers in this strip are.
 *
 * There is no default arm that means "unstated". A strip whose basis nobody decided is a strip
 * of numbers a reader will take as measurements.
 */
export type FigureBasis =
  | { kind: "illustrative" }
  /** Names what the figures were counted over — "one execution, 12 people, 3 days". */
  | { kind: "measured"; source: string };

/** One figure in the row. The same three parts `StatFigure` takes, because it *is* one. */
export interface FigureStripItem {
  /** A stable key, and the figure's own name — `"people"`, `"findings"`. */
  id: string;
  /** The caption above the number. Sentence content; the type step sets the caps (§3.3). */
  label: string;
  /** The number. A count, a fraction, a sum, a duration — anything that measures. */
  value: ReactNode;
  /** One serif line under it. Optional, and shorter is better: this is a strip, not a section. */
  note?: ReactNode;
}

export interface FigureStripProps {
  /** Two to four. More than four is a table, and a table is not a marketing moment. */
  items: readonly FigureStripItem[];
  /** What these numbers are. Default `illustrative`, because most of them are. */
  basis?: FigureBasis;
  /** The ground it is set on. `forest` is the landing's band, and nothing else (§9.9). */
  on?: OrnamentGround;
  id?: string;
  className?: string;
  style?: CSSProperties;
}

export const FigureStrip = forwardRef<HTMLDivElement, FigureStripProps>(function FigureStrip(
  { items, basis = { kind: "illustrative" }, on = "paper", id, className, style },
  ref,
) {
  const count = items.length >= 4 ? "four" : items.length === 3 ? "three" : "two";
  const word = basis.kind === "measured" ? basis.source : "Illustrative";

  return (
    <div
      ref={ref}
      id={id}
      className={cn("grid gap-6", ornamentGround({ on }), className)}
      style={style}
    >
      {/*
        The rule and the basis are one line, and the basis is at its left end rather than its
        right: this is the one string on the strip a reader must not miss, and the right edge of
        a rule is where a figure's incidental fact lives everywhere else in this system.
      */}
      <div className="grid gap-2">
        <span
          aria-hidden="true"
          className="block h-px w-full bg-[var(--orn-rule)] [opacity:var(--orn-rule-a)]"
        />
        <span className="t-eyebrow [color:var(--orn-quiet)]">{word}</span>
      </div>

      <div className={row({ count })}>
        {items.map((item) => (
          <StatFigure
            key={item.id}
            label={item.label}
            value={item.value}
            note={item.note}
            on={on}
          />
        ))}
      </div>
    </div>
  );
});

import { forwardRef, useId } from "react";
import type { CSSProperties } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../cn.js";
import { MARK_INSET, MARK_PITCH, MARK_R, MARK_RING_R } from "./Ring.js";

/**
 * LatticeField — the mark's modular grid, drawn large and quiet as a **section ground**
 * (DESIGN-SYSTEM §8.6, §1.4, §6).
 *
 * The marketing pages need a ground that is *ruled rather than empty* (§1.4's third defence) and
 * that belongs to this brand rather than to the generated-design house style. The kit's own
 * answer is already sitting in the mark: a lattice at pitch 31 with a dot of 26, fused into
 * stadiums twice. This is that grid, enlarged until it is unmistakably texture rather than data,
 * drawn in outline only, in one ink, at the quietest legible strength — and repeated by an SVG
 * `<pattern>`, so a 2000px band costs the same DOM as a 200px one.
 *
 * **Why it is not the cliché §1.4 disowns.** No gradient, no glow, no blurred blob, no floating
 * shape at a jaunty angle: there is not one diagonal, one arc of varying radius or one soft edge
 * in it, because there is not one in the mark. It is a printed grid on a page, which is what an
 * instrument's ground looks like.
 *
 * ---------------------------------------------------------------------------------------------
 * THIS FILE ALSO HOSTS THE GROUND PROTOCOL THE THREE ORNAMENTS SHARE.
 *
 * `LatticeField`, `SectionRule`, `StatFigure` and `ChainDiagram`'s forest band all have to be
 * correct on **paper and on the landing's forest band**, and "which ink is legal on which ground"
 * is one question with one answer, not four. The two `cva`s below are that answer, published as
 * custom properties exactly as `Ring.js` publishes the mark's drawing protocol — and for the same
 * reason: a ground is a *ground*, never a theme, so the light/dark half of it is a `dark:` utility
 * in the cascade and nothing in TypeScript ever asks which theme it is in.
 *
 *   `ornamentGround`   `--orn-*`, for a shape this folder draws itself
 *   `ornamentSurface`  `--c-*`, for an ordinary atom or organism set down on the band
 *
 * `OrnamentGround` is the one union both take, and it is the one word for the concept: **paper**
 * and **forest**, never "page" or "light".
 * ---------------------------------------------------------------------------------------------
 *
 * **Contrast (§6), stated as a floor rather than as a hope.** Text sits *over* this field, so the
 * field's darkest possible local ground is the only number that matters:
 *
 * - **On paper** the field draws in `--color-rule` and nothing else. `rule` is the system's
 *   decorative hairline (1.37–2.62:1 against the page, and §6 exempts it by name), so the worst
 *   ground a letter can land on is a hairline's own colour — a few percent off the page. Every
 *   §2.2 text pair keeps its floor with room to spare.
 * - **On forest** the field draws in the band's paper ink at **0.12**. Measured: paper on forest
 *   is 8.63:1 and falls to **6.36:1** directly over a stroke; lime on forest is 7.97:1 and falls
 *   to **5.87:1**. Both clear the 4.5:1 text floor, and a non-text mark's 3:1 floor twice over.
 *
 * **Lime is not in this component.** The lime budget is 24×24px per viewport and it belongs to
 * the screen's one marked thing and to the fan's filed terminals (§5.4). A field is the largest
 * surface on the page and therefore the one place lime may never go; there is no prop that spells
 * it. Neither is clay, which exists in this product only as `Fan`'s `gaveUp` terminal beside its
 * own word (§4.1).
 *
 * **Motion.** None, and there is no prop to turn any on. That is the strongest form of respecting
 * `prefers-reduced-motion`: nothing to reduce.
 */

/** The two grounds a marketing ornament may be set on. The product's screens use neither. */
export type OrnamentGround = "paper" | "forest";

/**
 * The ornament ink protocol — seven custom properties, set once per ground.
 *
 * | property | paper | forest |
 * |---|---|---|
 * | `--orn-ink` | `ink` | the band's paper ink |
 * | `--orn-soft` | `ink-soft` | the band's paper ink |
 * | `--orn-quiet` | `ink-muted` | the band's paper ink |
 * | `--orn-rule` | `rule` | the band's paper ink |
 * | `--orn-rule-a` | 1 | 0.3 |
 * | `--orn-field-ink` | `rule` | the band's paper ink |
 * | `--orn-field-a` | 1 | 0.12 |
 *
 * **Why forest collapses three inks into one.** §2.2 and §2.3 measure `ink-soft` and `ink-muted`
 * against the *page*, not against a forest band; on forest the only pairing the system has a
 * measured ratio for is paper-on-forest at 8.63:1. So on the band the three tiers are the same
 * ink and the hierarchy is carried by the type step — which is what §4.7 gives prose anyway
 * ("emphasis is `ink` against `ink-soft`, never colour"), one tier further down.
 *
 * Forest is `primary` in light and `accent` in dark — the same colour under two token names, the
 * spelling the live `Chip` and the landing's band both use (§5.4 appearance 2) — so its ink is
 * `on-primary` / `on-accent` and the flip is two `dark:` utilities.
 */
export const ornamentGround = cva("", {
  variants: {
    on: {
      paper: [
        "[--orn-ink:var(--color-ink)]",
        "[--orn-soft:var(--color-ink-soft)]",
        "[--orn-quiet:var(--color-ink-muted)]",
        "[--orn-rule:var(--color-rule)]",
        "[--orn-rule-a:1]",
        "[--orn-field-ink:var(--color-rule)]",
        "[--orn-field-a:1]",
      ].join(" "),
      forest: [
        "[--orn-ink:var(--color-on-primary)] dark:[--orn-ink:var(--color-on-accent)]",
        "[--orn-soft:var(--color-on-primary)] dark:[--orn-soft:var(--color-on-accent)]",
        "[--orn-quiet:var(--color-on-primary)] dark:[--orn-quiet:var(--color-on-accent)]",
        "[--orn-rule:var(--color-on-primary)] dark:[--orn-rule:var(--color-on-accent)]",
        "[--orn-rule-a:0.3]",
        "[--orn-field-ink:var(--color-on-primary)] dark:[--orn-field-ink:var(--color-on-accent)]",
        "[--orn-field-a:0.12]",
      ].join(" "),
    },
  },
  defaultVariants: { on: "paper" },
});

/**
 * The **surface** half of the ground protocol: the same two grounds, republishing the *system's*
 * own colour tokens rather than the `--orn-*` ornament ones.
 *
 * `ornamentGround` is what a shape drawn by this folder paints itself with. This is what an
 * ordinary atom, molecule or organism paints itself with when it has been set down on the
 * landing's forest band — because `bg-surface`, `text-ink-muted` and `border-rule` all emit
 * `var(--c-*)` rather than a literal (that is what `@theme inline` buys), so republishing five
 * properties on one wrapper makes every component inside it correct at once. No `ground` prop
 * threaded through nine components, and no branch on the theme anywhere.
 *
 * The two are deliberately one pair of variants in one file: *which ink is legal on which ground*
 * is one question, and answering it twice is how the band and the ornaments on it drift apart.
 * A forest band applies **both** — `ornamentSurface` for the components, `ornamentGround` for the
 * marks — and a paper one applies neither and gets the page's own tokens.
 *
 * `--c-mark-ring` goes transparent on forest, and that is the lime law rather than an exception to
 * it (§5.4, appearance 4, amendment): the ring exists because lime on paper is 1.08:1, and lime on
 * forest is 7.97:1 with or without it. The ring's own ink is the brand's ink on the brand's
 * forest, which is invisible there in any case — so the honest drawing is no ring, rather than a
 * ring nobody can see.
 */
export const ornamentSurface = cva("", {
  variants: {
    on: {
      paper: "",
      forest: [
        "[--c-text:var(--c-on-primary)] dark:[--c-text:var(--c-on-accent)]",
        "[--c-text-soft:var(--c-on-primary)] dark:[--c-text-soft:var(--c-on-accent)]",
        "[--c-text-muted:var(--c-on-primary)] dark:[--c-text-muted:var(--c-on-accent)]",
        "[--c-rule:var(--c-on-primary)] dark:[--c-rule:var(--c-on-accent)]",
        "[--c-rule-strong:var(--c-on-primary)] dark:[--c-rule-strong:var(--c-on-accent)]",
        "[--c-mark-ring:transparent]",
      ].join(" "),
    },
  },
  defaultVariants: { on: "paper" },
});

/**
 * The field's drawing space is **the mark's own, at one unit to the pixel**, multiplied by
 * `scale`. No invented constants: a cell is the mark's pitch, a ring is the mark's ring, and the
 * 5-unit gap between two dots is the mark's gap. `scale` is the only number a caller sets, and it
 * is an integer multiple rather than a size token because this is a *texture*, not a roster —
 * the lattice tokens (`--lat-pitch*`, 7/12/18px) are reserved for drawings that carry a count,
 * and a field must never be mistaken for one. At `scale` 2 the pitch is 62px, three and a half
 * times the largest roster pitch in the product.
 */
const CELL = MARK_PITCH;
/** Half a cell: where the dot's centre sits. */
const CELL_CENTRE = MARK_PITCH / 2;
/** The mark is four cells wide and four high; the module motif tiles exactly that. */
const MODULE = 4;

/** A position on the grid, in cells: column then row. */
type Cell = readonly [number, number];

/** The even texture: one ring, in one cell. */
const GRID_DOTS: readonly Cell[] = [[0, 0]];

/**
 * The mark's eight circles, in cells. Seven ink and — at (1,1) — the counter, which in the field
 * is drawn as another ring: the field never renders the lime, so it is the mark's *grid*, not a
 * recoloured lockup. Only `Logo` renders the artwork (DESIGN-SYSTEM §8.1, kit README "Logo
 * rules": do not recolour individual modules).
 */
const MODULE_DOTS: readonly Cell[] = [
  [0, 0],
  [1, 0],
  [2, 0],
  [0, 1],
  [1, 1],
  [0, 2],
  [2, 2],
  [0, 3],
];

/**
 * The mark's two fused stadiums, in cells — horizontal across (2,1)–(3,1), vertical down
 * (1,2)–(1,3).
 *
 * The mark's own are 52 and 40 units long, optically tightened by hand for the letterform. A
 * capsule that has to land on real cell centres cannot be, so these are pitch-true — `26 + 31` —
 * for the same reason `Capsule` is (see its geometry note).
 */
const MODULE_CAPSULES: readonly {
  col: number;
  row: number;
  cols: number;
  rows: number;
}[] = [
  { col: 2, row: 1, cols: 2, rows: 1 },
  { col: 1, row: 2, cols: 1, rows: 2 },
];

/** Which grid the field tiles. */
export type LatticeFieldMotif = "grid" | "module";

/** 1 unit to the pixel, doubled, or tripled. Pitch 31 / 62 / 93px. */
export type LatticeFieldScale = 1 | 2 | 3;

export interface LatticeFieldProps {
  /** The ground it is laid on. `forest` is the landing's band, and nothing else (§9.9). */
  on?: OrnamentGround;
  /**
   * `grid` — one ring per cell, an even texture.
   * `module` — the mark's own four-by-four arrangement, outlines only, which reads as the brand's
   * geometry without being the brand's artwork.
   */
  motif?: LatticeFieldMotif;
  /** Default 2, a 62px pitch: far coarser than any roster, which is how it stays texture. */
  scale?: LatticeFieldScale;
  className?: string;
  style?: CSSProperties;
}

export const LatticeField = forwardRef<HTMLDivElement, LatticeFieldProps>(function LatticeField(
  { on = "paper", motif = "grid", scale = 2, className, style },
  ref,
) {
  // `useId` mints a colon-bearing string; a fragment reference in `fill="url(#…)"` tolerates it,
  // but the same id is a syntax error the day anything selects it in CSS, so the colons go.
  const patternId = `populace-lattice-field-${useId().replace(/:/g, "")}`;
  const tile = (motif === "module" ? MODULE : 1) * CELL * scale;

  return (
    <div
      ref={ref}
      // Decorative, and inert: it is a ground, so it may never eat a press meant for the words
      // above it. `rounded-[inherit]` takes the corner of whatever panel it lines, so a 20px
      // landing panel does not show a square field poking out of its corners.
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]",
        ornamentGround({ on }),
        className,
      )}
      style={style}
    >
      <svg
        className="h-full w-full [opacity:var(--orn-field-a)]"
        shapeRendering="geometricPrecision"
        focusable="false"
        aria-hidden="true"
      >
        <defs>
          <pattern
            id={patternId}
            width={tile}
            height={tile}
            patternUnits="userSpaceOnUse"
            // The mark's grid starts at the box's top-left, so the field lines up with itself
            // across two stacked sections rather than restarting at a seam.
            x={0}
            y={0}
          >
            {(motif === "module" ? MODULE_DOTS : GRID_DOTS).map(([col, row]) => (
              <circle
                key={`d-${col}-${row}`}
                cx={(col * CELL + CELL_CENTRE) * scale}
                cy={(row * CELL + CELL_CENTRE) * scale}
                r={MARK_RING_R * scale}
                className="[fill:none] [stroke:var(--orn-field-ink)] [stroke-width:1px]"
              />
            ))}
            {motif === "module"
              ? MODULE_CAPSULES.map((cap) => {
                  // The stadium's box is the fused dots' box: it starts at the first dot's left
                  // edge and ends at the last dot's right edge, so its ends land on cell centres.
                  const x = cap.col * CELL + MARK_INSET;
                  const y = cap.row * CELL + MARK_INSET;
                  const w = MARK_R * 2 + (cap.cols - 1) * CELL;
                  const h = MARK_R * 2 + (cap.rows - 1) * CELL;
                  return (
                    <rect
                      key={`c-${cap.col}-${cap.row}`}
                      // Inset by half the stroke, so a 1px outline sits inside the 26 dot rather
                      // than straddling its edge — the same 13 → 12 inset every ring here takes.
                      x={(x + 1) * scale}
                      y={(y + 1) * scale}
                      width={(w - 2) * scale}
                      height={(h - 2) * scale}
                      rx={MARK_RING_R * scale}
                      className="[fill:none] [stroke:var(--orn-field-ink)] [stroke-width:1px]"
                    />
                  );
                })
              : null}
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
});

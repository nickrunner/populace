/**
 * The brand layer — the mark-grammar SVG primitives (ATOMIC-INVENTORY §0.1, DESIGN-SYSTEM §8.6).
 *
 * Five shapes, and between them they say everything the product measures:
 *
 *   Dot      one individual, who was there
 *   Ring     one individual, who was not
 *   Capsule  individuals merged into one body — a cohort
 *   Lattice  an ordered set of them — a population
 *   Fan      a set of them exploring — one execution
 *
 * Three **ornaments** are drawn from the same grammar at the size a marketing page needs — a
 * `LatticeField` ground, a `SectionRule` divider, a `StatFigure` — and `diagrams/` assembles the
 * grammar and the product's own components into the eleven explanatory figures — nine that
 * explain the mechanism and two that carry the case for it.
 *
 * It also holds the three **lockups** — `Logo`, `Mark`, `Wordmark` — which are the artwork
 * itself rather than the grammar drawn from it. They live here because this is where the brand
 * is, and because they are the one place in the product that may load a file out of
 * `public/brand/`: a bare `<img src="/brand/…">` anywhere else is a review stop (DESIGN-SYSTEM
 * §8.1, §8.3). What they encode is the kit's rules — which artwork is legal on which ground,
 * the 160px floor below which the lockup becomes the mark, and the circle-diameter of clear
 * space — as constraints a call site cannot spell its way around.
 *
 * Unlike `atoms/index.ts`, this barrel **does** re-export the drawing protocol as well as the
 * components. The grammar is the point of the folder: the viewBox constants, the three size
 * tokens and the `markUnit` / `markPitch` / `markTone` / `markState` fragments are how a shape
 * gets its paint without a compound-variant explosion and without any branch on the theme, and
 * anything that draws in the mark's units needs them. They live in `Ring.js` today; a later wave
 * may lift them into `brand/marks.ts`, and because everything is re-exported by name here, that
 * move costs no call site.
 */

// Ring — the free-standing ring, and the grammar the other four share.
export { Ring } from "./Ring.js";
export type { RingProps, RingWeight, BrandSize, BrandTone } from "./Ring.js";

// The drawing space, in the mark's own units: pitch 31, diameter 26, the 2/7 dashed rhythm.
// `MARK_GAP` and `MARK_CELL_GAP` are the five units between two cells — the second as a CSS
// length, for a flex row of dots; `MARK_INSET` is half that gap, which is what anything laying
// the mark out on its own grid needs. Several components had written their own version of that
// arithmetic before it lived here.
export {
  MARK_VIEWBOX,
  MARK_R,
  MARK_RING_R,
  MARK_PITCH,
  MARK_GAP,
  MARK_INSET,
  MARK_CELL_GAP,
  MARK_DASH,
  MARK_FILL_LAYER,
  MARK_STROKE_LAYER,
} from "./Ring.js";

// The colour and state protocol. Every fill and stroke in the brand resolves through these.
export { markUnit, markPitch, markTone, markState } from "./Ring.js";

// Dot — one individual.
export { Dot } from "./Dot.js";
export type { DotProps, DotTone } from "./Dot.js";

// Capsule — a cohort.
export { Capsule } from "./Capsule.js";
export type { CapsuleProps } from "./Capsule.js";

// Lattice — a population.
export { Lattice } from "./Lattice.js";
export type { LatticeProps, LatticeDot } from "./Lattice.js";

// Fan — a population exploring. `fanNamesItsEnds` is the clay licence (§4.1, §9.3): the fan
// draws its ends' words at `hero` only, and the word is what permits the clay beside it, so
// `ExplorationFan`'s legend asks the same question rather than guessing the route.
export { Fan, fanNamesItsEnds } from "./Fan.js";
export type { FanProps, FanEnd, FanOutcome, FanSize } from "./Fan.js";

// The lockups — the delivered artwork, under the kit's own rules. `Logo` is the general case and
// carries the ground/size/clear-space protocol; `Mark` and `Wordmark` are the two named answers
// to "there is not room for the whole lockup here".
export { Logo, LOCKUP_MIN_WIDTH } from "./Logo.js";
export type { LogoProps, BrandGround, LockupVariant, LockupSize } from "./Logo.js";

export { Mark } from "./Mark.js";
export type { MarkProps } from "./Mark.js";

export { Wordmark } from "./Wordmark.js";
export type { WordmarkProps } from "./Wordmark.js";

// ---------------------------------------------------------------------------------------------
// The ornaments — the grammar at the size a marketing section needs, and the ground protocol
// they share. `OrnamentGround` is the system's one word for the pair a brand surface may sit on:
// **paper** and **forest**, never "page" or "light". `ornamentGround` publishes the `--orn-*`
// properties a shape this layer draws paints itself with; `ornamentSurface` publishes the `--c-*`
// tokens an ordinary atom or organism set down on the forest band paints itself with. Both are
// one pair of variants in one file, because *which ink is legal on which ground* is one question.
// ---------------------------------------------------------------------------------------------

export { LatticeField, ornamentGround, ornamentSurface } from "./LatticeField.js";
export type {
  LatticeFieldProps,
  LatticeFieldMotif,
  LatticeFieldScale,
  OrnamentGround,
} from "./LatticeField.js";

// SectionRule — the brand's own divider, for the seam between two marketing sections. Marketing
// only: the product's dense screens keep the plain `Separator` hairline.
export { SectionRule } from "./SectionRule.js";
export type { SectionRuleProps, SectionRuleGlyph } from "./SectionRule.js";

// StatFigure — `Stat`'s marketing sibling. One step for a figure, and the emphasis comes from
// air, a rule and a sentence rather than from a bigger number.
export { StatFigure } from "./StatFigure.js";
export type { StatFigureProps } from "./StatFigure.js";

// FigureStrip — two to four `StatFigure`s in a row, on one rule, under one word saying what the
// numbers are. `basis` has no arm that means "unstated": a strip is either visibly illustrative
// or it names what it was counted over (§7.3, §9.6).
export { FigureStrip } from "./FigureStrip.js";
export type { FigureStripProps, FigureStripItem, FigureBasis } from "./FigureStrip.js";

// StepStrip — the whole arc in one row of five mark-grammar shapes, for the head of a page that
// used to carry a numbered stack of paragraphs. Paper only, and nothing in it animates.
export { StepStrip, DEFAULT_STEPS } from "./StepStrip.js";
export type { StepStripProps, StepStripItem } from "./StepStrip.js";

// ---------------------------------------------------------------------------------------------
// The explanatory figures. **This export stays last**, and that is load-bearing rather than
// tidy: `diagrams/` is the one part of `brand/` that imports upward into atoms, molecules and
// organisms, several of which import this barrel back. Because every primitive, lockup and
// ornament above is exported before it, every binding that cycle can reach is already
// initialised by the time a diagram module evaluates.
// ---------------------------------------------------------------------------------------------

export * from "./diagrams/index.js";

import { forwardRef, type ReactNode } from "react";
import { cva } from "class-variance-authority";

import { cn } from "../../cn.js";
import { Measure, Spacer, Text } from "../../atoms/index.js";

/**
 * DiagramFigure — **the one frame every diagram in this folder is set in** (DESIGN-SYSTEM §7.3,
 * §9.2, §9.3).
 *
 * ---------------------------------------------------------------------------------------------
 * THIS FILE ALSO HOSTS THE VOCABULARY EVERY DIAGRAM IN THE FOLDER SHARES.
 *
 * They all need one frame, one size union, one detail union and one set of §7.3 sentences. They
 * live here, in the frame, rather than in a tenth file, for the same reason `Ring.tsx` hosts the
 * mark grammar the five primitives share, and a later wave may lift the copy constants into
 * `diagrams/copy.ts` with no change to any call site, because everything below is exported by
 * name.
 *
 * **Two axes, and they are not the same axis.** `size` is *how much room the figure has* and
 * `detail` is *how much of itself it draws*. The two were written as one prop called `size` in
 * three of the figures when this folder was built in parallel, which put `"hero" | "panel"` and
 * `"compact" | "full"` under one word and made a figure's signature unreadable from its call
 * site. They are separated here, permanently: a figure in a narrow rail is `size="panel"`, a
 * figure that drops its prose is `detail="compact"`, and a figure may be either, both or neither.
 * ---------------------------------------------------------------------------------------------
 *
 * **Why these are figures and not illustrations.** They carry the one claim this product has to
 * get right: outcomes vary between executions *by design* (ADR-0028 amendment, ADR-0030), and a
 * problem absent from the newest execution is an **absence, never a repair**. A picture that
 * softens that is worse than no picture, because a diagram is read before the prose beside it and
 * remembered after it. So the frame is built to make the honest reading the structural one: the
 * picture is what a reader sees first, the `<figcaption>` is the mechanism in the product's own
 * voice, and the sentences §7.3 preserves verbatim are constants in this file rather than props,
 * so no call site can pass a gentler one.
 *
 * **The frame is the instrument's, not a brochure's** (§9.2). A name set in `t-eyebrow` on a
 * hairline with a fact at its right edge, a serif deck at the reading measure, the picture at
 * full width, and a serif caption back at the reading measure. Left-aligned throughout, because
 * a centred figure is a brochure and this product is a readout.
 */

/**
 * How much room the figure has. Two, not three: these diagrams compose **real product
 * components** — a real `FindingCard`, a real `Ledger`, a real `SeverityStack` — and a real
 * component has a floor below which it stops being legible. `Fan`'s third size, `inline`, is
 * available to a drawing and not to a figure that contains a finding card.
 *
 * `hero` is a marketing section's full-width figure; `panel` is the same figure inside a screen
 * or a column. Neither is a fixed pixel width: both are fluid and both are laid out for phone
 * width first, with the second column, the ledger stub and the spine arriving at `md`.
 */
export type DiagramSize = "hero" | "panel";

/**
 * How much of itself the figure draws — a **separate axis from `size`**, and never spelled
 * `size` (see the header).
 *
 * `full` draws every sentence the figure has: the per-stage prose, the per-mode explanation, the
 * definition under each link. `compact` keeps the drawing, the names and the numbers and drops
 * the prose, for an aside, a rail or a page that has already said it in its own words. Nothing a
 * figure needs to stay *honest* is behind `full` — §7.3's clause is in the caption, which both
 * detail levels draw.
 */
export type DiagramDetail = "compact" | "full";

/**
 * What a `FindingCard` inside a figure is scaled to, by the room the figure has.
 *
 * `VisitDiagram` and `PipelineDiagram` both end on a real finding card, and both had this table
 * written out locally. It is one number per size and it belongs beside the size union: inside a
 * screen's column the card's 20px finding sentence is not affordable, and at `hero` it is.
 */
export const DIAGRAM_CARD_SCALE = {
  hero: 1,
  panel: 0.8,
} satisfies Record<DiagramSize, 1 | 0.8>;

/**
 * Verbatim from §7.3, and from `ExecutionCompare`'s `INDEPENDENT`, which is the same sentence on
 * the screen that does this for real data. It is duplicated rather than imported because the
 * organism keeps it private, and it is duplicated *here*, once, rather than in each of the three
 * diagrams — a second copy is a drift risk and a fourth would be a certainty.
 */
export const EXECUTIONS_ARE_INDEPENDENT =
  "Executions are independent. Different people do different things, so expect the numbers to move even when nothing about your product changed.";

/** Verbatim from ADR-0028's amendment and from `ExecutionCompare`'s "not reported" group. */
export const AN_ABSENCE_ONLY =
  "An absence, and only an absence. It may be gone, or it may have been described in different words this time.";

/** §7.3's own phrase, kept as it is written there. */
export const NOT_A_REPAIR = "an absence, not a repair";

/**
 * The gap between the four bands. `hero` breathes; `panel` is the instrument's density (§5.3).
 * Both are on the 4px base scale, so neither is a one-off measurement.
 */
const figure = cva("m-0 grid", {
  variants: {
    size: { hero: "gap-6", panel: "gap-4" },
  },
  defaultVariants: { size: "panel" },
});

export interface DiagramFigureProps {
  /** The figure's name, sentence case, set in `t-eyebrow` on the rule (§7.4). */
  name: string;
  /**
   * What the picture shows, in one sentence. Serif, because it is the product saying something
   * rather than naming something (§3.1).
   */
  lede: string;
  /**
   * The fact at the far right of the name's rule — "4 problems, 3 reported in both". **A fact,
   * never an instruction** (§7.4): it is read alongside the name as one line, and prose sitting
   * where every other figure shows a number is read as a number and found to be prose.
   */
  trailing?: ReactNode;
  /**
   * Whether the figure is drawing its own authored example rather than a caller's real data.
   *
   * **It prints the word `illustrative` on the rule, and that is the point** (§9.6). Every
   * figure in this folder ships a default dataset so it can stand alone on a public page, and a
   * default dataset is an example — a plausible tool list, a plausible pair of searches, a
   * plausible headcount. None of it is a measurement, and a figure that looks like a readout is
   * read as one unless it says otherwise. Each figure computes this from whether its data props
   * were passed, so the marker disappears exactly when the numbers become real.
   */
  sample?: boolean;
  size?: DiagramSize;
  id?: string;
  /** The picture. Full width — it is the thing the figure is for. */
  children: ReactNode;
  /**
   * The mechanism, after the picture, in the product's voice. Callers pass set `Text`, because a
   * caption is frequently two paragraphs and the second is usually the §7.3 clause.
   *
   * `null` draws no `<figcaption>` at all, for a page that carries the mechanism in its own prose
   * beside the figure. It is the only way to have none: there is no default, because a default
   * caption is a sentence nobody wrote.
   */
  caption: ReactNode;
  className?: string;
}

export const DiagramFigure = forwardRef<HTMLElement, DiagramFigureProps>(function DiagramFigure(
  { name, lede, trailing, sample = false, size = "panel", id, children, caption, className },
  ref,
) {
  return (
    <figure ref={ref} id={id} className={cn(figure({ size }), className)}>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-rule pb-1.5">
          <Text size="eyebrow" tone="muted">
            {name}
          </Text>
          <Spacer />
          {/*
            The word, before the number it qualifies. A count sitting alone at the right edge of
            a figure is read as a measurement, so where the figure is drawing its own example the
            word that says so is the last thing read before it.
          */}
          {sample ? (
            <Text size="label" tone="muted">
              illustrative
            </Text>
          ) : null}
          {trailing === undefined ? null : (
            <Text size="meta" tone="muted">
              {trailing}
            </Text>
          )}
        </div>
        <Measure width="read" as="div">
          <Text as="p" size={size === "hero" ? "lede" : "read"} tone="soft">
            {lede}
          </Text>
        </Measure>
      </div>

      {children}

      {caption === null || caption === undefined ? null : (
        <figcaption>
          <Measure width="read" as="div">
            {caption}
          </Measure>
        </figcaption>
      )}
    </figure>
  );
});

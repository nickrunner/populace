import { forwardRef } from "react";
import { cva } from "class-variance-authority";

import { cn } from "../../cn.js";
import { Icon, Text } from "../../atoms/index.js";

/**
 * DiagramFlow — the connector between two things inside a figure (DESIGN-SYSTEM §8.6, §1.2 M2).
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THE `diagrams/` FOLDER IS, AND WHY IT SITS UNDER `brand/`
 *
 * The diagrams are **explanations**, not ornament. §9.3 is the rule they exist to satisfy: on the
 * public pages **a graphic comes first, a short caption under it, and only then any prose**, and a
 * section that needs more than a blurb after its caption has not found its picture yet. So a
 * reader must be able to take the mechanism off the figure alone — which is also why, where a
 * diagram can render the real component, it renders the real component. The refs in `VisitDiagram`
 * are real `CallRef`s, the reproduction steps in `EvidenceDiagram` are real `EvidenceSteps`, and
 * the clustered result in `PipelineDiagram` is a real `FindingCard` taking the props the results
 * screen hands it. Nothing here is a drawing of a component.
 *
 * The earlier rule this replaces — *artefact before explanation*, which put a specimen first and
 * a page of prose after it — is retired along with the §9 it came from. The figures carry the
 * explanation now; the prose beside them is a caption.
 *
 * That makes these files the one place in `brand/` that **imports upward** — into atoms,
 * molecules and organisms — and it is deliberate. They live here because a figure is the mark's
 * grammar doing explanatory work: the population is a `Lattice`, the cohort is a `Capsule`, the
 * person is a `Dot`, the call that got no ref is a `Ring`, the execution is a `Fan`. A figure
 * assembled out of `<rect>`s would have invented a second visual language for the one subject
 * the brand already has words for.
 *
 * The import direction is safe because `brand/index.ts` exports the five primitives and the
 * three lockups **before** it exports anything from this folder: by the time a diagram module
 * evaluates, every binding a cycle could reach is already initialised.
 *
 * **The frame and the size union live in `Figure.js`**, not here. `DiagramFigure` is the one
 * frame every diagram in this folder is set in, and `DiagramSize` is its union; a second frame
 * and a second size vocabulary in the same folder is how a system ends up with two of everything.
 * This file adds the one thing the frame does not have: a connector.
 *
 * ---------------------------------------------------------------------------------------------
 *
 * **There are no arrowheads, because the brand has no diagonals** (§8.6). Direction is carried by
 * the one sequential device the system already sanctions: the `chevron-right` utility glyph, the
 * same one the landing's project → simulation → … chain is set with. It is a tier-2 glyph, so it
 * carries affordance and never meaning, and the headings on either side say the sequence in
 * words. It is `aria-hidden`, because the reading order already carries the direction and a
 * screen reader announcing "chevron" between two stages is noise.
 *
 * **The flow turns the corner rather than shrinking.** A `responsive` connector sits between two
 * things that are side by side at `md` and stacked below it, so it is a vertical hairline under a
 * `chevron-down` on a phone and a horizontal one beside a `chevron-right` above it. Two glyphs,
 * no rotation — the kit draws both, and a rotated chevron is a diagonal by another name. A
 * `vertical` connector is for two full-measure stages, which are stacked at every width.
 */

/**
 * Which way the connector runs.
 *
 * `responsive` turns the corner with the layout it sits inside. `vertical` is for two
 * full-measure blocks, where a horizontal connector would point at nothing.
 */
export type DiagramFlowOrientation = "responsive" | "vertical";

const flow = cva("flex shrink-0 items-center justify-center", {
  variants: {
    orientation: {
      responsive: "flex-col gap-1 py-2 md:flex-row md:gap-2 md:px-3 md:py-0",
      vertical: "flex-col gap-1 py-1",
    },
  },
  defaultVariants: { orientation: "responsive" },
});

/**
 * A hairline in the boundary colour, not in a person's. `rule-strong` rather than `rule` because
 * this is the line a reader is asked to follow across a figure, and §2.6 gives the plain hairline
 * to dividers and the 3:1 token to anything the eye has to track.
 */
const line = cva("block bg-rule-strong", {
  variants: {
    orientation: {
      responsive: "h-4 w-px md:h-px md:w-6",
      vertical: "h-4 w-px",
    },
  },
  defaultVariants: { orientation: "responsive" },
});

export interface DiagramFlowProps {
  /**
   * What happens along the connector — "resolved into", "keyed by signature". Set in `t-label`,
   * which is one of §3.3's four tracked-out-caps roles: it labels a relationship in a figure the
   * same way a stat label labels a number.
   */
  label?: string;
  orientation?: DiagramFlowOrientation;
  className?: string;
}

export const DiagramFlow = forwardRef<HTMLDivElement, DiagramFlowProps>(function DiagramFlow(
  { label, orientation = "responsive", className },
  ref,
) {
  return (
    <div ref={ref} className={cn(flow({ orientation }), className)}>
      <span aria-hidden="true" className={line({ orientation })} />
      <Icon
        name="chevron-down"
        size={12}
        className={cn("text-ink-muted", orientation === "responsive" ? "md:hidden" : "")}
      />
      {orientation === "responsive" ? (
        <Icon name="chevron-right" size={12} className="hidden text-ink-muted md:inline-block" />
      ) : null}
      {label === undefined ? null : (
        <Text size="label" tone="muted">
          {label}
        </Text>
      )}
    </div>
  );
});

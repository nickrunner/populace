/**
 * The explanatory figures — `brand/diagrams/` (DESIGN-SYSTEM §7.3, §9.4; ATOMIC-INVENTORY §0.1).
 *
 * Eleven figures and the five parts they are assembled from — nine that explain the mechanism,
 * and two at the foot that carry the case for it. A figure is the mark's grammar doing
 * **explanatory** work: the population is a `Lattice`, the cohort a `Capsule`, the person a `Dot`,
 * the call that got no ref a `Ring`, the execution a `Fan`. That is why they live under `brand/`
 * rather than beside the organisms, and it is also why this is the one folder in `brand/` that
 * imports *upward* — where a figure can render the real component, it renders the real component,
 * so nothing here is a drawing of a `FindingCard` and nothing here can drift from the screen it
 * explains.
 *
 * **The import direction is safe, and the order below is what makes it so.** `brand/index.ts`
 * exports the five primitives and the three lockups **before** it exports this barrel, so by the
 * time a diagram module evaluates, every binding a cycle could reach through `atoms`, `molecules`
 * or `organisms` is already initialised. Keep this barrel last there, and keep the parts before
 * the figures here.
 *
 * A twelfth graphic, `StepStrip`, sits one level up in `brand/` rather than here: it is the whole
 * arc as five mark-grammar glyphs and a caption each, with no frame, no caption band and no data
 * props, so it is an ornament at page-head scale rather than a figure.
 *
 * ---------------------------------------------------------------------------------------------
 * THE TWO AXES, WHICH ARE NOT ONE AXIS
 *
 *   `size`    `"hero" | "panel"`      how much room the figure has
 *   `detail`  `"compact" | "full"`    how much of itself it draws
 *
 * Three of them shipped with both concepts under one prop called `size`. They are separated
 * permanently: every figure takes `size`, `id` and `className`, the ones with a prose tier take
 * `detail`, and no figure spells either concept a third way.
 * ---------------------------------------------------------------------------------------------
 *
 * **What every figure owes, and none of them may spend.** A figure is read before the prose
 * beside it and remembered after it, so §7.3 binds these harder than it binds a paragraph:
 * outcomes vary between executions **by design** (ADR-0028 amendment, ADR-0030), and a problem
 * absent from the newest execution is an **absence, never a repair**. The sentences that say so
 * are constants in `Figure.js` rather than props, so no call site can pass a gentler one.
 */

// ---------------------------------------------------------------------------------------------
// The parts. The frame, the connector, the legend, the sentence and the stage.
// ---------------------------------------------------------------------------------------------

/**
 * The one frame, the two unions, the card-scale table and the three §7.3 sentences. Everything
 * in this folder is set in `DiagramFigure`; nothing rolls its own `<figure>`.
 */
export { DiagramFigure, DIAGRAM_CARD_SCALE } from "./Figure.js";
export type { DiagramFigureProps, DiagramSize, DiagramDetail } from "./Figure.js";

/** The §7.3 clauses, preserved verbatim so a caption cannot quietly soften one. */
export {
  EXECUTIONS_ARE_INDEPENDENT,
  AN_ABSENCE_ONLY,
  NOT_A_REPAIR,
} from "./Figure.js";

/** The connector between two things inside a figure. No arrowheads — the brand has no diagonals. */
export { DiagramFlow } from "./DiagramFlow.js";
export type { DiagramFlowProps, DiagramFlowOrientation } from "./DiagramFlow.js";

/** The legend that keys a figure's shapes to its words — what makes a figure read in greyscale. */
export { DiagramKey } from "./DiagramKey.js";
export type { DiagramKeyProps, DiagramKeyItem } from "./DiagramKey.js";

/** The explaining sentence: serif, reading measure, `ink-soft`. The product speaking. */
export { DiagramSays } from "./DiagramSays.js";
export type { DiagramSaysProps } from "./DiagramSays.js";

/** One numbered step: a `LedgerRow` with `n`, a plain `<section>` without. */
export { DiagramStage } from "./DiagramStage.js";
export type { DiagramStageProps } from "./DiagramStage.js";

// ---------------------------------------------------------------------------------------------
// The figures. Four that explain the model, two that explain the mechanism, three that keep the
// product honest about what it does and does not claim.
// ---------------------------------------------------------------------------------------------

/** The model — project → simulation → population → cohort → person → visit → finding. */
export { ChainDiagram, CHAIN_LINKS } from "./ChainDiagram.js";
export type { ChainDiagramProps, ChainLink } from "./ChainDiagram.js";

/** The model — a person, a cohort, a population, drawn out of the same people. */
export { CompositionDiagram } from "./CompositionDiagram.js";
export type { CompositionDiagramProps, CompositionCohort } from "./CompositionDiagram.js";

/** The model — one person across executions, and what ephemeral and longitudinal actually differ in. */
export { PersonDiagram } from "./PersonDiagram.js";
export type { PersonDiagramProps, PersonDiagramMode } from "./PersonDiagram.js";

/** The mechanism — one visit end to end: two toolsets, numbered results, a finding that cites them. */
export { VisitDiagram } from "./VisitDiagram.js";
export type { VisitDiagramProps } from "./VisitDiagram.js";

/** The mechanism — how a call ref becomes a stored record and then a judge's replay. */
export { EvidenceDiagram } from "./EvidenceDiagram.js";
export type { EvidenceDiagramProps } from "./EvidenceDiagram.js";

/** The mechanism — findings, verified, clustered by signature, read as a digest. */
export { PipelineDiagram } from "./PipelineDiagram.js";
export type { PipelineDiagramProps, PipelineReport } from "./PipelineDiagram.js";

/** The honesty — one simulation sent in twice, overlapping and different. */
export { VarianceDiagram } from "./VarianceDiagram.js";
export type { VarianceDiagramProps, VarianceProblem } from "./VarianceDiagram.js";

/** The honesty — a problem that stops being reported is an absence, and never a repair. */
export { AbsenceDiagram } from "./AbsenceDiagram.js";
export type { AbsenceDiagramProps } from "./AbsenceDiagram.js";

/** The honesty — what the population reached, what it did not, and why that moves. */
export { CoverageDiagram } from "./CoverageDiagram.js";
export type { CoverageDiagramProps, CoverageTool } from "./CoverageDiagram.js";

// ---------------------------------------------------------------------------------------------
// The two arguments. Where the nine above explain the MECHANISM, these two carry the CASE — the
// thing a reader has to agree with before the mechanism is worth their attention. They are
// deliberately the least wordy figures in the folder: each one lands in a glance, each one
// defaults to no caption at all, and each one carries the word *illustrative* where the others
// carry a fact, because nothing drawn in them is a measurement of anything (§9.3, §9.6).
// ---------------------------------------------------------------------------------------------

/** The case — one surface drawn twice: the path a suite asserts, and where a population went. */
export { ReachDiagram } from "./ReachDiagram.js";
export type { ReachDiagramProps } from "./ReachDiagram.js";

/** The case — the tool exists, the assertions pass, and nobody found it. */
export { GapDiagram } from "./GapDiagram.js";
export type { GapDiagramProps } from "./GapDiagram.js";

/**
 * The organism layer — ATOMIC-INVENTORY §3, in the inventory's own order.
 *
 * Product-shaped. Unlike the two layers beneath it, everything here knows what a finding, a
 * cohort, an execution or a visit is, and several take a contract view type straight off the wire
 * — `ClusterCardView`, `ExecutionHistoryEntry`, `TriageView`, `ToolCallRecord`, `Verification` —
 * rather than restating its shape (§0.2).
 *
 * **Organism 32 is not here.** `Sidebar`, `ProjectSwitcher`, `SpendMeter` and `TargetStatus` are
 * the shell, and the shell lands with `AppShell` in the template wave; every other organism in
 * §3 is exported below. That is 33 files and 32 numbered rows, because row 4 is two components in
 * one file (`Ledger` and `LedgerRow`) and row 11 is two as well (`Toast` and the `ToastRegion`
 * that `AppShell` mounts once) — and because row 34, `ExecutionPicker`, is the row §3's table
 * forgot and the port review put back.
 *
 * **What this barrel does not export**, exactly as `atoms/index.ts` and `molecules/index.ts` do
 * not: the CVA factories. A component's class string is not a public interface — `asChild` is the
 * sanctioned way for a `<Link>` to be a card or a chip (§0.2), and an exported class string is
 * the thing that stops being true.
 *
 * **Three non-component exports earn their place.** The roster ladder
 * (`rosterScale` / `foldRoster` / `rosterPresent` and its two thresholds) is the single answer to
 * "what does one dot mean here" — `CohortCapsule` and `ExecutionCompare` already fold by it, and a
 * screen that drew a lattice by a second rule would put two scales on one page (§1.2 M4).
 * `transcriptOptionId` is the one spelling of a step's DOM id, which the list and anything
 * scrolling to a step both have to agree on. And `CardVariants` is a description of the API
 * rather than a second way to spell it.
 */

// 1 — Card
export { Card, CardHeader, CardFooter } from "./Card.js";
export type {
  CardProps,
  CardHeaderProps,
  CardFooterProps,
  CardPad,
  CardLevel,
  CardTone,
  CardVariants,
} from "./Card.js";

// 2 — Section
export { Section } from "./Section.js";
export type { SectionProps } from "./Section.js";

// 3 — PageHeader
export { PageHeader } from "./PageHeader.js";
export type { PageHeaderProps } from "./PageHeader.js";

// 4 — Ledger / LedgerRow. THE SIGNATURE MOVE (§1.2 M2).
export { Ledger, LedgerRow } from "./Ledger.js";
// `LedgerStubKind` is published because it is in the public props of `Ledger`, `LedgerRow` AND
// `DataTable` — a screen holding its rows' stub kind in a variable needs the union by name. The
// geometry (`LEDGER_GRID`, `LEDGER_STUB`, `LedgerSpine`) stays unexported, as a class string:
// what a stub is SET IN is a decision this file makes, not one a screen re-spells.
export type { LedgerProps, LedgerRowProps, LedgerStubKind } from "./Ledger.js";

// 5 — DataTable
export { DataTable } from "./DataTable.js";
// `SortableColumn` travels with `Column`: a screen that declares its columns in a variable
// rather than inline needs the sortable shape by name, and without it the sort branch of
// `DataTableProps` is unreachable from outside the module.
export type {
  DataTableProps,
  Column,
  SortableColumn,
  SortState,
  SortDirection,
} from "./DataTable.js";

// 6 — Dialog
export { Dialog } from "./Dialog.js";
export type { DialogProps } from "./Dialog.js";

// 7 — AlertDialog
export { AlertDialog } from "./AlertDialog.js";
export type { AlertDialogProps } from "./AlertDialog.js";

// 8 — DropdownMenu
export { DropdownMenu } from "./DropdownMenu.js";
export type { DropdownMenuProps, DropdownMenuItem } from "./DropdownMenu.js";

// 9 — Popover
export { Popover } from "./Popover.js";
export type { PopoverProps } from "./Popover.js";

// 10 — Tabs
export { Tabs } from "./Tabs.js";
export type { TabsProps, TabItem } from "./Tabs.js";

// 11 — Toast, and the region `AppShell` mounts once.
export { Toast, ToastRegion } from "./Toast.js";
export type { ToastProps, ToastRegionProps } from "./Toast.js";

// 12 — RosterLattice, and the degradation ladder every other drawing of people folds by.
export { RosterLattice } from "./RosterLattice.js";
export type { RosterLatticeProps, LatticeDot, RosterScale } from "./RosterLattice.js";
export {
  rosterScale,
  rosterPresent,
  foldRoster,
  ROSTER_ONE_TO_ONE_MAX,
  ROSTER_PEOPLE_PER_BLOCK,
  ROSTER_BLOCK_MAX,
} from "./RosterLattice.js";

// 13 — CohortCapsule
export { CohortCapsule } from "./CohortCapsule.js";
export type { CohortCapsuleProps } from "./CohortCapsule.js";

// 14 — AvatarGroup
export { AvatarGroup } from "./AvatarGroup.js";
export type { AvatarGroupProps } from "./AvatarGroup.js";

// 15 — PayloadBlock. The one spelling of the evidence well (§4.3).
export { PayloadBlock } from "./PayloadBlock.js";
export type { PayloadBlockProps } from "./PayloadBlock.js";

// 16 — ToolCallBlock
export { ToolCallBlock } from "./ToolCallBlock.js";
export type { ToolCallBlockProps } from "./ToolCallBlock.js";

// 17 — EvidenceSteps
export { EvidenceSteps } from "./EvidenceSteps.js";
export type { EvidenceStepsProps } from "./EvidenceSteps.js";

// 18 — CitedAsEvidence
export { CitedAsEvidence } from "./CitedAsEvidence.js";
export type { CitedAsEvidenceProps, CitedFinding } from "./CitedAsEvidence.js";

// 19 — ReplayVerdict
export { ReplayVerdict } from "./ReplayVerdict.js";
export type { ReplayVerdictProps } from "./ReplayVerdict.js";

// 20 — TriageForm
export { TriageForm } from "./TriageForm.js";
export type { TriageFormProps } from "./TriageForm.js";

// 21 — ClusterRow
export { ClusterRow } from "./ClusterRow.js";
export type { ClusterRowProps } from "./ClusterRow.js";

// 22 — IncidenceBars
export { IncidenceBars } from "./IncidenceBars.js";
export type { IncidenceBarsProps, CohortIncidence } from "./IncidenceBars.js";

// 23 — FindingCard
export { FindingCard } from "./FindingCard.js";
export type { FindingCardProps, FindingQuote } from "./FindingCard.js";

// 24 — PersonQuoteCard
export { PersonQuoteCard } from "./PersonQuoteCard.js";
export type { PersonQuoteCardProps } from "./PersonQuoteCard.js";

// 25 — TranscriptList
export { TranscriptList } from "./TranscriptList.js";
export type { TranscriptListProps } from "./TranscriptList.js";

// 26 — TranscriptRow, and the id the list and anything scrolling to a step both agree on.
export { TranscriptRow, transcriptOptionId } from "./TranscriptRow.js";
export type { TranscriptRowProps, TranscriptStep, TranscriptKind } from "./TranscriptRow.js";

// 27 — TranscriptDetail
export { TranscriptDetail } from "./TranscriptDetail.js";
export type { TranscriptDetailProps } from "./TranscriptDetail.js";

// 28 — LiveActivityFeed
export { LiveActivityFeed } from "./LiveActivityFeed.js";
export type { LiveActivityFeedProps, FeedEvent, FeedEventKind } from "./LiveActivityFeed.js";

// 29 — PersonLiveCard
export { PersonLiveCard } from "./PersonLiveCard.js";
export type { PersonLiveCardProps, PersonLiveState } from "./PersonLiveCard.js";

// 30 — ExecutionRow
export { ExecutionRow } from "./ExecutionRow.js";
export type { ExecutionRowProps } from "./ExecutionRow.js";

// 31 — ExecutionCompare. The paired lattice: an absence drawn rather than described (§7.3).
export { ExecutionCompare } from "./ExecutionCompare.js";
export type { ExecutionCompareProps } from "./ExecutionCompare.js";

// 32 — Sidebar / ProjectSwitcher / SpendMeter / TargetStatus land with `AppShell`.

// 34 — ExecutionPicker. Named as a principal organism on §5 page 20 and left out of §3's table,
// so the port hand-rolled it inside `Executions` and `Compare` was about to write it again. §3
// now numbers it; this is the one copy of the a≠b guard.
export { ExecutionPicker } from "./ExecutionPicker.js";
export type { ExecutionPickerProps } from "./ExecutionPicker.js";

// 33 — ExplorationFan
export { ExplorationFan } from "./ExplorationFan.js";
export type { ExplorationFanProps } from "./ExplorationFan.js";

/**
 * Two organisms §3's table never numbered, and the port proved both by their absence.
 *
 * `CostEstimate` is named as a principal organism on four pages (§5 rows 4, 5, 6 and 12) and
 * called out twice by number in the port plan — "the third `CostEstimate`", "the fourth" — and
 * four screens hand-rolled it, with three phrasings of the basis sentence between them.
 * `JobProgress` is named on two (§5 rows 12 and 13) and §6.3 row 18 says the two implementations
 * unify; they did not, and they had already drifted. Both live here because both know what a
 * visit and a cohort are, which is what makes a thing an organism.
 *
 * `costBasisOf` and `visitPlanOf` travel with the component for the same reason `rosterScale`
 * travels with `RosterLattice`: they are the single translation of `RunEstimate`'s wire names
 * into the words the UI speaks, and a screen that wrote its own would put "wake" back in a
 * variable a reader can see.
 */
export { CostEstimate, costBasisOf, visitPlanOf } from "./CostEstimate.js";
export type { CostEstimateProps, CostBasis, VisitPlan } from "./CostEstimate.js";

export { JobProgress } from "./JobProgress.js";
export type { JobProgressProps } from "./JobProgress.js";

/**
 * The run controls, which §5's "shared non-route components" calls an organism with two sites
 * and which §3's table never numbered. It lives here because it lands *inside* the screens: the
 * legacy version drew its primary button as `bg-accent text-white border-accent`, and "Send them
 * in" rendered white on lime at 1.22:1 on `ProjectHome`.
 *
 * It is the one thing in `design/` that owns its own mutations; the note in the module says why.
 */
export { SimulationActions } from "./SimulationActions.js";
export type { SimulationActionsProps } from "./SimulationActions.js";

/**
 * WhatWentWrong — added by the port review (S4.26). A failed mutation, said in the product's
 * voice with the machine's own words quoted in the well beneath (§7.4). It was a local helper on
 * one screen while four others dumped a raw `error.message` into a `FieldError`; it is an
 * organism because the well is one — there is one well in the product, not three (§4.3).
 */
export { WhatWentWrong } from "./WhatWentWrong.js";
export type { WhatWentWrongProps } from "./WhatWentWrong.js";

/**
 * The target and persona editors' own organisms — §5 pages 9 and 11, §6.3 rows 22 and 23.
 *
 * `ToolPolicyEditor` is the one that pays: the same merge rule was implemented twice, and the two
 * implementations disagreed about whether a persona's globs are matched against the target's
 * policy underneath them. One of those two was honest about what a person can actually reach.
 * `ConnectionStatusBar` is the four renderings of connection state that screen carried, said once
 * and always with a word. `FirstContactPanel` is the check that costs nothing, and `SamplePreview`
 * is a spec's draws shown rather than described.
 */
export { ToolPolicyEditor } from "./ToolPolicyEditor.js";
export type { ToolPolicyEditorProps, PolicyTool } from "./ToolPolicyEditor.js";

export { ConnectionStatusBar } from "./ConnectionStatusBar.js";
export type { ConnectionStatusBarProps } from "./ConnectionStatusBar.js";

export { FirstContactPanel, OUTCOME_WORDS, OUTCOME_TONES } from "./FirstContactPanel.js";
// The pairings grid — targets down, populations across. Named for what a cell IS, because
// "coverage" already means tool coverage one click down (`Gaps`).
export { PairingsGrid } from "./PairingsGrid.js";
export type { PairingsGridProps, PairingAxis } from "./PairingsGrid.js";
export type { FirstContactPanelProps } from "./FirstContactPanel.js";

export { SamplePreview } from "./SamplePreview.js";
export type { SamplePreviewProps } from "./SamplePreview.js";

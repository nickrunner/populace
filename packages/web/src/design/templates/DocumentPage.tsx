import { forwardRef, type ReactNode } from "react";

import { cn } from "../cn.js";
import type { StateKind } from "../tokens.js";

/**
 * DocumentPage — ATOMIC-INVENTORY §4, template 2. Twelve screens.
 *
 * **The document half of the direction's central structural idea** (DESIGN-SYSTEM §1.2, §5.3).
 * A document-class screen is a *reading column*: one measure wide, left-aligned, with the ledger
 * stub running down its left edge and the numbers moved out to a 264px instrument rail at
 * ≥1240px. Its opposite number is `InstrumentPage`, which is full bleed, has no reading measure
 * and packs 32px rows. The two are not a class name apart — they are different widths, different
 * vertical rhythms and, in this one, a whole extra column.
 *
 * Four things it owns, and nothing else. It never fetches, never names a product noun and never
 * hard-codes a screen's content.
 *
 * **1. `--w-page`, and the column inside it.** The page frame is 1100px. The document column is
 * *not*: it is `--w-stub` + the 3px selection gutter + `--measure-read`, which is the exact width
 * a `Ledger` occupies when its stub is full and its content column is at the reading measure. A
 * screen therefore cannot accidentally set a 1100px-wide sentence, and a `Ledger` dropped into
 * the content lands with its spine already in the right place.
 *
 * **2. The 72px stub grid.** The column's width is derived from `--w-stub`, so every ledger,
 * transcript and finding list inside it aligns its stub to the same left edge as every other one
 * on the screen. The template does not draw the stub itself — `Ledger` and `DataTable` do, and
 * they collapse it below `--breakpoint-md` on their own. What the template guarantees is that
 * there is room for it and that everything shares one.
 *
 * **3. `--measure-read`.** The `ch` unit is a property of the *face*, and it resolves here
 * against the column's own chrome sans rather than against the serif that will set the prose.
 * §3.6 measures the serif at ~11% more characters per line, so the column carries the reading
 * measure's width *in the serif's own `ch`* — otherwise the column would clip `Measure
 * width="read"` by about 8% and the atom would quietly become a no-op.
 *
 * **4. The instrument rail.** One DOM node, two placements, no branch in TypeScript: a two-column
 * grid of blocks beneath the content below 1240px, a 264px sticky column beside it at or above
 * (§5.3). Rendering it twice would duplicate every id in it and announce every number twice.
 *
 * **AMENDED — a page with no rail centres its column, because the frame is sized for the rail.**
 *
 * `--w-page` is 1100px and that number is not arbitrary: it is the document column (648px) plus
 * the 48px gap plus the 264px instrument rail plus the gutter pair. It is the width of the
 * two-column layout. But `rail` is optional and **exactly one screen in the product passes one**
 * — `SimulationResults`. Everywhere else the frame was reserving 312px for a column that never
 * rendered, and since the document column is left-aligned inside it, all 312px of that reserve
 * piled up on the right: on a 1605px `<main>` the content's optical centre sat 201px left of the
 * window's. It read as a page pushed into the corner, which is exactly what it was.
 *
 * So the column takes `mx-auto` when there is no rail beside it. The frame keeps its 1100px — the
 * cap is still right for the layout it describes — and the column simply sits in the middle of it
 * rather than at one end, which puts it in the middle of the window at every width. **With** a
 * rail nothing moves at all: the two columns fill the frame and `mx-auto` would have nothing to
 * distribute.
 *
 * What this does NOT do is widen anything. The reading measure is the measure (note 3); a screen
 * that wants the whole 1605px is an instrument, and `InstrumentPage` is the template for it.
 *
 * The state slot is the fifth thing, and it is shared with the other four page templates — see
 * `pageStateSlot` below.
 */

/**
 * The four moments a screen has nothing to draw yet (§6, ATOMIC-INVENTORY §4).
 *
 * A screen hands a `StateBlock` to the matching slot rather than branching around its own layout,
 * so the page frame, the header and the rail stay mounted while the body is a sentence. That is
 * what stops a screen collapsing to 40px and jumping back when the query lands.
 *
 * **The slot for `failed` is called `error`.** The inventory's `PageStateSlots` spells it that
 * way while `StateKind` spells the state `failed`; both are reproduced verbatim and `pageStateSlot`
 * is the one place the two names are reconciled.
 */
export interface PageStateSlots {
  loading?: ReactNode;
  error?: ReactNode;
  empty?: ReactNode;
  gone?: ReactNode;
}

/**
 * The slot matching a state, or `null`.
 *
 * Callers test `state === undefined` themselves rather than treating `null` as "no state",
 * because a state that is set but whose slot a screen did not supply must still render *instead
 * of* the children — silently falling back to the content would put a half-loaded screen in front
 * of a reader.
 */
export function pageStateSlot(state: StateKind, slots: PageStateSlots): ReactNode {
  switch (state) {
    case "loading":
      return slots.loading ?? null;
    case "failed":
      return slots.error ?? null;
    case "empty":
      return slots.empty ?? null;
    case "gone":
      return slots.gone ?? null;
  }
}

/**
 * The page frame every `/app` template shares: centred in whatever `AppShell`'s `<main>` gives
 * it, capped at the app content measure, with the one gutter pair in the system. `AppShell` owns
 * the scrolling and the rail; the gutters and the cap are the template's.
 */
export const PAGE_FRAME = "mx-auto w-full max-w-[var(--w-page)] px-4 md:px-8";

/**
 * The reading column. See note 1 and note 3 above for both halves of the arithmetic; the `1.11`
 * is §3.6's measured ratio between the two families' `ch`, not a number chosen by eye.
 */
const DOCUMENT_COLUMN = [
  "w-full min-w-0 flex-1",
  "max-w-[calc(var(--w-stub)+3px+var(--measure-read)*1.11)]",
].join(" ");

/**
 * Railless, the column centres itself in the frame — see the amendment in note 4. It is `mx-auto`
 * and not a change to the frame's cap because the two are equivalent wherever the cap binds, and
 * this way `--w-page` goes on meaning the one thing it has always meant: the width of a
 * document-class page with its instrument rail beside it.
 */
const CENTRED = "mx-auto";

/**
 * Below 1240px: a two-column grid of the same blocks, beneath the content. At 1240px and above:
 * a 264px column that sticks while the document scrolls past it.
 */
const INSTRUMENT_RAIL = [
  "grid w-full grid-cols-2 gap-x-8 gap-y-6",
  "xl:sticky xl:top-10 xl:block xl:w-[var(--w-inspector)] xl:shrink-0 xl:space-y-6",
].join(" ");

export interface DocumentPageProps extends PageStateSlots {
  /** A `PageHeader`. It owns the screen's single `<h1>`; the template owns the gap beneath it. */
  header: ReactNode;
  /** The instrument rail: blocks of numbers. Beneath the content below 1240px. */
  rail?: ReactNode;
  /** When set, the matching slot renders INSTEAD of `children`. */
  state?: StateKind;
  children: ReactNode;
}

export const DocumentPage = forwardRef<HTMLDivElement, DocumentPageProps>(function DocumentPage(
  { header, rail, state, loading, error, empty, gone, children },
  ref,
) {
  const body =
    state === undefined ? children : pageStateSlot(state, { loading, error, empty, gone });

  return (
    <div ref={ref} className={cn(PAGE_FRAME, "py-10 md:py-12")}>
      <div className="flex flex-col gap-10 xl:flex-row xl:items-start xl:gap-12">
        <div className={cn(DOCUMENT_COLUMN, rail === undefined && CENTRED)}>
          {header}
          {/*
            32px between the header and the body. `PageHeader` deliberately draws no bottom
            margin — the gap belongs to whichever of the two density regimes the screen declared,
            and this is the roomy one.
          */}
          <div className="mt-8">{body}</div>
        </div>

        {rail === undefined ? null : (
          /*
            A complementary landmark, labelled, because a screen reader listing two `<aside>`s
            with no names cannot tell a reader which one carries the figures.
          */
          <aside aria-label="Measurements" className={INSTRUMENT_RAIL}>
            {rail}
          </aside>
        )}
      </div>
    </div>
  );
});

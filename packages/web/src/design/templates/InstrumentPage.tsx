import { forwardRef, type ReactNode } from "react";

import { cn } from "../cn.js";
import type { StateKind } from "../tokens.js";
import { Separator } from "../atoms/index.js";
import { PAGE_FRAME, pageStateSlot, type PageStateSlots } from "./DocumentPage.js";

/**
 * InstrumentPage — ATOMIC-INVENTORY §4, template 3. Eight screens.
 *
 * **The instrument half of the direction's central structural idea** (DESIGN-SYSTEM §1.2, §5.3).
 * Where `DocumentPage` is a reading column with the numbers pushed out to a rail, this is the
 * dense analytical surface: the full `--w-page` bleed, **no reading measure at all**, a tighter
 * vertical rhythm, and the stub tabulated as a table's leading column rather than hung in a
 * margin. Two templates, two different widths and two different rhythms — the split is in the
 * layout, not in a class name.
 *
 * Four things make the density real, and all four are §5.3's own words:
 *
 *  - **Full bleed.** No `--measure-read`, no column cap. Seven columns plus a 72px stub is what
 *    the Visits table needs and 1100px is what it gets; when a viewport cannot afford that, the
 *    screen cuts a column — it never shrinks the type and never gives up the stub.
 *  - **`t-ui` chrome.** 13px sans, tabular by construction, set once on the frame so every label,
 *    count and control inside inherits the instrument register without spelling it. The one
 *    column that carries a sentence sets `t-read-sm` itself and wins by proximity; `DataTable`
 *    and `TranscriptRow` already do exactly that, which is why the family rule can be a default
 *    here and a per-cell decision there.
 *  - **A tighter frame.** 24–32px of vertical padding against the document page's 40–48, and 20px
 *    between the header and the body against its 32.
 *  - **32px rows.** Owned by the rows themselves — `DataTable`'s `h-8`, `TranscriptRow`'s and
 *    `LedgerRow density="tight"`'s `py-2`. A template that tried to impose a row height from the
 *    outside would be setting a number no row could see.
 *
 * **The toolbar is a strip, and it does not stick.** Filter chips, a search input, a pager, an
 * execution picker: a band between the header and the instrument, ruled above and below, with the
 * hairline doing the separating rather than a fill (§1.3 rule 7). It is deliberately not sticky,
 * because `DataTable` pins its own head with `stickyHeader` and offsets it by
 * `--table-sticky-top` — and a template cannot know its toolbar's height, so pinning both would
 * either overlap the column heads or leave a gap under them. A screen that wants both pins the
 * table head and sets that offset itself.
 */
export interface InstrumentPageProps extends PageStateSlots {
  /** A `PageHeader`. It owns the screen's single `<h1>`. */
  header: ReactNode;
  /** Filters, a search field, a picker, a pager. A ruled band, not a floating bar. */
  toolbar?: ReactNode;
  /** When set, the matching slot renders INSTEAD of `children`. */
  state?: StateKind;
  children: ReactNode;
}

export const InstrumentPage = forwardRef<HTMLDivElement, InstrumentPageProps>(
  function InstrumentPage({ header, toolbar, state, loading, error, empty, gone, children }, ref) {
    const body =
      state === undefined ? children : pageStateSlot(state, { loading, error, empty, gone });

    return (
      <div ref={ref} className={cn(PAGE_FRAME, "t-ui py-6 md:py-8")}>
        {header}

        {toolbar === undefined ? null : (
          <div className="mt-6">
            <Separator />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2">{toolbar}</div>
            <Separator />
          </div>
        )}

        <div className={toolbar === undefined ? "mt-6" : "mt-5"}>{body}</div>
      </div>
    );
  },
);

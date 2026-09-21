import { Fragment, useId, useState, type ReactNode } from "react";
import { cva } from "class-variance-authority";
import { Link as RouterLink } from "react-router-dom";

import { cn } from "../cn.js";
import { focusRing, pressTransition, surfaceBase } from "../variants.js";
import { Icon, IconButton, Text, VisuallyHidden } from "../atoms/index.js";
import { Pagination, type PaginationProps } from "../molecules/index.js";
import {
  LEDGER_STUB_COLUMN,
  LEDGER_STUB_LABEL,
  LedgerStubValue,
  type LedgerStubKind,
} from "./Ledger.js";

/**
 * DataTable — the instrument-class table (ATOMIC-INVENTORY §3, organism 5).
 *
 * It absorbs the hand-rolled `<table>`s the coverage and visits screens each carry a private copy
 * of, and it is written against the four things DESIGN-SYSTEM §5.3 says survive of the direction
 * in an instrument-class screen:
 *
 * 1. **The stub returns as the 72px leading column.** `--w-stub`, right-aligned, carrying a
 *    locator and nothing else — a sequence number, a severity stack, a call ref, an execution
 *    number. It is a `<th scope="row">`, because that is what it is: the row's name.
 * 2. **Exactly one column carries a sentence, and it is serif at 13px.** This is §3.1's second
 *    named exception, and the only place inside a dense container where the serif is allowed:
 *    a table column is scanned *vertically* and compared row to row, which is exactly what the
 *    serif's sentence-ness buys. A streaming list gets no such carve-out.
 * 3. **Column heads are `t-label` with a hairline beneath, no fill.**
 * 4. **Numbers are `t-ui` tabular, right-aligned, sized to their widest value.**
 *
 * **Zebra striping is banned and this component cannot be made to do it** (§1.3 rule 7). A tinted
 * ground means one of exactly three things — machine output, selection, or hover — and the
 * evidence seam depends on the first. Rows are separated by hairlines instead.
 *
 * **Square cells inside a 12px container** (§5.2). The radius is on the surface; every cell in it
 * is `rounded-none`, because a 6px radius on a 32px row turns the row into a lozenge and the
 * table dissolves into a list of pills.
 *
 * **A row can carry its own detail, and that is how a table stays seven columns wide.** §5.3's
 * rule under 1000px is "cut a column, do not shrink the type", and the column a reader can least
 * afford to lose is never the diagnostic one — so `detail` folds the diagnostic figures under the
 * row instead: a real disclosure with `aria-expanded`, a region spanning the table's width, and a
 * fold that is mounted only while it is open. Before it existed, Visits hung a `Popover` off the
 * ledger stub with a `<Button>` as the trigger, which puts a control in the one column §1.2 M2
 * reserves for locators — "nothing else ever goes in it".
 *
 * **No ornament in a cell** (§1.3 rule 10): no lattice, no capsule, no bar. Cells hold values.
 * That rule is the caller's to keep — `cell` returns whatever it is given — but it is why this
 * component composes no proportion drawing of its own.
 *
 * **It is not `forwardRef`'d**, which is the one place it departs from the house rule. The rule
 * binds atoms wrapping a DOM node, because Radix needs the handle; this is a generic organism,
 * `forwardRef` erases generics, and restoring them costs a cast — and a cast about what was
 * mounted is a lie the no-`any` rule exists to prevent (ADR-0001).
 */

/** Which way a sorted column runs. The values are `aria-sort`'s own, so nothing maps them. */
export type SortDirection = "ascending" | "descending";

export interface SortState {
  /** The `key` of the column being sorted by. */
  key: string;
  direction: SortDirection;
}

export interface Column<T> {
  key: string;
  /** `t-label`, rendered in caps by the type step. Write it in sentence case. */
  header: string;
  align?: "start" | "end";
  /** A CSS length for the column. The only inline style here, because a width IS a measurement. */
  width?: string;
  /** THE one serif column — §3.1 exception 2. At most one per table; the first one wins. */
  sentence?: boolean;
  /** Tabular, right-aligned, and sized to the widest value plus its padding (§5.3). */
  numeric?: boolean;
  /** 3 is cut first (below `lg`, 1000px), then 2 (below `md`, 860px). 1 never cuts. */
  priority?: 1 | 2 | 3;
  cell: (row: T) => ReactNode;
}

/**
 * A column that may carry the header control. It exists as a separate type so that "sortable"
 * and "reports its sort" cannot come apart: `DataTableProps` accepts these columns **only** in
 * the branch that also demands `sort` and `onSortChange`, so a table cannot declare a sortable
 * column and then leave `aria-sort` off the `<th>`.
 */
export interface SortableColumn<T> extends Column<T> {
  /** Adds the header control and `aria-sort`. The caller does the sorting; this reports it. */
  sortable?: boolean;
}

/**
 * A column of a table that does not sort. `sortable` is typed `never` rather than left out,
 * because a column type that merely *omits* the property still accepts a `SortableColumn` handed
 * in through a variable — structural typing lets the extra property through — and the whole
 * point of the split is that it must not.
 */
type UnsortedColumn<T> = Column<T> & { sortable?: never };

/** Everything a table needs whether or not it sorts. */
interface DataTableBaseProps<T> {
  rows: readonly T[];
  keyOf: (row: T) => string;
  /**
   * The 72px leading column. A locator only — never a value, and never ornament.
   *
   * Return the bare position (`3`) rather than a formatted one: `Ledger` sets it, in the one
   * step §3.4 gives the stub's sequence, so the same locator reads the same here, in a `Ledger`
   * and in this table's own card list below `md`.
   */
  stub?: (row: T) => ReactNode;
  /**
   * What the stub column is called. The `<th>`'s head is never visible — the locator names
   * itself — so this is the head's accessible name, and it is the label the card list puts in
   * front of the leading line below `md`, where there is no column left to carry the meaning.
   */
  stubLabel?: string;
  /** What the stub holds, when the bare-value rule cannot tell (`ledgerStubKind`). */
  stubKind?: LedgerStubKind;
  /** What the product says when there is nothing to show. A serif sentence, upright (§4.7). */
  empty: ReactNode;
  /** The `<caption>`, for a screen reader. Names the table: "Visits in this execution". */
  caption: string;
  /**
   * Pins the head while the body scrolls under it. Offset it with `--table-sticky-top` when
   * something else on the screen is already pinned above.
   */
  stickyHeader?: boolean;
  /**
   * The pager, rendered in a footer strip beneath the body (molecule 34). Long ledgers — visits,
   * executions — are paged rather than rendered entire; the strip disappears with the pager when
   * there is only one page, rather than leaving a hairline under nothing.
   */
  pagination?: PaginationProps;
}

/**
 * **A row is navigable or expandable, and never both.** That is not a taste: `rowHref` works by
 * stretching one transparent `::after` over the whole row (see the note at the link below), and a
 * positioned overlay paints over anything in a later cell — including a disclosure trigger, which
 * would then be visible, focusable by keyboard, and dead to the mouse. Below `md` the two are
 * worse than that: the card is wrapped in the row's `<a>`, and a `<button>` inside an `<a>` is
 * invalid HTML that behaves differently in every browser. The union is where that fact lives, so
 * the combination is a type error at the call site rather than a bug a reader finds with a mouse.
 *
 * **A disclosure owes its name**, which is why `detailLabel` is required beside `detail` rather
 * than optional with a fallback. The trigger is a glyph with no visible text, and §6 allows that
 * only where a name is carried some other way; twenty-five buttons all called "Show detail" is
 * the fallback that would otherwise get written once and never revisited. The label names the
 * row — "Visit 3 in detail" — and feeds both the trigger's accessible name and the region's.
 */
type RowAction<T> =
  | {
      /** Makes the row navigable. See the note on the stretched link below. */
      rowHref: (row: T) => string;
      detail?: never;
      detailLabel?: never;
    }
  | {
      rowHref?: never;
      /**
       * The row's own detail, folded away beneath it and spanning the table's full width: the
       * diagnostic figures §5.3 moves OUT of a table too wide to fit, rather than a ninth column
       * nobody scans. Called only for a row that is open.
       */
      detail: (row: T) => ReactNode;
      /** Names this row's detail — "Visit 3 in detail". Sentence case, never a bare verb. */
      detailLabel: (row: T) => string;
    }
  | { rowHref?: never; detail?: never; detailLabel?: never };

/**
 * **A sortable table reports its sort, by construction.** ARIA's rule is not "say which column
 * is sorted"; it is that *every* sortable column head carries `aria-sort`, including the ones
 * that are not sorted right now — `none` is what tells a reader the column can be sorted at all.
 * A table that offers the control and omits the attribute is a set of buttons whose effect is
 * invisible to anyone not watching the rows move.
 *
 * So the two halves arrive together or not at all: pass a `SortableColumn` and the type demands
 * `sort` (which column, which way — `null` for "not sorted yet") and `onSortChange`; pass plain
 * `Column`s and the type forbids both. There is no third state in which the component has to
 * decide what a half-configured table means.
 */
export type DataTableProps<T> = DataTableBaseProps<T> &
  RowAction<T> &
  (
    | {
        columns: readonly SortableColumn<T>[];
        /** The column currently sorted by, or `null` when the table is in its natural order. */
        sort: SortState | null;
        /** Called with the next state: the same key flips direction, a new key starts ascending. */
        onSortChange: (next: SortState) => void;
      }
    | {
        columns: readonly UnsortedColumn<T>[];
        sort?: never;
        onSortChange?: never;
      }
  );

/**
 * A cell. `kind` carries the family rule; `align` and `priority` are orthogonal to it.
 *
 * `numeric` takes `w-px whitespace-nowrap`, which in an auto-layout table is the standing idiom
 * for "shrink this column to its content": the declared width loses to the content's minimum, so
 * the column ends up the widest value plus its own 8px padding on each side — §5.3's "sized to
 * the widest value plus 16px", expressed as a rule rather than as a measurement nobody can keep
 * up to date.
 *
 * Nothing here writes `tabular-nums`: every sans and mono step already carries
 * `tnum/lnum/zero`, so a figure is tabular by construction (§4.4).
 */
const cell = cva("rounded-none border-b border-rule px-3 py-1.5 align-middle", {
  variants: {
    kind: {
      /** The default: sans, 13px, the instrument's chrome voice. */
      value: "t-ui text-ink",
      /** §3.1 exception 2. 13px is the serif floor (§1.3 rule 6) and this is it. */
      sentence: "t-read-sm text-ink",
      numeric: "t-ui text-ink w-px whitespace-nowrap px-2",
    },
    align: {
      start: "text-left",
      end: "text-right",
    },
    priority: {
      1: "",
      2: "hidden md:table-cell",
      3: "hidden lg:table-cell",
    },
  },
  defaultVariants: { kind: "value", align: "start", priority: 1 },
});

/**
 * A column head. `align-bottom` so a two-word head sits on the hairline with the one-word heads
 * beside it rather than floating above them.
 */
const headCell = cva(
  "t-label rounded-none border-b border-rule px-3 py-1.5 text-left align-bottom text-ink-muted",
  {
    variants: {
      align: {
        start: "text-left",
        end: "text-right",
      },
      numeric: {
        true: "px-2",
        false: "",
      },
      priority: {
        1: "",
        2: "hidden md:table-cell",
        3: "hidden lg:table-cell",
      },
      sticky: {
        /**
         * `bg-surface` is not decoration here — it is what stops the body showing through the
         * head as it passes beneath. It is the surface the container already draws, so the table
         * gains no fill it did not have.
         */
        true: "sticky top-[var(--table-sticky-top,0px)] z-[var(--z-raised)] bg-surface",
        false: "",
      },
    },
    defaultVariants: { align: "start", numeric: false, priority: 1, sticky: false },
  },
);

/**
 * 24x24px is the floor for every control (§6), and on a coarse pointer an 11px column head is
 * nowhere near it — so the sort control grows to 44px through a `::after` box that does not touch
 * layout, exactly as `Button` does. The head's own hairline row height is unchanged.
 */
const COARSE_HIT_AREA = [
  "pointer-coarse:after:absolute",
  "pointer-coarse:after:top-1/2",
  "pointer-coarse:after:left-1/2",
  "pointer-coarse:after:h-11",
  "pointer-coarse:after:w-full",
  "pointer-coarse:after:min-w-11",
  "pointer-coarse:after:-translate-x-1/2",
  "pointer-coarse:after:-translate-y-1/2",
  "pointer-coarse:after:content-['']",
].join(" ");

/**
 * The disclosure trigger's column: `w-px whitespace-nowrap` is the same "shrink to the content"
 * idiom the numeric cells use, so the control column costs exactly the 24px square plus its own
 * padding and takes nothing from the seven columns that carry data.
 */
const DISCLOSURE_COLUMN = "w-px whitespace-nowrap px-2";

/**
 * The trigger turns along the reading direction when it opens — an affordance turning, not a mark
 * moving, which is the one rotation §5.1 allows and the same one `Disclosure` uses.
 *
 * The rotation is on the button rather than on the glyph, because `IconButton` injects its own
 * glyph; on a 24px square with a 6px corner that is indistinguishable, focus ring included. The
 * transition property is spelled out because `cn()` would otherwise let `transition-transform`
 * replace `Button`'s `transition-colors` outright and take the hover language off the control —
 * one class, one group, last one wins. Colour rides the fold's 160ms rather than the press's
 * 90ms, so the turn and the ground land together instead of a frame apart.
 */
const DISCLOSURE_CHEVRON = [
  "transition-[background-color,color,transform]",
  "[transition-duration:var(--dur-disclose)]",
  "[transition-timing-function:var(--ease)]",
].join(" ");

function kindOf<T>(column: Column<T>, isTheSentence: boolean): "value" | "sentence" | "numeric" {
  if (isTheSentence) return "sentence";
  if (column.numeric === true) return "numeric";
  return "value";
}

function alignOf<T>(column: Column<T>): "start" | "end" {
  if (column.align !== undefined) return column.align;
  return column.numeric === true ? "end" : "start";
}

export function DataTable<T>(props: DataTableProps<T>): ReactNode {
  const {
    rows,
    keyOf,
    stub,
    stubLabel,
    stubKind,
    rowHref,
    detail,
    detailLabel,
    empty,
    caption,
    sort = null,
    onSortChange,
    stickyHeader = false,
    pagination,
  } = props;

  /**
   * **Which rows are open is this component's own state, and sorting is not.** The caller sorts,
   * because only the caller knows what its rows compare by; nobody outside needs to know which
   * rows a reader has unfolded, and a `useState` in every screen that wanted a detail row is
   * exactly the hand-rolling this organism exists to absorb.
   *
   * Keys rather than indices, so paging and filtering cannot hand one row's fold to another.
   * An array rather than a `Set`: these are the twenty-five rows of one page.
   */
  const [openKeys, setOpenKeys] = useState<readonly string[]>([]);
  /** One base per mounted table, so two tables on a screen cannot collide on an id. */
  const domId = useId();

  /**
   * Widening, not a cast: a plain `Column<T>` is a `SortableColumn<T>` whose `sortable` is
   * absent, so the branch that forbids the prop assigns straight into the branch that allows it.
   * Nothing here has to ask which branch the caller took.
   */
  const columns: readonly SortableColumn<T>[] = props.columns;
  /**
   * "At most one per table" is enforced rather than documented: the first `sentence` column is
   * the serif one and any other is drawn as an ordinary value column. Two serif columns would
   * turn the carve-out into a second reading measure inside a 32px row, which is the thing §3.1
   * exception 2 is a carve-out *from*.
   */
  const sentenceKey = columns.find((column) => column.sentence === true)?.key;

  const hasStub = stub !== undefined;
  const expandable = detail !== undefined && detailLabel !== undefined;
  const span = columns.length + (hasStub ? 1 : 0) + (expandable ? 1 : 0);
  const paged = pagination !== undefined && pagination.pages > 1;

  /**
   * **Every row is formatted exactly once per render.** Below `md` the same rows are a card list
   * rather than a reflowed table, and both renderings are in the DOM with one of them
   * `display: none` — so iterating `rows` twice meant calling `column.cell(row)` twice for every
   * cell on every render. On Visits that is seven columns plus a stub at a two-second poll: 16
   * formatter calls per row per poll, half of them for a rendering the reader cannot see.
   *
   * So the formatting happens here, once, and the two renderings consume the result. `cell` is
   * still expected to be a pure formatter — this is not permission to do work in one — but a
   * formatter that reads a date or builds a `RelativeTime` is no longer billed twice for it.
   */
  const prepared = rows.map((row, index) => {
    const key = keyOf(row);
    const open = openKeys.includes(key);
    return {
      key,
      index,
      open,
      href: rowHref === undefined ? undefined : rowHref(row),
      locator: stub === undefined ? null : stub(row),
      cells: columns.map((column) => ({ column, content: column.cell(row) })),
      /**
       * The same economy as the cells, and it matters more: a closed detail is not formatted at
       * all, and an open one is formatted once for both renderings rather than once each. On
       * Visits that is the difference between four figures per row per two-second poll and four
       * figures for the one row somebody actually opened.
       */
      detailName: detailLabel === undefined ? null : detailLabel(row),
      detailNode: detail === undefined || !open ? null : detail(row),
    };
  });

  function toggleRow(key: string): void {
    setOpenKeys((previous) =>
      previous.includes(key) ? previous.filter((open) => open !== key) : [...previous, key],
    );
  }

  /**
   * The trigger, in both renderings. It is an `IconButton` because it is a glyph with no visible
   * text beside it, and §6 permits that in exactly one component — the one that always carries
   * both an `aria-label` and a `Tooltip`, so "an instrument is labelled" survives a control this
   * small. The tooltip provider is the app's (`AppShell` mounts one), so a page of rows costs
   * closed Radix roots rather than a provider apiece.
   *
   * `aria-expanded` is the whole of the WAI-ARIA disclosure pattern's keyboard contract; Enter
   * and Space are the platform's, and come free with a real button.
   *
   * `aria-controls` is set only while the region exists,
   * because the fold is mounted rather than hidden — the alternative keeps every row's detail in
   * the DOM for the sake of an id that points at a `display: none` box, and pays for formatting
   * all of them on every poll. `aria-expanded` is on the button either way, which is what tells
   * a reader the control is a disclosure at all.
   */
  function disclosure(id: string, open: boolean, name: string, onToggle: () => void): ReactNode {
    return (
      <IconButton
        icon="chevron-right"
        label={name}
        size="sm"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={onToggle}
        className={cn(DISCLOSURE_CHEVRON, open && "rotate-90")}
      />
    );
  }

  /**
   * `undefined` means the column is not sortable and the `<th>` carries no `aria-sort` at all,
   * which is the correct absence — `none` would claim it could be sorted.
   */
  function sortStateFor(column: SortableColumn<T>): SortDirection | "none" | undefined {
    if (column.sortable !== true) return undefined;
    if (sort !== null && sort.key === column.key) return sort.direction;
    return "none";
  }

  function toggle(column: SortableColumn<T>): void {
    const active = sort !== null && sort.key === column.key;
    const direction: SortDirection =
      active && sort.direction === "ascending" ? "descending" : "ascending";
    // Present whenever a column is sortable, by the props type above; the optional call is how
    // that guarantee is spelled without a cast.
    onSortChange?.({ key: column.key, direction });
  }

  return (
    <div
      className={cn(
        surfaceBase({ level: "card" }),
        /**
         * `overflow-clip` rather than `overflow-hidden`: clipping keeps the hover ground inside
         * the 12px corners, and unlike `hidden` it does not make the container a scroll
         * container — which is what would otherwise pin a sticky head to a box that never
         * scrolls and quietly break it.
         */
        "overflow-clip",
      )}
    >
      {/*
        Below `md` (860px) the table is gone and the same rows are a card list — §5.3: "the stub
        collapses to a leading line and the table becomes a card list". It is a second rendering
        of the same data rather than a reflow, because a value's column head cannot become a label
        beside it in CSS alone, and `display: none` takes the unused one out of the accessibility
        tree entirely, so a reader meets exactly one of them. Both read the one `prepared` array
        above, so the second rendering costs markup and not a second pass of every formatter.
      */}
      <table className="hidden w-full table-auto border-separate border-spacing-0 md:table">
        {/*
          A real <caption>, named by the caller, so the table announces what it is instead of
          leaving a reader to infer it from the first column head. The text is visually hidden;
          the element stays, because `aria-label` on a <table> is not equivalent for every reader.
        */}
        <caption className="block h-0 p-0">
          <VisuallyHidden>{caption}</VisuallyHidden>
        </caption>

        <thead>
          <tr>
            {!hasStub ? null : (
              <th
                scope="col"
                className={cn(headCell({ sticky: stickyHeader, align: "end" }), LEDGER_STUB_COLUMN)}
              >
                {/* The stub column has no visible head — the locator names itself. */}
                <VisuallyHidden>{stubLabel ?? LEDGER_STUB_LABEL}</VisuallyHidden>
              </th>
            )}

            {columns.map((column) => {
              const ariaSort = sortStateFor(column);
              const align = alignOf(column);
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={ariaSort}
                  style={column.width === undefined ? undefined : { width: column.width }}
                  className={cn(
                    headCell({
                      align,
                      numeric: column.numeric === true,
                      priority: column.priority ?? 1,
                      sticky: stickyHeader,
                    }),
                  )}
                >
                  {ariaSort === undefined ? (
                    column.header
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        toggle(column);
                      }}
                      className={cn(
                        "t-label relative inline-flex min-h-6 items-center gap-1 rounded-none text-ink-muted hover:text-ink",
                        align === "end" && "flex-row-reverse",
                        COARSE_HIT_AREA,
                        pressTransition,
                        focusRing,
                      )}
                    >
                      {column.header}
                      {/*
                        Affordance only, never meaning: `aria-sort` on the <th> carries the state
                        and the glyph is hidden. Inactive columns draw it in `rule-strong`, which
                        is the token for a meaningful non-text mark at 3:1 — so the column reads
                        as sortable before it is sorted.
                      */}
                      <Icon
                        name="chevron-down"
                        size={12}
                        className={cn(
                          ariaSort === "none" && "text-rule-strong",
                          ariaSort === "ascending" && "rotate-180",
                        )}
                      />
                    </button>
                  )}
                </th>
              );
            })}

            {!expandable ? null : (
              <th
                scope="col"
                className={cn(
                  headCell({ sticky: stickyHeader, align: "end" }),
                  DISCLOSURE_COLUMN,
                )}
              >
                {/* Never cut by `priority`: a column nobody can reach is a feature nobody has. */}
                <VisuallyHidden>Detail</VisuallyHidden>
              </th>
            )}
          </tr>
        </thead>

        {/*
          The last row's hairline is the container's own border; two would read as a double rule.
          This still says exactly what it meant before the detail row existed, because a fold is
          mounted only while it is open: closed, the row itself is `:last-child`; open, the fold
          is, and the hairline between the row and its own detail is the one that should stay.
        */}
        <tbody className="[&>tr:last-child>*]:border-b-0">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={span} className="px-3 py-6">
                <Text as="div" size="read" tone="soft">
                  {empty}
                </Text>
              </td>
            </tr>
          ) : (
            prepared.map((entry) => {
              const { key, open, href, locator, cells, detailName, detailNode } = entry;
              const regionId = `${domId}-row-${String(entry.index)}`;
              return (
                <Fragment key={key}>
                  <tr
                    className={cn(
                      "h-8",
                      /* The containing block for the stretched link below. */
                      href === undefined ? null : ["relative", pressTransition, "hover:bg-hover"],
                    )}
                  >
                    {!hasStub ? null : (
                      <th
                        scope="row"
                        className={cn(cell({ align: "end" }), LEDGER_STUB_COLUMN)}
                      >
                        <LedgerStubValue stub={locator} kind={stubKind} label={stubLabel} />
                      </th>
                    )}

                    {cells.map(({ column, content }, index) => {
                      return (
                        <td
                          key={column.key}
                          className={cn(
                            cell({
                              kind: kindOf(column, column.key === sentenceKey),
                              align: alignOf(column),
                              priority: column.priority ?? 1,
                            }),
                          )}
                        >
                          {href !== undefined && index === 0 ? (
                            /*
                              ONE link per row, in the first content column, stretched over the
                              whole row by a transparent ::after. A <tr> cannot be an anchor and a
                              link in every cell would read the row out N times; this gives a
                              keyboard user one tab stop whose accessible name is the row's own
                              first value. The consequence, and it is a rule: a row with `rowHref`
                              may not carry another link in a later cell, because the overlay is
                              positioned and would paint over it.
                            */
                            <RouterLink
                              to={href}
                              className={cn(
                                "rounded-none after:absolute after:inset-0 after:content-['']",
                                focusRing,
                              )}
                            >
                              {content}
                            </RouterLink>
                          ) : (
                            content
                          )}
                        </td>
                      );
                    })}

                    {!expandable || detailName === null ? null : (
                      <td className={cn(cell({ align: "end" }), DISCLOSURE_COLUMN)}>
                        {disclosure(regionId, open, detailName, () => {
                          toggleRow(key);
                        })}
                      </td>
                    )}
                  </tr>

                  {/*
                    **The detail row, spanning the table.** This is what §6.3 row 11 asked for and
                    what a `Popover` hung off the locator was standing in for: the figures that are
                    diagnostic rather than scanning data — turns, tokens — leave the seven columns
                    and land under the row they belong to, at the table's full width, where they can
                    be laid out as figures instead of squeezed into a 32px cell.

                    It is indented to the first content column, so the fold hangs off the same spine
                    the stub does rather than starting at the table's own edge.
                  */}
                  {!open || detailNode === null || detailName === null ? null : (
                    <tr>
                      <td colSpan={span} className="rounded-none border-b border-rule p-0">
                        <div
                          id={regionId}
                          role="group"
                          aria-label={detailName}
                          className="py-3 pr-3 pl-[calc(var(--w-stub)+0.75rem)]"
                        >
                          {detailNode}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>

      <ul aria-label={caption} className="md:hidden">
        {rows.length === 0 ? (
          <li className="px-3 py-6">
            <Text as="div" size="read" tone="soft">
              {empty}
            </Text>
          </li>
        ) : (
          prepared.map((entry) => {
            const { key, open, href, locator, cells, detailName, detailNode } = entry;
            const regionId = `${domId}-card-${String(entry.index)}`;
            const body = (
              <>
                {!hasStub ? null : (
                  <div className="mb-1 flex items-baseline text-left">
                    <LedgerStubValue stub={locator} kind={stubKind} label={stubLabel} />
                  </div>
                )}
                {cells.map(({ column, content }) => (
                  <div key={column.key} className="flex items-baseline gap-3 py-0.5">
                    <span className="t-label w-24 shrink-0 text-ink-muted">{column.header}</span>
                    <span
                      className={cn(
                        "min-w-0",
                        column.key === sentenceKey ? "t-read-sm text-ink" : "t-ui text-ink",
                      )}
                    >
                      {content}
                    </span>
                  </div>
                ))}
              </>
            );
            return (
              <li key={key} className="border-b border-rule last:border-b-0">
                {href === undefined ? (
                  <div className="px-3 py-3">
                    {body}
                    {/*
                      The card's own disclosure. It is a second trigger with a second id, because
                      both renderings are in the DOM at once and only one of them is displayed —
                      one id shared between them would be a duplicate, which is the bug that makes
                      `aria-controls` point at whichever box the browser found first.
                    */}
                    {!expandable || detailName === null ? null : (
                      <div className="mt-2 flex justify-end">
                        {disclosure(regionId, open, detailName, () => {
                          toggleRow(key);
                        })}
                      </div>
                    )}
                    {!open || detailNode === null || detailName === null ? null : (
                      <div
                        id={regionId}
                        role="group"
                        aria-label={detailName}
                        className="mt-2 border-t border-rule pt-3"
                      >
                        {detailNode}
                      </div>
                    )}
                  </div>
                ) : (
                  <RouterLink
                    to={href}
                    className={cn(
                      "block rounded-none px-3 py-3 hover:bg-hover",
                      pressTransition,
                      focusRing,
                    )}
                  >
                    {body}
                  </RouterLink>
                )}
              </li>
            );
          })
        )}
      </ul>

      {paged ? (
        <div className="border-t border-rule px-3 py-2">
          <Pagination {...pagination} />
        </div>
      ) : null}
    </div>
  );
}

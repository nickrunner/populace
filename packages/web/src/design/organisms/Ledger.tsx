import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  type ReactNode,
} from "react";
import { Link as RouterLink } from "react-router-dom";

import { cn } from "../cn.js";
import { rowBase } from "../variants.js";
import { Badge, Mono, Separator, Text } from "../atoms/index.js";
import type { Density } from "../tokens.js";

/**
 * Ledger / LedgerRow — ATOMIC-INVENTORY §3, organism 4. **THE SIGNATURE MOVE** (§1.2 M2).
 *
 * Every list that carries evidence — the transcript, the findings list, the executions history,
 * the visits table, the landing page — is a two-column ledger: a **72px right-aligned stub**
 * (`--w-stub`) and **one continuous 1px vertical rule** at its right edge running the full height
 * of the list. Not per-row borders. One spine.
 *
 * That last word is the whole design, and it is why the rule is drawn by `Ledger` as a single
 * absolutely-positioned hairline rather than by `LedgerRow` as a `border-r`. Twenty-seven lists
 * in the app draw `divide-y divide-rule` today, which gives a reader a horizontal rule per row
 * and no vertical alignment at all; the ergonomic bug that motivates the inversion is
 * `WatchAVisit`'s 200 trace rows, whose sequence numbers and call refs are inline and therefore
 * unscannable. Rows are square, `py-2` at `density="tight"`, and separated by **nothing** — the
 * spine carries the alignment, so there is no zebra and no per-row hairline to fight it (§1.3
 * rule 7).
 *
 * **The stub holds locators and nothing else**: the 4-digit mono sequence, the severity stack,
 * the `[c3]` call ref, the execution number, a mark-grammar glyph. A name, a count, a time or a
 * sentence in the stub is a review failure — the moment the column stops being a fixed-meaning
 * locator it stops being scannable, which is the only thing it is for.
 *
 * **Below `--breakpoint-md` (860px) the stub collapses** and its contents render as a leading
 * line above the row, and the spine goes with it. A narrow reader gets the locator first and then
 * the row, which is the same reading order the two columns give, linearised.
 *
 * **The 3px gutter.** `rowBase`'s `selected` state is a 3px left edge — the only 3px border in
 * the system — and a border that appears only on the selected row would shift that row's grid
 * 3px out of the column. So every row and the stub label carry the edge in `transparent`, the
 * gutter is uniform, and the spine sits at `calc(var(--w-stub) + 3px)` to match. Selection
 * changes a colour and never a position.
 */

interface LedgerShape {
  /** What a row renders as, so `as="ul"` really does get `<li>` children. */
  item: "li" | "div";
  /** The ledger's declared stub kind, if it declared one. A row's own `stubKind` still wins. */
  stubKind?: LedgerStubKind;
  /** The column's name, when the ledger was given one. Undefined means "not named". */
  stubLabel?: string;
}

/** A row outside a `Ledger` is legal and renders as a `<div>`; the grid does not need a list. */
const LedgerContext = createContext<LedgerShape>({ item: "div" });

/**
 * ---- M2's spine, in one place ----------------------------------------------------------------
 *
 * The stub is the product's signature move and it was being re-derived at four sites: this file's
 * grid, `DataTable`'s private `STUB` width, `MarketingShell`'s page-long hairline, and the
 * transcript and feed organisms' own `md:grid-cols-[var(--w-stub)_…]`. They agreed, and nothing
 * kept them agreeing — a change to the 3px gutter had to be made in every one of them or the
 * spine would have stepped out of the column on one screen in five.
 *
 * These exports are now the spelling of it: `Ledger`, `LedgerRow` and `DataTable` all take the
 * geometry from here, and `LedgerSpine` is the only hairline drawn as an element. **The public
 * marketing route is no longer one of them** — it drew this spine down the whole page with no
 * stub column under it, which aligned nothing and crossed every section heading, so
 * `MarketingShell` now draws no spine at all (DESIGN-SYSTEM §9.2). A spine belongs where there
 * are locators to align. Four organisms — `TranscriptList`, `TranscriptRow`, `LiveActivityFeed` and
 * `ExecutionCompare` — still write the track inline, because theirs is inside a variant
 * (`md:grid-cols-[…]`, `md:before:left-[…]`) and a Tailwind variant prefix cannot be applied to a
 * class string handed in from elsewhere. Their offsets are the same `--w-stub` + 3px and must
 * stay that way; the fix for them is a `before:`-to-`LedgerSpine` change, which is theirs to
 * make.
 */

/**
 * The two columns, the uniform 3px selection gutter, and the collapse below `md`. Shared by the
 * stub-label header and by every row, so the label cannot drift out of the column it names.
 */
export const LEDGER_GRID = [
  "block border-l-[3px] border-l-transparent",
  "md:grid md:grid-cols-[var(--w-stub)_minmax(0,1fr)] md:items-baseline",
].join(" ");

/** Right-aligned against the spine, with a 12px gap; a leading line below `md`. */
export const LEDGER_STUB = "mb-1 block md:mb-0 md:pr-3 md:text-right";

/**
 * The same 72px locator column where it is a real table column rather than a grid track — a
 * `<th>` in `DataTable`, which cannot use the grid because a table's own layout owns the widths.
 * Same token, same alignment, one spelling.
 */
export const LEDGER_STUB_COLUMN = "w-[var(--w-stub)] text-right";

/**
 * ---- What the stub is SET IN, in one place ---------------------------------------------------
 *
 * The stub holds exactly two kinds of thing, and they are not the same typographic object:
 *
 *  - a **position** — "an integer position in this list": a sequence number, an execution
 *    number, a rank, an ordinal, a step. DESIGN-SYSTEM §3.4 names its step outright — `t-ref` is
 *    "the `[c3]` pill and **the stub's 4-digit sequence**" — and M2 says the same thing from the
 *    other side: the stub carries "the 4-digit **mono** sequence". So a position is
 *    `Mono size="ref" tone="muted"`, which is what this file now renders, once, for every ledger
 *    and for `DataTable`'s tabulated stub.
 *  - a **mark** — the mark grammar drawing itself: a severity stack, a dot, a ring, an avatar.
 *    It carries its own size and its own ink and must be left alone.
 *
 *  §3.1's "a number is Space Grotesk" is not in tension with this. The position integer is not a
 *  quantity the reader compares; it is an address, in the same column as the `[c3]` refs it has
 *  to line up with, and §3.4 carves it out by name for exactly that reason. `t-figure-sm` — 18px
 *  of sans — says "this is a measurement", which a row's address is not.
 *
 * The port of screens 1–18 spelled a position integer four different ways (`Mono size="ref"`,
 * `Text size="meta"`, `Text size="figure-sm"`, and a bare value inheriting the table cell's
 * `t-ui`), which is four different column rhythms in one product. There is one now.
 */

/** What a stub holds: an integer position in the list, or the mark grammar drawing itself. */
export type LedgerStubKind = "position" | "mark";

/**
 * What the stub column is called when the caller does not name it. It is never false — the stub
 * IS the row's name, which is why `DataTable` makes it a `<th scope="row">`.
 */
export const LEDGER_STUB_LABEL = "Row";

/**
 * **A bare value is a position; a drawn thing is a mark.** That is the rule, and it is a rule
 * rather than a prop with a default because the alternative is a default that is wrong half the
 * time: defaulting to `position` would wrap every severity stack in a type step, and defaulting
 * to `mark` would leave every sequence number set in whatever its container happened to be.
 *
 * `declared` is the override, and it exists for the two cases the rule cannot see: a position
 * that arrives already wrapped (an ordinal with a `VisuallyHidden` unit in front of it) and a
 * mark that arrives as a bare string (a glyph). `Ledger` takes it for a whole column and
 * `LedgerRow` for one row; the row wins.
 */
export function ledgerStubKind(
  stub: ReactNode,
  declared: LedgerStubKind | undefined,
): LedgerStubKind {
  if (declared !== undefined) return declared;
  if (typeof stub === "number" || typeof stub === "bigint") return "position";
  return typeof stub === "string" ? "position" : "mark";
}

export interface LedgerStubValueProps {
  /** ONLY a locator (§1.2 M2). A name, a count, a time or a control here is a review failure. */
  stub: ReactNode;
  /** Overrides the bare-value rule above. */
  kind?: LedgerStubKind;
  /** The column's name. `undefined` means the caller did not name it. */
  label?: string;
}

/**
 * The stub's contents, set. Used by `LedgerRow`, by `DataTable`'s `<th scope="row">` and by
 * `DataTable`'s card list, so the same locator reads the same in a list and in a table.
 *
 * **The label travels with the collapse.** Above `md` the column's meaning is carried by the
 * column — its position, its rule, and the `stubLabel` head when the author wants one. Below
 * `md` there is no column: the stub becomes a leading line, and a bare `3` floating above a row
 * is an integer with nothing to say. So the label is rendered here, `md:hidden`, in front of the
 * locator — with `LEDGER_STUB_LABEL` standing in when the caller named nothing. A mark needs no
 * such introduction (a severity stack is not an integer), so it gets the label only when the
 * caller asked for one by name.
 */
export function LedgerStubValue({ stub, kind, label }: LedgerStubValueProps): ReactNode {
  const resolved = ledgerStubKind(stub, kind);
  const leading = label ?? (resolved === "position" ? LEDGER_STUB_LABEL : null);

  return (
    <>
      {leading === null ? null : (
        <Text size="label" tone="muted" className="mr-1.5 md:hidden">
          {leading}
        </Text>
      )}
      {resolved === "mark" ? (
        stub
      ) : (
        <Mono size="ref" tone="muted">
          {stub}
        </Mono>
      )}
    </>
  );
}

/**
 * The spine itself: one continuous hairline at the stub's right edge, spanning whatever it is
 * put inside. The 3px matches the selection gutter above, so a selected row's edge lands *on*
 * the column rule rather than beside it.
 *
 * It is the `Separator` atom stretched, not a hand-rolled hairline, so a section rule and a
 * ledger spine are the same 1px of `rule` in both themes. Hidden below `md`, where there is no
 * second column for it to divide. The parent must establish a containing block — `relative`.
 */
export function LedgerSpine(): ReactNode {
  return (
    <Separator
      orientation="vertical"
      className={cn(
        "pointer-events-none absolute inset-y-0 left-[calc(var(--w-stub)+3px)]",
        "hidden h-auto w-px self-auto md:block",
      )}
    />
  );
}

export interface LedgerProps {
  /**
   * `t-label` above the stub column. Four data-label roles only — this is one of them (§3.3).
   *
   * **It is defaulted rather than required, and the default is not decoration.** Naming the
   * column is an author's decision above `md`, where the column speaks for itself: "Rank",
   * "Step", "execution" say something a position and a rule do not, and nine of the eleven
   * ledgers in the port reasonably left it off. Below `md` the column collapses to a leading
   * line and that reasoning stops holding — a bare integer above a row is an address with no
   * unit — so a position stub always carries a label there, this one when it has no better.
   * Required would be the wrong shape for the same reason: it would force a word onto the nine
   * that only need one at 640px, and get nine bad ones.
   */
  stubLabel?: string;
  /**
   * What every stub in this ledger holds, for the rows the bare-value rule cannot read
   * (`ledgerStubKind`). A row's own `stubKind` wins over it.
   */
  stubKind?: LedgerStubKind;
  /** The continuous rule. Default `true`; off only where the stub carries no locator. */
  spine?: boolean;
  as?: "ul" | "ol" | "div";
  children: ReactNode;
}

export const Ledger = forwardRef<HTMLDivElement, LedgerProps>(function Ledger(
  { stubLabel, stubKind, spine = true, as = "ul", children },
  ref,
) {
  // JSX given a union of intrinsic tags asks for the intersection of their ref types, which no
  // single element satisfies. The ref belongs on the frame anyway — that is the element a caller
  // measures or scrolls — so the list tag is erased to one and the frame keeps the ref.
  const List = as as "ul";
  const item = as === "div" ? "div" : "li";

  return (
    <LedgerContext.Provider value={{ item, stubKind, stubLabel }}>
      <div ref={ref} className="relative">
        {stubLabel === undefined ? null : (
          <div className={cn(LEDGER_GRID, "hidden pb-2 md:grid")}>
            <Text as="div" size="label" tone="muted" className={LEDGER_STUB}>
              {stubLabel}
            </Text>
            <span />
          </div>
        )}

        <List className="m-0 list-none p-0">{children}</List>

        {/*
          One spine, drawn once, spanning the frame — the stub label included, because a column
          rule that starts below its own heading reads as a mistake.
        */}
        {spine ? <LedgerSpine /> : null}
      </div>
    </LedgerContext.Provider>
  );
});

export interface LedgerRowProps {
  /**
   * ONLY a locator: a sequence number, a severity stack, a call ref, an execution number or a
   * mark-grammar glyph. Nothing else ever goes in the stub.
   */
  stub: ReactNode;
  /**
   * What this row's stub holds, when the bare-value rule cannot tell (`ledgerStubKind`). Wins
   * over the `stubKind` the `Ledger` above declared for the column.
   */
  stubKind?: LedgerStubKind;
  to?: string;
  onClick?: () => void;
  selected?: boolean;
  /** A 2px `critical` edge on the CONTENT column, and the word `suspect` (§4.2). */
  suspect?: boolean;
  density?: Density;
  children: ReactNode;
}

export const LedgerRow = forwardRef<HTMLElement, LedgerRowProps>(function LedgerRow(
  {
    stub,
    stubKind,
    to,
    onClick,
    selected = false,
    suspect = false,
    density = "default",
    children,
  },
  ref,
) {
  const { item, stubKind: columnKind, stubLabel } = useContext(LedgerContext);
  const interactive = to !== undefined || onClick !== undefined;

  const rowClasses = cn(LEDGER_GRID, rowBase({ density, interactive, selected }));

  /**
   * The suspect edge lands exactly on the spine, so the row's own segment of the column rule
   * turns critical rather than a second line appearing beside it. The 2px it costs is taken back
   * out of the content column's 12px inset, so the text does not move when a row is flagged.
   */
  const contentClasses = cn(
    "min-w-0",
    suspect ? "md:border-l-2 md:border-l-critical md:pl-[10px]" : "md:pl-3",
  );

  const body = (
    <>
      <div className={LEDGER_STUB}>
        <LedgerStubValue stub={stub} kind={stubKind ?? columnKind} label={stubLabel} />
      </div>
      <div className={contentClasses}>
        {suspect ? (
          <div className="mb-1">
            <Badge variant="bad">suspect</Badge>
          </div>
        ) : null}
        {children}
      </div>
    </>
  );

  /**
   * A callback ref, because the outer node is an `<li>` or a `<div>` depending on what the
   * `Ledger` above declared. `RefObject` is invariant in its element type and could not be handed
   * to both; a callback taking `HTMLElement` satisfies either.
   */
  const setRef = useCallback(
    (node: HTMLElement | null) => {
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  // Same erasure as above: one tag, so JSX asks for one ref type. `Item` is `<li>` or `<div>`.
  const Item = item as "li";

  /** Selection is a place, not a decoration, so it is announced as well as drawn. */
  const current = selected ? true : undefined;

  if (to !== undefined) {
    return (
      <Item ref={setRef}>
        <RouterLink to={to} className={rowClasses} aria-current={current} onClick={onClick}>
          {body}
        </RouterLink>
      </Item>
    );
  }

  if (onClick !== undefined) {
    return (
      <Item ref={setRef}>
        <button type="button" className={rowClasses} aria-current={current} onClick={onClick}>
          {body}
        </button>
      </Item>
    );
  }

  return (
    <Item ref={setRef} className={rowClasses} aria-current={current}>
      {body}
    </Item>
  );
});

import { forwardRef, type ReactNode } from "react";
import { cva } from "class-variance-authority";

import { cn } from "../cn.js";
import type { StateKind } from "../tokens.js";
import { Inline, Measure, Spinner, Stack, Text } from "../atoms/index.js";
// §4.3 has ONE well, and this is it. The folder says organism and this file says molecule, but
// `PayloadBlock` depends on nothing above an atom and `CopyButton`, so the dependency runs
// downward in fact; a second, hand-rolled error well here is how a system ends up with three
// spellings of one rule.
import { PayloadBlock } from "../organisms/PayloadBlock.js";

/**
 * StateBlock — ATOMIC-INVENTORY §2, molecule 32. One component for every query state, replacing
 * `Loading` (31 sites) + `Failed` (34) + `Empty` (19) + `Gone` (5).
 *
 * Those four are one component because they are one *moment*: the screen has nothing to draw
 * yet, and the only question is why. Today each of the four is spelled differently on every
 * screen, which is why a screen collapses to 40px and then jumps back when the data lands.
 *
 * Four rules decide everything below.
 *
 *  - **The product is speaking, so it speaks in serif, upright** (DESIGN-SYSTEM §4.7). Italic
 *    belongs to people — `t-voice` and the walked-away quote — and the existing `Empty` atom is
 *    italic at all 19 of its sites, which is the bug this fixes. `ink-soft` is the serif's body
 *    ink (§3.6).
 *  - **Say what happened, plainly** (§7.4). An empty state is a sentence that invites, not a
 *    label that apologises, and a failure says what failed with the machine's own words quoted
 *    beneath it — in the system's one payload well (`PayloadBlock`), not in a second spelling of
 *    it — rather than paraphrased into prose.
 *  - **Nothing here may promise a repeatable outcome** (§7.3). Outcomes vary between executions
 *    by design, so no default sentence in this file says "try again and you will get the same
 *    thing", and an absence is never reported as a repair.
 *  - **Skeleton → content is a swap, not a cross-fade** (§5.1). The `skeleton` slot exists so
 *    the screen's own placeholder — built to the exact height of what it replaces — holds the
 *    layout while the query runs. Nothing animates between the two.
 *
 * Live regions follow §6: `loading` is `aria-busy` with a `status`, `failed` is an `alert`.
 * `empty` and `gone` are neither — they are the page's content, not an event.
 */

/**
 * What the block is standing in for, as a noun phrase that can follow a preposition:
 * `"the transcript"`, `"this project"`, `"this person's visits"`. Every default sentence below
 * is written so that phrase never has to start a sentence, which is what keeps one `what` string
 * grammatical across all four kinds without a capitalisation hack.
 */
export interface StateBlockProps {
  kind: StateKind;
  /** The noun phrase — "the transcript", "this project". Lower case, no leading article rule. */
  what: string;
  /** `failed` only: the message in serif, the raw text quoted in a mono well beneath it. */
  error?: Error | null;
  /** `empty` and `gone`: a serif sentence and a way back. `failed`: a way to retry. */
  children?: ReactNode;
  /** `loading`: the screen's own skeleton, so the layout holds and there is no reflow to hide. */
  skeleton?: ReactNode;
}

/**
 * The block's own vertical rhythm. `loading` sits on one line; the other three are a sentence
 * with something under it, so they take the 12px step.
 */
const block = cva("", {
  variants: {
    kind: {
      loading: "py-3",
      empty: "py-6",
      failed: "py-6",
      gone: "py-6",
    } satisfies Record<StateKind, string>,
  },
  defaultVariants: { kind: "loading" },
});

export const StateBlock = forwardRef<HTMLDivElement, StateBlockProps>(function StateBlock(
  { kind, what, error, children, skeleton },
  ref,
) {
  if (kind === "loading") {
    // The skeleton owns its own `role="status"` and its own sentence, so wrapping it in a second
    // live region would announce the same wait twice in two different vocabularies.
    if (skeleton !== undefined && skeleton !== null) {
      return (
        <div ref={ref} aria-busy="true" className={cn(block({ kind }))}>
          {skeleton}
        </div>
      );
    }

    return (
      <div ref={ref} aria-busy="true" className={cn(block({ kind }))}>
        <Inline gap={2} align="center">
          {/* `Spinner` is the live region: three lattice dots, never an arc, never lime. */}
          <Spinner label={`Reading ${what}`} size="sm" />
          {/* Visible for sighted readers only — the spinner already announced it. */}
          <span aria-hidden="true">
            <Text size="ui" tone="muted">
              {`Reading ${what}`}
            </Text>
          </span>
        </Inline>
      </div>
    );
  }

  if (kind === "failed") {
    return (
      <div ref={ref} role="alert" className={cn(block({ kind }))}>
        <Stack gap={3} align="start">
          <Measure width="read" as="p">
            <Text size="read" tone="soft" as="span">
              {`Reading ${what} failed.`}
            </Text>
          </Measure>

          {error === null || error === undefined ? null : (
            /*
              The machine's own words, quoted, never paraphrased (§7.4) — through the one well
              §4.3 specifies. `error` puts the word `error` beside the caption and moves the
              well's left edge to `critical`, so the failure is carried by the word, the edge and
              the ink at once and never by a colour alone (§4.2); the quotation itself stays
              `evidence`-inked, because recolouring it would say the WORDS are the error rather
              than that the read failed.
            */
            <div className="w-full max-w-[var(--measure-wide)]">
              <PayloadBlock caption="What came back" value={error.message} error />
            </div>
          )}

          {children}
        </Stack>
      </div>
    );
  }

  // `empty` and `gone` are the page's content rather than an event, so neither is announced.
  // Both are a serif sentence, upright, `ink-soft` — the product speaking, not a person (§4.7).
  //
  // `children` IS the sentence here, per the inventory's own note ("a serif sentence and a way
  // back"), so it REPLACES the default rather than following it — two sentences saying the same
  // thing is the double-speak this component exists to end. It is rendered inside the serif step
  // so a screen writes the words and gets the treatment without spelling `t-read` itself; a
  // `Button` or `Link` nested in it sets its own chrome step and wins by proximity.
  const sentence =
    kind === "empty" ? `There is nothing in ${what} yet.` : `There is no record of ${what}.`;

  return (
    <div ref={ref} className={cn(block({ kind }))}>
      <Measure width="read" as="div">
        <Text size="read" tone="soft" as="div">
          {children ?? sentence}
        </Text>
      </Measure>
    </div>
  );
});

import { forwardRef, type ReactNode } from "react";

import { cn } from "../cn.js";
import { Button, Inline, Spacer, Text } from "../atoms/index.js";

/**
 * ActionBar — the sticky foot of a page that makes something, beside `SaveBar`, which is the
 * sticky foot of a page that edits something.
 *
 * ATOMIC-INVENTORY §5 row 5 and §6.3 row 16 both ask for an `ActionBar` on `NewSimulation`, and
 * it was never built, so that screen was given `SaveBar` instead. The result is a page for
 * creating a simulation that opens saying *"Nothing changed yet"*, changes to *"Unsaved changes"*
 * as you fill it in, and offers a button labelled *"Save changes"* for an act that makes a
 * simulation that did not exist a moment ago. Every one of those words is about a record that is
 * already there.
 *
 * **The difference is not cosmetic.** A save is idempotent, repeatable and about a thing the
 * reader already owns; dirtiness is the right thing to report and "discard" is a real escape. A
 * commit happens once, and what the reader needs to know before it is *what it will do* and
 * *whether anything is stopping it* — which is why this bar's status line is either the reason it
 * cannot happen yet or a note about what happens next, and never a dirtiness flag.
 *
 * **The button names the act, in the product's own words** (§7.4) — "Create this simulation",
 * "Send them in", "Write them all". Never "Submit", never "Save changes", never "Execute". That
 * is the `label` prop and it is required: there is no default verb, because a default verb is how
 * a page ends up saying "Save changes" about a thing it is creating.
 *
 * **A held button never carries the reason on its own.** §1.2 makes a disabled control a colour
 * and nothing else, so `blockedBecause` is the sentence and the disabled state merely follows it.
 * A bar with nothing blocking it and nothing to add says nothing at all rather than inventing
 * reassurance.
 *
 * **Nothing here promises an outcome** (§7.3). This bar commits a thing; what an execution then
 * finds is not its to claim, and `note` at a call site must not claim it either.
 *
 * Related: `SaveBar` for a page that edits an existing thing. Where the act needs a question
 * asked before it happens — it spends real money, or it takes something away — the page keeps
 * that control of its own (`ConfirmButton`, which owns its `AlertDialog` and its pending state)
 * and hands it to `extra`, because a bar cannot ask a question on a caller's behalf.
 */

export interface ActionBarProps {
  /** The act, in the product's own words — "Create this simulation". Never "Save changes". */
  label: string;
  onAct: () => void;
  /** The act is in flight. The button keeps its width and shows the `Spinner` in its place. */
  pending?: boolean;
  /**
   * Why it cannot be done yet, in a sentence — "Give it a name first." The bar says it, and the
   * button is held while it is set. `undefined` means nothing is stopping it.
   */
  blockedBecause?: ReactNode;
  /**
   * What the act will do, for a bar that has something worth saying when nothing blocks it —
   * "Nothing is spent until you send them in." Shown only when `blockedBecause` is absent.
   */
  note?: ReactNode;
  /** The quiet way out, where the page has one. */
  onCancel?: () => void;
  /** Defaults to "Cancel", which is the one place a generic word is the right word. */
  cancelLabel?: string;
  /**
   * `danger` for an act that takes something away. Creating is `primary`; the two exist so that a
   * destructive commit does not have to borrow a create button's colour.
   */
  tone?: "primary" | "danger";
  /** Anything that belongs beside the act — a second, quieter route out of the page. */
  extra?: ReactNode;
}

export const ActionBar = forwardRef<HTMLDivElement, ActionBarProps>(function ActionBar(
  {
    label,
    onAct,
    pending = false,
    blockedBecause,
    note,
    onCancel,
    cancelLabel = "Cancel",
    tone = "primary",
    extra,
  },
  ref,
) {
  const blocked = blockedBecause !== undefined;
  const says = blocked ? blockedBecause : note;

  return (
    <div
      ref={ref}
      role="region"
      // Named for what it does, not for the component: a reader landing here by rotor wants to
      // know this is where the act is.
      aria-label={label}
      className={cn(
        // Sticky rather than fixed, exactly as `SaveBar` is: the bar belongs to the page's
        // column and stops at the end of it, instead of floating over whatever comes next.
        "sticky bottom-0 z-[var(--z-raised)]",
        "border-t border-rule bg-surface",
        "[--focus-sep:var(--color-surface)]",
        "px-4 py-3 md:px-6",
      )}
    >
      <Inline gap={3} align="center">
        {/*
          The reader is in the form while this changes — a name typed in is what unblocks it — so
          the news comes to them rather than waiting to be found. Polite: it is a state of the
          page, not an alert.
        */}
        <Text size="meta" tone={blocked ? "ink" : "muted"} as="div" className="min-w-0">
          <span aria-live="polite">{says}</span>
        </Text>
        <Spacer />
        {extra}
        {onCancel === undefined ? null : (
          <Button variant="quiet" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
        )}
        <Button variant={tone} onClick={onAct} disabled={blocked} pending={pending}>
          {label}
        </Button>
      </Inline>
    </div>
  );
});

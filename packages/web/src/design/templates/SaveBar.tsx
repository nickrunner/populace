import { forwardRef, type ReactNode } from "react";

import { cn } from "../cn.js";
import { Button, Inline, Spacer, Stack, Text } from "../atoms/index.js";
import { RelativeTime } from "../molecules/index.js";

/**
 * SaveBar — the sticky foot of a `FormPage` (ATOMIC-INVENTORY §4, template 5).
 *
 * Four editors in the product change something somebody typed, and today each of them puts its
 * own button somewhere different down the page, so the act is wherever the form happened to end.
 * This is one place for it, pinned to the bottom of the reading column, so a long form's save is
 * always in reach and the state of the form is always in the same sentence.
 *
 * **It says what state the form is in, and it says it in words** (§4.2, §7.4): *Unsaved
 * changes*, *Saving…*, *Saved* with when. The bar never relies on the button's own enabled-ness
 * to carry that, because a greyed button is a colour and nothing else.
 *
 * **The status line is polite and live.** A save that finishes while the reader is still in the
 * form is news they should get without going to look for it; `aria-live="polite"` waits its
 * turn, which is right for a confirmation and wrong for nothing here.
 *
 * **The button names the act** (§7.4) and takes `pending` rather than swapping its label, so the
 * bar does not change width while it is working. Nothing in this component promises that saving
 * changes what a future execution will find (§7.3) — it saves a form.
 *
 * **Amended for the builders — three things `ActionBar` had that an editor turned out to need.**
 * A builder in edit mode is a `SaveBar` (ATOMIC-INVENTORY §4, template 9), and an edit can be
 * refused for the same reasons a create can — a name emptied, a population unpicked — so
 * `blockedBecause` is the sentence and the held button follows it, exactly as on `ActionBar`; a
 * greyed "Save changes" with no reason beside it is §1.2's colour-and-nothing-else. `note` is the
 * sentence a save needs to carry when it is not the whole story — a longitudinal execution that
 * is running takes a change only through "Apply to the running execution", and the reader has to
 * be told that before pressing save, not after. `extra` is where that button lives: beside the
 * act, never inside the `<form>`, so it is not an implicit submit.
 */

export interface SaveBarProps {
  /** There are changes the reader has not saved. */
  dirty: boolean;
  /** A save is in flight. */
  saving: boolean;
  onSave: () => void;
  /** When the last successful save landed, ISO, or null if nothing has been saved yet. */
  savedAt: string | null;
  /** Offered only when there is something to throw away. */
  onDiscard?: () => void;
  /**
   * Why the changes cannot be saved yet, in a sentence — "Give it a name first." The bar says it
   * in place of "Unsaved changes" and the button is held while it is set. `undefined` means
   * nothing is stopping it.
   */
  blockedBecause?: ReactNode;
  /**
   * What saving will and will not do, when that is worth a sentence — "The running execution
   * takes this only through Apply." Shown beneath the status while there is something to save
   * and nothing blocking it; it never claims what a future execution will find (§7.3).
   */
  note?: ReactNode;
  /** Anything that belongs beside the act — a second route, such as applying to a running execution. */
  extra?: ReactNode;
}

export const SaveBar = forwardRef<HTMLDivElement, SaveBarProps>(function SaveBar(
  { dirty, saving, onSave, savedAt, onDiscard, blockedBecause, note, extra },
  ref,
) {
  const blocked = dirty && blockedBecause !== undefined;

  const status = saving ? (
    "Saving…"
  ) : blocked ? (
    blockedBecause
  ) : dirty ? (
    "Unsaved changes"
  ) : savedAt !== null ? (
    <>
      Saved <RelativeTime at={savedAt} mode="ago" />
    </>
  ) : (
    "Nothing changed yet"
  );

  // The note is about what a save would do, so it is shown only while a save is on offer.
  const says = dirty && !saving && !blocked ? note : undefined;

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Save"
      className={cn(
        // Sticky rather than fixed: it belongs to the form's column, not to the window, so it
        // stops at the end of the page instead of floating over the next screen's content.
        "sticky bottom-0 z-[var(--z-raised)]",
        "border-t border-rule bg-surface",
        "[--focus-sep:var(--color-surface)]",
        "px-4 py-3 md:px-6",
      )}
    >
      <Inline gap={3} align="center">
        {/* The reader is inside the form when this changes, so the news comes to them. */}
        <Stack gap={1} className="min-w-0">
          <Text size="meta" tone={dirty && !saving ? "ink" : "muted"} as="div">
            <span aria-live="polite">{status}</span>
          </Text>
          {says === undefined ? null : (
            <Text size="meta" tone="muted" as="div">
              {says}
            </Text>
          )}
        </Stack>
        <Spacer />
        {extra}
        {onDiscard === undefined ? null : (
          <Button variant="quiet" onClick={onDiscard} disabled={!dirty || saving}>
            Discard changes
          </Button>
        )}
        <Button variant="primary" onClick={onSave} disabled={!dirty || blocked} pending={saving}>
          Save changes
        </Button>
      </Inline>
    </div>
  );
});

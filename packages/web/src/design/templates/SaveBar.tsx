import { forwardRef } from "react";

import { cn } from "../cn.js";
import { Button, Inline, Spacer, Text } from "../atoms/index.js";
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
}

export const SaveBar = forwardRef<HTMLDivElement, SaveBarProps>(function SaveBar(
  { dirty, saving, onSave, savedAt, onDiscard },
  ref,
) {
  const status = saving ? (
    "Saving…"
  ) : dirty ? (
    "Unsaved changes"
  ) : savedAt !== null ? (
    <>
      Saved <RelativeTime at={savedAt} mode="ago" />
    </>
  ) : (
    "Nothing changed yet"
  );

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
        <Text size="meta" tone={dirty && !saving ? "ink" : "muted"} as="div" className="min-w-0">
          <span aria-live="polite">{status}</span>
        </Text>
        <Spacer />
        {onDiscard === undefined ? null : (
          <Button variant="quiet" onClick={onDiscard} disabled={!dirty || saving}>
            Discard changes
          </Button>
        )}
        <Button variant="primary" onClick={onSave} disabled={!dirty} pending={saving}>
          Save changes
        </Button>
      </Inline>
    </div>
  );
});

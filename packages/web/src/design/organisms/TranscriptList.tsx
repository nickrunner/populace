import { forwardRef, useCallback, useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";

import { cn } from "../cn.js";
import { focusRing } from "../variants.js";
import { Chip, ScrollArea, Separator, Text, VisuallyHidden } from "../atoms/index.js";
import { StateBlock } from "../molecules/index.js";
import { TranscriptRow, transcriptOptionId } from "./TranscriptRow.js";
import type { TranscriptStep } from "./TranscriptRow.js";

/**
 * TranscriptList — the visit, step by step (ATOMIC-INVENTORY §3, organism 25).
 *
 * The most component-hungry surface in the product, and the one the survey found in the worst
 * state: two hundred `<button>`s in a row, no focus style on any of them, and the sequence number
 * and call ref set inline where nothing could scan them. This is the ledger answer.
 *
 * **One spine, one stub, square rows** (§1.2 M2). The 72px stub is a real grid column and the
 * spine is a single 1px rule drawn once down the list, not two hundred borders. Below
 * `--breakpoint-md` the grid collapses to one column and each row's stub becomes its leading
 * line, which is the responsive behaviour the stub was designed to have.
 *
 * **One tab stop, not two hundred** (§6). The list is a roving-tabindex composite: `role="listbox"`
 * on a single focusable element, `aria-activedescendant` pointing at the current option, arrows
 * and Home/End to move, Enter and Space to reaffirm. Selection follows the arrow keys, which is
 * the ARIA pattern for a listbox whose current option is rendered in a pane beside it, and it is
 * what `TranscriptRowProps` supports: a row is told whether it is `selected` and nothing else, so
 * the selected option and the active descendant are deliberately the same row.
 *
 * **Nothing here animates and nothing re-renders under the reader** (§5.1). Rows are keyed by step
 * id and memoised, their `onSelect` handlers are cached so the memo actually holds across a
 * two-second poll, and arriving steps never steal the selection — the reader stays on the step
 * they were reading. The only motion is `scrollIntoView({ block: "nearest" })`, which does nothing
 * when the selected row is already on screen.
 *
 * **A live transcript announces a number, not a row** (§6). Reading every arriving step aloud is
 * unusable; a polite status naming the newest step number is not.
 */

export interface TranscriptListProps {
  steps: readonly TranscriptStep[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  live: boolean;
}

/** Where the arrow keys can land, given the step that is selected now. */
function nextIndex(
  key: string,
  current: number,
  count: number,
): number | null {
  switch (key) {
    case "ArrowDown":
      return Math.min(count - 1, current + 1);
    case "ArrowUp":
      return Math.max(0, current - 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case "PageDown":
      return Math.min(count - 1, current + 10);
    case "PageUp":
      return Math.max(0, current - 10);
    default:
      return null;
  }
}

export const TranscriptList = forwardRef<HTMLDivElement, TranscriptListProps>(
  function TranscriptList({ steps, selectedId, onSelect, live }, ref) {
    /**
     * One stable handler per step id. Without this every row would take a fresh closure on every
     * poll and the memo on `TranscriptRow` would buy nothing at all.
     */
    const handlers = useRef(new Map<string, () => void>());
    const handlerFor = useCallback(
      (id: string): (() => void) => {
        const cached = handlers.current.get(id);
        if (cached !== undefined) return cached;
        const made = (): void => {
          onSelect(id);
        };
        handlers.current.set(id, made);
        return made;
      },
      [onSelect],
    );

    // The selected step is the active descendant, so keeping it on screen is the whole of the
    // scroll behaviour. `nearest` is a no-op when the row is already visible, which is what keeps a
    // polling list from scrolling itself.
    useEffect(() => {
      if (selectedId === null) return;
      const element = document.getElementById(transcriptOptionId(selectedId));
      element?.scrollIntoView({ block: "nearest" });
    }, [selectedId]);

    const index = steps.findIndex((step) => step.id === selectedId);

    const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
      if (steps.length === 0) return;
      if (event.key === "Enter" || event.key === " ") {
        const current = steps[index === -1 ? 0 : index];
        if (current !== undefined) {
          event.preventDefault();
          onSelect(current.id);
        }
        return;
      }
      const moved = nextIndex(event.key, index === -1 ? -1 : index, steps.length);
      if (moved === null) return;
      const target = steps[moved];
      if (target === undefined) return;
      event.preventDefault();
      onSelect(target.id);
    };

    const newest = steps[steps.length - 1] ?? null;

    return (
      <div ref={ref} className="min-w-0">
        <div
          className={cn(
            // `pl-[3px]` matches the 3px selected edge every row reserves, so the column head sits
            // exactly over the sequence numbers beneath it.
            "grid grid-cols-1 items-baseline pb-1.5 pl-[3px]",
            "md:grid-cols-[var(--w-stub)_minmax(0,1fr)]",
          )}
        >
          <Text size="label" tone="muted" className="pl-2 md:pl-0 md:pr-2.5 md:text-right">
            step
          </Text>
          <span className="flex items-baseline gap-2 pl-2 pr-2 md:pl-3">
            <Text size="meta" tone="muted">
              Pick a step to inspect it
            </Text>
            {live ? (
              <span className="ml-auto">
                <Chip tone="live">live</Chip>
              </span>
            ) : null}
          </span>
        </div>
        <Separator />

        {steps.length === 0 ? (
          <StateBlock kind="empty" what="this visit">
            This visit recorded no steps.
          </StateBlock>
        ) : (
          <ScrollArea
            maxHeight="60vh"
            // The list below is the composite and owns the keyboard, so the viewport takes no
            // tab stop of its own — §6 gives the transcript exactly one.
            focusable={false}
          >
            <ul
              role="listbox"
              tabIndex={0}
              aria-label="The visit, step by step"
              aria-activedescendant={
                selectedId === null ? undefined : transcriptOptionId(selectedId)
              }
              onKeyDown={onKeyDown}
              className={cn(
                "relative rounded-none",
                // The one continuous spine, at the stub's right edge, drawn once for the whole
                // list rather than as a border on each of two hundred rows. The 3px is the edge
                // every row reserves for selection, which the stub column starts after.
                "md:before:absolute md:before:inset-y-0 md:before:left-[calc(var(--w-stub)+3px)]",
                "md:before:w-px md:before:bg-rule md:before:content-['']",
                focusRing,
              )}
            >
              {steps.map((step) => (
                <TranscriptRow
                  key={step.id}
                  {...step}
                  selected={step.id === selectedId}
                  onSelect={handlerFor(step.id)}
                />
              ))}
            </ul>
          </ScrollArea>
        )}

        {live && newest !== null ? (
          <VisuallyHidden>
            <span role="status" aria-live="polite">
              step {newest.seq}
            </span>
          </VisuallyHidden>
        ) : null}
      </div>
    );
  },
);

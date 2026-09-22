import { forwardRef, type ReactNode } from "react";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";

import { cn } from "../cn.js";
import { ringRoomX } from "../variants.js";
import { Button, Icon, Text } from "../atoms/index.js";

/**
 * Disclosure — a labelled section that folds away (ATOMIC-INVENTORY §2, molecule 33).
 *
 * Five sites: the known-problems list, triage, the cohort cards, the get-started steps and the
 * over-long payload well. Two of them are bare toggles today with no `aria-expanded`, no
 * `aria-controls` and no relationship at all between the button and the thing it hides, so a
 * screen reader is told a button exists and nothing about what it does. Radix `Collapsible`
 * supplies all three, and the trigger is a real `Button` rather than a copy of its class string.
 *
 * **The count belongs on the trigger.** A fold that says "Known problems" asks the reader to open
 * it to find out whether opening it was worth it; "Known problems 7" does not.
 *
 * **Motion, and why it is drawn this way.** §5.1 gives the disclosure 160ms of height and
 * opacity, and `--dur-disclose` is that number. A height transition needs a height, and the only
 * one available is `auto`, which does not interpolate — so the fold is a one-row grid whose track
 * goes `0fr` → `1fr`. That is a plain transition on a property that *does* interpolate, it needs
 * no keyframes, and it measures the content itself rather than trusting a number someone typed.
 *
 * The content is `forceMount`ed for the same reason: Radix only waits for a CSS *animation*
 * before unmounting, so a transition-driven close would have the content vanish on the first
 * frame and collapse an empty box. Mounted-but-closed content would still be read aloud, so the
 * closed state is `visibility: hidden`, which takes it out of the accessibility tree; `visible`
 * is held for the whole duration when it is an endpoint, so opening is not a flash and closing
 * still animates all the way down before it goes quiet.
 *
 * Under `prefers-reduced-motion` the global override in `theme.css` collapses every duration
 * here to nothing and the fold simply is or is not, which is the correct substitution for a
 * disclosure — unlike the live dot, it carries no meaning in its motion.
 */

/** The fold itself. See the note above for why it is a grid track rather than a height. */
const foldShell = [
  "grid grid-rows-[0fr] data-[state=open]:grid-rows-[1fr]",
  "invisible data-[state=open]:visible",
  "opacity-0 data-[state=open]:opacity-100",
  "transition-[grid-template-rows,opacity,visibility]",
  "[transition-duration:var(--dur-disclose)]",
  "[transition-timing-function:var(--ease)]",
].join(" ");

/**
 * The chevron points along the reading direction when closed and down into the content when
 * open, which is the one rotation in the system: it is an affordance turning, not a mark moving.
 */
const chevron = [
  "text-ink-muted",
  "transition-transform",
  "[transition-duration:var(--dur-disclose)]",
  "[transition-timing-function:var(--ease)]",
  "group-data-[state=open]:rotate-90",
].join(" ");

export interface DisclosureProps {
  /** Always a word or a phrase, sentence case (§7.4). Never a glyph alone. */
  label: string;
  /** How many records are folded away. Tabular by construction (§4.4). */
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}

export const Disclosure = forwardRef<HTMLDivElement, DisclosureProps>(function Disclosure(
  { label, count, defaultOpen = false, children },
  ref,
) {
  return (
    <CollapsiblePrimitive.Root ref={ref} defaultOpen={defaultOpen}>
      <CollapsiblePrimitive.Trigger asChild>
        {/*
         * `-mx-2` against the button's own `px-2`: the label sits flush with the content beneath
         * it while the hover ground still has room to read as a target. `group` is what lets the
         * chevron see the trigger's `data-state` — the flip is a CSS selector, never a branch.
         */}
        <Button variant="quiet" size="sm" fullWidth className="group -mx-2 justify-start">
          <Icon name="chevron-right" className={chevron} />
          <Text size="ui" tone="ink">
            {label}
          </Text>
          {count === undefined ? null : (
            <Text size="meta" tone="muted">
              {count}
            </Text>
          )}
        </Button>
      </CollapsiblePrimitive.Trigger>

      <CollapsiblePrimitive.Content forceMount className={cn(foldShell)}>
        {/*
         * Two wrappers, both earning their place: the outer one is the grid item, which must be
         * able to shrink below its content (`min-h-0`) and clip what overflows; the inner one
         * carries the gap to the trigger, because padding on a grid item whose track is `0fr`
         * would keep the fold from closing the last few pixels.
         *
         * The outer one clips on BOTH axes, though only the vertical clip is wanted — there is
         * no way to spell `overflow-x: visible` beside a clipped y — so a control inside a fold
         * lost the sides of its focus ring. `ringRoomX` gives them back without moving anything.
         */}
        <div className={cn("min-h-0 overflow-hidden", ringRoomX)}>
          {/*
           * `pb-1` is the ring's room at the foot of the fold, and it is real padding rather
           * than `ringRoom`'s cancelled pair: the vertical clip is what closes this thing, so it
           * cannot be loosened. 4px of space under the last row is the whole cost.
           */}
          <div className="pt-2 pb-1">{children}</div>
        </div>
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
});

import { forwardRef, type ReactNode } from "react";
import * as RadixScrollArea from "@radix-ui/react-scroll-area";
import { cn } from "../cn.js";
import { focusRing, stateTransition } from "../variants.js";

/**
 * The bounded region — ATOMIC-INVENTORY §1 atom 33.
 *
 * Replaces the four raw `overflow-y-auto` containers: the transcript, the payload well, the live
 * feed and the roster. Two things it buys that the raw utility does not.
 *
 * **A scrollbar drawn in our own tokens.** The platform's is either a grey slab that fights the
 * forest ground or, on a trackpad, invisible until it moves — which in a dense instrument leaves
 * a reader with no signal that 180 more rows exist. The thumb here is `rule-strong`, the one
 * border token that clears 3:1, so it is a legible mark in both themes.
 *
 * **A keyboard-operable region.** A scroll container is focusable in Firefox and nowhere else,
 * so a keyboard user cannot reach an overflowing payload at all unless the viewport takes a tab
 * stop. It does, and it wears the one focus ring like every other focusable thing (§4.6).
 *
 * **`focusable` is how a composite takes that tab stop back**, and it is the whole of the
 * prop's job. DESIGN-SYSTEM §6 fixes the transcript list, the live feed and the project switcher
 * at **one tab stop each**; a roving-tabindex composite already *is* that one stop, so wrapping
 * it in a focusable viewport gives the region two — the reader tabs into a scroll box, tabs
 * again into the listbox, and Shift+Tab walks back out through a stop that does nothing. Any
 * child that owns the arrow keys passes `focusable={false}`.
 *
 * It defaults to **on**, deliberately, and that is the one place this atom prefers its default
 * over the §6 sentence: most bounded regions here are static machine output — a 300-line payload
 * well — where the viewport is the *only* possible tab stop, and a default of off would take
 * keyboard scrolling away from every future caller silently. Off is a claim about the child, so
 * the child's author makes it.
 *
 * `maxHeight` is a free CSS length rather than a token union because the callers are genuinely
 * various — `60vh` for the transcript, `--w-stub`-derived heights for the roster — and it is
 * applied as a style rather than a class because a class cannot be composed at runtime.
 */
export interface ScrollAreaProps {
  /** Any CSS length: `"60vh"`, `"320px"`, `"calc(100vh - 220px)"`. */
  maxHeight: string;
  /**
   * Default `true`. Pass `false` when the child owns the keyboard — a roving-tabindex composite
   * — so the region keeps the one tab stop §6 gives it rather than two.
   */
  focusable?: boolean;
  className?: string;
  children: ReactNode;
}

export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea(
  { maxHeight, focusable = true, className, children },
  ref,
) {
  return (
    <RadixScrollArea.Root
      type="auto"
      className={cn("relative overflow-hidden", className)}
      style={{ maxHeight }}
    >
      <RadixScrollArea.Viewport
        ref={ref}
        // Not `tabIndex={focusable ? 0 : -1}`: −1 would still make the viewport a focus target
        // for a click, which moves focus off the composite the reader was operating.
        tabIndex={focusable ? 0 : undefined}
        className={cn("h-full w-full rounded-none", focusable ? focusRing : "")}
      >
        {children}
      </RadixScrollArea.Viewport>
      <RadixScrollArea.Scrollbar
        orientation="vertical"
        className={cn(
          "flex touch-none select-none p-0.5",
          "w-2.5 border-l border-rule bg-transparent",
          stateTransition,
        )}
      >
        <RadixScrollArea.Thumb className="relative flex-1 rounded-full bg-rule-strong" />
      </RadixScrollArea.Scrollbar>
      <RadixScrollArea.Scrollbar
        orientation="horizontal"
        className={cn(
          "flex touch-none select-none flex-col p-0.5",
          "h-2.5 border-t border-rule bg-transparent",
          stateTransition,
        )}
      >
        <RadixScrollArea.Thumb className="relative flex-1 rounded-full bg-rule-strong" />
      </RadixScrollArea.Scrollbar>
      <RadixScrollArea.Corner className="bg-transparent" />
    </RadixScrollArea.Root>
  );
});

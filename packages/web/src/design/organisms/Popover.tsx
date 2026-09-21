import * as PopoverPrimitive from "@radix-ui/react-popover";
import { forwardRef, type ComponentRef, type ReactElement, type ReactNode } from "react";

import { cn } from "../cn.js";
import { focusRing, surfaceBase } from "../variants.js";

/**
 * Popover — ATOMIC-INVENTORY §3, organism 9. Radix `react-popover`. Three sites, all new.
 *
 * **What separates this from a `Tooltip`.** A tooltip explains; a popover *contains* — a filter
 * set, a cohort's numbers, a few controls. The difference is interactive content, and that is
 * why this one is a focus-managed, Escape-closing, click-opening surface rather than a hover
 * one. A tooltip that has a button in it is a keyboard trap; this is the component to reach for
 * the moment that is tempting.
 *
 * **What separates it from a `Dialog`.** A popover is anchored and non-modal: it does not dim
 * the page, does not trap focus, and the screen behind it stays readable — which is the point,
 * because its content is usually *about* something still on screen.
 *
 * **There is no arrow.** The mark contains no diagonal and no sharp inside corner (§8.6), and a
 * triangle would be the only one in the product. Position is carried by the 4px entry offset
 * instead, which is what §5.1 specifies for every overlay anyway — the panel appears to emerge
 * from its trigger.
 *
 * **Elevation is a composite token, never a theme branch** (§2.5, §6.2). `surfaceBase({ level:
 * "overlay" })` gives the 12px container radius (§5.2), the `surface` ground, `--shadow-over`,
 * and a boundary that is a hairline in light and `rule-strong` in dark. Dark elevation is
 * **border-led** — `#2C3730` on `#202823` is 1.22:1, so no fill difference will read there and
 * the hairline does all of it. Nothing here asks TypeScript what the theme is.
 */

const panel = cn(
  "populace-pop",
  surfaceBase({ level: "overlay" }),
  focusRing,
  "z-[var(--z-overlay)]",
  // Wide enough for a filter set or a small table of figures; capped so a popover never becomes
  // a page. Content taller than the viewport scrolls inside its own panel rather than clipping.
  "w-[min(22rem,calc(100vw-2rem))] max-h-[min(24rem,calc(100dvh-4rem))] overflow-y-auto",
  "p-4",
);

/**
 * Entry and exit, per §5.1: `opacity` 0→1 with a 4px `translateY`, 240ms in on `--ease`, 180ms
 * out — 0.75× the entry — on `--ease-exit`.
 *
 * The travel comes *from* the side Radix chose, which is a `data-side` flip in CSS rather than a
 * branch in TypeScript. Under `prefers-reduced-motion` theme.css collapses the duration to
 * 0.01ms and `animation-fill-mode: both` holds the panel at its final frame, so it appears.
 */
const POPOVER_CSS = `
.populace-pop[data-side="top"]    { --pop-x: 0px; --pop-y: 4px; }
.populace-pop[data-side="bottom"] { --pop-x: 0px; --pop-y: -4px; }
.populace-pop[data-side="left"]   { --pop-x: 4px; --pop-y: 0px; }
.populace-pop[data-side="right"]  { --pop-x: -4px; --pop-y: 0px; }

.populace-pop[data-state="open"] {
  animation: populace-pop-in var(--dur-enter) var(--ease) both;
}
.populace-pop[data-state="closed"] {
  animation: populace-pop-out calc(var(--dur-enter) * 0.75) var(--ease-exit) both;
}

@keyframes populace-pop-in {
  from { opacity: 0; transform: translate(var(--pop-x, 0px), var(--pop-y, -4px)); }
  to   { opacity: 1; transform: translate(0px, 0px); }
}
@keyframes populace-pop-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}
`;

export interface PopoverProps {
  /** The element that opens it. Slotted via `asChild`, so it keeps its own appearance. */
  trigger: ReactElement;
  children: ReactNode;
  /**
   * What the panel is about — "Filters", "Where this cohort went". Becomes its `aria-label`, so
   * a screen reader landing in it is told what it landed in. Never a fact available nowhere
   * else.
   */
  label: string;
}

export const Popover = forwardRef<ComponentRef<typeof PopoverPrimitive.Content>, PopoverProps>(
  function Popover({ trigger, children, label }, ref) {
    return (
      <PopoverPrimitive.Root>
        <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>

        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            ref={ref}
            aria-label={label}
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={8}
            className={panel}
          >
            {children}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>

        {/* React 19 hoists and de-duplicates this by `href`, so N popovers emit one rule set. */}
        <style href="populace-popover" precedence="medium">
          {POPOVER_CSS}
        </style>
      </PopoverPrimitive.Root>
    );
  },
);

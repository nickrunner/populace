import {
  createContext,
  forwardRef,
  useContext,
  type ComponentRef,
  type ReactElement,
  type ReactNode,
} from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "../cn.js";
import { surfaceBase } from "../variants.js";

/**
 * Tooltip — atom 30. Radix, replacing the 14 bare `title=` attributes in the app.
 *
 * `title=` is unreachable by keyboard, invisible to touch, unstyleable, and on several screens it
 * is the *only* place a fact lives — §6 names the execution dot strip's count as exactly that
 * bug, and moving it into the DOM is part of the port. So the contract of this atom is narrow:
 *
 * > **A tooltip explains; it never carries information available nowhere else.**
 *
 * The one place a tooltip is mandatory is an `IconButton`, where §6 requires both an `aria-label`
 * and a tooltip, because "an instrument is labelled".
 *
 * Radix gives Escape, focus-triggered opening, correct `aria-describedby` wiring and collision
 * handling for free. **There is no arrow**: the mark contains no diagonal and no sharp inside
 * corner (§8.6), and a triangle would be the only one in the product. Position is carried by the
 * 4px entry offset instead, which is what §5.1 specifies for every overlay anyway.
 *
 * **The provider is the app's, not the tooltip's.** `skipDelayDuration` is the grace window in
 * which moving from one trigger to the next opens instantly, and it is a property *of the group
 * of triggers* — a provider mounted inside each tooltip has exactly one trigger under it, so the
 * window can never apply and a toolbar of `IconButton`s re-serves the full 300ms delay on every
 * hover, which reads as the instrument being slow. `TooltipProvider` therefore goes once, at the
 * top of the tree: `AppShell` mounts it for the product, and any other root that draws tooltips
 * mounts its own.
 *
 * A stray tooltip outside every provider would throw — Radix's context has no default — so this
 * atom wraps itself in one when it finds no provider above it. That fallback is a crash guard and
 * nothing more: it is one trigger under one provider, so it is exactly the behaviour the app
 * provider exists to replace, and a screen that hits it should be mounting a provider instead.
 */

/**
 * True only beneath `TooltipProvider`. A flag of our own rather than a read of Radix's context,
 * which is scoped and not exported.
 */
const ProvidedContext = createContext(false);

export interface TooltipProviderProps {
  children: ReactNode;
}

/**
 * The one provider. `delayDuration` is the wait before the first tooltip of a group opens;
 * `skipDelayDuration` is how long after one closes that the next opens with no wait at all.
 */
export function TooltipProvider({ children }: TooltipProviderProps) {
  return (
    <ProvidedContext.Provider value={true}>
      <TooltipPrimitive.Provider delayDuration={300} skipDelayDuration={300}>
        {children}
      </TooltipPrimitive.Provider>
    </ProvidedContext.Provider>
  );
}
export interface TooltipProps {
  /** What the tooltip explains. Prose, not a fact that lives nowhere else. */
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  /** The trigger. Rendered via `asChild`, so it must accept a ref and spread props. */
  children: ReactElement;
}

/**
 * Entry and exit, per §5.1: `opacity` 0→1 with a 4px `translateY`, 240ms in on `--ease`, 180ms
 * out (0.75× the entry) on `--ease-exit`.
 *
 * The 4px travel comes *from* the side Radix chose, so the tooltip always appears to emerge from
 * its trigger. That is a `data-side` flip in CSS rather than a branch in TypeScript, exactly as
 * the theme flips are. Under `prefers-reduced-motion` theme.css collapses the duration to 0.01ms
 * and `animation-fill-mode: both` leaves the panel at its final frame, so it simply appears.
 */
const TOOLTIP_CSS = `
.populace-tip[data-side="top"]    { --tip-x: 0px; --tip-y: 4px; }
.populace-tip[data-side="bottom"] { --tip-x: 0px; --tip-y: -4px; }
.populace-tip[data-side="left"]   { --tip-x: 4px; --tip-y: 0px; }
.populace-tip[data-side="right"]  { --tip-x: -4px; --tip-y: 0px; }

.populace-tip[data-state="delayed-open"],
.populace-tip[data-state="instant-open"] {
  animation: populace-tip-in var(--dur-enter) var(--ease) both;
}
.populace-tip[data-state="closed"] {
  animation: populace-tip-out calc(var(--dur-enter) * 0.75) var(--ease-exit) both;
}

@keyframes populace-tip-in {
  from { opacity: 0; transform: translate(var(--tip-x, 0px), var(--tip-y, 4px)); }
  to   { opacity: 1; transform: translate(0px, 0px); }
}
@keyframes populace-tip-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}
`;

export const Tooltip = forwardRef<
  ComponentRef<typeof TooltipPrimitive.Content>,
  TooltipProps
>(function Tooltip({ content, side = "top", children }, ref) {
  const provided = useContext(ProvidedContext);

  const tip = (
    <>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            ref={ref}
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className={cn(
              "populace-tip",
              // 12px radius, `surface` ground, hairline in light and `rule-strong` in dark, and
              // the overlay shadow — all §2.5 composites, so nothing here asks what the theme is.
              surfaceBase({ level: "overlay" }),
              // Chrome type: a tooltip is a dense container, so §3.1's threshold rule puts its
              // text in Space Grotesk even when it is a whole sentence.
              "t-ui text-ink",
              "px-2.5 py-1.5",
              "max-w-[var(--measure-statement)]",
              "z-[var(--z-overlay)]",
            )}
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
      {/* React 19 hoists and de-duplicates this by `href`, so N tooltips emit one rule set. */}
      <style href="populace-tooltip" precedence="medium">
        {TOOLTIP_CSS}
      </style>
    </>
  );

  return provided ? tip : <TooltipProvider>{tip}</TooltipProvider>;
});

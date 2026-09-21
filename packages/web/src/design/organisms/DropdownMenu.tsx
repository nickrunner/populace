import * as MenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cva } from "class-variance-authority";
import { forwardRef, type ComponentRef, type ReactElement, type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";

import { cn } from "../cn.js";
import { focusRing, pressTransition, surfaceBase } from "../variants.js";

/**
 * DropdownMenu — ATOMIC-INVENTORY §3, organism 8. Radix `react-dropdown-menu`. Four sites.
 *
 * **What it replaces is an accessibility bug, not a style.** The project switcher is today a
 * `<button aria-expanded>` plus an absolutely positioned `<div>` with no Escape handler, no
 * focus trap and no outside-click close: a keyboard user can open it and never close it
 * (DESIGN-SYSTEM §6). Radix supplies Escape, the outside click, focus return to the trigger,
 * typeahead, arrow-key roving and `aria-activedescendant`-equivalent semantics — one tab stop
 * for the whole menu instead of one per item.
 *
 * **A menu item is a control, so it takes the 6px radius** (§5.2) and the 90ms colour-only
 * hover of §5.1. Nothing about its geometry moves. Highlight is `hover` — the system's one
 * tinted-ground meaning for "you are on this" — and never a fill of `primary`, which §4.1
 * reserves for the thing you act on and where you are.
 *
 * **`tone: "danger"` is `critical` ink on a transparent ground**, never a red row. It names the
 * risk; it does not shout it, exactly as `Button`'s `danger` does not. An item that actually
 * destroys something should still hand off to `AlertDialog` — the menu closes, the question is
 * asked.
 *
 * **Elevation is a composite token, never a theme branch** (§2.5, §6.2): the panel is
 * `surfaceBase({ level: "overlay" })`, whose boundary is a hairline in light and `rule-strong`
 * in dark, with `--shadow-over` doing the rest. Dark elevation is border-led.
 */

/**
 * `data-highlighted` is Radix's own flag and covers pointer hover *and* keyboard arrowing with
 * one rule, which is why there is no `:hover` here: a mouse and a Down-arrow must light the same
 * row the same way, and two separate rules drift.
 *
 * Disabled is carried by a colour token rather than by opacity, so a disabled item stays legible
 * on both grounds (§1.2's rule for every control).
 */
const menuItem = cva(
  [
    "relative flex w-full cursor-pointer select-none items-center",
    "t-ui text-left",
    "rounded-sm px-2.5 py-1.5",
    "outline-none",
    pressTransition,
    focusRing,
    "data-[highlighted]:bg-hover",
    "data-[disabled]:cursor-not-allowed data-[disabled]:text-ink-muted data-[disabled]:bg-transparent",
  ].join(" "),
  {
    variants: {
      tone: {
        default: "text-ink",
        danger: "text-critical",
      },
    },
    defaultVariants: { tone: "default" },
  },
);

const panel = cn(
  "populace-menu",
  surfaceBase({ level: "overlay" }),
  "z-[var(--z-overlay)]",
  "min-w-[var(--radix-dropdown-menu-trigger-width)] max-w-[18rem]",
  "p-1",
);

/**
 * Entry and exit, per §5.1: `opacity` 0→1 with a 4px `translateY`, 240ms in on `--ease`, 180ms
 * out — 0.75× the entry — on `--ease-exit`.
 *
 * The 4px of travel comes *from* the side Radix chose, so the menu always appears to emerge from
 * its trigger. That is a `data-side` flip in CSS rather than a branch in TypeScript, exactly as
 * the theme flips are. Under `prefers-reduced-motion` theme.css collapses the duration to
 * 0.01ms and `animation-fill-mode: both` holds the final frame, so it simply appears.
 */
const MENU_CSS = `
.populace-menu[data-side="top"]    { --menu-x: 0px; --menu-y: 4px; }
.populace-menu[data-side="bottom"] { --menu-x: 0px; --menu-y: -4px; }
.populace-menu[data-side="left"]   { --menu-x: 4px; --menu-y: 0px; }
.populace-menu[data-side="right"]  { --menu-x: -4px; --menu-y: 0px; }

.populace-menu[data-state="open"] {
  animation: populace-menu-in var(--dur-enter) var(--ease) both;
}
.populace-menu[data-state="closed"] {
  animation: populace-menu-out calc(var(--dur-enter) * 0.75) var(--ease-exit) both;
}

@keyframes populace-menu-in {
  from { opacity: 0; transform: translate(var(--menu-x, 0px), var(--menu-y, -4px)); }
  to   { opacity: 1; transform: translate(0px, 0px); }
}
@keyframes populace-menu-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}
`;

export interface DropdownMenuItem {
  /**
   * The act or the destination, in the product's own words. Always words — never a glyph.
   *
   * It is a `ReactNode` rather than a `string` because a menu row often carries a name and a
   * fact about it, and §4.5 forbids the obvious way to write that: facts are separated by a
   * hairline, not by a middle dot. A caller hands over a `MetaLine` and the rule is drawn; there
   * is nowhere in this API to put a `·`. A node label must bring `textValue` with it.
   */
  label: ReactNode;
  /**
   * What typeahead matches and what the row is called when the label is not plain text. Radix
   * reads an item's text content otherwise, which a nested element hides from it.
   */
  textValue?: string;
  /** A route. Mutually exclusive with `onSelect` in practice; `to` wins if both are given. */
  to?: string;
  onSelect?: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
}

export interface DropdownMenuProps {
  /** The element that opens it. Slotted via `asChild`, so it keeps its own appearance. */
  trigger: ReactElement;
  items: readonly DropdownMenuItem[];
  /** What the menu is a menu of — "Project actions". Becomes the panel's `aria-label`. */
  label: string;
}

export const DropdownMenu = forwardRef<
  ComponentRef<typeof MenuPrimitive.Content>,
  DropdownMenuProps
>(function DropdownMenu({ trigger, items, label }, ref) {
  return (
    <MenuPrimitive.Root>
      <MenuPrimitive.Trigger asChild>{trigger}</MenuPrimitive.Trigger>

      <MenuPrimitive.Portal>
        <MenuPrimitive.Content
          ref={ref}
          aria-label={label}
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className={panel}
        >
          {items.map((item, index) => {
            const classes = cn(menuItem({ tone: item.tone ?? "default" }));
            // A label that is not a string hides the row's own words from Radix's typeahead and
            // from the accessible name it derives from text content, so the caller supplies them.
            const textValue = item.textValue ?? (typeof item.label === "string" ? item.label : "");
            // The label is a node now, so it cannot be part of the key. Position is stable here:
            // a menu is a fixed list handed over whole, never a reordered one.
            const key = `${item.to ?? "action"}-${String(index)}`;

            // A navigating item is an anchor, so middle-click, copy-link and the browser's own
            // status bar all work. `onSelect` still fires — Radix closes the menu on it — and
            // the router handles the navigation from the click.
            if (item.to !== undefined) {
              return (
                <MenuPrimitive.Item
                  key={key}
                  asChild
                  disabled={item.disabled}
                  textValue={textValue}
                  onSelect={item.onSelect}
                >
                  <RouterLink to={item.to} className={classes}>
                    {item.label}
                  </RouterLink>
                </MenuPrimitive.Item>
              );
            }

            return (
              <MenuPrimitive.Item
                key={key}
                disabled={item.disabled}
                textValue={textValue}
                className={classes}
                onSelect={item.onSelect}
              >
                {item.label}
              </MenuPrimitive.Item>
            );
          })}
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>

      {/* React 19 hoists and de-duplicates this by `href`, so N menus emit one rule set. */}
      <style href="populace-menu" precedence="medium">
        {MENU_CSS}
      </style>
    </MenuPrimitive.Root>
  );
});

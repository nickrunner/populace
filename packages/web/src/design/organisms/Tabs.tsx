import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cva } from "class-variance-authority";
import { forwardRef, type ComponentRef, type ReactNode } from "react";

import { cn } from "../cn.js";
import { focusRing, pressTransition } from "../variants.js";
import { Separator, Text } from "../atoms/index.js";

/**
 * Tabs — ATOMIC-INVENTORY §3, organism 10. Radix `react-tabs`. Two sites; new. The target's
 * sections are the first.
 *
 * **Selection is `primary-wash` with `primary` ink, and that is not a free choice.** §4.1 gives
 * `primary` exactly this job — *the thing you act on, and where you are* — which is what a
 * selected tab is, and it is the same language `NavItem` uses for the rail. Lime is not an
 * option: `#D7F56B` on paper is 1.08:1, and §5.4's lime law admits five appearances of which a
 * tab is not one. An underline is not an option either — the system has **no 2px border**
 * outside the focus ring, the payload well's evidence edge and the 3px selected-row edge (§2.6),
 * and inventing a fourth would be inventing a rule.
 *
 * **6px radius, because a tab is a control** (§5.2 names tabs among the controls), and the 90ms
 * colour-only transition of §5.1. Nothing about a tab's geometry moves on hover or selection;
 * the list is seated on one hairline `Separator` that runs to the content width, which is the
 * same rule a `Section` header draws.
 *
 * **Keyboard operation comes from Radix**: one tab stop for the whole list, arrows to move,
 * Home/End, and `aria-controls`/`aria-labelledby` wiring between each tab and the panel. The
 * activation is automatic — arrowing changes the panel — because these panels are cheap local
 * switches, not fetches.
 *
 * **One panel, deliberately.** The inventory's signature takes a single `children`, not one
 * child per tab: the caller switches its own content on the same `value` it already holds. So
 * exactly one `Content` is mounted, carrying the active value — which means the panel is
 * labelled by the tab that is actually selected, and an inactive tab's subtree never renders
 * under a live poll.
 */

const tab = cva(
  [
    "relative inline-flex items-center gap-1.5 whitespace-nowrap select-none",
    "t-ui",
    "rounded-sm px-2.5 py-1",
    "outline-none",
    pressTransition,
    focusRing,
    // 24×24px is the floor for every control (§6), and on a coarse pointer the target grows to
    // 44px through a box that does not touch layout.
    "pointer-coarse:after:absolute pointer-coarse:after:top-1/2 pointer-coarse:after:left-1/2",
    "pointer-coarse:after:h-11 pointer-coarse:after:w-full pointer-coarse:after:min-w-11",
    "pointer-coarse:after:-translate-x-1/2 pointer-coarse:after:-translate-y-1/2",
    "pointer-coarse:after:content-['']",
  ].join(" "),
  {
    variants: {
      /**
       * `data-[state=active]` is Radix's own flag, so selection is read off the DOM rather than
       * recomputed here — one source of truth for "which one is lit".
       */
      selected: {
        true: "bg-primary-wash text-primary",
        false: "text-ink-soft hover:bg-hover hover:text-ink",
      },
    },
    defaultVariants: { selected: false },
  },
);

export interface TabItem {
  value: string;
  /** Sentence case, in the product's own words (§7.4). Always a word — never a glyph. */
  label: string;
  /** Right of the label, tabular by construction — every sans step carries `tnum` (§4.4). */
  count?: number;
}

export interface TabsProps {
  value: string;
  onChange: (v: string) => void;
  tabs: readonly TabItem[];
  /** The active panel's content. The caller switches this on the same `value` it holds. */
  children: ReactNode;
}

export const Tabs = forwardRef<ComponentRef<typeof TabsPrimitive.Root>, TabsProps>(function Tabs(
  { value, onChange, tabs, children },
  ref,
) {
  return (
    <TabsPrimitive.Root ref={ref} value={value} onValueChange={onChange}>
      {/*
        `overflow-x-auto` rather than a wrap: a tab strip that wraps to two lines moves the
        content under it every time a count changes, and these sit above live numbers. Below the
        stub breakpoint the strip scrolls and the first tab stays put.
      */}
      <TabsPrimitive.List className="flex items-center gap-1 overflow-x-auto">
        {tabs.map((item) => {
          const selected = item.value === value;
          return (
            <TabsPrimitive.Trigger
              key={item.value}
              value={item.value}
              className={cn(tab({ selected }))}
            >
              {item.label}
              {item.count === undefined ? null : (
                <Text size="meta" tone={selected ? "primary" : "muted"}>
                  {item.count}
                </Text>
              )}
            </TabsPrimitive.Trigger>
          );
        })}
      </TabsPrimitive.List>

      {/*
        The hairline the strip sits on. Decorative: the tabs themselves already tell a screen
        reader where the group ends, so a second `role="separator"` would be noise.
      */}
      <Separator className="mt-1" />

      <TabsPrimitive.Content value={value} className={cn("pt-4 outline-none", focusRing)}>
        {children}
      </TabsPrimitive.Content>
    </TabsPrimitive.Root>
  );
});

import { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { NavLink } from "react-router-dom";

import { cn } from "../cn.js";
import { focusRing, pressTransition } from "../variants.js";
import { Chip, Text } from "../atoms/index.js";

/**
 * NavItem — one destination in the rail (ATOMIC-INVENTORY §2, 16; replaces `Sidebar.Item`).
 *
 * The active state is driven by `NavLink`, which is also what supplies `aria-current="page"` —
 * today the rail says "where you are" in colour alone and says nothing at all to a screen
 * reader. Active takes `primary-wash` with `primary` ink, because §4.1 gives `primary` exactly
 * this job: *the thing you act on, and where you are*. Lime is not an option here; `#D7F56B` on
 * paper is 1.08:1 (§1.2 M5).
 *
 * 6px radius — a rail item is a control, not a container (§5.2) — and the 90ms colour-only
 * transition of §5.1. Nothing about the row's geometry moves on hover.
 *
 * **`tone="live"`** says something is happening at that destination right now. It is carried by
 * a `Chip tone="live"`, which is the system's one sanctioned live carrier: a forest pill, paper
 * ink, a 6px lime dot at 7.97:1, and the **word** beside the hue (§4.2, §5.4 appearance 2). It
 * deliberately does not tint the row itself — the lime budget for a whole viewport is a 24×24px
 * square, and a live rail item is not the screen's one marked thing.
 */

const navItem = cva(
  [
    "flex items-baseline gap-2",
    // `px-2`, not `px-3`, and the missing 4px is on the rail's `<nav>` instead. The rail is a
    // scroll container, so it clips painted overflow, and a row spanning its full width focused
    // with the left and right sides of its ring cut off. The row is inset by exactly the ring
    // and the gutter is made up outside it, so the label still sits 12px from the rail's edge
    // and only the hover ground and the ring moved. See `Sidebar`'s `<nav>`.
    "rounded-sm px-2 py-1.5",
    "t-ui",
    pressTransition,
    focusRing,
  ].join(" "),
  {
    variants: {
      active: {
        true: "bg-primary-wash text-primary",
        false: "text-ink-soft hover:bg-hover hover:text-ink",
      },
    },
    defaultVariants: { active: false },
  },
);

export type NavItemVariants = VariantProps<typeof navItem>;

export interface NavItemProps {
  to: string;
  label: string;
  /** Right-aligned and tabular by construction — every sans step carries `tnum` (§4.4). */
  count?: number;
  /** `live` hangs the sanctioned live pill off the end of the row. */
  tone?: "default" | "live";
  /** Match this path exactly rather than as a prefix. */
  end?: boolean;
}

export const NavItem = forwardRef<HTMLAnchorElement, NavItemProps>(function NavItem(
  { to, label, count, tone = "default", end = false },
  ref,
) {
  return (
    <NavLink
      ref={ref}
      to={to}
      end={end}
      className={({ isActive }) => cn(navItem({ active: isActive }))}
    >
      {({ isActive }) => (
        <>
          <Text size="ui" truncate className="flex-1">
            {label}
          </Text>
          {tone === "live" ? (
            <Chip tone="live" count={count}>
              Live
            </Chip>
          ) : count === undefined ? null : (
            <Text size="meta" tone={isActive ? "primary" : "muted"} className="shrink-0">
              {count}
            </Text>
          )}
        </>
      )}
    </NavLink>
  );
});

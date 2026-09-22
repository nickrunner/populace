import { forwardRef, useId, type ReactNode } from "react";

import { Stack, Text } from "../atoms/index.js";

/**
 * NavGroup — a titled run of `NavItem`s in the rail (ATOMIC-INVENTORY §2, 17).
 *
 * The title is `t-label`: a group heading in the rail is a **data label on an instrument**, which
 * is one of the four roles §3.3 confines uppercase to. It is wired to the items with
 * `aria-labelledby` on a `role="group"`, so the heading is announced as the name of the run of
 * links rather than read as a stray line of text — which is all it is today.
 *
 * An unlabelled group takes neither the role nor the name: a `role="group"` with no accessible
 * name is announced as "group" and tells a listener nothing.
 *
 * **No outer margin.** The rail composes groups with a `Stack` gap of its own, and a margin here
 * would be a second rhythm for the parent to fight (§1.3 rule, the twelve-vertical-rhythms
 * finding). The 4px between items is `Stack`'s smallest token step.
 */

export interface NavGroupProps {
  label?: string;
  children: ReactNode;
}

export const NavGroup = forwardRef<HTMLDivElement, NavGroupProps>(function NavGroup(
  { label, children },
  ref,
) {
  const labelId = useId();
  const labelled = label !== undefined && label !== "";

  return (
    <div
      ref={ref}
      role={labelled ? "group" : undefined}
      aria-labelledby={labelled ? labelId : undefined}
    >
      {/* `px-2` for the same reason `NavItem` is `px-2`: the rail's `<nav>` carries the other
          4px, so the ring of a focused row below this label is not clipped by the scroller. The
          label still lands 12px from the rail's edge. */}
      {labelled ? (
        <Text size="label" tone="muted" as="div" id={labelId} className="px-2 pb-2">
          {label}
        </Text>
      ) : null}
      <Stack gap={1}>{children}</Stack>
    </div>
  );
});

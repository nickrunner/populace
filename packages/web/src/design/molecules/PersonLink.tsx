import { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../cn.js";
import { Avatar, Inline, Link, Separator, Text, VisuallyHidden } from "../atoms/index.js";

/**
 * PersonLink — a person, named and reachable (ATOMIC-INVENTORY §2, 18).
 *
 * **The name is the label, always.** §7.4 is explicit: never name a persona where a person has a
 * name, and never print an id or a slug where a name is stored. This molecule takes `name` and
 * has nowhere to put anything else, which is the point — the three hand-rolled
 * `Avatar + name + link` sites it replaces each had their own idea about what to fall back to.
 *
 * `cohort` is the second half of the row's label: rows are labelled **by person and cohort**. It
 * is separated by a 12px vertical hairline rather than a middle dot (§4.5), which is the same
 * tick every other fact line in the product uses.
 *
 * The step is `t-name` at `md` — §3.3's "a record's name inside a row, cell or card" — and drops
 * to `t-ui` at `sm`, the 32px table row. `Link`'s own `size` union deliberately excludes the name
 * step (a link inside a paragraph must inherit the paragraph), so the step arrives through
 * `className`, which `cn()` resolves as a type-step group with the last one winning. That is the
 * documented mechanism, not a workaround.
 *
 * Alignment is `center`, not the default `baseline`: an avatar is a glyph with no baseline of its
 * own, and baseline-aligning it against the name hangs the circle below the line.
 */

/** The name's step, by size. Both are tokens of the scale; neither is a literal. */
const personName = cva("", {
  variants: {
    size: {
      sm: "t-ui",
      md: "t-name",
    },
  },
  defaultVariants: { size: "md" },
});

export type PersonNameVariants = VariantProps<typeof personName>;

export interface PersonLinkProps {
  /** The stored name. Never an id, never a slug, never a persona (§7.4). */
  name: string;
  to: string;
  /** Which cohort they belong to. Printed after a hairline tick. */
  cohort?: string;
  /** `sm` is the 32px table row; `md` is a list row or a card. */
  size?: "sm" | "md";
  /** They are in a visit right now. */
  active?: boolean;
}

export const PersonLink = forwardRef<HTMLDivElement, PersonLinkProps>(function PersonLink(
  { name, to, cohort, size = "md", active = false },
  ref,
) {
  return (
    <Inline ref={ref} gap={2} align="center">
      {/*
        The avatar already carries `role="img"` with the name as its label, and the link beside it
        prints the same name. Hiding the subtree stops a screen reader saying "Priya Raman,
        Priya Raman"; `display: contents` keeps the flex row exactly as it was.
      */}
      <span aria-hidden="true" className="contents">
        <Avatar name={name} size={size} active={active} />
      </span>
      <Link to={to} className={cn(personName({ size }))}>
        {name}
      </Link>
      {active ? <VisuallyHidden> (in a visit now)</VisuallyHidden> : null}
      {cohort === undefined ? null : (
        <>
          <Separator orientation="vertical" />
          <Text size="meta" tone="muted" truncate>
            {cohort}
          </Text>
        </>
      )}
    </Inline>
  );
});

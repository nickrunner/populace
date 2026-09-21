import { forwardRef } from "react";
import { cva } from "class-variance-authority";

import { cn } from "../cn.js";
import { Avatar } from "../atoms/index.js";

/**
 * AvatarGroup — several people as one body (DESIGN-SYSTEM §8.6).
 *
 * The mark's capsule is two lattice cells fused, and it reads as *individuals merged into one
 * body*. A shingle of overlapping stadium avatars is that shape assembled from real faces: it
 * says "these people, together" where a lattice says "this population" and a `CohortCapsule`
 * says "this cohort".
 *
 * **The overlap needs no ring.** The usual trick — a 2px ring in the page's colour under each
 * avatar — has to name a ground, and this group sits on the page, on a card and inside a row,
 * which is three different grounds and therefore a hard-coded lie on two of them. `Avatar`
 * already carries an opaque `sunk` fill and a `rule` hairline, so overlapping them simply lets
 * each one's own boundary do the separating, in tokens, on any ground (§2.6).
 *
 * **One name, not N.** Each `Avatar` is its own `role="img"` labelled with a person's name,
 * which inside a group means a reader hears five names and no relationship between them. So the
 * faces are hidden and the group carries one sentence — "Priya Raman, Sam Okafor and 3 others" —
 * which is the same thing a sighted reader gets from the shingle and the +N.
 *
 * The overflow marker is the group's own, not a sixth avatar: it is a count, so it is `t-meta`
 * tabular in `ink-muted` rather than initials, and it is round because it is a count badge
 * (§5.2). It never stands alone — the names it stands for are in the group's label.
 */

const group = cva("inline-flex w-fit items-center");

/** Each face overlaps the one before it by a third of its diameter. Later faces sit on top,
 *  which is the reading order, so the shingle runs the way the names do. */
const face = cva("shrink-0", {
  variants: {
    size: {
      sm: "-ml-2 first:ml-0",
      md: "-ml-2.5 first:ml-0",
    },
  },
  defaultVariants: { size: "md" },
});

const overflow = cva(
  [
    "inline-grid shrink-0 place-items-center",
    "rounded-full border border-rule bg-sunk text-ink-muted",
    "t-meta select-none",
  ].join(" "),
  {
    variants: {
      size: {
        sm: "-ml-2 size-6",
        md: "-ml-2.5 size-8",
      },
    },
    defaultVariants: { size: "md" },
  },
);

export interface AvatarGroupProps {
  /** Stored names, in the order they should be read. Never ids, never slugs (§7.4). */
  names: readonly string[];
  /** How many faces are drawn before the rest become a count. Default 4 — the mark is four high. */
  max?: number;
  size?: "sm" | "md";
}

/** "Priya Raman", "Priya Raman and Sam Okafor", "Priya Raman, Sam Okafor and 3 others". */
function sentenceFor(names: readonly string[], shown: readonly string[]): string {
  const hidden = names.length - shown.length;
  const parts = hidden > 0 ? [...shown, `${hidden} others`] : [...shown];
  if (parts.length === 0) return "Nobody";
  if (parts.length === 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
}

export const AvatarGroup = forwardRef<HTMLSpanElement, AvatarGroupProps>(function AvatarGroup(
  { names, max = 4, size = "md" },
  ref,
) {
  const shown = names.slice(0, Math.max(0, max));
  const hidden = names.length - shown.length;

  return (
    <span ref={ref} role="img" aria-label={sentenceFor(names, shown)} className={cn(group())}>
      {shown.map((name, index) => (
        // The name is in the group's label; repeating it per face would read every person twice.
        <span key={`${name}-${index}`} aria-hidden="true" className={cn(face({ size }))}>
          <Avatar name={name} size={size} />
        </span>
      ))}
      {hidden > 0 ? (
        <span aria-hidden="true" className={cn(overflow({ size }))}>
          +{hidden}
        </span>
      ) : null}
    </span>
  );
});

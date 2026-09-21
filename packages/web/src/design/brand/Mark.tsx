import { forwardRef } from "react";

import { Logo, type LogoProps } from "./Logo.js";

/**
 * Mark — the standalone mark, and the **only** legal lockup below 160px wide
 * (`Populace-Brand-Assets-v1/README.md`, "Logo rules"; DESIGN-SYSTEM §8.3).
 *
 * The mark is where the product's chrome wears its name: the head of the navigation rail, the
 * landing's footer, a mobile bar, a loading state. It has a component of its own rather than
 * living as `<Logo variant="mark">` because the sizes that are right for it — 16 to 32px — are
 * sizes at which the horizontal lockup is forbidden, and a call site that has to remember that
 * is a call site that will one day forget. Reach for `Mark` when the room is small and the
 * question of which artwork to use stops being a question.
 *
 * **`size="xl"` is the mark as artwork rather than as chrome** — 48px, 56px once the window is
 * wide enough for the ledger's stub — and it is the step the landing's hero needs. It is in the
 * table because it was missing from it: the hero drew its own 48/56px light-and-dark pair of
 * `<img>` tags, outside every rule this component exists to keep, precisely because there was no
 * step to ask for.
 *
 * Everything else is `Logo`'s: the ground chooses the cut, the theme flip happens in CSS, the
 * clear space is real padding, and `label={null}` is how the artwork says it is decorative
 * because something around it already carries the name.
 *
 * The mark's canvas is **146:152** — a shade taller than it is wide. It is never boxed in a
 * square and expected to centre optically; `size` sets the *width* and the height follows.
 */

export type MarkProps = Omit<LogoProps, "variant">;

export const Mark = forwardRef<HTMLSpanElement, MarkProps>(function Mark(props, ref) {
  return <Logo ref={ref} variant="mark" {...props} />;
});

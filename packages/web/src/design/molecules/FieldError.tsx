import { forwardRef, type ReactNode } from "react";

import { Text } from "../atoms/index.js";

/**
 * FieldError — ATOMIC-INVENTORY §2 molecule 3. Replaces `Problem` used inline (12 sites).
 *
 * What went wrong with something the reader just did, said next to the thing they did it to.
 * Three things make it correct where `Problem` was not:
 *
 *  - **It has an id**, because the signature demands one, and the id is the whole point: the
 *    control it belongs to names it in `aria-describedby`, so the message is *attached* to the
 *    control rather than merely sitting near it. `Field` generates that id and wires both ends.
 *  - **`role="alert"`** (DESIGN-SYSTEM §6, "Live regions"), so a message that appears after a
 *    failed save is spoken without the reader having to go hunting for it. The role sits on the
 *    wrapper rather than on the paragraph so that the paragraph keeps the id the control points
 *    at, and the announced region is the same node either way.
 *  - **The word carries it, not the hue.** `critical` is the error ink (§4.1), but the sentence
 *    is the message; colour is the redundant channel behind it (§4.2). Errors say what failed
 *    and what to do (§7.4).
 *
 * `t-meta` rather than a serif step: this is chrome under a control, in the densest container
 * the product has, and §3.1's threshold rule puts chrome in Space Grotesk. The hint above it and
 * the warning below it are the same step in the same face, which is the point — §3.1's amendment
 * settles the whole stack at once, and `Checkbox` and `Radio` follow it with their own hints.
 */
export interface FieldErrorProps {
  /**
   * The id the control names in `aria-describedby`. `Field` supplies it. Optional only where no
   * single control owns the failure — a row action any of twelve rows could have fired — because
   * an id nothing references reads as wiring in the source and is wiring nowhere; there the
   * `role="alert"` is the whole announcement, which is what it is for.
   */
  id?: string;
  children: ReactNode;
}

export const FieldError = forwardRef<HTMLDivElement, FieldErrorProps>(function FieldError(
  { id, children },
  ref,
) {
  return (
    <div ref={ref} role="alert" className="mt-1">
      <Text as="p" size="meta" tone="critical" id={id}>
        {children}
      </Text>
    </div>
  );
});

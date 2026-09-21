import { forwardRef, type ReactNode } from "react";

import { Text } from "../atoms/index.js";

/**
 * FieldWarning — ATOMIC-INVENTORY §2 molecule 4. Replaces the literal string
 * `"t-meta text-medium mt-1"`, written out at five sites.
 *
 * The non-fatal note: the value is accepted, and something about it is worth knowing anyway —
 * a cap that will be hit, a cost that will be larger than the reader expects, a glob that
 * currently matches nothing. It is **not** an error, so it never sets `aria-invalid` and never
 * takes `role="alert"`; interrupting a reader mid-keystroke for something that is not blocking
 * them is how a live region gets switched off.
 *
 * `medium` is the ink. Severity tokens mean severity and only severity (§4.1), and a caution is
 * the middle of that scale: it is the same register the product uses when it says a problem is
 * worth looking at but is not on fire. As everywhere, the word does the work and the hue is the
 * redundant channel (§4.2).
 *
 * It has no `id` in the signature, which would leave it unreachable by `aria-describedby`;
 * `Field` closes that by giving the wrapper it renders the id itself, so the note is announced
 * with the control without this molecule's signature growing a prop.
 */
export interface FieldWarningProps {
  children: ReactNode;
}

export const FieldWarning = forwardRef<HTMLElement, FieldWarningProps>(function FieldWarning(
  { children },
  ref,
) {
  return (
    <Text ref={ref} as="p" size="meta" tone="medium" className="mt-1">
      {children}
    </Text>
  );
});

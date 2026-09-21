import { forwardRef, type ReactNode } from "react";
import { cn } from "../cn.js";
import { textStyles, type TextTone } from "./Text.js";

/**
 * Mono — machine speech, unwrapped: a tool name, an endpoint, a slug, an id, a call ref's digits.
 *
 * Two of the evidence seam's three channels are this component's whole job (§4.3): the **face**
 * is IBM Plex Mono, always, and the **ink** is `evidence`, the one non-brand hue in the system,
 * which is why it defaults here and nowhere else. The third channel — position — belongs to
 * whatever puts this in a stub or a well.
 *
 * `Mono` is bare text. For the inline, washed form inside a sentence use `Code`, which adds the
 * ground; for the payload block use the well.
 */

/** The four mono steps (§3.4). `code-inline` is the one pinned to the serif's line box. */
export type MonoSize = "code" | "code-inline" | "code-sm" | "ref";

export interface MonoProps {
  size?: MonoSize;
  tone?: TextTone;
  className?: string;
  children: ReactNode;
}

export const Mono = forwardRef<HTMLSpanElement, MonoProps>(function Mono(
  { size = "code", tone = "evidence", className, children },
  ref,
) {
  return (
    <span ref={ref} className={cn(textStyles({ size, tone }), className)}>
      {children}
    </span>
  );
});

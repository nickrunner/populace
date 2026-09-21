import { forwardRef, type ReactNode } from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cva } from "class-variance-authority";

import { cn } from "../cn.js";

/**
 * Label — ATOMIC-INVENTORY §1 atom 17, on Radix `react-label`.
 *
 * Radix rather than a bare `<label>` for one behaviour that is easy to lose by hand: clicking the
 * label focuses the control, and a double-click on it does not select the surrounding text.
 * `htmlFor` is required, not optional — DESIGN-SYSTEM §6 makes the explicit association part of
 * the form-labelling contract, and the `Field` molecule generates the id with `useId` when the
 * caller has none to give.
 *
 * The hint does NOT belong in here. Today it sits inside the `<label>` and is read out as part of
 * the label; after the port it is a sibling wired by `aria-describedby` (§6).
 *
 * Two steps, both from §3's scale. `label` is `t-label` — 11px caps at 0.08em, one of the four
 * roles caps are allowed in at all. `eyebrow` is `t-eyebrow`, 12px sentence case, for the places
 * where a group needs a slightly louder heading than a field caption.
 */
const labelVariants = cva("block mb-1.5 text-ink-muted", {
  variants: {
    size: {
      label: "t-label",
      eyebrow: "t-eyebrow",
    },
  },
  defaultVariants: { size: "label" },
});

export interface LabelProps {
  htmlFor: string;
  size?: "label" | "eyebrow";
  children: ReactNode;
}

export const Label = forwardRef<HTMLLabelElement, LabelProps>(function Label(
  { htmlFor, size = "label", children },
  ref,
) {
  return (
    <LabelPrimitive.Root ref={ref} htmlFor={htmlFor} className={cn(labelVariants({ size }))}>
      {children}
    </LabelPrimitive.Root>
  );
});

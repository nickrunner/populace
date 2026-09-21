import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { cva } from "class-variance-authority";
import { forwardRef, useId } from "react";
import type { ReactNode } from "react";

import { cn } from "../cn.js";
import { focusRing, stateTransition } from "../variants.js";
import { Icon } from "./Icon.js";

/**
 * Checkbox — ATOMIC-INVENTORY §1, atom 13. Radix `@radix-ui/react-checkbox`.
 *
 * The indicator is a conventional check glyph, NOT a capsule from the mark's grammar. A
 * mis-read checkbox here gates actions that spend real money, and controls are the one place
 * in this system where familiarity beats the house grammar.
 *
 * The hint is wired through `aria-describedby` rather than nested inside the `<label>`
 * (DESIGN-SYSTEM §6, form labelling): inside the label it is read as part of the name, which
 * is how a two-word control ends up announced as a paragraph.
 *
 * **The hint is sans `t-meta`, exactly as `Field`'s is** (§3.1, exception 2). A form may not have
 * two families for one role, and the hint, the error and the warning under a control are one
 * stack of chrome in the densest container the product has: whichever family they take, they take
 * together. Sans wins because the serif means *the product narrating a screen*, and micro-copy
 * under an input is not narration — it is part of the control.
 */

export interface CheckboxProps {
  checked: boolean | "indeterminate";
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  id?: string;
}

/**
 * 16px box, 6px radius (§5.2: a checkbox is a control). The `::after` is the hit area — 24px
 * for a mouse, 44px for a finger — so the tap target clears the floor without the box growing
 * and breaking its alignment with the first line of the label.
 */
const box = [
  "relative grid size-4 shrink-0 place-items-center",
  "rounded-sm border border-rule-strong bg-surface dark:bg-sunk",
  "text-on-primary",
  stateTransition,
  focusRing,
  "after:absolute after:-inset-1 after:content-['']",
  "pointer-coarse:after:-inset-3.5",
  "data-[state=checked]:border-primary data-[state=checked]:bg-primary",
  "data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary",
  // Disabled is carried by colour tokens, never by opacity, so it stays legible on every
  // ground. Doubling the attribute selector is what keeps it ahead of the checked rules.
  "data-[disabled]:cursor-not-allowed data-[disabled]:border-rule data-[disabled]:bg-sunk",
  "data-[disabled]:data-[state=checked]:border-rule data-[disabled]:data-[state=checked]:bg-rule",
  "data-[disabled]:data-[state=indeterminate]:border-rule data-[disabled]:data-[state=indeterminate]:bg-rule",
  "data-[disabled]:text-ink-muted",
].join(" ");

/** The label is the control's name, so it is sans (§3.1) and it is always clickable. */
const labelText = cva("t-ui block select-none", {
  variants: {
    disabled: {
      true: "cursor-not-allowed text-ink-muted",
      false: "cursor-pointer text-ink",
    },
  },
  defaultVariants: { disabled: false },
});

export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(function Checkbox(
  { checked, onChange, label, hint, disabled = false, id },
  ref,
) {
  const generatedId = useId();
  const controlId = id ?? `checkbox-${generatedId}`;
  const hintId = `${controlId}-hint`;

  return (
    <div className="flex items-start gap-2.5">
      <CheckboxPrimitive.Root
        ref={ref}
        id={controlId}
        checked={checked}
        onCheckedChange={(next) => onChange(next === true)}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        className={cn(box, "mt-0.5")}
      >
        <CheckboxPrimitive.Indicator className="flex items-center justify-center">
          <Icon name={checked === "indeterminate" ? "minus" : "check"} size={12} />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>

      <div className="min-w-0">
        <label htmlFor={controlId} className={labelText({ disabled })}>
          {label}
        </label>
        {hint ? (
          <p id={hintId} className="t-meta mt-0.5 text-ink-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
});

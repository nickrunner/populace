import { forwardRef } from "react";

import { cn } from "../cn.js";
import { control } from "../variants.js";
import type { InputProps } from "./Input.js";

/**
 * TextArea — ATOMIC-INVENTORY §1 atom 11.
 *
 * `Input`'s props without `type` and without `mono`, plus `rows`. The shell is the same shared
 * `control` CVA; the three overrides on top of it are what makes a multi-line control out of a
 * single-line one, and `cn()` resolves each against the fragment's own class rather than hoping
 * the stylesheet emits them in the right order: `h-auto` beats the 32px control height, `py-2`
 * beats the vertical centring the fixed height implied, and `resize-y` keeps the horizontal
 * measure — a control that can be dragged wider breaks the grid it sits in.
 *
 * The type step stays `t-ui`. DESIGN-SYSTEM §3.1's second named exception is that the container
 * overrides the string: text inside a form control is Space Grotesk at any size, even when what
 * is being typed into it is a full sentence.
 */
export interface TextAreaProps extends Omit<InputProps, "type" | "mono"> {
  rows?: number;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  {
    value,
    onChange,
    rows = 4,
    placeholder,
    invalid = false,
    disabled = false,
    id,
    describedBy,
    autoComplete,
    className,
  },
  ref,
) {
  return (
    <textarea
      ref={ref}
      id={id}
      rows={rows}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete={autoComplete}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={describedBy}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
      className={cn(control({ invalid, fullWidth: true }), "h-auto py-2 resize-y", className)}
    />
  );
});

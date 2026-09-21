import { forwardRef } from "react";

import { cn } from "../cn.js";
import { control } from "../variants.js";

/**
 * Input — ATOMIC-INVENTORY §1 atom 9.
 *
 * The plain single-line control. Every pixel of its shell comes from the shared `control` CVA in
 * `variants.ts`: the 6px control radius (§5.2), the `rule-strong` boundary that WCAG 1.4.11 asks
 * of anything bounding an interactive element, the ground that flips structurally between themes,
 * and the one focus ring (§4.6). Nothing here re-rolls any of that.
 *
 * `mono` swaps the type step from `t-ui` to `t-code` for the things the machine is named by —
 * URLs, endpoints, ids, globs (§4.3). It is a step swap rather than a `font-mono` utility because
 * a step IS its family, and `cn()` knows the two are mutually exclusive.
 *
 * Invalidity is announced twice, as §4.2 requires: `aria-invalid` for the screen reader and the
 * `critical` boundary for the eye. The message itself is a sibling with `role="alert"`, wired in
 * by the `Field` molecule through `describedBy`.
 */
export interface InputProps {
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "password" | "url" | "email";
  placeholder?: string;
  /** `t-code`, for URLs, endpoints, ids, globs. */
  mono?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  describedBy?: string;
  autoComplete?: string;
  className?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    value,
    onChange,
    type = "text",
    placeholder,
    mono = false,
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
    <input
      ref={ref}
      id={id}
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete={autoComplete}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={describedBy}
      onChange={(event) => {
        onChange(event.currentTarget.value);
      }}
      className={cn(control({ invalid, fullWidth: true }), mono && "t-code", className)}
    />
  );
});

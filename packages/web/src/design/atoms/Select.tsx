import * as SelectPrimitive from "@radix-ui/react-select";
import { cva } from "class-variance-authority";
import { forwardRef } from "react";

import { cn } from "../cn.js";
import { control, pressTransition, surfaceBase } from "../variants.js";
import { Icon } from "./Icon.js";

/**
 * Select — ATOMIC-INVENTORY §1, atom 12. Radix `@radix-ui/react-select`.
 *
 * Keeps the `{ value, label }[]` shape the twelve call sites already pass, so the port is a
 * swap and not a rewrite. The trigger is the shared `control` shell (DESIGN-SYSTEM §5.2: a
 * control is 6px), the list is an `overlay` surface (12px, `shadow-over`, and in dark a
 * `rule-strong` hairline because dark elevation is border-led).
 *
 * Radix buys the whole keyboard contract: type-ahead, Home/End, arrow movement, Escape,
 * focus return to the trigger, and a modal list that cannot be opened and then not closed —
 * which is the bug the hand-rolled picker has today.
 */

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  onChange: (v: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  id?: string;
  describedBy?: string;
  invalid?: boolean;
  "aria-label"?: string;
  /** Additive to the inventory's signature: the trigger is full width by default, so a
   *  toolbar picker needs one lever to shrink it. `cn` makes the last class win. */
  className?: string;
}

/**
 * A row in the open list. `data-highlighted` is Radix's pointer-and-keyboard cursor; it takes
 * the hover ground, which is the one tinted-ground meaning the system allows here.
 */
const selectItem = cva(
  [
    "relative flex w-full cursor-pointer select-none items-center",
    "rounded-sm pl-7 pr-2 t-ui text-ink outline-none",
    pressTransition,
    "data-[highlighted]:bg-hover",
    "data-[disabled]:cursor-not-allowed data-[disabled]:text-ink-muted data-[disabled]:bg-transparent",
  ].join(" "),
  {
    variants: {
      size: {
        sm: "h-6",
        md: "h-8",
      },
    },
    defaultVariants: { size: "md" },
  },
);

export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    value,
    onChange,
    options,
    placeholder,
    size = "md",
    disabled = false,
    id,
    describedBy,
    invalid = false,
    "aria-label": ariaLabel,
    className,
  },
  ref,
) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        ref={ref}
        id={id}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={invalid ? true : undefined}
        className={cn(
          control({ size, invalid, fullWidth: true }),
          "inline-flex items-center justify-between gap-2 text-left",
          "data-[placeholder]:text-ink-muted",
          "hover:enabled:border-rule-strong",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <span className="shrink-0 text-ink-muted">
            <Icon name="chevron-down" size={16} />
          </span>
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className={cn(
            surfaceBase({ level: "overlay" }),
            "z-[var(--z-overlay)] overflow-hidden p-1",
            "min-w-[var(--radix-select-trigger-width)]",
            "max-h-[min(20rem,var(--radix-select-content-available-height))]",
            // 240ms in, opacity 0→1 and 4px of travel (§5.1). `starting:` is the mount frame,
            // so the transition runs on a portal that has only just been inserted.
            "translate-y-0 opacity-100",
            "starting:-translate-y-1 starting:opacity-0",
            "transition-[opacity,transform] [transition-duration:var(--dur-enter)] [transition-timing-function:var(--ease)]",
          )}
        >
          <SelectPrimitive.ScrollUpButton className="flex h-5 items-center justify-center text-ink-muted">
            <Icon name="chevron-down" size={16} className="rotate-180" />
          </SelectPrimitive.ScrollUpButton>

          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={selectItem({ size })}
              >
                <SelectPrimitive.ItemIndicator className="absolute left-1.5 flex items-center text-primary">
                  <Icon name="check" />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>

          <SelectPrimitive.ScrollDownButton className="flex h-5 items-center justify-center text-ink-muted">
            <Icon name="chevron-down" size={16} />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
});

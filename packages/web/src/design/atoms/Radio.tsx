import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cva } from "class-variance-authority";
import { forwardRef, useId } from "react";
import type { ReactNode } from "react";

import { cn } from "../cn.js";
import { focusRing, stateTransition } from "../variants.js";
import { VisuallyHidden } from "./VisuallyHidden.js";

/**
 * Radio / RadioGroup — ATOMIC-INVENTORY §1, atom 14. Radix `@radix-ui/react-radio-group`.
 *
 * The dot IS the mark's dot at UI scale (DESIGN-SYSTEM §8.6): a filled `primary` circle
 * inside a ring, which is the same grammar the roster lattice uses for "this one is here".
 * Full radius, because circles belong to people and states (§5.2).
 *
 * The group is a real `<fieldset>` with a `<legend>`, which is what the two bare radios on
 * NewSimulation have no group semantics for today. Radix supplies roving tabindex, arrow-key
 * movement and the wrap-around, so the group is one tab stop rather than N.
 *
 * **`legendHidden` is how a group lives inside a `Field`.** The inventory's signature says the
 * legend is "visible, or `VisuallyHidden` when the group has a `Field` label" — and with no prop
 * for it, the two spellings of one caption both render: the reader sees the words twice and
 * hears them twice. The `<legend>` element itself never goes away, because it is what names the
 * `<fieldset>` and `aria-labelledby` points at it either way. Only its ink is taken.
 *
 * **The hint is sans `t-meta`, exactly as `Field`'s and `Checkbox`'s are** (§3.1, exception 2):
 * one family for one role, or a form shows the same concept in two faces.
 */

export interface RadioGroupProps {
  value: string;
  onChange: (v: string) => void;
  name: string;
  /** The field label for the group, and the name the group is announced by. */
  legend: string;
  /**
   * Draws the legend for the screen reader alone. Set it when a `Field` already shows the same
   * caption above the group — never as a way to leave a group unnamed.
   */
  legendHidden?: boolean;
  orientation?: "vertical" | "horizontal";
  children: ReactNode;
}

export interface RadioProps {
  value: string;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}

const groupLayout = cva("flex", {
  variants: {
    orientation: {
      vertical: "flex-col gap-2.5",
      horizontal: "flex-row flex-wrap gap-x-6 gap-y-2.5",
    },
  },
  defaultVariants: { orientation: "vertical" },
});

/**
 * 16px ring, full radius. The `::after` is the hit area — 24px for a mouse, 44px for a finger.
 * Disabled is carried by colour tokens, never opacity, so it stays legible on every ground.
 */
const dotRing = [
  "relative grid size-4 shrink-0 place-items-center",
  "rounded-full border border-rule-strong bg-surface dark:bg-sunk",
  stateTransition,
  focusRing,
  "after:absolute after:-inset-1 after:content-['']",
  "pointer-coarse:after:-inset-3.5",
  "data-[state=checked]:border-primary",
  "data-[disabled]:cursor-not-allowed data-[disabled]:border-rule data-[disabled]:bg-sunk",
].join(" ");

/** The label is the option's name, so it is sans (§3.1) and it is always clickable. */
const labelText = cva("t-ui block select-none", {
  variants: {
    disabled: {
      true: "cursor-not-allowed text-ink-muted",
      false: "cursor-pointer text-ink",
    },
  },
  defaultVariants: { disabled: false },
});

export const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>(function RadioGroup(
  { value, onChange, name, legend, legendHidden = false, orientation = "vertical", children },
  ref,
) {
  const generatedId = useId();
  const legendId = `${generatedId}-legend`;

  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend
        id={legendId}
        className={cn("t-label p-0 text-ink-muted", legendHidden ? "mb-0" : "mb-1.5")}
      >
        {legendHidden ? <VisuallyHidden>{legend}</VisuallyHidden> : legend}
      </legend>
      <RadioGroupPrimitive.Root
        ref={ref}
        value={value}
        onValueChange={onChange}
        name={name}
        orientation={orientation}
        aria-labelledby={legendId}
        className={groupLayout({ orientation })}
      >
        {children}
      </RadioGroupPrimitive.Root>
    </fieldset>
  );
});

export const Radio = forwardRef<HTMLButtonElement, RadioProps>(function Radio(
  { value, label, hint, disabled = false },
  ref,
) {
  const generatedId = useId();
  const controlId = `radio-${generatedId}`;
  const hintId = `${controlId}-hint`;

  return (
    <div className="flex items-start gap-2.5">
      <RadioGroupPrimitive.Item
        ref={ref}
        id={controlId}
        value={value}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        className={cn(dotRing, "mt-0.5")}
      >
        <RadioGroupPrimitive.Indicator className="block size-2 rounded-full bg-primary data-[disabled]:bg-ink-muted" />
      </RadioGroupPrimitive.Item>

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

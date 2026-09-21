import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cva } from "class-variance-authority";
import { forwardRef, useId } from "react";

import { cn } from "../cn.js";
import { focusRing, stateTransition } from "../variants.js";

/**
 * Switch — ATOMIC-INVENTORY §1, atom 15. Radix `@radix-ui/react-switch`.
 *
 * Used for exactly one thing: the kill switch. It is **always paired with the word**, because
 * never colour alone (DESIGN-SYSTEM §4.2) — a thumb that has slid left is not a state anybody
 * should have to infer. `onLabel` / `offLabel` are that word, and they are written beside the
 * track for sighted readers; the control's own `role="switch"` carries the state to everyone
 * else, so the word is `aria-hidden` rather than announced twice in two vocabularies.
 *
 * `tone="danger"` is the stopping register: `critical` is the system's destructive ink, and on
 * a kill switch the on-state is the alarming one.
 */

export interface SwitchProps {
  checked: boolean;
  onChange: (c: boolean) => void;
  /** The control's name — what it switches, e.g. "Stop every visit". */
  label: string;
  /** The word for the on state, e.g. "stopped". */
  onLabel: string;
  /** The word for the off state, e.g. "running". */
  offLabel: string;
  tone?: "primary" | "danger";
  disabled?: boolean;
  id?: string;
}

/**
 * 36×20 track, full radius (§5.2: people and states). Off is `rule-strong`, which is the token
 * that clears 3:1 as a meaningful non-text mark; on takes the tone's fill.
 *
 * The `::after` is the hit area — 36×36 for a mouse, 52×52 for a finger — so a 20px-tall track
 * still clears the 24px tap-target floor.
 */
const track = cva(
  [
    "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5",
    "border border-transparent bg-rule-strong",
    stateTransition,
    focusRing,
    "after:absolute after:-inset-2 after:content-['']",
    "pointer-coarse:after:-inset-4",
    "data-[disabled]:cursor-not-allowed data-[disabled]:bg-rule",
  ].join(" "),
  {
    variants: {
      tone: {
        primary: "data-[state=checked]:bg-primary",
        danger: "data-[state=checked]:bg-critical",
      },
    },
    defaultVariants: { tone: "primary" },
  },
);

/**
 * The thumb is a circle — an individual, in the mark's grammar — and it is the one thing in
 * this system that moves on a transform. 140ms, the control-state tempo (§5.1).
 */
const thumb = cva(
  [
    "block size-4 rounded-full shadow-card",
    "translate-x-0 data-[state=checked]:translate-x-4",
    "transition-transform [transition-duration:var(--dur-state)] [transition-timing-function:var(--ease)]",
  ].join(" "),
  {
    variants: {
      tone: {
        primary: "bg-surface data-[state=checked]:bg-on-primary",
        danger: "bg-surface data-[state=checked]:bg-on-critical",
      },
    },
    defaultVariants: { tone: "primary" },
  },
);

/** The state word. Sans, because it names a state (§3.1). */
const stateWord = cva("t-ui select-none", {
  variants: {
    state: {
      on: "text-ink",
      off: "text-ink-muted",
    },
  },
  defaultVariants: { state: "off" },
});

/** The control's name is sans (§3.1), and it is always clickable. */
const labelText = cva("t-ui block select-none", {
  variants: {
    disabled: {
      true: "cursor-not-allowed text-ink-muted",
      false: "cursor-pointer text-ink",
    },
  },
  defaultVariants: { disabled: false },
});

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onChange, label, onLabel, offLabel, tone = "primary", disabled = false, id },
  ref,
) {
  const generatedId = useId();
  const controlId = id ?? `switch-${generatedId}`;

  return (
    <div className="flex items-center gap-3">
      <label htmlFor={controlId} className={labelText({ disabled })}>
        {label}
      </label>

      <SwitchPrimitive.Root
        ref={ref}
        id={controlId}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className={track({ tone })}
      >
        <SwitchPrimitive.Thumb className={thumb({ tone })} />
      </SwitchPrimitive.Root>

      {/* The word, never the colour alone. The switch itself reports its state to assistive
          technology, so this copy is decoration for the eye only. */}
      <span
        aria-hidden="true"
        className={cn(stateWord({ state: checked ? "on" : "off" }), disabled && "text-ink-muted")}
      >
        {checked ? onLabel : offLabel}
      </span>
    </div>
  );
});

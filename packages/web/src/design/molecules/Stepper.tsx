import { forwardRef } from "react";

import { IconButton, Text } from "../atoms/index.js";

/**
 * Stepper — ATOMIC-INVENTORY §2 molecule 9. Replaces the existing `Stepper`, whose − and + are
 * about 20×24px and fail DESIGN-SYSTEM §6's 24px floor outright.
 *
 * How many of this person go into the next execution. Three sites, all of them a headcount.
 *
 * Both controls are `IconButton`s at `md`, which is 32×32 — and `Button`'s coarse-pointer
 * `::after` box takes them to 44 on a touch screen without touching the layout. That is the
 * whole reason this molecule composes the atom rather than drawing two glyphs: the target, the
 * focus ring, the `aria-label` and the tooltip all arrive already correct, and none of them
 * exists on the control being replaced.
 *
 * **The figure is an `<output>`, and it is polite.** Pressing + moves a number somewhere else on
 * the line; without a live region a screen-reader user presses the button and hears nothing at
 * all. `aria-atomic` makes the whole count the announcement rather than the digit that changed.
 * The figure is tabular by construction — every sans step carries `tnum`/`zero` (§4.4) — so 9
 * and 10 do not shift the buttons either side of them.
 *
 * `label` names what is being counted, and it lands on the group rather than on the buttons: a
 * screen with three steppers needs to tell them apart, and "one more" repeated three times does
 * not. The `max` default of 99 is the one the current component ships with.
 *
 * **The caption reaches the group as ARIA, not as `for`** — the same arrangement `ScaleField`
 * spells for `Slider`, and for the same reason. HTML's `for` binds a `<label>` only to a
 * *labelable* element, and this molecule's root is a `role="group"` div, so a `Field` wrapping a
 * bare `Stepper` used to caption nothing at all: its `htmlFor` pointed at an id that existed
 * nowhere, and its hint reached nothing. `id` and `describedBy` are therefore real props. A
 * caller inside a `Field` passes both and the same string to `label`, so the caption a reader
 * sees and the name a screen reader speaks are one string by construction.
 *
 * **At a bound the control is inert, not absent.** `IconButton` draws `disabled` as
 * `aria-disabled` — the button keeps its tab stop, its `aria-label` and its tooltip, and swallows
 * the press — so a headcount sitting at its minimum still has two named, explained controls
 * rather than one named control and one unreachable glyph. The clamp in `step` stays anyway: the
 * bound is the molecule's fact, not the button's.
 */
export interface StepperProps {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  /** What is being counted, e.g. "How many of them". Names the group. */
  label: string;
  /** The group's `id`. A `Field` supplies it; it is what the caption's `htmlFor` points at. */
  id?: string;
  /** Ids of the hint, the error and the warning. A `Field` supplies them. */
  describedBy?: string;
}

export const Stepper = forwardRef<HTMLDivElement, StepperProps>(function Stepper(
  { value, onChange, min = 0, max = 99, label, id, describedBy },
  ref,
) {
  const step = (to: number): void => {
    onChange(Math.min(max, Math.max(min, to)));
  };

  return (
    <div
      ref={ref}
      id={id}
      role="group"
      aria-label={label}
      aria-describedby={describedBy}
      className="inline-flex items-center gap-1"
    >
      <IconButton
        icon="minus"
        label="One fewer"
        variant="secondary"
        disabled={value <= min}
        onClick={() => {
          step(value - 1);
        }}
      />
      <output aria-live="polite" aria-atomic="true" className="inline-block min-w-8 text-center">
        <Text size="ui">{value}</Text>
      </output>
      <IconButton
        icon="plus"
        label="One more"
        variant="secondary"
        disabled={value >= max}
        onClick={() => {
          step(value + 1);
        }}
      />
    </div>
  );
});

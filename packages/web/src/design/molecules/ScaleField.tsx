import { forwardRef } from "react";

import { Slider } from "../atoms/index.js";
import { Field } from "./Field.js";

/**
 * ScaleField — ATOMIC-INVENTORY §2 molecule 8. Replaces the `<input type="range">` that carries
 * the app's only arbitrary colour value, and the `PATIENCE` prose map sitting loose beside it.
 *
 * A bounded integer whose meaning is a sentence, not a number. Patience is the live example: 3
 * is not "3 out of 5", it is *"you tolerate a snag or two if the product seems worth it"*, and
 * the number on its own tells the reader nothing about what they are about to buy.
 *
 * `describe` is therefore required, not optional, and it is a function rather than a map so a
 * caller can interpolate the figure into the sentence where the scale is genuinely quantitative.
 * `Slider` prints its return value beneath the track in the serif — the product speaking — and
 * hands the same string to the thumb as `aria-valuetext`, so the control announces the meaning
 * rather than a bare 3.
 *
 * **The caption reaches the control as ARIA, not as `for`.** Radix renders the thumb as a
 * `<span role="slider">`, and HTML's `for` attribute only binds a `<label>` to a *labelable*
 * element — so the caption `Field` draws would name nothing on its own. `Slider` now takes
 * `ariaLabel`, and this molecule hands it the same one `label` string it gave `Field`, so the
 * caption a reader sees and the name a screen reader speaks are the same string by construction.
 * That replaces the `role="group"` wrapper this molecule used to draw: a group around a single
 * control is a landmark for nothing, and it announced the caption a step *outside* the slider
 * rather than as the slider's own name.
 */
export interface ScaleFieldProps {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  label: string;
  /** The reading, as a sentence. Drawn beneath the track and spoken as `aria-valuetext`. */
  describe: (v: number) => string;
}

export const ScaleField = forwardRef<HTMLDivElement, ScaleFieldProps>(function ScaleField(
  { value, onChange, min, max, label, describe },
  ref,
) {
  return (
    <Field ref={ref} label={label}>
      {({ id, describedBy }) => (
        <Slider
          id={id}
          describedBy={describedBy}
          ariaLabel={label}
          value={value}
          onChange={onChange}
          min={min}
          max={max}
          valueLabel={describe(value)}
        />
      )}
    </Field>
  );
});

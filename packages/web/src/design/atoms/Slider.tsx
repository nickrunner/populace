import * as SliderPrimitive from "@radix-ui/react-slider";
import { forwardRef, useId } from "react";

import { cn } from "../cn.js";
import { focusRing } from "../variants.js";

/**
 * Slider — ATOMIC-INVENTORY §1, atom 16. Radix `@radix-ui/react-slider`.
 *
 * Replaces the app's only arbitrary colour value, `<input type="range"
 * accent-[var(--color-accent)]>`: lime is a ground, never a fill, and in light it is 1.08:1
 * against paper, so the old range was a control nobody could see. The filled range and the
 * thumb are `primary` — "the thing you act on" (§4.1) — which is forest in light and lime in
 * dark by the kit's own swap, with no TypeScript asking what the theme is.
 *
 * `valueLabel` is the prose reading of the number — "waits about a minute" — and it does two
 * jobs: it is the visible sentence beneath the track, and it is the thumb's `aria-valuetext`,
 * so the control announces a meaning rather than a raw 37.
 *
 * **The atom names itself, because a `<label>` cannot name it.** Radix draws the thumb as a
 * `<span role="slider">`, and HTML's `for` binds a `<label>` only to a *labelable* element — an
 * `<input>`, a `<select>`, a `<button>` and three others, none of which appears here. So a
 * `Field` wrapping a bare slider captions nothing at all, and the accessible name has to arrive
 * as ARIA: `ariaLabel` when the caller holds the string, `ariaLabelledBy` when the string is
 * already on screen as some other element. Both land on the **thumb**, which is the element
 * carrying `role="slider"` and `aria-valuenow` — a name on the root would name a `<span>` with
 * no role, which no assistive technology reads as the control's. `id` stays on the thumb for the
 * same reason: it is the id of the thing that is the slider.
 */

export interface SliderProps {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  /** The prose reading, e.g. "waits about a minute". */
  valueLabel: string;
  id?: string;
  describedBy?: string;
  /** The control's name, when the caller holds the string. `ScaleField` passes its caption. */
  ariaLabel?: string;
  /** The id of the element that names the control, when the name is already on screen. */
  ariaLabelledBy?: string;
}

export const Slider = forwardRef<HTMLSpanElement, SliderProps>(function Slider(
  {
    value,
    onChange,
    min,
    max,
    step = 1,
    valueLabel,
    id,
    describedBy,
    ariaLabel,
    ariaLabelledBy,
  },
  ref,
) {
  const generatedId = useId();
  const controlId = id ?? `slider-${generatedId}`;
  const readingId = `${controlId}-reading`;

  return (
    <div>
      <SliderPrimitive.Root
        value={[value]}
        onValueChange={(next) => {
          const first = next[0];
          if (first !== undefined) onChange(first);
        }}
        min={min}
        max={max}
        step={step}
        className="relative flex h-6 w-full touch-none select-none items-center"
      >
        {/* Full radius: a track is a state, not data (§5.2). `rule-strong` rather than `rule`,
            because the unfilled remainder is a meaningful non-text mark and owes 3:1. */}
        <SliderPrimitive.Track className="relative h-1.5 w-full grow rounded-full bg-rule-strong">
          <SliderPrimitive.Range className="absolute h-full rounded-full bg-primary" />
        </SliderPrimitive.Track>

        {/* A circle is an individual, in the mark's grammar — here, the value you are holding.
            The `::after` is the hit area: 24px for a mouse, 44px for a finger. */}
        <SliderPrimitive.Thumb
          ref={ref}
          id={controlId}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-valuetext={valueLabel}
          aria-describedby={describedBy ?? readingId}
          className={cn(
            "relative block size-4 rounded-full border border-primary bg-primary shadow-card",
            focusRing,
            "after:absolute after:-inset-1 after:content-['']",
            "pointer-coarse:after:-inset-3.5",
          )}
        />
      </SliderPrimitive.Root>

      {/* The reading, as a sentence the product is saying — so it is serif (§3.1). */}
      <p id={readingId} className="t-read-sm mt-1.5 text-ink-soft">
        {valueLabel}
      </p>
    </div>
  );
});

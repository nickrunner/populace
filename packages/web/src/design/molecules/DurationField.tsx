import { forwardRef } from "react";

import { NumberInput, Text, VisuallyHidden } from "../atoms/index.js";
import { Field } from "./Field.js";

/**
 * DurationField — ATOMIC-INVENTORY §2 molecule 6. Replaces the seconds↔milliseconds arithmetic
 * duplicated at four sites, every one of which does it slightly differently.
 *
 * **The unit is a suffix inside the control, not a parenthesis in the label.** "Timeout (ms)" is
 * a caption doing a control's job: the reader has to hold the unit in their head while they type
 * and again while they read the number back. Put it against the figure and the field reads as
 * one quantity — `30 s` — at a glance and on re-entry.
 *
 * **The caller thinks in milliseconds and only in milliseconds.** `valueMs`, `min` and `max` are
 * all ms; `unit` decides the *display* and nothing else. The inventory names only `valueMs`
 * explicitly, which leaves the bounds ambiguous — and a props object with mixed units would be
 * precisely the bug this molecule was created to delete, so they follow the value. Changing the
 * displayed unit therefore never changes what the field means.
 *
 * **The suffix is spoken, too.** It is drawn as the short form (`s`) and carries the full word
 * (`seconds`) for assistive technology, and the render prop's `describedBy` is *extended* with
 * its id rather than replaced — which is the reason `Field` hands the control its ids instead of
 * cloning it.
 *
 * The native spin buttons are suppressed: they render in the same corner the suffix occupies, so
 * one of the two would sit on top of the other. Arrow keys still step the value, which is the
 * part of a spin button a keyboard reaches anyway.
 */
export type DurationUnit = "s" | "ms" | "min";

/** Milliseconds per displayed unit. The whole of the arithmetic, in one place. */
const UNIT_MS: Record<DurationUnit, number> = { ms: 1, s: 1000, min: 60_000 };

/** Drawn against the figure. */
const UNIT_SUFFIX: Record<DurationUnit, string> = { ms: "ms", s: "s", min: "min" };

/** Spoken instead of it. */
const UNIT_WORD: Record<DurationUnit, string> = {
  ms: "milliseconds",
  s: "seconds",
  min: "minutes",
};

/** Three decimals is enough for 1ms inside a minute, and it keeps float dust off the screen. */
function inUnit(ms: number, factor: number): number {
  return Math.round((ms / factor) * 1000) / 1000;
}

export interface DurationFieldProps {
  /** Always milliseconds, whatever `unit` is. */
  valueMs: number;
  onChange: (ms: number) => void;
  /** How the figure is shown and spoken. It does not change what the value means. */
  unit: DurationUnit;
  label: string;
  hint?: string;
  /** Milliseconds, like `valueMs`. */
  min?: number;
  /** Milliseconds, like `valueMs`. */
  max?: number;
}

export const DurationField = forwardRef<HTMLDivElement, DurationFieldProps>(function DurationField(
  { valueMs, onChange, unit, label, hint, min, max },
  ref,
) {
  const factor = UNIT_MS[unit];

  return (
    <Field ref={ref} label={label} hint={hint}>
      {({ id, describedBy, invalid }) => {
        const unitId = `${id}-unit`;
        return (
          <div
            className={[
              "relative",
              // Room for the suffix, and the spin buttons out of its corner.
              "[&_input]:pr-12",
              "[&_input]:[-moz-appearance:textfield]",
              "[&_input::-webkit-outer-spin-button]:[-webkit-appearance:none]",
              "[&_input::-webkit-inner-spin-button]:[-webkit-appearance:none]",
            ].join(" ")}
          >
            <NumberInput
              id={id}
              describedBy={describedBy === undefined ? unitId : `${describedBy} ${unitId}`}
              invalid={invalid}
              value={inUnit(valueMs, factor)}
              onChange={(shown) => {
                onChange(Math.round(shown * factor));
              }}
              min={min === undefined ? undefined : inUnit(min, factor)}
              max={max === undefined ? undefined : inUnit(max, factor)}
            />
            <span
              id={unitId}
              className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center"
            >
              <Text size="meta" tone="muted">
                <span aria-hidden="true">{UNIT_SUFFIX[unit]}</span>
                <VisuallyHidden>{UNIT_WORD[unit]}</VisuallyHidden>
              </Text>
            </span>
          </div>
        );
      }}
    </Field>
  );
});

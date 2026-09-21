import { forwardRef, useState } from "react";

import { cn } from "../cn.js";
import { control } from "../variants.js";

/**
 * NumberInput — ATOMIC-INVENTORY §1 atom 10.
 *
 * Headcounts, caps, ceilings, ports, dollars. Same shell as `Input`, from the shared `control`
 * CVA, plus two things that are specific to a figure.
 *
 * **Tabular numerals.** Every sans step already carries
 * `font-variant-numeric: tabular-nums slashed-zero` by construction, so the `t-ui` step inside
 * `control` gives this control lining tabular figures and a slashed zero with no utility of its
 * own. DESIGN-SYSTEM §4.4 is explicit that `tabular-nums` should appear zero times outside the
 * type utilities after the port, so writing it here would be the bug, not the fix.
 *
 * **A field you can actually clear.** The prop is a `number`, so a strictly controlled
 * `value={value}` makes the empty string unrepresentable and the field impossible to empty while
 * retyping. The typed text is therefore buffered as a string and re-synced whenever the number
 * arrives from outside; `onChange` fires only for a value that actually parses, so a caller never
 * receives `NaN`. A half-typed entry left behind on blur snaps back to the number in force.
 */
export interface NumberInputProps {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  id?: string;
  describedBy?: string;
  invalid?: boolean;
}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { value, onChange, min, max, step = 1, disabled = false, id, describedBy, invalid = false },
  ref,
) {
  const [draft, setDraft] = useState(() => String(value));
  const [lastValue, setLastValue] = useState(value);

  // Adjusting state during render — the sanctioned pattern for deriving from a prop. A number
  // arriving from outside wins over whatever is half-typed; typing that parses to the same
  // number leaves the draft alone, so "007" is not rewritten under the cursor.
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(String(value));
  }

  return (
    <input
      ref={ref}
      id={id}
      type="number"
      inputMode="numeric"
      value={draft}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={describedBy}
      onChange={(event) => {
        const next = event.currentTarget.value;
        setDraft(next);
        const parsed = Number(next);
        if (next.trim() !== "" && Number.isFinite(parsed)) {
          setLastValue(parsed);
          onChange(parsed);
        }
      }}
      onBlur={() => {
        const parsed = Number(draft);
        if (draft.trim() === "" || !Number.isFinite(parsed)) setDraft(String(value));
      }}
      className={cn(control({ invalid, fullWidth: true }))}
    />
  );
});

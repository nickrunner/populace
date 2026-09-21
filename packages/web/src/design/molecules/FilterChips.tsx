import { useId, type ReactElement, type ReactNode } from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";

import { Text, VisuallyHidden } from "../atoms/index.js";
import { FilterChip } from "./FilterChip.js";

/**
 * FilterChips — one filter, chosen from a short closed set (ATOMIC-INVENTORY §2, molecule 12).
 *
 * The app's version today is a row of bare `<button>`s: no group semantics, no roving tabindex,
 * no pressed state and no focus style, so a keyboard user tabs through every filter on the screen
 * one at a time and never learns which one is on. This is a Radix `ToggleGroup` with
 * `type="single"`, which fixes all four at once — one tab stop for the whole row, arrows to move
 * between chips, and the selected chip announced rather than merely tinted.
 *
 * **Every chip carries its count** (§2, molecule 11). A count is what makes a chip worth
 * clicking: "Critical 4" is a decision and "Critical" is a coin toss. Options with a zero count
 * are still rendered — a filter that would leave nothing standing is itself a fact about the
 * execution, and silently dropping it would make the row's contents change shape under the
 * reader between polls.
 *
 * **"all" is a real value, not the absence of one.** `value` is `T | "all"` and the "all" chip is
 * an ordinary item, so clicking the selected chip a second time — which Radix reports as the
 * empty string — lands back on "all" rather than on a nameless unfiltered state. (A `T` whose
 * literal value is the string `"all"` would collide with it; no domain union in this product has
 * one, and the resolution below prefers the option, so the collision degrades to "the option
 * wins" rather than to a crash.)
 *
 * `legend` names the group for a screen reader and is not drawn, because on screen the chips are
 * beneath a heading that already says what they filter. Radix puts `role="radiogroup"` on the
 * root in single mode, so the legend arrives as the group's accessible name and every chip is a
 * `role="radio"` within it.
 */

/** One filter, and how many records sit behind it. */
export interface FilterOption<T extends string> {
  value: T;
  /** Always a word, sentence case (§7.4). */
  label: string;
  count?: number;
}

export interface FilterChipsProps<T extends string> {
  options: readonly FilterOption<T>[];
  value: T | "all";
  onChange: (v: T | "all") => void;
  /** The unfiltered chip's word — "Everything", "All findings", "Every cohort". */
  allLabel: string;
  allCount?: number;
  /** The group's accessible name. Rendered for a screen reader only. */
  legend: string;
  /** A fact about what the filter left, pushed to the far end of the row. */
  trailing?: ReactNode;
}

/**
 * Not a `forwardRef`: the generic parameter is load-bearing here — it is what keeps `onChange`
 * narrowed to the caller's own union — and `forwardRef` erases it unless the result is cast,
 * which this codebase does not allow (ADR-0001). Nothing needs a handle on the row.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  allLabel,
  allCount,
  legend,
  trailing,
}: FilterChipsProps<T>): ReactElement {
  const legendId = useId();

  /**
   * Radix hands back a plain `string` — the chosen item's value, or `""` when the current chip
   * was pressed again. Resolving it against `options` rather than asserting it back to `T` keeps
   * the union honest without a cast, and folds both "deselected" and "unknown" onto "all".
   */
  const select = (next: string): void => {
    const chosen = options.find((option) => option.value === next);
    onChange(chosen === undefined ? "all" : chosen.value);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <VisuallyHidden>
        <span id={legendId}>{legend}</span>
      </VisuallyHidden>
      <ToggleGroupPrimitive.Root
        type="single"
        value={value}
        onValueChange={select}
        aria-labelledby={legendId}
        className="flex flex-wrap items-center gap-2"
      >
        <FilterChip value="all" label={allLabel} count={allCount} selected={value === "all"} />
        {options.map((option) => (
          <FilterChip
            key={option.value}
            value={option.value}
            label={option.label}
            count={option.count}
            selected={value === option.value}
          />
        ))}
      </ToggleGroupPrimitive.Root>
      {trailing === undefined ? null : (
        <Text as="div" size="meta" tone="muted" className="ml-auto">
          {trailing}
        </Text>
      )}
    </div>
  );
}

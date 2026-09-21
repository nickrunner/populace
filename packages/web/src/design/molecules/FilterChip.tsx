import { forwardRef } from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";

import { Chip } from "../atoms/index.js";

/**
 * FilterChip — one selectable filter, with its count (ATOMIC-INVENTORY §2, molecule 11).
 *
 * It is a `ToggleGroup.Item` wearing a `Chip`, and that order matters. The Radix item has to
 * be the element that actually renders, because it is what carries the roving `tabIndex`, the
 * `role="radio"` / `aria-checked` pair and the arrow-key handlers that the app's hand-rolled
 * chips lack today. So the composition is `Chip asChild` with the item as its single child: the
 * chip contributes its class string and its count, the item contributes the behaviour, and
 * exactly one `<button>` reaches the DOM.
 *
 * **The count is not optional furniture.** A filter chip that does not say how many records sit
 * behind it is a guess, so the count is part of the primitive rather than a flag on it; the only
 * chips that omit it are ones whose total genuinely is not known yet.
 *
 * Selection is passed in rather than read from the group, because the chip's *look* is a token
 * decision — `tone="selected"` is `primary-wash` on a `primary` hairline — and `Chip` takes a
 * tone, not a data attribute. Radix still owns the semantics; this only owns the paint.
 *
 * Must be rendered inside a `FilterChips` (or any `ToggleGroup.Root`); the item reads its group
 * from context and throws outside one, which is the Radix idiom and the reason there is no
 * standalone escape hatch here.
 */
export interface FilterChipProps {
  /** The group value this chip selects. Unique within its `FilterChips`. */
  value: string;
  /** Always a word. Sentence case (§7.4). */
  label: string;
  /** How many records this filter would leave standing. Tabular by construction (§4.4). */
  count?: number;
  /** Whether this chip is the group's current value. */
  selected: boolean;
}

export const FilterChip = forwardRef<HTMLButtonElement, FilterChipProps>(function FilterChip(
  { value, label, count, selected },
  ref,
) {
  return (
    <Chip asChild tone={selected ? "selected" : "neutral"} count={count}>
      <ToggleGroupPrimitive.Item ref={ref} value={value}>
        {label}
      </ToggleGroupPrimitive.Item>
    </Chip>
  );
});

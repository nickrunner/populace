import { useId, type ReactNode } from "react";

import { Button, IconButton, Inline, Separator, Spacer, Stack, Text } from "../atoms/index.js";

/**
 * Repeater — a field group the reader can have more than one of, and can take one away again.
 *
 * ATOMIC-INVENTORY §5 page 9 names it among `Target`'s principal parts, and §6.3 row 22 says what
 * it is there to fix: the MCP-endpoint repeater on that screen **has no remove button**. A reader
 * who pressed *Add another endpoint* by accident, or who moved a target from two endpoints to one,
 * had no way back except to empty the URL and hope — which saves an endpoint with an empty address
 * rather than saving one fewer endpoint. That is a real bug, and one control fixes it everywhere a
 * list of field groups is edited.
 *
 * **Every group is named, and the name is the locator.** "Second address" above a group is what
 * makes its remove control unambiguous — `aria-label="Remove second address"` rather than eleven
 * buttons all called *Remove*. The caller supplies the names because only it knows the noun.
 *
 * **The last one is at a bound, not gone** (§6, §7.4). Where the record needs at least one, the
 * final remove control keeps its tab stop, its name and its tooltip, wears `aria-disabled` and
 * swallows the press, and a sentence beneath the group says why — pointed at by
 * `aria-describedby`, so the reason reaches the control that is refusing rather than sitting on
 * the page unattached.
 *
 * It owns no field of its own: what is inside a group is the caller's `fields`, which keeps this
 * a layout and a rule about removal rather than a second form language.
 */

export interface RepeaterItem {
  /** Stable across renders — this is the React key, so it is what the group IS, not where it is. */
  id: string;
  /** Names this group among its siblings, sentence case: "First address", "Second address". */
  label: string;
  /** The group's own controls. */
  fields: ReactNode;
}

export interface RepeaterProps {
  /** The group's name, sentence case. Drawn once, above the first item. */
  legend: string;
  items: readonly RepeaterItem[];
  onAdd: () => void;
  /** Names the act in the product's own words — "Add another address". Never "Add". */
  addLabel: string;
  onRemove: (index: number) => void;
  /** How many the record must keep. Default 1. */
  min?: number;
  /** Why the last one cannot go. Shown beneath the group and named by the bound control. */
  minReason?: string;
}

export function Repeater({
  legend,
  items,
  onAdd,
  addLabel,
  onRemove,
  min = 1,
  minReason = "At least one is needed.",
}: RepeaterProps): ReactNode {
  const reasonId = useId();
  // At the bound only where there is something a press would take away: a group the record does
  // not require and that is currently empty has no refusal to explain.
  const atBound = items.length <= min && items.length > 0;

  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="t-label mb-1.5 p-0 text-ink-muted">{legend}</legend>

      <Stack gap={4}>
        {items.map((item, index) => (
          <Stack key={item.id} gap={3}>
            {index === 0 ? null : <Separator />}
            <Inline gap={2} align="center">
              <Text size="label" tone="muted">
                {item.label}
              </Text>
              <Spacer />
              <IconButton
                icon="x"
                label={`Remove ${item.label.toLowerCase()}`}
                variant="quiet"
                size="sm"
                disabled={atBound}
                aria-describedby={atBound ? reasonId : undefined}
                onClick={() => {
                  onRemove(index);
                }}
              />
            </Inline>
            {item.fields}
          </Stack>
        ))}

        <Inline gap={3} align="center">
          <Button variant="secondary" size="sm" onClick={onAdd}>
            {addLabel}
          </Button>
          {atBound ? (
            <Text size="meta" tone="muted" id={reasonId}>
              {minReason}
            </Text>
          ) : null}
        </Inline>
      </Stack>
    </fieldset>
  );
}

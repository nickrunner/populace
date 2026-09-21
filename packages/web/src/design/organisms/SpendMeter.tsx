import { forwardRef } from "react";

import { Meter, Stack, Text } from "../atoms/index.js";
import { Money } from "../molecules/index.js";

/**
 * SpendMeter — ATOMIC-INVENTORY §3, organism 32. Part of the shell.
 *
 * What today's rail draws as a bare `Bar` with a number above it and a caption beneath. The
 * geometry is unchanged — caption, figure, meter, what-it-is-out-of — and three things about it
 * are new, each of them a rule rather than a preference:
 *
 *  1. **It reaches a screen reader.** `Meter` is a `role="progressbar"` carrying a *sentence* as
 *     both its name and its `aria-valuetext` (§6, "Never colour alone"). The number in today's
 *     rail is drawn and then announced to nobody, because a `<div>` with a width on it says
 *     nothing at all.
 *  2. **Past the ceiling is a word, not a colour.** A meter pinned at 100% looks exactly like a
 *     meter at 99%, so the caption changes with it and the fill turns `critical` only in company
 *     with that word (§4.2). Below the ceiling the fill is the graph mark like every other meter
 *     in the product: money spent is a *reading*, and `primary` — the thing you act on, and the
 *     person who is here — may never be a bar fill (§4.1). Nothing about a running total is
 *     something the reader acts on.
 *  3. **The width never transitions** (§5.1). `Meter` writes `transition-none` for this reason:
 *     the live screens re-poll every two seconds and an animated width would twitch forever.
 *
 * The figure is `figure-sm`, not `figure`: 32px of money in a 236px rail is a headline, and what
 * the rail is doing here is reporting a running total, not making a point.
 */

export interface SpendMeterProps {
  /** Dollars already spent today, across the whole project. */
  spent: number;
  /** The daily ceiling in dollars, or null where none is set. */
  ceiling: number | null;
}

export const SpendMeter = forwardRef<HTMLElement, SpendMeterProps>(function SpendMeter(
  { spent, ceiling },
  ref,
) {
  const money = (value: number): string => `$${value.toFixed(2)}`;
  // A ceiling of zero is not a ceiling anyone set; it is the absence of one, and dividing a
  // meter by it would be a reading of nothing.
  const capped = ceiling !== null && ceiling > 0;
  const over = capped && spent >= ceiling;

  const caption = !capped
    ? "with no daily ceiling set"
    : over
      ? `past the ${money(ceiling)} daily ceiling`
      : `of the ${money(ceiling)} daily ceiling`;

  return (
    <Stack ref={ref} gap={2}>
      <div>
        <Text as="div" size="label" tone="muted">
          Spent today
        </Text>
        <Text as="div" size="figure-sm">
          <Money usd={spent} />
        </Text>
      </div>

      {capped ? (
        <Meter
          value={spent}
          of={ceiling}
          size="sm"
          tone={over ? "over" : "spent"}
          // The name and the value text are one sentence, so the reading is the same whether it
          // is seen or heard (§6).
          label={
            over
              ? `Spent ${money(spent)}, past the ${money(ceiling)} daily ceiling.`
              : `Spent ${money(spent)} of the ${money(ceiling)} daily ceiling.`
          }
        />
      ) : null}

      <Text as="div" size="meta" tone={over ? "critical" : "muted"}>
        {caption}
      </Text>
    </Stack>
  );
});

import { forwardRef } from "react";

/**
 * Money and Duration — the two figures the product prints everywhere — ATOMIC-INVENTORY §2,
 * molecule 28. One file, because they are one decision: a quantity with a unit, formatted once,
 * so that thirty call sites stop each having an opinion.
 *
 * Between them they replace the `usd()`, `usd4()` and `ms()` call sites in `format.ts`. The
 * fourth, `lasted()`, is not here: a span between two instants is a *time*, and `RelativeTime`
 * owns it at `mode="elapsed"`.
 *
 * **Neither sets a type step, and that is the whole trick.** A figure is a `Stat`'s 32px
 * `t-figure` at one site, a table cell's 13px `t-ui` at the next and a meta line's 12px `t-meta`
 * at the third — so the family, the size and the tabular behaviour are the ones it *inherits*.
 * §4.4 bakes `tabular-nums slashed-zero` into every sans and every mono step, so neither of these
 * ever applies it by hand, and a column of them aligns wherever it lands.
 *
 * The one thing both insist on is that a quantity never breaks across two lines: `$12.47` and
 * `1.4s` are single words to a reader, whatever the measure does to the sentence around them.
 *
 * Nothing here animates (§5.1). There is no count-up and there must never be one: a figure that
 * spins from 0 to 47 is lying about a measurement for half a second, and in a product whose
 * honesty clause is *"outcomes vary between executions"* a spinning number is a lie about
 * precision.
 */

/** Shared by both: a quantity is one word. */
const FIGURE = "whitespace-nowrap";

/**
 * Sub-cent amounts need four places; anything a person would call a total needs two.
 *
 * `precision` is a *ceiling*, not a `toFixed` argument. At four places a per-visit cost of
 * `$0.0037` is a number and at two it is `$0.00`, which reads as free — but a run total must not
 * render as `$12.4700`, so the extra places are dropped the moment the amount is large enough to
 * carry them. That is exactly what `usd4()` does today, preserved rather than reinvented.
 */
function formatUsd(value: number, precision: 2 | 4): string {
  const places = precision === 4 && Math.abs(value) < 0.01 ? 4 : 2;
  return `$${value.toFixed(places)}`;
}

/**
 * Milliseconds, in the largest unit that still says something true.
 *
 * Under a second the figure is whole milliseconds — a 240ms call is *240ms*, and `0.2s` throws
 * away the only digits that distinguish it from the next one. Under a minute it is one decimal
 * of a second, which is `format.ts`'s own threshold. Above that it is minutes and whole seconds,
 * because `125.4s` asks the reader to do the division themselves.
 */
function formatMs(value: number): string {
  const total = Math.max(0, value);
  if (total < 1000) return `${Math.round(total)}ms`;
  if (total < 60_000) return `${(total / 1000).toFixed(1)}s`;
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.round((total % 60_000) / 1000);
  // 59.6s rounds to 60, which would print `3m 60s`; carry it into the minute instead.
  return seconds === 60 ? `${minutes + 1}m 00s` : `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export interface MoneyProps {
  /** The amount in US dollars. */
  usd: number;
  /** The maximum number of decimal places. Default 2; 4 for per-visit and per-person costs. */
  precision?: 2 | 4;
}

export const Money = forwardRef<HTMLSpanElement, MoneyProps>(function Money(
  { usd, precision = 2 },
  ref,
) {
  return (
    <span ref={ref} className={FIGURE}>
      {formatUsd(usd, precision)}
    </span>
  );
});

export interface DurationProps {
  /** How long, in milliseconds. */
  ms: number;
}

export const Duration = forwardRef<HTMLSpanElement, DurationProps>(function Duration({ ms }, ref) {
  return (
    <span ref={ref} className={FIGURE}>
      {formatMs(ms)}
    </span>
  );
});

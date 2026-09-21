import { forwardRef, useEffect, useReducer, type ForwardedRef } from "react";

import { ago, lasted, when } from "../../format.js";

/**
 * RelativeTime — one instant, in the words a person would use — ATOMIC-INVENTORY §2, molecule 27.
 *
 * Twenty-two sites and **four separate implementations** today: `ago()`, `when()`, `lasted()`,
 * `LiveRun`'s private `countdown()` and `Saved`'s private copy of `ago()` with a different
 * threshold, so the same gap reads as "just now" in one corner of a screen and "1 minutes ago" in
 * another. This is the single implementation, and the four modes are the four questions anyone
 * asks about a timestamp:
 *
 *   ago        how long since        "four minutes ago"
 *   absolute   when exactly          "14 Mar 09:41"
 *   elapsed    how long it ran for   "four minutes"
 *   countdown  how long until        "in 4 minutes"
 *
 * **It always renders a `<time>`.** `dateTime` carries the machine-readable instant so a reader,
 * an extension or a test can recover the exact moment from a phrase that deliberately rounds, and
 * `title` carries the absolute timestamp, so "four minutes ago" is never the only thing on the
 * page that knows when this happened. Where the instant is absent there is nothing to be precise
 * about, so the word stands alone in a `<span>` — a `<time>` with no parseable instant is invalid
 * and tells assistive technology something false.
 *
 * `tick` self-updates once a second. Today only `LiveRun` ticks and every other time on every
 * other screen freezes at first paint, so a visit that finished two minutes ago still says "just
 * now" a quarter of an hour later. Ticking is a re-render, not an animation: the text is replaced
 * outright, nothing transitions, and §5.1's ban on animated numbers holds.
 */
export type RelativeTimeMode = "ago" | "absolute" | "countdown" | "elapsed";

export interface RelativeTimeProps {
  /** The instant, ISO-8601. `null` where the product genuinely has none. */
  at: string | null;
  /** Which question this answers. Default `"ago"`. */
  mode?: RelativeTimeMode;
  /** Self-update every second — for anything counting down or still running. */
  tick?: boolean;
}

/** How long until an instant, in the same voice and at the same thresholds as `ago()`. */
function until(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (seconds <= 0) return "due now";
  if (seconds < 90) return `in ${seconds} seconds`;
  if (seconds < 5400) return `in ${Math.round(seconds / 60)} minutes`;
  if (seconds < 86_400) return `in ${Math.round(seconds / 3600)} hours`;
  if (seconds < 7 * 86_400) return `in ${Math.round(seconds / 86_400)} days`;
  return when(iso);
}

/** What each mode says when there is no instant at all. */
const NOTHING: Record<RelativeTimeMode, string> = {
  ago: "never",
  absolute: "—",
  elapsed: "—",
  countdown: "not scheduled",
};

function words(iso: string, mode: RelativeTimeMode): string {
  switch (mode) {
    case "absolute":
      return when(iso);
    case "elapsed":
      return lasted(iso, null);
    case "countdown":
      return until(iso);
    default:
      return ago(iso);
  }
}

/**
 * One callback that satisfies both tags' `ref` slots. A `<time>` wants `HTMLTimeElement` and a
 * `<span>` wants `HTMLSpanElement`; a callback taking the element type both extend is assignable
 * to each by ordinary parameter contravariance, which keeps the public ref type honest without a
 * cast.
 */
function assignTo(ref: ForwardedRef<HTMLElement>): (node: HTMLElement | null) => void {
  return (node) => {
    if (typeof ref === "function") ref(node);
    else if (ref !== null) ref.current = node;
  };
}

export const RelativeTime = forwardRef<HTMLElement, RelativeTimeProps>(function RelativeTime(
  { at, mode = "ago", tick = false },
  ref,
) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!tick) return;
    const id = window.setInterval(redraw, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [tick]);

  const attach = assignTo(ref);
  const classes = "whitespace-nowrap";
  const instant = at === null ? Number.NaN : new Date(at).getTime();

  // A malformed instant is a bug upstream, not a reason to throw a screen away: say there is
  // nothing rather than hand `toLocaleString` a NaN and take the route down with a RangeError.
  if (at === null || Number.isNaN(instant)) {
    return (
      <span ref={attach} className={classes}>
        {NOTHING[mode]}
      </span>
    );
  }

  const exact = new Date(instant).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });

  return (
    <time ref={attach} className={classes} dateTime={at} title={exact}>
      {words(at, mode)}
    </time>
  );
});

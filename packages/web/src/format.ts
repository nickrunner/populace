import type { JsonValue } from "@populace/core/isomorphic";
import type { ClusterCard, Finding, LiveEvent, TraceEvent } from "./api.js";

export const usd = (value: number): string => `$${value.toFixed(2)}`;
export const usd4 = (value: number): string => `$${value.toFixed(value < 0.01 ? 4 : 2)}`;

export const clock = (iso: string | null): string =>
  iso === null ? "—" : new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

export const when = (iso: string | null): string =>
  iso === null ? "—" : new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * The counting helpers live in `@populace/fix-prompt` now, because the fix prompt needs them and
 * cannot depend on the dashboard. They are re-exported from here rather than copied: every screen
 * imports them from `format.js` and there is one definition of "1 person" in the product.
 *
 * `verdictWords` came the same way and for a sharper reason: the server files issues with it and
 * cannot import a screen, while the dashboard can and does import the leaf. A verdict worded one
 * way inside an issue and another way on the screen that issue links to is two accounts of one
 * event, and "did not recur" is the wording that matters — `not-reproduced` reads to a stranger
 * as a claim the problem is gone, which nothing in this product may make. It takes the verdict
 * union rather than a bare string, so a fourth verdict fails to compile here, and it carries
 * `null` as "not checked yet" so no caller writes that sentence itself.
 */
export { people, plural, verdictWords } from "@populace/fix-prompt";

export const ms = (value: number): string => (value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`);

/** Initials for the persona chip the design puts beside every quote. */
export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

/** How a visit ended, in the words the design uses rather than the enum's. */
export const wakeOutcome = (status: string): string =>
  ({
    done: "finished",
    "gave-up": "gave up",
    "max-turns": "ran out of turns",
    "budget-exceeded": "hit a budget",
    "auth-failed": "the account's token was rejected",
    killed: "stopped",
    running: "in progress",
    error: "errored",
  })[status] ?? status;

/** A finding's own words, preferring the description the persona wrote. */
export const inTheirWords = (finding: Finding): string => finding.description || finding.observed;

export const isToolCall = (event: TraceEvent): event is Extract<TraceEvent, { type: "tool.call" }> => event.type === "tool.call";

/**
 * How long ago, in the words a person would use. A timestamp is precise and unreadable; "three
 * minutes ago" is what somebody actually wants to know about a problem that just came back.
 */
export const ago = (iso: string | null): string => {
  if (iso === null) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} hours ago`;
  if (seconds < 7 * 86_400) return `${Math.round(seconds / 86_400)} days ago`;
  return when(iso);
};

/** How long something went on for, from two instants, in the same voice as `ago`. */
export const lasted = (from: string | null, to: string | null): string => {
  if (from === null) return "—";
  const seconds = Math.max(0, Math.round(((to === null ? Date.now() : new Date(to).getTime()) - new Date(from).getTime()) / 1000));
  if (seconds < 90) return `${seconds} seconds`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 2 * 86_400) return `${Math.round(seconds / 3600)} hours`;
  return `${Math.round(seconds / 86_400)} days`;
};

/**
 * The two scopes every problem card carries, and nothing else.
 *
 * `seenIn` counts EXECUTIONS and `seenInWindows` counts report WINDOWS — an execution boundary for
 * an ephemeral study, a report cycle for a longitudinal one (ADR-0045) — and `inLatest` is about
 * the newest window anybody visited. A screen that wants to name an execution needs all three,
 * which is why they travel together as a shape rather than as three arguments nobody can keep in
 * the right order.
 */
export interface ClusterScopes {
  seenIn: number[];
  seenInWindows?: number[];
  inLatest: boolean;
}

/**
 * **Whether a sentence about this card may name an execution at all. This is the only place that
 * judgement is made, and both callers read it from here.**
 *
 * There were two of them, and that is how this bug kept coming back: `stateOfCluster` below asked
 * the study's MODE while `ClusterRow` asked whether the card's own two scopes agreed. Both were
 * right only because report cycles are armed for longitudinal studies alone — the moment an
 * ephemeral study is given cycles, mode says "ephemeral, so name executions" about a card whose
 * state was computed over cycles, and the number printed under the word "execution" is a window
 * ordinal again. One judgement, in one place, is the fix; the better one is a boolean computed by
 * the producer, which is the only thing that holds the whole study (see the report note).
 *
 * The rule, in two parts, and both are exact rather than heuristic:
 *
 * 1. **The ordinals must be the same list.** One window per execution is what makes `seenIn` and
 *    `seenInWindows` name the same stretches, and when they do, window `k` IS execution `k`:
 *    both count from 1 across the study. Equal LENGTH is not enough and was the hole — a long
 *    ephemeral run with cycles can report a problem in windows 2 and 3 which fall in executions 1
 *    and 2, two entries each, naming four different stretches.
 * 2. **An absence needs a later EXECUTION to be absent from.** Where `inLatest` is true the newest
 *    visited window reported it, so the newest ordinal in the list is that window and part 1 has
 *    already matched it to an execution. Where it is false, the window that went quiet is not in
 *    the list at all, and for a longitudinal study it is another cycle of the one execution the
 *    card names — which is how "last reported in execution 1" got printed about a study whose only
 *    execution is still running. So the execution being read has to be strictly later than the
 *    last one that reported it. Without a `currentSeq` there is no witness and the answer is no.
 *
 * Everywhere the answer is no, the caller says the time-based thing instead — "not reported since
 * 7 hours ago" — which is true at either scope and is the better sentence besides: a soak that has
 * been running for three days is not described by any count of anything.
 *
 * An absent `seenInWindows` is a card from a producer with no window scope of its own — the design
 * fixtures, and nothing populace serves — and those cards are execution-scoped by construction.
 */
export function executionScoped(card: ClusterScopes, currentSeq: number | undefined): boolean {
  const windows = card.seenInWindows;
  if (windows === undefined) return true;
  if (windows.length !== card.seenIn.length) return false;
  if (windows.some((ordinal, at) => ordinal !== card.seenIn[at])) return false;
  if (card.inLatest) return true;
  const lastSeenIn = card.seenIn.at(-1);
  return currentSeq !== undefined && lastSeenIn !== undefined && lastSeenIn < currentSeq;
}

/**
 * What a cluster's life reads from. A card and a detail view disagree about `peopleHit` — on the
 * detail it is the people themselves — so this takes the fields the words are made of rather than
 * either whole shape: the state, the two timestamps, and the scopes the judgement above is made
 * over.
 */
export interface ClusterLife extends ClusterScopes {
  state: ClusterCard["state"];
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

export interface ClusterStateWords {
  /** The one word, in `t-label`. */
  badge: string;
  /** What that word is based on, in `t-meta`. */
  detail: string;
  ink: string;
}

/**
 * What has happened to one problem, in words this product is willing to stand behind.
 *
 * A signature is a hash of an exact token set, and stage 5 measured what that means: identical or
 * punctuation-varied wording recurs 100% of the time, a complaint the model rewords from scratch
 * recurs 0% of the time (`packages/reports/src/stability.test.ts`, ADR-0028 amendment). So an
 * absence is reported as an absence — "not reported in execution 7" — and never as "fixed". The
 * only place the word `fixed` appears is where a HUMAN typed it, on the triage control.
 *
 * **Which of the two voices it speaks in is `executionScoped`'s decision and no longer the
 * study's mode.** The words are unchanged: what used to be the longitudinal branch is the branch
 * for a card whose state was computed over stretches that are not executions, which is every
 * longitudinal card with more than one window and any ephemeral card from a study with cycles
 * armed. `mode` is still accepted because every call site has one to hand and dropping it would
 * touch screens outside this change, and it is deliberately not consulted: two ways to answer one
 * question is the defect this function was part of.
 */
export function stateOfCluster(card: ClusterLife, _mode: "ephemeral" | "longitudinal", seqs: number[]): ClusterStateWords {
  const latest = seqs.at(-1);
  const lastSeenIn = card.seenIn.at(-1);
  if (!executionScoped(card, latest)) {
    switch (card.state) {
      case "new":
        return { badge: "new", detail: `first reported ${ago(card.firstSeenAt)}`, ink: "text-critical" };
      case "regressed":
        return { badge: "back", detail: `reported again ${ago(card.lastSeenAt)}`, ink: "text-critical" };
      case "fixed":
        return { badge: "gone quiet", detail: `not reported since ${ago(card.lastSeenAt)}`, ink: "text-ink-muted" };
      default:
        return { badge: "open", detail: `first ${ago(card.firstSeenAt)} · last ${ago(card.lastSeenAt)}`, ink: "text-high" };
    }
  }
  switch (card.state) {
    case "new":
      return { badge: "new", detail: latest === undefined ? "first time it has come up" : `first reported in execution ${latest}`, ink: "text-critical" };
    case "regressed":
      return { badge: "back", detail: latest === undefined ? "reported again" : `absent, and back in execution ${latest}`, ink: "text-critical" };
    case "fixed":
      return {
        badge: "not reported",
        detail: lastSeenIn === undefined ? "not in this execution" : `last reported in execution ${lastSeenIn}`,
        ink: "text-ink-muted",
      };
    default:
      return { badge: "open", detail: `reported in ${card.seenIn.length} of ${seqs.length} executions`, ink: "text-high" };
  }
}

/**
 * An event's payload is a `JsonValue` on the wire — the log carries whatever the emitter wrote —
 * so every field is read defensively rather than cast. An event type this build does not know
 * yet must render as a plain line, not break the screen it is on.
 */
export function payloadOf(event: LiveEvent): Record<string, JsonValue> {
  return typeof event.payload === "object" && event.payload !== null && !Array.isArray(event.payload) ? event.payload : {};
}

export function payloadText(event: LiveEvent, key: string): string {
  const value = payloadOf(event)[key];
  return typeof value === "string" ? value : "";
}

export function payloadNumber(event: LiveEvent, key: string): number {
  const value = payloadOf(event)[key];
  return typeof value === "number" ? value : 0;
}

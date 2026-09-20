import type { JsonValue } from "@populace/core/isomorphic";
import type { ClusterCard, Finding, LiveEvent, TraceEvent } from "./api.js";

export const usd = (value: number): string => `$${value.toFixed(2)}`;
export const usd4 = (value: number): string => `$${value.toFixed(value < 0.01 ? 4 : 2)}`;

export const clock = (iso: string | null): string =>
  iso === null ? "—" : new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

export const when = (iso: string | null): string =>
  iso === null ? "—" : new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Counts of people, in a sentence. "1 people" is the kind of thing that makes a product feel
 * unfinished, and this count appears on nearly every screen.
 */
export const people = (n: number): string => `${n} ${n === 1 ? "person" : "people"}`;

/** The same, for the other nouns that get counted beside it. */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

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

export const verdictWords = (verdict: string | null): string =>
  verdict === null
    ? "not checked yet"
    : ({ confirmed: "confirmed", "not-reproduced": "did not recur", inconclusive: "unsure" })[verdict] ?? verdict;

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
 * What a cluster's life reads from. A card and a detail view disagree about `peopleHit` — on the
 * detail it is the people themselves — so this takes the four fields the words are made of rather
 * than either whole shape.
 */
export interface ClusterLife {
  state: ClusterCard["state"];
  seenIn: number[];
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
 * What has happened to one problem across executions, in words this product is willing to stand
 * behind.
 *
 * A signature is a hash of an exact token set, and stage 5 measured what that means: identical or
 * punctuation-varied wording recurs 100% of the time, a complaint the model rewords from scratch
 * recurs 0% of the time (`packages/reports/src/stability.test.ts`, ADR-0028 amendment). So an
 * absence is reported as an absence — "not reported in execution 7" — and never as "fixed". The
 * only place the word `fixed` appears is where a HUMAN typed it, on the triage control.
 */
export function stateOfCluster(card: ClusterLife, mode: "ephemeral" | "longitudinal", seqs: number[]): ClusterStateWords {
  const latest = seqs.at(-1);
  const lastSeenIn = card.seenIn.at(-1);
  if (mode === "longitudinal") {
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

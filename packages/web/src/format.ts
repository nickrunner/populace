import type { Cluster, Finding, TraceEvent } from "./api.js";

export const usd = (value: number): string => `$${value.toFixed(2)}`;
export const usd4 = (value: number): string => `$${value.toFixed(value < 0.01 ? 4 : 2)}`;

export const clock = (iso: string | null): string =>
  iso === null ? "—" : new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

export const when = (iso: string | null): string =>
  iso === null ? "—" : new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

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
    killed: "stopped",
    running: "in progress",
    error: "errored",
  })[status] ?? status;

export const verdictWords = (verdict: string | null): string =>
  verdict === null
    ? "not checked yet"
    : ({ confirmed: "confirmed", "not-reproduced": "did not recur", inconclusive: "unsure" })[verdict] ?? verdict;

/** The kinds, grouped and titled the way the findings screen reads them. */
export const KIND_SECTIONS = [
  { kinds: ["bug"], title: "Bugs", sub: "something is broken" },
  { kinds: ["coverage-gap"], title: "Things people wanted and could not find", sub: "the surface is missing something" },
  { kinds: ["abandonment"], title: "People who left", sub: "and what it was over" },
  { kinds: ["friction"], title: "Friction", sub: "nothing broke, but it cost them" },
  { kinds: ["suggestion"], title: "What they asked for", sub: "in their own words" },
  { kinds: ["praise"], title: "What worked", sub: "worth not breaking" },
] as const;

export const clusterVerdict = (cluster: Cluster): string | null =>
  cluster.confirmedCount > 0 ? "confirmed" : cluster.inconclusiveCount > 0 ? "inconclusive" : cluster.notReproducedCount > 0 ? "not-reproduced" : null;

/** A finding's own words, preferring the description the persona wrote. */
export const inTheirWords = (finding: Finding): string => finding.description || finding.observed;

export const isToolCall = (event: TraceEvent): event is Extract<TraceEvent, { type: "tool.call" }> => event.type === "tool.call";

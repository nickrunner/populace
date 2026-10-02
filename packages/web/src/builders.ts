/**
 * What every builder page shares, and nothing a builder page is about (ADR-0043).
 *
 * The builders chain: a study builder with no populations sends the reader to the population
 * builder, which with no cohorts sends them on to the cohort builder, which with no personas sends
 * them to the persona builder. Three things make that a chain rather than a maze, and all three
 * live here so the four builders say them the same way:
 *
 * - `useThen` — how a builder remembers where it came from. The CURRENT builder's own address
 *   (path and query, so an inner `then` rides inside the outer one) goes on the link to the next
 *   builder as `?then=`; on success the next builder returns to it with `?picked=<id>` so the
 *   thing just made can be added to the mix the reader was in the middle of. A `then` is honoured
 *   only inside this project; anything else falls back to the created item's own page.
 * - `usePicked` — how the returning builder consumes `?picked=`: once, only when the list it picks
 *   from has caught up (the creating builder invalidates that list before navigating), and then
 *   it takes the parameter out of the address so a reload does not add the item twice.
 * - `useDraft` — how a CREATE builder survives the hop. Only create mode persists: in edit mode the
 *   server holds the truth. The draft is a zod-checked JSON blob in `sessionStorage` under the
 *   builder's own path; storage can throw (a private window) and can hold a stale shape, and both
 *   are treated as "no draft".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { z } from "zod";
import { useProject } from "./context.js";

const DRAFT_PREFIX = "populace:draft:";

/** The `?then=` value that points back at the page the reader is on right now. */
export function useThen(): {
  /** Encoded return address of THIS page, to put on links to the next builder. */
  then: string;
  /** `path` with `?then=<this page>` appended (and `&` when `path` already carries a query). */
  linkTo: (path: string) => string;
  /**
   * Where to go after creating `id`. The `then` this page was opened with, if it is inside this
   * project, with `picked=<id>` set on ITS query; otherwise `fallback`.
   */
  returnTo: (id: string, fallback: string) => string;
  /** Whether this page was opened from another builder (so the act button can say "and go back"). */
  fromBuilder: boolean;
} {
  const location = useLocation();
  const [params] = useSearchParams();
  const { href } = useProject();
  const then = encodeURIComponent(location.pathname + location.search);
  const incoming = params.get("then");
  const base = href();
  const fromBuilder = incoming !== null && incoming.startsWith(base);
  const linkTo = useCallback((path: string) => `${path}${path.includes("?") ? "&" : "?"}then=${then}`, [then]);
  const returnTo = useCallback(
    (id: string, fallback: string): string => {
      if (incoming === null || !incoming.startsWith(base)) return fallback;
      const url = new URL(incoming, window.location.origin);
      url.searchParams.set("picked", id);
      return url.pathname + url.search;
    },
    [incoming, base],
  );
  return { then, linkTo, returnTo, fromBuilder };
}

/**
 * Consume `?picked=<id>` once the options list holds it. `onPick` is called at most once per id,
 * after which the parameter is removed from the address (replace, so Back does not re-add it).
 */
export function usePicked(optionIds: readonly string[], onPick: (id: string) => void): void {
  const [params, setParams] = useSearchParams();
  const picked = params.get("picked");
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (picked === null || applied.current === picked) return;
    if (!optionIds.includes(picked)) return;
    applied.current = picked;
    onPick(picked);
    setParams(
      (prev) => {
        prev.delete("picked");
        return prev;
      },
      { replace: true },
    );
  }, [picked, optionIds, onPick, setParams]);
}

function readDraft<T>(key: string, schema: z.ZodType<T>): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw === null) return null;
    // `JSON.parse` is typed `any`, which ADR-0001 forbids; it goes straight into zod at the boundary.
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeDraft(key: string, value: object): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage refused (quota, private window): the draft simply does not survive a hop.
  }
}

function clearDraft(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Nothing to clear, or nowhere to clear it from.
  }
}

/**
 * A create builder's form state, restored from this tab's session when there is a draft and saved
 * back on every change. `restored` says whether the initial value came from storage, so the page
 * can show "Draft restored" with a way to start blank. `clear()` after a successful save, on
 * Cancel and on "Start blank".
 */
export function useDraft<T extends object>(
  schema: z.ZodType<T>,
  initial: () => T,
  options: { enabled?: boolean } = {},
): { draft: T; setDraft: (next: T | ((prev: T) => T)) => void; restored: boolean; clear: () => void; startBlank: () => void } {
  const enabled = options.enabled ?? true;
  const location = useLocation();
  const key = `${DRAFT_PREFIX}${location.pathname}`;
  const [state, setState] = useState<{ draft: T; restored: boolean }>(() => {
    if (!enabled) return { draft: initial(), restored: false };
    const stored = readDraft(key, schema);
    return stored === null ? { draft: initial(), restored: false } : { draft: stored, restored: true };
  });
  const first = useRef(true);
  useEffect(() => {
    if (!enabled) return;
    // Do not write the untouched initial value: a draft exists only once the reader has typed.
    if (first.current) {
      first.current = false;
      if (!state.restored) return;
    }
    const handle = window.setTimeout(() => writeDraft(key, state.draft), 250);
    return () => window.clearTimeout(handle);
  }, [enabled, key, state]);
  const setDraft = useCallback((next: T | ((prev: T) => T)) => {
    setState((prev) => ({ draft: typeof next === "function" ? (next)(prev.draft) : next, restored: prev.restored }));
  }, []);
  const clear = useCallback(() => clearDraft(key), [key]);
  const startBlank = useCallback(() => {
    clearDraft(key);
    setState({ draft: initial(), restored: false });
  }, [key, initial]);
  return useMemo(() => ({ draft: state.draft, setDraft, restored: state.restored, clear, startBlank }), [state, setDraft, clear, startBlank]);
}

/** Navigate helper for the moment after a create succeeds: go to `returnTo(id, fallback)`. */
export function useAfterCreate(): (to: string) => void {
  const navigate = useNavigate();
  return useCallback((to: string) => void navigate(to, { replace: false }), [navigate]);
}

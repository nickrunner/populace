import { ReportCycleSchema } from "@populace/core/isomorphic";
import { describe, expect, it } from "vitest";

import { cycleFormOf, cycleMoved, cycleOf } from "./StudyBuilder.js";

/**
 * The report cycle as the study builder holds it (ADR-0045): the one control on how often populace
 * writes into somebody's issue tracker, which for a while existed on the stored schema and on no
 * screen at all.
 *
 * Three things have to hold, and each of them was a way for the control to lie about what saving
 * would do — the failure the Timing section's own comment is about.
 */
describe("the builder's report cycle", () => {
  /** A study read in a list comes without one; the fallback is the rhythm it actually runs on. */
  it("opens on the stored schema's own defaults when the row carried none", () => {
    const stored = ReportCycleSchema.parse({});
    expect(cycleFormOf(undefined)).toEqual({ every: stored.every, jitter: stored.jitter, initialDelay: stored.initialDelay, everyVisits: stored.everyVisits ?? 0 });
  });

  it("opens on the saved values when there are any, and shows a null visit count as nought", () => {
    expect(cycleFormOf({ every: 60_000, jitter: 1_000, initialDelay: 0, everyVisits: 12 })).toEqual({ every: 60_000, jitter: 1_000, initialDelay: 0, everyVisits: 12 });
    expect(cycleFormOf({ every: 60_000, jitter: 1_000, initialDelay: 0, everyVisits: null }).everyVisits).toBe(0);
  });

  /** Nought on the form is null on the wire, which is what leaves the clock as the only trigger. */
  it("sends nought visits as null, and a number as itself", () => {
    expect(cycleOf({ every: 60_000, jitter: 1_000, initialDelay: 0, everyVisits: 0 })).toEqual({ every: 60_000, jitter: 1_000, initialDelay: 0, everyVisits: null });
    expect(cycleOf({ every: 60_000, jitter: 1_000, initialDelay: 0, everyVisits: 9 }).everyVisits).toBe(9);
  });

  /**
   * Sent only when it moved. A save that carried the form's idea of the cycle every time would
   * replace a rhythm set in `populace.yaml` with whatever this screen happened to be showing.
   */
  it("is a change only when it differs from what was opened on", () => {
    const saved = cycleFormOf({ every: 60_000, jitter: 1_000, initialDelay: 0, everyVisits: null });
    expect(cycleMoved(saved, saved)).toBe(false);
    expect(cycleMoved({ ...saved, jitter: 2_000 }, saved)).toBe(true);
    // Nought and null are the same choice, so opening on null and leaving it alone is not a change.
    expect(cycleMoved({ ...saved, everyVisits: 0 }, saved)).toBe(false);
  });
});

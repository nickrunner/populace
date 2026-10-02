import { ReportCycleSchema } from "@populace/core/isomorphic";
import { describe, expect, it } from "vitest";

import { ReportCycleInputSchema, StudyCreateInputSchema, StudySummaryViewSchema } from "./project.js";

/**
 * The wire shapes whose defaults are a hazard rather than a convenience.
 *
 * `reportCycle` is how often a running study stops to report — and therefore how often populace
 * writes into somebody's issue tracker (ADR-0045). It reached the stored schema before it reached
 * the contract, the dashboard, the CLI or `populace.yaml`, so the one dial on the feature's own
 * worst hazard could not be turned at all. These are the two things that had to be true for it to
 * be settable safely, and neither is visible by reading the schema.
 */
describe("the report cycle on the way up", () => {
  /**
   * The trap `SettingsInputSchema` documents for the guardrail blocks, in the one place it would
   * do the most damage. `.partial()` makes a key optional and LEAVES the field's prefault in place,
   * so a sender naming one field gets all four — and a merge over the saved row would replace two
   * settings nobody mentioned.
   */
  it("carries no defaults, so a field nobody sent stays absent", () => {
    const partial = ReportCycleInputSchema.parse({ every: "2h" });
    expect(partial).toEqual({ every: 2 * 3_600_000 });
    expect(ReportCycleInputSchema.parse({})).toEqual({});

    // What it is deliberately NOT, so the difference is asserted rather than described.
    expect(Object.keys(ReportCycleSchema.partial().parse({ every: "2h" })).sort()).toEqual(["every", "everyVisits", "initialDelay", "jitter"]);
  });

  /** Null is a choice — time as the only trigger — and has to survive the trip as one. */
  it("keeps a null visit count, which is not the same as leaving it out", () => {
    expect(ReportCycleInputSchema.parse({ everyVisits: null })).toEqual({ everyVisits: null });
    expect(ReportCycleInputSchema.safeParse({ everyVisits: 0 }).success).toBe(false);
  });

  /**
   * The drift guard. The input shape is written out rather than derived, so a field added to the
   * stored schema would otherwise be quietly unsettable — which is the exact bug this closes.
   */
  it("offers every field the stored cycle has", () => {
    expect(Object.keys(ReportCycleInputSchema.shape).sort()).toEqual(Object.keys(ReportCycleSchema.shape).sort());
  });

  it("is on the study's create and patch inputs, and on the study a builder opens on", () => {
    const created = StudyCreateInputSchema.parse({ name: "Soak", populationId: "pop", targetId: "tgt", size: 4, reportCycle: { every: "30m" } });
    expect(created.reportCycle).toEqual({ every: 30 * 60_000 });
    expect(StudyCreateInputSchema.parse({ name: "Soak", populationId: "pop", targetId: "tgt", size: 4 }).reportCycle).toBeUndefined();
    expect(StudySummaryViewSchema.shape.reportCycle.safeParse({ every: "1h" }).success).toBe(true);
  });
});

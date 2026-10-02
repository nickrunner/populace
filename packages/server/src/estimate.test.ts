import { EstimateViewSchema } from "@populace/contract";
import { PopulaceConfigSchema } from "@populace/core";
import { SqliteStore } from "@populace/store-sqlite";
import { describe, expect, it } from "vitest";
import { estimateRun, plannedVisits, toEstimateView, zeroEstimate, type RunEstimate } from "./estimate.js";

/**
 * Two cohorts on ONE persona is the configuration this restructure exists to support, and it is
 * the one that makes a per-persona row ambiguous: both rows carry `casual`. The row is per COHORT,
 * so the cohort slug is what tells them apart and what the estimate has to carry.
 */
const config = PopulaceConfigSchema.parse({
  target: { name: "Tasklet", mcp: [{ url: "http://127.0.0.1:1/" }] },
  identity: { strategy: "self-signup", signupTool: "sign_up" },
  // A visit cap is what makes a study ephemeral, and an ephemeral study is what makes the
  // estimate a total rather than a rate.
  simulation: { mode: "ephemeral", visitsPerPerson: 3 },
  population: {
    id: "everyone",
    maxWakes: 3,
    members: [
      { cohort: "weekenders", cohortName: "Weekenders", persona: { id: "casual", name: "Casual lister", role: "r", backstory: "b", goals: ["g"] }, count: 2 },
      { cohort: "sceptics", cohortName: "Sceptics", persona: { id: "casual", name: "Casual lister", role: "r", backstory: "b", goals: ["g"] }, count: 4, maxWakes: 1 },
    ],
  },
});

/** The words the rows use for themselves, none of which may reach the wire (ADR-0032, ADR-0042). */
const ROWS_OWN_WORDS = /\b(simulation|agent|wake|lane)s?\b/i;

describe("plannedVisits", () => {
  it("returns one row per lane, distinguishable when two cohorts share a persona", () => {
    const plan = plannedVisits(config, 4);
    expect(plan.perCohort.map((p) => p.personaId)).toEqual(["casual", "casual"]);
    expect(plan.perCohort.map((p) => p.cohort)).toEqual(["weekenders", "sceptics"]);
    expect(plan.perCohort.map((p) => p.lane)).toEqual(["weekenders.casual", "sceptics.casual"]);
    expect(new Set(plan.perCohort.map((p) => p.lane)).size).toBe(plan.perCohort.length);
    // The cohort's own cap wins over the population's for that cohort alone.
    expect(plan.perCohort.map((p) => p.visits)).toEqual([6, 4]);
    expect(plan.agents).toBe(6);
    expect(plan.visits).toBe(10);
    expect(plan.bounded).toBe(true);
  });

  it("reports a longitudinal study as unbounded even where every cohort caps itself", () => {
    const soak = PopulaceConfigSchema.parse({
      target: { name: "Tasklet", mcp: [{ url: "http://127.0.0.1:1/" }] },
      identity: { strategy: "self-signup", signupTool: "sign_up" },
      simulation: { mode: "longitudinal" },
      population: { id: "everyone", members: [{ persona: { id: "casual", name: "Casual lister", role: "r", backstory: "b", goals: ["g"] }, count: 2, maxWakes: 5 }] },
    });
    // The arithmetic still uses the cohort's cap; what it does not do is claim the execution ends,
    // because a longitudinal execution ends when somebody stops it (SPEC §4.1).
    expect(plannedVisits(soak, 4).visits).toBe(10);
    expect(plannedVisits(soak, 4).bounded).toBe(false);
  });

  it("reports an uncapped cohort as unbounded rather than inventing a total", () => {
    const uncapped = PopulaceConfigSchema.parse({
      target: { name: "Tasklet", mcp: [{ url: "http://127.0.0.1:1/" }] },
      identity: { strategy: "self-signup", signupTool: "sign_up" },
      population: { id: "everyone", members: [{ persona: { id: "casual", name: "Casual lister", role: "r", backstory: "b", goals: ["g"] }, count: 2 }] },
    });
    const plan = plannedVisits(uncapped, 4);
    expect(plan.bounded).toBe(false);
    expect(plan.perCohort[0]?.capped).toBe(false);
    expect(plan.visits).toBe(8);
  });
});

/**
 * The arithmetic speaks the code's words and the wire speaks the user's (ADR-0032). `toEstimateView`
 * is the one translation, mapped field by field, so a route can never half-rename a field — and
 * the internal lane key is dropped rather than renamed, because the (cohort, persona) pair on each
 * row is the key and "lane" is not a word the product uses.
 */
describe("toEstimateView", () => {
  it("translates every field into the wire's words and drops the internal lane key", async () => {
    const store = new SqliteStore(":memory:");
    try {
      const estimate: RunEstimate = await estimateRun(store, { config });
      expect(estimate.agents).toBe(6);
      expect(estimate.perCohort.map((row) => row.lane)).toEqual(["weekenders.casual", "sceptics.casual"]);

      const view = EstimateViewSchema.parse(toEstimateView(estimate));
      expect(view.people).toBe(estimate.agents);
      expect(view.visits).toBe(estimate.visits);
      expect(view.perVisitUsd).toBe(estimate.perWakeUsd);
      expect(view.assumedVisitsEach).toBe(estimate.assumedWakesPerAgent);
      expect(view.basis).toBe("default");
      expect(view.bounded).toBe(true);
      expect(view.perCohort.map((row) => [row.cohort, row.personaId, row.people, row.visits])).toEqual([
        ["weekenders", "casual", 2, 6],
        ["sceptics", "casual", 4, 4],
      ]);
      expect(view.stops).toEqual({
        perVisitUsd: estimate.stops.perWakeUsd,
        perVisitTurns: estimate.stops.perWakeTurns,
        dailyUsd: estimate.stops.dailyUsd,
        maxVisitsPerPerson: estimate.stops.maxWakesPerAgent,
      });
      // Not one of the rows' own words crosses, as a key or as a value.
      expect(JSON.stringify(view)).not.toMatch(ROWS_OWN_WORDS);
    } finally {
      await store.close();
    }
  });

  /**
   * A study whose deal sends nobody has no config to resolve — a population with no members is not
   * a config — and it is not a refusal either: the builder asks on every keystroke and the number
   * is the answer. Everything a number can say is nought; the ceilings and the cap are still real.
   */
  it("prices a study that sends nobody at nought, with the real ceilings beside it", async () => {
    const store = new SqliteStore(":memory:");
    try {
      const capped = await zeroEstimate(store, { model: config.model, guardrails: config.guardrails, visitsPerPerson: 3 });
      const view = EstimateViewSchema.parse(toEstimateView(capped));
      expect(view.people).toBe(0);
      expect(view.visits).toBe(0);
      expect(view.expectedUsd).toBe(0);
      expect(view.lowUsd).toBe(0);
      expect(view.highUsd).toBe(0);
      expect(view.perCohort).toEqual([]);
      expect(view.bounded).toBe(true);
      expect(view.assumedVisitsEach).toBeNull();
      expect(view.stops.maxVisitsPerPerson).toBe(3);
      expect(view.stops.dailyUsd).toBe(config.guardrails.dailyUsd);
      expect(view.model).toBe(config.model.model);
      // The per-visit figure is still the one the first person will cost, from history or the default.
      expect(view.perVisitUsd).toBeGreaterThan(0);
      expect(JSON.stringify(view)).not.toMatch(ROWS_OWN_WORDS);

      // Longitudinal at nought is unbounded, like every longitudinal study.
      const soak = toEstimateView(await zeroEstimate(store, { model: config.model, guardrails: config.guardrails, visitsPerPerson: null }));
      expect(soak.bounded).toBe(false);
      expect(soak.stops.maxVisitsPerPerson).toBeNull();
    } finally {
      await store.close();
    }
  });
});

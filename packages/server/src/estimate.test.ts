import { PopulaceConfigSchema } from "@populace/core";
import { describe, expect, it } from "vitest";
import { plannedVisits } from "./estimate.js";

/**
 * Two cohorts on ONE persona is the configuration this restructure exists to support, and it is
 * the one that makes a per-persona row ambiguous: both rows carry `casual`. The row is per COHORT,
 * so the cohort slug is what tells them apart and what the estimate has to carry.
 */
const config = PopulaceConfigSchema.parse({
  target: { name: "Tasklet", mcp: [{ url: "http://127.0.0.1:1/" }] },
  identity: { strategy: "self-signup", signupTool: "sign_up" },
  // A visit cap is what makes a simulation ephemeral, and an ephemeral simulation is what makes
  // the estimate a total rather than a rate.
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

  it("reports a longitudinal simulation as unbounded even where every cohort caps itself", () => {
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

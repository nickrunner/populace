import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL,
  FindingSchema,
  PopulaceConfigSchema,
  PopulationMemberRefSchema,
  PopulationSchema,
  SimulationContextSchema,
  StoredPopulationSchema,
  ToolPolicySchema,
  VerifierConfigSchema,
  agentIdFor,
  apportion,
  applyMemoryOperation,
  blockedBecause,
  cohortSlugOfAgentId,
  costOf,
  dealStudy,
  effectiveToolPolicy,
  emptyMemory,
  expandPopulation,
  getPath,
  handleFor,
  individuate,
  isRunId,
  isToolAllowed,
  isToolPermitted,
  laneSlugFor,
  nameFrom,
  newRunId,
  parseDuration,
  personIdOfAgentId,
  personaSlugOfAgentId,
  priceFor,
  runIdFromTag,
  signatureOf,
  stableStringify,
  strictestDestructive,
  tagForRun,
} from "./index.js";

describe("ids and tags", () => {
  it("round-trips a run id through its tag", () => {
    const runId = newRunId();
    expect(isRunId(runId)).toBe(true);
    expect(runIdFromTag(tagForRun(runId))).toBe(runId);
    expect(runIdFromTag("nope")).toBeUndefined();
  });
});

describe("durations", () => {
  it("parses units", () => {
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("2m")).toBe(120_000);
    expect(parseDuration("1.5h")).toBe(5_400_000);
    expect(parseDuration(250)).toBe(250);
    expect(() => parseDuration("soon")).toThrow();
  });
});

describe("tool policy", () => {
  it("denylist wins and empty allowlist allows all", () => {
    expect(isToolAllowed("create_task", [], [])).toBe(true);
    expect(isToolAllowed("delete_project", [], ["delete_*"])).toBe(false);
    expect(isToolAllowed("create_task", ["list_*"], [])).toBe(false);
    expect(isToolAllowed("list_tasks", ["list_*"], ["list_tasks"])).toBe(false);
  });
});

describe("what a policy nobody wrote does", () => {
  it("lets a destructive tool through, because the environment is assumed disposable", () => {
    // The default is the whole of ADR-0013's amendment: `confirm` bought its safety by putting a
    // tool error in front of the model that no real user would ever meet. Every schema that holds
    // a policy prefaults an empty object, so this one line is what a target, a cohort and a
    // persona all get when nobody says.
    expect(ToolPolicySchema.parse({}).destructive).toBe("allow");
    expect(effectiveToolPolicy(ToolPolicySchema.parse({}), ToolPolicySchema.parse({})).destructive).toBe("allow");
  });

  it("still cannot be loosened by a persona, which is what keeps the default safe to change", () => {
    // The flip moved the floor, not the one-way merge (ADR-0033). An operator who says `deny` on
    // a target that is NOT disposable gets `deny`, whatever the people sent at it leave unset.
    const strictTarget = ToolPolicySchema.parse({ destructive: "deny" });
    expect(effectiveToolPolicy(strictTarget, ToolPolicySchema.parse({})).destructive).toBe("deny");
  });
});

describe("merging a target policy with a persona's", () => {
  const target = { allow: ["list_*", "get_*", "sign_up"], deny: ["get_secrets"], destructive: "confirm" as const };

  it("intersects the allowlists, so a persona cannot widen what the target permits", () => {
    const policy = effectiveToolPolicy(target, { allow: ["get_*", "create_*"], deny: [], destructive: "allow" });
    // In both lists: allowed.
    expect(isToolPermitted("get_me", policy)).toBe(true);
    // The persona allows it and the target does not. The persona does not get to add it back.
    expect(isToolPermitted("create_task", policy)).toBe(false);
    // The target allows it and the persona does not: narrowing in the other direction still works.
    expect(isToolPermitted("list_tasks", policy)).toBe(false);
  });

  it("unions the denylists and never lets an allow undo one", () => {
    const policy = effectiveToolPolicy(target, { allow: ["get_*", "sign_up"], deny: ["sign_up"], destructive: "confirm" });
    expect(isToolPermitted("get_secrets", policy)).toBe(false);
    expect(isToolPermitted("sign_up", policy)).toBe(false);
    expect(blockedBecause("get_secrets", policy)).toBe("on the denylist");
    expect(blockedBecause("create_task", policy)).toBe("not on the allowlist");
    expect(blockedBecause("get_me", policy)).toBeNull();
  });

  it("takes the stricter destructive setting, whichever side it came from", () => {
    expect(effectiveToolPolicy(target, { allow: [], deny: [], destructive: "allow" }).destructive).toBe("confirm");
    expect(effectiveToolPolicy(target, { allow: [], deny: [], destructive: "deny" }).destructive).toBe("deny");
    expect(effectiveToolPolicy({ ...target, destructive: "deny" }, { allow: [], deny: [], destructive: "allow" }).destructive).toBe("deny");
    expect(strictestDestructive("allow", "confirm")).toBe("confirm");
    expect(strictestDestructive("deny", "confirm")).toBe("deny");
  });

  it("treats an empty allowlist as no restriction rather than as nothing allowed", () => {
    const neither = effectiveToolPolicy({ allow: [], deny: [], destructive: "confirm" }, { allow: [], deny: [], destructive: "confirm" });
    expect(isToolPermitted("anything_at_all", neither)).toBe(true);
    const personaOnly = effectiveToolPolicy({ allow: [], deny: [], destructive: "confirm" }, { allow: ["list_*"], deny: [], destructive: "confirm" });
    expect(isToolPermitted("list_tasks", personaOnly)).toBe(true);
    expect(isToolPermitted("create_task", personaOnly)).toBe(false);
  });
});

describe("json helpers", () => {
  it("reads dotted paths and serialises stably", () => {
    expect(getPath({ user: { id: "u1" }, tokens: ["a", "b"] }, "user.id")).toBe("u1");
    expect(getPath({ tokens: ["a", "b"] }, "tokens.1")).toBe("b");
    expect(getPath({ a: 1 }, "a.b")).toBeUndefined();
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });
});

describe("population expansion", () => {
  const persona = {
    id: "casual",
    name: "Casual lister",
    role: "hobbyist",
    backstory: "b",
    goals: ["g"],
    patience: { distribution: "uniform", min: 1, max: 5 },
    traits: { device: { distribution: "choice", values: ["phone", "laptop"] } },
  };

  const population = PopulationSchema.parse({
    id: "pop",
    cadence: { every: "1m" },
    members: [{ persona, count: 3, cadence: { every: "30s" } }],
  });

  it("is a join over the cohort's people, and repeats exactly", () => {
    const a = expandPopulation(population, "run_x_aaaaaa", "sim_1");
    const b = expandPopulation(population, "run_x_aaaaaa", "sim_1");
    expect(a).toHaveLength(3);
    expect(a.map((e) => e.agent.persona)).toEqual(b.map((e) => e.agent.persona));
    expect(a.map((e) => e.agent.name)).toEqual(b.map((e) => e.agent.name));
    expect(a[0]!.agent.id).toBe("pop/casual.casual#1");
    expect(a[0]!.agent.personId).toBe("casual.casual#1");
    expect(a[0]!.agent.cohortSlug).toBe("casual");
    expect(a[0]!.agent.simulationId).toBe("sim_1");
    expect(a[0]!.cadence.every).toBe(30_000);
    // Nobody in one cohort shares a name with anybody else in it.
    expect(new Set(a.map((e) => e.agent.name)).size).toBe(3);
    for (const { agent } of a) {
      expect(agent.name).not.toBe(agent.persona.name);
      expect(agent.persona.patience).toBeGreaterThanOrEqual(1);
      expect(agent.persona.patience).toBeLessThanOrEqual(5);
      expect(["phone", "laptop"]).toContain(agent.persona.traits.device);
    }
  });

  it("uses the frozen roster where there is one and never re-draws it", () => {
    const withRoster = PopulationSchema.parse({
      id: "pop",
      members: [{ persona, count: 2, people: [{ ordinal: 0, id: "casual.casual#1", name: "Dana Whitfield", details: "On a cracked phone.", handle: "dana-whitfield-casual.casual-1" }] }],
    });
    const agents = expandPopulation(withRoster, "run_x_aaaaaa", "sim_1").map((e) => e.agent);
    expect(agents[0]!.name).toBe("Dana Whitfield");
    expect(agents[0]!.details).toBe("On a cracked phone.");
    // Ordinal 1 had no row, so the seeded tier filled it — and did not collide with ordinal 0.
    expect(agents[1]!.name).not.toBe("Dana Whitfield");
  });

  /**
   * The case that was impossible before this stage. `cadenceFor` keyed on `persona.id` and agent
   * ids were `populationId/personaId#ordinal`, so two cohorts on one persona were one group with
   * one cadence and one set of ids.
   */
  it("expands two cohorts on one persona into distinct agents with their own traits and cadence", () => {
    const shared = PopulationSchema.parse({
      id: "everyone",
      cadence: { every: "1m" },
      members: [
        { cohort: "weekenders", cohortName: "Weekend planners", persona, count: 1, seed: "weekend", cadence: { every: "30s" } },
        { cohort: "sceptics", cohortName: "Sceptics", persona, count: 1, seed: "sceptical", cadence: { every: "2h" } },
      ],
    });
    const expanded = expandPopulation(shared, "run_x_aaaaaa", "sim_1");
    expect(expanded.map((e) => e.agent.id)).toEqual(["everyone/weekenders.casual#1", "everyone/sceptics.casual#1"]);
    expect(expanded.map((e) => e.agent.personId)).toEqual(["weekenders.casual#1", "sceptics.casual#1"]);
    expect(expanded.map((e) => e.cadence.every)).toEqual([30_000, 7_200_000]);
    // Different cohorts draw from different seeds, so the same persona spec yields different people.
    const [weekender, sceptic] = expanded;
    expect(weekender!.agent.name).not.toBe(sceptic!.agent.name);
    expect([weekender!.agent.persona.traits.device, weekender!.agent.persona.patience]).not.toEqual([sceptic!.agent.persona.traits.device, sceptic!.agent.persona.patience]);
  });

  /**
   * A cohort that MIXES personas (ADR-0039) resolves into one member per lane. The lanes share
   * the cohort's context and overlay and differ in persona and count, and each is numbered on
   * its own, so growing the cohort re-deals nobody.
   */
  it("expands a mixed cohort as one lane per persona, sharing the cohort's context and overlay", () => {
    const power = { ...persona, id: "power", name: "Power user" };
    const mixed = PopulationSchema.parse({
      id: "everyone",
      members: [
        { cohort: "mobile", cohortName: "Mobile signups", persona, count: 2, context: "You only ever use this on your phone.", traits: { device: "phone" } },
        { cohort: "mobile", cohortName: "Mobile signups", persona: power, count: 1, context: "You only ever use this on your phone.", traits: { device: "phone" }, model: { effort: "low" } },
      ],
    });
    const agents = expandPopulation(mixed, "run_x_aaaaaa", "sim_1").map((e) => e.agent);
    expect(agents.map((a) => a.id)).toEqual(["everyone/mobile.casual#1", "everyone/mobile.casual#2", "everyone/mobile.power#1"]);
    expect(agents.map((a) => a.cohortSlug)).toEqual(["mobile", "mobile", "mobile"]);
    expect(agents.map((a) => personaSlugOfAgentId(a.id))).toEqual(["casual", "casual", "power"]);
    for (const agent of agents) {
      expect(agent.context).toBe("You only ever use this on your phone.");
      // The cohort's fixed trait wins over whatever the persona's distribution would have drawn.
      expect(agent.persona.traits.device).toBe("phone");
    }
    expect(agents[2]!.persona.model.effort).toBe("low");
    expect(agents[0]!.persona.model.effort).toBeUndefined();
  });

  it("applies what was set on a person by hand, last", () => {
    const withHand = PopulationSchema.parse({
      id: "pop",
      members: [
        {
          persona,
          count: 1,
          traits: { device: "phone" },
          people: [{ ordinal: 0, id: "casual.casual#1", name: "Dana Whitfield", handle: "dana-whitfield-casual.casual-1", overrides: { patience: 1, budgetUsd: 12, traits: { device: "tablet" } } }],
        },
      ],
    });
    const [agent] = expandPopulation(withHand, "run_x_aaaaaa", "sim_1").map((e) => e.agent);
    expect(agent!.persona.patience).toBe(1);
    expect(agent!.persona.budgetUsd).toBe(12);
    expect(agent!.persona.traits.device).toBe("tablet");
    // Without the hand-set value, the cohort's overlay is what the person carries.
    const plain = individuate(PopulationSchema.parse({ id: "p", members: [{ persona }] }).members[0]!.persona, "s", { traits: { device: "phone" }, model: {} }, { traits: {} });
    expect(plain.traits.device).toBe("phone");
  });

  it("reads the cohort, the persona and the person back out of an id", () => {
    const id = agentIdFor("everyone", laneSlugFor("mobile-signups", "first-timer"), 2);
    expect(id).toBe("everyone/mobile-signups.first-timer#3");
    expect(cohortSlugOfAgentId(id)).toBe("mobile-signups");
    expect(personaSlugOfAgentId(id)).toBe("first-timer");
    expect(personIdOfAgentId(id)).toBe("mobile-signups.first-timer#3");
    // A pre-lane id still names its cohort.
    expect(cohortSlugOfAgentId("everyone/casual#1")).toBe("casual");
    expect(personaSlugOfAgentId("everyone/casual#1")).toBe("");
  });
});

describe("apportionment", () => {
  it("splits a size across a mix by ratio", () => {
    expect(apportion(10, [3, 2])).toEqual([6, 4]);
    expect(apportion(7, [3, 2])).toEqual([4, 3]);
    expect(apportion(4, [1, 1, 1])).toEqual([2, 1, 1]);
    expect(apportion(1, [1, 1])).toEqual([1, 0]);
    expect(apportion(0, [1, 1])).toEqual([0, 0]);
    expect(apportion(5, [])).toEqual([]);
  });

  /**
   * The property that keeps ADR-0031 true under scaling: raising a population's size adds people
   * and never takes one away from a lane. Largest-remainder rounding fails this (the Alabama
   * paradox); highest averages does not, and this checks it rather than trusting the citation.
   */
  it("never shrinks a lane when the cohort grows", () => {
    const weights = [3, 2, 1, 1];
    let previous = apportion(0, weights);
    for (let size = 1; size <= 200; size++) {
      const next = apportion(size, weights);
      expect(next.reduce((a, b) => a + b, 0)).toBe(size);
      next.forEach((n, i) => expect(n).toBeGreaterThanOrEqual(previous[i] ?? 0));
      previous = next;
    }
  });

  /**
   * A broken weight used to hand the whole size to index 0: `NaN / 1` is `NaN`, `NaN > -1` is
   * false, `best` stayed at nought and every seat went there. Nobody is dealt on the strength of a
   * number that is not one.
   */
  it("deals nobody when no weight is a positive finite number, and ignores the ones that are not", () => {
    expect(apportion(10, [0, 0])).toEqual([0, 0]);
    expect(apportion(10, [-1, Number.NaN])).toEqual([0, 0]);
    expect(apportion(10, [Number.POSITIVE_INFINITY])).toEqual([0]);
    // A single bad entry among good ones simply gets nothing; the rest is dealt as before.
    expect(apportion(10, [Number.NaN, 3, 2])).toEqual([0, 6, 4]);
    expect(apportion(10, [0, 1, 1])).toEqual([0, 5, 5]);
    // A size that is not a whole number of people is floored; below nought is nought.
    expect(apportion(2.9, [1])).toEqual([2]);
    expect(apportion(-3, [1, 1])).toEqual([0, 0]);
    expect(apportion(Number.NaN, [1, 1])).toEqual([0, 0]);
  });
});

/**
 * The two-level deal (ADR-0041): a study's size across the population's cohorts by their weights,
 * then each cohort's count across its mix. Three cohorts and six lanes, with weights chosen so that
 * ties and light entries both happen at small sizes.
 */
describe("dealing a study", () => {
  const members = [
    { cohortId: "mobile", weight: 3 },
    { cohortId: "desktop", weight: 2 },
    { cohortId: "pilot", weight: 1 },
  ];
  const mixes = [
    { cohortId: "mobile", entries: [{ personaId: "casual", weight: 2 }, { personaId: "power", weight: 1 }] },
    { cohortId: "desktop", entries: [{ personaId: "casual", weight: 1 }, { personaId: "sceptic", weight: 1 }] },
    { cohortId: "pilot", entries: [{ personaId: "power", weight: 1 }, { personaId: "admin", weight: 1 }] },
  ];
  const laneCounts = (size: number): number[] => dealStudy(size, members, mixes).cohorts.flatMap((c) => c.lanes.map((l) => l.count));

  it("gives each cohort exactly what apportion gives it, and every lane the cohort's deal of that", () => {
    for (let size = 0; size <= 300; size++) {
      const dealt = dealStudy(size, members, mixes);
      const cohortCounts = apportion(
        size,
        members.map((m) => m.weight),
      );
      expect(dealt.cohorts.map((c) => c.count)).toEqual(cohortCounts);
      dealt.cohorts.forEach((cohort, i) => {
        const mix = mixes[i]!;
        expect(cohort.cohortId).toBe(members[i]!.cohortId);
        expect(cohort.lanes.map((l) => l.personaId)).toEqual(mix.entries.map((e) => e.personaId));
        expect(cohort.lanes.map((l) => l.count)).toEqual(
          apportion(
            cohort.count,
            mix.entries.map((e) => e.weight),
          ),
        );
        for (const lane of cohort.lanes) expect(lane.cohortId).toBe(cohort.cohortId);
      });
      // Every cohort here has a mix, so what is sent is what was dealt.
      expect(dealt.sends).toBe(size);
      expect(laneCounts(size).length).toBe(6);
    }
  });

  /**
   * The property that keeps ADR-0031 true when a study is scaled: both levels are house-monotone
   * and so is their composition, so raising the size by one adds a person somewhere and archives
   * nobody. Checked rather than trusted, because the two levels interact — a cohort's count moving
   * up by one changes which of ITS lanes wins the next seat, and that must never take one back.
   */
  it("never shrinks a lane when the study grows", () => {
    let previous = laneCounts(0);
    for (let size = 1; size <= 300; size++) {
      const next = laneCounts(size);
      next.forEach((n, i) => expect(n).toBeGreaterThanOrEqual(previous[i] ?? 0));
      previous = next;
    }
  });

  it("deals nobody when every weight is nought, and nothing when there are no members", () => {
    const zeros = dealStudy(
      25,
      members.map((m) => ({ ...m, weight: 0 })),
      mixes,
    );
    expect(zeros.cohorts.map((c) => c.count)).toEqual([0, 0, 0]);
    expect(zeros.sends).toBe(0);
    for (const cohort of zeros.cohorts) for (const lane of cohort.lanes) expect(lane.count).toBe(0);
    expect(dealStudy(25, [], mixes)).toEqual({ cohorts: [], sends: 0 });
  });

  it("gives a member whose mix is missing or empty its count and no lanes, and leaves it out of what is sent", () => {
    const partial = dealStudy(12, members, [mixes[0]!, { cohortId: "pilot", entries: [] }]);
    expect(partial.cohorts.map((c) => c.count)).toEqual([6, 4, 2]);
    // "mobile" has a mix; "desktop" has none at all; "pilot" has an empty one.
    expect(partial.cohorts[0]!.lanes.map((l) => l.count)).toEqual([4, 2]);
    expect(partial.cohorts[1]!.lanes).toEqual([]);
    expect(partial.cohorts[2]!.lanes).toEqual([]);
    expect(partial.sends).toBe(6);
  });

  /** A stated rule the builders preview: the earlier member wins a tie, then the earlier entry. */
  it("breaks ties in favour of the earlier member, then the earlier mix entry", () => {
    const even = [
      { cohortId: "a", weight: 1 },
      { cohortId: "b", weight: 1 },
    ];
    const evenMixes = [
      { cohortId: "a", entries: [{ personaId: "x", weight: 1 }, { personaId: "y", weight: 1 }] },
      { cohortId: "b", entries: [{ personaId: "x", weight: 1 }, { personaId: "y", weight: 1 }] },
    ];
    const one = dealStudy(1, even, evenMixes);
    expect(one.cohorts.map((c) => c.count)).toEqual([1, 0]);
    expect(one.cohorts[0]!.lanes.map((l) => l.count)).toEqual([1, 0]);
    const three = dealStudy(3, even, evenMixes);
    expect(three.cohorts.map((c) => c.count)).toEqual([2, 1]);
    expect(three.cohorts[0]!.lanes.map((l) => l.count)).toEqual([1, 1]);
    expect(three.cohorts[1]!.lanes.map((l) => l.count)).toEqual([1, 0]);
    // Swapping the order swaps the winner: order is the rule, not the id.
    expect(dealStudy(1, [even[1]!, even[0]!], evenMixes).cohorts.map((c) => `${c.cohortId}${c.count}`)).toEqual(["b1", "a0"]);
  });
});

describe("authored population members", () => {
  /**
   * A blob written before ADR-0041 says `size` where the schema now says `weight`. Sainte-Laguë
   * returns a target vector exactly when the weights are proportional to it and sum to the size, so
   * reading the sizes as weights deals an upgraded study the same people it had.
   */
  it("reads a legacy member's size as its weight, and leaves a weight alone", () => {
    expect(PopulationMemberRefSchema.parse({ cohortId: "c", size: 3 })).toEqual({ cohortId: "c", weight: 3 });
    expect(PopulationMemberRefSchema.parse({ cohortId: "c" })).toEqual({ cohortId: "c", weight: 1 });
    expect(PopulationMemberRefSchema.parse({ cohortId: "c", weight: 2, size: 9 })).toEqual({ cohortId: "c", weight: 2 });
    const now = new Date().toISOString();
    const population = StoredPopulationSchema.parse({ id: "p", projectId: "x", slug: "p", members: [{ cohortId: "a", size: 7 }, { cohortId: "b", size: 3 }], createdAt: now, updatedAt: now });
    expect(population.members).toEqual([
      { cohortId: "a", weight: 7 },
      { cohortId: "b", weight: 3 },
    ]);
    expect(dealStudy(10, population.members, []).cohorts.map((c) => c.count)).toEqual([7, 3]);
    // The duplicate-cohort rule still runs on the preprocessed shape.
    expect(StoredPopulationSchema.safeParse({ id: "p", projectId: "x", slug: "p", members: [{ cohortId: "a", size: 1 }, { cohortId: "a" }], createdAt: now, updatedAt: now }).success).toBe(false);
  });
});

describe("names", () => {
  it("is stable for a seed and never repeats inside one cohort", () => {
    expect(nameFrom("populace:weekenders:0")).toBe(nameFrom("populace:weekenders:0"));
    expect(nameFrom("populace:weekenders:0")).not.toBe(nameFrom("populace:weekenders:1"));

    const used = new Set<string>();
    for (let ordinal = 0; ordinal < 25; ordinal++) used.add(nameFrom(`populace:weekenders:${ordinal}`, used));
    expect(used.size).toBe(25);
    for (const name of used) expect(name).toMatch(/^\S+ \S+/);
  });

  it("builds a lane-scoped email local part", () => {
    expect(handleFor("Dana Whitfield", "weekenders.casual", 2)).toBe("dana-whitfield-weekenders.casual-3");
    expect(handleFor("Tomás Ruiz", "sceptics", 0)).toBe("tomas-ruiz-sceptics-1");
  });
});

describe("signatures", () => {
  it("is stable for the same problem and moves when the tool does", () => {
    const a = signatureOf("bug", "search_tasks", "search_tasks is case-sensitive despite promising otherwise");
    const b = signatureOf("bug", "search_tasks", "Despite promising otherwise, search_tasks is case-sensitive!");
    const other = signatureOf("bug", "update_task", "search_tasks is case-sensitive despite promising otherwise");
    const kind = signatureOf("friction", "search_tasks", "search_tasks is case-sensitive despite promising otherwise");
    expect(a).toMatch(/^sig1:[0-9a-f]{12}$/);
    // Token order and punctuation are noise; the tool and the kind are not.
    expect(b).toBe(a);
    expect(other).not.toBe(a);
    expect(kind).not.toBe(a);
  });

  /**
   * A missing signature is a parse error, not a default. A default would be ONE constant string
   * shared by every finding that reached the schema without one, and triage is keyed by
   * `(projectId, signature)` — so marking one of them fixed would mark all of them fixed.
   */
  it("is required on a finding, so no two problems can share a placeholder", () => {
    const finding = {
      id: "fnd_1",
      runId: "run_a_aaaaaa",
      tag: "populace:run_a_aaaaaa",
      wakeId: "wak_1",
      agentId: "pop/casual#1",
      personaId: "casual",
      kind: "bug",
      title: "search_tasks is case sensitive",
      description: "d",
      expected: "e",
      observed: "o",
      severity: "medium",
      confidence: 0.9,
      tool: "search_tasks",
      reproduction: [],
      endpoint: "default",
      createdAt: new Date().toISOString(),
    };
    expect(FindingSchema.safeParse(finding).success).toBe(false);
    expect(FindingSchema.safeParse({ ...finding, signature: signatureOf("bug", "search_tasks", finding.title) }).success).toBe(true);
  });
});

describe("memory", () => {
  it("applies operations and caps notes", () => {
    let memory = emptyMemory("run_a_aaaaaa", "pop/p#1");
    memory = applyMemoryOperation(memory, { kind: "waiting_on", text: "email verification" }, 1, 2);
    memory = applyMemoryOperation(memory, { kind: "note", text: "n1" }, 1, 2);
    memory = applyMemoryOperation(memory, { kind: "note", text: "n2" }, 1, 2);
    memory = applyMemoryOperation(memory, { kind: "note", text: "n3" }, 2, 2);
    memory = applyMemoryOperation(memory, { kind: "resolved", text: "Email" }, 2, 2);
    expect(memory.notes.map((n) => n.text)).toEqual(["n2", "n3"]);
    expect(memory.waitingOn).toEqual([]);
  });
});

describe("pricing", () => {
  it("computes cost from usage", () => {
    const price = priceFor("claude-opus-5");
    const usd = costOf({ inputTokens: 1_000_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, price);
    expect(usd).toBe(5);
    expect(priceFor("mystery-model")).toEqual(price);
  });

  it("prices every model it defaults to, and bills an unknown one conservatively", () => {
    // A current model with no row is not free: it is billed at the Opus rate the unknown-model
    // fallback picks, so it reads several times high and spends somebody's ceiling early. The
    // default model is the one that bites, so assert it is priced as itself rather than as Opus.
    expect(priceFor(DEFAULT_MODEL)).toEqual({ input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 });
    expect(priceFor(DEFAULT_MODEL)).not.toEqual(priceFor("mystery-model"));

    // The judge is pinned rather than inherited, so it needs its own row for the same reason.
    expect(VerifierConfigSchema.parse({}).model.model).toBe("claude-opus-5-5");
    expect(priceFor("claude-opus-5-5")).not.toEqual(priceFor("mystery-model"));
  });
});

describe("config", () => {
  it("applies defaults", () => {
    const config = PopulaceConfigSchema.parse({
      target: { name: "t", mcp: [{ url: "http://localhost:1/mcp" }] },
      identity: { strategy: "self-signup", signupTool: "sign_up" },
      population: { id: "p", members: [{ persona: { id: "x", name: "X", role: "r", backstory: "b", goals: ["g"] } }] },
    });
    expect(config.version).toBe(2);
    expect(config.simulation.mode).toBe("longitudinal");
    // A config built by hand from lane counts has no study size and nothing extra to tell people.
    expect(config.simulation.size).toBe(0);
    expect(config.simulation.brief).toBe("");
    expect(SimulationContextSchema.parse({ size: 12, brief: "Try the mobile flow." })).toMatchObject({ size: 12, brief: "Try the mobile flow." });
    expect(config.population.members[0]!.cohort).toBe("x");
    // A Sonnet at `low`, not an Opus at `high`: every person a study sends pays for this on every
    // visit, so the considered-and-expensive agent is the one a cohort opts into.
    expect(config.model.model).toBe("claude-sonnet-5-5");
    expect(config.model.effort).toBe("low");
    expect(config.model.fallbacks).toBe(true);
    // Likewise the judge: free unless a digest somebody is waiting on asks for better.
    expect(config.verifier.judge).toBe("heuristic");
    expect(config.guardrails.perWake.maxUsd).toBe(3);
    expect(config.store.kind).toBe("sqlite");
    expect(config.population.cadence.every).toBe(600_000);
  });
});

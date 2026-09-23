import { describe, expect, it } from "vitest";
import {
  FindingSchema,
  PopulaceConfigSchema,
  PopulationSchema,
  agentIdFor,
  apportion,
  applyMemoryOperation,
  blockedBecause,
  cohortSlugOfAgentId,
  costOf,
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
    expect(config.population.members[0]!.cohort).toBe("x");
    expect(config.model.model).toBe("claude-opus-5");
    expect(config.model.effort).toBe("high");
    expect(config.model.fallbacks).toBe(true);
    expect(config.guardrails.perWake.maxUsd).toBe(3);
    expect(config.store.kind).toBe("sqlite");
    expect(config.population.cadence.every).toBe(600_000);
  });
});

import { describe, expect, it } from "vitest";
import {
  FindingSchema,
  PopulaceConfigSchema,
  PopulationSchema,
  applyMemoryOperation,
  costOf,
  emptyMemory,
  expandPopulation,
  getPath,
  handleFor,
  isRunId,
  isToolAllowed,
  nameFrom,
  newRunId,
  parseDuration,
  priceFor,
  runIdFromTag,
  signatureOf,
  stableStringify,
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
    expect(a[0]!.agent.id).toBe("pop/casual#1");
    expect(a[0]!.agent.personId).toBe("casual#1");
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
      members: [{ persona, count: 2, people: [{ ordinal: 0, id: "casual#1", name: "Dana Whitfield", details: "On a cracked phone.", handle: "dana-whitfield-casual-1" }] }],
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
    expect(expanded.map((e) => e.agent.id)).toEqual(["everyone/weekenders#1", "everyone/sceptics#1"]);
    expect(expanded.map((e) => e.agent.personId)).toEqual(["weekenders#1", "sceptics#1"]);
    expect(expanded.map((e) => e.cadence.every)).toEqual([30_000, 7_200_000]);
    // Different cohorts draw from different seeds, so the same persona spec yields different people.
    const [weekender, sceptic] = expanded;
    expect(weekender!.agent.name).not.toBe(sceptic!.agent.name);
    expect([weekender!.agent.persona.traits.device, weekender!.agent.persona.patience]).not.toEqual([sceptic!.agent.persona.traits.device, sceptic!.agent.persona.patience]);
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

  it("builds a cohort-scoped email local part", () => {
    expect(handleFor("Dana Whitfield", "weekenders", 2)).toBe("dana-whitfield-weekenders-3");
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

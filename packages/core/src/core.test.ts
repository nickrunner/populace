import { describe, expect, it } from "vitest";
import {
  PopulaceConfigSchema,
  PopulationSchema,
  applyMemoryOperation,
  costOf,
  emptyMemory,
  expandPopulation,
  getPath,
  isRunId,
  isToolAllowed,
  newRunId,
  parseDuration,
  priceFor,
  runIdFromTag,
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
  const population = PopulationSchema.parse({
    id: "pop",
    scale: 1.5,
    cadence: { every: "1m" },
    members: [
      {
        persona: {
          id: "casual",
          name: "Casual",
          role: "hobbyist",
          backstory: "b",
          goals: ["g"],
          patience: { distribution: "uniform", min: 1, max: 5 },
          traits: { device: { distribution: "choice", values: ["phone", "laptop"] } },
        },
        count: 2,
        cadence: { every: "30s" },
      },
    ],
  });

  it("is deterministic and applies the scale factor", () => {
    const a = expandPopulation(population, "run_x_aaaaaa");
    const b = expandPopulation(population, "run_x_aaaaaa");
    expect(a).toHaveLength(3);
    expect(a.map((e) => e.agent.persona)).toEqual(b.map((e) => e.agent.persona));
    expect(a[0]!.agent.id).toBe("pop/casual#1");
    expect(a[0]!.cadence.every).toBe(30_000);
    for (const { agent } of a) {
      expect(agent.persona.patience).toBeGreaterThanOrEqual(1);
      expect(agent.persona.patience).toBeLessThanOrEqual(5);
      expect(["phone", "laptop"]).toContain(agent.persona.traits.device);
    }
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
    expect(config.model.model).toBe("claude-opus-5");
    expect(config.model.effort).toBe("high");
    expect(config.model.fallbacks).toBe(true);
    expect(config.guardrails.perWake.maxUsd).toBe(3);
    expect(config.store.kind).toBe("sqlite");
    expect(config.population.cadence.every).toBe(600_000);
  });
});

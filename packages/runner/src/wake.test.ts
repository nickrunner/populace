import { SelfSignupProvider } from "@populace/adapters/self-signup";
import { PopulaceConfigSchema, expandPopulation, newRunId, type Agent, type PopulaceConfig, type TraceEvent } from "@populace/core";
import { startMockTarget, type RunningMockTarget } from "@populace/mock-target";
import { SqliteStore } from "@populace/store-sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScriptedProvider, byWake, call, field, sequence, type ScriptPolicy } from "./testing/index.js";
import { runWake } from "./wake.js";

let target: RunningMockTarget;

type Ev<T extends TraceEvent["type"]> = Extract<TraceEvent, { type: T }>;
const ofType = <T extends TraceEvent["type"]>(trace: TraceEvent[], type: T): Ev<T>[] => trace.filter((e): e is Ev<T> => e.type === type);

beforeAll(async () => {
  target = await startMockTarget({ quiet: true });
});
afterAll(async () => {
  await target.close();
});

function makeConfig(overrides: Partial<PopulaceConfig["guardrails"]["perWake"]> = {}, persona: Partial<PopulaceConfig["population"]["members"][number]["persona"]> = {}): PopulaceConfig {
  return PopulaceConfigSchema.parse({
    target: { name: "Tasklet", mcp: [{ url: target.mcpUrl }], webBaseUrl: target.url, description: "A calm task list." },
    identity: { strategy: "self-signup", signupTool: "sign_up", tokenPath: "token", userIdPath: "user.id", teardownTool: "delete_account" },
    guardrails: { perWake: { maxTokens: 400_000, maxUsd: 3, maxTurns: 40, ...overrides }, dailyUsd: 50 },
    population: {
      id: "test",
      cadence: { every: "1s" },
      members: [{ persona: { id: "casual", name: "Casey", role: "a hobbyist", backstory: "Has too many lists.", goals: ["keep a grocery list"], ...persona } }],
    },
  });
}

function firstAgent(config: PopulaceConfig, runId = newRunId()): Agent {
  const [expanded] = expandPopulation(config.population, runId);
  if (!expanded) throw new Error("no agent");
  return expanded.agent;
}

/** Casey's first visit: discover, sign up, hit the case-sensitive search bug, report it, remember, leave. */
const firstVisit: ScriptPolicy = sequence([
  () => ({ text: "Let me see what this is.", calls: [call("get_product_info"), call("fetch_page", { path: "/" })] }),
  (ctx) => {
    const signup = /email (\S+), display name "([^"]+)", password (\S+)/.exec(ctx.wakeContext);
    if (!signup) throw new Error("no signup suggestion in wake context");
    return { calls: [{ name: "sign_up", input: { email: signup[1]!, displayName: signup[2]!, password: signup[3]! } }] };
  },
  () => ({ calls: [{ name: "create_project", input: { name: "Home" } }] }),
  (ctx) => ({ calls: [{ name: "create_task", input: { projectId: field(ctx.lastResults[0], "id"), title: "Buy Groceries", dueDate: "2026-10-01" } }] }),
  () => ({ calls: [{ name: "search_tasks", input: { query: "groceries" } }] }),
  () => ({ calls: [{ name: "search_tasks", input: { query: "Groceries" } }] }),
  (ctx) => {
    const lower = ctx.allResults.find((r) => r.name === "search_tasks" && r.text.includes('"query": "groceries"'));
    const upper = ctx.allResults.find((r) => r.name === "search_tasks" && r.text.includes('"query": "Groceries"'));
    return {
      calls: [
        call("file_finding", {
            kind: "bug",
            title: "search_tasks is case-sensitive despite promising case-insensitive search",
            description: "I searched for my groceries task in lower case and got nothing.",
            expected: "Searching 'groceries' finds the task 'Buy Groceries'.",
            observed: "Searching 'groceries' returned 0 tasks; searching 'Groceries' returned 1.",
            severity: "medium",
            confidence: 0.95,
            tool: "search_tasks",
            evidence_calls: [lower?.ref ?? "", upper?.ref ?? ""],
        }),
        call("remember", { kind: "done", text: "Signed up and created project Home with a groceries task." }),
        call("remember", { kind: "annoyance", text: "Search ignores my lower-case query." }),
      ],
    };
  },
]);

describe("runWake against the mock target", () => {
  it("runs a first wake with self-signup, producing a trace, memory, identity and a finding with reproduction steps", async () => {
    const store = new SqliteStore(":memory:");
    const config = makeConfig();
    const agent = firstAgent(config);
    const result = await runWake({ agent, config }, { store, provider: new ScriptedProvider(firstVisit), identityProvider: new SelfSignupProvider(config.identity as never) });

    expect(result.wake.status).toBe("done");
    expect(result.wake.turns).toBe(8);
    expect(result.wake.costUsd).toBeGreaterThan(0);
    expect(result.skipped).toBe(false);

    // identity captured from the signup tool result and persisted
    expect(result.identity?.credential.bearerToken).toMatch(/^tk_/);
    expect(result.identity?.credential.email).toContain(`+populace:${agent.runId}@`);
    expect(result.agent.identityId).toBe(result.identity?.id);
    expect((await store.getIdentity(result.identity!.id))?.tag).toBe(`populace:${agent.runId}`);

    // trace: every model call and tool call is there, in order
    const trace = await store.getTrace(result.wake.id);
    const types = trace.map((e) => e.type);
    expect(types[0]).toBe("wake.start");
    expect(types[types.length - 1]).toBe("wake.end");
    expect(ofType(trace, "model.call")).toHaveLength(8);
    const toolCalls = ofType(trace, "tool.call");
    expect(toolCalls.map((e) => e.tool)).toEqual(["get_product_info", "fetch_page", "sign_up", "create_project", "create_task", "search_tasks", "search_tasks"]);
    expect(ofType(trace, "identity").map((e) => e.event)).toEqual(["missing", "captured", "reconnected"]);
    expect(ofType(trace, "model.call").some((e) => e.costUsd > 0)).toBe(true);
    const fetched = toolCalls.find((e) => e.tool === "fetch_page");
    expect(fetched?.result.text).toContain("Delete tasks you no longer need");

    // finding with exact reproduction steps resolved from call refs
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(finding.kind).toBe("bug");
    expect(finding.tool).toBe("search_tasks");
    expect(finding.reproduction.map((s) => s.tool)).toEqual(["search_tasks", "search_tasks"]);
    expect(finding.reproduction[0]!.arguments).toEqual({ query: "groceries" });
    expect(finding.reproduction[0]!.result.structured).toMatchObject({ tasks: [] });
    expect(finding.identityId).toBe(result.identity?.id);
    expect((await store.getFinding(finding.id))?.title).toBe(finding.title);

    // memory persisted
    const memory = await store.getMemory(agent.id);
    expect(memory?.done.map((d) => d.text)).toEqual(["Signed up and created project Home with a groceries task."]);
    expect(memory?.annoyances).toHaveLength(1);
    expect(result.wake.findingCount).toBe(1);
    await store.close();
  });

  it("carries identity and memory into a second wake", async () => {
    const store = new SqliteStore(":memory:");
    const config = makeConfig();
    const agent = firstAgent(config);
    const identityProvider = new SelfSignupProvider(config.identity as never);
    const seenContexts: string[] = [];
    const policy = byWake(
      {
        1: firstVisit,
        2: sequence([
          (ctx) => {
            seenContexts.push(ctx.wakeContext);
            return { calls: [{ name: "list_projects", input: {} }] };
          },
          (ctx) => ({ calls: [{ name: "remember", input: { kind: "note", text: `Still have ${(ctx.lastResults[0]?.data as { projects: object[] } | null)?.projects.length ?? "?"} project(s).` } }] }),
        ]),
      },
      firstVisit,
    );
    const provider = new ScriptedProvider(policy);
    const first = await runWake({ agent, config }, { store, provider, identityProvider });
    const second = await runWake({ agent: first.agent, config }, { store, provider, identityProvider });

    expect(second.wake.wakeNumber).toBe(2);
    expect(second.wake.status).toBe("done");
    expect(seenContexts[0]).toContain("You already have an account");
    expect(seenContexts[0]).toContain("Signed up and created project Home");
    expect(seenContexts[0]).toContain("Search ignores my lower-case query");
    const listed = ofType(await store.getTrace(second.wake.id), "tool.call").find((e) => e.tool === "list_projects");
    expect(listed?.result.isError).toBe(false);
    expect(listed?.result.text).toContain('"name": "Home"');
    expect((await store.getMemory(agent.id))?.notes.map((n) => n.text)).toEqual(["Still have 1 project(s)."]);
    expect(second.identity?.id).toBe(first.identity?.id);
    await store.close();
  });

  it("enforces the destructive confirmation policy and the tool denylist", async () => {
    const store = new SqliteStore(":memory:");
    const config = makeConfig({}, { tools: { allow: [], deny: ["upgrade_plan"], destructive: "confirm" } });
    const agent = firstAgent(config);
    const policy = sequence([
      (ctx) => {
        const s = /email (\S+), display name "([^"]+)", password (\S+)/.exec(ctx.wakeContext)!;
        return { calls: [{ name: "sign_up", input: { email: s[1]!, displayName: s[2]!, password: s[3]! } }] };
      },
      () => ({ calls: [{ name: "create_project", input: { name: "Temp" } }] }),
      (ctx) => ({ calls: [{ name: "delete_project", input: { projectId: field(ctx.lastResults[0], "id") } }] }),
      (ctx) => ({ calls: [{ name: "delete_project", input: { projectId: field(ctx.allResults.find((r) => r.name === "create_project"), "id") } }] }),
      () => ({ calls: [{ name: "upgrade_plan", input: {} }, { name: "list_projects", input: {} }] }),
    ]);
    const result = await runWake({ agent, config }, { store, provider: new ScriptedProvider(policy), identityProvider: new SelfSignupProvider(config.identity as never) });
    const trace = await store.getTrace(result.wake.id);
    const guardrails = ofType(trace, "guardrail").map((e) => e.rule);
    expect(guardrails).toContain("destructive-confirm");
    expect(guardrails).toContain("tool-denied");
    const deletes = ofType(trace, "tool.call").filter((e) => e.tool === "delete_project");
    expect(deletes).toHaveLength(1); // first attempt was intercepted, second ran
    expect(deletes[0]!.result.structured).toMatchObject({ deletedTasks: 0 });
    expect(result.wake.status).toBe("done");
    await store.close();
  });

  it("stops at the per-wake turn ceiling after a wrap-up turn, and skips on the kill switch", async () => {
    const store = new SqliteStore(":memory:");
    const config = makeConfig({ maxTurns: 3 });
    const agent = firstAgent(config);
    const endless: ScriptPolicy = () => ({ calls: [{ name: "get_product_info", input: {} }] });
    const result = await runWake({ agent, config }, { store, provider: new ScriptedProvider(endless), identityProvider: new SelfSignupProvider(config.identity as never) });
    expect(result.wake.status).toBe("max-turns");
    expect(result.wake.turns).toBe(4); // 3 turns, then one wrap-up turn
    const trace = await store.getTrace(result.wake.id);
    const lastToolResult = ofType(trace, "model.call").at(-1)!.request.lastUserContent;
    expect(lastToolResult).toContain("budget is used up");

    await store.setKillSwitch(true, "test");
    const killed = await runWake({ agent: result.agent, config }, { store, provider: new ScriptedProvider(endless), identityProvider: new SelfSignupProvider(config.identity as never) });
    expect(killed.wake.status).toBe("killed");
    expect(killed.skipped).toBe(true);
    expect(killed.wake.turns).toBe(0);
    expect(killed.agent.wakeCount).toBe(1);
    await store.close();
  });

  it("skips a wake when the population daily ceiling is spent", async () => {
    const store = new SqliteStore(":memory:");
    const config = makeConfig();
    config.guardrails.dailyUsd = 0.0001;
    const agent = firstAgent(config);
    const provider = new ScriptedProvider(sequence([]));
    const identityProvider = new SelfSignupProvider(config.identity as never);
    const first = await runWake({ agent, config }, { store, provider, identityProvider });
    expect(first.wake.status).toBe("done");
    const second = await runWake({ agent: first.agent, config }, { store, provider, identityProvider });
    expect(second.wake.status).toBe("budget-exceeded");
    expect(second.skipped).toBe(true);
    await store.close();
  });
});

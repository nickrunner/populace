import { SelfSignupProvider } from "@populace/adapters/self-signup";
import { PopulaceConfigSchema, expandPopulation, newRunId, type Agent, type PopulaceConfig, type TraceEvent } from "@populace/core";
import { startMockTarget, type RunningMockTarget } from "@populace/mock-target";
import { SqliteStore } from "@populace/store-sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScriptedProvider, byWake, call, field, sequence, type ScriptContext, type ScriptPolicy } from "./testing/index.js";
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

/** The frozen cast a resolved config carries, as `PopulaceConfigSchema` takes it. */
interface PersonInput {
  ordinal: number;
  id: string;
  name: string;
  details: string;
  handle: string;
}

function makeConfig(
  overrides: Partial<PopulaceConfig["guardrails"]["perWake"]> = {},
  persona: Partial<PopulaceConfig["population"]["members"][number]["persona"]> = {},
  people: PersonInput[] = [],
): PopulaceConfig {
  return PopulaceConfigSchema.parse({
    target: { name: "Tasklet", mcp: [{ url: target.mcpUrl }], webBaseUrl: target.url, description: "A calm task list." },
    identity: { strategy: "self-signup", signupTool: "sign_up", tokenPath: "token", userIdPath: "user.id", teardownTool: "delete_account" },
    guardrails: { perWake: { maxTokens: 400_000, maxUsd: 3, maxTurns: 40, ...overrides }, dailyUsd: 50 },
    population: {
      id: "test",
      cadence: { every: "1s" },
      // The persona has a ROLE LABEL, not a human name: a persona is a kind of person. The human
      // name belongs to the generated person and is what the prompt and the signup email carry.
      members: [{ persona: { id: "casual", name: "Casual lister", role: "a hobbyist", backstory: "Has too many lists.", goals: ["keep a grocery list"], ...persona }, people }],
    },
  });
}

function firstAgent(config: PopulaceConfig, runId = newRunId()): Agent {
  const [expanded] = expandPopulation(config.population, runId, config.simulation.id);
  if (!expanded) throw new Error("no agent");
  return expanded.agent;
}

/** The first visit: discover, sign up, hit the case-sensitive search bug, report it, remember, leave. */
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
    const provider = new ScriptedProvider(firstVisit);
    const result = await runWake({ agent, config }, { store, provider, identityProvider: new SelfSignupProvider(config.identity as never) });

    expect(result.wake.status).toBe("done");
    expect(result.wake.turns).toBe(8);
    expect(result.wake.costUsd).toBeGreaterThan(0);
    expect(result.skipped).toBe(false);

    // identity captured from the signup tool result and persisted
    expect(result.identity?.credential.bearerToken).toMatch(/^tk_/);
    // The address carries the RUN ID; the tag it belongs to is on the identity row below. A tag
    // has a colon in it and an email local part may not (ADR-0037).
    expect(result.identity?.credential.email).toContain(`+${agent.runId}@`);
    expect(result.identity?.credential.email).not.toContain(":");
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

    // The model is told who it is by the PERSON's generated name, never by the persona's label —
    // asserted against the system prompt the provider was actually handed, not against a fresh
    // call to `personaSystemPrompt`, which would only prove that the formatter formats.
    const modelCalls = ofType(trace, "model.call");
    expect(agent.name).not.toBe(agent.persona.name);
    expect(modelCalls[0]!.request.lastUserContent).toContain(agent.name);
    const sent = provider.requests.filter((r) => r.wakeId === result.wake.id);
    expect(sent).toHaveLength(8);
    expect(sent[0]!.system.split("\n")[0]).toBe(`You are ${agent.name}, ${agent.persona.role}.`);
    expect(sent[0]!.system).not.toContain(agent.persona.name);

    // ADR-0006, checked rather than assumed. `ScriptedProvider` reports a cache read only when the
    // stable prefix it was handed serialises to what the previous turn's did, so a PER-REQUEST
    // varying value in the system prompt — the regression CLAUDE.md calls silent — turns the last
    // three of these red. The breakpoints are asserted structurally: one on the system block, one
    // on the LAST tool, and one rolling onto the last message every turn. Without that rolling one
    // the whole transcript is re-sent at full price each turn, which was ~70% of a wake's bill.
    expect(sent.every((r) => r.systemBreakpoints === 1)).toBe(true);
    expect(sent.every((r) => r.toolBreakpointIndex === r.toolCount - 1)).toBe(true);
    expect(sent.map((r) => r.messageBreakpoints)).toEqual(sent.map((r) => [r.messageCount - 1]));
    expect(sent.map((r) => r.cacheHit)).toEqual([false, ...sent.slice(1).map(() => true)]);
    expect(modelCalls[0]!.usage.cacheReadInputTokens).toBe(0);
    expect(modelCalls[1]!.usage.cacheReadInputTokens).toBeGreaterThan(0);
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
    const memory = await store.getMemory(agent.runId, agent.id);
    expect(memory?.done.map((d) => d.text)).toEqual(["Signed up and created project Home with a groceries task."]);
    expect(memory?.annoyances).toHaveLength(1);
    expect(result.wake.findingCount).toBe(1);
    await store.close();
  });

  it("puts the person's own name and details in the cached system prefix, and the persona's label nowhere", async () => {
    const store = new SqliteStore(":memory:");
    const details = "On a cracked phone, trying to plan one weekend before the shops shut.";
    const config = makeConfig({}, {}, [{ ordinal: 0, id: "casual#1", name: "Ines Okonkwo", details, handle: "ines-okonkwo-casual-1" }]);
    const agent = firstAgent(config);
    expect(agent.name).toBe("Ines Okonkwo");
    const provider = new ScriptedProvider(sequence([]));
    await runWake({ agent, config }, { store, provider, identityProvider: new SelfSignupProvider(config.identity as never) });

    const [first] = provider.requests;
    expect(first).toBeDefined();
    // SPEC §5.3: line 1 is the person, the individuating line sits under the backstory, and the
    // persona's display label never reaches the model at all.
    expect(first!.system.split("\n")[0]).toBe(`You are Ines Okonkwo, ${agent.persona.role}.`);
    expect(first!.system).toContain(details);
    expect(first!.system).not.toContain(agent.persona.name);
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
    expect((await store.getMemory(agent.runId, agent.id))?.notes.map((n) => n.text)).toEqual(["Still have 1 project(s)."]);
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

  it("moves a single cache breakpoint to the end of the conversation each turn", async () => {
    const store = new SqliteStore(":memory:");
    const config = makeConfig();
    // Where cache_control sat on each request, as "<message index>/<block index>".
    const marks: string[][] = [];
    const script: ScriptPolicy = (ctx) => {
      marks.push(
        ctx.messages.flatMap((message, m) =>
          typeof message.content === "string"
            ? []
            : message.content.flatMap((block, b) => ("cache_control" in block && block.cache_control ? [`${m}/${b}`] : [])),
        ),
      );
      return ctx.turn < 3 ? { calls: [call("get_product_info")] } : { calls: [call("done", { summary: "enough", would_return: true })] };
    };
    const result = await runWake({ agent: firstAgent(config), config }, { store, provider: new ScriptedProvider(script), identityProvider: new SelfSignupProvider(config.identity as never) });

    expect(result.wake.status).toBe("done");
    expect(marks.length).toBe(3);
    // Exactly one breakpoint per request, never a stale one left behind on an earlier turn.
    for (const perRequest of marks) expect(perRequest.length).toBe(1);
    // And it advances: each turn's breakpoint is on a later message than the one before.
    const messageIndex = marks.map((m) => Number(m[0]!.split("/")[0]));
    expect(messageIndex).toEqual([...messageIndex].sort((a, b) => a - b));
    expect(new Set(messageIndex).size).toBe(3);
    await store.close();
  });

  it("runs a persona on its own model, overriding the global one", async () => {
    const store = new SqliteStore(":memory:");
    const config = makeConfig({}, { model: { model: "claude-opus-5", effort: "max" } });
    config.model.model = "claude-sonnet-5";
    config.model.effort = "medium";
    const script: ScriptPolicy = () => ({ calls: [call("done", { summary: "done", would_return: false })] });
    const result = await runWake({ agent: firstAgent(config), config }, { store, provider: new ScriptedProvider(script), identityProvider: new SelfSignupProvider(config.identity as never) });

    // The persona's override wins over the global model block, and the wake records what actually ran.
    expect(result.wake.model).toBe("claude-opus-5");
    expect(result.wake.effort).toBe("max");
    const calls = ofType(await store.getTrace(result.wake.id), "model.call");
    expect(calls.every((c) => c.model === "claude-opus-5" && c.effort === "max")).toBe(true);
    await store.close();
  });

  it("retires an agent that gives up, and does not schedule it again", async () => {
    const store = new SqliteStore(":memory:");
    const config = makeConfig();
    const giveUp: ScriptPolicy = sequence([
      () => ({ calls: [call("get_product_info")] }),
      () => ({ calls: [call("give_up", { title: "Not for me", reason: "Too fiddly for a grocery list.", would_return: false, severity: "medium", evidence_calls: [] })] }),
    ]);
    const result = await runWake({ agent: firstAgent(config), config }, { store, provider: new ScriptedProvider(giveUp), identityProvider: new SelfSignupProvider(config.identity as never) });

    expect(result.wake.status).toBe("gave-up");
    // "For good" is literal: the agent retires itself rather than waking again on cadence.
    expect(result.agent.status).toBe("retired");
    expect(result.agent.retiredReason).toBe("gave-up");
    expect(result.agent.nextWakeAt).toBeNull();
    const [stored] = await store.listAgents({ runId: result.agent.runId });
    expect(stored?.status).toBe("retired");
    await store.close();
  });
});

/**
 * The target's policy is the floor. These assert the INTERCEPTOR's decision — what reached the
 * model, what the trace says was refused, what actually ran against the target — rather than the
 * merged object, because a merge that is correct and applied in the wrong place is still a hole.
 */
describe("the target's tool policy, merged with the persona's", () => {
  /** The same config, with a policy on the TARGET rather than on the persona. */
  const withTargetPolicy = (config: PopulaceConfig, tools: PopulaceConfig["target"]["tools"]): PopulaceConfig => ({ ...config, target: { ...config.target, tools } });

  const signUpFirst = (ctx: ScriptContext): { name: string; input: Record<string, string> }[] => {
    const s = /email (\S+), display name "([^"]+)", password (\S+)/.exec(ctx.wakeContext)!;
    return [{ name: "sign_up", input: { email: s[1]!, displayName: s[2]!, password: s[3]! } }];
  };

  it("refuses a tool the target denies however permissive the persona is, and keeps the target's destructive setting", async () => {
    const store = new SqliteStore(":memory:");
    // The persona is as open as a persona can be: everything allowed, nothing denied, destructive
    // work waved through. None of that may loosen what the target said.
    const config = withTargetPolicy(makeConfig({}, { tools: { allow: ["*"], deny: [], destructive: "allow" } }), { allow: [], deny: ["upgrade_plan"], destructive: "confirm" });
    const agent = firstAgent(config);
    const policy = sequence([
      (ctx) => ({ calls: signUpFirst(ctx) }),
      () => ({ calls: [{ name: "create_project", input: { name: "Temp" } }] }),
      (ctx) => ({ calls: [{ name: "delete_project", input: { projectId: field(ctx.lastResults[0], "id") } }] }),
      () => ({ calls: [{ name: "upgrade_plan", input: {} }] }),
    ]);
    const result = await runWake({ agent, config }, { store, provider: new ScriptedProvider(policy), identityProvider: new SelfSignupProvider(config.identity as never) });
    const trace = await store.getTrace(result.wake.id);
    const guardrails = ofType(trace, "guardrail").map((e) => e.rule);

    // The target says confirm; the persona says allow; the stricter one wins, so the first
    // delete_project came back as a confirmation prompt instead of deleting anything.
    expect(guardrails).toContain("destructive-confirm");
    expect(ofType(trace, "tool.call").filter((e) => e.tool === "delete_project")).toHaveLength(0);
    // The target denies upgrade_plan, so it was never offered and the call was refused.
    expect(guardrails).toContain("tool-denied");
    expect(ofType(trace, "tool.call").some((e) => e.tool === "upgrade_plan")).toBe(false);
    await store.close();
  });

  it("intersects the allowlists: a persona cannot add back a tool the target's allowlist leaves out", async () => {
    const store = new SqliteStore(":memory:");
    const config = withTargetPolicy(makeConfig({}, { tools: { allow: ["get_*", "create_*", "sign_up"], deny: [], destructive: "confirm" } }), {
      allow: ["get_*", "list_*", "sign_up"],
      deny: [],
      destructive: "confirm",
    });
    const agent = firstAgent(config);
    let offered: string[] = [];
    const policy = sequence([
      (ctx) => {
        offered = ctx.toolNames;
        return { calls: signUpFirst(ctx) };
      },
      // Allowed by the persona, not by the target.
      () => ({ calls: [{ name: "create_project", input: { name: "Temp" } }] }),
      // Allowed by the target, not by the persona.
      () => ({ calls: [{ name: "list_projects", input: {} }] }),
      // In both.
      () => ({ calls: [{ name: "get_me", input: {} }] }),
    ]);
    const result = await runWake({ agent, config }, { store, provider: new ScriptedProvider(policy), identityProvider: new SelfSignupProvider(config.identity as never) });
    const trace = await store.getTrace(result.wake.id);
    const ran = ofType(trace, "tool.call").map((e) => e.tool);

    expect(offered).toContain("get_me");
    expect(offered).not.toContain("create_project");
    expect(offered).not.toContain("list_projects");
    expect(ran).toContain("get_me");
    expect(ran).not.toContain("create_project");
    expect(ran).not.toContain("list_projects");
    expect(ofType(trace, "guardrail").filter((e) => e.rule === "tool-denied").map((e) => e.tool)).toEqual(["create_project", "list_projects"]);
    await store.close();
  });

  it("blocks a tool the target denies for every persona in the population", async () => {
    const store = new SqliteStore(":memory:");
    const base = makeConfig();
    const config: PopulaceConfig = {
      ...base,
      target: { ...base.target, tools: { allow: [], deny: ["upgrade_plan"], destructive: "confirm" } },
      population: {
        ...base.population,
        members: [
          { ...base.population.members[0]!, cohort: "open", persona: { ...base.population.members[0]!.persona, id: "open", tools: { allow: ["*"], deny: [], destructive: "allow" } } },
          { ...base.population.members[0]!, cohort: "plain", persona: { ...base.population.members[0]!.persona, id: "plain", tools: { allow: [], deny: [], destructive: "confirm" } } },
        ],
      },
    };
    const agents = expandPopulation(config.population, newRunId(), config.simulation.id).map((e) => e.agent);
    expect(agents).toHaveLength(2);

    const policy = sequence([(ctx) => ({ calls: signUpFirst(ctx) }), () => ({ calls: [{ name: "upgrade_plan", input: {} }] })]);
    for (const agent of agents) {
      const result = await runWake({ agent, config }, { store, provider: new ScriptedProvider(policy), identityProvider: new SelfSignupProvider(config.identity as never) });
      const trace = await store.getTrace(result.wake.id);
      expect(ofType(trace, "guardrail").filter((e) => e.rule === "tool-denied").map((e) => e.tool), `${agent.persona.id} reached upgrade_plan`).toEqual(["upgrade_plan"]);
      expect(ofType(trace, "tool.call").some((e) => e.tool === "upgrade_plan")).toBe(false);
    }
    await store.close();
  });
});

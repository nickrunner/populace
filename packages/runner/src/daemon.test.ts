import { SelfSignupProvider } from "@populace/adapters/self-signup";
import { PopulaceConfigSchema, newRunId, type PopulaceConfig } from "@populace/core";
import { startMockTarget, type RunningMockTarget } from "@populace/mock-target";
import { SqliteStore } from "@populace/store-sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalDaemon } from "./daemon.js";
import { ScriptedProvider, call, sequence, type ScriptPolicy } from "./testing/index.js";

let target: RunningMockTarget;

beforeAll(async () => {
  target = await startMockTarget({ quiet: true });
});
afterAll(async () => {
  await target.close();
});

function config(maxWakes: number): PopulaceConfig {
  return PopulaceConfigSchema.parse({
    target: { name: "Tasklet", mcp: [{ url: target.mcpUrl }] },
    identity: { strategy: "self-signup", signupTool: "sign_up", tokenPath: "token", userIdPath: "user.id", teardownTool: "delete_account" },
    guardrails: { perWake: { maxTokens: 400_000, maxUsd: 3, maxTurns: 40 }, dailyUsd: 50 },
    daemon: { tick: "10ms", concurrency: 1 },
    population: {
      id: "test",
      cadence: { every: "10ms" },
      maxWakes,
      members: [{ persona: { id: "quitter", name: "Quinn", role: "a hobbyist", backstory: "Impatient.", goals: ["keep a list"] } }],
    },
  });
}

const quits: ScriptPolicy = sequence([() => ({ calls: [call("give_up", { title: "Not for me", reason: "Nope.", would_return: false, severity: "medium", evidence_calls: [] })] })]);
const leaves: ScriptPolicy = sequence([() => ({ calls: [call("done", { summary: "had a look", would_return: true })] })]);

describe("LocalDaemon cadence", () => {
  /**
   * `cadenceOf` matched on `persona.id`, so two cohorts sharing one persona both found the first
   * member and were rescheduled on its cadence. Keyed by cohort, "25 weekend planners every 30
   * seconds and 9 sceptics every six hours" is a population that can actually run.
   */
  it("reschedules each cohort on its own cadence when two cohorts share a persona", async () => {
    const persona = { id: "lister", name: "List keeper", role: "a hobbyist", backstory: "Has too many lists.", goals: ["keep a list"] };
    const loaded = PopulaceConfigSchema.parse({
      target: { name: "Tasklet", mcp: [{ url: target.mcpUrl }] },
      identity: { strategy: "self-signup", signupTool: "sign_up", tokenPath: "token", userIdPath: "user.id", teardownTool: "delete_account" },
      daemon: { tick: "10ms", concurrency: 1 },
      population: {
        id: "everyone",
        cadence: { every: "10ms" },
        maxWakes: 4,
        members: [
          { cohort: "eager", cohortName: "Eager", persona, count: 1, cadence: { every: "10ms" } },
          { cohort: "patient", cohortName: "Patient", persona, count: 1, cadence: { every: "6h" } },
        ],
      },
    });
    const store = new SqliteStore(":memory:");
    const runId = newRunId();
    const daemon = new LocalDaemon({ config: loaded, runId }, { store, provider: new ScriptedProvider(leaves), identityProvider: new SelfSignupProvider(loaded.identity as never) });
    const scheduled = await daemon.reconcile();
    expect(scheduled.map((a) => a.id)).toEqual(["everyone/eager#1", "everyone/patient#1"]);

    const at = new Date();
    await daemon.tick(at);
    await daemon.tick(at);
    expect(daemon.wakesRun).toBe(2);

    const byId = new Map((await store.listAgents({ runId })).map((a) => [a.id, a]));
    const eager = Date.parse(byId.get("everyone/eager#1")!.nextWakeAt!);
    const patient = Date.parse(byId.get("everyone/patient#1")!.nextWakeAt!);
    expect(patient - eager).toBeGreaterThan(5 * 3_600_000);
    await store.close();
  });
});

describe("LocalDaemon retirement", () => {
  it("stops waking an agent that gave up, well short of maxWakes", async () => {
    const store = new SqliteStore(":memory:");
    const runId = newRunId();
    const loaded = config(4);
    const deps = { store, provider: new ScriptedProvider(quits), identityProvider: new SelfSignupProvider(loaded.identity as never) };
    const daemon = new LocalDaemon({ config: loaded, runId }, deps);
    await daemon.run();

    // One wake, not four: the agent quit on its first visit and was never rescheduled.
    expect(daemon.wakesRun).toBe(1);
    const [agent] = await store.listAgents({ runId });
    expect(agent?.status).toBe("retired");
    expect(agent?.retiredReason).toBe("gave-up");
    expect(agent?.wakeCount).toBe(1);

    // Reconciling again (a later `populace run`) must not resurrect it, even though
    // wakeCount is below maxWakes -- which is what revives an agent the limit retired.
    const second = new LocalDaemon({ config: loaded, runId }, deps);
    const reconciled = await second.reconcile();
    expect(reconciled[0]?.status).toBe("retired");
    expect(await store.listDueAgents(runId, new Date(Date.now() + 86_400_000), 10)).toEqual([]);
    await store.close();
  });

  it("still revives an agent the wake limit retired when maxWakes is raised", async () => {
    const store = new SqliteStore(":memory:");
    const runId = newRunId();
    const done: ScriptPolicy = sequence([() => ({ calls: [call("done", { summary: "enough", would_return: true })] })]);
    const deps = { store, provider: new ScriptedProvider(done), identityProvider: new SelfSignupProvider(config(1).identity as never) };
    await new LocalDaemon({ config: config(1), runId }, deps).run();

    const [first] = await store.listAgents({ runId });
    expect(first?.status).toBe("retired");
    expect(first?.retiredReason).toBe("max-wakes");

    const reconciled = await new LocalDaemon({ config: config(3), runId }, deps).reconcile();
    expect(reconciled[0]?.status).toBe("active");
    expect(reconciled[0]?.retiredReason).toBeNull();
    await store.close();
  });

  it("carries a continuation forward: memory, accounts, and only the agents who said they would return", async () => {
    const store = new SqliteStore(":memory:");
    const loaded = config(1);
    const identityProvider = new SelfSignupProvider(loaded.identity as never);

    // Parent run: the agent signs up, remembers something, then walks out saying it would return.
    const parentRun = newRunId();
    const quitButWinnable: ScriptPolicy = sequence([
      (ctx) => {
        const signup = /email (\S+), display name "([^"]+)", password (\S+)/.exec(ctx.wakeContext);
        if (!signup) throw new Error("no signup suggestion");
        return { calls: [{ name: "sign_up", input: { email: signup[1]!, displayName: signup[2]!, password: signup[3]! } }] };
      },
      () => ({ calls: [call("remember", { kind: "annoyance", text: "Search is case-sensitive." })] }),
      () => ({ calls: [call("give_up", { title: "Search is broken", reason: "Cannot find my tasks.", would_return: true, severity: "high", evidence_calls: [] })] }),
    ]);
    await new LocalDaemon({ config: loaded, runId: parentRun }, { store, provider: new ScriptedProvider(quitButWinnable), identityProvider }).run();

    const [parent] = await store.listAgents({ runId: parentRun });
    expect(parent?.retiredReason).toBe("gave-up");
    const parentIdentity = parent?.identityId;
    expect(parentIdentity).toBeTruthy();

    // Continuation: a new run id, seeded from the parent.
    const childRun = newRunId();
    const seen: string[] = [];
    const observe: ScriptPolicy = (ctx) => {
      seen.push(ctx.wakeContext);
      return { calls: [call("done", { summary: "better now", would_return: true })] };
    };
    const child = new LocalDaemon({ config: config(1), runId: childRun, continueFrom: parentRun }, { store, provider: new ScriptedProvider(observe), identityProvider });
    const agents = await child.reconcile();

    // The agent came back, carrying its account and its history.
    expect(agents).toHaveLength(1);
    expect(agents[0]?.status).toBe("active");
    expect(agents[0]?.identityId).toBe(parentIdentity);
    expect(agents[0]?.continuedFrom).toEqual({ runId: parentRun, atWake: 1, gaveUp: true });
    // Memory is copied under the new run, and the parent's own record is left intact.
    expect((await store.getMemory(childRun, parent!.id))?.annoyances).toHaveLength(1);
    expect((await store.getMemory(parentRun, parent!.id))?.annoyances).toHaveLength(1);
    // maxWakes is an allowance for the continuation, not a total across both runs.
    expect(agents[0]?.maxWakes).toBe(2);

    await child.run();
    expect(seen[0]).toContain("You stopped using this product after your last session");
    expect(seen[0]).toContain("Search is case-sensitive.");
    await store.close();
  });

  it("leaves behind an agent that gave up for good", async () => {
    const store = new SqliteStore(":memory:");
    const loaded = config(1);
    const identityProvider = new SelfSignupProvider(loaded.identity as never);
    const parentRun = newRunId();
    const goneForGood: ScriptPolicy = sequence([
      () => ({ calls: [call("give_up", { title: "Done with it", reason: "Not for me.", would_return: false, severity: "high", evidence_calls: [] })] }),
    ]);
    await new LocalDaemon({ config: loaded, runId: parentRun }, { store, provider: new ScriptedProvider(goneForGood), identityProvider }).run();

    const childRun = newRunId();
    const child = new LocalDaemon({ config: config(1), runId: childRun, continueFrom: parentRun }, { store, provider: new ScriptedProvider(sequence([])), identityProvider });
    const agents = await child.reconcile();

    // would_return was false, so the fix does not win this one back; a fresh cohort is the only way.
    expect(agents.filter((a) => a.continuedFrom !== null)).toHaveLength(0);
    // And it is not silently replaced by a new agent wearing the same id: a continuation
    // reports on the cohort it inherited, it does not acquire users.
    expect(agents).toHaveLength(0);
    await store.close();
  });
});

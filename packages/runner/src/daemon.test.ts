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
    expect(await store.listDueAgents(new Date(Date.now() + 86_400_000), 10)).toEqual([]);
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
});

import { emptyMemory, type Agent, type Finding, type Identity, type Wake } from "@populace/core";
import { describe, expect, it } from "vitest";
import { SqliteStore } from "./index.js";

const now = new Date("2026-09-17T12:00:00.000Z");

function agent(id: string, nextWakeAt: string | null = null): Agent {
  return {
    id,
    runId: "run_a_aaaaaa",
    populationId: "pop",
    persona: { id: "p", name: "P", role: "r", backstory: "b", goals: ["g"], constraints: [], patience: 3, budgetUsd: 0, traits: {}, tools: { allow: [], deny: [], destructive: "confirm" } },
    ordinal: 0,
    status: "active",
    identityId: null,
    wakeCount: 0,
    maxWakes: null,
    nextWakeAt,
    lastWakeAt: null,
    createdAt: now.toISOString(),
  };
}

describe("SqliteStore", () => {
  it("round-trips agents, identities, memory, wakes, traces, findings and control", async () => {
    const store = new SqliteStore(":memory:");
    await store.upsertAgent(agent("pop/p#1", "2026-09-17T11:00:00.000Z"));
    await store.upsertAgent(agent("pop/p#2", "2026-09-17T13:00:00.000Z"));
    expect((await store.listDueAgents(now, 10)).map((a) => a.id)).toEqual(["pop/p#1"]);
    expect(await store.listAgents({ runId: "run_a_aaaaaa" })).toHaveLength(2);

    const identity: Identity = {
      id: "idn_1",
      runId: "run_a_aaaaaa",
      tag: "populace:run_a_aaaaaa",
      agentId: "pop/p#1",
      personaId: "p",
      strategy: "self-signup",
      credential: { bearerToken: "tk", email: "x@y.z", extra: {} },
      createdAt: now.toISOString(),
      tornDownAt: null,
    };
    await store.saveIdentity(identity);
    expect(await store.listIdentitiesByTag(identity.tag)).toHaveLength(1);
    await store.markIdentityTornDown("idn_1", now);
    expect(await store.listIdentitiesByTag(identity.tag)).toHaveLength(0);
    expect(await store.listIdentitiesByTag(identity.tag, true)).toHaveLength(1);

    const memory = { ...emptyMemory("run_a_aaaaaa", "pop/p#1", now), notes: [{ wake: 1, text: "hi" }] };
    await store.saveMemory(memory);
    expect(await store.getMemory("run_a_aaaaaa", "pop/p#1")).toEqual(memory);

    const wake: Wake = {
      id: "wake_1",
      runId: "run_a_aaaaaa",
      tag: "populace:run_a_aaaaaa",
      agentId: "pop/p#1",
      personaId: "p",
      populationId: "pop",
      wakeNumber: 1,
      status: "done",
      summary: "ok",
      model: "m",
      effort: "high",
      usage: { inputTokens: 1, outputTokens: 2, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      costUsd: 0.5,
      turns: 1,
      toolCalls: 0,
      findingCount: 0,
      error: null,
      startedAt: now.toISOString(),
      endedAt: now.toISOString(),
    };
    await store.saveWake(wake);
    await store.appendTraceEvent({ type: "note", seq: 0, at: now.toISOString(), wakeId: "wake_1", text: "first" });
    await store.appendTraceEvent({ type: "note", seq: 1, at: now.toISOString(), wakeId: "wake_1", text: "second" });
    expect((await store.getTrace("wake_1")).map((e) => e.seq)).toEqual([0, 1]);
    expect(await store.costSince("pop", new Date(now.getTime() - 1000))).toBe(0.5);
    expect(await store.costSince("pop", new Date(now.getTime() + 1000))).toBe(0);

    const finding: Finding = {
      id: "fnd_1",
      runId: "run_a_aaaaaa",
      tag: "populace:run_a_aaaaaa",
      wakeId: "wake_1",
      agentId: "pop/p#1",
      personaId: "p",
      kind: "bug",
      title: "t",
      description: "d",
      expected: "e",
      observed: "o",
      severity: "high",
      confidence: 0.9,
      reproduction: [],
      endpoint: "default",
      identityId: null,
      verification: null,
      createdAt: now.toISOString(),
    };
    await store.saveFinding(finding);
    expect(await store.listFindings({ unverifiedOnly: true })).toHaveLength(1);
    await store.saveVerification("fnd_1", { verdict: "confirmed", reason: "same", judge: "heuristic", replay: [], verifiedAt: now.toISOString(), costUsd: 0 });
    expect(await store.listFindings({ unverifiedOnly: true })).toHaveLength(0);
    expect((await store.getFinding("fnd_1"))?.verification?.verdict).toBe("confirmed");

    expect(await store.getKillSwitch()).toEqual({ engaged: false, reason: null, at: null });
    await store.setKillSwitch(true, "stop");
    expect((await store.getKillSwitch()).engaged).toBe(true);

    expect(await store.listRunIds()).toEqual(["run_a_aaaaaa"]);
    expect(await store.deleteFindingsByRun("run_a_aaaaaa")).toBe(1);
    expect(await store.deleteWakesByRun("run_a_aaaaaa")).toBe(1);
    expect(await store.deleteAgentsByRun("run_a_aaaaaa")).toBe(2);
    expect(await store.getMemory("run_a_aaaaaa", "pop/p#1")).toBeUndefined();
    await store.close();
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyMemory, ReferencedError, type Agent, type Cohort, type Persona, type Finding, type Identity, type Person, type StoredPersona, type StoredPopulation, type Wake } from "@populace/core";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStore } from "./index.js";

const now = new Date("2026-09-17T12:00:00.000Z");
const at = now.toISOString();

const persona: Persona = {
  id: "p",
  name: "P",
  role: "r",
  backstory: "b",
  goals: ["g"],
  constraints: [],
  patience: 3,
  budgetUsd: 0,
  traits: {},
  tools: { allow: [], deny: [], destructive: "confirm" },
  model: {},
};

function agent(id: string, nextWakeAt: string | null = null, runId = "run_a_aaaaaa"): Agent {
  return {
    id,
    runId,
    simulationId: "sim_test",
    populationId: "pop",
    cohortSlug: "p",
    personId: "p#1",
    name: "Ingrid Bergstrom",
    details: "",
    handle: "ingrid-bergstrom-p-1",
    persona: { ...persona },
    ordinal: 0,
    status: "active",
    retiredReason: null,
    continuedFrom: null,
    identityId: null,
    wakeCount: 0,
    maxWakes: null,
    nextWakeAt,
    lastWakeAt: null,
    createdAt: now.toISOString(),
  };
}

function storedPersona(id: string, slug: string): StoredPersona {
  return { id, projectId: "default", slug, spec: { ...persona, id: slug }, origin: "authored", createdAt: at, updatedAt: at };
}

function cohort(id: string, slug: string, personaId: string, name: string): Cohort {
  return { id, projectId: "default", slug, name, personaId, size: 2, seed: "populace", notes: "", createdAt: at, updatedAt: at };
}

function population(id: string, slug: string, cohortIds: string[]): StoredPopulation {
  return { id, projectId: "default", slug, name: "Everyone", cohortIds, createdAt: at, updatedAt: at };
}

function person(cohortId: string, cohortSlug: string, ordinal: number, name: string): Person {
  return {
    id: `${cohortSlug}#${ordinal + 1}`,
    projectId: "default",
    cohortId,
    cohortSlug,
    personaId: "psn_1",
    personaSlug: "first-timers",
    ordinal,
    name,
    details: "",
    handle: `${cohortSlug}-${ordinal + 1}`,
    persona: { ...persona },
    generatedBy: "seeded",
    generatedByModel: "",
    seed: `populace:${cohortSlug}:${ordinal}`,
    archivedAt: null,
    createdAt: at,
    updatedAt: at,
  };
}

const temps: string[] = [];
function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "populace-store-"));
  temps.push(dir);
  return join(dir, "populace.db");
}
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("SqliteStore", () => {
  it("round-trips agents, identities, memory, wakes, traces, findings and control", async () => {
    const store = new SqliteStore(":memory:");
    await store.upsertAgent(agent("pop/p#1", "2026-09-17T11:00:00.000Z"));
    await store.upsertAgent(agent("pop/p#2", "2026-09-17T13:00:00.000Z"));
    expect((await store.listDueAgents("run_a_aaaaaa", now, 10)).map((a) => a.id)).toEqual(["pop/p#1"]);
    expect(await store.listAgents({ runId: "run_a_aaaaaa" })).toHaveLength(2);

    const identity: Identity = {
      id: "idn_1",
      runId: "run_a_aaaaaa",
      tag: "populace:run_a_aaaaaa",
      agentId: "pop/p#1",
      personaId: "p",
      strategy: "self-signup",
      credential: { bearerToken: "tk", expiresAt: null, redeemable: null, email: "x@y.z", extra: {} },
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
      wouldReturn: null,
      error: null,
      startedAt: now.toISOString(),
      endedAt: now.toISOString(),
    };
    await store.saveWake(wake);
    await store.appendTraceEvent({ type: "note", seq: 0, at: now.toISOString(), wakeId: "wake_1", text: "first" });
    await store.appendTraceEvent({ type: "note", seq: 1, at: now.toISOString(), wakeId: "wake_1", text: "second" });
    expect((await store.getTrace("wake_1")).map((e) => e.seq)).toEqual([0, 1]);
    expect(await store.costSince({ populationId: "pop" }, new Date(now.getTime() - 1000))).toBe(0.5);
    expect(await store.costSince({ populationId: "pop" }, new Date(now.getTime() + 1000))).toBe(0);

    const finding: Finding = {
      id: "fnd_1",
      runId: "run_a_aaaaaa",
      tag: "populace:run_a_aaaaaa",
      wakeId: "wake_1",
      agentId: "pop/p#1",
      personaId: "p",
      signature: "sig1:aaaaaaaaaaaa",
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

  /**
   * The defect the composite key exists to fix. An agent id is `populationSlug/cohortSlug#ordinal`
   * and repeats between executions by design; keyed by id alone, run B's upsert rewrote run A's
   * row (`ON CONFLICT(id) DO UPDATE SET run_id = excluded.run_id`) and run A's memory joins went
   * nowhere. Today's schema fails this test.
   */
  it("keeps the same agent id in two runs as two rows with separate state", async () => {
    const store = new SqliteStore(":memory:");
    const id = "everyone/first-timers#1";
    await store.upsertAgent({ ...agent(id, "2026-09-17T11:00:00.000Z", "run_a_aaaaaa"), wakeCount: 4 });
    await store.upsertAgent({ ...agent(id, "2026-09-17T11:30:00.000Z", "run_b_bbbbbb"), wakeCount: 0 });

    await store.upsertAgent({ ...agent(id, null, "run_b_bbbbbb"), status: "retired", retiredReason: "gave-up", wakeCount: 9 });

    const a = await store.getAgent("run_a_aaaaaa", id);
    expect(a?.status).toBe("active");
    expect(a?.wakeCount).toBe(4);
    expect(a?.nextWakeAt).toBe("2026-09-17T11:00:00.000Z");
    const b = await store.getAgent("run_b_bbbbbb", id);
    expect(b?.status).toBe("retired");
    expect(b?.wakeCount).toBe(9);

    expect((await store.listAgents({ runId: "run_a_aaaaaa" })).map((x) => x.wakeCount)).toEqual([4]);
    await store.close();
  });

  /** One daemon claiming another run's agents was reachable the moment two runs overlapped. */
  it("never serves one run's due agents to another run", async () => {
    const store = new SqliteStore(":memory:");
    await store.upsertAgent(agent("everyone/first-timers#1", "2026-09-17T11:00:00.000Z", "run_a_aaaaaa"));
    await store.upsertAgent(agent("everyone/first-timers#2", "2026-09-17T11:00:00.000Z", "run_a_aaaaaa"));
    await store.upsertAgent(agent("everyone/first-timers#1", "2026-09-17T10:00:00.000Z", "run_b_bbbbbb"));

    expect((await store.listDueAgents("run_b_bbbbbb", now, 10)).map((x) => x.runId)).toEqual(["run_b_bbbbbb"]);
    expect((await store.listDueAgents("run_a_aaaaaa", now, 10)).map((x) => x.id)).toEqual(["everyone/first-timers#1", "everyone/first-timers#2"]);
    await store.close();
  });

  it("rebuilds a database whose schema shape differs, and says so exactly once", async () => {
    const path = tempDbPath();
    const first = new SqliteStore(path);
    await first.upsertAgent(agent("pop/p#1"));
    await first.setControl("schema_shape", "some-older-shape");
    await first.close();

    const lines: string[] = [];
    const second = new SqliteStore(path, (line) => lines.push(line));
    expect(lines).toEqual(["populace store: the schema changed; this database was rebuilt from scratch and its runs are gone."]);
    expect(await second.listAgents({ runId: "run_a_aaaaaa" })).toEqual([]);
    await second.close();

    // Reopening on the shape this build writes is silent and keeps what is there.
    const quiet: string[] = [];
    const third = new SqliteStore(path, (line) => quiet.push(line));
    expect(quiet).toEqual([]);
    await third.close();
  });

  it("refuses to delete a persona a cohort still uses, and names the cohort", async () => {
    const store = new SqliteStore(":memory:");
    await store.savePersona(storedPersona("psn_1", "first-timers"));
    await store.saveCohort(cohort("coh_1", "first-timers", "psn_1", "First-timers"));

    await expect(store.deletePersona("psn_1")).rejects.toThrow(/First-timers/);
    await expect(store.deletePersona("psn_1")).rejects.toBeInstanceOf(ReferencedError);
    expect(await store.getPersona("psn_1")).toBeDefined();

    await store.savePopulation(population("pop_1", "everyone", ["coh_1"]));
    await expect(store.deleteCohort("coh_1")).rejects.toThrow(/Everyone/);

    await store.savePopulation(population("pop_1", "everyone", []));
    await store.deleteCohort("coh_1");
    await store.deletePersona("psn_1");
    expect(await store.getPersona("psn_1")).toBeUndefined();
    await store.close();
  });

  /**
   * The one delete that cascades, and the reason it has to be tested at this level: the produced
   * rows are keyed by RUN, not by project, so a project delete that only touched the tables with
   * a `project_id` column would leave agents, wakes, traces and findings behind — invisible in
   * every screen and counted by every `COUNT(*)`.
   */
  it("deletes a project with every row keyed to it, produced rows included", async () => {
    const store = new SqliteStore(":memory:");
    const runId = "run_a_aaaaaa";
    await store.saveProject({ id: "default", slug: "default", name: "Tasklet", description: "", archived: false, createdAt: at, updatedAt: at });
    await store.saveProject({ id: "other", slug: "other", name: "Somebody else's", description: "", archived: false, createdAt: at, updatedAt: at });
    await store.saveRun({
      id: runId,
      projectId: "default",
      simulationId: "sim_1",
      seq: 1,
      populationId: "pop_1",
      targetId: "tgt_1",
      label: "",
      status: "completed",
      mode: "ephemeral",
      parentRunId: null,
      continuation: null,
      configSnapshotId: "",
      resumes: 0,
      lastResumedAt: null,
      pauseReason: null,
      sweptAt: null,
      startedAt: at,
      endedAt: at,
      totals: { agents: 1, activeAgents: 0, wakes: 0, findings: 0, confirmed: 0, costUsd: 0 },
    });
    await store.upsertAgent(agent("pop/p#1", at));
    await store.saveMemory({ ...emptyMemory(runId, "pop/p#1", now), notes: [{ wake: 1, text: "hi" }] });
    await store.savePersona(storedPersona("psn_1", "first-timers"));
    await store.saveCohort(cohort("coh_1", "first-timers", "psn_1", "First-timers"));
    await store.savePerson(person("coh_1", "first-timers", 0, "Ingrid Bergstrom"));
    await store.savePopulation(population("pop_1", "everyone", ["coh_1"]));

    await store.deleteProject("default");

    expect(await store.getProject("default")).toBeUndefined();
    expect(await store.getRun(runId)).toBeUndefined();
    expect(await store.listAgents({ runId })).toHaveLength(0);
    expect(await store.getMemory(runId, "pop/p#1")).toBeUndefined();
    expect(await store.listPersonas("default")).toHaveLength(0);
    expect(await store.listCohorts("default")).toHaveLength(0);
    expect(await store.listPeople({ projectId: "default", includeArchived: true })).toHaveLength(0);
    expect(await store.listPopulations("default")).toHaveLength(0);

    // The neighbour is untouched, which is the difference between a cascade and a `DROP TABLE`.
    expect(await store.getProject("other")).toBeDefined();
    await store.close();
  });

  /** Deleting a project that is not there is a no-op, not a throw: `DELETE` is idempotent. */
  it("says nothing about a project that is already gone", async () => {
    const store = new SqliteStore(":memory:");
    await expect(store.deleteProject("never-existed")).resolves.toBeUndefined();
    await store.close();
  });

  it("archives a deleted cohort's people rather than deleting them", async () => {
    const store = new SqliteStore(":memory:");
    await store.saveCohort(cohort("coh_1", "first-timers", "psn_1", "First-timers"));
    await store.savePerson(person("coh_1", "first-timers", 0, "Ingrid Bergstrom"));
    await store.savePerson(person("coh_1", "first-timers", 1, "Mateo Alvarez"));
    expect((await store.listPeople({ cohortId: "coh_1" })).map((x) => x.name)).toEqual(["Ingrid Bergstrom", "Mateo Alvarez"]);

    await store.deleteCohort("coh_1");

    expect(await store.getCohort("coh_1")).toBeUndefined();
    expect(await store.listPeople({ cohortId: "coh_1" })).toEqual([]);
    const archived = await store.listPeople({ cohortId: "coh_1", includeArchived: true });
    expect(archived.map((x) => x.name)).toEqual(["Ingrid Bergstrom", "Mateo Alvarez"]);
    expect(archived.every((x) => x.archivedAt !== null)).toBe(true);
    await store.close();
  });
});

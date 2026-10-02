import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { emptyMemory, ReferencedError, type Agent, type Cohort, type Persona, type FiledIssue, type Finding, type GithubConnection, type Identity, type Person, type StoredPersona, type StoredPopulation, type Wake } from "@populace/core";
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
    personId: "p.p#1",
    context: "",
    cohortTools: { allow: [], deny: [], destructive: "confirm" },
    name: "Ingrid Bergstrom",
    details: "",
    handle: "ingrid-bergstrom-p.p-1",
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
  return {
    id,
    projectId: "default",
    slug,
    name,
    context: "You share a condition.",
    mix: [{ personaId, weight: 1 }],
    traits: {},
    tools: { allow: [], deny: [], destructive: "confirm" },
    model: {},
    seed: "populace",
    notes: "",
    createdAt: at,
    updatedAt: at,
  };
}

function population(id: string, slug: string, cohortIds: string[]): StoredPopulation {
  return { id, projectId: "default", slug, name: "Everyone", members: cohortIds.map((cohortId) => ({ cohortId, weight: 2 })), createdAt: at, updatedAt: at };
}

function person(cohortId: string, cohortSlug: string, ordinal: number, name: string): Person {
  const laneSlug = `${cohortSlug}.first-timers`;
  return {
    id: `${laneSlug}#${ordinal + 1}`,
    projectId: "default",
    cohortId,
    cohortSlug,
    personaId: "psn_1",
    personaSlug: "first-timers",
    laneSlug,
    ordinal,
    name,
    details: "",
    handle: `${laneSlug}-${ordinal + 1}`,
    persona: { ...persona },
    overrides: { traits: {} },
    generatedBy: "seeded",
    generatedByModel: "",
    seed: `populace:${laneSlug}:${ordinal}`,
    archivedAt: null,
    createdAt: at,
    updatedAt: at,
  };
}

function connection(repo = "acme/tasklet"): GithubConnection {
  return {
    projectId: "default",
    repo,
    token: "a-fine-grained-token",
    visibility: "private",
    autoFile: false,
    labels: ["populace"],
    filter: { kinds: ["bug"], minSeverity: "medium", onlyConfirmed: false },
    checkedAt: at,
    createdAt: at,
    updatedAt: at,
  };
}

function filedIssue(number: number, signatures: string[], filedAt = at, repo = "acme/tasklet"): FiledIssue {
  return {
    projectId: "default",
    provider: "github",
    repo,
    number,
    url: `https://github.com/${repo}/issues/${number}`,
    title: "Searching for a task only finds it in the case it was typed",
    signatures,
    seenIn: [{ studyId: "sim_1", runId: "run_a_aaaaaa", seq: 1, window: 1, at: filedAt }],
    // A freshly filed row has announced nothing yet. The field is on the type rather than optional
    // because a row that EXISTS always has a notices list — the schema's default fills it for a
    // row written before the field did, so "no notices" and "did not know" are the same state.
    quietNotices: [],
    supersededBy: null,
    filedAt,
    updatedAt: filedAt,
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

  /**
   * ADR-0041 moved the headcount from `members[].size` to `simulations.json.size` WITHOUT bumping
   * `SCHEMA_SHAPE`, so a database written before the move opens without a rebuild and its
   * simulations have no `size`. The backfill is what keeps them sending the people they sent: the
   * legacy sizes are summed onto the simulation, and the population's own blob is left as it was,
   * because the member schema reads a legacy `size` as the weight. The rows are written RAW, the
   * way the old build wrote them, since going through `savePopulation` would re-shape them.
   */
  it("gives a legacy simulation the sum of its population's member sizes, once", async () => {
    const path = tempDbPath();
    const shaped = new SqliteStore(path);
    await shaped.close();

    const db = new DatabaseSync(path);
    const row = { projectId: "default", createdAt: at, updatedAt: at };
    const legacyPopulation = (id: string, slug: string, sizes: number[]): string =>
      JSON.stringify({ id, slug, name: slug, members: sizes.map((size, index) => ({ cohortId: `coh_${index + 1}`, size })), ...row });
    const legacySimulation = (id: string, slug: string, populationId: string, extra: object = {}): string =>
      JSON.stringify({ id, slug, name: slug, description: "", populationId, targetId: "tgt_1", mode: "longitudinal", visitsPerPerson: null, cadence: { every: 600000, jitter: 30000, initialDelay: 0 }, seed: "populace", autoSweep: true, requireFreshTarget: false, overrides: {}, runCount: 0, lastRunId: null, archived: false, ...row, ...extra });
    const insertPopulation = db.prepare("INSERT INTO populations (id, project_id, slug, updated_at, json) VALUES (?, 'default', ?, ?, ?)");
    insertPopulation.run("pop_1", "everyone", at, legacyPopulation("pop_1", "everyone", [3, 2]));
    const insertSimulation = db.prepare("INSERT INTO simulations (id, project_id, slug, population_id, target_id, mode, archived, updated_at, json) VALUES (?, 'default', ?, ?, 'tgt_1', 'longitudinal', 0, ?, ?)");
    insertSimulation.run("sim_1", "trial", "pop_1", at, legacySimulation("sim_1", "trial", "pop_1"));
    insertSimulation.run("sim_2", "orphan", "pop_gone", at, legacySimulation("sim_2", "orphan", "pop_gone"));
    insertSimulation.run("sim_3", "sized", "pop_1", at, legacySimulation("sim_3", "sized", "pop_1", { size: 7 }));
    // The open above recorded the marker on an empty database; an old file has none.
    db.prepare("DELETE FROM control WHERE key = 'size_backfill'").run();
    db.close();

    const lines: string[] = [];
    const upgraded = new SqliteStore(path, (line) => lines.push(line));
    expect(lines).toEqual([]);
    expect((await upgraded.getSimulation("sim_1"))?.size).toBe(5);
    expect((await upgraded.getSimulation("sim_2"))?.size).toBe(0);
    expect((await upgraded.getSimulation("sim_3"))?.size).toBe(7);
    // The old sizes are the new weights, and they were not rewritten to get there.
    expect((await upgraded.getPopulation("pop_1"))?.members).toEqual([
      { cohortId: "coh_1", weight: 3 },
      { cohortId: "coh_2", weight: 2 },
    ]);
    expect(await upgraded.getControl("size_backfill")).toBe("1");
    await upgraded.close();

    // Idempotent: a second open changes nothing, and the marker keeps it from even looking.
    const again = new SqliteStore(path);
    expect((await again.getSimulation("sim_1"))?.size).toBe(5);
    expect((await again.getSimulation("sim_3"))?.size).toBe(7);
    await again.close();
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
    await store.saveGithubConnection(connection());
    await store.saveFiledIssue(filedIssue(7, ["bug|search_tasks|case find task"]));

    await store.deleteProject("default");

    expect(await store.getProject("default")).toBeUndefined();
    expect(await store.getRun(runId)).toBeUndefined();
    expect(await store.listAgents({ runId })).toHaveLength(0);
    expect(await store.getMemory(runId, "pop/p#1")).toBeUndefined();
    expect(await store.listPersonas("default")).toHaveLength(0);
    expect(await store.listCohorts("default")).toHaveLength(0);
    expect(await store.listPeople({ projectId: "default", includeArchived: true })).toHaveLength(0);
    expect(await store.listPopulations("default")).toHaveLength(0);
    // A deleted project leaves no token behind and no ledger row that nothing can ever match.
    expect(await store.getGithubConnection("default")).toBeUndefined();
    expect(await store.listFiledIssues("default")).toHaveLength(0);

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

  /**
   * Both rows behind filing issues, and the upsert on each. A connection is keyed by project
   * alone, so pressing Save a second time edits the one row rather than growing a second; a ledger
   * row is keyed by its issue, so recording that the problem was reported again grows its
   * signature set in place.
   */
  it("round-trips a GitHub connection and a filed issue", async () => {
    const store = new SqliteStore(":memory:");

    await store.saveGithubConnection(connection());
    expect(await store.getGithubConnection("default")).toMatchObject({ repo: "acme/tasklet", token: "a-fine-grained-token", visibility: "private", labels: ["populace"] });
    await store.saveGithubConnection(connection());
    await store.saveGithubConnection({ ...connection("acme/tasklet-qa"), autoFile: true });
    expect(await store.getGithubConnection("default")).toMatchObject({ repo: "acme/tasklet-qa", autoFile: true });
    expect(await store.getGithubConnection("other")).toBeUndefined();

    await store.saveFiledIssue(filedIssue(7, ["bug|search_tasks|case find task"]));
    expect(await store.listFiledIssues("default")).toMatchObject([{ number: 7, url: "https://github.com/acme/tasklet/issues/7" }]);
    await store.saveFiledIssue({
      ...filedIssue(7, ["bug|search_tasks|case find task", "bug|search_tasks|case lowercase search"]),
      seenIn: [
        { studyId: "sim_1", runId: "run_a_aaaaaa", seq: 1, window: 1, at },
        { studyId: "sim_1", runId: "run_b_bbbbbb", seq: 2, window: 1, at },
      ],
    });
    const ledger = await store.listFiledIssues("default");
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.signatures).toHaveLength(2);
    expect(ledger[0]?.seenIn.map((seen) => seen.runId)).toEqual(["run_a_aaaaaa", "run_b_bbbbbb"]);
    expect(await store.listFiledIssues("other")).toEqual([]);

    await store.deleteGithubConnection("default");
    expect(await store.getGithubConnection("default")).toBeUndefined();
    await store.close();
  });

  /**
   * The query the ledger exists for, tested on the case that breaks the obvious alternative: the
   * candidate is matched by a signature that was NOT the representative when the issue was filed.
   * A cluster's representative moves once the digest writes a verdict, so an implementation that
   * compared one key to one key would file the same problem a second time inside one execution.
   */
  it("matches a filed issue by any member signature, not just the one it was filed under", async () => {
    const store = new SqliteStore(":memory:");
    await store.saveFiledIssue(filedIssue(7, ["bug|search_tasks|case find task", "bug|search_tasks|case lowercase search"], "2026-09-17T12:00:00.000Z"));
    await store.saveFiledIssue(filedIssue(9, ["bug|update_task|due date dropped"], "2026-09-17T13:00:00.000Z"));

    const byMember = await store.matchFiledIssues("default", "github", "acme/tasklet", ["bug|search_tasks|case lowercase search"]);
    expect(byMember.map((issue) => issue.number)).toEqual([7]);
    expect((await store.matchFiledIssues("default", "github", "acme/tasklet", ["bug|nothing|anybody has seen", "bug|update_task|due date dropped"])).map((i) => i.number)).toEqual([9]);
    expect(await store.matchFiledIssues("default", "github", "acme/tasklet", ["bug|search_tasks|reworded from scratch"])).toEqual([]);
    expect(await store.matchFiledIssues("default", "github", "acme/tasklet", [])).toEqual([]);
    // Per project, because signatures only roll up within one (ADR-0035).
    expect(await store.matchFiledIssues("other", "github", "acme/tasklet", ["bug|search_tasks|case find task"])).toEqual([]);
    await store.close();
  });

  /**
   * Re-pointing a project at a second repository is one PUT — `saveGithubConnection` upserts on
   * the project — so the ledger has to be asked about a repository and not about a project. Match
   * on the project alone and every candidate afterwards matches a row filed into the OLD
   * repository: the publisher comments there with a token not scoped to it, and the new repository
   * never receives an issue. The old row stays, because it is what stops a re-point-and-back from
   * filing everything a second time.
   */
  it("does not match a row filed into another repository", async () => {
    const store = new SqliteStore(":memory:");
    const signatures = ["bug|search_tasks|case find task"];
    await store.saveFiledIssue(filedIssue(7, signatures));

    expect(await store.matchFiledIssues("default", "github", "acme/tasklet-qa", signatures)).toEqual([]);
    expect((await store.matchFiledIssues("default", "github", "acme/tasklet", signatures)).map((i) => i.number)).toEqual([7]);

    // Filed into the second repository too, and the two rows stay separate: the same problem in
    // two repositories is two issues, and each is matched only by its own.
    await store.saveFiledIssue({ ...filedIssue(3, signatures, "2026-09-17T13:00:00.000Z", "acme/tasklet-qa"), projectId: "default" });
    expect((await store.matchFiledIssues("default", "github", "acme/tasklet-qa", signatures)).map((i) => i.number)).toEqual([3]);
    expect((await store.matchFiledIssues("default", "github", "acme/tasklet", signatures)).map((i) => i.number)).toEqual([7]);
    // And both are still in the project's ledger, oldest first.
    expect((await store.listFiledIssues("default")).map((i) => i.number)).toEqual([7, 3]);
    await store.close();
  });

  /**
   * Two rows both matching one candidate is not a corrupt state: the clusterer is greedy over
   * titles, so a later report whose title bridges two previously separate problems merges them
   * into one cluster whose signature set reaches both rows. Returning one and dropping the other
   * orphans an issue for ever with nothing saying why, so both come back, oldest first — the
   * caller comments on the one a reader has been following and marks the rest superseded.
   */
  it("returns every matching row, oldest first", async () => {
    const store = new SqliteStore(":memory:");
    await store.saveFiledIssue(filedIssue(9, ["bug|update_task|due date dropped"], "2026-09-17T13:00:00.000Z"));
    await store.saveFiledIssue(filedIssue(11, ["bug|update_task|due date silently ignored"], "2026-09-17T14:00:00.000Z"));

    const bridged = await store.matchFiledIssues("default", "github", "acme/tasklet", ["bug|update_task|due date dropped", "bug|update_task|due date silently ignored"]);
    expect(bridged.map((issue) => issue.number)).toEqual([9, 11]);

    const [oldest, orphan] = bridged;
    await store.growFiledIssue({ projectId: "default", provider: "github", repo: "acme/tasklet", number: oldest?.number ?? 0 }, { signatures: orphan?.signatures ?? [], seenIn: [], updatedAt: at });
    const superseded = await store.growFiledIssue({ projectId: "default", provider: "github", repo: "acme/tasklet", number: orphan?.number ?? 0 }, { signatures: [], seenIn: [], updatedAt: at, supersededBy: oldest?.number });
    expect(superseded?.supersededBy).toBe(9);
    await store.close();
  });

  /**
   * Growing a row is one transaction because the alternative loses a signature. A read, a merge
   * and a whole-row `saveFiledIssue` spans two awaits, and the single-problem route runs outside
   * the serial job queue — so a bulk job and a click interleave there and the later write wins
   * whole, dropping the signatures the earlier one added and re-filing the problem next time.
   */
  it("grows a row's signature set and its sightings without losing either", async () => {
    const store = new SqliteStore(":memory:");
    await store.saveFiledIssue(filedIssue(7, ["bug|search_tasks|case find task"]));
    const key = { projectId: "default", provider: "github", repo: "acme/tasklet", number: 7 } as const;

    // Two growers reading the same row and adding a different signature each. Both survive.
    await Promise.all([
      store.growFiledIssue(key, { signatures: ["bug|search_tasks|case lowercase search"], seenIn: [{ studyId: "sim_1", runId: "run_a_aaaaaa", seq: 1, window: 2, at }], updatedAt: at }),
      store.growFiledIssue(key, { signatures: ["bug|search_tasks|case uppercase miss"], seenIn: [{ studyId: "sim_1", runId: "run_a_aaaaaa", seq: 1, window: 3, at }], updatedAt: at }),
    ]);

    const grown = (await store.listFiledIssues("default"))[0];
    expect(grown?.signatures).toEqual(["bug|search_tasks|case find task", "bug|search_tasks|case lowercase search", "bug|search_tasks|case uppercase miss"]);
    // One sighting per report cycle, and window is what distinguishes them: a longitudinal study
    // has one execution for its whole life, so `seq` alone is 1 for ever and cycle 3 would be
    // indistinguishable from a double-publish of cycle 1.
    expect(grown?.seenIn.map((seen) => seen.window)).toEqual([1, 2, 3]);

    // Publishing the same window twice is a double-publish, not a second sighting.
    await store.growFiledIssue(key, { signatures: [], seenIn: [{ studyId: "sim_1", runId: "run_a_aaaaaa", seq: 1, window: 3, at }], updatedAt: at });
    expect((await store.listFiledIssues("default"))[0]?.seenIn).toHaveLength(3);

    // Nothing to grow is not an error: the project may have been deleted underneath the caller.
    expect(await store.growFiledIssue({ ...key, number: 404 }, { signatures: [], seenIn: [], updatedAt: at })).toBeUndefined();
    await store.close();
  });

  /**
   * One unreadable ledger row must not throw the ledger away. A publisher that cannot read it has
   * no way to tell "nothing has been filed" from "I could not look", and if it guesses the first
   * it re-files every issue in somebody's repository. So the row is skipped, warned about, and NOT
   * matched on — a row this build cannot parse is one whose signature set it cannot know.
   */
  it("skips a ledger row it cannot parse rather than throwing the ledger away", async () => {
    const path = tempDbPath();
    const shaped = new SqliteStore(path);
    await shaped.saveFiledIssue(filedIssue(7, ["bug|search_tasks|case find task"]));
    await shaped.saveFiledIssue(filedIssue(9, ["bug|update_task|due date dropped"], "2026-09-17T13:00:00.000Z"));
    await shaped.close();

    const db = new DatabaseSync(path);
    db.prepare("UPDATE filed_issues SET json = ? WHERE number = 7").run(JSON.stringify({ projectId: "default", provider: "gitlab", repo: "acme/tasklet", number: 7 }));
    db.close();

    const lines: string[] = [];
    const store = new SqliteStore(path, (line) => lines.push(line));
    expect((await store.listFiledIssues("default")).map((i) => i.number)).toEqual([9]);
    expect((await store.matchFiledIssues("default", "github", "acme/tasklet", ["bug|update_task|due date dropped"])).map((i) => i.number)).toEqual([9]);
    expect(await store.matchFiledIssues("default", "github", "acme/tasklet", ["bug|search_tasks|case find task"])).toEqual([]);
    expect(lines.some((line) => line.includes("skipped 1 filing-ledger row"))).toBe(true);
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

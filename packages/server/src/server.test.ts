import { SelfSignupProvider } from "@populace/adapters/self-signup";
import {
  DigestSchema,
  ErrorBodySchema,
  FindingSchema,
  HealthViewSchema,
  MemorySchema,
  ParticipantDetailViewSchema,
  ParticipantSummaryViewSchema,
  RunCohortViewSchema,
  RunDetailSchema,
  RunSummarySchema,
  SpendViewSchema,
  ToolUsageViewSchema,
  TraceEventSchema,
  WakeDetailSchema,
  WakeSummarySchema,
  pageOf,
  ProjectSummaryViewSchema,
  routes,
} from "@populace/contract";
import { PopulaceConfigSchema, expandPopulation, newRunId, type JsonValue, type PopulaceConfig } from "@populace/core";
import { startMockTarget, type RunningMockTarget } from "@populace/mock-target";
import { runWake } from "@populace/runner";
import { ScriptedProvider, byWake, call, field, sequence, type ScriptContext, type ScriptPolicy } from "@populace/runner/testing";
import { SqliteStore } from "@populace/store-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { startServer } from "./serve.js";

/**
 * A fresh target per test. The verifier replays a finding's tool calls against the live target
 * (ADR-0014), and a replay both reads and writes: sharing one target between tests let an earlier
 * test's accounts and projects decide whether a later test's replay reproduced. Starting the
 * reference app is in-process and costs milliseconds, so isolation is the cheaper side of that
 * trade.
 */
let target: RunningMockTarget;
beforeEach(async () => {
  target = await startMockTarget({ quiet: true });
});
afterEach(async () => {
  await target.close();
});

const signUp = (ctx: ScriptContext) => {
  const s = /email (\S+), display name "([^"]+)", password (\S+)/.exec(ctx.wakeContext);
  if (!s) throw new Error("no signup suggestion");
  return { calls: [call("sign_up", { email: s[1]!, displayName: s[2]!, password: s[3]! })] };
};
const refOf = (ctx: ScriptContext, name: string, includes = ""): string => ctx.allResults.find((r) => r.name === name && r.text.includes(includes))?.ref ?? "";

/** Finds the planted case-sensitive `search_tasks` bug, then leaves saying she would come back. */
const searcher: ScriptPolicy = byWake(
  {
    1: sequence([
      signUp,
      () => ({ calls: [call("create_project", { name: "Errands" })] }),
      (ctx) => ({ calls: [call("create_task", { projectId: field(ctx.lastResults[0], "id"), title: "Buy Groceries" })] }),
      () => ({ calls: [call("search_tasks", { query: "groceries" })] }),
      () => ({ calls: [call("search_tasks", { query: "Groceries" })] }),
      (ctx) => ({
        calls: [
          call("file_finding", {
            kind: "bug",
            title: "search_tasks is case-sensitive although it says case-insensitive",
            description: "Searching in lower case finds nothing.",
            expected: "'groceries' finds 'Buy Groceries'.",
            observed: "'groceries' returned 0 tasks, 'Groceries' returned 1.",
            severity: "high",
            confidence: 0.95,
            tool: "search_tasks",
            evidence_calls: [refOf(ctx, "search_tasks", '"groceries"'), refOf(ctx, "search_tasks", '"Groceries"')],
          }),
          call("remember", { kind: "annoyance", text: "Search only matches my exact capitalisation." }),
        ],
      }),
      () => ({ calls: [call("give_up", { title: "Leaving: search does not work", reason: "I cannot find my own tasks.", would_return: true, severity: "high", evidence_calls: [] })] }),
    ]),
  },
  sequence([]),
);

/** Files the coverage gap the product copy promises, and finishes tidily. */
const organiser: ScriptPolicy = byWake(
  {
    1: sequence([
      () => ({ calls: [call("get_product_info")] }),
      signUp,
      () => ({ calls: [call("list_tasks", {})] }),
      (ctx) => ({
        calls: [
          call("file_finding", {
            kind: "coverage-gap",
            title: "No way to delete a task",
            description: "The product copy promises I can delete tasks, but no tool does it.",
            expected: "A delete_task tool exists.",
            observed: "No such tool.",
            severity: "medium",
            confidence: 0.8,
            tool: "delete_task",
            evidence_calls: [refOf(ctx, "get_product_info"), refOf(ctx, "list_tasks")],
          }),
        ],
      }),
      () => ({ calls: [call("done", { summary: "Signed up and looked around.", would_return: true })] }),
    ]),
  },
  sequence([]),
);

function config(): PopulaceConfig {
  return PopulaceConfigSchema.parse({
    target: { name: "Tasklet", mcp: [{ url: target.mcpUrl }], webBaseUrl: target.url, description: "Tasklet keeps your projects and tasks in one place." },
    identity: { strategy: "self-signup", signupTool: "sign_up", tokenPath: "token", userIdPath: "user.id", teardownTool: "delete_account" },
    verifier: { judge: "heuristic" },
    population: {
      id: "tasklet",
      members: [
        { persona: { id: "searcher", name: "Sam Reed", role: "a list keeper", backstory: "b", goals: ["find things again"] } },
        { persona: { id: "organiser", name: "Ola Kent", role: "an operations lead", backstory: "b", goals: ["keep things tidy"] } },
      ],
    },
  });
}

/** One real run against the mock target, so every assertion below is about data a wake produced. */
async function seed(): Promise<{ store: SqliteStore; cfg: PopulaceConfig; runId: string }> {
  const store = new SqliteStore(":memory:");
  const cfg = config();
  const runId = newRunId();
  const identityProvider = new SelfSignupProvider(cfg.identity as never);
  const policies: Record<string, ScriptPolicy> = { searcher, organiser };
  const provider = new ScriptedProvider((ctx) => (policies[ctx.metadata.personaId] ?? sequence([]))(ctx));
  for (const { agent } of expandPopulation(cfg.population, runId, cfg.simulation.id)) {
    const result = await runWake({ agent, config: cfg }, { store, provider, identityProvider });
    expect(["done", "gave-up"]).toContain(result.wake.status);
  }
  return { store, cfg, runId };
}

/**
 * The read-only API. `configForRun` is how a read route gets at the config a run executed now
 * that there is no process-wide "the config": these runs were driven straight through `runWake`
 * and have no snapshot, so the harness answers for them.
 */
function app(store: SqliteStore, cfg: PopulaceConfig) {
  return createApp({ store, configForRun: () => Promise.resolve(cfg), storePath: ":memory:", version: "test" });
}

async function json(res: Response): Promise<JsonValue> {
  expect(res.status).toBe(200);
  // HTTP boundary: JSON text, parsed with a contract schema at every call site.
  return (await res.json()) as JsonValue;
}

describe("the read-only M1 API over a real run", () => {
  it("serves runs, agents, wakes and spend that match the contract", async () => {
    const { store, cfg, runId } = await seed();
    const api = app(store, cfg);

    const runs = pageOf(RunSummarySchema).parse(await json(await api.request(routes.runs)));
    expect(runs.items).toHaveLength(1);
    const run = runs.items[0]!;
    expect(run.id).toBe(runId);
    expect(run.populationId).toBe("tasklet");
    expect(run.totals.agents).toBe(2);
    expect(run.totals.wakes).toBe(2);
    expect(run.totals.findings).toBe(3); // a bug, a coverage gap and the abandonment
    // Derived from agent activity: the organiser ended on `done` and is still due to wake again,
    // so the run is still running. Only the searcher, who gave up, is retired.
    expect(run.status).toBe("running");
    expect(run.totals.activeAgents).toBe(1);
    expect(run.parentRunId).toBeNull();
    expect(run.startedAt).not.toBeNull();
    // Its last visit has finished, but the organiser is due to wake again, so the run has not ended.
    expect(run.endedAt).toBeNull();

    const detail = RunDetailSchema.parse(await json(await api.request(routes.run(runId))));
    expect(detail.findingsByKind.bug).toBe(1);
    expect(detail.findingsByKind["coverage-gap"]).toBe(1);
    expect(detail.findingsByKind.abandonment).toBe(1);
    // Every key is present even at zero, so a client never has to guess what a gap means.
    expect(detail.findingsByKind.praise).toBe(0);
    expect(detail.childRunIds).toEqual([]);
    expect(detail.wakesByStatus.done).toBe(1); // the organiser finished her errand
    expect(detail.wakesByStatus["gave-up"]).toBe(1); // the searcher walked away
    expect(detail.verified.checked).toBe(0); // nothing has been judged yet

    const participants = pageOf(ParticipantSummaryViewSchema).parse(await json(await api.request(routes.runParticipants(runId))));
    expect(participants.items).toHaveLength(2);
    const searcher = participants.items.find((a) => a.personaSlug === "searcher");
    expect(searcher?.personaName).toBe("Sam Reed");
    expect(searcher?.status).toBe("retired");
    expect(searcher?.retiredReason).toBe("gave-up");
    expect(searcher?.wouldReturn).toBe(true); // she said she would come back, so a continuation may ask her
    expect(searcher?.findings).toBe(2); // the search bug and the abandonment
    expect(searcher?.account?.email).toContain("@"); // she signed up through the target's own tools
    // The person, not the persona: a cohort is a group and the participant is somebody in it.
    expect(searcher?.name).not.toBe("");
    expect(searcher?.personId).toBe(`${searcher?.cohortSlug}#1`);

    const wakes = pageOf(WakeSummarySchema).parse(await json(await api.request(routes.runWakes(runId))));
    expect(wakes.items).toHaveLength(2);
    expect(wakes.items.map((w) => w.personaName).sort()).toEqual(["Ola Kent", "Sam Reed"]);
    const gaveUp = wakes.items.find((w) => w.status === "gave-up");
    expect(gaveUp?.wouldReturn).toBe(true); // what the fix-validation screen reads

    const spend = SpendViewSchema.parse(await json(await api.request(routes.runSpend(runId))));
    expect(spend.dailyCeilingUsd).toBe(cfg.guardrails.dailyUsd);
    expect(spend.spentTodayUsd).toBeGreaterThanOrEqual(spend.totalUsd - 0.0001);
    expect(spend.byPersona).toHaveLength(2);
    // By cohort as well as by persona: two cohorts may share one persona, so a per-persona row
    // cannot answer "what did this group cost me".
    expect(spend.byCohort.map((b) => b.key).sort()).toEqual(["organiser", "searcher"]);
    expect(spend.byDay).toHaveLength(1);
    expect(spend.totalUsd).toBeGreaterThanOrEqual(0);

    // Retiring the last active agent, as the daemon does at max-wakes, flips the run to completed.
    const organiser = participants.items.find((a) => a.personaSlug === "organiser");
    const stored = await store.getAgent(runId, organiser!.id);
    await store.upsertAgent({ ...stored!, status: "retired", retiredReason: "max-wakes", nextWakeAt: null });
    const after = RunDetailSchema.parse(await json(await api.request(routes.run(runId))));
    expect(after.status).toBe("completed");
    expect(after.endedAt).not.toBeNull(); // now that nobody is coming back, it has

    await store.close();
  });

  it("serves the trace of the wake that found a defect, with its tool calls in order", async () => {
    const { store, cfg, runId } = await seed();
    const api = app(store, cfg);

    const findings = pageOf(FindingSchema).parse(await json(await api.request(routes.runFindings(runId))));
    const bug = findings.items.find((f) => f.kind === "bug");
    expect(bug?.title).toContain("case-sensitive");
    expect(bug?.reproduction.length).toBe(2);
    // Worst first: the high-severity bug and abandonment sort above the medium coverage gap.
    expect(findings.items.at(-1)?.kind).toBe("coverage-gap");

    const detail = FindingSchema.parse(await json(await api.request(routes.finding(bug!.id))));
    expect(detail.reproduction.map((r) => r.tool)).toEqual(["search_tasks", "search_tasks"]);

    const wake = WakeDetailSchema.parse(await json(await api.request(routes.wake(bug!.wakeId))));
    expect(wake.findingIds).toContain(bug!.id);
    expect(wake.memoryUpdatedAt).not.toBeNull();

    const trace = pageOf(TraceEventSchema).parse(await json(await api.request(routes.wakeTrace(bug!.wakeId))));
    expect(trace.items[0]?.type).toBe("wake.start");
    expect(trace.items.at(-1)?.type).toBe("wake.end");
    const toolCalls = trace.items.filter((e) => e.type === "tool.call");
    expect(toolCalls.map((e) => e.tool)).toContain("search_tasks");
    // The refs the finding cites are the refs the trace recorded: that link is the replay (ADR-0015).
    const refs = new Set(toolCalls.map((e) => e.ref));
    for (const step of detail.reproduction) expect(refs.has(step.ref)).toBe(true);
    expect(trace.items.every((e, i) => i === 0 || e.seq > trace.items[i - 1]!.seq)).toBe(true);

    await store.close();
  });

  it("paginates the trace and resumes from a sequence number", async () => {
    const { store, cfg, runId } = await seed();
    const api = app(store, cfg);
    const wakes = pageOf(WakeSummarySchema).parse(await json(await api.request(routes.runWakes(runId))));
    const wakeId = wakes.items[0]!.id;

    const first = pageOf(TraceEventSchema).parse(await json(await api.request(`${routes.wakeTrace(wakeId)}?limit=3`)));
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();
    const second = pageOf(TraceEventSchema).parse(await json(await api.request(`${routes.wakeTrace(wakeId)}?limit=3&cursor=${first.nextCursor!}`)));
    expect(second.items[0]?.seq).toBeGreaterThan(first.items.at(-1)!.seq);

    const resumed = pageOf(TraceEventSchema).parse(await json(await api.request(`${routes.wakeTrace(wakeId)}?afterSeq=${first.items.at(-1)!.seq}`)));
    expect(resumed.items[0]?.seq).toBe(second.items[0]?.seq);

    await store.close();
  });

  it("filters findings by kind, severity and agent", async () => {
    const { store, cfg, runId } = await seed();
    const api = app(store, cfg);

    const gaps = pageOf(FindingSchema).parse(await json(await api.request(`${routes.runFindings(runId)}?kind=coverage-gap`)));
    expect(gaps.items.map((f) => f.kind)).toEqual(["coverage-gap"]);

    const both = pageOf(FindingSchema).parse(await json(await api.request(`${routes.runFindings(runId)}?kind=bug&kind=abandonment`)));
    expect(both.items.map((f) => f.kind).sort()).toEqual(["abandonment", "bug"]);

    const high = pageOf(FindingSchema).parse(await json(await api.request(`${routes.runFindings(runId)}?severity=high`)));
    expect(high.items.every((f) => f.severity === "high")).toBe(true);
    expect(high.items.length).toBeGreaterThan(0);

    const unverified = pageOf(FindingSchema).parse(await json(await api.request(`${routes.runFindings(runId)}?unverified=true`)));
    expect(unverified.items).toHaveLength(3); // nothing has been judged yet

    const byAgent = pageOf(FindingSchema).parse(await json(await api.request(`${routes.runFindings(runId)}?participant=${gaps.items[0]!.agentId}`)));
    expect(byAgent.items.every((f) => f.agentId === gaps.items[0]!.agentId)).toBe(true);

    await store.close();
  });

  it("builds the digest for a run, and verifies on request with the heuristic judge", async () => {
    const { store, cfg, runId } = await seed();
    const api = app(store, cfg);

    const plain = DigestSchema.parse(await json(await api.request(routes.runDigest(runId))));
    expect(plain.targetName).toBe("Tasklet");
    expect(plain.runIds).toEqual([runId]);
    expect(plain.clusters.length).toBeGreaterThan(0);
    expect(plain.clusters.every((c) => c.unverifiedCount > 0)).toBe(true);

    const verified = DigestSchema.parse(await json(await api.request(`${routes.runDigest(runId)}?verify=true`)));
    const search = verified.clusters.find((c) => c.tool === "search_tasks");
    expect(search?.confirmedCount).toBe(1);
    const gap = verified.clusters.find((c) => c.tool === "delete_task");
    expect(gap?.confirmedCount).toBe(1);

    await store.close();
  });

  it("reports health, and never puts the bearer token in any answer it gives", async () => {
    const { store, cfg, runId } = await seed();
    const withSecret: PopulaceConfig = { ...cfg, target: { ...cfg.target, mcp: cfg.target.mcp.map((e) => ({ ...e, bearerToken: "super-secret-token" })) } };
    const api = app(store, withSecret);

    const health = HealthViewSchema.parse(await json(await api.request(routes.health)));
    expect(health.readOnly).toBe(true);
    expect(health.killSwitch.engaged).toBe(false);

    // `GET /target` is gone with the singleton it encoded, so the guarantee is asserted where it
    // actually matters: across every read route, over a config whose endpoint carries a token.
    const paths = [routes.runs, routes.run(runId), routes.runParticipants(runId), routes.runWakes(runId), routes.runFindings(runId), routes.runSpend(runId), routes.runTools(runId), routes.runDigest(runId)];
    for (const path of paths) {
      const res = await api.request(path);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).not.toContain("super-secret-token");
    }
    // ...and the tool list a coverage view is measured against still comes off the live target.
    const usage = ToolUsageViewSchema.parse(await json(await api.request(routes.runTools(runId))));
    expect(usage.items.map((t) => t.name)).toContain("search_tasks");
    expect(usage.items.some((t) => t.destructive)).toBe(true);

    await store.close();
  });

  it("answers missing ids and bad queries without a stack trace", async () => {
    const { store, cfg } = await seed();
    const api = app(store, cfg);

    expect((await api.request(routes.run("run_nope_000000"))).status).toBe(404);
    expect((await api.request(routes.wake("wake_nope"))).status).toBe(404);
    expect((await api.request(routes.finding("fnd_nope"))).status).toBe(404);
    expect((await api.request(`${routes.runs}/../../etc/passwd`)).status).toBe(404);

    const bad = await api.request(`${routes.runs}?limit=nonsense`);
    expect(bad.status).toBe(400);
    expect(ErrorBodySchema.parse(await bad.json()).error.code).toBe("bad_request");

    await store.close();
  });
});

describe("what the coverage-gaps and population screens read", () => {
  it("counts every tool the run used and names the ones nobody reached for", async () => {
    const { store, cfg, runId } = await seed();
    const api = app(store, cfg);

    const usage = ToolUsageViewSchema.parse(await json(await api.request(routes.runTools(runId))));
    const search = usage.items.find((t) => t.name === "search_tasks");
    expect(search?.calls).toBe(2); // the searcher tried lower case and then capitalised
    expect(search?.exposed).toBe(true);
    expect(search?.firstUsedAt).not.toBeNull();

    // The point of the view: tools Tasklet exposes that nobody in this run called.
    expect(usage.neverCalledCount).toBeGreaterThan(0);
    const untouched = usage.items.filter((t) => t.exposed && t.calls === 0).map((t) => t.name);
    expect(untouched).toContain("add_comment");
    expect(untouched).not.toContain("sign_up"); // both personas signed up
    expect(usage.toolsError).toBeNull();
  });

  it("serves an agent's memory, and an empty document for one that has written none", async () => {
    const { store, cfg, runId } = await seed();
    const api = app(store, cfg);
    const participants = pageOf(ParticipantSummaryViewSchema).parse(await json(await api.request(routes.runParticipants(runId))));
    const searcher = participants.items.find((a) => a.personaSlug === "searcher")!;

    const memory = MemorySchema.parse(await json(await api.request(routes.participantMemory(runId, searcher.id))));
    expect(memory.agentId).toBe(searcher.id);
    // What she is carrying: this is what makes visit three different from visit one.
    expect(memory.annoyances.map((a) => a.text).join(" ")).toContain("capitalisation");

    const empty = MemorySchema.parse(await json(await api.request(routes.participantMemory(runId, "tasklet/nobody#0"))));
    expect(empty.notes).toEqual([]);

    await store.close();
  });
});

/**
 * Decision A: the wire speaks the user's words. The rows underneath are `Agent`s and every store
 * method still says so — what changes is only what a client is handed.
 */
describe("what a client is told about who visited", () => {
  it("names the person and their cohort, and never says \"agent\" anywhere in the answer", async () => {
    const { store, cfg, runId } = await seed();
    const api = app(store, cfg);

    const res = await api.request(routes.runParticipants(runId));
    const body = await res.text();
    // The whole point of the translation layer: the vocabulary of the implementation does not
    // reach the user. A field, a key or a value saying "agent" fails this.
    expect(body.toLowerCase()).not.toContain("agent");

    const participants = pageOf(ParticipantSummaryViewSchema).parse(JSON.parse(body));
    const searcher = participants.items.find((p) => p.personaSlug === "searcher")!;
    expect(searcher.name.length).toBeGreaterThan(0); // a person, generated for this cohort
    expect(searcher.cohortSlug).toBe("searcher");
    expect(searcher.cohortName.length).toBeGreaterThan(0);
    expect(searcher.visits).toBe(1); // `wakeCount` on the row
    expect(searcher.maxVisits).toBeNull(); // `maxWakes` on the row
    expect(searcher.lastVisitAt).not.toBeNull();

    await store.close();
  });

  it("serves one person's whole page in a single request — memory, visits and findings included", async () => {
    const { store, cfg, runId } = await seed();
    const api = app(store, cfg);
    const participants = pageOf(ParticipantSummaryViewSchema).parse(await json(await api.request(routes.runParticipants(runId))));
    const searcher = participants.items.find((p) => p.personaSlug === "searcher")!;

    const detail = ParticipantDetailViewSchema.parse(await json(await api.request(routes.participant(runId, searcher.id))));
    expect(detail.id).toBe(searcher.id);
    expect(detail.patience).toBe(3);
    // The memory panel is IN the answer. It used to be a second request per participant, fired on
    // a five-second poll (`packages/web/src/screens/Population.tsx`).
    expect(detail.memory.annoyances.map((a) => a.text).join(" ")).toContain("capitalisation");
    expect(detail.visits).toHaveLength(1);
    expect(detail.visits[0]?.visitNumber).toBe(1);
    expect(detail.visits[0]?.status).toBe("gave-up");
    expect(detail.findingsFiled.map((f) => f.kind).sort()).toEqual(["abandonment", "bug"]);
    expect(detail.alsoIn).toEqual([]); // one execution so far

    expect((await api.request(routes.participant(runId, "tasklet/nobody#9"))).status).toBe(404);
    await store.close();
  });

  it("rolls the run up by cohort, which is the shape the population screen reads", async () => {
    const { store, cfg, runId } = await seed();
    const api = app(store, cfg);
    const cohorts = pageOf(RunCohortViewSchema).parse(await json(await api.request(routes.runCohorts(runId))));
    expect(cohorts.items.map((c) => c.cohortSlug).sort()).toEqual(["organiser", "searcher"]);
    const searcher = cohorts.items.find((c) => c.cohortSlug === "searcher")!;
    expect(searcher.people).toBe(1);
    expect(searcher.gaveUp).toBe(1);
    expect(searcher.findings).toBe(2);
    expect(searcher.headline).toContain("walked away");
    await store.close();
  });
});

describe("populace serve", () => {
  it("binds loopback and answers over HTTP", async () => {
    const { store, cfg } = await seed();
    const server = await startServer({ store, storePath: ":memory:", version: "test", seedConfig: cfg, port: 0 });
    try {
      expect(server.url).toContain("127.0.0.1");
      const health = HealthViewSchema.parse(await json(await fetch(`${server.url}${routes.health}`)));
      expect(health.version).toBe("test");
      // `pnpm build` puts the dashboard in the package's public/, and serve hosts it from there.
      const root = await fetch(server.url);
      expect(root.status).toBe(200);
      expect(await root.text()).toContain('<div id="root">');
    } finally {
      await server.close();
      await store.close();
    }
  });

  /**
   * Ctrl-C with the dashboard open. Every project page holds an event stream, and an event stream
   * never ends by itself, so `server.close()` alone waits for a callback that cannot come: the
   * listener drops at once — the dashboard starts refusing connections — and the process sits
   * there looking busy until the browser tab is closed.
   */
  it("lets go of an open event stream when it is closed", async () => {
    const { store, cfg } = await seed();
    const server = await startServer({ store, storePath: ":memory:", version: "test", seedConfig: cfg, port: 0 });
    const stream = await fetch(`${server.url}${routes.events}?project=default`);
    expect(stream.status).toBe(200);

    const started = Date.now();
    await server.close();
    expect(Date.now() - started).toBeLessThan(5_000);

    try {
      await stream.body?.cancel();
    } catch {
      // The socket is already gone, which is the point of the test.
    }
    await store.close();
  });

  /**
   * The projects list is the first screen anybody sees, and `serve` used to put a row on it
   * before the user had done anything: `ensureProject` ran on every boot and named the result
   * "Default". With nothing in the product able to delete a project, that row was permanent.
   */
  it("invents no project when there is nothing to seed and none was asked for", async () => {
    const store = new SqliteStore(":memory:");
    const server = await startServer({ store, storePath: ":memory:", version: "test", port: 0 });
    try {
      expect(await store.listProjects()).toHaveLength(0);
      const list = pageOf(ProjectSummaryViewSchema).parse(await json(await fetch(`${server.url}${routes.projects}`)));
      expect(list.items).toHaveLength(0);
    } finally {
      await server.close();
      await store.close();
    }
  });

  /** A file to import is a reason for a project, and the project is named after what it tests. */
  it("names the project it imports a populace.yaml into after the target", async () => {
    const { store, cfg } = await seed();
    const server = await startServer({ store, storePath: ":memory:", version: "test", seedConfig: cfg, port: 0 });
    try {
      const projects = await store.listProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0]?.name).toBe(cfg.target.name);
      expect(projects[0]?.name).not.toBe("Default");
    } finally {
      await server.close();
      await store.close();
    }
  });

  /** `--project` is the other reason: the user named one, so it is made. */
  it("makes the project that --project names", async () => {
    const store = new SqliteStore(":memory:");
    const server = await startServer({ store, storePath: ":memory:", version: "test", projectId: "staging", port: 0 });
    try {
      expect((await store.listProjects()).map((project) => project.id)).toEqual(["staging"]);
    } finally {
      await server.close();
      await store.close();
    }
  });

  it("explains itself when no dashboard has been built into the install", async () => {
    const { store, cfg } = await seed();
    const server = await startServer({ store, storePath: ":memory:", version: "test", seedConfig: cfg, port: 0, webRoot: "/nonexistent/public" });
    try {
      const root = await fetch(server.url);
      expect(root.status).toBe(200);
      expect(await root.text()).toContain("The API is running");
      // The API still works without it, which is what an M4 CI consumer uses.
      expect((await fetch(`${server.url}${routes.health}`)).status).toBe(200);
    } finally {
      await server.close();
      await store.close();
    }
  });
});

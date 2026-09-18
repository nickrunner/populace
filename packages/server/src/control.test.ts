import { SelfSignupProvider } from "@populace/adapters/self-signup";
import {
  JobViewSchema,
  PersonaViewSchema,
  PopulationViewSchema,
  RunEstimateSchema,
  RunLiveSchema,
  SettingsViewSchema,
  SetupStatusSchema,
  StarterPersonaViewSchema,
  StoredTargetViewSchema,
  TargetCheckSchema,
  TargetPromisesSchema,
  pageOf,
  routes,
} from "@populace/contract";
import { PopulaceConfigSchema, expandPopulation, newRunId, type PopulaceConfig, type Store } from "@populace/core";
import { startMockTarget, type RunningMockTarget } from "@populace/mock-target";
import { runWake } from "@populace/runner";
import { ScriptedProvider, call, sequence, type ScriptContext } from "@populace/runner/testing";
import { SqliteStore } from "@populace/store-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "./app.js";
import { ensurePopulation, ensureProject, ensureSettings, redactConfig, resolveProjectConfig, seedProjectFromConfig, snapshotConfig } from "./config-store.js";
import { EventHub, RecordingStore } from "./events.js";
import { JobRunner } from "./jobs.js";
import { RunController } from "./runs.js";
import { STARTER_PERSONAS } from "./starters.js";
import { takeLock, StoreLocked } from "./lock.js";

let target: RunningMockTarget;
beforeEach(async () => {
  target = await startMockTarget({ quiet: true });
});
afterEach(async () => {
  await target.close();
});

function config(): PopulaceConfig {
  return PopulaceConfigSchema.parse({
    target: { name: "Tasklet", mcp: [{ url: target.mcpUrl, bearerToken: "gateway-secret" }], webBaseUrl: target.url, description: "Tasklet keeps your projects and tasks in one place." },
    identity: { strategy: "self-signup", signupTool: "sign_up", tokenPath: "token", userIdPath: "user.id", teardownTool: "delete_account" },
    verifier: { judge: "heuristic" },
    // Fast enough that a run started in a test finishes in one: the cadence is what a run waits
    // on, and the default ten minutes is a property of the config, not of the daemon.
    daemon: { tick: "20ms", concurrency: 2 },
    population: {
      id: "tasklet",
      maxWakes: 2,
      cadence: { every: "20ms", jitter: "0s", initialDelay: "0s" },
      members: [{ persona: { id: "casual-lister", name: "Casey Morgan", role: "a list keeper", backstory: "b", goals: ["keep a list"] } }],
    },
  });
}

interface Harness {
  app: Hono;
  store: Store;
  jobs: JobRunner;
  runs: RunController;
  close(): Promise<void>;
}

/**
 * The M2 app over a real store, wired exactly as `populace serve` wires it — the recording store,
 * the hub, the job queue and the run controller — so what these tests drive is the process, not a
 * hand-assembled subset of it.
 */
async function harness(options: { hasApiKey?: boolean; seed?: boolean } = {}): Promise<Harness> {
  const inner = new SqliteStore(":memory:");
  const hub = new EventHub();
  const store: Store = new RecordingStore(inner, hub.publish);
  const processConfig = { store: { kind: "sqlite" as const, path: ":memory:" }, digestDir: "digests" };
  await ensureProject(store);
  await ensureSettings(store);
  if (options.seed !== false) await seedProjectFromConfig(store, config());

  const provider = new ScriptedProvider(() => ({ calls: [call("done", { summary: "looked around", would_return: true })] }));
  const jobs = new JobRunner(store);
  const runs = new RunController({ store, provider: () => provider });
  const app = createApp({
    store,
    storePath: ":memory:",
    version: "test",
    config: async () => (await resolveProjectConfig(store, processConfig)).config,
    control: {
      store,
      processConfig,
      hasApiKey: () => options.hasApiKey !== false,
      jobs,
      runs,
      hub,
      configForRun: async () => (await resolveProjectConfig(store, processConfig)).config,
      sweep: () => Promise.resolve({ identities: 0, removed: 0, failures: 0, lines: [] }),
    },
  });
  return { app, store, jobs, runs, close: () => inner.close() };
}

// eslint-disable-next-line no-restricted-syntax -- HTTP boundary: every caller parses with a contract schema.
type ResponseBody = unknown;

const json = async (res: Response): Promise<ResponseBody> => {
  expect(res.status, await res.clone().text()).toBeLessThan(400);
  return res.json();
};

const post = async (app: Hono, path: string, body: object = {}): Promise<Response> => app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const put = async (app: Hono, path: string, body: object): Promise<Response> => app.request(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("authoring config into the database", () => {
  it("imports a populace.yaml once and then treats the rows as the truth", async () => {
    const h = await harness();
    const targets = pageOf(StoredTargetViewSchema).parse(await json(await h.app.request(routes.targets)));
    expect(targets.items).toHaveLength(1);
    expect(targets.items[0]?.name).toBe("Tasklet");

    const people = pageOf(PersonaViewSchema).parse(await json(await h.app.request(routes.personas)));
    expect(people.items.map((p) => p.slug)).toEqual(["casual-lister"]);
    expect(people.items[0]?.origin).toBe("imported");
    expect(people.items[0]?.count).toBe(1);

    // A second import must not overwrite work someone has since done in the browser.
    await put(h.app, routes.target_(targets.items[0]!.id), { name: "Renamed in the browser", mcp: [{ name: "default", url: target.mcpUrl }], identity: { strategy: "self-signup", signupTool: "sign_up", tokenPath: "token", emailDomain: "populace.test" } });
    const again = await seedProjectFromConfig(h.store, config());
    expect(again.seeded).toBe(false);
    const after = pageOf(StoredTargetViewSchema).parse(await json(await h.app.request(routes.targets)));
    expect(after.items[0]?.name).toBe("Renamed in the browser");
    await h.close();
  });

  it("never puts a bearer token on the wire, in either direction", async () => {
    const h = await harness();
    const targets = pageOf(StoredTargetViewSchema).parse(await json(await h.app.request(routes.targets)));
    const view = targets.items[0]!;
    expect(view.mcp[0]?.authenticated).toBe(true);
    expect(JSON.stringify(view)).not.toContain("gateway-secret");

    // An update with no token in the body keeps the stored one rather than clearing it.
    await put(h.app, routes.target_(view.id), { name: "Tasklet", mcp: [{ name: "default", url: target.mcpUrl }], identity: view.identity });
    const stored = await h.store.getTarget(view.id);
    expect(stored?.mcp[0]?.bearerToken).toBe("gateway-secret");

    // An explicitly empty one clears it.
    await put(h.app, routes.target_(view.id), { name: "Tasklet", mcp: [{ name: "default", url: target.mcpUrl, bearerToken: "" }], identity: view.identity });
    expect((await h.store.getTarget(view.id))?.mcp[0]?.bearerToken).toBeUndefined();
    await h.close();
  });

  it("keeps a persona's slug immutable when its display name changes, so agent ids survive", async () => {
    const h = await harness();
    const people = pageOf(PersonaViewSchema).parse(await json(await h.app.request(routes.personas)));
    const person = people.items[0]!;
    const renamed = PersonaViewSchema.parse(await json(await put(h.app, routes.persona(person.id), { slug: "something-else", spec: { ...person.spec, name: "Casey Renamed" } })));
    expect(renamed.spec.name).toBe("Casey Renamed");
    expect(renamed.slug).toBe("casual-lister");
    // The id the runner builds agent ids from follows the slug, not the display name.
    expect(renamed.spec.id).toBe("casual-lister");
    const resolved = await resolveProjectConfig(h.store, { store: { kind: "sqlite", path: ":memory:" }, digestDir: "digests" });
    expect(resolved.config.population.members[0]?.persona.id).toBe("casual-lister");
    await h.close();
  });

  it("adds a starter and counts them into the population", async () => {
    const h = await harness({ seed: false });
    const starters = pageOf(StarterPersonaViewSchema).parse(await json(await h.app.request(routes.personaStarters)));
    expect(starters.items).toHaveLength(STARTER_PERSONAS.length);
    expect(starters.items.map((s) => s.slug)).toContain("the-one-who-left");

    const added = PersonaViewSchema.parse(await json(await post(h.app, routes.personaStarters, { slug: "first-timer", count: 2 })));
    expect(added.origin).toBe("starter");
    expect(added.count).toBe(2);
    const population = PopulationViewSchema.parse(await json(await h.app.request(routes.population)));
    expect(population.members).toHaveLength(1);
    expect(population.members[0]?.count).toBe(2);

    // A count of zero leaves the person written down but out of the run.
    await put(h.app, routes.population, { members: [{ personaId: added.id, count: 0 }] });
    expect(PopulationViewSchema.parse(await json(await h.app.request(routes.population))).members).toHaveLength(0);
    expect(pageOf(PersonaViewSchema).parse(await json(await h.app.request(routes.personas))).items).toHaveLength(1);
    await h.close();
  });

  it("never drops the api key when settings are saved from a form that cannot see it", async () => {
    const h = await harness();
    await h.store.saveSettings({ ...(await ensureSettings(h.store)), model: { ...(await ensureSettings(h.store)).model, apiKey: "sk-not-in-any-form" }, updatedAt: new Date().toISOString() });
    const view = SettingsViewSchema.parse(await json(await put(h.app, routes.settings, { guardrails: { dailyUsd: 12 } })));
    expect(view.guardrails.dailyUsd).toBe(12);
    expect(JSON.stringify(view)).not.toContain("sk-not-in-any-form");
    expect((await h.store.getSettings("default"))?.model.apiKey).toBe("sk-not-in-any-form");
    // A partial guardrail update leaves the nested ceilings it did not mention alone.
    expect(view.guardrails.perWake.maxTurns).toBe(40);
    await h.close();
  });
});

describe("what the connect wizard reads off a live target", () => {
  it("lists the tools, names the undescribed ones and guesses the identity tools", async () => {
    const h = await harness();
    const targets = pageOf(StoredTargetViewSchema).parse(await json(await h.app.request(routes.targets)));
    const check = TargetCheckSchema.parse(await json(await post(h.app, routes.targetCheck(targets.items[0]!.id))));
    expect(check.ok).toBe(true);
    expect(check.tools.map((t) => t.name)).toContain("create_task");
    expect(check.latencyMs).not.toBeNull();
    expect(check.identity.signupTool).toBe("sign_up");
    expect(check.identity.teardownTool).toBe("delete_account");
    expect(check.identity.because.join(" ")).toContain("sign_up");
    await h.close();
  });

  it("says so rather than failing when the target is not there", async () => {
    const h = await harness();
    const check = TargetCheckSchema.parse(await json(await post(h.app, `${routes.targets}/check`, { mcp: [{ name: "default", url: "http://127.0.0.1:1/mcp" }] })));
    expect(check.ok).toBe(false);
    expect(check.errors).toHaveLength(1);
    expect(check.tools).toHaveLength(0);
    await h.close();
  });

  it("finds the promise the reference app makes and does not keep", async () => {
    const h = await harness();
    const targets = pageOf(StoredTargetViewSchema).parse(await json(await h.app.request(routes.targets)));
    const promises = TargetPromisesSchema.parse(await json(await h.app.request(routes.targetPromises(targets.items[0]!.id))));
    expect(promises.fetched).toBe(true);
    // Tasklet's copy promises deleting tasks and exposes no tool that does it — the pre-run
    // version of the coverage gap the population finds afterwards.
    expect(promises.promises.some((p) => !p.kept && /delete/i.test(p.text))).toBe(true);
    await h.close();
  });
});

describe("starting, steering and watching a run", () => {
  it("refuses to start without an api key, a target or anybody to send", async () => {
    const none = await harness({ seed: false });
    const empty = SetupStatusSchema.parse(await json(await none.app.request(routes.setup)));
    expect(empty.ready).toBe(false);
    expect(empty.blockers.join(" ")).toContain("Connect a target");
    expect((await post(none.app, routes.runs)).status).toBe(409);
    await none.close();

    const keyless = await harness({ hasApiKey: false });
    const status = SetupStatusSchema.parse(await json(await keyless.app.request(routes.setup)));
    expect(status.ready).toBe(false);
    expect(status.blockers.join(" ")).toContain("ANTHROPIC_API_KEY");
    expect((await post(keyless.app, routes.runs)).status).toBe(503);
    await keyless.close();
  });

  it("estimates without spending anything, and says which basis it used", async () => {
    const h = await harness();
    const first = RunEstimateSchema.parse(await json(await post(h.app, routes.runsEstimate)));
    expect(first.basis).toBe("default");
    expect(first.agents).toBe(1);
    expect(first.visits).toBe(2); // one person, maxWakes 2
    expect(first.bounded).toBe(true);
    expect(first.expectedUsd).toBeGreaterThan(0);
    expect(first.stops.dailyUsd).toBe(50);
    // Nothing was started by asking.
    expect(await h.store.listRuns()).toHaveLength(0);
    expect(await h.store.listWakes({})).toHaveLength(0);

    await realRun(h.store);
    const second = RunEstimateSchema.parse(await json(await post(h.app, routes.runsEstimate)));
    expect(second.basis).toBe("history");
    expect(second.sampleSize).toBeGreaterThan(0);
    await h.close();
  });

  it("runs a population from the browser and settles the run row when it is done", async () => {
    const h = await harness();
    const started = await json(await post(h.app, routes.runs, { label: "from the browser" }));
    const runId = (started as { runId: string }).runId;
    expect(runId).toMatch(/^run_/);
    await h.jobs.idle();
    await h.runs.settled(runId);

    const run = await h.store.getRun(runId);
    expect(run?.label).toBe("from the browser");
    expect(run?.status).toBe("completed");
    expect(run?.targetId).not.toBe("");

    // The config it executed is frozen, and its credentials are not in the frozen copy.
    const snapshot = await h.store.getConfigSnapshot(run!.configSnapshotId);
    expect(snapshot?.config.population.members[0]?.persona.id).toBe("casual-lister");
    expect(snapshot?.redacted).toContain("target.mcp.default.bearerToken");
    expect(JSON.stringify(snapshot)).not.toContain("gateway-secret");

    const wakes = await h.store.listWakes({ runIds: [runId] });
    expect(wakes.length).toBeGreaterThan(0);
    await h.close();
  });

  it("writes an event log the run screen can be rebuilt from", async () => {
    const h = await harness();
    const started = await json(await post(h.app, routes.runs));
    const runId = (started as { runId: string }).runId;
    await h.jobs.idle();
    await h.runs.settled(runId);

    const events = await h.store.listEvents({ runId, limit: 500 });
    const types = new Set(events.map((e) => e.type));
    expect(types).toContain("run.started");
    expect(types).toContain("wake.started");
    expect(types).toContain("wake.ended");
    expect(types).toContain("run.ended");
    // The cursor is monotonic across the whole store, which is what makes a resume a resume.
    expect(events.map((e) => e.seq)).toEqual([...events].sort((a, b) => a.seq - b.seq).map((e) => e.seq));
    expect(await h.store.latestEventSeq()).toBeGreaterThanOrEqual(events[events.length - 1]!.seq);

    const after = events[0]!.seq;
    const resumed = await h.store.listEvents({ runId, afterSeq: after });
    expect(resumed.every((e) => e.seq > after)).toBe(true);

    const live = RunLiveSchema.parse(await json(await h.app.request(routes.runLive(runId))));
    expect(live.runId).toBe(runId);
    expect(live.agents).toHaveLength(1);
    expect(live.visitsDone).toBeGreaterThan(0);
    expect(live.cursor).toBeGreaterThan(0);
    await h.close();
  });

  it("stops a run that is not going, and refuses a round for one", async () => {
    const h = await harness();
    const started = await json(await post(h.app, routes.runs));
    const runId = (started as { runId: string }).runId;
    await h.jobs.idle();
    await h.runs.settled(runId);
    expect((await post(h.app, routes.runRound(runId))).status).toBe(409);
    const stopped = await post(h.app, routes.runStop(runId), { mode: "drain" });
    expect(stopped.status).toBe(200);
    await h.close();
  });

  it("will not start anything while everything is stopped", async () => {
    const h = await harness();
    await post(h.app, routes.killSwitch, { engaged: true, reason: "testing" });
    const status = SetupStatusSchema.parse(await json(await h.app.request(routes.setup)));
    expect(status.ready).toBe(false);
    expect(status.killSwitch.engaged).toBe(true);
    expect((await post(h.app, routes.runs)).status).toBe(409);

    await post(h.app, routes.killSwitch, { engaged: false });
    expect(SetupStatusSchema.parse(await json(await h.app.request(routes.setup))).ready).toBe(true);
    await h.close();
  });

  it("carries a run on, and reports the job that is doing it", async () => {
    const h = await harness();
    const first = await json(await post(h.app, routes.runs));
    const parent = (first as { runId: string }).runId;
    await h.jobs.idle();
    await h.runs.settled(parent);

    const second = await json(await post(h.app, routes.runContinue(parent), { continuationReason: "after the fix" }));
    const child = (second as { runId: string; jobId: string }).runId;
    await h.jobs.idle();
    await h.runs.settled(child);
    const run = await h.store.getRun(child);
    expect(run?.parentRunId).toBe(parent);
    expect(run?.continuation?.reason).toBe("after the fix");
    expect(run?.continuation?.carriedAgents).toBeGreaterThan(0);

    const job = JobViewSchema.parse(await json(await h.app.request(routes.job((second as { jobId: string }).jobId))));
    expect(job.kind).toBe("run.continue");
    expect(job.status).toBe("succeeded");

    expect((await post(h.app, routes.runContinue("run_nope_abcdef"))).status).toBe(404);
    await h.close();
  });
});

describe("the store underneath", () => {
  it("dedupes identical config snapshots and redacts what it stores", async () => {
    const h = await harness();
    const cfg = config();
    const one = await snapshotConfig(h.store, cfg);
    const two = await snapshotConfig(h.store, cfg);
    expect(two.id).toBe(one.id);
    expect(one.config.target.mcp[0]?.bearerToken).toBe("[redacted]");
    expect(redactConfig(cfg).redacted).toContain("target.mcp.default.bearerToken");
    // Key order must not change the hash, or two identical configs would make two rows.
    const reordered = { ...cfg, population: cfg.population, target: cfg.target };
    expect((await snapshotConfig(h.store, reordered)).id).toBe(one.id);
    await h.close();
  });

  it("keeps a run whose process died out of the running list", async () => {
    const h = await harness();
    const population = await ensurePopulation(h.store);
    await h.store.saveRun({
      id: newRunId(),
      projectId: "default",
      targetId: "t",
      populationId: population.slug,
      label: "abandoned",
      status: "running",
      configSnapshotId: "",
      parentRunId: null,
      continuation: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
      totals: { agents: 0, activeAgents: 0, wakes: 0, findings: 0, confirmed: 0, costUsd: 0 },
    });
    expect(await h.runs.reconcileOrphans()).toBe(1);
    const [run] = await h.store.listRuns();
    expect(run?.status).toBe("failed");
    expect(run?.endedAt).not.toBeNull();
    await h.close();
  });

  it("lets one process hold the store and tells the second one who has it", async () => {
    const store = new SqliteStore(":memory:");
    const held = await takeLock(store);
    expect(held.pid).toBe(process.pid);
    // The holder is this very process, so it is alive and the lock stands.
    await expect(takeLock(store)).rejects.toBeInstanceOf(StoreLocked);
    // `--force` takes it over.
    expect((await takeLock(store, { force: true })).pid).toBe(process.pid);
    await store.close();
  });
});

/** One real wake, so the estimator has priced history to read. */
async function realRun(store: Store): Promise<void> {
  const cfg = config();
  const runId = newRunId();
  const identityProvider = new SelfSignupProvider(cfg.identity as never);
  const provider = new ScriptedProvider(
    sequence([
      (ctx: ScriptContext) => {
        const s = /email (\S+), display name "([^"]+)", password (\S+)/.exec(ctx.wakeContext);
        if (!s) throw new Error("no signup suggestion");
        return { calls: [call("sign_up", { email: s[1]!, displayName: s[2]!, password: s[3]! })] };
      },
      () => ({ calls: [call("done", { summary: "had a look", would_return: true })] }),
    ]),
  );
  for (const { agent } of expandPopulation(cfg.population, runId)) {
    await runWake({ agent, config: cfg }, { store, provider, identityProvider });
  }
}

import { SelfSignupProvider } from "@populace/adapters/self-signup";
import {
  ConfigExportSchema,
  ConfigImportResultSchema,
  ConfigRevisionDetailSchema,
  ConfigRevisionViewSchema,
  JobViewSchema,
  PersonaPreviewSchema,
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
import { PopulaceConfigSchema, expandPopulation, instantiatePersona, newRevisionId, newRunId, tagForRun, type ConfigRevision, type PopulaceConfig, type Store } from "@populace/core";
import { startMockTarget, type RunningMockTarget } from "@populace/mock-target";
import { personaSystemPrompt, runWake } from "@populace/runner";
import { ScriptedProvider, call, sequence, type ScriptContext } from "@populace/runner/testing";
import { SqliteStore } from "@populace/store-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "./app.js";
import { ensurePopulation, ensureProject, ensureSettings, redactConfig, resolveProjectConfig, seedProjectFromConfig, snapshotConfig, withLiveCredentials } from "./config-store.js";
import { EventHub, RecordingStore } from "./events.js";
import { captureAuthored } from "./history.js";
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
  /** The config a run executed, credentials and all — what `serve` hands the verifier and sweep. */
  configForRun(runId: string): Promise<PopulaceConfig>;
  close(): Promise<void>;
}

/**
 * The M2 app over a real store, wired exactly as `populace serve` wires it — the recording store,
 * the hub, the job queue and the run controller — so what these tests drive is the process, not a
 * hand-assembled subset of it.
 */
async function harness(options: { hasApiKey?: boolean; seed?: boolean; config?: PopulaceConfig; script?: ConstructorParameters<typeof ScriptedProvider>[0] } = {}): Promise<Harness> {
  const inner = new SqliteStore(":memory:");
  const hub = new EventHub();
  const store: Store = new RecordingStore(inner, hub.publish);
  const processConfig = { store: { kind: "sqlite" as const, path: ":memory:" }, digestDir: "digests" };
  await ensureProject(store);
  await ensureSettings(store);
  if (options.seed !== false) await seedProjectFromConfig(store, options.config ?? config());

  const provider = new ScriptedProvider(options.script ?? (() => ({ calls: [call("done", { summary: "looked around", would_return: true })] })));
  const jobs = new JobRunner(store);
  const runs = new RunController({ store, provider: () => provider });
  /**
   * Exactly what `serve` wires (`serve.ts`): the snapshot is the record of what ran and carries
   * no credential, so the live one goes back in before this config reaches anything that opens a
   * connection with it.
   */
  const configForRun = async (runId: string): Promise<PopulaceConfig> => {
    const run = await store.getRun(runId);
    const snapshot = run?.configSnapshotId ? await store.getConfigSnapshot(run.configSnapshotId) : undefined;
    if (snapshot) return withLiveCredentials(store, snapshot.config);
    return (await resolveProjectConfig(store, processConfig)).config;
  };
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
      configForRun,
      sweep: () => Promise.resolve({ identities: 0, removed: 0, failures: 0, lines: [] }),
    },
  });
  return { app, store, jobs, runs, configForRun, close: () => inner.close() };
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

describe("writing a person", () => {
  it("previews the very prompt the runner assembles, not a description of it", async () => {
    const h = await harness();
    const people = pageOf(PersonaViewSchema).parse(await json(await h.app.request(routes.personas)));
    const person = people.items[0]!;
    const preview = PersonaPreviewSchema.parse(await json(await post(h.app, routes.personaPreview(person.id))));

    // The assertion that matters: the panel is the runner's own function over the same inputs, so
    // a change to the prompt cannot drift away from what the editor shows.
    const population = await ensurePopulation(h.store);
    const expected = personaSystemPrompt(instantiatePersona(person.spec, `${population.seed}:${person.slug}:0`), config().target);
    expect(preview.systemPrompt).toBe(expected);
    expect(preview.slug).toBe("casual-lister");
    expect(preview.agentId).toBe(`${population.slug}/casual-lister#1`);
    expect(preview.target.configured).toBe(true);
    expect(preview.model.inherited).toBe(true);
    await h.close();
  });

  it("follows the draft being typed rather than what is saved", async () => {
    const h = await harness();
    const people = pageOf(PersonaViewSchema).parse(await json(await h.app.request(routes.personas)));
    const person = people.items[0]!;
    const { id: _id, ...spec } = person.spec;
    const preview = PersonaPreviewSchema.parse(await json(await post(h.app, routes.personaPreview(person.id), { spec: { ...spec, name: "Not Yet Saved", goals: ["buy a hat"] } })));
    expect(preview.systemPrompt).toContain("Not Yet Saved");
    expect(preview.systemPrompt).toContain("buy a hat");
    // Previewing writes nothing.
    expect((await h.store.getPersona(person.id))?.spec.name).toBe("Casey Morgan");
    await h.close();
  });

  it("copies a person under a new id and leaves the copy at home", async () => {
    const h = await harness();
    const people = pageOf(PersonaViewSchema).parse(await json(await h.app.request(routes.personas)));
    const copy = PersonaViewSchema.parse(await json(await post(h.app, routes.personaDuplicate(people.items[0]!.id))));
    expect(copy.slug).toBe("casual-lister-2");
    expect(copy.spec.id).toBe("casual-lister-2");
    expect(copy.count).toBe(0);
    // The original is untouched, which is the point of copying rather than editing.
    expect((await h.store.getPersona(people.items[0]!.id))?.spec.name).toBe("Casey Morgan");
    await h.close();
  });
});

describe("the config file", () => {
  it("exports without a secret in it and imports the same file back", async () => {
    const h = await harness();
    const exported = ConfigExportSchema.parse(await json(await h.app.request(routes.configExport)));
    expect(exported.yaml).not.toContain("gateway-secret");
    expect(exported.yaml).toContain("${POPULACE_DEFAULT_TOKEN}");
    expect(exported.placeholders.join(" ")).toContain("bearer token");

    const before = (await resolveProjectConfig(h.store, { store: { kind: "sqlite", path: ":memory:" }, digestDir: "digests" })).config;
    const result = ConfigImportResultSchema.parse(await json(await post(h.app, routes.configImport, { yaml: exported.yaml, apply: true })));
    expect(result.applied).toBe(true);
    expect(result.missingEnv).toContain("POPULACE_DEFAULT_TOKEN");

    const after = (await resolveProjectConfig(h.store, { store: { kind: "sqlite", path: ":memory:" }, digestDir: "digests" })).config;
    // Lossless: both ends are the same zod schema, so a round trip changes nothing — and the
    // credential the file deliberately does not carry is still the one that was stored.
    expect(after).toEqual(before);
    expect(after.target.mcp[0]?.bearerToken).toBe("gateway-secret");
    await h.close();
  });

  it("says what a file would do before it does any of it", async () => {
    const h = await harness();
    const exported = ConfigExportSchema.parse(await json(await h.app.request(routes.configExport)));
    const yaml = exported.yaml.replace("name: Tasklet", "name: Something Else");
    const dry = ConfigImportResultSchema.parse(await json(await post(h.app, routes.configImport, { yaml, apply: false })));
    expect(dry.applied).toBe(false);
    expect(dry.targetName).toBe("Something Else");
    expect(dry.lines.join(" ")).toContain("Casey Morgan");
    // Nothing was written.
    expect((await h.store.listTargets("default"))[0]?.name).toBe("Tasklet");
    await h.close();
  });

  it("refuses a file it cannot read whole, rather than importing part of it", async () => {
    const h = await harness();
    const referenced = await post(h.app, routes.configImport, {
      yaml: "version: 1\ntarget:\n  name: Tasklet\n  mcp:\n    - url: http://127.0.0.1:1/\nidentity:\n  strategy: self-signup\n  signupTool: sign_up\npopulation:\n  id: p\n  members:\n    - persona: ./someone.yaml\n",
      apply: true,
    });
    expect(referenced.status).toBe(400);
    expect(await referenced.text()).toContain("another file");
    expect((await post(h.app, routes.configImport, { yaml: "nonsense: true", apply: true })).status).toBe(400);
    await h.close();
  });
});

describe("the history of the config", () => {
  it("records an undo point around every edit, and puts one back", async () => {
    const h = await harness();
    const people = pageOf(PersonaViewSchema).parse(await json(await h.app.request(routes.personas)));
    const person = people.items[0]!;
    const { id: _id, ...spec } = person.spec;
    await put(h.app, routes.persona(person.id), { spec: { ...spec, name: "Casey Renamed" } });

    const history = pageOf(ConfigRevisionViewSchema).parse(await json(await h.app.request(routes.configHistory)));
    // Newest first: the rename, and under it where the project started.
    expect(history.items[0]?.summary).toBe("renamed Casey Morgan to Casey Renamed");
    expect(history.items[0]?.current).toBe(true);
    expect(history.items[0]?.personaCount).toBe(1);
    const baseline = history.items.find((r) => r.source === "baseline");
    expect(baseline).toBeDefined();

    const detail = ConfigRevisionDetailSchema.parse(await json(await h.app.request(routes.configRevision(baseline!.id))));
    expect(detail.renderable).toBe(true);
    expect(detail.yaml).toContain("Casey Morgan");
    expect(detail.yaml).not.toContain("gateway-secret");

    await post(h.app, routes.configRestore(baseline!.id));
    expect((await h.store.getPersona(person.id))?.spec.name).toBe("Casey Morgan");
    // A restore is itself an edit, so the rename is still in the history to go forward to.
    const after = pageOf(ConfigRevisionViewSchema).parse(await json(await h.app.request(routes.configHistory)));
    expect(after.items[0]?.source).toBe("restore");
    expect(after.items.some((r) => r.summary === "renamed Casey Morgan to Casey Renamed")).toBe(true);
    await h.close();
  });

  it("puts a deleted person back, rather than only adding what is missing", async () => {
    const h = await harness();
    const people = pageOf(PersonaViewSchema).parse(await json(await h.app.request(routes.personas)));
    await post(h.app, routes.personaStarters, { slug: "first-timer", count: 1 });
    const withStarter = pageOf(ConfigRevisionViewSchema).parse(await json(await h.app.request(routes.configHistory)));
    expect(withStarter.items[0]?.personaCount).toBe(2);

    await h.app.request(routes.persona(people.items[0]!.id), { method: "DELETE" });
    expect((await h.store.listPersonas("default"))).toHaveLength(1);

    await post(h.app, routes.configRestore(withStarter.items[0]!.id));
    expect((await h.store.listPersonas("default")).map((p) => p.slug).sort()).toEqual(["casual-lister", "first-timer"]);
    await h.close();
  });
});

describe("what the review of the first slice turned up", () => {
  it("hands the live credential to anything that reconnects, while the snapshot keeps none", async () => {
    const h = await harness();
    const started = await json(await post(h.app, routes.runs));
    const runId = (started as { runId: string }).runId;
    await h.jobs.idle();
    await h.runs.settled(runId);

    const snapshot = await h.store.getConfigSnapshot((await h.store.getRun(runId))!.configSnapshotId);
    expect(snapshot?.config.target.mcp[0]?.bearerToken).toBe("[redacted]");

    // The verifier's replay and sweep both go through this, and both open an MCP session with it.
    const forRun = await h.configForRun(runId);
    expect(forRun.target.mcp[0]?.bearerToken).toBe("gateway-secret");

    // A credential that is genuinely gone fails loudly rather than connecting with a placeholder.
    for (const target of await h.store.listTargets("default")) await h.store.deleteTarget(target.id);
    await expect(h.configForRun(runId)).rejects.toThrow(/not in this project's target/);
    await h.close();
  });

  it("stamps the run id on every event, including the ones only a wake knows about", async () => {
    const h = await harness({
      script: sequence([() => ({ calls: [call("no_such_tool", {})] }), () => ({ calls: [call("done", { summary: "gave up on that", would_return: false })] })]),
    });
    const started = await json(await post(h.app, routes.runs));
    const runId = (started as { runId: string }).runId;
    await h.jobs.idle();
    await h.runs.settled(runId);

    // Both ends of the live stream filter on the run, and SQL excludes NULL, so an event written
    // without a run id is one no browser can ever see.
    const events = await h.store.listEvents({ runId, limit: 500 });
    const types = new Set(events.map((e) => e.type));
    expect(types).toContain("guardrail.tripped");
    expect(types).toContain("trace.appended");
    expect(events.every((e) => e.runId === runId)).toBe(true);
    await h.close();
  });

  it("refuses a second run while one is going, because stopping is global", async () => {
    // A five-second cadence keeps the first run in flight while the second is refused; the run is
    // drained at the end rather than waited out.
    const slow = PopulaceConfigSchema.parse({ ...config(), population: { ...config().population, maxWakes: 3, cadence: { every: "5s", jitter: "0s", initialDelay: "0s" } } });
    const h = await harness({ config: slow });
    const started = await json(await post(h.app, routes.runs));
    const runId = (started as { runId: string }).runId;
    expect(h.runs.runningIds).toContain(runId);

    const second = await post(h.app, routes.runs);
    expect(second.status).toBe(409);
    expect(await second.text()).toContain("already going");

    await h.runs.stop(runId, "drain");
    await h.jobs.idle();
    await h.close();
  });

  it("reads only the recent visits it needs to price the next run", async () => {
    const h = await harness();
    await realRun(h.store);
    const all = await h.store.listWakes({});
    expect(all.length).toBeGreaterThan(0);
    // The estimator asks for a bounded window with an order the store promises, rather than
    // loading every wake this machine has ever recorded and slicing the end off it.
    const recent = await h.store.listWakes({ limit: 1 });
    expect(recent).toHaveLength(1);
    expect(recent[0]?.id).toBe(all[all.length - 1]?.id);
    await h.close();
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

describe("what the review of this slice turned up", () => {
  it("will not let a target go while a run still has accounts to clean up on it", async () => {
    const h = await harness();
    const started = await json(await post(h.app, routes.runs));
    const runId = (started as { runId: string }).runId;
    await h.jobs.idle();
    await h.runs.settled(runId);

    const target = (await h.store.listTargets("default"))[0]!;
    await h.store.saveIdentity({
      id: "id_1",
      runId,
      tag: tagForRun(runId),
      agentId: "tasklet/casual-lister#0",
      personaId: "casual-lister",
      strategy: "self-signup",
      credential: { bearerToken: "their-token", email: "casey@example.com", extra: {} },
      createdAt: new Date().toISOString(),
      tornDownAt: null,
    });

    // Sweep reads the credential out of this row and nowhere else, so deleting it would strand a
    // real account on someone's product with no way back.
    const refused = await h.app.request(routes.target_(target.id), { method: "DELETE" });
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("still has accounts");

    // The same is true of a revision that predates the target: restoring it keeps the row rather
    // than dropping the credential the run's accounts are behind.
    const before: ConfigRevision = {
      id: newRevisionId(),
      projectId: "default",
      at: new Date().toISOString(),
      summary: "before there was a target",
      source: "baseline",
      document: { ...(await captureAuthored(h.store, "default")), targets: [] },
    };
    await h.store.saveConfigRevision(before);
    await json(await post(h.app, routes.configRestore(before.id)));
    expect((await h.store.listTargets("default")).map((t) => t.id)).toContain(target.id);

    // Once the accounts are gone the target is free to go.
    await h.store.markIdentityTornDown("id_1", new Date());
    expect((await h.app.request(routes.target_(target.id), { method: "DELETE" })).status).toBe(204);
    await h.close();
  });

  it("hands on no api key at all rather than a redacted one that would 401", async () => {
    const withKey = PopulaceConfigSchema.parse({ ...config(), model: { ...config().model, apiKey: "sk-ant-not-a-real-key" } });
    const h = await harness({ config: withKey });
    const started = await json(await post(h.app, routes.runs));
    const runId = (started as { runId: string }).runId;
    await h.jobs.idle();
    await h.runs.settled(runId);

    const snapshot = await h.store.getConfigSnapshot((await h.store.getRun(runId))!.configSnapshotId);
    expect(snapshot?.config.model.apiKey).toBe("[redacted]");
    // A provider built from this would send "[redacted]" as a key and get a 401 that reads like a
    // model outage. Absent falls back to the environment, which is where the key comes from anyway.
    expect((await h.configForRun(runId)).model.apiKey).toBeUndefined();
    await h.close();
  });

  it("refuses to carry a run on while another one is going, not only to start a fresh one", async () => {
    const slow = PopulaceConfigSchema.parse({ ...config(), population: { ...config().population, maxWakes: 3, cadence: { every: "5s", jitter: "0s", initialDelay: "0s" } } });
    const h = await harness({ config: slow });
    const first = await json(await post(h.app, routes.runs));
    const runId = (first as { runId: string }).runId;

    const continued = await post(h.app, routes.runContinue(runId));
    expect(continued.status).toBe(409);
    expect(await continued.text()).toContain("already going");

    await h.runs.stop(runId, "drain");
    await h.jobs.idle();
    await h.close();
  });
});

import { SelfSignupProvider } from "@populace/adapters/self-signup";
import {
  ClusterDetailViewSchema,
  CohortViewSchema,
  EventSchema,
  JobViewSchema,
  ParticipantDetailViewSchema,
  ParticipantSummaryViewSchema,
  PersonViewSchema,
  PreflightViewSchema,
  ProjectOverviewViewSchema,
  ProjectSummaryViewSchema,
  PersonaViewSchema,
  PopulationViewSchema,
  RunEstimateSchema,
  RunLiveSchema,
  RunSummarySchema,
  ExecutionCompareViewSchema,
  SimulationResultsViewSchema,
  TriageViewSchema,
  SettingsViewSchema,
  SetupStatusSchema,
  StarterPersonaViewSchema,
  FirstContactSchema,
  SimulationSummaryViewSchema,
  StoredTargetViewSchema,
  TargetCheckSchema,
  TargetPromisesSchema,
  pageOf,
  routes,
} from "@populace/contract";
import { CadenceSchema, PopulaceConfigSchema, expandPopulation, newCohortId, newRunId, newTargetId, signatureOf, tagForRun, type Cohort, type PopulaceConfig, type Simulation, type Store } from "@populace/core";
import { startMockTarget, type RunningMockTarget } from "@populace/mock-target";
import { primaryTool } from "@populace/reports";
import { runWake } from "@populace/runner";
import { ScriptedProvider, call, sequence, type ScriptContext, type ScriptPolicy } from "@populace/runner/testing";
import { SqliteStore } from "@populace/store-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "./app.js";
import {
  cohortsOf,
  createSimulation,
  setCohortSize,
  ensurePopulation,
  ensureProject,
  ensureSettings,
  ensureSimulation,
  redactConfig,
  resolveSimulationConfig,
  seedProjectFromConfig,
  snapshotConfig,
  withLiveSecrets,
  type ResolvedSimulation,
} from "./config-store.js";
import { ensureRoster } from "./cohort-store.js";
import { resetTarget } from "./target-reset.js";
import { EventHub, RecordingStore } from "./events.js";
import { JobRunner } from "./jobs.js";
import { RunController } from "./runs.js";
import { startServer } from "./serve.js";
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
  /** Every store method this harness's app has called, in order. */
  calls: string[];
  resetCalls(): void;
  close(): Promise<void>;
}

/**
 * A store that records every call made through it.
 *
 * This is how "one screen is a bounded number of queries" is asserted rather than assumed. The old
 * population screen fired one memory read per participant on a five-second poll, and nothing in
 * the test suite could have noticed.
 */
function counting(inner: Store): { store: Store; calls: string[] } {
  const calls: string[] = [];
  const store = new Proxy(inner, {
    get(target, prop) {
      // eslint-disable-next-line no-restricted-syntax -- reflection over the Store interface; the proxy hands back exactly what the method returns.
      const value = Reflect.get(target, prop) as unknown;
      if (typeof value !== "function") return value;
      // eslint-disable-next-line no-restricted-syntax -- same boundary: the return value is passed straight back to the caller, which types it.
      const fn = value as (...args: never[]) => unknown;
      return (...args: never[]) => {
        calls.push(String(prop));
        return fn.apply(target, args);
      };
    },
  });
  return { store, calls };
}

const processConfig = { store: { kind: "sqlite" as const, path: ":memory:" }, digestDir: "digests" };

/** The project's simulation, resolved. Every run in this file goes through this one path. */
async function resolveProject(store: Store): Promise<ResolvedSimulation> {
  const simulation = await ensureSimulation(store);
  return resolveSimulationConfig(store, processConfig, simulation.id);
}

/**
 * The M2 app over a real store, wired exactly as `populace serve` wires it — the recording store,
 * the hub, the job queue and the run controller — so what these tests drive is the process, not a
 * hand-assembled subset of it.
 */
async function harness(options: { hasApiKey?: boolean; seed?: boolean; policy?: ScriptPolicy; writesPeople?: boolean } = {}): Promise<Harness> {
  const inner = new SqliteStore(":memory:");
  const hub = new EventHub();
  const counted = counting(new RecordingStore(inner, hub.publish));
  const store: Store = counted.store;
  await ensureProject(store);
  await ensureSettings(store);
  if (options.seed !== false) await seedProjectFromConfig(store, config());

  const provider = new ScriptedProvider(options.policy ?? (() => ({ calls: [call("done", { summary: "looked around", would_return: true })] })));
  const jobs = new JobRunner(store);
  const runs = new RunController({
    store,
    provider: () => provider,
    resolve: async (simulationId: string) => (await resolveSimulationConfig(store, processConfig, simulationId)).config,
  });
  const app = createApp({
    store,
    storePath: ":memory:",
    version: "test",
    configForRun: async () => (await resolveProject(store)).config,
    control: {
      store,
      processConfig,
      hasApiKey: () => options.hasApiKey !== false,
      // Only where a test is about tier-2 person generation: given a provider, `people.generate`
      // calls the model instead of leaving the seeded cast alone, and every other test in this
      // file is about something else.
      ...(options.writesPeople ? { provider: (): ScriptedProvider => provider } : {}),
      jobs,
      runs,
      hub,
      configForRun: async () => (await resolveProject(store)).config,
      sweep: () => Promise.resolve({ identities: 0, removed: 0, preExisting: 0, stranded: 0, failures: 0, lines: [] }),
    },
  });
  return {
    app,
    store,
    jobs,
    runs,
    calls: counted.calls,
    resetCalls: () => {
      counted.calls.length = 0;
    },
    close: () => inner.close(),
  };
}

// eslint-disable-next-line no-restricted-syntax -- HTTP boundary: every caller parses with a contract schema.
type ResponseBody = unknown;

const json = async (res: Response): Promise<ResponseBody> => {
  expect(res.status, await res.clone().text()).toBeLessThan(400);
  return res.json();
};

/** Every test in this file works inside one project; the path segment is what says which. */
const P = "default";

/** The project's default population, as a path. Composition is project-scoped, not global. */
const populationRoute = async (h: Harness): Promise<string> => routes.population_(P, (await ensurePopulation(h.store)).id);

/** A run belongs to a SIMULATION now: "start a run" is "run this simulation once more". */
const runsRoute = async (h: Harness): Promise<string> => routes.simulationRuns(P, (await ensureSimulation(h.store)).id);
const estimateRoute = async (h: Harness): Promise<string> => routes.simulationEstimate(P, (await ensureSimulation(h.store)).id);

/**
 * Reads what an SSE endpoint replays and then lets go. The stream never ends by itself — it sits
 * waiting for the next event — so this stops at the first quiet moment rather than on `done`.
 */
const sse = async (app: Hono, path: string, quietMs = 120): Promise<string> => {
  const res = await app.request(path);
  const body = res.body;
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const chunk = await Promise.race([reader.read(), new Promise<{ done: boolean; value?: Uint8Array }>((done) => setTimeout(() => done({ done: true }), quietMs))]);
    if (chunk.done || chunk.value === undefined) break;
    text += decoder.decode(chunk.value);
  }
  await reader.cancel();
  return text;
};

/** Files something, so there is a cluster to read and a quote to attribute. */
const complains: ScriptPolicy = sequence([
  () => ({ calls: [call("list_tasks", {})] }),
  (ctx: ScriptContext) => ({
    calls: [
      call("file_finding", {
        kind: "bug",
        title: "list_tasks pages badly",
        description: "The second page repeats the last row of the first.",
        expected: "Each task appears once.",
        observed: "One task appeared twice.",
        severity: "high",
        confidence: 0.9,
        tool: "list_tasks",
        evidence_calls: [ctx.lastResults[0]?.ref ?? ""],
      }),
    ],
  }),
  () => ({ calls: [call("done", { summary: "had a look", would_return: true })] }),
]);

/** Files something without naming a tool, which the reporter allows: `tool` is optional. */
const complainsWithoutTool: ScriptPolicy = sequence([
  () => ({ calls: [call("list_tasks", {})] }),
  (ctx: ScriptContext) => ({
    calls: [
      call("file_finding", {
        kind: "bug",
        title: "the second page repeats a row from the first",
        description: "Paging is off by one.",
        expected: "Each task appears once.",
        observed: "One task appeared twice.",
        severity: "high",
        confidence: 0.9,
        // The reporter asks for a tool or an explicit null, and null is a real answer: a lot of
        // findings are about the product rather than about one tool.
        tool: null,
        evidence_calls: [ctx.lastResults[0]?.ref ?? ""],
      }),
    ],
  }),
  () => ({ calls: [call("done", { summary: "had a look", would_return: true })] }),
]);

const post = async (app: Hono, path: string, body: object = {}): Promise<Response> => app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const memberSlugs = async (h: Harness): Promise<string[]> => PopulationViewSchema.parse(await json(await h.app.request(await populationRoute(h)))).members.map((m) => m.slug);
const put = async (app: Hono, path: string, body: object): Promise<Response> => app.request(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("authoring config into the database", () => {
  it("imports a populace.yaml once and then treats the rows as the truth", async () => {
    const h = await harness();
    const targets = pageOf(StoredTargetViewSchema).parse(await json(await h.app.request(routes.targets(P))));
    expect(targets.items).toHaveLength(1);
    expect(targets.items[0]?.name).toBe("Tasklet");

    const people = pageOf(PersonaViewSchema).parse(await json(await h.app.request(routes.personas(P))));
    expect(people.items.map((p) => p.slug)).toEqual(["casual-lister"]);
    expect(people.items[0]?.origin).toBe("imported");
    expect(people.items[0]?.count).toBe(1);

    // A second import must not overwrite work someone has since done in the browser.
    await put(h.app, routes.target_(P, targets.items[0]!.id), { name: "Renamed in the browser", mcp: [{ name: "default", url: target.mcpUrl }], identity: { strategy: "self-signup", signupTool: "sign_up", tokenPath: "token", emailDomain: "populace.test" } });
    const again = await seedProjectFromConfig(h.store, config());
    expect(again.seeded).toBe(false);
    const after = pageOf(StoredTargetViewSchema).parse(await json(await h.app.request(routes.targets(P))));
    expect(after.items[0]?.name).toBe("Renamed in the browser");
    await h.close();
  });

  it("never puts a bearer token on the wire, in either direction", async () => {
    const h = await harness();
    const targets = pageOf(StoredTargetViewSchema).parse(await json(await h.app.request(routes.targets(P))));
    const view = targets.items[0]!;
    expect(view.mcp[0]?.authenticated).toBe(true);
    expect(JSON.stringify(view)).not.toContain("gateway-secret");

    // An update with no token in the body keeps the stored one rather than clearing it.
    await put(h.app, routes.target_(P, view.id), { name: "Tasklet", mcp: [{ name: "default", url: target.mcpUrl }], identity: view.identity });
    const stored = await h.store.getTarget(view.id);
    expect(stored?.mcp[0]?.bearerToken).toBe("gateway-secret");

    // An explicitly empty one clears it.
    await put(h.app, routes.target_(P, view.id), { name: "Tasklet", mcp: [{ name: "default", url: target.mcpUrl, bearerToken: "" }], identity: view.identity });
    expect((await h.store.getTarget(view.id))?.mcp[0]?.bearerToken).toBeUndefined();
    await h.close();
  });

  /**
   * The Firebase Web API key is what exchanges a custom token for a session and what renews it an
   * hour later, so it obeys the bearer token's rule in both directions: it is never sent back to
   * the browser, an absent one leaves the stored key alone, and a blank one clears it.
   */
  it("never puts an admin-mint api key on the wire, in either direction", async () => {
    const h = await harness();
    const targets = pageOf(StoredTargetViewSchema).parse(await json(await h.app.request(routes.targets(P))));
    const view = targets.items[0]!;
    const adminMint = { strategy: "admin-mint", provider: "firebase", emailDomain: "populace.test", apiKey: "AIza-secret-key", serviceAccountFile: "./sa.json" };
    const saved = StoredTargetViewSchema.parse(await json(await put(h.app, routes.target_(P, view.id), { name: "Tasklet", mcp: [{ name: "default", url: target.mcpUrl }], identity: adminMint })));
    expect(JSON.stringify(saved)).not.toContain("AIza-secret-key");
    expect(saved.identity.strategy === "admin-mint" ? saved.identity.apiKeySet : false).toBe(true);
    expect((await h.store.getTarget(view.id))?.identity).toMatchObject({ strategy: "admin-mint", apiKey: "AIza-secret-key" });

    // The form round-trips what it was shown, which carries no key, and the stored one survives.
    await put(h.app, routes.target_(P, view.id), { name: "Tasklet", mcp: [{ name: "default", url: target.mcpUrl }], identity: saved.identity });
    expect((await h.store.getTarget(view.id))?.identity).toMatchObject({ apiKey: "AIza-secret-key" });

    // An explicitly empty one clears it.
    await put(h.app, routes.target_(P, view.id), { name: "Tasklet", mcp: [{ name: "default", url: target.mcpUrl }], identity: { ...adminMint, apiKey: "" } });
    const cleared = (await h.store.getTarget(view.id))?.identity;
    expect(cleared?.strategy === "admin-mint" ? cleared.apiKey : "x").toBeUndefined();
    await h.close();
  });

  it("keeps a persona's slug immutable when its display name changes, so agent ids survive", async () => {
    const h = await harness();
    const people = pageOf(PersonaViewSchema).parse(await json(await h.app.request(routes.personas(P))));
    const person = people.items[0]!;
    const renamed = PersonaViewSchema.parse(await json(await put(h.app, routes.persona(P, person.id), { slug: "something-else", spec: { ...person.spec, name: "Casey Renamed" } })));
    expect(renamed.spec.name).toBe("Casey Renamed");
    expect(renamed.slug).toBe("casual-lister");
    // The id the runner builds agent ids from follows the slug, not the display name.
    expect(renamed.spec.id).toBe("casual-lister");
    const resolved = await resolveProject(h.store);
    expect(resolved.config.population.members[0]?.persona.id).toBe("casual-lister");
    await h.close();
  });

  /**
   * SPEC §2.3. A persona is a KIND of person; a person's name comes from their cohort's roster. The
   * starters used to be called Casey Morgan, Priya Desai and so on, which put two human names side
   * by side on three screens and made neither of them mean anything. This is a shape check rather
   * than a list of forbidden strings so that a new starter cannot arrive wearing a personal name.
   */
  it("gives no starter persona a name that reads as a person's", () => {
    const looksPersonal = /^[A-Z][\p{L}'’-]+ [A-Z][\p{L}'’-]+$/u;
    for (const starter of STARTER_PERSONAS) {
      expect(starter.spec.name, `${starter.slug} is named like a person`).not.toMatch(looksPersonal);
      expect(starter.spec.name.length).toBeGreaterThan(0);
    }
    expect(STARTER_PERSONAS.map((starter) => starter.spec.name)).toEqual(["First-time visitor", "Deadline planner", "Power user", "Sceptical evaluator", "Bargain hunter", "The one who left"]);
  });

  it("adds a starter and counts them into the population", async () => {
    const h = await harness({ seed: false });
    const starters = pageOf(StarterPersonaViewSchema).parse(await json(await h.app.request(routes.personaStarters(P))));
    expect(starters.items).toHaveLength(STARTER_PERSONAS.length);
    expect(starters.items.map((s) => s.slug)).toContain("the-one-who-left");

    const added = PersonaViewSchema.parse(await json(await post(h.app, routes.personaStarters(P), { slug: "first-timer", count: 2 })));
    expect(added.origin).toBe("starter");
    expect(added.count).toBe(2);
    const population = PopulationViewSchema.parse(await json(await h.app.request(await populationRoute(h))));
    expect(population.members).toHaveLength(1);
    expect(population.members[0]?.count).toBe(2);

    // A count of zero leaves the person written down but out of the run.
    await put(h.app, await populationRoute(h), { members: [{ personaId: added.id, count: 0 }] });
    expect(PopulationViewSchema.parse(await json(await h.app.request(await populationRoute(h)))).members).toHaveLength(0);
    expect(pageOf(PersonaViewSchema).parse(await json(await h.app.request(routes.personas(P)))).items).toHaveLength(1);
    await h.close();
  });

  /**
   * `PUT /population` replaces the member list. The browser drops a persona from the array when
   * its stepper reaches zero rather than sending `count: 0` (`screens/setup/People.tsx`), so a
   * handler that only walked the array left the cohort at its old size and the UI snapped back.
   */
  it("removes a cohort whose persona the body omits, and stores the per-cohort visit cap", async () => {
    const h = await harness();
    const seeded = pageOf(PersonaViewSchema).parse(await json(await h.app.request(routes.personas(P)))).items[0]!;
    const power = PersonaViewSchema.parse(await json(await post(h.app, routes.personaStarters(P), { slug: "power-user", count: 3 })));
    expect(PopulationViewSchema.parse(await json(await h.app.request(await populationRoute(h)))).members).toHaveLength(2);

    const view = PopulationViewSchema.parse(await json(await put(h.app, await populationRoute(h), { members: [{ personaId: power.id, count: 3, maxVisits: 6 }] })));
    expect(view.members.map((m) => m.personaId)).toEqual([power.id]);
    expect(view.members[0]?.count).toBe(3);
    expect(view.members[0]?.maxVisits).toBe(6);
    expect(await memberSlugs(h)).toEqual([power.slug]);
    // Out of the population, still written down: removing a member never deletes the persona.
    expect(pageOf(PersonaViewSchema).parse(await json(await h.app.request(routes.personas(P)))).items.map((p) => p.slug)).toContain(seeded.slug);

    // The cap is not just echoed back: it reaches the config the run is expanded from.
    const resolved = await resolveProject(h.store);
    expect(resolved.config.population.members.map((m) => m.maxWakes)).toEqual([6]);
    await h.close();
  });

  /**
   * `population.cohortIds` decides who is expanded into agents and therefore who spends money, so
   * a cohort the population does not hold stays out of the resolved config. A project can hold
   * one: a YAML import rewrites `cohortIds` and leaves whatever was authored in the browser behind.
   */
  it("expands only the cohorts the population holds, not every cohort in the project", async () => {
    const h = await harness();
    const persona = (await h.store.listPersonas("default"))[0]!;
    const at = new Date().toISOString();
    await h.store.saveCohort({ id: "coh_orphan", projectId: "default", slug: "orphans", name: "Orphans", personaId: persona.id, size: 9, seed: "populace", notes: "", createdAt: at, updatedAt: at });

    expect((await cohortsOf(h.store)).map((c) => c.slug)).not.toContain("orphans");
    const resolved = await resolveProject(h.store);
    expect(resolved.config.population.members.map((m) => m.cohort)).not.toContain("orphans");
    expect(SetupStatusSchema.parse(await json(await h.app.request(routes.projectSetup(P)))).peopleCount).toBe(1);
    await h.close();
  });

  /**
   * **The bug this stage exists for.** `PUT /projects/:p/populations/:pop` parsed `:pop`, resolved
   * it, checked it — and then edited a different row, because `setCohortSize` called
   * `ensurePopulation` internally and that returns the population whose slug is `everyone`. You
   * could create a second population through the API and never put anything in it: every write
   * landed on the default, and a simulation on the new one failed with "nobody is in the
   * population yet". A population is composition and composing one is the only thing it is for.
   */
  it("composes the population named in the URL, and leaves every other population alone", async () => {
    const h = await harness();
    const everyone = await ensurePopulation(h.store, "default");
    const before = [...everyone.cohortIds];
    expect(before.length).toBeGreaterThan(0);

    // A cohort that only the new population will hold. `inPopulation: false` because POST
    // /cohorts otherwise puts it in the default one, which is the convenience the setup screens
    // want and exactly the thing this test must not rely on.
    const persona = (await h.store.listPersonas("default"))[0]!;
    const extra = CohortViewSchema.parse(await json(await post(h.app, routes.cohorts(P), { personaId: persona.id, name: "Weekenders", size: 2, inPopulation: false })));

    const made = PopulationViewSchema.parse(await json(await post(h.app, routes.populations(P), { name: "Soak cast" })));
    expect(made.members).toHaveLength(0);

    const composed = PopulationViewSchema.parse(
      await json(await put(h.app, routes.population_(P, made.id), { cohortIds: [extra.id] })),
    );
    expect(composed.members.map((m) => m.cohortId)).toEqual([extra.id]);

    // The default population did NOT move. This is the whole assertion.
    expect((await h.store.getPopulation(everyone.id))?.cohortIds).toEqual(before);

    // ...and a simulation naming the new population expands exactly what the new one holds.
    const simulation = await ensureSimulation(h.store);
    await h.store.saveSimulation({ ...simulation, populationId: made.id, updatedAt: new Date().toISOString() });
    const resolved = await resolveSimulationConfig(h.store, processConfig, simulation.id);
    expect(resolved.config.population.members.map((m) => m.cohort)).toEqual([extra.slug]);
    await h.close();
  });

  /**
   * A cohort is reusable by design — the same cohort in two populations is the same people — so
   * "take them out of this cast" and "delete these people" are different acts. Going to zero used
   * to do the second when asked for the first, and with a SHARED cohort it threw: the store
   * refuses to delete a cohort a population still holds, and nothing caught it.
   */
  it("takes a shared cohort out of one population without deleting it from the other", async () => {
    const h = await harness();
    const persona = (await h.store.listPersonas("default"))[0]!;
    const shared = CohortViewSchema.parse(await json(await post(h.app, routes.cohorts(P), { personaId: persona.id, name: "Shared", size: 2, inPopulation: false })));

    const a = PopulationViewSchema.parse(await json(await post(h.app, routes.populations(P), { name: "Cast A" })));
    const b = PopulationViewSchema.parse(await json(await post(h.app, routes.populations(P), { name: "Cast B" })));
    await put(h.app, routes.population_(P, a.id), { cohortIds: [shared.id] });
    await put(h.app, routes.population_(P, b.id), { cohortIds: [shared.id] });

    // Empty Cast A through the persona-keyed path, which is what the setup screens send.
    const emptied = await put(h.app, routes.population_(P, a.id), { members: [] });
    expect(emptied.status).toBe(200);

    // Out of A, still in B, and the people are still there.
    expect((await h.store.getPopulation(a.id))?.cohortIds).toEqual([]);
    expect((await h.store.getPopulation(b.id))?.cohortIds).toEqual([shared.id]);
    expect(await h.store.getCohort(shared.id)).toBeDefined();
    expect(await h.store.listPeople({ cohortId: shared.id })).toHaveLength(2);
    await h.close();
  });

  /**
   * Two cohorts on one persona is the headline capability this restructure adds, so deleting that
   * persona has to be refused with the referrers named — not applied to the first cohort and then
   * abandoned half-way through with a 500 (SPEC §2.14).
   */
  it("refuses to delete a persona two cohorts are built on, and takes neither of them apart", async () => {
    const h = await harness();
    const persona = (await h.store.listPersonas("default"))[0]!;
    const second = CohortViewSchema.parse(await json(await post(h.app, routes.cohorts(P), { personaId: persona.id, name: "Weekend planners", size: 3 })));
    expect((await h.store.listCohorts("default")).filter((cohort) => cohort.personaId === persona.id)).toHaveLength(2);

    const refused = await h.app.request(routes.persona(P, persona.id), { method: "DELETE" });
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain(second.slug);
    // Nothing was taken apart on the way to the refusal.
    expect((await h.store.listCohorts("default")).filter((cohort) => cohort.personaId === persona.id)).toHaveLength(2);
    expect(await h.store.getPersona(persona.id)).toBeDefined();
    expect(await h.store.listPeople({ cohortId: second.id })).toHaveLength(3);
    await h.close();
  });

  /** SPEC §5.1: the roster is materialised on first read of a cohort, not only on a size change. */
  it("materialises a cohort's people when it is made and when it is read", async () => {
    const h = await harness();
    const persona = (await h.store.listPersonas("default"))[0]!;
    const created = CohortViewSchema.parse(await json(await post(h.app, routes.cohorts(P), { personaId: persona.id, name: "Mobile only", size: 4 })));
    expect(created.generated.seeded).toBe(4);

    // A cohort written straight into the store has no people at all until somebody looks.
    const at = new Date().toISOString();
    const bare: Cohort = { id: newCohortId(), projectId: "default", slug: "hand-made", name: "Hand made", personaId: persona.id, size: 3, seed: "populace", notes: "", createdAt: at, updatedAt: at };
    await h.store.saveCohort(bare);
    expect(await h.store.listPeople({ cohortId: bare.id, includeArchived: true })).toHaveLength(0);
    const roster = pageOf(PersonViewSchema).parse(await json(await h.app.request(routes.cohortPeople(P, bare.id))));
    expect(roster.items).toHaveLength(3);
    expect(new Set(roster.items.map((person) => person.name)).size).toBe(3);
    expect(CohortViewSchema.parse(await json(await h.app.request(routes.cohort(P, bare.id)))).generated.seeded).toBe(3);
    await h.close();
  });

  it("gives two targets with the same name different slugs, because a slug is the URL segment", async () => {
    const h = await harness();
    const identity = { strategy: "self-signup" as const, signupTool: "sign_up", tokenPath: "token", emailDomain: "populace.test" };
    const first = StoredTargetViewSchema.parse(await json(await post(h.app, routes.targets(P), { name: "Tasklet", mcp: [{ name: "default", url: target.mcpUrl }], identity })));
    const second = StoredTargetViewSchema.parse(await json(await post(h.app, routes.targets(P), { name: "Tasklet", mcp: [{ name: "default", url: target.mcpUrl }], identity })));
    const slugs = (await h.store.listTargets("default")).map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect((await h.store.getTarget(first.id))?.slug).toBe("tasklet");
    expect((await h.store.getTarget(second.id))?.slug).toBe("tasklet-2");
    await h.close();
  });

  it("never drops the api key when settings are saved from a form that cannot see it", async () => {
    const h = await harness();
    await h.store.saveSettings({ ...(await ensureSettings(h.store)), model: { ...(await ensureSettings(h.store)).model, apiKey: "sk-not-in-any-form" }, updatedAt: new Date().toISOString() });
    const view = SettingsViewSchema.parse(await json(await put(h.app, routes.settings(P), { guardrails: { dailyUsd: 12 } })));
    expect(view.guardrails.dailyUsd).toBe(12);
    expect(JSON.stringify(view)).not.toContain("sk-not-in-any-form");
    expect((await h.store.getSettings("default"))?.model.apiKey).toBe("sk-not-in-any-form");
    // A partial guardrail update leaves the nested ceilings it did not mention alone.
    expect(view.guardrails.perWake.maxTurns).toBe(40);
    await h.close();
  });

  /**
   * The spending controls have to reach the run. A simulation that overrides nothing must resolve
   * to the project's settings: its `overrides` block sits between the number a user types and the
   * ceiling a wake is held to, and a block that parses to a full set of schema defaults overwrites
   * every one of those numbers without saying so.
   */
  it("holds a run to the project's verifier and guardrail settings when the simulation overrides neither", async () => {
    const h = await harness({ seed: false });
    await seedProjectFromConfig(
      h.store,
      PopulaceConfigSchema.parse({
        ...config(),
        verifier: { judge: "heuristic", maxFindings: 9, model: { model: "claude-haiku-4-5", effort: "low" } },
        guardrails: { dailyUsd: 7, perWake: { maxTokens: 50_000, maxUsd: 1, maxTurns: 12 }, maxMemoryNotes: 11 },
      }),
    );

    // The authored numbers are stored, exactly as they were asked for.
    const settings = await ensureSettings(h.store);
    expect(settings.guardrails.dailyUsd).toBe(7);
    expect(settings.verifier.judge).toBe("heuristic");

    // A simulation nobody has overridden anything on overrides nothing.
    const simulation = await ensureSimulation(h.store);
    expect(simulation.overrides.guardrails).toEqual({});
    expect(simulation.overrides.verifier).toEqual({});

    // ...so those are the numbers the run is held to, not the schema's defaults.
    const resolved = (await resolveSimulationConfig(h.store, processConfig, simulation.id)).config;
    expect(resolved.verifier.judge).toBe("heuristic");
    expect(resolved.verifier.maxFindings).toBe(9);
    expect(resolved.verifier.model.model).toBe("claude-haiku-4-5");
    expect(resolved.guardrails.dailyUsd).toBe(7);
    expect(resolved.guardrails.perWake).toEqual({ maxTokens: 50_000, maxUsd: 1, maxTurns: 12 });
    expect(resolved.guardrails.maxMemoryNotes).toBe(11);

    // The Settings screen edits that same row, and the next execution is held to the new ceiling.
    const view = SettingsViewSchema.parse(await json(await put(h.app, routes.settings(P), { guardrails: { dailyUsd: 12, perWake: { maxUsd: 2 } } })));
    expect(view.guardrails.dailyUsd).toBe(12);
    const again = (await resolveSimulationConfig(h.store, processConfig, simulation.id)).config;
    expect(again.guardrails.dailyUsd).toBe(12);
    expect(again.guardrails.perWake.maxUsd).toBe(2);
    expect(again.guardrails.perWake.maxTurns).toBe(12);
    await h.close();
  });

  /**
   * A simulation that does carry overrides — a row written before the fix above, or an authoring
   * screen somebody adds later — is now allowed to say so, because a limit that Settings cannot
   * move looks identical to one it can until a screen says which it is.
   */
  it("says on the pre-flight which of the project's settings a simulation is not taking", async () => {
    const h = await harness();
    const simulation = await ensureSimulation(h.store);
    expect(PreflightViewSchema.parse(await json(await h.app.request(routes.simulationPreflight(P, simulation.id)))).simulation.overriding).toEqual([]);

    // Exactly the shape a row written before the override schemas were fixed carries.
    await h.store.saveSimulation({ ...simulation, overrides: { ...simulation.overrides, guardrails: { dailyUsd: 4 }, verifier: { judge: "model" } } });
    const view = PreflightViewSchema.parse(await json(await h.app.request(routes.simulationPreflight(P, simulation.id))));
    expect(view.simulation.overriding).toEqual(["spending", "verification"]);
    // ...and it is telling the truth: those are the numbers the run is held to.
    const resolved = (await resolveSimulationConfig(h.store, processConfig, simulation.id)).config;
    expect(resolved.guardrails.dailyUsd).toBe(4);
    await h.close();
  });
});

describe("what the connect wizard reads off a live target", () => {
  it("lists the tools, names the undescribed ones and guesses the identity tools", async () => {
    const h = await harness();
    const targets = pageOf(StoredTargetViewSchema).parse(await json(await h.app.request(routes.targets(P))));
    const check = TargetCheckSchema.parse(await json(await post(h.app, routes.targetCheck(P, targets.items[0]!.id))));
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
    const check = TargetCheckSchema.parse(await json(await post(h.app, routes.targetsCheck(P), { mcp: [{ name: "default", url: "http://127.0.0.1:1/mcp" }] })));
    expect(check.ok).toBe(false);
    expect(check.errors).toHaveLength(1);
    expect(check.tools).toHaveLength(0);
    await h.close();
  });

  it("saves a tool policy on the target and answers with it", async () => {
    const h = await harness();
    const targets = pageOf(StoredTargetViewSchema).parse(await json(await h.app.request(routes.targets(P))));
    const existing = targets.items[0]!;
    expect(existing.tools).toEqual({ allow: [], deny: [], destructive: "confirm" });

    const saved = StoredTargetViewSchema.parse(
      await json(
        await put(h.app, routes.target_(P, existing.id), {
          name: existing.name,
          mcp: existing.mcp.map((e) => ({ name: e.name, url: e.url })),
          identity: { strategy: "self-signup", signupTool: "sign_up", tokenPath: "token", emailDomain: "populace.test" },
          tools: { allow: [], deny: ["upgrade_plan", "delete_*"], destructive: "deny" },
        }),
      ),
    );
    expect(saved.tools.deny).toEqual(["upgrade_plan", "delete_*"]);
    expect(saved.tools.destructive).toBe("deny");
    // And it reaches the config the runner is handed, which is the only place it does anything.
    const resolved = await resolveProject(h.store);
    expect(resolved.config.target.tools.deny).toEqual(["upgrade_plan", "delete_*"]);

    // A save that does not mention the policy leaves it alone, exactly as a bearer token is left.
    const again = StoredTargetViewSchema.parse(
      await json(
        await put(h.app, routes.target_(P, existing.id), {
          name: "Tasklet renamed",
          mcp: existing.mcp.map((e) => ({ name: e.name, url: e.url })),
          identity: { strategy: "self-signup", signupTool: "sign_up", tokenPath: "token", emailDomain: "populace.test" },
        }),
      ),
    );
    expect(again.tools.deny).toEqual(["upgrade_plan", "delete_*"]);
    await h.close();
  });

  /**
   * The check that answers "did I configure identity right" without starting a run. It provisions
   * an account on somebody's product, so it is a POST; it calls no model, so it costs nothing.
   */
  it("makes first contact, reports the account and the tool, cleans up, and tells preflight", async () => {
    const h = await harness();
    const targets = pageOf(StoredTargetViewSchema).parse(await json(await h.app.request(routes.targets(P))));
    const targetId = targets.items[0]!.id;
    expect(targets.items[0]!.firstContact).toBeNull();

    // Never a GET: the route exists only as a POST, because it creates an account.
    expect((await h.app.request(routes.targetFirstContact(P, targetId))).status).toBe(404);

    const result = FirstContactSchema.parse(await json(await post(h.app, routes.targetFirstContact(P, targetId))));
    expect(result.outcome).toBe("accepted");
    expect(result.handle).toContain("@");
    expect(result.tool).toBe("get_me");
    expect(result.tornDown).toBe(true);
    // Nothing it held ever comes back down the wire.
    expect(JSON.stringify(result)).not.toContain("tk_");

    // It is remembered on the target, so preflight — a GET, which must never provision anything —
    // can say what happened without doing it again.
    const stored = StoredTargetViewSchema.parse(await json(await h.app.request(routes.target_(P, targetId))));
    expect(stored.firstContact?.outcome).toBe("accepted");
    const simulation = await ensureSimulation(h.store);
    const ok = PreflightViewSchema.parse(await json(await h.app.request(routes.simulationPreflight(P, simulation.id))));
    expect(ok.blockers.join(" ")).not.toContain("First contact");
    expect(ok.target.warnings.join(" ")).not.toContain("Nobody has tried");

    // A check that FAILED stands between the user and "Send them in".
    const row = (await h.store.getTarget(targetId))!;
    await h.store.saveTarget({
      ...row,
      firstContact: { ...result, outcome: "rejected", summary: "the target refused this account's credential" },
      updatedAt: new Date().toISOString(),
    });
    const blocked = PreflightViewSchema.parse(await json(await h.app.request(routes.simulationPreflight(P, simulation.id))));
    expect(blocked.blockers.join(" ")).toContain("refused this account's credential");
    await h.close();
  });

  /**
   * A result is evidence about the address and the identity settings it ran against. Keeping it
   * past an edit to either misleads in both directions: a passed check would go on suppressing
   * "nobody has tried getting an account here yet" for settings nobody has tried, and a failed one
   * would go on blocking preflight after the user fixed exactly what it complained about.
   */
  it("forgets a first-contact result when the address or the identity settings change, and keeps it when only the name does", async () => {
    const h = await harness();
    const targets = pageOf(StoredTargetViewSchema).parse(await json(await h.app.request(routes.targets(P))));
    const targetId = targets.items[0]!.id;
    const seeded = (await h.store.getTarget(targetId))!;
    const identity = seeded.identity;
    const mcp = seeded.mcp.map((e) => ({ name: e.name, url: e.url }));

    const result = FirstContactSchema.parse(await json(await post(h.app, routes.targetFirstContact(P, targetId))));
    expect(result.outcome).toBe("accepted");

    // A rename is not a change to what was checked.
    const renamed = StoredTargetViewSchema.parse(await json(await put(h.app, routes.target_(P, targetId), { name: "Tasklet, renamed", mcp, identity })));
    expect(renamed.firstContact?.outcome).toBe("accepted");

    // Repointing the endpoint is.
    const moved = StoredTargetViewSchema.parse(
      await json(await put(h.app, routes.target_(P, targetId), { name: "Tasklet, renamed", mcp: [{ name: "default", url: "http://127.0.0.1:1/mcp" }], identity })),
    );
    expect(moved.firstContact).toBeNull();

    // And so is changing how a person gets an account.
    await post(h.app, routes.targetFirstContact(P, targetId));
    const reidentified = StoredTargetViewSchema.parse(
      await json(await put(h.app, routes.target_(P, targetId), { name: "Tasklet, renamed", mcp: [{ name: "default", url: "http://127.0.0.1:1/mcp" }], identity: { ...identity, tokenPath: "accessToken" } })),
    );
    expect(reidentified.firstContact).toBeNull();

    // Which puts the warning back on preflight, rather than a tick for a configuration nobody tried.
    const simulation = await ensureSimulation(h.store);
    const view = PreflightViewSchema.parse(await json(await h.app.request(routes.simulationPreflight(P, simulation.id))));
    expect(view.target.warnings.join(" ")).toContain("Nobody has tried");
    await h.close();
  });

  it("tells preflight which tools the policy takes away, and from whom", async () => {
    const h = await harness();
    const simulation = await ensureSimulation(h.store);
    const row = (await h.store.getTarget(simulation.targetId))!;
    await h.store.saveTarget({ ...row, tools: { allow: [], deny: ["upgrade_plan"], destructive: "deny" }, updatedAt: new Date().toISOString() });

    const view = PreflightViewSchema.parse(await json(await h.app.request(routes.simulationPreflight(P, simulation.id))));
    expect(view.target.tools).not.toContain("upgrade_plan");
    expect(view.target.blocked.map((b) => b.name)).toContain("upgrade_plan");
    expect(view.target.blocked.find((b) => b.name === "upgrade_plan")?.who).toBe("everyone");
    expect(view.target.destructive).toBe("deny");
    expect(view.target.warnings.join(" ")).toContain("blocked by a tool policy");
    await h.close();
  });

  /**
   * A policy that takes away the one tool an account is made with is not a narrowing, it is a dead
   * configuration: every wake would end auth-failed. It is detectable without touching anything,
   * so preflight says it rather than letting a run discover it.
   */
  it("blocks a run whose target policy takes away the tool people sign up with", async () => {
    const h = await harness();
    const simulation = await ensureSimulation(h.store);
    const row = (await h.store.getTarget(simulation.targetId))!;
    await h.store.saveTarget({ ...row, tools: { allow: ["get_*", "list_*"], deny: [], destructive: "confirm" }, updatedAt: new Date().toISOString() });

    const view = PreflightViewSchema.parse(await json(await h.app.request(routes.simulationPreflight(P, simulation.id))));
    expect(view.blockers.join(" ")).toContain("sign_up");
    expect(view.blockers.join(" ")).toContain("nobody sent here could sign up");
    await h.close();
  });

  it("finds the promise the reference app makes and does not keep", async () => {
    const h = await harness();
    const targets = pageOf(StoredTargetViewSchema).parse(await json(await h.app.request(routes.targets(P))));
    const promises = TargetPromisesSchema.parse(await json(await h.app.request(routes.targetPromises(P, targets.items[0]!.id))));
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
    const empty = SetupStatusSchema.parse(await json(await none.app.request(routes.projectSetup(P))));
    expect(empty.ready).toBe(false);
    expect(empty.blockers.join(" ")).toContain("Connect a target");
    expect(empty.simulationIds).toEqual([]);
    // Nothing to run: a simulation names the target its runs go to, so there is no simulation to
    // start until there is a target, and the refusal says so rather than 404ing on a path.
    expect((await post(none.app, routes.simulations(P), { name: "Trial" })).status).toBe(409);
    expect((await post(none.app, routes.simulationRuns(P, "sim_nothing"))).status).toBe(404);
    await none.close();

    const keyless = await harness({ hasApiKey: false });
    const status = SetupStatusSchema.parse(await json(await keyless.app.request(routes.projectSetup(P))));
    expect(status.ready).toBe(false);
    expect(status.blockers.join(" ")).toContain("ANTHROPIC_API_KEY");
    expect((await post(keyless.app, await runsRoute(keyless))).status).toBe(503);
    await keyless.close();
  });

  /**
   * The browser onboarding path, with no `populace.yaml` anywhere: connect a target, pick somebody
   * to send, press go. `ready` used to be true with no simulation at all, and the go button then
   * posted to `/simulations//runs` — a 404 at the end of the whole flow.
   */
  it("gives a project set up entirely in the browser something to run", async () => {
    const h = await harness({ seed: false });
    const identity = { strategy: "self-signup" as const, signupTool: "sign_up", tokenPath: "token", userIdPath: "user.id", emailDomain: "populace.test" };
    await post(h.app, routes.targets(P), { name: "Tasklet", mcp: [{ name: "default", url: target.mcpUrl }], identity });
    await post(h.app, routes.personaStarters(P), { slug: "first-timer", count: 1 });

    // Taking a starter WRITES THE PEOPLE. `counts.people` is the number of person rows, and it is
    // what the zero state gates the way forward on (SPEC §7.5) — a cohort whose roster is only
    // materialised when somebody happens to open the cohort's own page left the project reading
    // "0 people configured" and the one path into a first run with no end.
    const home = ProjectOverviewViewSchema.parse(await json(await h.app.request(routes.project(P))));
    expect(home.counts.people).toBe(1);
    expect(home.counts.cohorts).toBe(1);

    const setup = SetupStatusSchema.parse(await json(await h.app.request(routes.projectSetup(P))));
    expect(setup.ready).toBe(true);
    expect(setup.blockers).toEqual([]);
    // Ready means there is something to run, not merely somewhere to run it.
    expect(setup.simulationIds.length).toBeGreaterThan(0);

    const started = await post(h.app, routes.simulationRuns(P, setup.simulationIds[0]!.id));
    expect(started.status).toBe(201);
    const runId = ((await json(started)) as { runId: string }).runId;
    await h.jobs.idle();
    await h.runs.pause(runId);
    expect((await h.store.getRun(runId))?.simulationId).toBe(setup.simulationIds[0]!.id);
    await h.close();
  });

  /**
   * `needs` and `blockers` are two different questions and one builder. A need that does not stop
   * an execution must not close the go button — the first draft folded them together and turned
   * `ready` false on a project that was perfectly able to run, because nobody had pressed Check on
   * its target.
   */
  it("separates what is left to do from what actually stops an execution", async () => {
    const h = await harness({ seed: false });
    const identity = { strategy: "self-signup" as const, signupTool: "sign_up", tokenPath: "token", userIdPath: "user.id", emailDomain: "populace.test" };
    await post(h.app, routes.targets(P), { name: "Tasklet", mcp: [{ name: "default", url: target.mcpUrl }], identity });
    await post(h.app, routes.personaStarters(P), { slug: "first-timer", count: 1 });

    const setup = SetupStatusSchema.parse(await json(await h.app.request(routes.projectSetup(P))));

    // Nobody has run a first-contact check, so there IS something left to do...
    const unchecked = setup.needs.find((need) => need.id.startsWith("target-unchecked:"));
    expect(unchecked).toBeDefined();
    // ...it names the target it is about, rather than saying "a target" and leaving the reader to
    // find which one...
    expect(unchecked?.scope.kind).toBe("target");
    expect(unchecked?.sentence).toContain("Tasklet");
    // ...and it does not stop anything.
    expect(unchecked?.blocking).toBe(false);
    expect(setup.blockers).toEqual([]);
    expect(setup.ready).toBe(true);

    // `blockers` is exactly the blocking needs, derived from the one builder rather than assembled
    // beside it, so the flat list and the scoped list can never disagree.
    expect(setup.blockers).toEqual(setup.needs.filter((need) => need.blocking).map((need) => need.sentence));

    await h.close();
  });

  it("estimates without spending anything, and says which basis it used", async () => {
    const h = await harness();
    const first = RunEstimateSchema.parse(await json(await post(h.app, await estimateRoute(h))));
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
    const second = RunEstimateSchema.parse(await json(await post(h.app, await estimateRoute(h))));
    expect(second.basis).toBe("history");
    expect(second.sampleSize).toBeGreaterThan(0);
    await h.close();
  });

  it("runs a population from the browser and settles the run row when it is done", async () => {
    const h = await harness();
    const started = await json(await post(h.app, await runsRoute(h), { label: "from the browser" }));
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
    const started = await json(await post(h.app, await runsRoute(h)));
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
    expect(live.participants).toHaveLength(1);
    expect(live.visitsDone).toBeGreaterThan(0);
    expect(live.cursor).toBeGreaterThan(0);
    await h.close();
  });

  it("stops a run that is not going, and refuses a round for one", async () => {
    const h = await harness();
    const started = await json(await post(h.app, await runsRoute(h)));
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
    const status = SetupStatusSchema.parse(await json(await h.app.request(routes.projectSetup(P))));
    expect(status.ready).toBe(false);
    expect(status.killSwitch.engaged).toBe(true);
    expect((await post(h.app, await runsRoute(h))).status).toBe(409);

    await post(h.app, routes.killSwitch, { engaged: false });
    expect(SetupStatusSchema.parse(await json(await h.app.request(routes.projectSetup(P)))).ready).toBe(true);
    await h.close();
  });

  it("carries a run on, and reports the job that is doing it", async () => {
    const h = await harness();
    const first = await json(await post(h.app, await runsRoute(h)));
    const parent = (first as { runId: string }).runId;
    await h.jobs.idle();
    await h.runs.settled(parent);

    const second = await json(await post(h.app, routes.runCarryForward(parent), { reason: "after the fix" }));
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

    expect((await post(h.app, routes.runCarryForward("run_nope_abcdef"))).status).toBe(404);
    await h.close();
  });
});

/**
 * Executions of a simulation: the lifecycle SPEC §4 describes. Ephemeral is a clean slate and
 * ends on its own; longitudinal accumulates and is paused and picked back up on the same run id.
 */
describe("executions of a simulation", () => {
  /** Remembering something is what makes "the second execution starts clean" observable. */
  const remembers: ScriptPolicy = sequence([
    () => ({ calls: [call("remember", { kind: "note", text: "Kept a list in the first execution." })] }),
    () => ({ calls: [call("done", { summary: "looked around", would_return: true })] }),
  ]);

  /**
   * Makes an account on the target, once, on the first visit — which is what gives a sweep
   * something to find. The credentials come out of the wake context, where the runner suggests
   * them, exactly as a real agent reads them.
   */
  const signsUp: ScriptPolicy = (ctx: ScriptContext) => {
    const suggested = /email (\S+), display name "([^"]+)", password (\S+)/.exec(ctx.wakeContext);
    // The runner suggests credentials only when the agent has no account, so this signs up on the
    // first visit — and again after a sweep took the account away, which is the point.
    if (ctx.turn === 1 && suggested) return { calls: [call("sign_up", { email: suggested[1]!, displayName: suggested[2]!, password: suggested[3]! })] };
    return { calls: [call("done", { summary: "had a look", would_return: true })] };
  };

  const startRun = async (h: Harness): Promise<string> => {
    const started = await json(await post(h.app, await runsRoute(h)));
    return (started as { runId: string }).runId;
  };

  /** Pushes the next visit far enough out that a run can be inspected before anybody wakes. */
  const slowDown = async (store: Store, initialDelay: string): Promise<Simulation> => {
    const simulation = await ensureSimulation(store);
    const slowed: Simulation = { ...simulation, cadence: CadenceSchema.parse({ ...simulation.cadence, initialDelay }), updatedAt: new Date().toISOString() };
    await store.saveSimulation(slowed);
    return slowed;
  };

  it("runs the same simulation twice as two independent executions, the second one a clean slate", async () => {
    const h = await harness({ policy: remembers });
    const first = await startRun(h);
    await h.jobs.idle();
    await h.runs.settled(first);
    const before = await h.store.listAgents({ runId: first });
    expect(before.map((a) => a.wakeCount)).toEqual([2]);
    const carried = await h.store.getMemory(first, before[0]!.id);
    expect(carried?.notes.map((n) => n.text).join(" ")).toContain("Kept a list in the first execution.");

    // Nobody wakes in the second execution until it is inspected: a clean slate is a claim about
    // the moment it starts, not about what it does afterwards.
    await slowDown(h.store, "1h");
    const second = await startRun(h);
    await h.jobs.idle();

    const run = await h.store.getRun(second);
    expect(run?.seq).toBe(2);
    expect(run?.mode).toBe("ephemeral");
    // A sibling, not a child: "run it again" inherits nothing at all.
    expect(run?.parentRunId).toBeNull();
    expect(run?.continuation).toBeNull();
    expect((await h.store.getRun(first))?.seq).toBe(1);

    const fresh = await h.store.listAgents({ runId: second });
    expect(fresh).toHaveLength(before.length);
    expect(fresh.every((a) => a.continuedFrom === null)).toBe(true);
    expect(fresh.map((a) => a.wakeCount)).toEqual([0]);
    expect(fresh.map((a) => a.identityId)).toEqual([null]);
    for (const agent of fresh) expect(await h.store.getMemory(second, agent.id)).toBeUndefined();

    // And the first execution's rows are exactly where they were — the defect the composite
    // primary key on `agents` fixed, asserted from the outside.
    const after = await h.store.listAgents({ runId: first });
    expect(after.map((a) => a.id)).toEqual(before.map((a) => a.id));
    expect(after.map((a) => a.wakeCount)).toEqual([2]);
    expect((await h.store.getMemory(first, before[0]!.id))?.notes).toHaveLength(carried!.notes.length);

    await h.runs.pause(second);
    await h.close();
  });

  it("ends an ephemeral execution on its own, with no stop issued, and sweeps its accounts", async () => {
    // Somebody has to SIGN UP for a sweep to have anything to sweep: `sweptAt` is stamped whether
    // or not an account was found, so a run whose people never made one asserts nothing at all.
    const h = await harness({ policy: signsUp });
    const runId = await startRun(h);
    await h.jobs.idle();
    await h.runs.settled(runId);

    const run = await h.store.getRun(runId);
    // Nothing above called stop: `visitsPerPerson` is what ends it.
    expect(run?.status).toBe("completed");
    expect(run?.pauseReason).toBeNull();
    expect(run?.mode).toBe("ephemeral");
    expect((await h.store.listAgents({ runId })).map((a) => a.status)).toEqual(["retired"]);

    // autoSweep: an ephemeral execution takes its accounts with it, and the evidence stays.
    expect(run?.sweptAt).not.toBeNull();
    const identities = await h.store.listIdentitiesByTag(tagForRun(runId), true);
    expect(identities.length).toBeGreaterThan(0);
    expect(identities.every((identity) => identity.tornDownAt !== null)).toBe(true);
    // ...off the target, not merely marked gone in our own database.
    expect(target.app.listUsers()).toHaveLength(0);
    const swept = (await h.store.listEvents({ runId })).find((e) => e.type === "run.status" && JSON.stringify(e.payload).includes("swept"));
    expect(JSON.stringify(swept?.payload)).toContain(`"removed":${identities.length}`);
    // `keepData`: the accounts go, the evidence of what they found stays.
    expect((await h.store.listWakes({ runIds: [runId] })).length).toBeGreaterThan(0);
    await h.close();
  });

  /**
   * A redeemable is a LONGER-LIVED secret than the bearer it mints, and the person views are the
   * one place an identity row is read for the browser. They are handle-only by design; this is the
   * assertion that says so, because the design is one field away from being untrue.
   */
  it("never puts a person's redeemable on the wire", async () => {
    const h = await harness({ policy: signsUp });
    const runId = await startRun(h);
    await h.jobs.idle();
    await h.runs.settled(runId);

    const identities = await h.store.listIdentitiesByTag(tagForRun(runId), true);
    expect(identities.length).toBeGreaterThan(0);
    for (const identity of identities) {
      await h.store.saveIdentity({
        ...identity,
        credential: { ...identity.credential, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), redeemable: { kind: "refresh-token", secret: "refresh-token-never-share-this" } },
      });
    }

    const participants = pageOf(ParticipantSummaryViewSchema).parse(await json(await h.app.request(routes.runParticipants(runId))));
    const person = ParticipantDetailViewSchema.parse(await json(await h.app.request(routes.participant(runId, participants.items[0]!.id))));
    // The readable handle is there — this is a view of an account, not an empty object...
    expect(person.account?.email).toContain("@");
    // ...and nothing else about the credential is.
    expect(JSON.stringify(person)).not.toContain("refresh-token-never-share-this");
    expect(JSON.stringify(participants)).not.toContain("refresh-token-never-share-this");
    const live = RunLiveSchema.parse(await json(await h.app.request(routes.runLive(runId))));
    expect(JSON.stringify(live)).not.toContain("refresh-token-never-share-this");
    await h.close();
  });

  /**
   * An ephemeral start RESETS THE TARGET. A second execution begun while the first is still going
   * therefore wipes the database out from under the people already in it, and every report they
   * file afterwards is against a state nobody asked for.
   */
  it("refuses a second execution of a simulation while the first one is still going", async () => {
    const h = await harness();
    await makeLongitudinal(h.store);
    const runId = await startRun(h);
    await h.jobs.idle();

    const again = await post(h.app, await runsRoute(h));
    expect(again.status).toBe(409);
    expect(await again.text()).toContain("still going");
    expect((await h.store.listRuns({ simulationId: (await ensureSimulation(h.store)).id })).map((r) => r.id)).toEqual([runId]);

    // Paused, it is somebody else's turn.
    await h.runs.pause(runId);
    const third = await post(h.app, await runsRoute(h));
    expect(third.status).toBe(201);
    await h.runs.pause((await json(third) as { runId: string }).runId);
    await h.close();
  });

  /**
   * Two resumes at once used to put TWO daemons on one run id: the second `active.set` overwrote
   * the first, so `pause` could only ever reach one of them and the other went on calling the
   * model and writing visits on a run the dashboard showed as paused.
   */
  it("picks a run back up once when two resumes arrive together, and the pause really stops it", async () => {
    const h = await harness({ policy: remembers });
    await makeLongitudinal(h.store);
    const runId = await startRun(h);
    await waitFor(async () => (await h.store.listWakes({ runIds: [runId] })).filter((w) => w.status !== "running").length >= 1);
    await h.runs.pause(runId);

    const both = await Promise.allSettled([h.runs.resume(runId), h.runs.resume(runId)]);
    expect(both.every((r) => r.status === "fulfilled")).toBe(true);
    expect((await h.store.getRun(runId))?.resumes).toBe(1);

    await waitFor(async () => (await h.store.listWakes({ runIds: [runId] })).length > 1);
    await h.runs.pause(runId);
    expect(h.runs.isRunning(runId)).toBe(false);
    // Nothing is left ticking behind the pause.
    const settled = (await h.store.listWakes({ runIds: [runId] })).length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await h.store.listWakes({ runIds: [runId] })).length).toBe(settled);
    await h.close();
  });

  it("pauses a longitudinal execution and picks the same run back up, with its memory and visit numbering", async () => {
    const h = await harness({ policy: remembers });
    await makeLongitudinal(h.store);
    const runId = await startRun(h);
    await waitFor(async () => (await h.store.listWakes({ runIds: [runId] })).filter((w) => w.status !== "running").length >= 1);

    const paused = await h.runs.pause(runId);
    expect(paused?.status).toBe("paused");
    expect(paused?.pauseReason).toBe("user");
    expect(paused?.resumes).toBe(0);
    const atPause = await h.store.listAgents({ runId });
    const visitsAtPause = (await h.store.listWakes({ runIds: [runId] })).length;
    expect(atPause[0]?.wakeCount).toBeGreaterThan(0);
    expect(atPause[0]?.status).toBe("active"); // nothing retired it: a soak has no visit cap
    const notesAtPause = (await h.store.getMemory(runId, atPause[0]!.id))!.notes;
    expect(notesAtPause.length).toBeGreaterThan(0);

    const resumed = await h.runs.resume(runId);
    // The SAME execution, picked back up. Memory is still there because it is keyed by this run id.
    expect(resumed.id).toBe(runId);
    expect(resumed.status).toBe("running");
    expect(resumed.pauseReason).toBeNull();
    expect(resumed.resumes).toBe(1);
    expect(resumed.lastResumedAt).not.toBeNull();
    expect(await h.store.listRuns()).toHaveLength(1);

    // A drained wake finishes in the background, so wait for the COUNT to move rather than for a
    // row to appear: an in-flight visit is a row before it is a visit.
    await waitFor(async () => ((await h.store.listAgents({ runId }))[0]?.wakeCount ?? 0) > atPause[0]!.wakeCount);
    expect((await h.store.listWakes({ runIds: [runId] })).length).toBeGreaterThan(visitsAtPause);
    await h.runs.pause(runId);
    const agent = (await h.store.listAgents({ runId }))[0]!;
    const wakes = await h.store.listWakes({ runIds: [runId], agentId: agent.id });
    // Visit numbering carries on rather than restarting at 1.
    expect(wakes.map((w) => w.wakeNumber)).toEqual(wakes.map((_w, index) => index + 1));
    expect(agent.wakeCount).toBeGreaterThan(atPause[0]!.wakeCount);
    // Carried, not rewritten: the note from before the pause is still in the document, and the
    // post-resume visits added to it rather than starting a new one. Every turn of every wake
    // calls `remember`, so "there are notes" would be satisfied by a memory that had been wiped.
    const after = (await h.store.getMemory(runId, agent.id))!.notes;
    expect(after.length).toBeGreaterThan(notesAtPause.length);
    expect(after[0]?.text).toBe(notesAtPause[0]?.text);
    expect(after.map((n) => n.text)).toContain("Kept a list in the first execution.");
    await h.close();
  });

  it("applies a change to a running longitudinal execution instead of pretending it was never made", async () => {
    const h = await harness();
    await makeLongitudinal(h.store);
    await slowDown(h.store, "1h");
    const runId = await startRun(h);
    await h.jobs.idle();
    const before = await h.store.getRun(runId);

    // A second cohort, added while the execution is up.
    const persona = PersonaViewSchema.parse(await json(await post(h.app, routes.personaStarters(P), { slug: "power-user", count: 2 })));
    expect(persona.count).toBe(2);
    const updated = await h.runs.applyChanges(runId);
    expect(updated.configSnapshotId).not.toBe(before?.configSnapshotId);

    const agents = await h.store.listAgents({ runId });
    expect(agents.filter((a) => a.cohortSlug === "power-user")).toHaveLength(2);
    const event = (await h.store.listEvents({ runId })).find((e) => e.type === "run.config");
    expect(JSON.stringify(event?.payload)).toContain("power-user");
    await h.runs.pause(runId);
    await h.close();
  });

  /**
   * ADR-0020's carry-forward inherits the parent's ACCOUNTS, and an identity row is stamped with
   * the tag of the run that created it. A child run therefore has participants whose account was
   * made under another run's tag, and the screen has to find it anyway.
   */
  it("still shows a carried-forward participant's account, which was made in the execution before", async () => {
    const h = await harness({ policy: signsUp });
    const simulation = await ensureSimulation(h.store);
    await h.store.saveSimulation({ ...simulation, autoSweep: false, updatedAt: new Date().toISOString() });
    const parent = await startRun(h);
    await h.jobs.idle();
    await h.runs.settled(parent);
    const before = pageOf(ParticipantSummaryViewSchema).parse(await json(await h.app.request(routes.runParticipants(parent))));
    expect(before.items[0]?.account?.email).toBeTruthy();

    const child = (await json(await post(h.app, routes.runCarryForward(parent), { reason: "after the fix" }))) as { runId: string };
    await h.jobs.idle();
    await h.runs.settled(child.runId);
    const after = pageOf(ParticipantSummaryViewSchema).parse(await json(await h.app.request(routes.runParticipants(child.runId))));
    expect(after.items).toHaveLength(before.items.length);
    expect(after.items[0]?.account?.email).toBe(before.items[0]?.account?.email);
    await h.close();
  });

  /**
   * ...and when the parent's accounts were swept away at the end of the ephemeral execution, the
   * child makes new ones rather than spending its budget authenticating as deleted users.
   */
  it("signs up again when the account it inherited was swept away with the execution that made it", async () => {
    const h = await harness({ policy: signsUp });
    const parent = await startRun(h);
    await h.jobs.idle();
    await h.runs.settled(parent);
    const swept = await h.store.listIdentitiesByTag(tagForRun(parent), true);
    expect(swept.length).toBeGreaterThan(0);
    expect(swept.every((identity) => identity.tornDownAt !== null)).toBe(true);
    expect(target.app.listUsers()).toHaveLength(0);

    const child = (await json(await post(h.app, routes.runCarryForward(parent), { reason: "after the fix" }))) as { runId: string };
    await h.jobs.idle();
    await h.runs.settled(child.runId);
    // A torn-down identity counts as no identity: the child provisioned its own.
    const fresh = await h.store.listIdentitiesByTag(tagForRun(child.runId), true);
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.map((identity) => identity.id)).not.toContain(swept[0]!.id);
    await h.close();
  });

  it("refuses to carry a run on into a simulation that is not the one it belongs to", async () => {
    const h = await harness();
    const mine = await ensureSimulation(h.store);
    const other = await createSimulation(h.store, {
      projectId: "default",
      slug: "another",
      name: "Another trial",
      populationId: mine.populationId,
      targetId: mine.targetId,
      visitsPerPerson: 1,
      cadence: CadenceSchema.parse({ every: "20ms" }),
      seed: "populace",
    });
    const started = (await json(await post(h.app, routes.simulationRuns(P, mine.id)))) as { runId: string };
    const parent = started.runId;
    await h.jobs.idle();
    await h.runs.settled(parent);
    expect((await h.store.getRun(parent))?.simulationId).toBe(mine.id);

    const refused = await post(h.app, routes.simulationRuns(P, other.id), { carryForwardFrom: parent });
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("different simulation");
    expect(await h.store.listRuns({ simulationId: other.id })).toHaveLength(0);
    await h.close();
  });

  it("sends two simulations in one project to the two different targets they name", async () => {
    const other = await startMockTarget({ quiet: true });
    try {
      const h = await harness();
      const first = await ensureSimulation(h.store);
      const at = new Date().toISOString();
      const second = { ...(await h.store.getTarget(first.targetId))!, id: newTargetId(), slug: "other", name: "Tasklet (staging)", mcp: [{ name: "default", url: other.mcpUrl, headers: {} }], webBaseUrl: other.url, createdAt: at, updatedAt: at };
      await h.store.saveTarget(second);
      const staging = await createSimulation(h.store, {
        projectId: "default",
        slug: "staging",
        name: "Staging trial",
        populationId: first.populationId,
        targetId: second.id,
        visitsPerPerson: 1,
        cadence: CadenceSchema.parse({ every: "20ms" }),
        seed: "populace",
      });

      // The bug this replaces: resolution read `listTargets(projectId)[0]` ordered by updated_at,
      // so BOTH simulations would have resolved to whichever target was saved last.
      const one = await resolveSimulationConfig(h.store, processConfig, first.id);
      const two = await resolveSimulationConfig(h.store, processConfig, staging.id);
      expect(one.config.target.mcp[0]?.url).toBe(target.mcpUrl);
      expect(two.config.target.mcp[0]?.url).toBe(other.mcpUrl);
      expect(one.target.id).toBe(first.targetId);
      expect(two.target.id).toBe(second.id);

      // And a run started from the second one records the second one's target.
      const run = await h.runs.start({ config: two.config, projectId: "default", simulationId: staging.id, targetId: two.target.id, label: "staging" });
      await h.runs.settled(run.id);
      expect(run.targetId).toBe(second.id);
      expect(run.seq).toBe(1);
      expect((await h.store.getRun(run.id))?.simulationId).toBe(staging.id);
      await h.close();
    } finally {
      await other.close();
    }
  });
});

/** Turns the project's simulation into an unbounded soak: no visit cap, so nothing ends it. */
async function makeLongitudinal(store: Store): Promise<Simulation> {
  const simulation = await ensureSimulation(store);
  const soak: Simulation = { ...simulation, mode: "longitudinal", visitsPerPerson: null, updatedAt: new Date().toISOString() };
  await store.saveSimulation(soak);
  return soak;
}

/** Polls a condition rather than sleeping a fixed time, so the test is not a race on a slow box. */
async function waitFor(condition: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for the run to get on with it");
}

/**
 * Putting the target back before an ephemeral execution's first visit (SPEC §4.2). The reference
 * target's reset is an HTTP route behind an admin token, not an MCP tool, which is exactly why the
 * `http` kind exists at all.
 */
describe("resetting the target before an execution", () => {
  it("calls the reference target's admin reset route and records what happened", async () => {
    const h = await harness();
    target.app.signUp({ email: "someone@populace.test", displayName: "Someone", password: "password123" });
    expect(target.app.listUsers()).toHaveLength(1);

    const resolved = await resolveProject(h.store);
    const withReset: PopulaceConfig = {
      ...resolved.config,
      target: { ...resolved.config.target, reset: { kind: "http", url: `${target.url}/admin/reset`, method: "POST", headers: { "x-admin-token": target.adminToken } } },
    };
    const outcome = await resetTarget(h.store, withReset, { runId: "run_reset_aaaaaa" });
    expect(outcome).toMatchObject({ kind: "http", applied: true, ok: true });
    expect(target.app.listUsers()).toHaveLength(0);
    const event = (await h.store.listEvents({ runId: "run_reset_aaaaaa" })).find((e) => e.type === "run.status");
    expect(JSON.stringify(event?.payload)).toContain("reset");
    await h.close();
  });

  it("says a target that declares no reset keeps its data, rather than failing or pretending", async () => {
    const h = await harness();
    const { config } = await resolveProject(h.store);
    expect(config.target.reset.kind).toBe("none");
    const outcome = await resetTarget(h.store, config, { runId: "run_noreset_aaaa" });
    expect(outcome.applied).toBe(false);
    expect(outcome.ok).toBe(true);
    expect(outcome.detail).toContain("keeps its data between executions");
    await h.close();
  });

  /**
   * `requireFreshTarget` is the one case where a missing reset is fatal rather than a warning: the
   * user said in so many words that these people must meet a clean product. A refusal that
   * silently stopped working would spend money against a dirty target instead.
   */
  it("refuses to start a simulation that insists on a fresh target the target cannot give", async () => {
    const h = await harness();
    const simulation = await ensureSimulation(h.store);
    await h.store.saveSimulation({ ...simulation, requireFreshTarget: true, updatedAt: new Date().toISOString() });

    const preflight = PreflightViewSchema.parse(await json(await h.app.request(routes.simulationPreflight(P, simulation.id))));
    expect(preflight.blockers.join(" ")).toContain("insists on a fresh target");

    const refused = await post(h.app, routes.simulationRuns(P, simulation.id));
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("Tasklet");
    // Refused before anything was started, not half-way through one.
    expect(await h.store.listRuns()).toHaveLength(0);

    // Give the target a reset and the same start goes through.
    const stored = (await h.store.getTarget(simulation.targetId))!;
    await h.store.saveTarget({ ...stored, reset: { kind: "http", url: `${target.url}/admin/reset`, method: "POST", headers: { "x-admin-token": target.adminToken } }, updatedAt: new Date().toISOString() });
    const started = await post(h.app, routes.simulationRuns(P, simulation.id));
    expect(started.status).toBe(201);
    await h.jobs.idle();
    await h.runs.settled(((await json(started)) as { runId: string }).runId);
    expect(PreflightViewSchema.parse(await json(await h.app.request(routes.simulationPreflight(P, simulation.id)))).blockers.join(" ")).not.toContain("insists on a fresh target");
    await h.close();
  });

  /**
   * A reset somebody asked for by hand belongs to no run. Filed against the empty string it was
   * on nobody's stream at all — the one record that a database had been wiped was unreachable.
   */
  it("files a hand-made target reset on the project rather than on a run that does not exist", async () => {
    const h = await harness();
    const stored = (await h.store.listTargets("default"))[0]!;
    await h.store.saveTarget({ ...stored, reset: { kind: "http", url: `${target.url}/admin/reset`, method: "POST", headers: { "x-admin-token": target.adminToken } }, updatedAt: new Date().toISOString() });
    target.app.signUp({ email: "someone@populace.test", displayName: "Someone", password: "password123" });

    const job = JobViewSchema.parse(await json(await post(h.app, routes.targetReset(P, stored.id))));
    expect(job.kind).toBe("target.reset");
    await h.jobs.idle();
    expect(target.app.listUsers()).toHaveLength(0);

    const events = await h.store.listEvents({ projectId: "default", limit: 500 });
    const reset = events.find((e) => e.type === "run.status" && JSON.stringify(e.payload).includes('"action":"reset"'));
    expect(reset).toBeDefined();
    expect(reset?.runId).toBeNull();
    expect(reset?.projectId).toBe("default");
    // ...and the job that did it is on the project's stream too, though it names no run.
    expect(events.some((e) => e.type === "job.updated" && e.runId === null)).toBe(true);
    await h.close();
  });

  it("keeps an admin token out of the snapshot and puts it back when a run is picked up", async () => {
    const h = await harness();
    const { config } = await resolveProject(h.store);
    const live: PopulaceConfig = {
      ...config,
      target: { ...config.target, reset: { kind: "http", url: `${target.url}/admin/reset`, method: "POST", headers: { "x-admin-token": "super-secret" } } },
    };
    const { config: frozen, redacted } = redactConfig(live);
    expect(redacted).toContain("target.reset.headers.x-admin-token");
    expect(JSON.stringify(frozen)).not.toContain("super-secret");
    // ...and a resume runs the frozen plan with the live credential, not with the word "[redacted]".
    const restored = withLiveSecrets(frozen, live);
    expect(restored.target.reset.kind === "http" && restored.target.reset.headers["x-admin-token"]).toBe("super-secret");
    await h.close();
  });
});

/**
 * The cast of a cohort (SPEC §5.2). Names are stable because the row is STORED, not because
 * anything about the draw is deterministic — which is what lets a cohort be re-cast by a model
 * later without any of this changing.
 */
describe("the people in a cohort", () => {
  it("writes a cohort's people once, and neither a shrink nor a new seed re-casts them", async () => {
    const h = await harness();
    const persona = (await h.store.listPersonas("default"))[0]!;
    // `setCohortSize` composes ONE named population now, rather than resolving "everyone"
    // internally and editing it whatever the caller meant.
    const everyone = await ensurePopulation(h.store, "default");
    await setCohortSize(h.store, everyone, persona, 5);
    const cohort = (await cohortsOf(h.store))[0]!;

    const roster = await ensureRoster(h.store, cohort.id);
    expect(roster.map((p) => p.ordinal)).toEqual([0, 1, 2, 3, 4]);
    expect(roster.map((p) => p.id)).toEqual([1, 2, 3, 4, 5].map((n) => `${cohort.slug}#${n}`));
    // Nobody in a cohort shares a name with anybody else, and nobody shares a signup handle.
    expect(new Set(roster.map((p) => p.name)).size).toBe(5);
    expect(new Set(roster.map((p) => p.handle)).size).toBe(5);
    expect(roster.every((p) => p.generatedBy === "seeded")).toBe(true);
    // Reading twice writes nothing new: filling a roster is not the same as re-casting it.
    expect((await ensureRoster(h.store, cohort.id)).map((p) => p.name)).toEqual(roster.map((p) => p.name));

    // Shrinking puts people aside rather than deleting them...
    await setCohortSize(h.store, (await ensurePopulation(h.store, "default")), persona, 3);
    expect((await ensureRoster(h.store, cohort.id)).map((p) => p.name)).toEqual(roster.slice(0, 3).map((p) => p.name));
    expect(await h.store.listPeople({ cohortId: cohort.id })).toHaveLength(3);
    expect(await h.store.listPeople({ cohortId: cohort.id, includeArchived: true })).toHaveLength(5);

    // ...so growing back meets the same five individuals, not five new ones wearing their ids.
    await setCohortSize(h.store, (await ensurePopulation(h.store, "default")), persona, 5);
    expect((await ensureRoster(h.store, cohort.id)).map((p) => p.name)).toEqual(roster.map((p) => p.name));

    // The seed decides who the NEXT person is, not who these people are.
    const stored = (await h.store.getCohort(cohort.id))!;
    await h.store.saveCohort({ ...stored, seed: "somebody-else", size: 6, updatedAt: new Date().toISOString() });
    const grown = await ensureRoster(h.store, cohort.id);
    expect(grown).toHaveLength(6);
    expect(grown.slice(0, 5).map((p) => p.name)).toEqual(roster.map((p) => p.name));

    // And the cast is what resolution freezes into the config a run executes.
    const resolved = await resolveProject(h.store);
    expect(resolved.config.population.members[0]?.people.map((p) => p.name)).toEqual(grown.map((p) => p.name));
    expect(resolved.config.population.members[0]?.count).toBe(6);
    await h.close();
  });

  /**
   * The whole chain in one test: a model writes a cohort's people, those people are who goes on
   * the execution, and what they file is keyed at file time and counted back against the cohort
   * they came from.
   *
   * It exists because the two halves were built separately. Person generation can be green on its
   * own while nothing it writes ever reaches a run, and clustering can be green on its own against
   * hand-made findings — the join between them is what neither suite sees.
   */
  it("sends the people the model wrote, and counts what they file back against their cohort", async () => {
    const writes: ScriptPolicy = (ctx: ScriptContext) => {
      if (!ctx.toolNames.includes("write_people")) return complains(ctx);
      const asked = ctx.messages
        .map((m) => (typeof m.content === "string" ? m.content : ""))
        .join("\n")
        .match(/by ordinal: ([\d, ]+)/);
      const ordinals = (asked?.[1] ?? "").split(",").map((n) => Number.parseInt(n.trim(), 10));
      return { calls: [call("write_people", { people: ordinals.map((ordinal) => ({ ordinal, name: `Written Person ${ordinal + 1}`, details: `Keeps a list on a commute, slot ${ordinal + 1}.` })) })] };
    };
    const h = await harness({ policy: writes, writesPeople: true });
    const cohort = (await cohortsOf(h.store))[0]!;
    await put(h.app, routes.cohort(P, cohort.id), { size: 2 });
    await post(h.app, routes.cohortPeople(P, cohort.id));
    await h.jobs.idle();

    const roster = pageOf(PersonViewSchema).parse(await json(await h.app.request(routes.cohortPeople(P, cohort.id))));
    expect(roster.items.map((p) => p.name)).toEqual(["Written Person 1", "Written Person 2"]);
    expect(roster.items.every((p) => p.generatedBy === "model")).toBe(true);

    const simulationId = (await ensureSimulation(h.store)).id;
    const started = (await json(await post(h.app, routes.simulationRuns(P, simulationId)))) as { runId: string };
    await h.jobs.idle();
    await h.runs.settled(started.runId);

    // Who went is who the model wrote — names and details both, since the details are what the
    // system prompt individuates them with.
    const agents = await h.store.listAgents({ runId: started.runId });
    expect(agents.map((a) => a.name).sort()).toEqual(["Written Person 1", "Written Person 2"]);
    expect(agents.every((a) => a.details.includes("commute"))).toBe(true);
    expect(agents.map((a) => a.personId).sort()).toEqual([`${cohort.slug}#1`, `${cohort.slug}#2`]);

    // Every finding carries the key it was filed under, computed by the runner, not by the report.
    const findings = await h.store.listFindings({ runIds: [started.runId] });
    expect(findings.length).toBeGreaterThan(0);
    // `primaryTool`, not the bare `tool` field: a finding that names no tool is keyed on the last
    // tool it reproduced with, and any read model that recomputes the key has to do the same.
    for (const finding of findings) expect(finding.signature).toBe(signatureOf(finding.kind, primaryTool(finding), finding.title));

    // ...and the clusterer reads the cohort and the people straight back out of the agent ids the
    // roster produced: two of two weekenders hit it, four reports between them.
    const results = SimulationResultsViewSchema.parse(await json(await h.app.request(routes.simulationResults(P, simulationId))));
    const card = results.clusters.find((c) => c.signature === findings[0]!.signature);
    expect(card?.peopleHit).toBe(2);
    expect(card?.peopleTotal).toBe(2);
    expect(card?.reports).toBe(findings.length);
    expect(card?.cohorts).toEqual([{ slug: cohort.slug, name: cohort.name, hit: 2, total: 2 }]);
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

  /**
   * A refresh token and the key that mints one are longer-lived than the bearer they produce, so
   * neither may sit in a snapshot that gets copied around and attached to bug reports — and a
   * resume must still be able to renew, which is what `withLiveSecrets` puts back.
   */
  it("redacts the identity block's credential from a snapshot and puts it back for a resume", async () => {
    const h = await harness();
    const base = config();
    const cfg: PopulaceConfig = { ...base, identity: { strategy: "admin-mint", provider: "firebase", emailDomain: "populace.test", apiKey: "AIza-secret-key" } };
    const snapshot = await snapshotConfig(h.store, cfg);
    expect(snapshot.redacted).toContain("identity.apiKey");
    expect(JSON.stringify(snapshot)).not.toContain("AIza-secret-key");

    const live = withLiveSecrets(snapshot.config, cfg);
    expect(live.identity.strategy === "admin-mint" ? live.identity.apiKey : null).toBe("AIza-secret-key");
    await h.close();
  });

  it("picks a run whose process died back up rather than calling it failed", async () => {
    const h = await harness();
    const population = await ensurePopulation(h.store);
    await h.store.saveRun({
      id: newRunId(),
      projectId: "default",
      simulationId: "sim_test",
      seq: 1,
      mode: "longitudinal",
      targetId: "t",
      populationId: population.slug,
      label: "abandoned",
      status: "running",
      configSnapshotId: "",
      parentRunId: null,
      continuation: null,
      pauseReason: null,
      resumes: 0,
      lastResumedAt: null,
      sweptAt: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
      totals: { agents: 0, activeAgents: 0, wakes: 0, findings: 0, confirmed: 0, costUsd: 0 },
    });
    expect(await h.runs.reconcileOrphans()).toBe(1);
    const [run] = await h.store.listRuns();
    // Not `failed`: "runs forever" on a laptop means "runs as long as serve does", and the honest
    // state for that is an execution you can pick back up. `failed` is a run that actually threw.
    expect(run?.status).toBe("paused");
    expect(run?.pauseReason).toBe("process-ended");
    expect(run?.endedAt).not.toBeNull();
    await h.close();
  });

  /**
   * The other half of "a run whose process died is paused, not failed" (SPEC §4.2). Without it a
   * longitudinal soak the user was told to leave running stops for good the first time the laptop
   * closes, and only a hand-written POST brings it back.
   */
  it("picks executions a dead process left behind back up when serve is asked to", async () => {
    const store = new SqliteStore(":memory:");
    await ensureProject(store);
    await ensureSettings(store);
    await seedProjectFromConfig(store, config());
    const simulation = await ensureSimulation(store);
    await store.saveSimulation({ ...simulation, mode: "longitudinal", visitsPerPerson: null, updatedAt: new Date().toISOString() });
    const resolved = await resolveSimulationConfig(store, processConfig, simulation.id);
    const provider = new ScriptedProvider(() => ({ calls: [call("done", { summary: "looked around", would_return: true })] }));
    const resolve = async (id: string): Promise<PopulaceConfig> => (await resolveSimulationConfig(store, processConfig, id)).config;

    const runs = new RunController({ store, provider: () => provider, resolve });
    const started = await runs.start({ config: resolved.config, projectId: "default", simulationId: simulation.id, targetId: resolved.target.id, label: "soak" });
    await runs.pause(started.id);
    // What `reconcileOrphans` leaves behind: paused, because the process went away.
    await store.saveRun({ ...(await store.getRun(started.id))!, pauseReason: "process-ended" });

    const server = await startServer({ store, storePath: ":memory:", version: "test", resume: true, provider: () => provider, port: 0 });
    try {
      const picked = await store.getRun(started.id);
      expect(picked?.status).toBe("running");
      expect(picked?.pauseReason).toBeNull();
      expect(picked?.resumes).toBe(1);
    } finally {
      await server.close();
    }
    // Shutting the process down pauses it again rather than calling it broken.
    expect((await store.getRun(started.id))?.status).toBe("paused");
    await store.close();
  });

  /** ...and a run somebody paused on purpose is left exactly where they left it. */
  it("leaves a deliberately paused execution paused when serve opens", async () => {
    const store = new SqliteStore(":memory:");
    await ensureProject(store);
    await ensureSettings(store);
    await seedProjectFromConfig(store, config());
    const simulation = await ensureSimulation(store);
    await store.saveSimulation({ ...simulation, mode: "longitudinal", visitsPerPerson: null, updatedAt: new Date().toISOString() });
    const resolved = await resolveSimulationConfig(store, processConfig, simulation.id);
    const provider = new ScriptedProvider(() => ({ calls: [call("done", { summary: "looked around", would_return: true })] }));
    const runs = new RunController({ store, provider: () => provider, resolve: async (id) => (await resolveSimulationConfig(store, processConfig, id)).config });
    const started = await runs.start({ config: resolved.config, projectId: "default", simulationId: simulation.id, targetId: resolved.target.id, label: "soak" });
    await runs.pause(started.id);

    const server = await startServer({ store, storePath: ":memory:", version: "test", resume: true, provider: () => provider, port: 0 });
    try {
      const still = await store.getRun(started.id);
      expect(still?.status).toBe("paused");
      expect(still?.pauseReason).toBe("user");
      expect(still?.resumes).toBe(0);
    } finally {
      await server.close();
      await store.close();
    }
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
  for (const { agent } of expandPopulation(cfg.population, runId, cfg.simulation.id)) {
    await runWake({ agent, config: cfg }, { store, provider, identityProvider });
  }
}

/**
 * The project is a path segment, not something the process closed over once at startup (SPEC §6).
 * That is the whole point of stage 4, and these are the assertions that make it true rather than
 * merely intended.
 */
describe("two projects in one store", () => {
  /** A second project with its own target, its own persona and its own simulation. */
  const secondProject = async (h: Harness): Promise<{ id: string; simulationId: string; targetId: string }> => {
    const created = await json(await post(h.app, routes.projects, { name: "Other product", description: "somebody else's app" }));
    const id = (created as { id: string }).id;
    await put(h.app, routes.settings(id), { daemon: { tick: "20ms", concurrency: 2 } });
    const identity = { strategy: "self-signup" as const, signupTool: "sign_up", tokenPath: "token", userIdPath: "user.id", emailDomain: "populace.test" };
    const theirTarget = StoredTargetViewSchema.parse(await json(await post(h.app, routes.targets(id), { name: "Other target", mcp: [{ name: "default", url: target.mcpUrl }], identity })));
    await post(h.app, routes.personaStarters(id), { slug: "power-user", count: 1 });
    const simulation = await json(await post(h.app, routes.simulations(id), { name: "Other trial", targetId: theirTarget.id, visitsPerPerson: 1 }));
    return { id, simulationId: (simulation as { id: string }).id, targetId: theirTarget.id };
  };

  it("does not let one project see the other's targets, personas, cohorts or runs", async () => {
    const h = await harness();
    const other = await secondProject(h);

    const mine = pageOf(StoredTargetViewSchema).parse(await json(await h.app.request(routes.targets(P))));
    const theirs = pageOf(StoredTargetViewSchema).parse(await json(await h.app.request(routes.targets(other.id))));
    expect(mine.items.map((t) => t.name)).toEqual(["Tasklet"]);
    expect(theirs.items.map((t) => t.name)).toEqual(["Other target"]);

    expect(pageOf(PersonaViewSchema).parse(await json(await h.app.request(routes.personas(P)))).items.map((p) => p.slug)).toEqual(["casual-lister"]);
    expect(pageOf(PersonaViewSchema).parse(await json(await h.app.request(routes.personas(other.id)))).items.map((p) => p.slug)).toEqual(["power-user"]);

    expect(pageOf(CohortViewSchema).parse(await json(await h.app.request(routes.cohorts(P)))).items.map((c) => c.slug)).toEqual(["casual-lister"]);
    expect(pageOf(CohortViewSchema).parse(await json(await h.app.request(routes.cohorts(other.id)))).items.map((c) => c.slug)).toEqual(["power-user"]);

    // A row named by id but belonging to somebody else is not found, rather than quietly served.
    expect((await h.app.request(routes.target_(other.id, mine.items[0]!.id))).status).toBe(404);
    expect((await put(h.app, routes.target_(other.id, mine.items[0]!.id), { name: "hijacked", mcp: [{ name: "default", url: target.mcpUrl }], identity: mine.items[0]!.identity })).status).toBe(404);
    expect((await h.app.request(routes.project("no-such-project"))).status).toBe(404);

    // One real execution in each, and `GET /runs?project=` keeps them apart.
    const here = (await json(await post(h.app, await runsRoute(h)))) as { runId: string };
    await h.jobs.idle();
    await h.runs.settled(here.runId);
    const there = (await json(await post(h.app, routes.simulationRuns(other.id, other.simulationId)))) as { runId: string };
    await h.jobs.idle();
    await h.runs.settled(there.runId);

    const ours = pageOf(RunSummarySchema).parse(await json(await h.app.request(`${routes.runs}?project=${P}`)));
    const others = pageOf(RunSummarySchema).parse(await json(await h.app.request(`${routes.runs}?project=${other.id}`)));
    expect(ours.items.map((r) => r.id)).toEqual([here.runId]);
    expect(others.items.map((r) => r.id)).toEqual([there.runId]);
    // ...and both are in the unfiltered list, so the filter is a filter and not a broken query.
    expect(pageOf(RunSummarySchema).parse(await json(await h.app.request(routes.runs))).items).toHaveLength(2);

    await h.close();
  });

  /**
   * Resolution looks a target up BY ID with no project predicate, so a simulation pointed at
   * another project's target would run against that project's server — carrying that project's
   * stored bearer token with it.
   */
  it("refuses to point a simulation at another project's target or population", async () => {
    const h = await harness();
    const other = await secondProject(h);
    const mine = await ensureSimulation(h.store);
    const theirPopulation = (await h.store.listPopulations(other.id))[0]!;

    expect((await put(h.app, routes.simulation(P, mine.id), { name: "Trial", targetId: other.targetId })).status).toBe(400);
    expect((await put(h.app, routes.simulation(P, mine.id), { name: "Trial", populationId: theirPopulation.id })).status).toBe(400);
    const after = await h.store.getSimulation(mine.id);
    expect(after?.targetId).toBe(mine.targetId);
    expect(after?.populationId).toBe(mine.populationId);
    await h.close();
  });

  it("streams one project's events and not the other's", async () => {
    const h = await harness();
    const other = await secondProject(h);
    const here = (await json(await post(h.app, await runsRoute(h)))) as { runId: string };
    await h.jobs.idle();
    await h.runs.settled(here.runId);
    const there = (await json(await post(h.app, routes.simulationRuns(other.id, other.simulationId)))) as { runId: string };
    await h.jobs.idle();
    await h.runs.settled(there.runId);

    // The stamp itself: an emitter inside a wake knows its run and nothing else, and the recording
    // store fills in the project from the run's row.
    const stamped = await h.store.listEvents({ runId: here.runId, limit: 500 });
    expect(stamped.length).toBeGreaterThan(0);
    expect(stamped.every((e) => e.projectId === P)).toBe(true);
    expect(stamped.every((e) => e.simulationId !== null)).toBe(true);

    const body = await sse(h.app, `${routes.events}?project=${P}&after=0`);
    expect(body).toContain(here.runId);
    expect(body).not.toContain(there.runId);
    expect(body).not.toContain(other.id);

    const mine = pageOf(EventSchema).parse(await json(await h.app.request(`${routes.events}/history?project=${other.id}&after=0`)));
    expect(mine.items.length).toBeGreaterThan(0);
    expect(mine.items.every((e) => e.projectId === other.id)).toBe(true);
    expect(mine.items.every((e) => e.runId === there.runId || e.runId === null)).toBe(true);
    expect(JSON.stringify(mine.items)).not.toContain(here.runId);
    // A job is stamped with the project it belongs to, not only with a run: a job that starts one
    // has no run id until the row exists, and an authoring job never has one at all.
    expect(mine.items.some((e) => e.type === "job.updated" && e.runId === null)).toBe(true);

    await h.close();
  });
});

/**
 * Query-count discipline (SPEC §6.2). A screen is a fixed handful of queries, and it stays a fixed
 * handful when the population grows — which is the property the old per-participant memory read
 * did not have.
 */
describe("a screen is a bounded number of queries", () => {
  const grow = async (h: Harness, size: number): Promise<void> => {
    const cohort = (await cohortsOf(h.store))[0]!;
    await put(h.app, routes.cohort(P, cohort.id), { size });
  };

  const runOnce = async (h: Harness): Promise<string> => {
    const started = (await json(await post(h.app, await runsRoute(h)))) as { runId: string };
    await h.jobs.idle();
    await h.runs.settled(started.runId);
    return started.runId;
  };

  it("serves the results screen and one person's page in the same number of queries for 1 person as for 6", async () => {
    const h = await harness();
    const simulationId = (await ensureSimulation(h.store)).id;

    const measure = async (runId: string): Promise<{ results: number; person: number; heads: number }> => {
      const participants = pageOf(ParticipantSummaryViewSchema).parse(await json(await h.app.request(routes.runParticipants(runId))));
      h.resetCalls();
      const results = SimulationResultsViewSchema.parse(await json(await h.app.request(routes.simulationResults(P, simulationId))));
      const resultsCalls = h.calls.length;
      h.resetCalls();
      const person = ParticipantDetailViewSchema.parse(await json(await h.app.request(routes.participant(runId, participants.items[0]!.id))));
      expect(person.visits.length).toBeGreaterThan(0);
      expect(results.stats.people).toBe(participants.items.length);
      return { results: resultsCalls, person: h.calls.length, heads: participants.items.length };
    };

    // Two executions before the first measurement, so both measurements have a sibling execution
    // to look at: what is being held constant here is the HEADCOUNT, not the history.
    await runOnce(h);
    const small = await measure(await runOnce(h));
    expect(small.heads).toBe(1);

    await grow(h, 6);
    const big = await measure(await runOnce(h));
    expect(big.heads).toBe(6);

    // Not "roughly the same": the same. A query per head would make this 6 more, and a query per
    // visit would make it 12 more.
    expect(big.results).toBe(small.results);
    expect(big.person).toBe(small.person);
    // And it is a handful, not an accident of both being enormous.
    expect(big.results).toBeLessThan(40);
    expect(big.person).toBeLessThan(20);

    await h.close();
  });
});

/**
 * SPEC §7.1: the top three levels never name a person. It is enforced by the payload shapes, so
 * breaking the rule takes a new request rather than a new line of JSX.
 */
describe("the project and simulation screens name nobody", () => {
  it("carries counts, clusters and cohorts — and not one person's name", async () => {
    const h = await harness({ policy: complains });
    const simulationId = (await ensureSimulation(h.store)).id;
    const cohort = (await cohortsOf(h.store))[0]!;
    await put(h.app, routes.cohort(P, cohort.id), { size: 3 });
    const started = (await json(await post(h.app, await runsRoute(h)))) as { runId: string };
    await h.jobs.idle();
    await h.runs.settled(started.runId);

    const participants = pageOf(ParticipantSummaryViewSchema).parse(await json(await h.app.request(routes.runParticipants(started.runId))));
    const names = participants.items.map((p) => p.name);
    expect(names).toHaveLength(3);

    const overviewBody = await (await h.app.request(routes.project(P))).text();
    const overview = ProjectOverviewViewSchema.parse(JSON.parse(overviewBody));
    expect(overview.counts.people).toBe(3);
    expect(overview.simulations.map((s) => s.id)).toContain(simulationId);
    for (const name of names) expect(overviewBody).not.toContain(name);

    const resultsBody = await (await h.app.request(routes.simulationResults(P, simulationId))).text();
    const results = SimulationResultsViewSchema.parse(JSON.parse(resultsBody));
    expect(results.clusters.length).toBeGreaterThan(0);
    expect(results.cohortBreakdown.map((c) => c.cohortSlug)).toEqual(["casual-lister"]);
    expect(results.stats.people).toBe(3);
    expect(results.headline).toContain("3 people");
    for (const name of names) expect(resultsBody).not.toContain(name);

    // One level further in, on the finding itself, the names appear — as the authors of quotes.
    const signature = results.clusters[0]!.signature;
    const detail = ClusterDetailViewSchema.parse(await json(await h.app.request(routes.simulationCluster(P, simulationId, signature))));
    expect(detail.quotes.length).toBeGreaterThan(0);
    expect(names).toContain(detail.quotes[0]!.name);
    expect(detail.peopleHit.length).toBeGreaterThan(0);

    await h.close();
  });
});

/**
 * The authoring surfaces the route table adds: the library is a set of rows a user edits, and
 * preflight is the screen that answers "I just set this up — did I set it up right?" without
 * spending anything.
 */
/**
 * SPEC §4.3: what a problem DID between executions. "I shipped a fix; did it work?" is answered by
 * a signature being present and then absent, so an absence has to be something the screen shows.
 */
describe("what a problem did between executions", () => {
  it("shows a signature the latest execution did not report as fixed, and as regressed when it comes back", async () => {
    let filing = true;
    const h = await harness({ policy: (ctx: ScriptContext) => (filing ? complains(ctx) : { calls: [call("done", { summary: "all clear", would_return: true })] }) });
    const simulationId = (await ensureSimulation(h.store)).id;
    const runOnce = async (): Promise<string> => {
      const started = (await json(await post(h.app, routes.simulationRuns(P, simulationId)))) as { runId: string };
      await h.jobs.idle();
      await h.runs.settled(started.runId);
      return started.runId;
    };
    const cardIn = async (signature: string) => SimulationResultsViewSchema.parse(await json(await h.app.request(routes.simulationResults(P, simulationId)))).clusters.find((c) => c.signature === signature);

    const first = await runOnce();
    const reported = await h.store.listFindings({ runIds: [first] });
    const signature = reported[0]!.signature;
    expect(reported.length).toBe(2); // one per visit

    filing = false;
    const second = await runOnce();
    expect(await h.store.listFindings({ runIds: [second] })).toHaveLength(0);

    const fixed = await cardIn(signature);
    expect(fixed?.state).toBe("fixed");
    expect(fixed?.peopleHit).toBe(0);
    expect(fixed?.reports).toBe(0);
    expect(fixed?.seenIn).toEqual([1]);
    // ...and it is still something you can open: a fix with no evidence behind it is a rumour.
    const gone = ClusterDetailViewSchema.parse(await json(await h.app.request(routes.simulationCluster(P, simulationId, signature))));
    expect(gone.quotes.length).toBeGreaterThan(0);
    expect(gone.history.map((entry) => entry.reports)).toEqual([2, 0]);

    filing = true;
    const third = await runOnce();
    const back = await cardIn(signature);
    expect(back?.state).toBe("regressed");
    expect(back?.seenIn).toEqual([1, 3]);

    /**
     * Agent ids are deterministic within a simulation, so the cross-execution sets the history is
     * built from match every execution's participants. A person's row here is about THIS
     * execution: two reports, not the four they filed across executions 1 and 3.
     */
    const detail = ClusterDetailViewSchema.parse(await json(await h.app.request(routes.simulationCluster(P, simulationId, signature))));
    expect(detail.peopleHit).toHaveLength(1);
    expect(detail.peopleHit[0]?.runId).toBe(third);
    expect(detail.peopleHit[0]?.findings).toBe(2);
    expect(detail.peopleHit[0]?.visits).toBe(2);
    await h.close();
  });
});

describe("the project library and the pre-flight", () => {
  it("edits a cohort, reads its roster and renames one person without moving their handle", async () => {
    const h = await harness();
    const cohorts = pageOf(CohortViewSchema).parse(await json(await h.app.request(routes.cohorts(P))));
    const cohort = cohorts.items[0]!;
    expect(cohort.usedByPopulations).toHaveLength(1);

    const grown = CohortViewSchema.parse(await json(await put(h.app, routes.cohort(P, cohort.id), { size: 4, notes: "the ones who keep lists" })));
    expect(grown.size).toBe(4);
    expect(grown.slug).toBe(cohort.slug); // immutable: it is half of every agent id
    expect(grown.generated.seeded).toBe(4);

    const roster = pageOf(PersonViewSchema).parse(await json(await h.app.request(routes.cohortPeople(P, cohort.id))));
    expect(roster.items).toHaveLength(4);
    expect(new Set(roster.items.map((p) => p.name)).size).toBe(4);
    const third = roster.items[2]!;

    const renamed = PersonViewSchema.parse(await json(await h.app.request(routes.cohortPerson(P, cohort.id, third.ordinal), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Renamed By Hand" }) })));
    expect(renamed.name).toBe("Renamed By Hand");
    // The handle is what the account on the target was signed up with, so a rename must not move it.
    expect(renamed.handle).toBe(third.handle);
    await h.close();
  });

  it("says who is going, what they will meet and what one of them will be told — and spends nothing", async () => {
    const h = await harness();
    const simulation = await ensureSimulation(h.store);
    const before = await h.store.listWakes({});

    const preflight = PreflightViewSchema.parse(await json(await h.app.request(routes.simulationPreflight(P, simulation.id))));
    expect(preflight.totalPeople).toBe(1);
    expect(preflight.plannedVisits).toBe(2); // one person, two visits each
    expect(preflight.cohorts[0]?.sampleNames).toHaveLength(1);
    expect(preflight.target.tools).toContain("search_tasks");
    expect(preflight.estimate.expectedUsd).toBeGreaterThan(0);
    // The actual system prompt, rendered by the runner's own code rather than a second copy of it.
    expect(preflight.promptPreview.text).toContain(preflight.promptPreview.personName);
    expect(preflight.promptPreview.text).toContain("Tasklet");
    // Tasklet declares no reset, and the screen says so rather than pretending.
    expect(preflight.target.warnings.join(" ")).toContain("no reset");
    expect(await h.store.listWakes({})).toHaveLength(before.length);
    await h.close();
  });

  it("keeps a human's judgement about a problem, and notices when the title it was filed under drifts", async () => {
    const h = await harness({ policy: complains });
    const runId = (await json(await post(h.app, await runsRoute(h)))) as { runId: string };
    await h.jobs.idle();
    await h.runs.settled(runId.runId);
    const signature = (await h.store.listFindings({ runIds: [runId.runId] }))[0]!.signature;

    await put(h.app, routes.triage(P), { signature, state: "fixed", note: "shipped in 1.4", externalRef: "#412" });
    const rows = pageOf(TriageViewSchema).parse(await json(await h.app.request(routes.triage(P))));
    expect(rows.items).toHaveLength(1);
    expect(rows.items[0]?.state).toBe("fixed");
    expect(rows.items[0]?.titleAtTriage).toBe("list_tasks pages badly");
    expect(rows.items[0]?.drifted).toBe(false);

    // The same signature, filed again: triaged `fixed` and back is a REGRESSION, and it stays at
    // the top of the screen rather than being buried under "known".
    const simulationId = (await ensureSimulation(h.store)).id;
    const results = SimulationResultsViewSchema.parse(await json(await h.app.request(routes.simulationResults(P, simulationId))));
    expect(results.clusters.find((c) => c.signature === signature)?.state).toBe("regressed");
    expect(results.known).toHaveLength(0);

    // Won't-fix is the one that goes below the fold, because nobody is going to do anything.
    await put(h.app, routes.triage(P), { signature, state: "wont-fix", note: "by design" });
    const after = SimulationResultsViewSchema.parse(await json(await h.app.request(routes.simulationResults(P, simulationId))));
    expect(after.clusters.map((c) => c.signature)).not.toContain(signature);
    expect(after.known.map((c) => c.signature)).toEqual([signature]);

    // Drift is a HASH question, not a string question. A judgement whose recorded title no longer
    // hashes to the signature it was filed under is sitting on a different problem, and says so —
    // which is what the `sig1:` version prefix exists to make loud rather than silent (ADR-0028).
    const filed = (await h.store.getTriage((await h.store.listProjects())[0]!.id, signature))!;
    await h.store.saveTriage({ ...filed, titleAtTriage: "create_project rejects a perfectly good name" });
    const drifted = pageOf(TriageViewSchema).parse(await json(await h.app.request(routes.triage(P))));
    expect(drifted.items[0]?.drifted).toBe(true);
    const onScreen = SimulationResultsViewSchema.parse(await json(await h.app.request(routes.simulationResults(P, simulationId))));
    expect(onScreen.known[0]?.triage?.drifted).toBe(true);
    // Punctuation and case do not move the key, so they are not drift. That is the whole of what
    // this proves: a GENUINE rewording — "list_tasks is paging badly", "the task list repeats a
    // row" — WOULD drift, because the key is a hash of an exact token set (see the measured
    // numbers in `stability.test.ts`), and the case above is what that looks like.
    await h.store.saveTriage({ ...filed, titleAtTriage: "list_tasks pages badly!" });
    expect(pageOf(TriageViewSchema).parse(await json(await h.app.request(routes.triage(P)))).items[0]?.drifted).toBe(false);
    await h.close();
  });

  it("puts a problem the latest execution no longer reports under Known once somebody says it is fixed", async () => {
    // The second execution finds nothing. Flipping the script mid-test is how "we shipped a fix"
    // is expressed offline: same simulation, same people, a target that no longer complains.
    let quiet = false;
    const h = await harness({ policy: (ctx) => (quiet ? { calls: [call("done", { summary: "all fine now", would_return: true })] } : complains(ctx)) });
    const first = (await json(await post(h.app, await runsRoute(h)))) as { runId: string };
    await h.jobs.idle();
    await h.runs.settled(first.runId);
    const signature = (await h.store.listFindings({ runIds: [first.runId] }))[0]!.signature;

    quiet = true;
    const second = (await json(await post(h.app, await runsRoute(h)))) as { runId: string };
    await h.jobs.idle();
    await h.runs.settled(second.runId);
    expect(await h.store.listFindings({ runIds: [second.runId] })).toHaveLength(0);

    const simulationId = (await ensureSimulation(h.store)).id;
    // An absence is something you can LOOK AT: the card is still on the screen, saying it is gone.
    // Vanishing silently is the opposite of the question the screen exists to answer.
    const before = SimulationResultsViewSchema.parse(await json(await h.app.request(routes.simulationResults(P, simulationId))));
    const card = before.clusters.find((c) => c.signature === signature);
    expect(card?.state).toBe("fixed");
    expect(card?.peopleHit).toBe(0);
    expect(card?.seenIn).toEqual([1]);
    expect(before.known).toHaveLength(0);

    // And once a human agrees it is fixed, it stops taking up room at the top.
    await put(h.app, routes.triage(P), { signature, state: "fixed", note: "shipped" });
    const known = SimulationResultsViewSchema.parse(await json(await h.app.request(routes.simulationResults(P, simulationId))));
    expect(known.clusters.map((c) => c.signature)).not.toContain(signature);
    expect(known.known.map((c) => c.signature)).toEqual([signature]);
    expect(known.known[0]?.state).toBe("fixed");
    await h.close();
  });

  /**
   * The other half of "an absence is evidence": an execution that has not visited is NOT an
   * absence. Pressing start writes the run row before the first visit lands, and a run that never
   * gets off the ground stays the newest execution forever — in neither case has anything been
   * fixed, and saying so would be the most damaging thing this screen could get wrong.
   */
  it("does not call a problem fixed because the newest execution has not visited yet", async () => {
    const h = await harness({ policy: complains });
    const first = (await json(await post(h.app, await runsRoute(h)))) as { runId: string };
    await h.jobs.idle();
    await h.runs.settled(first.runId);
    const simulationId = (await ensureSimulation(h.store)).id;
    const signature = (await h.store.listFindings({ runIds: [first.runId] }))[0]!.signature;

    const before = SimulationResultsViewSchema.parse(await json(await h.app.request(routes.simulationResults(P, simulationId))));
    expect(before.clusters.find((c) => c.signature === signature)?.state).toBe("new");

    const ran = (await h.store.getRun(first.runId))!;
    await h.store.saveRun({ ...ran, id: newRunId(), seq: ran.seq + 1, status: "pending", endedAt: null, totals: { agents: 0, activeAgents: 0, wakes: 0, findings: 0, confirmed: 0, costUsd: 0 } });

    const during = SimulationResultsViewSchema.parse(await json(await h.app.request(routes.simulationResults(P, simulationId))));
    const card = during.clusters.find((c) => c.signature === signature);
    expect(card?.state).toBe("new");
    expect(card?.peopleHit).toBeGreaterThan(0);
    expect(card?.seenIn).toEqual([1]);
    // The screen reports on the execution that has something to report, and the pending one is
    // where it belongs: in the history, waiting.
    expect(during.execution?.id).toBe(first.runId);
    expect(during.history.map((e) => e.seq)).toEqual([1, 2]);
    // And the project home does not announce a fix either.
    const overview = ProjectOverviewViewSchema.parse(await json(await h.app.request(routes.project(P))));
    expect(overview.simulations.find((sim) => sim.id === simulationId)?.fixedSinceLast).toBe(0);
    await h.close();
  });

  /**
   * A signature is a hash of an exact token set; the clusterer merges titles that are merely
   * similar. One problem therefore carries several keys, and the screen must not show it as two.
   */
  it("shows one problem once when a later execution words it differently", async () => {
    let reworded = false;
    const wording = (ctx: ScriptContext): { calls: ReturnType<typeof call>[] } => ({
      calls: [
        call("file_finding", {
          kind: "bug",
          title: reworded ? "list_tasks pages badly" : "list_tasks pages badly and repeats a row",
          description: "The second page repeats the last row of the first.",
          expected: "Each task appears once.",
          observed: "One task appeared twice.",
          severity: "high",
          confidence: 0.9,
          tool: "list_tasks",
          evidence_calls: [ctx.lastResults[0]?.ref ?? ""],
        }),
      ],
    });
    const h = await harness({
      policy: sequence([() => ({ calls: [call("list_tasks", {})] }), wording, () => ({ calls: [call("done", { summary: "had a look", would_return: true })] })]),
    });
    const first = (await json(await post(h.app, await runsRoute(h)))) as { runId: string };
    await h.jobs.idle();
    await h.runs.settled(first.runId);
    reworded = true;
    const second = (await json(await post(h.app, await runsRoute(h)))) as { runId: string };
    await h.jobs.idle();
    await h.runs.settled(second.runId);

    const firstSignature = (await h.store.listFindings({ runIds: [first.runId] }))[0]!.signature;
    const secondSignature = (await h.store.listFindings({ runIds: [second.runId] }))[0]!.signature;
    expect(secondSignature).not.toBe(firstSignature); // two keys...

    const simulationId = (await ensureSimulation(h.store)).id;
    const results = SimulationResultsViewSchema.parse(await json(await h.app.request(routes.simulationResults(P, simulationId))));
    // ...and one card. The old wording is not a second, `fixed` problem: it is this one, said
    // differently, and putting both on the screen says the search bug was fixed and is still here.
    expect(results.clusters).toHaveLength(1);
    expect(results.clusters.map((c) => c.state)).toEqual(["open"]);
    expect(results.clusters.map((c) => c.signature)).toEqual([secondSignature]);
    await h.close();
  });

  /** A comparison is counted against the two executions it is comparing, not against the newest. */
  it("counts each side of a comparison against that execution's own roster", async () => {
    const h = await harness({ policy: complains });
    const simulationId = (await ensureSimulation(h.store)).id;
    const ids: string[] = [];
    for (const size of [1, 1, 3]) {
      await put(h.app, routes.cohort(P, (await cohortsOf(h.store))[0]!.id), { size });
      const started = (await json(await post(h.app, routes.simulationRuns(P, simulationId)))) as { runId: string };
      await h.jobs.idle();
      await h.runs.settled(started.runId);
      ids.push(started.runId);
    }
    expect((await h.store.listAgents({ runId: ids[2]! }))).toHaveLength(3);

    const compared = ExecutionCompareViewSchema.parse(await json(await h.app.request(`${routes.simulationCompare(P, simulationId)}?a=${ids[0]!}&b=${ids[1]!}`)));
    const card = compared.persisting[0];
    expect(card).toBeDefined();
    // One person went on execution 2, so "1 of 1" — not "1 of 3", which is execution 3's headcount
    // and a number about nobody on this screen.
    expect(card?.peopleTotal).toBe(1);
    expect(card?.cohorts.map((cohort) => cohort.total)).toEqual([1]);
    await h.close();
  });

  /**
   * The key is hashed over the tool the finding NAMES or, failing that, the last tool it
   * reproduced with. A read model that recomputes it over the bare field would never match, and
   * every judgement on a finding that named no tool would read as sitting on a different problem.
   */
  it("keeps a judgement attached when the finding named no tool", async () => {
    const h = await harness({ policy: complainsWithoutTool });
    const started = (await json(await post(h.app, await runsRoute(h)))) as { runId: string };
    await h.jobs.idle();
    await h.runs.settled(started.runId);
    const finding = (await h.store.listFindings({ runIds: [started.runId] }))[0]!;
    expect(finding.tool).toBeUndefined();
    expect(finding.signature).toBe(signatureOf(finding.kind, "list_tasks", finding.title));

    await put(h.app, routes.triage(P), { signature: finding.signature, state: "fixed", note: "shipped" });
    const rows = pageOf(TriageViewSchema).parse(await json(await h.app.request(routes.triage(P))));
    expect(rows.items[0]?.titleAtTriage).toBe(finding.title);
    expect(rows.items[0]?.drifted).toBe(false);
    await h.close();
  });
});

/**
 * Deletion, and the thing it is actually for: a store you can get things OUT of. Every authored
 * row in the product could be created and none of the ones a user sees on a dashboard could be
 * removed, so a project made by mistake was permanent and the list only ever grew.
 */
describe("taking things out again", () => {
  const del = async (h: Harness, path: string): Promise<Response> => h.app.request(path, { method: "DELETE" });

  /** One real execution of the project's simulation, so there are produced rows to cascade over. */
  const oneExecution = async (h: Harness): Promise<string> => {
    const started = (await json(await post(h.app, await runsRoute(h)))) as { runId: string };
    await h.jobs.idle();
    await h.runs.settled(started.runId);
    return started.runId;
  };

  it("deletes a project and every row underneath it, produced rows included", async () => {
    const h = await harness({ policy: complains });
    const runId = await oneExecution(h);

    // Everything the cascade has to reach, asserted as present first: a test that deletes an
    // empty project and finds nothing left proves nothing at all.
    expect(await h.store.listTargets(P)).not.toHaveLength(0);
    expect(await h.store.listPersonas(P)).not.toHaveLength(0);
    expect(await h.store.listCohorts(P)).not.toHaveLength(0);
    expect(await h.store.listPeople({ projectId: P })).not.toHaveLength(0);
    expect(await h.store.listPopulations(P)).not.toHaveLength(0);
    expect(await h.store.listSimulations({ projectId: P })).not.toHaveLength(0);
    expect(await h.store.listRuns({ projectId: P })).not.toHaveLength(0);
    const wakes = await h.store.listWakes({ runIds: [runId] });
    expect(wakes).not.toHaveLength(0);
    expect(await h.store.listFindings({ runIds: [runId] })).not.toHaveLength(0);
    expect(await h.store.listAgents({ runId })).not.toHaveLength(0);
    expect(await h.store.getTrace(wakes[0]!.id)).not.toHaveLength(0);

    expect((await del(h, routes.project(P))).status).toBe(204);

    expect(await h.store.getProject(P)).toBeUndefined();
    expect(await h.store.listTargets(P)).toHaveLength(0);
    expect(await h.store.listPersonas(P)).toHaveLength(0);
    expect(await h.store.listCohorts(P)).toHaveLength(0);
    expect(await h.store.listPeople({ projectId: P })).toHaveLength(0);
    expect(await h.store.listPopulations(P)).toHaveLength(0);
    expect(await h.store.listSimulations({ projectId: P, includeArchived: true })).toHaveLength(0);
    expect(await h.store.listRuns({ projectId: P })).toHaveLength(0);
    expect(await h.store.getSettings(P)).toBeUndefined();

    // The produced rows are keyed by run, not by project, so this is the half a `DELETE FROM
    // projects` would have left behind: invisible in every screen and counted by every COUNT(*).
    expect(await h.store.listWakes({ runIds: [runId] })).toHaveLength(0);
    expect(await h.store.listFindings({ runIds: [runId] })).toHaveLength(0);
    expect(await h.store.listAgents({ runId })).toHaveLength(0);
    expect(await h.store.getTrace(wakes[0]!.id)).toHaveLength(0);

    // And the list the dashboard reads no longer has it — the actual complaint.
    expect(pageOf(ProjectSummaryViewSchema).parse(await json(await h.app.request(routes.projects))).items).toHaveLength(0);
    await h.close();
  });

  it("leaves the other project alone", async () => {
    const h = await harness();
    const created = await json(await post(h.app, routes.projects, { name: "Keep me" }));
    const keep = (created as { id: string; slug: string }).slug;
    const theirs = StoredTargetViewSchema.parse(
      await json(
        await post(h.app, routes.targets(keep), {
          name: "Their target",
          mcp: [{ name: "default", url: target.mcpUrl }],
          identity: { strategy: "self-signup" as const, signupTool: "sign_up", tokenPath: "token", emailDomain: "populace.test" },
        }),
      ),
    );

    expect((await del(h, routes.project(P))).status).toBe(204);

    expect(await h.store.getProject(P)).toBeUndefined();
    expect(pageOf(StoredTargetViewSchema).parse(await json(await h.app.request(routes.targets(keep)))).items.map((t) => t.id)).toEqual([theirs.id]);
    await h.close();
  });

  it("refuses to delete a project while an execution in it is running, and says which", async () => {
    const h = await harness();
    const runId = await oneExecution(h);

    // The controller's own `runningIds` is what the guard reads, and a scripted wake is over
    // before the next line of the test — there is no instant to race for. Holding the id here is
    // the same thing a live wake does, stated rather than raced for.
    const held = [runId];
    Object.defineProperty(h.runs, "runningIds", { get: () => held, configurable: true });

    const refused = await del(h, routes.project(P));
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("running");
    expect(await h.store.getProject(P)).toBeDefined();
    expect(await h.store.listTargets(P)).not.toHaveLength(0);

    held.length = 0;
    expect((await del(h, routes.project(P))).status).toBe(204);
    expect(await h.store.getProject(P)).toBeUndefined();
    await h.close();
  });

  it("refuses to delete a running execution on its own, too", async () => {
    const h = await harness();
    const runId = await oneExecution(h);
    Object.defineProperty(h.runs, "runningIds", { get: () => [runId], configurable: true });

    const refused = await del(h, routes.run(runId));
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("running");
    expect(await h.store.getRun(runId)).toBeDefined();
    await h.close();
  });

  it("still archives when asked to, so a caller that wants the row kept can have it", async () => {
    const h = await harness();
    expect((await del(h, `${routes.project(P)}?archive=1`)).status).toBe(204);
    const project = await h.store.getProject(P);
    expect(project?.archived).toBe(true);
    expect(await h.store.listTargets(P)).not.toHaveLength(0);
    await h.close();
  });

  it("deletes one execution and everything in it, and leaves its siblings whole", async () => {
    const h = await harness({ policy: complains });
    const first = await oneExecution(h);
    const second = await oneExecution(h);

    const wakes = await h.store.listWakes({ runIds: [first] });
    expect(wakes).not.toHaveLength(0);
    expect((await del(h, routes.run(first))).status).toBe(204);

    expect(await h.store.getRun(first)).toBeUndefined();
    expect(await h.store.listWakes({ runIds: [first] })).toHaveLength(0);
    expect(await h.store.listFindings({ runIds: [first] })).toHaveLength(0);
    expect(await h.store.listAgents({ runId: first })).toHaveLength(0);
    expect(await h.store.getTrace(wakes[0]!.id)).toHaveLength(0);

    // The other execution was independent of it to begin with, and stays that way.
    expect(await h.store.getRun(second)).toBeDefined();
    expect(await h.store.listWakes({ runIds: [second] })).not.toHaveLength(0);
    await h.close();
  });

  /**
   * The one refusal on an execution that is about the outside world: those rows are the only
   * record of which accounts this run made on somebody else's product.
   */
  it("refuses to delete an execution whose accounts are still on the target, until forced", async () => {
    const h = await harness({ policy: complains });
    const runId = await oneExecution(h);
    // Written rather than signed up for: the scripted model in this file never calls `sign_up`,
    // and what is under test is the refusal, not the capture that puts the row there.
    const agent = (await h.store.listAgents({ runId }))[0]!;
    await h.store.saveIdentity({
      id: "idn_still_there",
      runId,
      tag: tagForRun(runId),
      agentId: agent.id,
      personaId: agent.persona.id,
      strategy: "self-signup",
      credential: { email: "someone@populace.test", bearerToken: "tk_live", expiresAt: null, redeemable: null, extra: {} },
      createdAt: new Date().toISOString(),
      tornDownAt: null,
    });
    expect(await h.store.listIdentitiesByTag(tagForRun(runId))).not.toHaveLength(0);

    const refused = await del(h, routes.run(runId));
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("sweep");
    expect(await h.store.getRun(runId)).toBeDefined();

    expect((await del(h, `${routes.run(runId)}?force=1`)).status).toBe(204);
    expect(await h.store.getRun(runId)).toBeUndefined();
    await h.close();
  });

  it("archives a simulation that has run, and deletes it with its executions when told to", async () => {
    const h = await harness();
    const simulationId = (await ensureSimulation(h.store)).id;
    const runId = await oneExecution(h);

    // The default: off the list, executions untouched.
    expect((await del(h, routes.simulation(P, simulationId))).status).toBe(204);
    expect(await h.store.getRun(runId)).toBeDefined();
    expect((await h.store.getSimulation(simulationId))?.archived).toBe(true);

    expect((await del(h, `${routes.simulation(P, simulationId)}?runs=delete`)).status).toBe(204);
    expect(await h.store.getSimulation(simulationId)).toBeUndefined();
    expect(await h.store.getRun(runId)).toBeUndefined();
    await h.close();
  });

  /** A refusal that names what to take apart first, not a 500 (SPEC §2.14). */
  it("refuses a target a simulation still points at, and names the simulation", async () => {
    const h = await harness();
    await ensureSimulation(h.store);
    const targetId = (await h.store.listTargets(P))[0]!.id;

    const refused = await del(h, routes.target_(P, targetId));
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("simulation");
    expect(await h.store.getTarget(targetId)).toBeDefined();
    await h.close();
  });

  /**
   * `listTargets` orders `updated_at DESC`, so "the first target" always meant "whichever you
   * edited last" — a coin flip that got frozen onto a simulation row forever. One target still
   * defaults, because with one there is nothing to choose; several without a `targetId` is a
   * refusal that names them, because a 400 saying "ambiguous" is a puzzle.
   */
  it("refuses to guess which target a simulation visits, and names the choices", async () => {
    const h = await harness();
    const identity = { strategy: "self-signup" as const, signupTool: "sign_up", tokenPath: "token", userIdPath: "user.id", emailDomain: "populace.test" };

    // One target: it still defaults, and nothing has to say so.
    const one = await post(h.app, routes.simulations(P), { name: "First" });
    expect(one.status).toBe(201);

    // A second, and the guess stops.
    const qa = StoredTargetViewSchema.parse(await json(await post(h.app, routes.targets(P), { name: "Tasklet — qa", mcp: [{ name: "default", url: target.mcpUrl }], identity })));
    const refused = await post(h.app, routes.simulations(P), { name: "Second" });
    expect(refused.status).toBe(400);
    const why = await refused.text();
    expect(why).toContain("2 targets");
    expect(why).toContain("Tasklet — qa");

    // Saying which is all it wants.
    const said = await post(h.app, routes.simulations(P), { name: "Second", targetId: qa.id });
    expect(said.status).toBe(201);
    expect(SimulationSummaryViewSchema.parse(await json(said)).target.id).toBe(qa.id);

    // The prompt preview is a preview OF a target, so it keeps the same rule.
    const persona = (await h.store.listPersonas("default"))[0]!;
    const blind = await post(h.app, routes.personaPreview(P, persona.id));
    expect(blind.status).toBe(400);
    expect(await blind.text()).toContain("?target=");
    expect((await post(h.app, `${routes.personaPreview(P, persona.id)}?target=${qa.id}`)).status).toBe(200);
    await h.close();
  });

  /**
   * Three different refusals, and the order matters. Everything that has not been told which cast
   * to use resolves the population slugged `everyone` and falls back to `populations[0]` when
   * there is none, so deleting the default silently retargets five surfaces and deleting the last
   * one leaves them creating a fresh empty cast behind the reader's back. The Populations screen
   * puts a Remove button on exactly that row.
   */
  it("keeps the last population, keeps the default, and names the simulation that holds the rest", async () => {
    const h = await harness();
    await ensureSimulation(h.store);
    const everyone = await ensurePopulation(h.store, "default");

    // The only one does not go — before anything about simulations is considered.
    const onlyOne = await del(h, routes.population_(P, everyone.id));
    expect(onlyOne.status).toBe(409);
    expect(await onlyOne.text()).toContain("only population");

    // With a second one, the default still does not go, and the refusal says why.
    const spare = PopulationViewSchema.parse(await json(await post(h.app, routes.populations(P), { name: "Soak cast" })));
    const stillDefault = await del(h, routes.population_(P, everyone.id));
    expect(stillDefault.status).toBe(409);
    expect(await stillDefault.text()).toContain("default population");

    // A non-default population with nothing pointing at it goes.
    expect((await del(h, routes.population_(P, spare.id))).status).toBe(204);

    // ...and one a simulation names does not, with the simulation named.
    const used = PopulationViewSchema.parse(await json(await post(h.app, routes.populations(P), { name: "Used cast" })));
    const simulation = await ensureSimulation(h.store);
    await h.store.saveSimulation({ ...simulation, populationId: used.id, updatedAt: new Date().toISOString() });
    const refused = await del(h, routes.population_(P, used.id));
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("simulation");
    await h.close();
  });
});

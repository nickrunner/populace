import { StudySummaryViewSchema, SettingsViewSchema, routes } from "@populace/contract";
import { PopulaceConfigSchema, type PopulaceConfig, type Store } from "@populace/core";
import { SqliteStore } from "@populace/store-sqlite";
import type { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { ensureProject, ensureSettings, resolveSimulationConfig, seedProjectFromConfig, materialise } from "./config-store.js";
import { EventHub } from "./events.js";
import { JobRunner } from "./jobs.js";
import { RunController } from "./runs.js";
import type { TypesafeClient } from "@populace/reports";

/**
 * The two dials a review found could not be turned, and the screens that could not see them.
 *
 * Nothing here starts an execution, reaches a network or holds a key: both questions are about what
 * the wire says and what a PUT keeps, which is answered by the routes over a store in memory.
 */

const P = "default";
const processConfig = { store: { kind: "sqlite" as const, path: ":memory:" }, digestDir: "digests" };

/** A target nobody connects to and one person nobody sends: enough to author a study against. */
function config(): PopulaceConfig {
  return PopulaceConfigSchema.parse({
    target: { name: "Tasklet", mcp: [{ url: "http://127.0.0.1:4999/mcp" }], description: "Tasklet keeps your projects and tasks in one place." },
    identity: { strategy: "none" },
    population: {
      id: "tasklet",
      maxWakes: 2,
      members: [{ persona: { id: "casual-lister", name: "Casey Morgan", role: "a list keeper", backstory: "keeps a list", goals: ["keep a list"] } }],
    },
  });
}

interface Harness {
  app: Hono;
  store: Store;
  targetId: string;
  populationId: string;
  close: () => Promise<void>;
}

/** The real app over a real store, wired the way `serve` wires it, minus everything that spends. */
async function harness(options: { typesafe?: boolean } = {}): Promise<Harness> {
  const inner = new SqliteStore(":memory:");
  const store: Store = inner;
  await ensureProject(store);
  await ensureSettings(store);
  await seedProjectFromConfig(store, config());
  const hub = new EventHub();
  const jobs = new JobRunner(store);
  const runs = new RunController({
    store,
    // Nothing in this file starts an execution, and a provider that throws is how that is stated
    // rather than assumed: a test that quietly grew a run would fail here instead of calling a
    // model.
    provider: () => {
      throw new Error("nothing in this file runs a visit");
    },
    resolve: async (simulationId: string) => (await resolveSimulationConfig(store, processConfig, simulationId)).config,
    materialise: (simulationId: string) => materialise(store, simulationId),
  });
  const app = createApp({
    store,
    storePath: ":memory:",
    version: "test",
    configForRun: () => {
      throw new Error("no execution in this file has a snapshot to restore");
    },
    control: {
      store,
      processConfig,
      hasApiKey: () => true,
      jobs,
      runs,
      hub,
      configForRun: () => {
        throw new Error("no execution in this file has a snapshot to restore");
      },
      sweep: () => Promise.resolve({ identities: 0, removed: 0, preExisting: 0, stranded: 0, failures: 0, lines: [] }),
      // The typed judge's client IS the flag for its key (`ControlDeps.typesafe`). It is never
      // called here — nothing in this file verifies anything — so a thunk that would throw is the
      // honest double: what is under test is whether its presence reaches the wire.
      ...(options.typesafe === true
        ? {
            typesafe: (): TypesafeClient => {
              throw new Error("nothing in this file may ask the typed judge anything");
            },
          }
        : {}),
    },
  });
  const targets = await store.listTargets(P);
  const populations = await store.listPopulations(P);
  const targetId = targets[0]?.id;
  const populationId = populations[0]?.id;
  if (targetId === undefined || populationId === undefined) throw new Error("the seed wrote no target or no population");
  return { app, store, targetId, populationId, close: () => inner.close() };
}

// eslint-disable-next-line no-restricted-syntax -- HTTP boundary: every caller parses with a contract schema.
type ResponseBody = unknown;

const json = async (res: Response): Promise<ResponseBody> => {
  expect(res.status, await res.clone().text()).toBeLessThan(400);
  return res.json();
};
const post = async (app: Hono, path: string, body: object = {}): Promise<Response> => app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const put = async (app: Hono, path: string, body: object): Promise<Response> => app.request(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/**
 * ADR-0045: how often a study stops to report is how often populace writes into somebody's issue
 * tracker — the automatic path's own worst hazard, and the ADR calls this the dial for it. It was
 * on the stored schema and on nothing a person or a file could reach, so the dial could not be
 * turned at all.
 */
describe("a study's report cycle", () => {
  it("is set on the way in, comes back on the study, and a patch keeps what it did not mention", async () => {
    const h = await harness();
    const made = StudySummaryViewSchema.parse(
      await json(await post(h.app, routes.studies(P), { name: "Soak", targetId: h.targetId, populationId: h.populationId, size: 2, reportCycle: { every: "6h", everyVisits: 40 } })),
    );
    // The two fields the body named, and the schema's own for the two it did not.
    expect(made.reportCycle).toEqual({ every: 6 * 3_600_000, jitter: 300_000, initialDelay: 0, everyVisits: 40 });

    // A patch that mentions one field leaves the other three exactly as they were. This is the
    // whole reason the input carries no defaults of its own: `.partial()` of the stored schema
    // would have arrived here carrying a jitter and a visit count nobody sent.
    const patched = StudySummaryViewSchema.parse(await json(await put(h.app, routes.study(P, made.id), { reportCycle: { jitter: "90s" } })));
    expect(patched.reportCycle).toEqual({ every: 6 * 3_600_000, jitter: 90_000, initialDelay: 0, everyVisits: 40 });

    // Null is a choice — the clock as the only trigger — and survives as one.
    const untimed = StudySummaryViewSchema.parse(await json(await put(h.app, routes.study(P, made.id), { reportCycle: { everyVisits: null } })));
    expect(untimed.reportCycle?.everyVisits).toBeNull();

    // A save that says nothing about it changes nothing about it, which is what lets a rhythm set
    // in `populace.yaml` survive somebody renaming the study in the browser.
    const renamed = StudySummaryViewSchema.parse(await json(await put(h.app, routes.study(P, made.id), { name: "Soak, longer" })));
    expect(renamed.reportCycle).toEqual({ every: 6 * 3_600_000, jitter: 90_000, initialDelay: 0, everyVisits: null });

    // And the builder opens on a study read on its own, so that is where it has to be.
    const read = StudySummaryViewSchema.parse(await json(await h.app.request(routes.study(P, made.id))));
    expect(read.reportCycle).toEqual(renamed.reportCycle);
    await h.close();
  });

  it("is what the row already holds when nobody has set one", async () => {
    const h = await harness();
    const made = StudySummaryViewSchema.parse(await json(await post(h.app, routes.studies(P), { name: "Plain", targetId: h.targetId, populationId: h.populationId, size: 1 })));
    expect(made.reportCycle?.every).toBe(3_600_000);
    expect(made.reportCycle?.jitter).toBeGreaterThan(0);
    await h.close();
  });
});

/**
 * The typed judge is offered on the settings screen and recommended there on price for the
 * unattended cycle — and the screen had no way to know whether this install has the key it needs.
 * A judge with no key does not degrade to the free one, it refuses, so the choice could silently
 * break every automatic report for ever with the reason only on a job row.
 */
describe("what keys the settings view admits to", () => {
  it("says the typed judge's key is absent when this process has no client for it", async () => {
    const h = await harness();
    const view = SettingsViewSchema.parse(await json(await h.app.request(routes.settings(P))));
    expect(view.hasTypesafeKey).toBe(false);
    expect(view.hasApiKey).toBe(true);
    await h.close();
  });

  it("says it is there when it is", async () => {
    const h = await harness({ typesafe: true });
    const view = SettingsViewSchema.parse(await json(await h.app.request(routes.settings(P))));
    expect(view.hasTypesafeKey).toBe(true);

    // And the key itself is nowhere near the wire: the flag is a boolean and the only one.
    const body = await (await h.app.request(routes.settings(P))).text();
    expect(body).not.toMatch(/TYPESAFE_API_KEY|sk-|apiKey/);
    await h.close();
  });
});

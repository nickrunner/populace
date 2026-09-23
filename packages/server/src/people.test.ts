import { JobViewSchema, PersonViewSchema, ProjectOverviewViewSchema, pageOf, routes, type PersonView } from "@populace/contract";
import { PersonaSpecSchema, nameFrom, newCohortId, newPersonaId, type Cohort, type Store, type StoredPersona } from "@populace/core";
import { ScriptedProvider, call, type ScriptContext, type ScriptPolicy } from "@populace/runner/testing";
import { SqliteStore } from "@populace/store-sqlite";
import { describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { createApp } from "./app.js";
import { ensurePopulation, ensureProject, ensureSettings, setPopulationMember } from "./config-store.js";
import { EventHub, RecordingStore } from "./events.js";
import { JobRunner } from "./jobs.js";
import { RunController } from "./runs.js";

/**
 * Stage 6: who the people in a cohort are, and what it costs to find out.
 *
 * Every test here runs offline. Tier 1 — the seeded name bank — needs no key at all, and tier 2
 * is driven by `ScriptedProvider`, so "the model wrote this cohort" is exercised without a single
 * live call. That is deliberate: person generation is the first model spend outside a wake, and a
 * test suite that could only cover it by spending money would not cover it.
 */

const P = "default";

const SPEC = PersonaSpecSchema.parse({
  id: "weekend-planner",
  name: "Weekend planner",
  role: "someone organising their own weekend",
  backstory: "They keep a short list and look at it twice a week.",
  goals: ["keep a list"],
});

interface Harness {
  app: Hono;
  store: Store;
  jobs: JobRunner;
  cohort: Cohort;
  persona: StoredPersona;
  /** How many model calls the writer has made. */
  calls(): number;
  close(): Promise<void>;
}

/**
 * A project with one persona and one cohort, wired the way `serve` wires it, minus the target: no
 * run is ever started here, so nothing needs an MCP endpoint.
 */
async function harness(options: { size?: number; policy?: ScriptPolicy; provider?: boolean; onCall?: (turn: number, store: Store) => void } = {}): Promise<Harness> {
  const inner = new SqliteStore(":memory:");
  const hub = new EventHub();
  const store: Store = new RecordingStore(inner, hub.publish);
  await ensureProject(store);
  await ensureSettings(store);

  const at = new Date().toISOString();
  const persona: StoredPersona = { id: newPersonaId(), projectId: P, slug: "weekend-planner", spec: SPEC, origin: "authored", createdAt: at, updatedAt: at };
  await store.savePersona(persona);
  const cohort: Cohort = {
    id: newCohortId(),
    projectId: P,
    slug: "weekenders",
    name: "Weekenders",
    context: "You plan your weekends on your phone, on the train home on Fridays.",
    mix: [{ personaId: persona.id, weight: 1 }],
    traits: {},
    tools: { allow: [], deny: [], destructive: "confirm" },
    model: {},
    seed: "populace",
    notes: "",
    createdAt: at,
    updatedAt: at,
  };
  await store.saveCohort(cohort);
  // A cohort has no size of its own: the population that sends it says how many (ADR-0039).
  await setPopulationMember(store, await ensurePopulation(store), cohort.id, options.size ?? 5);

  const provider = new ScriptedProvider(options.policy ?? roster((turn) => options.onCall?.(turn, store)));
  const jobs = new JobRunner(store);
  const runs = new RunController({ store, provider: () => provider, resolve: () => Promise.reject(new Error("no runs in this file")) });
  const app = createApp({
    store,
    storePath: ":memory:",
    version: "test",
    control: {
      store,
      processConfig: { store: { kind: "sqlite", path: ":memory:" }, digestDir: "digests" },
      hasApiKey: () => options.provider !== false,
      // Absent is exactly "this process has no ANTHROPIC_API_KEY", which is what the seeded
      // fallback exists for.
      ...(options.provider === false ? {} : { provider: (): ScriptedProvider => provider }),
      jobs,
      runs,
      hub,
      configForRun: () => Promise.reject(new Error("no runs in this file")),
      sweep: () => Promise.resolve({ identities: 0, removed: 0, preExisting: 0, stranded: 0, failures: 0, lines: [] }),
    },
  });
  return { app, store, jobs, cohort, persona, calls: () => provider.requests.length, close: () => inner.close() };
}

/**
 * A model that fills every slot it is handed. The names are obviously not from the seeded bank,
 * which is how a test tells the two tiers apart.
 */
function roster(onCall: (turn: number) => void = () => undefined): ScriptPolicy {
  return (ctx: ScriptContext) => {
    onCall(ctx.turn);
    const ordinals = [...ctx.messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n").matchAll(/by ordinal: ([\d, ]+)/g)].flatMap((match) => (match[1] ?? "").split(",").map((n) => Number.parseInt(n.trim(), 10)));
    return {
      calls: [
        call("write_people", {
          people: ordinals.map((ordinal) => ({ ordinal, name: `Written Person ${ordinal + 1}`, details: `Writes lists on a train, slot ${ordinal + 1}.` })),
        }),
      ],
    };
  };
}

const post = async (app: Hono, path: string, body: object = {}): Promise<Response> => app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const patch = async (app: Hono, path: string, body: object): Promise<Response> => app.request(path, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** What the seeded bank draws for the first `count` slots of the harness's cohort. */
function seededNames(count: number): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const name = nameFrom(`populace:weekenders.weekend-planner:${ordinal}`, used);
    used.add(name);
    out.push(name);
  }
  return out;
}

// eslint-disable-next-line no-restricted-syntax -- HTTP boundary: every caller parses with a contract schema.
type ResponseBody = unknown;

const json = async (res: Response): Promise<ResponseBody> => {
  expect(res.status, await res.clone().text()).toBeLessThan(400);
  return res.json();
};

/** Runs the generate job for a cohort and waits for the queue to settle. */
async function generate(h: Harness, path: string, body: object = {}): Promise<Response> {
  const res = await post(h.app, path, body);
  await h.jobs.idle();
  return res;
}

const rosterOf = async (h: Harness): Promise<PersonView[]> =>
  pageOf(PersonViewSchema).parse(await json(await h.app.request(routes.cohortPeople(P, h.cohort.id)))).items;

describe("writing a cohort's people", () => {
  it("writes every slot once and then has nothing left to write", async () => {
    const h = await harness({ size: 5 });
    await generate(h, routes.cohortPeople(P, h.cohort.id));

    const first = await rosterOf(h);
    expect(first).toHaveLength(5);
    expect(first.filter((person) => person.generatedBy === "model")).toHaveLength(5);
    expect(new Set(first.map((person) => person.name)).size).toBe(5);
    expect(first.every((person) => person.details !== "")).toBe(true);
    expect(h.calls()).toBe(1);

    // The second run has no placeholder left to claim, so it spends nothing and changes nobody.
    await generate(h, routes.cohortPeople(P, h.cohort.id));
    expect(h.calls()).toBe(1);
    expect(await rosterOf(h)).toEqual(first);
    await h.close();
  });

  it("falls back to the seeded bank when the model is unavailable, and the names are the seeded ones", async () => {
    const seeded = async (h: Harness): Promise<string[]> => (await rosterOf(h)).map((person) => person.name);
    // What `nameFrom` produces for these seeds, drawn exactly as the roster draws them.
    const expected: string[] = [];
    const used = new Set<string>();
    for (let ordinal = 0; ordinal < 3; ordinal++) {
      const name = nameFrom(`populace:weekenders.weekend-planner:${ordinal}`, used);
      used.add(name);
      expected.push(name);
    }

    const noKey = await harness({ size: 3, provider: false });
    await generate(noKey, routes.cohortPeople(P, noKey.cohort.id));
    expect((await rosterOf(noKey)).every((person) => person.generatedBy === "seeded")).toBe(true);
    expect(await seeded(noKey)).toEqual(expected);
    await noKey.close();

    const broken = await harness({
      size: 3,
      policy: () => {
        throw new Error("the model was unreachable");
      },
    });
    await generate(broken, routes.cohortPeople(P, broken.cohort.id));
    const after = await rosterOf(broken);
    expect(after.every((person) => person.generatedBy === "seeded")).toBe(true);
    expect(after.map((person) => person.name)).toEqual(expected);
    // A model that could not be reached is not a job that failed: the cohort has a full cast.
    const job = JobViewSchema.parse(await json(await broken.app.request(routes.job((await broken.store.listJobs({}))[0]!.id))));
    expect(job.status).toBe("succeeded");
    expect(job.progress.label).toContain("unreachable");
    await broken.close();
  });

  it("gives the same five people back after a cohort shrinks and grows again", async () => {
    const h = await harness({ size: 5 });
    await generate(h, routes.cohortPeople(P, h.cohort.id));
    const original = (await rosterOf(h)).map((person) => person.name);
    expect(original).toHaveLength(5);

    await setPopulationMember(h.store, await ensurePopulation(h.store), h.cohort.id, 3);
    const shrunk = await rosterOf(h);
    expect(shrunk.filter((person) => !person.archived)).toHaveLength(3);

    await setPopulationMember(h.store, await ensurePopulation(h.store), h.cohort.id, 5);
    const grown = await rosterOf(h);
    expect(grown.map((person) => person.name)).toEqual(original);
    // Nobody was re-cast on the way back up: the two who came back are the two who left.
    expect(h.calls()).toBe(1);
    await h.close();
  });

  /**
   * The writer claims a slot only while it still holds what the seeded bank put there. A rename
   * with no details left the row looking exactly like that — seeded, blank — so the next generate
   * took the typed name back and re-derived the handle the rename had deliberately not moved.
   */
  it("never writes over a name somebody typed, even when they left the details empty", async () => {
    const h = await harness({ size: 3 });
    const before = await rosterOf(h);
    const mine = before[1]!;

    const renamed = PersonViewSchema.parse(await json(await patch(h.app, routes.cohortPerson(P, h.cohort.id, mine.id), { name: "Hand Typed" })));
    expect(renamed.name).toBe("Hand Typed");
    expect(renamed.generatedBy).toBe("authored");
    expect(renamed.handle).toBe(mine.handle);

    await generate(h, routes.cohortPeople(P, h.cohort.id));
    const after = await rosterOf(h);
    expect(after[1]?.name).toBe("Hand Typed");
    expect(after[1]?.handle).toBe(mine.handle);
    expect(after[1]?.generatedBy).toBe("authored");
    // The slots nobody touched are the model's, and only those.
    expect(after.filter((person) => person.generatedBy === "model")).toHaveLength(2);
    await h.close();
  });

  it("re-casts the people it was asked for and leaves the other empty slots alone", async () => {
    const h = await harness({ size: 1 });
    await generate(h, routes.cohortPeople(P, h.cohort.id));
    expect((await rosterOf(h)).map((person) => person.name)).toEqual(["Written Person 1"]);

    // Two more slots, still holding the seeded bank's names.
    await setPopulationMember(h.store, await ensurePopulation(h.store), h.cohort.id, 3);
    const grown = await rosterOf(h);
    expect(grown.slice(1).map((person) => person.generatedBy)).toEqual(["seeded", "seeded"]);

    // "Re-cast this one person" is a price quoted for one person. Everything else is untouched —
    // including the placeholders, which a plain generate would have been the way to ask for.
    await generate(h, routes.cohortPeopleRegenerate(P, h.cohort.id), { personIds: [grown[0]!.id], confirm: true });
    const after = await rosterOf(h);
    expect(after[0]?.generatedBy).toBe("model");
    expect(after.slice(1).map((person) => person.generatedBy)).toEqual(["seeded", "seeded"]);
    expect(after.slice(1).map((person) => person.name)).toEqual(grown.slice(1).map((person) => person.name));
    expect(after.slice(1).every((person) => person.details === "")).toBe(true);
    await h.close();
  });

  /**
   * A confirmed re-cast that reaches nobody is a failure. The rows have already been let go of by
   * the time the model is asked, so "kept the old name, lost the sentence, labelled seeded" is the
   * one outcome that must not be reported as success.
   */
  it("leaves a genuinely seeded cast, and a failed job, when a re-cast cannot reach the model", async () => {
    let broken = false;
    const writes = roster();
    const h = await harness({
      size: 2,
      policy: (ctx: ScriptContext) => {
        if (broken) throw new Error("the model was unreachable");
        return writes(ctx);
      },
    });
    await generate(h, routes.cohortPeople(P, h.cohort.id));
    const written = await rosterOf(h);
    expect(written.map((person) => person.name)).toEqual(["Written Person 1", "Written Person 2"]);

    broken = true;
    const queued = JobViewSchema.parse(await json(await post(h.app, routes.cohortPeopleRegenerate(P, h.cohort.id), { confirm: true })));
    await h.jobs.idle();
    const job = JobViewSchema.parse(await json(await h.app.request(routes.job(queued.id))));
    // Not a quiet success: the cast the user asked to replace is gone, and nothing replaced it.
    expect(job.status).toBe("failed");
    expect(job.error).toContain("unreachable");

    const after = await rosterOf(h);
    // Seeded rows, not model-written names wearing a seeded label with the sentence stripped out.
    expect(after.every((person) => person.generatedBy === "seeded")).toBe(true);
    expect(after.every((person) => person.details === "")).toBe(true);
    expect(after.map((person) => person.name)).toEqual(seededNames(2));
    await h.close();
  });

  it("refuses to re-cast people without being told that it changes who they are", async () => {
    const h = await harness({ size: 3 });
    await generate(h, routes.cohortPeople(P, h.cohort.id));
    const before = await rosterOf(h);

    const refused = await post(h.app, routes.cohortPeopleRegenerate(P, h.cohort.id), {});
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("confirm");
    await h.jobs.idle();
    expect(await rosterOf(h)).toEqual(before);
    expect(h.calls()).toBe(1);

    // With the acknowledgement, the same slots are written again — by the model, from scratch.
    await generate(h, routes.cohortPeopleRegenerate(P, h.cohort.id), { confirm: true });
    expect(h.calls()).toBe(2);
    expect((await rosterOf(h)).every((person) => person.generatedBy === "model")).toBe(true);
    await h.close();
  });
});

describe("spending money outside a wake", () => {
  /**
   * SPEC §5.4. ADR-0009 put every ceiling inside `runWake` because that was the only thing that
   * called the model. This is the first thing that is not, so the kill switch has to reach it —
   * including part-way through, which is the only moment at which engaging one is interesting.
   */
  it("stops between batches when the kill switch goes on, and the row says what it spent", async () => {
    // Engaged the moment the first batch has been written, which is where a human would reach for
    // it: the interesting case is not "refused before it started", it is "stopped part-way".
    const h = await harness({ size: 6, onCall: (turn, store) => { if (turn === 1) void store.setKillSwitch(true, "that is enough for today"); } });
    const settings = await h.store.getSettings(P);
    expect(settings).toBeDefined();
    // Three batches of two, so there are two moments between batches at which to be stopped.
    await h.store.saveSettings({ ...settings!, guardrails: { ...settings!.guardrails, maxPeoplePerGenerate: 2 } });

    const queued = JobViewSchema.parse(await json(await post(h.app, routes.cohortPeople(P, h.cohort.id))));
    await h.jobs.idle();

    const job = JobViewSchema.parse(await json(await h.app.request(routes.job(queued.id))));
    expect(job.status).toBe("failed");
    expect(job.error).toContain("that is enough for today");
    // It stopped rather than finishing: one batch of two, not three.
    expect(h.calls()).toBe(1);
    expect((await rosterOf(h)).filter((person) => person.generatedBy === "model")).toHaveLength(2);
    // What it spent before it was stopped is on the row, and counts against the project's day.
    expect(job.costUsd).toBeGreaterThan(0);
    expect(await h.store.costSince({ projectId: P, kind: "authoring" }, new Date(Date.now() - 86_400_000))).toBeCloseTo(job.costUsd, 8);
    await h.close();
  });

  it("keeps authoring spend and visit spend apart under one project ceiling", async () => {
    const h = await harness({ size: 2 });
    await generate(h, routes.cohortPeople(P, h.cohort.id));
    const since = new Date(Date.now() - 86_400_000);
    const authoring = await h.store.costSince({ projectId: P, kind: "authoring" }, since);
    expect(authoring).toBeGreaterThan(0);
    // No run has happened, so visits cost nothing and the project's whole day is authoring.
    expect(await h.store.costSince({ projectId: P, kind: "visits" }, since)).toBe(0);
    expect(await h.store.costSince({ projectId: P }, since)).toBeCloseTo(authoring, 8);
    // A population-scoped question is about visits and never sees authoring at all.
    expect(await h.store.costSince({ populationId: "weekenders" }, since)).toBe(0);

    // And the screen that shows the ceiling shows the spend the ceiling is measured against. The
    // writer refuses at `costSince({projectId})`, so a project overview that summed wake rows
    // instead would read $0.00 of $10 while the next job was already being refused.
    const overview = ProjectOverviewViewSchema.parse(await json(await h.app.request(routes.project(P))));
    // Loosely, because the view rounds to the cent-and-a-bit a screen can show.
    expect(overview.spentTodayUsd).toBeCloseTo(authoring, 3);
    expect(overview.costLast7dUsd).toBeCloseTo(authoring, 3);
    expect(overview.dailyCeilingUsd).toBeGreaterThan(0);
    await h.close();
  });

  it("will not write people while an execution is reading them", async () => {
    const h = await harness({ size: 3 });
    const at = new Date().toISOString();
    await h.store.saveRun({
      id: "run_a_aaaaaa",
      projectId: P,
      simulationId: "sim_x",
      seq: 1,
      mode: "longitudinal",
      targetId: "tgt_x",
      populationId: "everyone",
      label: "",
      status: "running",
      configSnapshotId: "cfg_x",
      parentRunId: null,
      continuation: null,
      pauseReason: null,
      resumes: 0,
      lastResumedAt: null,
      sweptAt: null,
      startedAt: at,
      endedAt: null,
      totals: { agents: 0, activeAgents: 0, wakes: 0, findings: 0, confirmed: 0, costUsd: 0 },
    });
    const refused = await post(h.app, routes.cohortPeople(P, h.cohort.id));
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("reading these people");
    expect(h.calls()).toBe(0);
    await h.close();
  });
});

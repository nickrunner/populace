import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PopulaceConfigSchema, type JsonValue, type PopulaceConfig, type Run, type Store } from "@populace/core";
import type { ModelProvider } from "@populace/runner";
import { SqliteStore } from "@populace/store-sqlite";
import { describe, expect, it } from "vitest";
import { snapshotConfig } from "./config-store.js";
import { RunController } from "./runs.js";

function poolFile(contents: JsonValue): string {
  const dir = mkdtempSync(join(tmpdir(), "populace-pool-"));
  const file = join(dir, "creds.json");
  writeFileSync(file, JSON.stringify(contents));
  return file;
}

/** A refused start never builds a daemon, so it never asks for a provider at all. */
const noProvider = (): ModelProvider => {
  throw new Error("no model provider: a refused start never reaches one");
};

/** A daemon IS built below, but nothing in these tests gets as far as a visit. */
const stubProvider = (): ModelProvider => ({ name: "stub", complete: () => Promise.reject(new Error("no visit should happen here")) });

/** A paused (or running) longitudinal row with `config` frozen behind it, and nothing ticking. */
async function seedRun(store: Store, config: PopulaceConfig, status: Run["status"]): Promise<Run> {
  const snapshot = await snapshotConfig(store, config);
  const run: Run = {
    id: "run_seeded",
    projectId: "prj_1",
    simulationId: config.simulation.id,
    seq: 1,
    mode: "longitudinal",
    targetId: "tgt_1",
    populationId: config.population.id,
    label: "a run",
    status,
    configSnapshotId: snapshot.id,
    parentRunId: null,
    continuation: null,
    pauseReason: status === "paused" ? "user" : null,
    resumes: 0,
    lastResumedAt: null,
    sweptAt: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    totals: { agents: 0, activeAgents: 0, wakes: 0, findings: 0, confirmed: 0, costUsd: 0 },
  };
  await store.saveRun(run);
  return run;
}

/** Two cohorts, both on the one persona — the shape that makes a persona-keyed pool ambiguous. */
function config(file: string, sizes: { weekenders: number; sceptics: number }): PopulaceConfig {
  const persona = { id: "lister", name: "List keeper", role: "a hobbyist", backstory: "Has too many lists.", goals: ["keep a list"] };
  return PopulaceConfigSchema.parse({
    simulation: { id: "sim_static", slug: "static", name: "Static", mode: "ephemeral", visitsPerPerson: 1 },
    target: { name: "Tasklet", mcp: [{ url: "http://127.0.0.1:4999/mcp" }] },
    identity: { strategy: "static", file },
    population: {
      id: "everyone",
      cadence: { every: "1h" },
      members: [
        { cohort: "weekenders", cohortName: "Weekenders", persona, count: sizes.weekenders },
        { cohort: "sceptics", cohortName: "Sceptics", persona, count: sizes.sceptics },
      ],
    },
  });
}

async function startWith(cfg: PopulaceConfig): Promise<{ error: string | null; runs: number }> {
  const store = new SqliteStore(":memory:");
  // These starts are refused before a daemon is built, so the model provider is never reached.
  const controller = new RunController({ store, provider: noProvider });
  let error: string | null = null;
  try {
    await controller.start({ config: cfg, projectId: "prj_1", simulationId: cfg.simulation.id, targetId: "tgt_1", label: "a run" });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const runs = (await store.listRuns({})).length;
  await store.close();
  return { error, runs };
}

/**
 * The property is "every person gets their own account", and it is a property of the POPULATION.
 * The identity provider sees one agent at a time and cannot check it: a pool one entry short, or
 * one legacy pool serving two cohorts that both number their people from 1, looks fine agent by
 * agent and collides across them. So it is asserted where the population is visible — when a run
 * is starting, before a snapshot is written, before an ephemeral start resets the target, and
 * before a penny is spent on a model call.
 */
describe("starting a run on a static pool", () => {
  it("refuses an ambiguous pool, naming the cohorts that would share it", async () => {
    // Four entries under one persona id: enough for everybody, and still unusable, because
    // weekenders#1 and sceptics#1 are both person 1 and would both take entry 1.
    const file = poolFile({ lister: [{ bearerToken: "a" }, { bearerToken: "b" }, { bearerToken: "c" }, { bearerToken: "d" }] });
    const { error, runs } = await startWith(config(file, { weekenders: 2, sceptics: 2 }));
    expect(error).toContain("every person needs their own account");
    expect(error).toContain("weekenders");
    expect(error).toContain("sceptics");
    expect(error).toContain("byCohort");
    expect(runs).toBe(0);
  });

  it("refuses a pool that is too small, naming the pool, the headcount and the file", async () => {
    const file = poolFile({ byCohort: { weekenders: [{ bearerToken: "a" }, { bearerToken: "b" }, { bearerToken: "c" }], sceptics: [{ bearerToken: "s" }] } });
    const { error, runs } = await startWith(config(file, { weekenders: 10, sceptics: 1 }));
    expect(error).toContain('"weekenders"');
    expect(error).toContain("3 entries");
    expect(error).toContain("10 people need an account");
    expect(error).toContain(file);
    expect(runs).toBe(0);
  });
});

/**
 * The check refuses things, and a refusal has to leave the run EXACTLY where it was. Both of these
 * wrote the run row first and reconciled second, so the refusal landed on a row that already
 * claimed the new state — and in both cases the user could not simply try again afterwards.
 */
describe("a run refused by the identity check", () => {
  it("stays paused when a resume is refused, so it can be picked back up once the pool is fixed", async () => {
    const store = new SqliteStore(":memory:");
    const file = poolFile({ byCohort: { weekenders: [{ bearerToken: "w1" }], sceptics: [{ bearerToken: "s1" }] } });
    const cfg = config(file, { weekenders: 1, sceptics: 1 });
    await seedRun(store, cfg, "paused");
    // The pool is edited down while the run sits paused — the file is not part of the snapshot.
    writeFileSync(file, JSON.stringify({ byCohort: { weekenders: [{ bearerToken: "w1" }], sceptics: [] } }));

    const controller = new RunController({ store, provider: stubProvider, resolve: () => Promise.resolve(cfg) });
    await expect(controller.resume("run_seeded")).rejects.toThrow(/identities/);

    const after = await store.getRun("run_seeded");
    expect(after?.status).toBe("paused");
    expect(controller.isRunning("run_seeded")).toBe(false);

    // And it can still be TRIED again: a row left saying `running` with no daemon behind it fails
    // the next attempt with "only a paused execution can be picked back up", which is a dead end
    // the user has to guess their way out of by pausing a run that is not going.
    await expect(controller.resume("run_seeded")).rejects.toThrow(/identities/);
    await store.close();
  });

  /**
   * The retry is the real defect. A config snapshot is CONTENT-ADDRESSED and the pool file's
   * contents are not part of the config — only its path is — so adding the missing entries and
   * applying again mints the same snapshot id. If the failed attempt has already written that id
   * onto the run row, the second call sees `snapshot.id === run.configSnapshotId`, returns early
   * and answers 200 having created nobody.
   */
  it("leaves the run on its old config when an apply is refused, and applies it on the retry", async () => {
    const store = new SqliteStore(":memory:");
    const file = poolFile({ byCohort: { weekenders: [{ bearerToken: "w1" }], sceptics: [{ bearerToken: "s1" }] } });
    const before = config(file, { weekenders: 1, sceptics: 1 });
    const seeded = await seedRun(store, before, "running");
    // The edit: a second weekender, with no second weekender account to give them.
    const after = config(file, { weekenders: 2, sceptics: 1 });

    const controller = new RunController({ store, provider: stubProvider, resolve: () => Promise.resolve(after) });
    await expect(controller.applyChanges("run_seeded")).rejects.toThrow(/identities/);
    expect((await store.getRun("run_seeded"))?.configSnapshotId).toBe(seeded.configSnapshotId);

    // The user adds the entry they were told to add and asks again. The snapshot id is the same
    // one the refused attempt would have written, so this only works if that attempt wrote nothing.
    writeFileSync(file, JSON.stringify({ byCohort: { weekenders: [{ bearerToken: "w1" }, { bearerToken: "w2" }], sceptics: [{ bearerToken: "s1" }] } }));
    const applied = await controller.applyChanges("run_seeded");
    expect(applied.configSnapshotId).not.toBe(seeded.configSnapshotId);
    expect((await store.listAgents({ runId: "run_seeded" })).length).toBe(3);
    await store.close();
  });
});

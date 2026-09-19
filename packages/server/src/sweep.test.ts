import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PopulaceConfigSchema, tagForRun, type Finding, type Identity, type JsonValue, type PopulaceConfig, type Run, type Store } from "@populace/core";
import { SqliteStore } from "@populace/store-sqlite";
import { describe, expect, it } from "vitest";
import { sweepRun } from "./sweep.js";

const RUN_ID = "run_swept";

function poolFile(contents: JsonValue): string {
  const dir = mkdtempSync(join(tmpdir(), "populace-sweep-"));
  const file = join(dir, "creds.json");
  writeFileSync(file, JSON.stringify(contents));
  return file;
}

function config(identity: JsonValue): PopulaceConfig {
  return PopulaceConfigSchema.parse({
    simulation: { id: "sim_1", slug: "s", name: "S", mode: "ephemeral", visitsPerPerson: 1 },
    target: { name: "Tasklet", mcp: [{ url: "http://127.0.0.1:4999/mcp" }] },
    identity,
    population: {
      id: "pop",
      cadence: { every: "1h" },
      members: [
        {
          cohort: "casual",
          cohortName: "Casual",
          persona: { id: "casual", name: "Casual", role: "a hobbyist", backstory: "Keeps lists.", goals: ["keep a list"] },
          count: 1,
        },
      ],
    },
  });
}

async function seed(store: Store, strategy: Identity["strategy"]): Promise<void> {
  const run: Run = {
    id: RUN_ID,
    projectId: "prj_1",
    simulationId: "sim_1",
    seq: 1,
    mode: "ephemeral",
    targetId: "tgt_1",
    populationId: "pop",
    label: "a run",
    status: "completed",
    configSnapshotId: "cfg_none",
    parentRunId: null,
    continuation: null,
    pauseReason: null,
    resumes: 0,
    lastResumedAt: null,
    sweptAt: null,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    totals: { agents: 1, activeAgents: 0, wakes: 1, findings: 1, confirmed: 0, costUsd: 0 },
  };
  await store.saveRun(run);
  const identity: Identity = {
    id: "idn_1",
    runId: RUN_ID,
    tag: tagForRun(RUN_ID),
    agentId: "pop/casual#1",
    personaId: "casual",
    strategy,
    credential: { bearerToken: "tok", expiresAt: null, redeemable: null, email: "someone@example.test", extra: {} },
    createdAt: new Date().toISOString(),
    tornDownAt: null,
  };
  await store.saveIdentity(identity);
  const finding: Finding = {
    id: "fnd_1",
    runId: RUN_ID,
    tag: tagForRun(RUN_ID),
    wakeId: "wk_1",
    agentId: "pop/casual#1",
    personaId: "casual",
    kind: "bug",
    signature: "sig1:aaaaaaaaaaaa",
    title: "search is case sensitive",
    description: "d",
    expected: "e",
    observed: "o",
    severity: "high",
    confidence: 0.8,
    reproduction: [],
    endpoint: "default",
    identityId: "idn_1",
    verification: null,
    createdAt: new Date().toISOString(),
  };
  await store.saveFinding(finding);
}

describe("sweeping accounts populace cannot remove", () => {
  /**
   * `teardownTool` is OPTIONAL and self-signup is the DEFAULT strategy, so "the population signed
   * up for accounts and there is no tool to delete them" is a supported, warned-about setup rather
   * than an exotic one. `SelfSignupProvider.teardown` returns immediately on it — and a sweep that
   * read that resolved promise as a deletion logged "tore down" for every account while all of
   * them were still on the product, then dropped the run's rows on the strength of a
   * `failures === 0` that could not have been anything else.
   */
  it("says self-signup accounts were left behind when the target has no teardown tool, and keeps the evidence", async () => {
    const store = new SqliteStore(":memory:");
    await seed(store, "self-signup");
    const cfg = config({ strategy: "self-signup", signupTool: "sign_up", tokenPath: "token", emailDomain: "example.test" });

    // `--delete-data`: even asked for by name, the rows naming the abandoned accounts stay.
    const result = await sweepRun(store, cfg, RUN_ID, { dryRun: false, keepData: false });

    expect(result.identities).toBe(1);
    expect(result.removed).toBe(0);
    expect(result.stranded).toBe(1);
    expect(result.failures).toBe(0);
    expect(result.lines.join("\n")).not.toContain("tore down");
    expect(result.lines.join("\n")).toContain("could not be removed");
    expect(result.lines.join("\n")).toContain("no teardown tool configured");
    // The account is still there, so the row must not claim the run has been swept...
    expect((await store.getRun(RUN_ID))?.sweptAt).toBeNull();
    // ...and the findings, which are the only record of WHICH accounts were left, are still here.
    expect(await store.listFindings({ runIds: [RUN_ID] })).toHaveLength(1);
    expect(await store.listIdentitiesByTag(tagForRun(RUN_ID), true)).toHaveLength(1);
    await store.close();
  });

  /** With a teardown tool it is an ordinary removal again, and nothing above gets in the way. */
  it("still tears down self-signup accounts when the target has a teardown tool", async () => {
    const store = new SqliteStore(":memory:");
    await seed(store, "self-signup");
    const cfg = config({ strategy: "self-signup", signupTool: "sign_up", tokenPath: "token", emailDomain: "example.test", teardownTool: "delete_account" });

    // No endpoint is reachable, so `callTool` answers "no endpoint" as an error: a FAILURE, which
    // is the point — it is counted as one, and the evidence survives it.
    const result = await sweepRun(store, cfg, RUN_ID, { dryRun: false, keepData: false });

    expect(result.stranded).toBe(0);
    expect(result.removed + result.failures).toBe(1);
    await store.close();
  });

  /**
   * A dry run used to print "would leave it alone" for every identity and then return zeroes, so
   * anything reading the numbers rather than the prose — the CLI's totals, the dashboard's job —
   * could not tell it apart from a run with nothing tagged at all.
   */
  it("counts pre-existing static accounts in a dry run as well as a real one", async () => {
    const store = new SqliteStore(":memory:");
    await seed(store, "static");
    const cfg = config({ strategy: "static", file: poolFile({ byCohort: { casual: [{ bearerToken: "tok" }] } }) });

    const dry = await sweepRun(store, cfg, RUN_ID, { dryRun: true, keepData: true });
    expect(dry.preExisting).toBe(1);
    expect(dry.removed).toBe(0);
    expect(dry.lines.join("\n")).toContain("populace did not create it");
    // A dry run changes nothing.
    expect((await store.getRun(RUN_ID))?.sweptAt).toBeNull();

    const wet = await sweepRun(store, cfg, RUN_ID, { dryRun: false, keepData: true });
    expect(wet.preExisting).toBe(1);
    expect(wet.removed).toBe(0);
    await store.close();
  });
});

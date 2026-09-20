import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { JobViewSchema, routes } from "@populace/contract";
import { PopulaceConfigSchema, newRunId, tagForRun, type Identity, type PopulaceConfig, type Run, type Store } from "@populace/core";
import { SqliteStore } from "@populace/store-sqlite";
import { describe, expect, it } from "vitest";
import { ensureSimulation, resolveSimulationConfig, snapshotConfig, type ProcessConfig } from "./config-store.js";
import { startServer, type RunningServer } from "./serve.js";

const processConfig: ProcessConfig = { store: { kind: "sqlite", path: ":memory:" }, digestDir: "digests" };

/**
 * A target that records the headers it is reached with and then refuses the request. It is the
 * only way to assert what populace actually put on the wire: a redacted credential fails in a way
 * that looks, from the outside, exactly like a target that has nothing to say.
 */
async function recorder(): Promise<{ url: string; seen: IncomingHttpHeaders[]; close(): Promise<void> }> {
  const seen: IncomingHttpHeaders[] = [];
  const server: Server = createServer((req, res) => {
    seen.push(req.headers);
    req.resume();
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    seen,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

function config(url: string): PopulaceConfig {
  return PopulaceConfigSchema.parse({
    target: {
      name: "Guarded",
      // Both halves of an authenticated target: a gateway bearer and a gateway header. Both are
      // redacted out of a snapshot, and both have to come back before anything connects.
      mcp: [{ url, bearerToken: "gateway-secret", headers: { "x-gateway-key": "gateway-key" } }],
    },
    identity: { strategy: "self-signup", signupTool: "sign_up", tokenPath: "token", teardownTool: "delete_account" },
    verifier: { judge: "heuristic" },
    population: {
      id: "guarded",
      maxWakes: 1,
      cadence: { every: "20ms", jitter: "0s", initialDelay: "0s" },
      members: [{ persona: { id: "casual-lister", name: "Casey Morgan", role: "a list keeper", backstory: "b", goals: ["keep a list"] } }],
    },
  });
}

/** A completed run executing a FROZEN snapshot of that config — the state sweep and verify read. */
async function runOnFrozenConfig(store: Store): Promise<{ runId: string; live: PopulaceConfig }> {
  const simulation = await ensureSimulation(store);
  const { config: live } = await resolveSimulationConfig(store, processConfig, simulation.id);
  const snapshot = await snapshotConfig(store, live);
  // The snapshot is doing its job: no credential is in it.
  expect(snapshot.config.target.mcp[0]?.bearerToken).toBe("[redacted]");
  expect(snapshot.config.target.mcp[0]?.headers["x-gateway-key"]).toBe("[redacted]");

  const runId = newRunId();
  const run: Run = {
    id: runId,
    projectId: simulation.projectId,
    simulationId: simulation.id,
    seq: 1,
    mode: "ephemeral",
    targetId: simulation.targetId,
    populationId: simulation.populationId,
    label: "a finished run",
    status: "completed",
    configSnapshotId: snapshot.id,
    parentRunId: null,
    continuation: null,
    pauseReason: null,
    resumes: 0,
    lastResumedAt: null,
    sweptAt: null,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    totals: { agents: 1, activeAgents: 0, wakes: 1, findings: 0, confirmed: 0, costUsd: 0 },
  };
  await store.saveRun(run);
  const identity: Identity = {
    id: "idn_1",
    runId,
    tag: tagForRun(runId),
    agentId: "guarded/casual-lister#1",
    personaId: "casual-lister",
    strategy: "self-signup",
    credential: { bearerToken: "her-own-token", expiresAt: null, redeemable: null, email: "casey@populace.test", extra: {} },
    createdAt: new Date().toISOString(),
    tornDownAt: null,
  };
  await store.saveIdentity(identity);
  return { runId, live };
}

/** Waits for a queued job to leave `running`, so the assertion is about a finished sweep. */
async function jobSettled(server: RunningServer, jobId: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const job = JobViewSchema.parse(await (await fetch(`${server.url}${routes.job(jobId)}`)).json());
    if (job.status !== "queued" && job.status !== "running") return;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error(`job ${jobId} never settled`);
}

const gatewayKeys = (seen: IncomingHttpHeaders[]): string[] => seen.map((h) => String(h["x-gateway-key"] ?? ""));
const authorizations = (seen: IncomingHttpHeaders[]): string[] => seen.map((h) => h.authorization ?? "");

/**
 * A snapshot is redacted on the way in, and every path that CONNECTS from one has to put the live
 * credentials back (`liveConfigForRun`). Only the resume path did: sweep sent `[redacted]` as the
 * gateway credential and reported accounts removed that were still on the product, and a
 * verification replay came back "not reproduced" for a reason nothing on screen could explain.
 */
describe("connecting to the target from a run's frozen config", () => {
  it("sweeps with the live gateway credentials, not the redacted ones", async () => {
    const target = await recorder();
    const store = new SqliteStore(":memory:");
    const server = await startServer({ store, storePath: ":memory:", version: "test", seedConfig: config(target.url), port: 0 });
    try {
      const { runId } = await runOnFrozenConfig(server.store);
      target.seen.length = 0;

      const res = await fetch(`${server.url}${routes.runSweep(runId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun: false, keepData: true }),
      });
      expect(res.status).toBe(202);
      const job = JobViewSchema.parse(await res.json());
      await jobSettled(server, job.id);

      // The teardown call reached the target, and it was authenticated as the run was.
      expect(target.seen.length).toBeGreaterThan(0);
      expect(gatewayKeys(target.seen)).not.toContain("[redacted]");
      expect(gatewayKeys(target.seen)).toContain("gateway-key");
      // Her own token still takes precedence over the endpoint's: that is who the account belongs to.
      expect(authorizations(target.seen)).toContain("Bearer her-own-token");
    } finally {
      await server.close();
      await target.close();
    }
  });

  it("reads a finished run's tool list with the live gateway credentials", async () => {
    const target = await recorder();
    const store = new SqliteStore(":memory:");
    const server = await startServer({ store, storePath: ":memory:", version: "test", seedConfig: config(target.url), port: 0 });
    try {
      const { runId } = await runOnFrozenConfig(server.store);
      target.seen.length = 0;

      const res = await fetch(`${server.url}${routes.runTools(runId)}`);
      expect(res.status).toBeLessThan(500);

      expect(target.seen.length).toBeGreaterThan(0);
      expect(gatewayKeys(target.seen)).not.toContain("[redacted]");
      expect(gatewayKeys(target.seen)).toContain("gateway-key");
      // With no identity in play the endpoint's own bearer is what authenticates, and `[redacted]`
      // is the exact string that made a verification replay say "not reproduced" for no visible reason.
      expect(authorizations(target.seen)).not.toContain("Bearer [redacted]");
      expect(authorizations(target.seen)).toContain("Bearer gateway-secret");
    } finally {
      await server.close();
      await target.close();
    }
  });
});

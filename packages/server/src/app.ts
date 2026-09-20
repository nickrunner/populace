import { identityProviderFor } from "@populace/adapters";
import { API_BASE, DigestQuerySchema, FindingListQuerySchema, RunListQuerySchema, TraceQuerySchema, WakeListQuerySchema } from "@populace/contract";
import type { Finding, PopulaceConfig, TraceEvent } from "@populace/core";
import { buildDigest, verifyPending } from "@populace/reports";
import { Hono } from "hono";
import { mountControl } from "./control.js";
import type { ServerDeps } from "./deps.js";
import { fail, page, parseQuery } from "./http.js";
import { ProjectReadModel } from "./project-read-model.js";
import { ReadModel } from "./read-model.js";
import { targetView } from "./target.js";

export type { ServerDeps, ControlDeps } from "./deps.js";

/**
 * The read API (`WEB-ARCHITECTURE.md` §5). Every route here reads, with one deliberate exception:
 * `GET /runs/:id/digest?verify=true` runs the verifier, which is a model call. It is off by
 * default and named in the query string so it can never happen by accident.
 *
 * M2's control and authoring routes are mounted alongside when `deps.control` is present. Without
 * it the API is exactly the read-only one M1 shipped, which is what `populace serve` against a
 * store it cannot drive still offers.
 */
export function createApp(deps: ServerDeps): Hono {
  const app = new Hono();
  const read = new ReadModel(deps.store);
  const projects = new ProjectReadModel(deps.store, deps.control ? { runningRunIds: () => deps.control?.runs.runningIds ?? [] } : {});

  app.get(`${API_BASE}/health`, async (c) => {
    const killSwitch = await deps.store.getKillSwitch();
    return c.json({ version: deps.version, storePath: deps.storePath, readOnly: deps.control === undefined, killSwitch });
  });

  /**
   * `GET /target` is gone. It answered "the target" for a process that assumed one project with
   * one target; a target is now named by the simulation that goes to it, and read under
   * `/projects/:p/targets` (SPEC §6.1).
   */
  app.get(`${API_BASE}/runs`, async (c) => {
    const q = parseQuery(c, RunListQuerySchema);
    if (!q.ok) return q.response;
    // Filtered IN SQL: the rows carry their project and simulation, so a project's runs are a
    // query rather than every run in the database loaded and thrown away.
    const runs = await read.listRuns({ ...(q.value.project === undefined ? {} : { projectId: q.value.project }), ...(q.value.simulation === undefined ? {} : { simulationId: q.value.simulation }) });
    return c.json(page(runs, q.value.cursor, q.value.limit));
  });

  // Declared before `/runs/:id` so the literal path is not captured as a run id.
  if (deps.control) mountControl(app, deps.control);

  app.get(`${API_BASE}/runs/:id`, async (c) => {
    const run = await read.getRun(c.req.param("id"));
    return run ? c.json(run) : fail(c, "not_found", `no run ${c.req.param("id")}`);
  });

  /**
   * The wire speaks the user's words (Decision A). The rows underneath are still `Agent`s and
   * every store method still says so; this is a translation at the boundary.
   */
  app.get(`${API_BASE}/runs/:id/participants`, async (c) => c.json({ items: await read.listParticipants(c.req.param("id")), nextCursor: null }));

  /** One person's whole page in ONE request — memory, visits and findings included, no N+1. */
  app.get(`${API_BASE}/runs/:id/participants/:pid`, async (c) => {
    const detail = await projects.participant(c.req.param("id"), c.req.param("pid"));
    return detail ? c.json(detail) : fail(c, "not_found", `nobody called ${c.req.param("pid")} in run ${c.req.param("id")}`);
  });

  app.get(`${API_BASE}/runs/:id/cohorts`, async (c) => c.json({ items: await projects.runCohorts(c.req.param("id")), nextCursor: null }));

  app.get(`${API_BASE}/runs/:id/wakes`, async (c) => {
    const q = parseQuery(c, WakeListQuerySchema);
    if (!q.ok) return q.response;
    const wakes = await read.listWakes(c.req.param("id"), q.value.participant);
    return c.json(page(wakes, q.value.cursor, q.value.limit));
  });

  app.get(`${API_BASE}/runs/:id/findings`, async (c) => {
    const q = parseQuery(c, FindingListQuerySchema);
    if (!q.ok) return q.response;
    const { kind, severity, verdict, unverified, participant, tool, cursor, limit } = q.value;
    let findings = await deps.store.listFindings({ runIds: [c.req.param("id")], ...(kind ? { kinds: kind } : {}), ...(unverified ? { unverifiedOnly: true } : {}) });
    if (severity) findings = findings.filter((f) => severity.includes(f.severity));
    if (verdict) findings = findings.filter((f) => f.verification !== null && verdict.includes(f.verification.verdict));
    if (participant !== undefined) findings = findings.filter((f) => f.agentId === participant);
    if (tool !== undefined) findings = findings.filter((f) => f.tool === tool);
    return c.json(page(sortFindings(findings), cursor, limit));
  });

  app.get(`${API_BASE}/runs/:id/spend`, async (c) => {
    // The ceiling this run was actually running under, from the config it froze — not whatever
    // the settings form says today.
    const config = await configForRun(c.req.param("id"));
    return c.json(await new ReadModel(deps.store, config?.guardrails).spend(c.req.param("id")));
  });

  app.get(`${API_BASE}/runs/:id/tools`, async (c) => {
    const config = await configForRun(c.req.param("id"));
    return c.json(await read.toolUsage(c.req.param("id"), config ? await targetView(config) : { name: "", endpoints: [], webBaseUrl: null, description: null, identityStrategy: "", tools: null, toolsError: "no target is set up" }));
  });

  app.get(`${API_BASE}/runs/:id/participants/:pid/memory`, async (c) => {
    const memory = await read.memory(c.req.param("id"), c.req.param("pid"));
    // Somebody who has not written anything yet has no memory row, which is a normal state on a
    // first visit rather than a missing resource, so it answers with an empty document.
    return c.json(memory ?? { runId: c.req.param("id"), agentId: c.req.param("pid"), notes: [], waitingOn: [], annoyances: [], done: [], updatedAt: new Date(0).toISOString() });
  });

  /**
   * The config a run actually executed. A digest or a tool list rebuilt today has to describe what
   * ran, not what the forms happen to say now — which is the whole reason a snapshot exists
   * (ADR-0024).
   *
   * `deps.configForRun` is asked FIRST, and it is snapshot-first itself (`liveConfigForRun`): the
   * frozen plan, with the live credentials put back. Reading the snapshot here instead would hand
   * `[redacted]` to the two routes below that go on to connect to the target — the tool list, and
   * the verification replay behind `?verify=1`. Reading the snapshot directly is only the fallback
   * for a read-only app wired without a resolver.
   */
  async function configForRun(runId: string): Promise<PopulaceConfig | undefined> {
    if (deps.configForRun) {
      const resolved = await deps.configForRun(runId).catch(() => undefined);
      if (resolved) return resolved;
    }
    const stored = await deps.store.getRun(runId);
    if (stored?.configSnapshotId) {
      const snapshot = await deps.store.getConfigSnapshot(stored.configSnapshotId);
      if (snapshot) return snapshot.config;
    }
    return undefined;
  }

  app.get(`${API_BASE}/runs/:id/digest`, async (c) => {
    const q = parseQuery(c, DigestQuerySchema);
    if (!q.ok) return q.response;
    const runId = c.req.param("id");
    const run = await read.getRun(runId);
    if (!run) return fail(c, "not_found", `no run ${runId}`);
    const config = await configForRun(runId);
    if (!config) return fail(c, "conflict", "this run has no config to read it by; connect a target first");
    if (q.value.verify) {
      if (config.verifier.judge === "model" && !deps.verifier) {
        return fail(c, "unavailable", "the model judge needs an API key; set ANTHROPIC_API_KEY or configure verifier.judge: heuristic");
      }
      await verifyPending({ store: deps.store, config, identityProvider: identityProviderFor(config.identity), ...(deps.verifier ? { provider: deps.verifier } : {}) }, { runIds: [runId] });
    }
    // The digest window is the run, not a clock window: a run is the unit the dashboard shows.
    const since = run.startedAt ? new Date(run.startedAt) : new Date(0);
    const until = run.endedAt ? new Date(new Date(run.endedAt).getTime() + 1000) : new Date();
    return c.json(await buildDigest({ store: deps.store, config, since, until, runIds: [runId] }));
  });

  app.get(`${API_BASE}/wakes/:id`, async (c) => {
    const wake = await deps.store.getWake(c.req.param("id"));
    if (!wake) return fail(c, "not_found", `no wake ${c.req.param("id")}`);
    const [agents, findings, memory] = await Promise.all([
      deps.store.listAgents({ runId: wake.runId }),
      deps.store.listFindings({ runIds: [wake.runId] }),
      deps.store.getMemory(wake.runId, wake.agentId),
    ]);
    return c.json({
      ...wake,
      personaName: agents.find((a) => a.id === wake.agentId)?.persona.name ?? wake.personaId,
      findingIds: findings.filter((f) => f.wakeId === wake.id).map((f) => f.id),
      memoryUpdatedAt: memory?.updatedAt ?? null,
    });
  });

  app.get(`${API_BASE}/wakes/:id/trace`, async (c) => {
    const q = parseQuery(c, TraceQuerySchema);
    if (!q.ok) return q.response;
    const wakeId = c.req.param("id");
    const wake = await deps.store.getWake(wakeId);
    if (!wake) return fail(c, "not_found", `no wake ${wakeId}`);
    const events: TraceEvent[] = await deps.store.getTrace(wakeId);
    const after = q.value.afterSeq;
    const filtered = after === undefined ? events : events.filter((e) => e.seq > after);
    return c.json(page(filtered, q.value.cursor, q.value.limit));
  });

  app.get(`${API_BASE}/findings/:id`, async (c) => {
    const finding = await deps.store.getFinding(c.req.param("id"));
    return finding ? c.json(finding) : fail(c, "not_found", `no finding ${c.req.param("id")}`);
  });

  app.notFound((c) => (c.req.path.startsWith(API_BASE) ? fail(c, "not_found", `no route ${c.req.path}`) : c.text("Not found", 404)));
  app.onError((err, c) => fail(c, "internal", err instanceof Error ? err.message : String(err)));
  return app;
}

/** Worst first: the dashboard's default order is "what should I look at". */
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 } as const;
function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.createdAt.localeCompare(a.createdAt));
}

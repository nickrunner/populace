import { API_BASE, DigestQuerySchema, FindingListQuerySchema, RunListQuerySchema, TraceQuerySchema, WakeListQuerySchema } from "@populace/contract";
import type { Finding, TraceEvent } from "@populace/core";
import { buildDigest, verifyPending } from "@populace/reports";
import { Hono } from "hono";
import { withLiveCredentials } from "./config-store.js";
import { mountControl } from "./control.js";
import type { ServerDeps } from "./deps.js";
import { fail, page, parseQuery } from "./http.js";
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

  app.get(`${API_BASE}/health`, async (c) => {
    const killSwitch = await deps.store.getKillSwitch();
    return c.json({ version: deps.version, storePath: deps.storePath, readOnly: deps.control === undefined, killSwitch });
  });

  app.get(`${API_BASE}/target`, async (c) => {
    try {
      return c.json(await targetView(await deps.config()));
    } catch (err) {
      // No target set up yet is a normal state in M2, and the screens that ask for one say so.
      return fail(c, "not_found", err instanceof Error ? err.message : "no target is set up yet");
    }
  });

  app.get(`${API_BASE}/runs`, async (c) => {
    const q = parseQuery(c, RunListQuerySchema);
    if (!q.ok) return q.response;
    return c.json(page(await read.listRuns(), q.value.cursor, q.value.limit));
  });

  // Declared before `/runs/:id` so the literal path is not captured as a run id.
  if (deps.control) mountControl(app, deps.control);

  app.get(`${API_BASE}/runs/:id`, async (c) => {
    const run = await read.getRun(c.req.param("id"));
    return run ? c.json(run) : fail(c, "not_found", `no run ${c.req.param("id")}`);
  });

  app.get(`${API_BASE}/runs/:id/agents`, async (c) => c.json({ items: await read.listAgents(c.req.param("id")), nextCursor: null }));

  app.get(`${API_BASE}/runs/:id/wakes`, async (c) => {
    const q = parseQuery(c, WakeListQuerySchema);
    if (!q.ok) return q.response;
    const wakes = await read.listWakes(c.req.param("id"), q.value.agentId);
    return c.json(page(wakes, q.value.cursor, q.value.limit));
  });

  app.get(`${API_BASE}/runs/:id/findings`, async (c) => {
    const q = parseQuery(c, FindingListQuerySchema);
    if (!q.ok) return q.response;
    const { kind, severity, verdict, unverified, agentId, tool, cursor, limit } = q.value;
    let findings = await deps.store.listFindings({ runIds: [c.req.param("id")], ...(kind ? { kinds: kind } : {}), ...(unverified ? { unverifiedOnly: true } : {}) });
    if (severity) findings = findings.filter((f) => severity.includes(f.severity));
    if (verdict) findings = findings.filter((f) => f.verification !== null && verdict.includes(f.verification.verdict));
    if (agentId !== undefined) findings = findings.filter((f) => f.agentId === agentId);
    if (tool !== undefined) findings = findings.filter((f) => f.tool === tool);
    return c.json(page(sortFindings(findings), cursor, limit));
  });

  app.get(`${API_BASE}/runs/:id/spend`, async (c) => {
    const guardrails = await deps.config().then(
      (config) => config.guardrails,
      () => undefined,
    );
    return c.json(await new ReadModel(deps.store, guardrails).spend(c.req.param("id")));
  });

  app.get(`${API_BASE}/runs/:id/tools`, async (c) => {
    const config = await configForRun(c.req.param("id"));
    return c.json(await read.toolUsage(c.req.param("id"), config ? await targetView(config) : { name: "", endpoints: [], webBaseUrl: null, description: null, identityStrategy: "", tools: null, toolsError: "no target is set up" }));
  });

  app.get(`${API_BASE}/runs/:id/agents/:agentId/memory`, async (c) => {
    const memory = await read.memory(c.req.param("id"), c.req.param("agentId"));
    // An agent that has not written anything yet has no memory row, which is a normal state on a
    // first visit rather than a missing resource, so it answers with an empty document.
    return c.json(memory ?? { runId: c.req.param("id"), agentId: c.req.param("agentId"), notes: [], waitingOn: [], annoyances: [], done: [], updatedAt: new Date(0).toISOString() });
  });

  /**
   * The config a run actually executed, from its snapshot. A digest or a tool list rebuilt today
   * has to describe what ran, not what the forms happen to say now — which is the whole reason a
   * snapshot exists (ADR-0024). Falls back to the live config for runs written before M2.
   */
  async function configForRun(runId: string) {
    const stored = await deps.store.getRun(runId);
    if (stored?.configSnapshotId) {
      const snapshot = await deps.store.getConfigSnapshot(stored.configSnapshotId);
      // A snapshot never carries a credential (ADR-0024), and `?verify=true` below replays tool
      // calls against the live target, so the secrets go back in from the authored row first.
      if (snapshot) return withLiveCredentials(deps.store, snapshot.config, deps.control?.projectId);
    }
    return deps.config().then(
      (config) => config,
      () => undefined,
    );
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
      await verifyPending({ store: deps.store, config, ...(deps.verifier ? { provider: deps.verifier } : {}) }, { runIds: [runId] });
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

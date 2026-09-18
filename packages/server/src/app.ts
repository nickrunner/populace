import {
  API_BASE,
  DigestQuerySchema,
  ErrorBodySchema,
  FindingListQuerySchema,
  RunListQuerySchema,
  TraceQuerySchema,
  WakeListQuerySchema,
  type ErrorBody,
} from "@populace/contract";
import type { Finding, PopulaceConfig, Store, TraceEvent } from "@populace/core";
import { buildDigest, verifyPending } from "@populace/reports";
import type { ModelProvider } from "@populace/runner";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { ReadModel } from "./read-model.js";
import { targetView } from "./target.js";

export interface ServerDeps {
  store: Store;
  config: PopulaceConfig;
  storePath: string;
  version: string;
  /** Model provider for the verifier. Absent means a `model` judge cannot run; a heuristic one still can. */
  verifier?: ModelProvider;
}

const NOT_FOUND = { not_found: 404, bad_request: 400, conflict: 409, unavailable: 503, internal: 500 } as const;

function fail(c: Context, code: ErrorBody["error"]["code"], message: string): Response {
  const body = ErrorBodySchema.parse({ error: { code, message } });
  return c.json(body, NOT_FOUND[code] satisfies ContentfulStatusCode);
}

/**
 * Query parameters arrive as repeated keys or single ones; collapsing a single-element array to
 * its value lets one schema accept both without every route knowing which it got.
 */
function query(c: Context): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, values] of Object.entries(c.req.queries())) {
    const first = values[0];
    if (first === undefined) continue;
    out[key] = values.length === 1 ? first : values;
  }
  return out;
}

function parseQuery<T>(c: Context, schema: z.ZodType<T>): { ok: true; value: T } | { ok: false; response: Response } {
  const result = schema.safeParse(query(c));
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, response: fail(c, "bad_request", z.prettifyError(result.error)) };
}

/**
 * The cursor is an opaque offset into the result list. It is opaque on purpose: M2 replaces it
 * with the event-log sequence (ADR-0026) and no client should have encoded an assumption about
 * what it means.
 */
function page<T>(items: T[], cursor: string | undefined, limit: number): { items: T[]; nextCursor: string | null } {
  const start = cursor === undefined ? 0 : Number.parseInt(cursor, 10);
  const from = Number.isFinite(start) && start > 0 ? start : 0;
  const slice = items.slice(from, from + limit);
  const next = from + slice.length;
  return { items: slice, nextCursor: next < items.length ? String(next) : null };
}

/**
 * The read-only M1 API (`WEB-ARCHITECTURE.md` §5). Every route reads; nothing here starts a run,
 * spends money or writes a row, with one deliberate exception: `GET /runs/:id/digest?verify=true`
 * runs the verifier, which is a model call. It is off by default and named in the query string
 * so it can never happen by accident.
 */
export function createApp(deps: ServerDeps): Hono {
  const app = new Hono();
  const read = new ReadModel(deps.store, deps.config.guardrails);

  app.get(`${API_BASE}/health`, async (c) => {
    const killSwitch = await deps.store.getKillSwitch();
    return c.json({ version: deps.version, storePath: deps.storePath, readOnly: true, killSwitch });
  });

  app.get(`${API_BASE}/target`, async (c) => c.json(await targetView(deps.config)));

  app.get(`${API_BASE}/runs`, async (c) => {
    const q = parseQuery(c, RunListQuerySchema);
    if (!q.ok) return q.response;
    return c.json(page(await read.listRuns(), q.value.cursor, q.value.limit));
  });

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

  app.get(`${API_BASE}/runs/:id/spend`, async (c) => c.json(await read.spend(c.req.param("id"))));

  app.get(`${API_BASE}/runs/:id/tools`, async (c) => c.json(await read.toolUsage(c.req.param("id"), await targetView(deps.config))));

  app.get(`${API_BASE}/runs/:id/agents/:agentId/memory`, async (c) => {
    const memory = await read.memory(c.req.param("id"), c.req.param("agentId"));
    // An agent that has not written anything yet has no memory row, which is a normal state on a
    // first visit rather than a missing resource, so it answers with an empty document.
    return c.json(memory ?? { runId: c.req.param("id"), agentId: c.req.param("agentId"), notes: [], waitingOn: [], annoyances: [], done: [], updatedAt: new Date(0).toISOString() });
  });

  app.get(`${API_BASE}/runs/:id/digest`, async (c) => {
    const q = parseQuery(c, DigestQuerySchema);
    if (!q.ok) return q.response;
    const runId = c.req.param("id");
    const run = await read.getRun(runId);
    if (!run) return fail(c, "not_found", `no run ${runId}`);
    if (q.value.verify) {
      if (deps.config.verifier.judge === "model" && !deps.verifier) {
        return fail(c, "unavailable", "the model judge needs an API key; set ANTHROPIC_API_KEY or configure verifier.judge: heuristic");
      }
      await verifyPending({ store: deps.store, config: deps.config, ...(deps.verifier ? { provider: deps.verifier } : {}) }, { runIds: [runId] });
    }
    // The digest window is the run, not a clock window: a run is the unit the dashboard shows.
    const since = run.startedAt ? new Date(run.startedAt) : new Date(0);
    const until = run.endedAt ? new Date(new Date(run.endedAt).getTime() + 1000) : new Date();
    return c.json(await buildDigest({ store: deps.store, config: deps.config, since, until, runIds: [runId] }));
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

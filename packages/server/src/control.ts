import {
  AddStarterBodySchema,
  EventStreamQuerySchema,
  KillSwitchBodySchema,
  PersonaInputSchema,
  PopulationInputSchema,
  SettingsInputSchema,
  StartRunBodySchema,
  StopRunBodySchema,
  SweepBodySchema,
  TargetInputSchema,
  routes,
  type AgentLive,
  type PersonaView,
  type PopulationView,
  type RunLive,
  type SettingsView,
  type SetupStatus,
  type StoredTargetView,
} from "@populace/contract";
import {
  DEFAULT_PROJECT_ID,
  newPersonaId,
  newTargetId,
  slugify,
  type Event,
  type McpEndpoint,
  type StoredPersona,
  type StoredTarget,
  type TraceEvent,
} from "@populace/core";
import { buildDigest, verifyPending } from "@populace/reports";
import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { ConfigIncomplete, ensurePopulation, ensureSettings, resolveProjectConfig } from "./config-store.js";
import { estimateRun } from "./estimate.js";
import { fail, page, param, parseBody, parseQuery } from "./http.js";
import { STARTER_PERSONAS, starterBySlug } from "./starters.js";
import { checkPromises, checkTarget } from "./target-check.js";
import type { ControlDeps } from "./deps.js";

/**
 * Everything M2 adds to the API: authoring config into rows (ADR-0025), driving runs (ADR-0027)
 * and watching one happen (ADR-0026).
 *
 * Two rules from M1 hold everywhere below. A credential goes up and never comes back down — a
 * target view reports `authenticated` and nothing else. And nothing that spends money happens as
 * a side effect of a GET: every model call is behind a POST that names it.
 */
export function mountControl(app: Hono, deps: ControlDeps): void {
  const projectId = deps.projectId ?? DEFAULT_PROJECT_ID;
  const now = (): string => new Date().toISOString();

  const targetView = (target: StoredTarget): StoredTargetView => ({
    id: target.id,
    projectId: target.projectId,
    name: target.name,
    mcp: target.mcp.map((e) => ({ name: e.name, url: e.url, authenticated: e.bearerToken !== undefined || Object.keys(e.headers).length > 0 })),
    webBaseUrl: target.webBaseUrl ?? null,
    description: target.description ?? null,
    identity: target.identity,
    updatedAt: target.updatedAt,
  });

  const firstTarget = async (): Promise<StoredTarget | undefined> => (await deps.store.listTargets(projectId))[0];

  /**
   * A blank `bearerToken` clears a stored one and an absent one leaves it alone, which is what
   * lets the form round-trip without ever having been shown the secret it is editing.
   */
  const mergeEndpoints = (input: { name: string; url: string; bearerToken?: string }[], existing: McpEndpoint[]): McpEndpoint[] =>
    input.map((endpoint) => {
      const previous = existing.find((e) => e.name === endpoint.name);
      const token = endpoint.bearerToken === undefined ? previous?.bearerToken : endpoint.bearerToken === "" ? undefined : endpoint.bearerToken;
      return { name: endpoint.name, url: endpoint.url, ...(token === undefined ? {} : { bearerToken: token }), headers: previous?.headers ?? {} };
    });

  // ---- setup status -------------------------------------------------------

  app.get(routes.setup, async (c) => {
    const target = await firstTarget();
    const population = await ensurePopulation(deps.store, projectId);
    const personas = await deps.store.listPersonas(projectId);
    const agentCount = population.members.reduce((sum, m) => sum + Math.ceil(m.count * population.scale), 0);
    const killSwitch = await deps.store.getKillSwitch();
    const blockers: string[] = [];
    if (!target) blockers.push("Connect a target so the people have somewhere to go.");
    if (agentCount === 0) blockers.push("Add at least one person to the population.");
    if (!deps.hasApiKey()) blockers.push("Set ANTHROPIC_API_KEY before starting a run; the people are model calls.");
    if (killSwitch.engaged) blockers.push(`Everything is stopped${killSwitch.reason ? ` (${killSwitch.reason})` : ""}. Release it to start a run.`);
    const status: SetupStatus = {
      ready: blockers.length === 0,
      blockers,
      targetId: target?.id ?? null,
      personaCount: personas.length,
      agentCount,
      hasApiKey: deps.hasApiKey(),
      killSwitch,
      runningRunIds: deps.runs.runningIds,
    };
    return c.json(status);
  });

  // ---- targets ------------------------------------------------------------

  app.get(routes.targets, async (c) => c.json({ items: (await deps.store.listTargets(projectId)).map(targetView), nextCursor: null }));

  app.post(routes.targets, async (c) => {
    const body = await parseBody(c, TargetInputSchema);
    if (!body.ok) return body.response;
    const at = now();
    const target: StoredTarget = {
      id: newTargetId(),
      projectId,
      name: body.value.name,
      mcp: mergeEndpoints(body.value.mcp, []),
      ...(body.value.webBaseUrl ? { webBaseUrl: body.value.webBaseUrl } : {}),
      ...(body.value.description ? { description: body.value.description } : {}),
      identity: body.value.identity,
      createdAt: at,
      updatedAt: at,
    };
    await deps.store.saveTarget(target);
    return c.json(targetView(target), 201);
  });

  app.get(routes.target_(":id"), async (c) => {
    const target = await deps.store.getTarget(param(c, "id"));
    return target ? c.json(targetView(target)) : fail(c, "not_found", "no such target");
  });

  app.put(routes.target_(":id"), async (c) => {
    const existing = await deps.store.getTarget(param(c, "id"));
    if (!existing) return fail(c, "not_found", "no such target");
    const body = await parseBody(c, TargetInputSchema);
    if (!body.ok) return body.response;
    const updated: StoredTarget = {
      ...existing,
      name: body.value.name,
      mcp: mergeEndpoints(body.value.mcp, existing.mcp),
      ...(body.value.webBaseUrl ? { webBaseUrl: body.value.webBaseUrl } : { webBaseUrl: undefined }),
      ...(body.value.description ? { description: body.value.description } : { description: undefined }),
      identity: body.value.identity,
      updatedAt: now(),
    };
    await deps.store.saveTarget(updated);
    return c.json(targetView(updated));
  });

  app.delete(routes.target_(":id"), async (c) => {
    await deps.store.deleteTarget(param(c, "id"));
    return c.body(null, 204);
  });

  /**
   * POST, not GET: it opens a connection to someone else's server. That is a side effect on their
   * side even though it costs nothing here, and a link that a browser may prefetch should not do
   * it.
   */
  app.post(routes.targetCheck(":id"), async (c) => {
    const target = await deps.store.getTarget(param(c, "id"));
    if (!target) return fail(c, "not_found", "no such target");
    return c.json(await checkTarget(target.mcp, target.identity));
  });

  /** A draft target that has not been saved yet — the wizard checks before it commits. */
  app.post(`${routes.targets}/check`, async (c) => {
    const body = await parseBody(c, TargetInputSchema.pick({ mcp: true }).extend({ identity: TargetInputSchema.shape.identity.optional() }));
    if (!body.ok) return body.response;
    return c.json(await checkTarget(mergeEndpoints(body.value.mcp, []), body.value.identity));
  });

  app.get(routes.targetPromises(":id"), async (c) => {
    const target = await deps.store.getTarget(param(c, "id"));
    if (!target) return fail(c, "not_found", "no such target");
    const check = await checkTarget(target.mcp, target.identity);
    return c.json(await checkPromises(target.webBaseUrl ?? null, check.tools));
  });

  // ---- personas -----------------------------------------------------------

  // Declared before `/personas/:id` so the literal path is not eaten by the parameter.
  app.get(routes.personaStarters, (c) => c.json({ items: STARTER_PERSONAS.map((s) => ({ slug: s.slug, name: s.spec.name, role: s.spec.role, summary: s.summary })), nextCursor: null }));

  /** Copies a starter into this project and puts it in the population in one step. */
  app.post(routes.personaStarters, async (c) => {
    const body = await parseBody(c, AddStarterBodySchema);
    if (!body.ok) return body.response;
    const starter = starterBySlug(body.value.slug);
    if (!starter) return fail(c, "not_found", `no starter called ${body.value.slug}`);
    const at = now();
    const existing = (await deps.store.listPersonas(projectId)).find((p) => p.slug === starter.slug);
    const persona: StoredPersona = existing ?? { id: newPersonaId(), projectId, slug: starter.slug, spec: starter.spec, origin: "starter", createdAt: at, updatedAt: at };
    if (!existing) await deps.store.savePersona(persona);
    await setMemberCount(persona.id, body.value.count);
    return c.json(await personaView(persona), existing ? 200 : 201);
  });

  const memberCountOf = async (personaId: string): Promise<number> => {
    const population = await ensurePopulation(deps.store, projectId);
    return population.members.find((m) => m.personaId === personaId)?.count ?? 0;
  };

  /** A count of zero removes the member row: nobody in the population is not a member of size 0. */
  const setMemberCount = async (personaId: string, count: number): Promise<void> => {
    const population = await ensurePopulation(deps.store, projectId);
    const others = population.members.filter((m) => m.personaId !== personaId);
    const previous = population.members.find((m) => m.personaId === personaId);
    const members = count <= 0 ? others : [...others, { ...(previous ?? { personaId, count }), personaId, count }];
    await deps.store.savePopulation({ ...population, members, updatedAt: now() });
  };

  const personaView = async (persona: StoredPersona): Promise<PersonaView> => ({
    id: persona.id,
    projectId: persona.projectId,
    slug: persona.slug,
    spec: persona.spec,
    origin: persona.origin,
    updatedAt: persona.updatedAt,
    count: await memberCountOf(persona.id),
  });

  app.get(routes.personas, async (c) => {
    const personas = await deps.store.listPersonas(projectId);
    return c.json({ items: await Promise.all(personas.map(personaView)), nextCursor: null });
  });

  app.post(routes.personas, async (c) => {
    const body = await parseBody(c, PersonaInputSchema);
    if (!body.ok) return body.response;
    const slug = body.value.slug ?? slugify(body.value.spec.name);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return fail(c, "bad_request", "a person needs a name that makes a slug, or an explicit one");
    if ((await deps.store.listPersonas(projectId)).some((p) => p.slug === slug)) return fail(c, "conflict", `there is already someone called ${slug} here`);
    const at = now();
    const persona: StoredPersona = { id: newPersonaId(), projectId, slug, spec: { ...body.value.spec, id: slug }, origin: "authored", createdAt: at, updatedAt: at };
    await deps.store.savePersona(persona);
    await setMemberCount(persona.id, 1);
    return c.json(await personaView(persona), 201);
  });

  app.put(routes.persona(":id"), async (c) => {
    const existing = await deps.store.getPersona(param(c, "id"));
    if (!existing) return fail(c, "not_found", "no such person");
    const body = await parseBody(c, PersonaInputSchema);
    if (!body.ok) return body.response;
    // The slug is immutable and the spec's id follows it, whatever the body says. Agent ids are
    // `populationId/personaId#ordinal`, so a slug that moved would silently break continuations —
    // which is the one thing this product cannot afford to get wrong (`DATA-MODEL.md` §5).
    const updated: StoredPersona = { ...existing, spec: { ...body.value.spec, id: existing.slug }, origin: existing.origin === "starter" ? "authored" : existing.origin, updatedAt: now() };
    await deps.store.savePersona(updated);
    return c.json(await personaView(updated));
  });

  app.delete(routes.persona(":id"), async (c) => {
    await setMemberCount(param(c, "id"), 0);
    await deps.store.deletePersona(param(c, "id"));
    return c.body(null, 204);
  });

  // ---- population and settings -------------------------------------------

  const populationView = async (): Promise<PopulationView> => {
    const population = await ensurePopulation(deps.store, projectId);
    const personas = new Map((await deps.store.listPersonas(projectId)).map((p) => [p.id, p]));
    return {
      id: population.id,
      slug: population.slug,
      scale: population.scale,
      seed: population.seed,
      cadence: population.cadence,
      maxWakes: population.maxWakes ?? null,
      members: population.members.map((m) => {
        const persona = personas.get(m.personaId);
        return { personaId: m.personaId, slug: persona?.slug ?? m.personaId, name: persona?.spec.name ?? m.personaId, count: m.count, maxWakes: m.maxWakes ?? null };
      }),
    };
  };

  app.get(routes.population, async (c) => c.json(await populationView()));

  app.put(routes.population, async (c) => {
    const body = await parseBody(c, PopulationInputSchema);
    if (!body.ok) return body.response;
    const population = await ensurePopulation(deps.store, projectId);
    const known = new Set((await deps.store.listPersonas(projectId)).map((p) => p.id));
    const unknown = (body.value.members ?? []).filter((m) => !known.has(m.personaId)).map((m) => m.personaId);
    if (unknown.length) return fail(c, "bad_request", `no such person: ${unknown.join(", ")}`);
    await deps.store.savePopulation({
      ...population,
      ...(body.value.scale === undefined ? {} : { scale: body.value.scale }),
      ...(body.value.seed === undefined ? {} : { seed: body.value.seed }),
      ...(body.value.cadence === undefined ? {} : { cadence: { ...population.cadence, ...body.value.cadence } }),
      ...(body.value.maxWakes === undefined ? {} : { maxWakes: body.value.maxWakes ?? undefined }),
      ...(body.value.members === undefined
        ? {}
        : { members: body.value.members.filter((m) => m.count > 0).map((m) => ({ personaId: m.personaId, count: m.count, ...(m.maxWakes === undefined || m.maxWakes === null ? {} : { maxWakes: m.maxWakes }) })) }),
      updatedAt: now(),
    });
    return c.json(await populationView());
  });

  const settingsView = async (): Promise<SettingsView> => {
    const settings = await ensureSettings(deps.store, projectId);
    const { apiKey: _apiKey, ...model } = settings.model;
    return { model, guardrails: settings.guardrails, verifier: settings.verifier, daemon: settings.daemon, hasApiKey: deps.hasApiKey(), updatedAt: settings.updatedAt };
  };

  app.get(routes.settings, async (c) => c.json(await settingsView()));

  app.put(routes.settings, async (c) => {
    const body = await parseBody(c, SettingsInputSchema);
    if (!body.ok) return body.response;
    const settings = await ensureSettings(deps.store, projectId);
    await deps.store.saveSettings({
      ...settings,
      // The key is never in the form, so a partial update must not be able to drop the one the
      // process was configured with.
      model: { ...settings.model, ...body.value.model },
      guardrails: { ...settings.guardrails, ...body.value.guardrails, perWake: { ...settings.guardrails.perWake, ...body.value.guardrails?.perWake } },
      verifier: { ...settings.verifier, ...body.value.verifier },
      daemon: { ...settings.daemon, ...body.value.daemon },
      updatedAt: now(),
    });
    return c.json(await settingsView());
  });

  // ---- estimating and starting -------------------------------------------

  /** Pure arithmetic. It reads history and spends nothing; the estimate never starts a run. */
  app.post(routes.runsEstimate, async (c) => {
    try {
      const { config } = await resolveProjectConfig(deps.store, deps.processConfig, projectId);
      return c.json(await estimateRun(deps.store, { config }));
    } catch (err) {
      if (err instanceof ConfigIncomplete) return fail(c, "conflict", err.missing.join("; "));
      throw err;
    }
  });

  const startRun = async (c: Context, continueFrom?: string): Promise<Response> => {
    const body = await parseBody(c, StartRunBodySchema);
    if (!body.ok) return body.response;
    if (!deps.hasApiKey()) return fail(c, "unavailable", "starting a run needs ANTHROPIC_API_KEY; the people are model calls");
    let resolved;
    try {
      resolved = await resolveProjectConfig(deps.store, deps.processConfig, projectId);
    } catch (err) {
      if (err instanceof ConfigIncomplete) return fail(c, "conflict", err.missing.join("; "));
      throw err;
    }
    const parent = continueFrom ?? body.value.continueFrom;
    if (parent !== undefined && !(await deps.store.getRun(parent)) && (await deps.store.listAgents({ runId: parent })).length === 0) {
      return fail(c, "not_found", `no run ${parent} to carry on from`);
    }
    const label = body.value.label?.trim() || `${resolved.target.name} · ${new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`;

    // The run is created inside the job so that a failure to start is a failed job the browser can
    // read, rather than a request that timed out with nothing to point at (ADR-0027).
    let runId = "";
    let snapshotId = "";
    const job = await deps.jobs.enqueue(
      parent === undefined ? "run.start" : "run.continue",
      async (_job, report) => {
        const run = await deps.runs.start(
          {
            config: resolved.config,
            projectId,
            targetId: resolved.target.id,
            label,
            ...(parent === undefined ? {} : { continueFrom: parent, continuationReason: body.value.continuationReason ?? "" }),
          },
          (wakes) => void report({ done: wakes, label: `${wakes} visit(s) done` }),
        );
        runId = run.id;
        snapshotId = run.configSnapshotId;
        return { runId: run.id };
      },
      { label: parent === undefined ? "starting the run" : "carrying the run on" },
    );

    // The daemon keeps ticking after `start` resolves; this only waits for the run row to exist,
    // which is what the browser needs in order to navigate to it.
    const deadline = Date.now() + 15_000;
    while (runId === "" && Date.now() < deadline) {
      const current = await deps.store.getJob(job.id);
      if (current?.status === "failed") return fail(c, "conflict", current.error ?? "the run could not be started");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (runId === "") return fail(c, "unavailable", "the run is taking longer than expected to start; watch the job for progress");
    return c.json({ runId, jobId: job.id, configSnapshotId: snapshotId, label }, 201);
  };

  app.post(routes.runs, async (c) => startRun(c));
  app.post(routes.runContinue(":id"), async (c) => startRun(c, param(c, "id")));

  app.post(routes.runStop(":id"), async (c) => {
    const body = await parseBody(c, StopRunBodySchema);
    if (!body.ok) return body.response;
    const run = await deps.runs.stop(param(c, "id"), body.value.mode);
    return run ? c.json({ runId: run.id, status: run.status }) : fail(c, "not_found", "no such run");
  });

  app.post(routes.runRound(":id"), async (c) => {
    const runId = param(c, "id");
    if (!deps.runs.isRunning(runId)) return fail(c, "conflict", "that run is not going at the moment, so there is nothing to send a round to");
    return c.json({ runId, agents: await deps.runs.round(runId) });
  });

  app.post(routes.runSweep(":id"), async (c) => {
    const body = await parseBody(c, SweepBodySchema);
    if (!body.ok) return body.response;
    const runId = param(c, "id");
    if (deps.runs.isRunning(runId)) return fail(c, "conflict", "stop the run before sweeping the accounts it created");
    const job = await deps.jobs.enqueue(
      "sweep",
      async (_job, report) => {
        await deps.sweep(runId, body.value, report);
        return undefined;
      },
      { runId, label: "removing the accounts this run created" },
    );
    return c.json(job, 202);
  });

  /** Verification is a model call, so it is behind a POST and named in the request (ADR-0014). */
  app.post(routes.runDigestJob(":id"), async (c) => {
    const runId = param(c, "id");
    const job = await deps.jobs.enqueue(
      "digest",
      async (_job, report) => {
        const config = await deps.configForRun(runId);
        await report({ label: "checking the findings nobody has ruled on yet" });
        if (config.verifier.judge === "model" && !deps.hasApiKey()) throw new Error("the model judge needs ANTHROPIC_API_KEY; switch the judge to heuristic or set a key");
        await verifyPending({ store: deps.store, config, ...(deps.provider ? { provider: deps.provider() } : {}) }, { runIds: [runId] });
        await report({ label: "clustering what came back" });
        const wakes = await deps.store.listWakes({ runIds: [runId] });
        const since = wakes[0]?.startedAt ? new Date(wakes[0].startedAt) : new Date(0);
        await buildDigest({ store: deps.store, config, since, until: new Date(), runIds: [runId] });
        return undefined;
      },
      { runId, label: "building the digest" },
    );
    return c.json(job, 202);
  });

  app.post(routes.killSwitch, async (c) => {
    const body = await parseBody(c, KillSwitchBodySchema);
    if (!body.ok) return body.response;
    await deps.store.setKillSwitch(body.value.engaged, body.value.reason ?? (body.value.engaged ? "stopped from the dashboard" : ""));
    return c.json(await deps.store.getKillSwitch());
  });

  app.get(routes.job(":id"), async (c) => {
    const job = await deps.store.getJob(param(c, "id"));
    return job ? c.json(job) : fail(c, "not_found", "no such job");
  });

  // ---- live ---------------------------------------------------------------

  /**
   * Everything `LiveRun` needs in one request, derived from rows rather than from the stream. A
   * browser that reloads mid-run renders the correct screen with no live connection at all, and
   * then resumes the stream from the cursor this returns.
   */
  app.get(routes.runLive(":id"), async (c) => {
    const runId = param(c, "id");
    const [stored, agents, wakes, findings, cursor] = await Promise.all([
      deps.store.getRun(runId),
      deps.store.listAgents({ runId }),
      deps.store.listWakes({ runIds: [runId] }),
      deps.store.listFindings({ runIds: [runId] }),
      deps.store.latestEventSeq(),
    ]);
    if (!stored && agents.length === 0 && wakes.length === 0) return fail(c, "not_found", "no such run");

    const live: AgentLive[] = [];
    for (const agent of agents) {
      const own = wakes.filter((w) => w.agentId === agent.id);
      const current = own.find((w) => w.status === "running");
      // Only the visit in flight needs its trace read; a finished one has nothing live to say.
      const trace: TraceEvent[] = current ? await deps.store.getTrace(current.id) : [];
      const lastCall = [...trace].reverse().find((e) => e.type === "tool.call");
      live.push({
        agentId: agent.id,
        personaId: agent.persona.id,
        personaName: agent.persona.name,
        status: current ? "here" : agent.status === "active" ? "away" : "retired",
        wakeId: current?.id ?? own.at(-1)?.id ?? null,
        wakeNumber: current?.wakeNumber ?? agent.wakeCount,
        maxWakes: agent.maxWakes,
        turn: trace.filter((e) => e.type === "model.call").length,
        lastCall: lastCall?.type === "tool.call" ? lastCall.tool : null,
        nextWakeAt: agent.nextWakeAt,
        costUsd: Number(own.reduce((sum, w) => sum + w.costUsd, 0).toFixed(6)),
        findingCount: findings.filter((f) => f.agentId === agent.id).length,
      });
    }

    const planned = agents.reduce((sum, a) => sum + (a.maxWakes ?? a.wakeCount), 0);
    const view: RunLive = {
      runId,
      status: stored?.status ?? (agents.some((a) => a.status === "active") ? "running" : "completed"),
      startedAt: stored?.startedAt ?? wakes[0]?.startedAt ?? null,
      endedAt: stored?.endedAt ?? null,
      cursor,
      visitsDone: wakes.filter((w) => w.status !== "running").length,
      visitsPlanned: Math.max(planned, wakes.length),
      costUsd: Number(wakes.reduce((sum, w) => sum + w.costUsd, 0).toFixed(6)),
      findings: findings.length,
      agents: live,
    };
    return c.json(view);
  });

  /**
   * One stream for the whole screen (ADR-0026). Everything before `after` comes from the table, so
   * a reconnecting browser replays the gap instead of losing it; everything after arrives live.
   */
  app.get(routes.events, (c) => {
    const q = parseQuery(c, EventStreamQuerySchema);
    if (!q.ok) return q.response;
    // `Last-EventID` is what EventSource sends by itself on a reconnect, so it wins over a cursor
    // the page put in the URL when it first loaded.
    const header = c.req.header("last-event-id");
    const resumeFrom = header !== undefined && header !== "" ? Number.parseInt(header, 10) : q.value.after;
    const runFilter = q.value.run;

    return streamSSE(c, async (stream) => {
      const queue: Event[] = [];
      let notify: (() => void) | null = null;
      const unsubscribe = deps.hub.subscribe((event) => {
        if (runFilter !== undefined && event.runId !== runFilter) return;
        queue.push(event);
        notify?.();
      });

      let cursor = Number.isFinite(resumeFrom) && resumeFrom !== undefined ? resumeFrom : await deps.store.latestEventSeq();
      try {
        // Replay first, in pages, so a long gap does not arrive as one enormous frame.
        for (;;) {
          const missed = await deps.store.listEvents({ afterSeq: cursor, ...(runFilter === undefined ? {} : { runId: runFilter }), limit: 200 });
          if (missed.length === 0) break;
          for (const event of missed) {
            await stream.writeSSE({ id: String(event.seq), event: event.type, data: JSON.stringify(event) });
            cursor = event.seq;
          }
        }

        while (!stream.closed) {
          const event = queue.shift();
          if (event === undefined) {
            // A comment frame keeps proxies and load balancers from closing an idle stream, and
            // costs one line every fifteen seconds.
            await Promise.race([new Promise<void>((resolve) => (notify = resolve)), new Promise((resolve) => setTimeout(resolve, 15_000))]);
            notify = null;
            if (queue.length === 0 && !stream.closed) await stream.writeSSE({ event: "ping", data: String(Date.now()) });
            continue;
          }
          // Events replayed above may also be in the queue; the cursor is what makes this idempotent.
          if (event.seq <= cursor) continue;
          await stream.writeSSE({ id: String(event.seq), event: event.type, data: JSON.stringify(event) });
          cursor = event.seq;
        }
      } finally {
        unsubscribe();
      }
    });
  });

  // Paging over the event log, for anything that wants history without a stream.
  app.get(`${routes.events}/history`, async (c) => {
    const q = parseQuery(c, EventStreamQuerySchema);
    if (!q.ok) return q.response;
    const events = await deps.store.listEvents({ ...(q.value.after === undefined ? {} : { afterSeq: q.value.after }), ...(q.value.run === undefined ? {} : { runId: q.value.run }), limit: 500 });
    return c.json(page(events, undefined, 500));
  });
}

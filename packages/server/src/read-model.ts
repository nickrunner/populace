import {
  FindingKindSchema,
  SeveritySchema,
  WakeStatusSchema,
  type Agent,
  type Finding,
  type FindingKind,
  type Guardrails,
  type Identity,
  type Memory,
  type Run,
  type Severity,
  type Store,
  type Wake,
  type WakeStatus,
} from "@populace/core";
import type { AgentSummary, RunDetail, RunStatus, RunSummary, RunTotals, SpendBucket, SpendView, ToolUsage, ToolUsageView, WakeSummary } from "@populace/contract";
import type { TargetView } from "@populace/contract";

/**
 * Derives the run-shaped read models the dashboard needs from the rows the store already holds.
 *
 * M1 added no tables (ADR-0024), so a run was reconstructed here: its window from wake timestamps,
 * its totals by aggregation, its lineage from `agents.continuedFrom`. M2 put a `runs` table
 * underneath without changing a single shape, and the derivation stays as the fallback — a
 * database written before M2 has runs with no row, and those still have to render.
 *
 * The stored row wins for the things derivation cannot know: a run that was killed, one that was
 * drained to a pause, the label a user typed. Totals are still recomputed, because the counters on
 * the row are a cache and a run whose daemon died would otherwise report stale ones forever.
 */
export class ReadModel {
  constructor(
    private readonly store: Store,
    private readonly guardrails?: Guardrails,
  ) {}

  private static totals(agents: Agent[], wakes: Wake[], findings: Finding[]): RunTotals {
    return {
      agents: agents.length,
      activeAgents: agents.filter((a) => a.status === "active").length,
      wakes: wakes.length,
      findings: findings.length,
      confirmed: findings.filter((f) => f.verification?.verdict === "confirmed").length,
      costUsd: round(wakes.reduce((sum, w) => sum + w.costUsd, 0) + findings.reduce((sum, f) => sum + (f.verification?.costUsd ?? 0), 0)),
    };
  }

  /**
   * Coarse by construction: a run is `running` while it still has an active agent. Nothing in
   * the current rows distinguishes a run that finished from one whose daemon was killed, which
   * is one of the reasons M2 gives runs a row (ADR-0024).
   */
  private static status(agents: Agent[], wakes: Wake[]): RunStatus {
    if (agents.length === 0 && wakes.length === 0) return "pending";
    if (wakes.some((w) => w.status === "running")) return "running";
    if (agents.some((a) => a.status === "active")) return "running";
    if (wakes.length > 0 && wakes.every((w) => w.status === "killed")) return "killed";
    return "completed";
  }

  private static window(wakes: Wake[], agents: Agent[], status: RunStatus): { startedAt: string | null; endedAt: string | null } {
    const starts = wakes.map((w) => w.startedAt).concat(agents.map((a) => a.createdAt));
    const ends = wakes.map((w) => w.endedAt).filter((e): e is string => e !== null);
    // A run with agents still due to wake has not ended, however long ago its last visit finished.
    const over = status !== "running" && status !== "pending" && !wakes.some((w) => w.endedAt === null) && ends.length > 0;
    return {
      startedAt: starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : null,
      endedAt: over ? ends.reduce((a, b) => (a > b ? a : b)) : null,
    };
  }

  private static parentOf(agents: Agent[]): string | null {
    return agents.find((a) => a.continuedFrom !== null)?.continuedFrom?.runId ?? null;
  }

  private async load(runId: string): Promise<{ agents: Agent[]; wakes: Wake[]; findings: Finding[] }> {
    const [agents, wakes, findings] = await Promise.all([
      this.store.listAgents({ runId }),
      this.store.listWakes({ runIds: [runId] }),
      this.store.listFindings({ runIds: [runId] }),
    ]);
    return { agents, wakes, findings };
  }

  private static summary(runId: string, agents: Agent[], wakes: Wake[], findings: Finding[], stored?: Run): RunSummary {
    const derivedStatus = ReadModel.status(agents, wakes);
    // A stored run that this process is no longer driving may still say `running` — `serve` fails
    // those on open, so trusting the row here is not trusting a stale one.
    const status = stored?.status ?? derivedStatus;
    const derived = ReadModel.window(wakes, agents, status);
    return {
      id: runId,
      label: stored?.label || labelFor(runId, agents, stored?.startedAt ?? derived.startedAt),
      populationId: stored?.populationId || agents[0]?.populationId || wakes[0]?.populationId || "",
      status,
      startedAt: stored?.startedAt ?? derived.startedAt,
      endedAt: stored?.endedAt ?? derived.endedAt,
      parentRunId: stored?.parentRunId ?? ReadModel.parentOf(agents),
      totals: ReadModel.totals(agents, wakes, findings),
    };
  }

  /** Newest run first. Run ids embed a base36 timestamp, so a reverse sort is chronological. */
  async listRuns(): Promise<RunSummary[]> {
    const ids = (await this.store.listRunIds()).sort().reverse();
    const stored = new Map((await this.store.listRuns()).map((r) => [r.id, r]));
    const out: RunSummary[] = [];
    for (const id of ids) {
      const { agents, wakes, findings } = await this.load(id);
      out.push(ReadModel.summary(id, agents, wakes, findings, stored.get(id)));
    }
    return out;
  }

  async getRun(runId: string): Promise<RunDetail | undefined> {
    const { agents, wakes, findings } = await this.load(runId);
    const stored = await this.store.getRun(runId);
    // A run created a moment ago has a row and nothing else yet, and the browser is already
    // looking at it, so the row alone is enough to exist.
    if (!stored && agents.length === 0 && wakes.length === 0 && findings.length === 0) return undefined;
    const carried = agents.filter((a) => a.continuedFrom !== null);
    // A child run is one whose agents point back here; there is no index for that yet, so the
    // lineage is resolved by scanning the other runs' agents. Cheap at local scale, and gone
    // the moment runs have a parent column of their own.
    const childRunIds = new Set((await this.store.listRuns()).filter((r) => r.parentRunId === runId).map((r) => r.id));
    for (const id of await this.store.listRunIds()) {
      if (id === runId || childRunIds.has(id)) continue;
      const others = await this.store.listAgents({ runId: id });
      if (others.some((a) => a.continuedFrom?.runId === runId)) childRunIds.add(id);
    }
    const findingsByKind = countBy(FindingKindSchema.options, findings, (f) => f.kind);
    const findingsBySeverity = countBy(SeveritySchema.options, findings, (f) => f.severity);
    const wakesByStatus = countBy<WakeStatus, Wake>(WakeStatusSchema.options, wakes, (w) => w.status);
    const judged = findings.filter((f) => f.verification !== null);
    return {
      ...ReadModel.summary(runId, agents, wakes, findings, stored),
      childRunIds: [...childRunIds].sort(),
      carriedAgents: stored?.continuation?.carriedAgents ?? carried.length,
      returningAfterGiveUp: stored?.continuation?.returningAfterGiveUp ?? carried.filter((a) => a.continuedFrom?.gaveUp === true).length,
      findingsByKind,
      findingsBySeverity,
      wakesByStatus,
      verified: {
        checked: judged.length,
        confirmed: judged.filter((f) => f.verification?.verdict === "confirmed").length,
        notReproduced: judged.filter((f) => f.verification?.verdict === "not-reproduced").length,
        inconclusive: judged.filter((f) => f.verification?.verdict === "inconclusive").length,
      },
    };
  }

  async listAgents(runId: string): Promise<AgentSummary[]> {
    const { agents, wakes, findings } = await this.load(runId);
    const identities = new Map<string, Identity>();
    for (const agent of agents) {
      if (agent.identityId === null) continue;
      const identity = await this.store.getIdentity(agent.identityId);
      if (identity) identities.set(agent.id, identity);
    }
    return agents.map((agent) => {
      const identity = identities.get(agent.id);
      const own = wakes.filter((w) => w.agentId === agent.id);
      const last = own.at(-1);
      return {
        id: agent.id,
        runId: agent.runId,
        personaId: agent.persona.id,
        personaName: agent.persona.name,
        role: agent.persona.role,
        status: agent.status,
        retiredReason: agent.retiredReason,
        continuedFrom: agent.continuedFrom,
        identityId: agent.identityId,
        wakeCount: agent.wakeCount,
        maxWakes: agent.maxWakes,
        nextWakeAt: agent.nextWakeAt,
        lastWakeAt: agent.lastWakeAt,
        findingCount: findings.filter((f) => f.agentId === agent.id).length,
        costUsd: round(own.reduce((sum, w) => sum + w.costUsd, 0)),
        wouldReturn: last?.wouldReturn ?? null,
        backstory: agent.persona.backstory,
        patience: agent.persona.patience,
        budgetUsd: agent.persona.budgetUsd,
        model: last?.model ?? agent.persona.model.model ?? "",
        effort: last?.effort ?? agent.persona.model.effort ?? "",
        // The readable handle only. The credential's bearer token never leaves the store.
        account: identity ? { email: identity.credential.email ?? null, userId: identity.credential.userId ?? null } : null,
      };
    });
  }

  memory(runId: string, agentId: string): Promise<Memory | undefined> {
    return this.store.getMemory(runId, agentId);
  }

  /**
   * What each of the target's tools was actually used for in this run, including the ones nobody
   * called. Counting means reading every wake's trace, which is fine over one local run and is the
   * first read that will want the event log's aggregates when runs get long (ADR-0026).
   */
  async toolUsage(runId: string, target: TargetView): Promise<ToolUsageView> {
    const wakes = await this.store.listWakes({ runIds: [runId] });
    const byName = new Map<string, ToolUsage>();
    const seed = (name: string, exposed: boolean, destructive: boolean): ToolUsage =>
      byName.get(name) ?? { name, calls: 0, errors: 0, agents: [], firstUsedAt: null, lastUsedAt: null, exposed, destructive };

    for (const tool of target.tools ?? []) byName.set(tool.name, seed(tool.name, true, tool.destructive));

    for (const wake of wakes) {
      for (const event of await this.store.getTrace(wake.id)) {
        if (event.type !== "tool.call") continue;
        const current = seed(event.tool, byName.has(event.tool), false);
        current.calls += 1;
        if (event.result.isError) current.errors += 1;
        if (!current.agents.includes(wake.agentId)) current.agents.push(wake.agentId);
        current.firstUsedAt = current.firstUsedAt === null || event.at < current.firstUsedAt ? event.at : current.firstUsedAt;
        current.lastUsedAt = current.lastUsedAt === null || event.at > current.lastUsedAt ? event.at : current.lastUsedAt;
        byName.set(event.tool, current);
      }
    }
    const items = [...byName.values()].sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
    return {
      items,
      exposedCount: items.filter((t) => t.exposed).length,
      neverCalledCount: items.filter((t) => t.exposed && t.calls === 0).length,
      toolsError: target.toolsError,
    };
  }

  /** Wake rows carry a persona id but not a name; the list is unreadable without one. */
  async listWakes(runId: string, agentId?: string): Promise<WakeSummary[]> {
    const [wakes, agents] = await Promise.all([
      this.store.listWakes(agentId === undefined ? { runIds: [runId] } : { runIds: [runId], agentId }),
      this.store.listAgents({ runId }),
    ]);
    const names = new Map(agents.map((a) => [a.persona.id, a.persona.name]));
    return wakes.map((w) => ({ ...w, personaName: names.get(w.personaId) ?? w.personaId }));
  }

  async spend(runId: string): Promise<SpendView> {
    const [wakes, agents] = await Promise.all([this.store.listWakes({ runIds: [runId] }), this.store.listAgents({ runId })]);
    const names = new Map(agents.map((a) => [a.persona.id, a.persona.name]));
    // Spend against the daily ceiling is per population and trailing 24h, exactly as the
    // guardrail that enforces it measures it (ADR-0009) - not "this run so far".
    const populationId = agents[0]?.populationId ?? wakes[0]?.populationId;
    const spentToday = populationId === undefined ? 0 : await this.store.costSince(populationId, new Date(Date.now() - 86_400_000));
    return {
      totalUsd: round(wakes.reduce((sum, w) => sum + w.costUsd, 0)),
      dailyCeilingUsd: this.guardrails?.dailyUsd ?? 0,
      spentTodayUsd: round(spentToday),
      byAgent: bucket(wakes, (w) => w.agentId, (w) => w.agentId),
      byPersona: bucket(wakes, (w) => w.personaId, (w) => names.get(w.personaId) ?? w.personaId),
      byDay: bucket(wakes, (w) => w.startedAt.slice(0, 10), (w) => w.startedAt.slice(0, 10)),
    };
  }
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

/**
 * Every key is present with a zero rather than omitted: the wire schema is a full record, and a
 * chart that has to guess whether a missing key means zero or means "not counted" is a bug
 * waiting to happen.
 */
function countBy<K extends FindingKind | Severity | WakeStatus, T = Finding>(keys: readonly K[], rows: T[], of: (row: T) => K): Record<K, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const row of rows) out[of(row)] += 1;
  return out;
}

function bucket(wakes: Wake[], keyOf: (w: Wake) => string, labelOf: (w: Wake) => string): SpendBucket[] {
  const map = new Map<string, SpendBucket>();
  for (const w of wakes) {
    const key = keyOf(w);
    const current = map.get(key) ?? { key, label: labelOf(w), wakes: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 };
    current.wakes += 1;
    current.costUsd += w.costUsd;
    current.inputTokens += w.usage.inputTokens;
    current.outputTokens += w.usage.outputTokens;
    current.cacheReadInputTokens += w.usage.cacheReadInputTokens;
    map.set(key, current);
  }
  return [...map.values()].map((b) => ({ ...b, costUsd: round(b.costUsd) })).sort((a, b) => b.costUsd - a.costUsd || a.key.localeCompare(b.key));
}

/** A run has no name of its own until M2, so it is named after what produced it. */
function labelFor(runId: string, agents: Agent[], startedAt: string | null): string {
  const population = agents[0]?.populationId;
  const when = startedAt ? startedAt.slice(0, 16).replace("T", " ") : null;
  if (population && when) return `${population} · ${when}`;
  return population ?? runId;
}

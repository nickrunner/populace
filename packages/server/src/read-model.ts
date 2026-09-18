import {
  FindingKindSchema,
  SeveritySchema,
  type Agent,
  type Finding,
  type FindingKind,
  type Severity,
  type Store,
  type Wake,
} from "@populace/core";
import type { AgentSummary, RunDetail, RunStatus, RunSummary, RunTotals, SpendBucket, SpendView, WakeSummary } from "@populace/contract";

/**
 * Derives the run-shaped read models the dashboard needs from the rows the store already holds.
 *
 * M1 adds no tables (ADR-0024), so a run is reconstructed here: its window from wake timestamps,
 * its totals by aggregation, its lineage from `agents.continuedFrom`. M2 replaces the body of
 * these functions with reads of a `runs` table without changing their shapes.
 */
export class ReadModel {
  constructor(private readonly store: Store) {}

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

  private static window(wakes: Wake[], agents: Agent[]): { startedAt: string | null; endedAt: string | null } {
    const starts = wakes.map((w) => w.startedAt).concat(agents.map((a) => a.createdAt));
    const ends = wakes.map((w) => w.endedAt).filter((e): e is string => e !== null);
    return {
      startedAt: starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : null,
      endedAt: wakes.some((w) => w.endedAt === null) || ends.length === 0 ? null : ends.reduce((a, b) => (a > b ? a : b)),
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

  private static summary(runId: string, agents: Agent[], wakes: Wake[], findings: Finding[]): RunSummary {
    const { startedAt, endedAt } = ReadModel.window(wakes, agents);
    return {
      id: runId,
      label: labelFor(runId, agents, startedAt),
      populationId: agents[0]?.populationId ?? wakes[0]?.populationId ?? "",
      status: ReadModel.status(agents, wakes),
      startedAt,
      endedAt,
      parentRunId: ReadModel.parentOf(agents),
      totals: ReadModel.totals(agents, wakes, findings),
    };
  }

  /** Newest run first. Run ids embed a base36 timestamp, so a reverse sort is chronological. */
  async listRuns(): Promise<RunSummary[]> {
    const ids = (await this.store.listRunIds()).sort().reverse();
    const out: RunSummary[] = [];
    for (const id of ids) {
      const { agents, wakes, findings } = await this.load(id);
      out.push(ReadModel.summary(id, agents, wakes, findings));
    }
    return out;
  }

  async getRun(runId: string): Promise<RunDetail | undefined> {
    const { agents, wakes, findings } = await this.load(runId);
    if (agents.length === 0 && wakes.length === 0 && findings.length === 0) return undefined;
    const carried = agents.filter((a) => a.continuedFrom !== null);
    // A child run is one whose agents point back here; there is no index for that yet, so the
    // lineage is resolved by scanning the other runs' agents. Cheap at local scale, and gone
    // the moment runs have a parent column of their own.
    const childRunIds: string[] = [];
    for (const id of await this.store.listRunIds()) {
      if (id === runId) continue;
      const others = await this.store.listAgents({ runId: id });
      if (others.some((a) => a.continuedFrom?.runId === runId)) childRunIds.push(id);
    }
    const findingsByKind = countBy(FindingKindSchema.options, findings, (f) => f.kind);
    const findingsBySeverity = countBy(SeveritySchema.options, findings, (f) => f.severity);
    return {
      ...ReadModel.summary(runId, agents, wakes, findings),
      childRunIds: childRunIds.sort(),
      carriedAgents: carried.length,
      returningAfterGiveUp: carried.filter((a) => a.continuedFrom?.gaveUp === true).length,
      findingsByKind,
      findingsBySeverity,
    };
  }

  async listAgents(runId: string): Promise<AgentSummary[]> {
    const { agents, wakes, findings } = await this.load(runId);
    return agents.map((agent) => {
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
      };
    });
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
    return {
      totalUsd: round(wakes.reduce((sum, w) => sum + w.costUsd, 0)),
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
function countBy<K extends FindingKind | Severity>(keys: readonly K[], findings: Finding[], of: (f: Finding) => K): Record<K, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const f of findings) out[of(f)] += 1;
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

import {
  FindingKindSchema,
  SeveritySchema,
  WakeStatusSchema,
  tagForRun,
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
import type { ParticipantSummaryView, RunDetail, RunStatus, RunSummary, RunTotals, SpendBucket, SpendView, ToolUsage, ToolUsageView, WakeSummary } from "@populace/contract";
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

  /**
   * Newest run first. Run ids embed a base36 timestamp, so a reverse sort is chronological.
   *
   * A filter is honoured IN SQL — `runs` carries `project_id` and `simulation_id`, and the store
   * has accepted that filter since M2 while this method ignored it and loaded every run in the
   * database to build a list of one project's. A run with no row at all predates M2 and belongs
   * to no project, so a filtered list is exactly the filtered rows.
   */
  async listRuns(filter: { projectId?: string; simulationId?: string } = {}): Promise<RunSummary[]> {
    const scoped = filter.projectId !== undefined || filter.simulationId !== undefined;
    const stored = new Map((await this.store.listRuns(filter)).map((r) => [r.id, r]));
    const ids = scoped ? [...stored.keys()].sort().reverse() : [...new Set([...(await this.store.listRunIds()), ...stored.keys()])].sort().reverse();
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
    // One index lookup on `runs_parent`. This used to load every other run's agents looking for
    // one that pointed back here, on a screen the browser re-polls while a run is going.
    const childRunIds = new Set((await this.store.listRuns({ parentRunId: runId })).map((r) => r.id));
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

  /**
   * The participants of one execution, translated for the wire (Decision A): `wakeCount` is
   * `visits`, `maxWakes` is `maxVisits`, and the word "agent" does not appear in what comes back.
   * The rows underneath are `Agent`s and every store method still says so.
   *
   * Identities are fetched for the whole run in one call rather than one per participant: they
   * all carry the run's tag, and a query per head is the shape this stage exists to remove.
   */
  async listParticipants(runId: string): Promise<ParticipantSummaryView[]> {
    const { agents, wakes, findings } = await this.load(runId);
    const identities = await this.identitiesOf(runId, agents);
    const cohortNames = await this.cohortNames(runId, agents);
    return agents.map((agent) => participantOf(agent, wakes, findings, identities.get(agent.id), cohortNames.get(agent.cohortSlug) ?? agent.cohortSlug));
  }

  /**
   * Each participant's account, by agent id.
   *
   * The tag is the fast path: every identity a run created carries it, so one call covers a whole
   * execution. It is not the only path, because a CARRY-FORWARD creates no identities — it copies
   * the parent's `identityId` onto the child's agents, and those rows carry the PARENT's tag. The
   * fallback reads exactly the ids the tag missed, which is nothing at all for an ordinary run and
   * one pass for a continuation, never a query per head.
   */
  async identitiesOf(runId: string, agents: Agent[]): Promise<Map<string, Identity>> {
    const byAgent = new Map((await this.store.listIdentitiesByTag(tagForRun(runId), true)).map((identity) => [identity.agentId, identity]));
    const missing = agents.filter((agent) => agent.identityId !== null && !byAgent.has(agent.id));
    for (const agent of missing) {
      const identity = agent.identityId === null ? undefined : await this.store.getIdentity(agent.identityId);
      if (identity) byAgent.set(agent.id, identity);
    }
    return byAgent;
  }

  /**
   * A cohort's display name, from the config this run froze. The agent row carries the slug (it is
   * half of an agent id and therefore immutable); the readable name lives in the snapshot, which
   * is also what makes a three-month-old execution render the name it actually ran under.
   */
  private async cohortNames(runId: string, agents: Agent[]): Promise<Map<string, string>> {
    const out = new Map(agents.map((a) => [a.cohortSlug, a.cohortSlug]));
    const run = await this.store.getRun(runId);
    const snapshot = run?.configSnapshotId ? await this.store.getConfigSnapshot(run.configSnapshotId) : undefined;
    for (const member of snapshot?.config.population.members ?? []) out.set(member.cohort, member.cohortName);
    return out;
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

    // One call for every visit's trace rather than one call per visit: the round trips must not
    // grow with the headcount (SPEC §6.2).
    const agentOf = new Map(wakes.map((w) => [w.id, w.agentId]));
    for (const event of await this.store.getTraces(wakes.map((w) => w.id))) {
      if (event.type !== "tool.call") continue;
      const current = seed(event.tool, byName.has(event.tool), false);
      current.calls += 1;
      if (event.result.isError) current.errors += 1;
      const who = agentOf.get(event.wakeId) ?? "";
      if (!current.agents.includes(who)) current.agents.push(who);
      current.firstUsedAt = current.firstUsedAt === null || event.at < current.firstUsedAt ? event.at : current.firstUsedAt;
      current.lastUsedAt = current.lastUsedAt === null || event.at > current.lastUsedAt ? event.at : current.lastUsedAt;
      byName.set(event.tool, current);
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
    // Cohort, not persona, is what a bill is read by now: two cohorts may share one persona, so
    // a per-persona row cannot answer "what did the sceptics cost me".
    const cohortOf = new Map(agents.map((a) => [a.id, a.cohortSlug]));
    // Spend against the daily ceiling is per population and trailing 24h, exactly as the
    // guardrail that enforces it measures it (ADR-0009) - not "this run so far".
    const populationId = agents[0]?.populationId ?? wakes[0]?.populationId;
    const spentToday = populationId === undefined ? 0 : await this.store.costSince({ populationId }, new Date(Date.now() - 86_400_000));
    return {
      totalUsd: round(wakes.reduce((sum, w) => sum + w.costUsd, 0)),
      dailyCeilingUsd: this.guardrails?.dailyUsd ?? 0,
      spentTodayUsd: round(spentToday),
      byAgent: bucket(wakes, (w) => w.agentId, (w) => w.agentId),
      byPersona: bucket(wakes, (w) => w.personaId, (w) => names.get(w.personaId) ?? w.personaId),
      byCohort: bucket(wakes, (w) => cohortOf.get(w.agentId) ?? "", (w) => cohortOf.get(w.agentId) ?? ""),
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

/**
 * One `Agent` row as the wire describes it (Decision A). The translation is here, in one place,
 * so a participant view built by the run read model and one built by the project read model
 * cannot drift into meaning different things.
 */
export function participantOf(agent: Agent, wakes: Wake[], findings: Finding[], identity: Identity | undefined, cohortName: string): ParticipantSummaryView {
  const own = wakes.filter((w) => w.agentId === agent.id);
  const last = own.at(-1);
  const mine = findings.filter((f) => f.agentId === agent.id);
  return {
    id: agent.id,
    runId: agent.runId,
    personId: agent.personId,
    name: agent.name,
    cohortSlug: agent.cohortSlug,
    cohortName,
    // The persona's IMMUTABLE slug, inlined as its id when the config was resolved. A display
    // name rename must never move it: continuations match on it.
    personaSlug: agent.persona.id,
    personaName: agent.persona.name,
    role: agent.persona.role,
    status: agent.status,
    retiredReason: agent.retiredReason,
    continuedFrom: agent.continuedFrom,
    visits: agent.wakeCount,
    maxVisits: agent.maxWakes,
    findings: mine.length,
    confirmed: mine.filter((f) => f.verification?.verdict === "confirmed").length,
    costUsd: round(own.reduce((sum, w) => sum + w.costUsd, 0)),
    wouldReturn: last?.wouldReturn ?? null,
    lastVisitAt: agent.lastWakeAt,
    nextVisitAt: agent.nextWakeAt,
    // The readable handle only. The credential's bearer token never leaves the store.
    account: identity ? { email: identity.credential.email ?? null, userId: identity.credential.userId ?? null } : null,
  };
}

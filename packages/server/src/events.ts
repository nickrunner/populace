import type { Event, EventInput, Finding, Identity, Store, TraceEvent, Wake } from "@populace/core";

/**
 * The event log, written by wrapping the store rather than by instrumenting the wake loop
 * (ADR-0026, `DATA-MODEL.md` §9). Every row this appends is derived from a write the runner was
 * already making, which is what keeps `runWake()` untouched and keeps the log honestly derived:
 * truncating it loses nothing the produced tables do not still hold.
 *
 * The daemon writes the run-boundary events itself, because a run starting is not a store write.
 */
export class RecordingStore implements Store {
  constructor(
    private readonly inner: Store,
    private readonly onEvent: (event: Event) => void = () => undefined,
  ) {}

  /**
   * Which project and simulation a run belongs to. Cached because every trace event asks, and a
   * run's project never changes: a run row is written once, before its first wake.
   */
  private readonly runScope = new Map<string, { projectId: string | null; simulationId: string | null }>();
  /** Which run a wake belongs to, for the events that know their wake and not their run. */
  private readonly wakeRun = new Map<string, string>();

  /**
   * Stamps the project and the simulation onto an event.
   *
   * An emitter deep inside a wake knows its wake and its run and has no business knowing which
   * project it is filed under, so the stamp happens here — which is what lets one stream follow a
   * whole project (`GET /events?project=…`) without a client opening a connection per run.
   */
  private async scoped(input: EventInput): Promise<EventInput> {
    if (input.projectId !== undefined && input.simulationId !== undefined) return input;
    const runId = input.runId ?? (input.wakeId === null ? null : await this.runOfWake(input.wakeId));
    if (runId === null) return input;
    let scope = this.runScope.get(runId);
    if (!scope) {
      const run = await this.inner.getRun(runId);
      // A run that has no row yet (the row is written a moment later) is not cached: the next
      // event asks again rather than remembering "no project" forever.
      if (!run) return { ...input, runId };
      scope = { projectId: run.projectId, simulationId: run.simulationId };
      this.runScope.set(runId, scope);
    }
    return { ...input, runId, projectId: input.projectId ?? scope.projectId, simulationId: input.simulationId ?? scope.simulationId };
  }

  private async runOfWake(wakeId: string): Promise<string | null> {
    const cached = this.wakeRun.get(wakeId);
    if (cached !== undefined) return cached;
    const wake = await this.inner.getWake(wakeId);
    if (!wake) return null;
    this.wakeRun.set(wakeId, wake.runId);
    return wake.runId;
  }

  private async record(input: EventInput): Promise<void> {
    // A failed event append must never fail the wake that produced it: the log is derived data and
    // losing a row of it costs a live update, while throwing here would lose the wake.
    try {
      this.onEvent(await this.inner.appendEvent(await this.scoped(input)));
    } catch {
      /* derived data; the produced row is already written */
    }
  }

  async appendTraceEvent(event: TraceEvent): Promise<void> {
    await this.inner.appendTraceEvent(event);
    if (event.type === "guardrail") {
      await this.record({ runId: null, wakeId: event.wakeId, type: "guardrail.tripped", payload: { rule: event.rule, detail: event.detail, tool: event.tool ?? null, seq: event.seq } });
      return;
    }
    // The trace pane wants enough to render a row without a second request, and no more: full
    // arguments and results stay in `trace_events`, which is where replay reads them from.
    await this.record({
      runId: event.type === "wake.start" ? event.runId : null,
      wakeId: event.wakeId,
      type: "trace.appended",
      payload: { seq: event.seq, traceType: event.type, at: event.at, summary: summarise(event) },
    });
  }

  async saveWake(wake: Wake): Promise<void> {
    const before = await this.inner.getWake(wake.id);
    await this.inner.saveWake(wake);
    if (!before) {
      await this.record({ runId: wake.runId, wakeId: wake.id, type: "wake.started", payload: { agentId: wake.agentId, personaId: wake.personaId, wakeNumber: wake.wakeNumber } });
      return;
    }
    // A wake is saved repeatedly as it runs; only the transition out of `running` is an ending.
    if (before.status === "running" && wake.status !== "running") {
      await this.record({
        runId: wake.runId,
        wakeId: wake.id,
        type: "wake.ended",
        payload: { agentId: wake.agentId, personaId: wake.personaId, status: wake.status, costUsd: wake.costUsd, turns: wake.turns, toolCalls: wake.toolCalls, findingCount: wake.findingCount, wouldReturn: wake.wouldReturn, summary: wake.summary },
      });
    }
  }

  async saveFinding(finding: Finding): Promise<void> {
    const before = await this.inner.getFinding(finding.id);
    await this.inner.saveFinding(finding);
    if (before) return;
    await this.record({ runId: finding.runId, wakeId: finding.wakeId, type: "finding.filed", payload: { findingId: finding.id, kind: finding.kind, severity: finding.severity, title: finding.title, tool: finding.tool ?? null, agentId: finding.agentId } });
  }

  async saveIdentity(identity: Identity): Promise<void> {
    const before = await this.inner.getIdentity(identity.id);
    await this.inner.saveIdentity(identity);
    if (before) return;
    // The handle only. The credential this row also carries never reaches the wire.
    await this.record({ runId: identity.runId, wakeId: null, type: "identity.created", payload: { agentId: identity.agentId, email: identity.credential.email ?? null, userId: identity.credential.userId ?? null } });
  }

  async appendEvent(event: EventInput): Promise<Event> {
    const saved = await this.inner.appendEvent(await this.scoped(event));
    this.onEvent(saved);
    return saved;
  }

  // ---- everything else is the inner store, unchanged -----------------------

  upsertAgent: Store["upsertAgent"] = (...args) => this.inner.upsertAgent(...args);
  getAgent: Store["getAgent"] = (...args) => this.inner.getAgent(...args);
  listAgents: Store["listAgents"] = (...args) => this.inner.listAgents(...args);
  listDueAgents: Store["listDueAgents"] = (...args) => this.inner.listDueAgents(...args);
  deleteAgentsByRun: Store["deleteAgentsByRun"] = (...args) => this.inner.deleteAgentsByRun(...args);
  getIdentity: Store["getIdentity"] = (...args) => this.inner.getIdentity(...args);
  listIdentitiesByTag: Store["listIdentitiesByTag"] = (...args) => this.inner.listIdentitiesByTag(...args);
  markIdentityTornDown: Store["markIdentityTornDown"] = (...args) => this.inner.markIdentityTornDown(...args);
  deleteIdentitiesByRun: Store["deleteIdentitiesByRun"] = (...args) => this.inner.deleteIdentitiesByRun(...args);
  getMemory: Store["getMemory"] = (...args) => this.inner.getMemory(...args);
  saveMemory: Store["saveMemory"] = (...args) => this.inner.saveMemory(...args);
  getWake: Store["getWake"] = (...args) => this.inner.getWake(...args);
  listWakes: Store["listWakes"] = (...args) => this.inner.listWakes(...args);
  getTrace: Store["getTrace"] = (...args) => this.inner.getTrace(...args);
  getTraces: Store["getTraces"] = (...args) => this.inner.getTraces(...args);
  deleteWakesByRun: Store["deleteWakesByRun"] = (...args) => this.inner.deleteWakesByRun(...args);
  getFinding: Store["getFinding"] = (...args) => this.inner.getFinding(...args);
  listFindings: Store["listFindings"] = (...args) => this.inner.listFindings(...args);
  saveVerification: Store["saveVerification"] = (...args) => this.inner.saveVerification(...args);
  deleteFindingsByRun: Store["deleteFindingsByRun"] = (...args) => this.inner.deleteFindingsByRun(...args);
  costSince: Store["costSince"] = (...args) => this.inner.costSince(...args);
  setKillSwitch: Store["setKillSwitch"] = (...args) => this.inner.setKillSwitch(...args);
  getKillSwitch: Store["getKillSwitch"] = (...args) => this.inner.getKillSwitch(...args);
  getControl: Store["getControl"] = (...args) => this.inner.getControl(...args);
  setControl: Store["setControl"] = (...args) => this.inner.setControl(...args);
  deleteControl: Store["deleteControl"] = (...args) => this.inner.deleteControl(...args);
  listRunIds: Store["listRunIds"] = (...args) => this.inner.listRunIds(...args);
  saveRun: Store["saveRun"] = (...args) => this.inner.saveRun(...args);
  getRun: Store["getRun"] = (...args) => this.inner.getRun(...args);
  listRuns: Store["listRuns"] = (...args) => this.inner.listRuns(...args);
  deleteRun: Store["deleteRun"] = (...args) => this.inner.deleteRun(...args);
  saveConfigSnapshot: Store["saveConfigSnapshot"] = (...args) => this.inner.saveConfigSnapshot(...args);
  getConfigSnapshot: Store["getConfigSnapshot"] = (...args) => this.inner.getConfigSnapshot(...args);
  findConfigSnapshotByHash: Store["findConfigSnapshotByHash"] = (...args) => this.inner.findConfigSnapshotByHash(...args);
  saveProject: Store["saveProject"] = (...args) => this.inner.saveProject(...args);
  getProject: Store["getProject"] = (...args) => this.inner.getProject(...args);
  listProjects: Store["listProjects"] = (...args) => this.inner.listProjects(...args);
  deleteProject: Store["deleteProject"] = (...args) => this.inner.deleteProject(...args);
  saveTarget: Store["saveTarget"] = (...args) => this.inner.saveTarget(...args);
  getTarget: Store["getTarget"] = (...args) => this.inner.getTarget(...args);
  listTargets: Store["listTargets"] = (...args) => this.inner.listTargets(...args);
  deleteTarget: Store["deleteTarget"] = (...args) => this.inner.deleteTarget(...args);

  /* A sign-in is the user's own OAuth grant, not a row a run produces, so it is passed through
     unlogged like every other authored write. */
  saveSignInGrant: Store["saveSignInGrant"] = (...args) => this.inner.saveSignInGrant(...args);
  getSignInGrant: Store["getSignInGrant"] = (...args) => this.inner.getSignInGrant(...args);
  listSignInGrants: Store["listSignInGrants"] = (...args) => this.inner.listSignInGrants(...args);
  deleteSignInGrant: Store["deleteSignInGrant"] = (...args) => this.inner.deleteSignInGrant(...args);
  savePersona: Store["savePersona"] = (...args) => this.inner.savePersona(...args);
  getPersona: Store["getPersona"] = (...args) => this.inner.getPersona(...args);
  listPersonas: Store["listPersonas"] = (...args) => this.inner.listPersonas(...args);
  deletePersona: Store["deletePersona"] = (...args) => this.inner.deletePersona(...args);
  saveCohort: Store["saveCohort"] = (...args) => this.inner.saveCohort(...args);
  getCohort: Store["getCohort"] = (...args) => this.inner.getCohort(...args);
  listCohorts: Store["listCohorts"] = (...args) => this.inner.listCohorts(...args);
  deleteCohort: Store["deleteCohort"] = (...args) => this.inner.deleteCohort(...args);
  savePerson: Store["savePerson"] = (...args) => this.inner.savePerson(...args);
  getPerson: Store["getPerson"] = (...args) => this.inner.getPerson(...args);
  listPeople: Store["listPeople"] = (...args) => this.inner.listPeople(...args);
  archivePeople: Store["archivePeople"] = (...args) => this.inner.archivePeople(...args);
  saveSimulation: Store["saveSimulation"] = (...args) => this.inner.saveSimulation(...args);
  getSimulation: Store["getSimulation"] = (...args) => this.inner.getSimulation(...args);
  listSimulations: Store["listSimulations"] = (...args) => this.inner.listSimulations(...args);
  deleteSimulation: Store["deleteSimulation"] = (...args) => this.inner.deleteSimulation(...args);
  saveTriage: Store["saveTriage"] = (...args) => this.inner.saveTriage(...args);
  getTriage: Store["getTriage"] = (...args) => this.inner.getTriage(...args);
  listTriage: Store["listTriage"] = (...args) => this.inner.listTriage(...args);
  savePopulation: Store["savePopulation"] = (...args) => this.inner.savePopulation(...args);
  getPopulation: Store["getPopulation"] = (...args) => this.inner.getPopulation(...args);
  listPopulations: Store["listPopulations"] = (...args) => this.inner.listPopulations(...args);
  deletePopulation: Store["deletePopulation"] = (...args) => this.inner.deletePopulation(...args);
  saveSettings: Store["saveSettings"] = (...args) => this.inner.saveSettings(...args);
  getSettings: Store["getSettings"] = (...args) => this.inner.getSettings(...args);
  listEvents: Store["listEvents"] = (...args) => this.inner.listEvents(...args);
  latestEventSeq: Store["latestEventSeq"] = (...args) => this.inner.latestEventSeq(...args);
  truncateEvents: Store["truncateEvents"] = (...args) => this.inner.truncateEvents(...args);
  saveJob: Store["saveJob"] = (...args) => this.inner.saveJob(...args);
  getJob: Store["getJob"] = (...args) => this.inner.getJob(...args);
  listJobs: Store["listJobs"] = (...args) => this.inner.listJobs(...args);
  close: Store["close"] = (...args) => this.inner.close(...args);
}

/** One line per trace event, in the words the "as it happens" feed shows. */
function summarise(event: TraceEvent): string {
  switch (event.type) {
    case "wake.start":
      return `visit ${event.wakeNumber} started`;
    case "model.call":
      return `turn ${event.turn}`;
    case "tool.call":
      return `${event.tool}${event.result.isError ? " failed" : ""}`;
    case "reporter.call":
      return event.tool;
    case "identity":
      return `${event.event} (${event.strategy})`;
    case "finding":
      return event.title;
    case "memory":
      return event.operation;
    case "note":
      return event.text.slice(0, 120);
    case "wake.end":
      return `${event.status} after ${event.turns} turn(s)`;
    default:
      return "";
  }
}

/**
 * Fan-out to every open SSE connection. Subscribers get events as they are appended; a client
 * that reconnects asks for everything after its last cursor and gets it from the table, so a
 * subscriber missing a live event is a latency problem and never a correctness one.
 */
export class EventHub {
  private readonly listeners = new Set<(event: Event) => void>();

  publish = (event: Event): void => {
    for (const listener of this.listeners) listener(event);
  };

  subscribe(listener: (event: Event) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get size(): number {
    return this.listeners.size;
  }
}

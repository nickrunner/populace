import {
  SEVERITY_RANK,
  type Agent,
  type Cohort,
  type Finding,
  type Project,
  type Run,
  type Simulation,
  type Store,
  type Triage,
  type Wake,
} from "@populace/core";
import type {
  ClusterCardView,
  ClusterDetailView,
  ExecutionCompareView,
  ExecutionHistoryEntry,
  ParticipantDetailView,
  PreflightView,
  ProjectOverviewView,
  ProjectSummaryView,
  RunCohortView,
  RunEstimate,
  SimulationResultsView,
  SimulationStatus,
  SimulationSummaryView,
  ToolUsageView,
  TriageView,
} from "@populace/contract";
import { clusterFindings } from "@populace/reports";
import { ReadModel, participantOf } from "./read-model.js";

/**
 * The read models the project, simulation and participant screens are rendered from (SPEC §6.2).
 *
 * Two rules run through every method here.
 *
 * **No person names above level three.** `overview()` and `results()` return payloads with no
 * field to put a name in. That is deliberate and structural: a screen that wanted to name
 * somebody on the project home page would have to add a request to do it (SPEC §7.1).
 *
 * **A screen is a bounded number of store calls.** Every method below loads what it needs in
 * whole sets — all the run's wakes, all its findings, all its traces — and joins them in memory.
 * Nothing in here loops a query over participants, which is the shape that made the old
 * population screen fire one memory read per head and re-poll it every five seconds.
 */

export interface ProjectReadModelOptions {
  /** The runs this process is driving right now, so a summary can say "running" truthfully. */
  runningRunIds?: () => string[];
}

/** A person id (`cohortSlug#n`) out of an agent id (`populationSlug/cohortSlug#n`). */
function personIdOf(agentId: string): string {
  const slash = agentId.indexOf("/");
  return slash === -1 ? agentId : agentId.slice(slash + 1);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export class ProjectReadModel {
  private readonly read: ReadModel;

  constructor(
    private readonly store: Store,
    private readonly options: ProjectReadModelOptions = {},
  ) {
    this.read = new ReadModel(store);
  }

  /** A project by its id or by its slug, so a bookmarked `/p/tasklet` and an API call both work. */
  async project(idOrSlug: string): Promise<Project | undefined> {
    const direct = await this.store.getProject(idOrSlug);
    if (direct) return direct;
    return (await this.store.listProjects()).find((p) => p.slug === idOrSlug);
  }

  async listProjects(): Promise<ProjectSummaryView[]> {
    const projects = await this.store.listProjects();
    return Promise.all(projects.map((project) => this.summary(project)));
  }

  async summary(project: Project): Promise<ProjectSummaryView> {
    const [simulations, targets, personas, cohorts, people, runs] = await Promise.all([
      this.store.listSimulations({ projectId: project.id }),
      this.store.listTargets(project.id),
      this.store.listPersonas(project.id),
      this.store.listCohorts(project.id),
      this.store.listPeople({ projectId: project.id }),
      this.store.listRuns({ projectId: project.id }),
    ]);
    const week = new Date(Date.now() - 7 * 86_400_000);
    const recent = runs.length === 0 ? [] : await this.store.listWakes({ runIds: runs.map((r) => r.id), since: week });
    const running = new Set(this.options.runningRunIds?.() ?? []);
    const stamps = runs.flatMap((run) => [run.endedAt, run.startedAt].filter((v): v is string => v !== null));
    return {
      id: project.id,
      slug: project.slug,
      name: project.name,
      description: project.description,
      archived: project.archived,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      counts: { simulations: simulations.length, targets: targets.length, personas: personas.length, cohorts: cohorts.length, people: people.length },
      runningRunIds: runs.filter((run) => running.has(run.id)).map((run) => run.id),
      lastActivityAt: stamps.length ? stamps.reduce((a, b) => (a > b ? a : b)) : null,
      costLast7dUsd: round(sum(recent.map((w) => w.costUsd))),
    };
  }

  /**
   * The project home screen in one request. It carries counts, simulations and the problems seen
   * in more than one of them — and NOT ONE PERSON'S NAME (SPEC §7.1).
   */
  async overview(project: Project): Promise<ProjectOverviewView> {
    const [base, simulations, runs, triage, settings, killSwitch] = await Promise.all([
      this.summary(project),
      this.store.listSimulations({ projectId: project.id }),
      this.store.listRuns({ projectId: project.id }),
      this.store.listTriage(project.id),
      this.store.getSettings(project.id),
      this.store.getKillSwitch(),
    ]);
    const findings = runs.length === 0 ? [] : await this.store.listFindings({ runIds: runs.map((r) => r.id) });
    const spentToday = runs.length === 0 ? [] : await this.store.listWakes({ runIds: runs.map((r) => r.id), since: new Date(Date.now() - 86_400_000) });
    const views: SimulationSummaryView[] = [];
    for (const simulation of simulations) views.push(await this.simulationSummary(simulation, runs));

    const simulationOf = new Map(runs.map((run) => [run.id, run.simulationId]));
    const named = new Map(simulations.map((s) => [s.id, s.name]));
    const byTriage = new Map(triage.map((t) => [t.signature, t]));
    const bySignature = new Map<string, { finding: Finding; simulations: Set<string>; people: Set<string> }>();
    for (const finding of findings) {
      const entry = bySignature.get(finding.signature) ?? { finding, simulations: new Set<string>(), people: new Set<string>() };
      if (SEVERITY_RANK[finding.severity] < SEVERITY_RANK[entry.finding.severity]) entry.finding = finding;
      const simulationId = simulationOf.get(finding.runId);
      if (simulationId !== undefined) entry.simulations.add(simulationId);
      entry.people.add(personIdOf(finding.agentId));
      bySignature.set(finding.signature, entry);
    }

    return {
      ...base,
      simulations: views,
      crossSimulation: [...bySignature.entries()]
        .filter(([, entry]) => entry.simulations.size > 1)
        .map(([signature, entry]) => ({
          signature,
          title: entry.finding.title,
          kind: entry.finding.kind,
          severity: entry.finding.severity,
          tool: entry.finding.tool ?? null,
          simulations: [...entry.simulations].map((id) => ({ id, name: named.get(id) ?? id })),
          // A headcount, not a roster: how many people is information, who they are is a click away.
          peopleHit: entry.people.size,
          triage: triageViewOf(byTriage.get(signature), entry.finding.title),
        }))
        .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.peopleHit - a.peopleHit),
      spentTodayUsd: round(sum(spentToday.map((w) => w.costUsd))),
      dailyCeilingUsd: settings?.guardrails.dailyUsd ?? 0,
      killSwitch,
    };
  }

  async listSimulations(projectId: string): Promise<SimulationSummaryView[]> {
    const [simulations, runs] = await Promise.all([this.store.listSimulations({ projectId }), this.store.listRuns({ projectId })]);
    const out: SimulationSummaryView[] = [];
    for (const simulation of simulations) out.push(await this.simulationSummary(simulation, runs));
    return out;
  }

  /**
   * One simulation as the project home renders it. `runs` is passed in when the caller already
   * holds the project's runs, so a project with eight simulations is still one query for all of
   * them rather than eight.
   */
  async simulationSummary(simulation: Simulation, projectRuns?: Run[]): Promise<SimulationSummaryView> {
    const runs = (projectRuns ?? (await this.store.listRuns({ simulationId: simulation.id }))).filter((run) => run.simulationId === simulation.id).sort((a, b) => a.seq - b.seq);
    const latest = runs.at(-1);
    const previous = runs.at(-2);
    const [population, cohorts, target] = await Promise.all([
      this.store.getPopulation(simulation.populationId),
      this.store.listCohorts(simulation.projectId),
      this.store.getTarget(simulation.targetId),
    ]);
    const held = population ? population.cohortIds.flatMap((id) => cohorts.filter((c) => c.id === id)) : [];
    const [wakes, findings] = await Promise.all([
      runs.length === 0 ? Promise.resolve<Wake[]>([]) : this.store.listWakes({ runIds: runs.map((r) => r.id) }),
      runs.length === 0 ? Promise.resolve<Finding[]>([]) : this.store.listFindings({ runIds: runs.map((r) => r.id) }),
    ]);
    const latestSignatures = new Set(findings.filter((f) => f.runId === latest?.id).map((f) => f.signature));
    const previousSignatures = new Set(findings.filter((f) => f.runId === previous?.id).map((f) => f.signature));
    const running = new Set(this.options.runningRunIds?.() ?? []);
    const agents = latest ? await this.store.listAgents({ runId: latest.id }) : [];
    const upcoming = agents.map((a) => a.nextWakeAt).filter((v): v is string => v !== null);

    const status: SimulationStatus =
      latest === undefined
        ? "never-run"
        : running.has(latest.id) || latest.status === "running" || latest.status === "pending"
          ? "running"
          : latest.status === "paused"
            ? "paused"
            : latest.status === "failed"
              ? "failed"
              : "idle";

    return {
      id: simulation.id,
      slug: simulation.slug,
      name: simulation.name,
      description: simulation.description,
      mode: simulation.mode,
      visitsPerPerson: simulation.visitsPerPerson,
      autoSweep: simulation.autoSweep,
      requireFreshTarget: simulation.requireFreshTarget,
      population: {
        id: population?.id ?? simulation.populationId,
        name: population?.name ?? "",
        cohorts: held.length,
        people: sum(held.map((c) => c.size)),
      },
      target: {
        id: target?.id ?? simulation.targetId,
        name: target?.name ?? "",
        // Null, not false: nobody has asked. Asking opens a connection to somebody else's server,
        // which an index screen has no business doing on every render.
        reachable: null,
        resets: target !== undefined && target.reset.kind !== "none",
      },
      status,
      latest: latest ? { runId: latest.id, seq: latest.seq, startedAt: latest.startedAt, endedAt: latest.endedAt, status: latest.status, totals: latest.totals } : null,
      confirmed: findings.filter((f) => f.runId === latest?.id && f.verification?.verdict === "confirmed").length,
      newSinceLast: previous === undefined ? 0 : [...latestSignatures].filter((s) => !previousSignatures.has(s)).length,
      fixedSinceLast: previous === undefined ? 0 : [...previousSignatures].filter((s) => !latestSignatures.has(s)).length,
      costUsd: round(sum(wakes.map((w) => w.costUsd))),
      nextVisitAt: upcoming.length ? upcoming.reduce((a, b) => (a < b ? a : b)) : null,
    };
  }

  /**
   * "Who is going, and did I set this up right?" — the answer BEFORE any money is spent.
   *
   * Sample names are the deliberate exception to §7.1: the whole point of this screen is to show
   * that the cast is a set of real, individual people before a run is paid for.
   */
  async preflight(
    simulation: Simulation,
    input: { estimate: RunEstimate; tools: { name: string; description: string }[]; toolsError: string | null; promptPreview: PreflightView["promptPreview"]; blockers: string[] },
  ): Promise<PreflightView> {
    const summary = await this.simulationSummary(simulation);
    const [population, cohorts, personas, target] = await Promise.all([
      this.store.getPopulation(simulation.populationId),
      this.store.listCohorts(simulation.projectId),
      this.store.listPersonas(simulation.projectId),
      this.store.getTarget(simulation.targetId),
    ]);
    const held: Cohort[] = population ? population.cohortIds.flatMap((id) => cohorts.filter((c) => c.id === id)) : [];
    const people = held.length === 0 ? [] : await this.store.listPeople({ projectId: simulation.projectId });
    const personaName = new Map(personas.map((p) => [p.id, p.spec.name]));
    const warnings: string[] = [];
    const undescribed = input.tools.filter((t) => t.description.trim() === "").map((t) => t.name);
    if (undescribed.length) warnings.push(`${undescribed.length} tool(s) have no description; people decide what to try from descriptions alone.`);
    if (target !== undefined && target.reset.kind === "none" && simulation.mode === "ephemeral")
      warnings.push("This target declares no reset, so each execution starts on the data the last one left behind.");
    if (input.toolsError !== null) warnings.push(input.toolsError);

    return {
      simulation: { ...summary, target: { ...summary.target, reachable: input.toolsError === null } },
      target: {
        id: target?.id ?? simulation.targetId,
        name: target?.name ?? "",
        tools: input.tools.map((t) => t.name),
        undescribed,
        resets: target !== undefined && target.reset.kind !== "none",
        warnings,
      },
      cohorts: held.map((cohort) => ({
        slug: cohort.slug,
        name: cohort.name,
        personaName: personaName.get(cohort.personaId) ?? cohort.slug,
        people: cohort.size,
        sampleNames: people
          .filter((p) => p.cohortId === cohort.id && p.ordinal < cohort.size)
          .slice(0, 3)
          .map((p) => p.name),
      })),
      totalPeople: sum(held.map((c) => c.size)),
      plannedVisits: input.estimate.visits,
      estimate: input.estimate,
      promptPreview: input.promptPreview,
      blockers: input.blockers,
    };
  }

  // ---- participants --------------------------------------------------------

  /**
   * One person's whole page in ONE request: their memory, every visit, everything they filed and
   * where else in this project they have been. The screen this replaces fired a memory query per
   * participant and re-polled it every five seconds.
   */
  async participant(runId: string, participantId: string): Promise<ParticipantDetailView | undefined> {
    const agent = await this.store.getAgent(runId, participantId);
    if (!agent) return undefined;
    const [run, wakes, findings, memory] = await Promise.all([
      this.store.getRun(runId),
      this.store.listWakes({ runIds: [runId], agentId: participantId }),
      this.store.listFindings({ runIds: [runId] }),
      this.store.getMemory(runId, participantId),
    ]);
    const identity = agent.identityId === null ? undefined : await this.store.getIdentity(agent.identityId);
    const snapshot = run?.configSnapshotId ? await this.store.getConfigSnapshot(run.configSnapshotId) : undefined;
    const cohortName = snapshot?.config.population.members.find((m) => m.cohort === agent.cohortSlug)?.cohortName ?? agent.cohortSlug;
    const mine = findings.filter((f) => f.agentId === agent.id);
    const last = wakes.at(-1);

    // "Where else they have been": the same person id in other executions of this project. Two
    // queries, whatever the headcount — the project's runs, and those runs' visits in one call.
    const siblings = run ? (await this.store.listRuns({ projectId: run.projectId })).filter((r) => r.id !== runId) : [];
    const elsewhere = siblings.length === 0 ? [] : await this.store.listWakes({ runIds: siblings.map((r) => r.id), agentId: agent.id });
    const elsewhereFindings = siblings.length === 0 ? [] : await this.store.listFindings({ runIds: siblings.map((r) => r.id) });
    const simulations = run ? await this.store.listSimulations({ projectId: run.projectId, includeArchived: true }) : [];
    const simulationName = new Map(simulations.map((s) => [s.id, s.name]));

    return {
      ...participantOf(agent, wakes, mine, identity, cohortName),
      details: agent.details,
      traits: agent.persona.traits,
      patience: agent.persona.patience,
      budgetUsd: agent.persona.budgetUsd,
      model: last?.model ?? agent.persona.model.model ?? "",
      effort: last?.effort ?? agent.persona.model.effort ?? "",
      memory: {
        notes: memory?.notes ?? [],
        waitingOn: memory?.waitingOn ?? [],
        annoyances: memory?.annoyances ?? [],
        done: memory?.done ?? [],
      },
      visits: wakes.map((wake) => visitOf(wake)),
      findingsFiled: mine.map(findingSummaryOf).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.createdAt.localeCompare(a.createdAt)),
      alsoIn: siblings
        .filter((sibling) => elsewhere.some((w) => w.runId === sibling.id))
        .map((sibling) => ({
          simulationId: sibling.simulationId,
          simulationName: simulationName.get(sibling.simulationId) ?? sibling.simulationId,
          runId: sibling.id,
          seq: sibling.seq,
          visits: elsewhere.filter((w) => w.runId === sibling.id).length,
          findings: elsewhereFindings.filter((f) => f.runId === sibling.id && f.agentId === agent.id).length,
        })),
    };
  }

  /** A row per cohort in one execution: the results screen's "who was hit", naming nobody. */
  async runCohorts(runId: string): Promise<RunCohortView[]> {
    const [agents, wakes, findings, run] = await Promise.all([
      this.store.listAgents({ runId }),
      this.store.listWakes({ runIds: [runId] }),
      this.store.listFindings({ runIds: [runId] }),
      this.store.getRun(runId),
    ]);
    const snapshot = run?.configSnapshotId ? await this.store.getConfigSnapshot(run.configSnapshotId) : undefined;
    return cohortRollUp(agents, wakes, findings, snapshot?.config.population.members ?? []);
  }

  // ---- results -------------------------------------------------------------

  /**
   * The whole simulation-results screen in one request, and with NO PERSON NAMES in it: clusters,
   * cohort incidence, coverage, who walked away (by person id and cohort) and the execution
   * history. A name first appears one click further in, on a finding (SPEC §7.1).
   */
  async results(simulation: Simulation, coverage: ToolUsageView): Promise<SimulationResultsView> {
    const context = await this.simulationContext(simulation);
    const { runs, latest, agents, findings, wakes, members } = context;
    const summary = await this.simulationSummary(simulation, runs);
    const latestFindings = findings.filter((f) => f.runId === latest?.id);
    const latestWakes = wakes.filter((w) => w.runId === latest?.id);
    const cards = this.resultCards(context, latestFindings);
    const walkedAwayWakes = latestWakes.filter((w) => w.status === "gave-up");
    const cohortOf = new Map(agents.map((a) => [a.id, a]));

    const confirmed = latestFindings.filter((f) => f.verification?.verdict === "confirmed").length;
    const headline =
      latest === undefined
        ? `${summary.population.people} people are ready to go; nothing has run yet.`
        : `${agents.length} people made ${latestWakes.length} visits, filed ${latestFindings.length} report(s)${confirmed > 0 ? `, ${confirmed} of them confirmed` : ""}${walkedAwayWakes.length > 0 ? `, and ${walkedAwayWakes.length} walked away` : ""}.`;

    // Triaged and settled: below the fold, not gone. A signature triaged `fixed` that is HERE
    // AGAIN is a regression and stays at the top — burying it under "known" is exactly the
    // failure triage-by-signature exists to prevent (ADR-0028).
    const settled = new Set(cards.filter((c) => c.triage?.state === "wont-fix" || (c.triage?.state === "fixed" && c.state !== "regressed")).map((c) => c.signature));
    return {
      simulation: summary,
      execution: latest ? ((await this.read.getRun(latest.id)) ?? null) : null,
      headline,
      stats: {
        people: agents.length,
        visits: latestWakes.length,
        confirmed,
        walkedAway: walkedAwayWakes.length,
        costUsd: round(sum(latestWakes.map((w) => w.costUsd))),
      },
      clusters: cards.filter((c) => !settled.has(c.signature)),
      cohortBreakdown: cohortRollUp(agents, latestWakes, latestFindings, members),
      coverage,
      // Person id and cohort, never a name: this is level two (SPEC §7.1).
      walkedAway: walkedAwayWakes.map((wake) => ({
        personId: cohortOf.get(wake.agentId)?.personId ?? personIdOf(wake.agentId),
        cohortSlug: cohortOf.get(wake.agentId)?.cohortSlug ?? "",
        wakeId: wake.id,
        quote: wake.summary,
        wouldReturn: wake.wouldReturn,
      })),
      history: runs.map((run) => historyOf(run, wakes, findings)),
      known: cards.filter((c) => settled.has(c.signature)),
    };
  }

  /** One cluster in full — the first screen where people are named, as the authors of quotes. */
  async cluster(simulation: Simulation, signature: string): Promise<ClusterDetailView | undefined> {
    const context = await this.simulationContext(simulation);
    const { runs, latest, findings, wakes } = context;
    const latestFindings = findings.filter((f) => f.runId === latest?.id);
    const card = this.resultCards(context, latestFindings).find((c) => c.signature === signature);
    if (!card) return undefined;

    // Which execution this page is ABOUT. Normally the latest; for a signature the latest did not
    // report — a `fixed` card — the most recent one that did, so "the problem went away" still
    // opens onto the evidence that it was ever there.
    const reportedIn = [...runs].reverse().find((run) => findings.some((f) => f.runId === run.id && f.signature === signature));
    if (!reportedIn) return undefined;
    const mine = findings.filter((f) => f.runId === reportedIn.id && f.signature === signature);
    const representative = mine[0];
    if (!representative) return undefined;
    const agents = reportedIn.id === latest?.id ? context.agents : await this.store.listAgents({ runId: reportedIn.id });

    // Scoped to that one execution. Agent ids are deterministic within a simulation
    // (`populationSlug/cohortSlug#ordinal`), so the cross-execution sets the history below is built
    // from would match this run's participants too — and every person on this page would report
    // their visits, reports and cost summed over every execution the simulation has ever had.
    const ownWakes = wakes.filter((w) => w.runId === reportedIn.id);
    const ownFindings = findings.filter((f) => f.runId === reportedIn.id);
    const byAgent = new Map(agents.map((a) => [a.id, a]));
    const visitNumber = new Map(wakes.map((w) => [w.id, w.wakeNumber]));
    const identities = await this.read.identitiesOf(reportedIn.id, agents);
    const memberName = new Map(context.members.map((m) => [m.cohort, m.cohortName]));
    const hitAgents = new Set(mine.map((f) => f.agentId));
    const missed = new Map<string, { cohortSlug: string; name: string; count: number }>();
    for (const agent of agents) {
      if (hitAgents.has(agent.id)) continue;
      const entry = missed.get(agent.cohortSlug) ?? { cohortSlug: agent.cohortSlug, name: memberName.get(agent.cohortSlug) ?? agent.cohortSlug, count: 0 };
      entry.count += 1;
      missed.set(agent.cohortSlug, entry);
    }

    return {
      ...card,
      representative,
      quotes: mine.map((finding) => {
        const agent = byAgent.get(finding.agentId);
        return {
          personId: agent?.personId ?? personIdOf(finding.agentId),
          // A name, at last: this is the one place where it is information rather than decoration.
          name: agent?.name ?? finding.agentId,
          cohortSlug: agent?.cohortSlug ?? "",
          cohortName: memberName.get(agent?.cohortSlug ?? "") ?? "",
          wakeId: finding.wakeId,
          visitNumber: visitNumber.get(finding.wakeId) ?? 0,
          text: finding.observed || finding.description,
        };
      }),
      reproduction: representative.reproduction,
      replay: representative.verification,
      peopleHit: [...hitAgents].flatMap((id) => {
        const agent = byAgent.get(id);
        if (!agent) return [];
        return [participantOf(agent, ownWakes, ownFindings, identities.get(id), memberName.get(agent.cohortSlug) ?? agent.cohortSlug)];
      }),
      peopleMissed: [...missed.values()],
      history: runs.map((run) => {
        const reports = findings.filter((f) => f.runId === run.id && f.signature === signature);
        return { runId: run.id, seq: run.seq, reports: reports.length, verdict: reports.find((f) => f.verification !== null)?.verification?.verdict ?? null };
      }),
    };
  }

  /** Two executions of one simulation, side by side: what persisted, what went, what turned up. */
  async compare(simulation: Simulation, aId: string, bId: string): Promise<ExecutionCompareView | undefined> {
    const context = await this.simulationContext(simulation);
    const a = context.runs.find((r) => r.id === aId);
    const b = context.runs.find((r) => r.id === bId);
    if (!a || !b) return undefined;
    const [detailA, detailB] = await Promise.all([this.read.getRun(a.id), this.read.getRun(b.id)]);
    if (!detailA || !detailB) return undefined;
    const cardsA = this.cards(context, context.findings.filter((f) => f.runId === a.id));
    const cardsB = this.cards(context, context.findings.filter((f) => f.runId === b.id));
    const inA = new Set(cardsA.map((c) => c.signature));
    const inB = new Set(cardsB.map((c) => c.signature));
    const castOf = async (runId: string): Promise<string> => (await this.store.listAgents({ runId })).map((agent) => agent.personId).sort().join(",");
    const [castA, castB] = await Promise.all([castOf(a.id), castOf(b.id)]);
    const notes: string[] = [];
    if (castA !== castB) notes.push("The two executions did not send the same people, so a difference may be who went rather than what changed.");
    if (a.mode !== b.mode) notes.push("These executions ran in different modes.");
    return {
      a: detailA,
      b: detailB,
      persisting: cardsB.filter((c) => inA.has(c.signature)),
      fixed: cardsA.filter((c) => !inB.has(c.signature)),
      appeared: cardsB.filter((c) => !inA.has(c.signature)),
      castIdentical: castA === castB,
      notes,
    };
  }

  async triage(projectId: string): Promise<TriageView[]> {
    const [triage, runs] = await Promise.all([this.store.listTriage(projectId), this.store.listRuns({ projectId })]);
    const findings = runs.length === 0 ? [] : await this.store.listFindings({ runIds: runs.map((r) => r.id) });
    const title = new Map(findings.map((f) => [f.signature, f.title]));
    return triage.flatMap((row) => {
      const view = triageViewOf(row, title.get(row.signature) ?? row.titleAtTriage);
      return view ? [view] : [];
    });
  }

  // ---- shared loading ------------------------------------------------------

  /**
   * Everything one simulation's screens read, in a fixed handful of calls: its executions, the
   * latest execution's participants, and every visit and report across all of them.
   */
  private async simulationContext(simulation: Simulation): Promise<SimulationContext> {
    const runs = (await this.store.listRuns({ simulationId: simulation.id })).sort((a, b) => a.seq - b.seq);
    const latest = runs.at(-1);
    const ids = runs.map((r) => r.id);
    const [wakes, findings, triage] = await Promise.all([
      ids.length === 0 ? Promise.resolve<Wake[]>([]) : this.store.listWakes({ runIds: ids }),
      ids.length === 0 ? Promise.resolve<Finding[]>([]) : this.store.listFindings({ runIds: ids }),
      this.store.listTriage(simulation.projectId),
    ]);
    const agents = latest ? await this.store.listAgents({ runId: latest.id }) : [];
    const snapshot = latest?.configSnapshotId ? await this.store.getConfigSnapshot(latest.configSnapshotId) : undefined;
    return { runs, latest, agents, wakes, findings, triage, members: (snapshot?.config.population.members ?? []).map((m) => ({ cohort: m.cohort, cohortName: m.cohortName, count: m.count })) };
  }

  /**
   * Clusters as a card each. `state` is the join between what the machine found and what a human
   * said about it: a signature triaged `fixed` that is here again is a REGRESSION, which is the
   * whole reason triage is keyed by signature rather than by finding id (ADR-0028).
   */
  private cards(context: SimulationContext, findings: Finding[]): ClusterCardView[] {
    return clusterFindings(findings).map((cluster) => this.cardOf(context, cluster, true));
  }

  /**
   * The cards the results screen shows: the latest execution's clusters, PLUS one for every
   * signature an earlier execution reported and this one did not.
   *
   * Without that second half a problem that went away simply vanished from the screen — no card,
   * no `fixed` state, nothing but a bare count — which is the exact opposite of the question the
   * screen exists to answer. "I shipped a fix; did it work?" is answered by a signature being
   * present and then absent, so an absence has to be something you can look at.
   */
  private resultCards(context: SimulationContext, latestFindings: Finding[]): ClusterCardView[] {
    const present = this.cards(context, latestFindings);
    const here = new Set(latestFindings.map((f) => f.signature));
    for (const card of present) here.add(card.signature);
    const gone = context.findings.filter((f) => f.runId !== context.latest?.id && !here.has(f.signature));
    const fixed = clusterFindings(gone)
      .filter((cluster) => !here.has(cluster.signature))
      .map((cluster) => this.cardOf(context, cluster, false));
    return [...present, ...fixed];
  }

  /**
   * One cluster as a card. `inLatest` says whether this is something the latest execution found:
   * when it is not, the incidence numbers are zeroes, because nobody in this execution hit it —
   * which is the whole point of the `fixed` state.
   */
  private cardOf(context: SimulationContext, cluster: ReturnType<typeof clusterFindings>[number], inLatest: boolean): ClusterCardView {
    const byTriage = new Map(context.triage.map((t) => [t.signature, t]));
    const byAgent = new Map(context.agents.map((a) => [a.id, a]));
    const total = new Map<string, number>();
    for (const agent of context.agents) total.set(agent.cohortSlug, (total.get(agent.cohortSlug) ?? 0) + 1);
    const cohortName = new Map(context.members.map((m) => [m.cohort, m.cohortName]));
    const seqOf = new Map(context.runs.map((r) => [r.id, r.seq]));

    const people = inLatest ? new Set(cluster.findings.map((f) => byAgent.get(f.agentId)?.personId ?? personIdOf(f.agentId))) : new Set<string>();
    const hit = new Map<string, number>();
    if (inLatest) {
      for (const finding of cluster.findings) {
        const slug = byAgent.get(finding.agentId)?.cohortSlug;
        if (slug === undefined) continue;
        hit.set(slug, (hit.get(slug) ?? 0) + 1);
      }
    }
    const triage = triageViewOf(byTriage.get(cluster.signature), cluster.title);
    const seen = context.findings.filter((f) => f.signature === cluster.signature);
    const stamps = seen.map((f) => f.createdAt).sort();
    return {
      signature: cluster.signature,
      title: cluster.title,
      severity: cluster.severity,
      kind: cluster.kind,
      tool: cluster.tool ?? null,
      verdict: cluster.representative.verification?.verdict ?? null,
      peopleHit: people.size,
      peopleTotal: context.agents.length,
      reports: inLatest ? cluster.findings.length : 0,
      cohorts: [...total.entries()].map(([slug, count]) => ({ slug, name: cohortName.get(slug) ?? slug, hit: hit.get(slug) ?? 0, total: count })),
      state: stateOf(context, cluster.signature, inLatest, triage),
      seenIn: [...new Set(seen.map((f) => seqOf.get(f.runId)).filter((v): v is number => v !== undefined))].sort((a, b) => a - b),
      firstSeenAt: stamps[0] ?? null,
      lastSeenAt: stamps.at(-1) ?? null,
      triage,
    };
  }
}

/**
 * Where one problem stands across the executions of one simulation (SPEC §4.3).
 *
 * Only executions where somebody actually VISITED count as evidence. An execution that made no
 * visits at all — killed on the way up, or refused by a guardrail — says nothing about whether a
 * problem is still there, and counting it as an absence would call every signature in the next
 * execution a regression. An execution that ran and did not report this problem is a real absence.
 */
function stateOf(context: SimulationContext, signature: string, inLatest: boolean, triage: TriageView | null): ClusterCardView["state"] {
  if (!inLatest) return "fixed";
  // A human said this was fixed and here it is again. That belongs at the top of the screen, not
  // under "known" — which is the whole reason triage is keyed by signature (ADR-0028).
  if (triage?.state === "fixed") return "regressed";
  const ran = context.runs.filter((run) => run.id !== context.latest?.id && context.wakes.some((w) => w.runId === run.id));
  const presence = ran.map((run) => context.findings.some((f) => f.runId === run.id && f.signature === signature));
  if (!presence.some(Boolean)) return "new";
  // Present, absent, present again.
  if (presence.at(-1) === false) return "regressed";
  return "open";
}

interface SimulationContext {
  runs: Run[];
  latest: Run | undefined;
  agents: Agent[];
  wakes: Wake[];
  findings: Finding[];
  triage: Triage[];
  members: { cohort: string; cohortName: string; count: number }[];
}

function visitOf(wake: Wake): ParticipantDetailView["visits"][number] {
  return {
    id: wake.id,
    visitNumber: wake.wakeNumber,
    status: wake.status,
    startedAt: wake.startedAt,
    endedAt: wake.endedAt,
    turns: wake.turns,
    toolCalls: wake.toolCalls,
    findings: wake.findingCount,
    costUsd: round(wake.costUsd),
    summary: wake.summary,
    wouldReturn: wake.wouldReturn,
  };
}

function findingSummaryOf(finding: Finding): ParticipantDetailView["findingsFiled"][number] {
  return {
    id: finding.id,
    signature: finding.signature,
    kind: finding.kind,
    title: finding.title,
    severity: finding.severity,
    tool: finding.tool ?? null,
    wakeId: finding.wakeId,
    verdict: finding.verification?.verdict ?? null,
    createdAt: finding.createdAt,
  };
}

function historyOf(run: Run, wakes: Wake[], findings: Finding[]): ExecutionHistoryEntry {
  const own = wakes.filter((w) => w.runId === run.id);
  const filed = findings.filter((f) => f.runId === run.id);
  return {
    runId: run.id,
    seq: run.seq,
    label: run.label,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    visits: own.length,
    findings: filed.length,
    confirmed: filed.filter((f) => f.verification?.verdict === "confirmed").length,
    costUsd: round(sum(own.map((w) => w.costUsd))),
  };
}

/** A cohort roll-up over one execution's rows. No names: a cohort is a group, not a person. */
function cohortRollUp(agents: Agent[], wakes: Wake[], findings: Finding[], members: { cohort: string; cohortName: string }[]): RunCohortView[] {
  const named = new Map(members.map((m) => [m.cohort, m.cohortName]));
  const slugs = [...new Set(agents.map((a) => a.cohortSlug))];
  return slugs.map((slug) => {
    const own = agents.filter((a) => a.cohortSlug === slug);
    const ids = new Set(own.map((a) => a.id));
    const visits = wakes.filter((w) => ids.has(w.agentId));
    const filed = findings.filter((f) => ids.has(f.agentId));
    const worst = [...filed].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0];
    const gaveUp = own.filter((a) => a.retiredReason === "gave-up").length;
    return {
      cohortSlug: slug,
      name: named.get(slug) ?? slug,
      personaName: own[0]?.persona.name ?? "",
      people: own.length,
      stillActive: own.filter((a) => a.status === "active").length,
      gaveUp,
      visits: visits.length,
      findings: filed.length,
      confirmed: filed.filter((f) => f.verification?.verdict === "confirmed").length,
      costUsd: round(sum(visits.map((w) => w.costUsd))),
      worstSignature: worst?.signature ?? null,
      headline: gaveUp > 0 ? `${gaveUp} of ${own.length} walked away` : filed.length > 0 ? `${filed.length} report(s) from ${own.length} people` : `${own.length} people, nothing filed`,
    };
  });
}

/**
 * Triage as the wire describes it. `drifted` is true when the signature's current title is not the
 * one it was triaged under — a clustering change detaches judgement loudly rather than silently
 * carrying it onto a different problem (ADR-0028).
 */
function triageViewOf(triage: Triage | undefined, currentTitle: string): TriageView | null {
  if (!triage) return null;
  return {
    signature: triage.signature,
    state: triage.state,
    note: triage.note,
    externalRef: triage.externalRef,
    titleAtTriage: triage.titleAtTriage,
    updatedAt: triage.updatedAt,
    drifted: triage.titleAtTriage !== "" && triage.titleAtTriage !== currentTitle,
  };
}

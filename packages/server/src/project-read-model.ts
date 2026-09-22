import {
  SEVERITY_RANK,
  personIdOfAgentId,
  signatureOf,
  type Agent,
  type FindingKind,
  type Cohort,
  type Finding,
  type FirstContact,
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
import { clusterFindings, primaryTool, signatureHistories, type CohortCensus, type SignatureHistory } from "@populace/reports";
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

function round(value: number): number {
  return Number(value.toFixed(4));
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * The blocks of the project's settings a simulation sets for itself, named as the Settings screen
 * names them. It asks each override block what it holds rather than comparing it to anything: a
 * block with no fields in it overrides nothing, whoever wrote it and whenever.
 */
function overriding(simulation: Simulation): SimulationSummaryView["overriding"] {
  const out: SimulationSummaryView["overriding"] = [];
  if (Object.keys(simulation.overrides.guardrails).length > 0) out.push("spending");
  if (Object.keys(simulation.overrides.verifier).length > 0) out.push("verification");
  if (Object.keys(simulation.overrides.model).length > 0) out.push("model");
  return out;
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
    const [simulations, targets, personas, cohorts, populations, people, runs] = await Promise.all([
      this.store.listSimulations({ projectId: project.id }),
      this.store.listTargets(project.id),
      this.store.listPersonas(project.id),
      this.store.listCohorts(project.id),
      this.store.listPopulations(project.id),
      this.store.listPeople({ projectId: project.id }),
      this.store.listRuns({ projectId: project.id }),
    ]);
    const week = new Date(Date.now() - 7 * 86_400_000);
    // Through `costSince`, not a sum over wakes: writing a cohort's people spends on the model
    // outside any wake, and a project's cost that leaves that out is not the project's cost.
    const recent = await this.store.costSince({ projectId: project.id }, week);
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
      counts: { simulations: simulations.length, targets: targets.length, personas: personas.length, cohorts: cohorts.length, populations: populations.length, people: people.length },
      runningRunIds: runs.filter((run) => running.has(run.id)).map((run) => run.id),
      lastActivityAt: stamps.length ? stamps.reduce((a, b) => (a > b ? a : b)) : null,
      costLast7dUsd: round(recent),
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
    // The same question the people writer's ceiling asks, asked the same way. Two numerators under
    // one `dailyCeilingUsd` would show a project comfortably under a ceiling that is already
    // refusing its jobs (SPEC §5.4).
    const spentToday = await this.store.costSince({ projectId: project.id }, new Date(Date.now() - 86_400_000));
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
      entry.people.add(personIdOfAgentId(finding.agentId));
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
          // `primaryTool`, not `finding.tool`: the key was hashed at file time over the tool the
          // finding NAMES or, when it named none, the last tool it reproduced with. Recomputing
          // it over the bare field would never match a finding that named no tool, and every one
          // of them would read as drifted.
          triage: triageViewOf(byTriage.get(signature), { kind: entry.finding.kind, tool: primaryTool(entry.finding), title: entry.finding.title }),
        }))
        .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.peopleHit - a.peopleHit),
      spentTodayUsd: round(spentToday),
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
    // "New" and "fixed" are asked of the last two executions that actually SENT somebody. A run
    // that exists but has not visited yet reports nothing, and counting that silence would put
    // "4 fixed" on the project home the moment somebody pressed start.
    const reported = runs.filter((run) => wakes.some((w) => w.runId === run.id));
    const latestSignatures = new Set(findings.filter((f) => f.runId === reported.at(-1)?.id).map((f) => f.signature));
    const previousSignatures = new Set(findings.filter((f) => f.runId === reported.at(-2)?.id).map((f) => f.signature));
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
      newSinceLast: reported.length < 2 ? 0 : [...latestSignatures].filter((s) => !previousSignatures.has(s)).length,
      fixedSinceLast: reported.length < 2 ? 0 : [...previousSignatures].filter((s) => !latestSignatures.has(s)).length,
      costUsd: round(sum(wakes.map((w) => w.costUsd))),
      nextVisitAt: upcoming.length ? upcoming.reduce((a, b) => (a < b ? a : b)) : null,
      overriding: overriding(simulation),
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
    input: {
      estimate: RunEstimate;
      /** What the tool policy LEAVES, already filtered: the tools these people will be offered. */
      tools: { name: string; description: string }[];
      /** What it takes away, and from whom. */
      blocked: PreflightView["target"]["blocked"];
      destructive: PreflightView["target"]["destructive"];
      /** The last first-contact check against this target, or null when nobody has run one. */
      firstContact: FirstContact | null;
      toolsError: string | null;
      promptPreview: PreflightView["promptPreview"];
      blockers: string[];
    },
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
    if (input.blocked.length)
      warnings.push(`${input.blocked.length} tool(s) the target exposes are blocked by a tool policy, so nobody will reach ${input.blocked.length === 1 ? "it" : "them"}.`);
    // Never checked is a warning, not a blocker: the check provisions an account, and a GET cannot
    // be allowed to require one. A check that FAILED is a blocker, and control.ts adds it.
    if (input.firstContact === null) warnings.push("Nobody has tried getting an account here yet. Run First contact on the target — it makes one account, calls one read-only tool, removes it again, and costs nothing.");

    return {
      simulation: { ...summary, target: { ...summary.target, reachable: input.toolsError === null } },
      target: {
        id: target?.id ?? simulation.targetId,
        name: target?.name ?? "",
        tools: input.tools.map((t) => t.name),
        blocked: input.blocked,
        destructive: input.destructive,
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
    const { runs, evidence, agents, findings, wakes, members } = context;
    const summary = await this.simulationSummary(simulation, runs);
    // Everything below is about ONE execution — the most recent one that visited — so the stats,
    // the cards and the people who walked away are all counted off the same set of rows. `latest`
    // is still in `summary.latest` and in `history`, which is where a run that has not visited yet
    // belongs.
    const latestFindings = findings.filter((f) => f.runId === evidence?.id);
    const latestWakes = wakes.filter((w) => w.runId === evidence?.id);
    const cards = this.resultCards(context, latestFindings);
    const walkedAwayWakes = latestWakes.filter((w) => w.status === "gave-up");
    const cohortOf = new Map(agents.map((a) => [a.id, a]));

    const confirmed = latestFindings.filter((f) => f.verification?.verdict === "confirmed").length;
    const headline =
      evidence === undefined
        ? `${summary.population.people} people are ready to go; nothing has run yet.`
        : `${agents.length} people made ${latestWakes.length} visits, filed ${latestFindings.length} report(s)${confirmed > 0 ? `, ${confirmed} of them confirmed` : ""}${walkedAwayWakes.length > 0 ? `, and ${walkedAwayWakes.length} walked away` : ""}.`;

    // Triaged and settled: below the fold, not gone. A signature triaged `fixed` that is HERE
    // AGAIN is a regression and stays at the top — burying it under "known" is exactly the
    // failure triage-by-signature exists to prevent (ADR-0028).
    const settled = new Set(cards.filter((c) => c.triage?.state === "wont-fix" || (c.triage?.state === "fixed" && c.state !== "regressed")).map((c) => c.signature));
    return {
      simulation: summary,
      execution: evidence ? ((await this.read.getRun(evidence.id)) ?? null) : null,
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
        personId: cohortOf.get(wake.agentId)?.personId ?? personIdOfAgentId(wake.agentId),
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
    const { runs, evidence, findings, wakes } = context;
    const latestFindings = findings.filter((f) => f.runId === evidence?.id);
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
    const agents = reportedIn.id === evidence?.id ? context.agents : await this.store.listAgents({ runId: reportedIn.id });

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
          personId: agent?.personId ?? personIdOfAgentId(finding.agentId),
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
    // Each side is counted against ITS OWN roster. Neither execution need be the latest, and
    // "3 of 12 planners" with the newest execution's 12 under it is a number about nothing.
    const [castA, castB] = await Promise.all([this.store.listAgents({ runId: a.id }), this.store.listAgents({ runId: b.id })]);
    const cardsA = this.cards(context, context.findings.filter((f) => f.runId === a.id), censusFrom(castA, context.members));
    const cardsB = this.cards(context, context.findings.filter((f) => f.runId === b.id), censusFrom(castB, context.members));
    const inA = new Set(cardsA.map((c) => c.signature));
    const inB = new Set(cardsB.map((c) => c.signature));
    const rosterOf = (agents: Agent[]): string => agents.map((agent) => agent.personId).sort().join(",");
    const identicalCast = rosterOf(castA) === rosterOf(castB);
    const notes: string[] = [];
    if (!identicalCast) notes.push("The two executions did not send the same people, so a difference may be who went rather than what changed.");
    if (a.mode !== b.mode) notes.push("These executions ran in different modes.");
    return {
      a: detailA,
      b: detailB,
      persisting: cardsB.filter((c) => inA.has(c.signature)),
      fixed: cardsA.filter((c) => !inB.has(c.signature)),
      appeared: cardsB.filter((c) => !inA.has(c.signature)),
      castIdentical: identicalCast,
      notes,
    };
  }

  async triage(projectId: string): Promise<TriageView[]> {
    const [triage, runs] = await Promise.all([this.store.listTriage(projectId), this.store.listRuns({ projectId })]);
    const findings = runs.length === 0 ? [] : await this.store.listFindings({ runIds: runs.map((r) => r.id) });
    // The finding this judgement currently sits on, which is what says whether it still fits.
    const current = new Map(findings.map((f) => [f.signature, f]));
    return triage.flatMap((row) => {
      const finding = current.get(row.signature);
      const view = triageViewOf(row, finding ? { kind: finding.kind, tool: primaryTool(finding), title: finding.title } : null);
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
    // The execution the screens REPORT on. Normally the latest — but a run that has been created
    // and has not visited yet has nothing to say, and reading its silence as an absence turns every
    // open problem into `fixed` in the seconds between pressing start and the first visit landing
    // (and forever, for a run that never gets off the ground). So the report is of the most recent
    // execution that actually sent somebody; `latest` still drives the status and the history, so
    // the screen can say "execution 3 is starting" over execution 2's results.
    const visited = new Set(wakes.map((w) => w.runId));
    const evidence = [...runs].reverse().find((run) => visited.has(run.id)) ?? latest;
    const agents = evidence ? await this.store.listAgents({ runId: evidence.id }) : [];
    const snapshot = evidence?.configSnapshotId ? await this.store.getConfigSnapshot(evidence.configSnapshotId) : undefined;
    return {
      runs,
      latest,
      evidence,
      agents,
      wakes,
      findings,
      triage,
      members: (snapshot?.config.population.members ?? []).map((m) => ({ cohort: m.cohort, cohortName: m.cohortName, count: m.count })),
      histories: signatureHistories(
        runs.map((run) => ({ runId: run.id, seq: run.seq, visited: wakes.some((w) => w.runId === run.id), findings: findings.filter((f) => f.runId === run.id) })),
        // One clustering across every execution, so that a problem reported in different words in
        // different executions has ONE history. Asked per signature it would read as an old
        // problem fixed and a new one appearing, which is precisely the question this screen is
        // for and precisely the wrong answer.
        groupsOf(findings),
      ),
    };
  }

  /**
   * Clusters as a card each. `state` is the join between what the machine found and what a human
   * said about it: a signature triaged `fixed` that is here again is a REGRESSION, which is the
   * whole reason triage is keyed by signature rather than by finding id (ADR-0028).
   */
  private cards(context: SimulationContext, findings: Finding[], census: CohortCensus[]): ClusterCardView[] {
    return clusterFindings(findings, { census }).map((cluster) => this.cardOf(context, cluster, true, census));
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
    const census = censusOf(context);
    const present = this.cards(context, latestFindings, census);
    const here = new Set(latestFindings.map((f) => f.signature));
    for (const card of present) here.add(card.signature);
    // Clustered across EVERY execution, not just over the findings that are gone. A signature is a
    // hash of an exact token set while the clusterer merges titles that are merely similar, so one
    // problem routinely carries several signatures — and the same search bug, worded differently in
    // two executions, would otherwise appear twice on one screen: once open, once claimed fixed.
    // A cluster that holds anything the reported execution filed is already on screen.
    const fixed = clusterFindings(context.findings, { census })
      .filter((cluster) => !here.has(cluster.signature) && cluster.findings.every((f) => f.runId !== context.evidence?.id))
      .map((cluster) => this.cardOf(context, cluster, false, census));
    return [...present, ...fixed];
  }

  /**
   * One cluster as a card. `inLatest` says whether this is something the latest execution found:
   * when it is not, the incidence numbers are zeroes, because nobody in this execution hit it —
   * which is the whole point of the `fixed` state.
   */
  private cardOf(context: SimulationContext, cluster: ReturnType<typeof clusterFindings>[number], inLatest: boolean, census: CohortCensus[]): ClusterCardView {
    const byTriage = new Map(context.triage.map((t) => [t.signature, t]));
    const triage = triageViewOf(byTriage.get(cluster.signature), { kind: cluster.kind, tool: cluster.tool ?? "", title: cluster.title });
    const history = context.histories.get(cluster.signature);
    // A cluster the latest execution did not report shows its incidence as zeroes: nobody in this
    // execution hit it, which is the whole point of the `fixed` state. The roster is still there,
    // so the bar reads "0 of 12" rather than disappearing.
    const cohorts = inLatest
      ? cluster.cohorts.map((c) => ({ slug: c.slug, name: c.name, hit: c.peopleHit, total: c.peopleTotal }))
      : census.map((c) => ({ slug: c.slug, name: c.name, hit: 0, total: c.people }));
    return {
      signature: cluster.signature,
      title: cluster.title,
      severity: cluster.severity,
      kind: cluster.kind,
      tool: cluster.tool ?? null,
      verdict: cluster.representative.verification?.verdict ?? null,
      peopleHit: inLatest ? cluster.personIds.length : 0,
      peopleTotal: sum(census.map((c) => c.people)),
      reports: inLatest ? cluster.findings.length : 0,
      cohorts,
      state: stateOf(history, inLatest, triage),
      seenIn: history?.seenIn ?? [],
      firstSeenAt: history?.firstSeenAt ?? null,
      lastSeenAt: history?.lastSeenAt ?? null,
      triage,
    };
  }
}

/**
 * Signature -> the key of the problem it belongs to, taken from one clustering over every
 * execution's findings. The clusterer's representative signature is the key.
 */
function groupsOf(findings: Finding[]): Map<string, string> {
  const groups = new Map<string, string>();
  for (const cluster of clusterFindings(findings)) for (const finding of cluster.findings) groups.set(finding.signature, cluster.signature);
  return groups;
}

/**
 * One execution's roster, by cohort: the denominator under every incidence bar.
 *
 * It is passed the agents rather than reading them off the context because the denominator has to
 * belong to the execution being counted. Comparing executions 1 and 2 while 5 exists would
 * otherwise read "3 of 12 planners" with 12 being execution 5's headcount.
 */
function censusFrom(agents: readonly Agent[], members: readonly { cohort: string; cohortName: string }[]): CohortCensus[] {
  const named = new Map(members.map((m) => [m.cohort, m.cohortName]));
  const total = new Map<string, number>();
  for (const agent of agents) total.set(agent.cohortSlug, (total.get(agent.cohortSlug) ?? 0) + 1);
  return [...total.entries()].map(([slug, people]) => ({ slug, name: named.get(slug) ?? slug, people }));
}

/** The evidence execution's roster, by cohort. */
function censusOf(context: SimulationContext): CohortCensus[] {
  return censusFrom(context.agents, context.members);
}

/**
 * Where one problem stands, with a human's judgement layered over the arithmetic.
 *
 * The arithmetic itself lives in `signatureHistories` in `@populace/reports`, next to the
 * clusterer, so the same rules apply to a digest as to a screen. What is added here is the one
 * thing the reports package has no business knowing: a signature a human marked `fixed` and which
 * has turned up ANYWAY is a regression, and belongs at the top of the screen rather than under
 * "known". That is the whole reason triage is keyed by signature (ADR-0028).
 */
function stateOf(history: SignatureHistory | undefined, inLatest: boolean, triage: TriageView | null): ClusterCardView["state"] {
  if (!inLatest) return "fixed";
  if (triage?.state === "fixed") return "regressed";
  return history?.state ?? "new";
}

interface SimulationContext {
  runs: Run[];
  /** The newest execution, whatever state it is in: what the screen's status line is about. */
  latest: Run | undefined;
  /** The newest execution that actually visited: what the screen's RESULTS are about. */
  evidence: Run | undefined;
  /** The roster of the evidence execution — the denominator under every incidence bar. */
  agents: Agent[];
  wakes: Wake[];
  findings: Finding[];
  triage: Triage[];
  members: { cohort: string; cohortName: string; count: number }[];
  /** Every signature this simulation has ever reported, and where it stands across its executions. */
  histories: Map<string, SignatureHistory>;
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
function triageViewOf(triage: Triage | undefined, current: { kind: FindingKind; tool: string; title: string } | null): TriageView | null {
  if (!triage) return null;
  return {
    signature: triage.signature,
    state: triage.state,
    note: triage.note,
    externalRef: triage.externalRef,
    titleAtTriage: triage.titleAtTriage,
    updatedAt: triage.updatedAt,
    // Drift is a HASH question, not a string question. A title that was reworded but still hashes
    // to the same signature is the same problem described twice, which is exactly what tokenising
    // the title was for. A title that no longer hashes to the signature it was filed under is a
    // human's judgement sitting on something else, and says so.
    drifted: current !== null && triage.titleAtTriage !== "" && signatureOf(current.kind, current.tool, triage.titleAtTriage) !== triage.signature,
  };
}

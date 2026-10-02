import {
  SEVERITY_RANK,
  cohortSlugOfAgentId,
  dealStudy,
  personIdOfAgentId,
  signatureOf,
  type Agent,
  type Cluster,
  type ConfigSnapshot,
  type Dealt,
  type FiledIssue,
  type Identity,
  type FindingKind,
  type Cohort,
  type Finding,
  type FirstContact,
  type Project,
  type Run,
  type Simulation,
  type Store,
  type StoredPopulation,
  type Triage,
  type Wake,
} from "@populace/core";
import type {
  ClusterCardView,
  ClusterDetailView,
  EstimateView,
  ExecutionCompareView,
  ExecutionHistoryEntry,
  FiledIssueView,
  ParticipantDetailView,
  PreflightView,
  PublishSkipReason,
  ProjectOverviewView,
  ProjectSummaryView,
  RunCohortView,
  StudyResultsView,
  StudyStatus,
  StudySummaryView,
  ToolUsageView,
  TriageView,
} from "@populace/contract";
import { clusterFindings, primaryTool, type CohortCensus, type SignatureHistory } from "@populace/reports";
import { ReadModel, participantOf } from "./read-model.js";
import { historiesOf, reportWindows, type ReportWindow } from "./report-windows.js";

/**
 * The read models the project, study and participant screens are rendered from (SPEC §6.2).
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
 *
 * And one rule of vocabulary (ADR-0032, ADR-0042): the row is a `Simulation` and is named as such
 * in every identifier here; the wire and every sentence built here say STUDY, and nothing below
 * prints the row's own word, "agent", "wake" or "lane".
 */

export interface ProjectReadModelOptions {
  /** The runs this process is driving right now, so a summary can say "running" truthfully. */
  runningRunIds?: () => string[];
}

/**
 * The coverage panel as it reads when nobody has asked the target anything: no tools, no counts,
 * no error.
 *
 * `results()` takes coverage rather than building it because building it means DIALLING THE
 * PRODUCT UNDER STUDY: `coverageOf` opens a live MCP session with the operator's sign-in grant
 * threaded off the request (`control.ts:1784`). Only a request handler has one of those. Anything
 * else — a job, a background cycle, the thing that files issues — passes this instead, which is
 * the same object `control.ts` already passes for a study with no execution to ask about. No
 * cluster reads coverage; it is a separate panel on the same screen.
 */
export const NO_COVERAGE: ToolUsageView = { items: [], exposedCount: 0, neverCalledCount: 0, toolsError: null };

/**
 * The report window a publish is reporting on, which is as much of a `ReportWindow` as this model
 * reads: who visited inside it, and what was reported inside it.
 *
 * A `ReportWindow` is assignable to it, so the publisher hands over the window it already computed
 * (`reportWindows`) rather than a derived shape, and a test can hand over a literal.
 *
 * `visitors` is here because a fraction has two halves. The reports give the numerator of "M of N
 * who visited hit it" and the window's own visitor list is the only honest denominator for it: the
 * execution's roster is the people a LONGITUDINAL study sent over its whole life, where a window
 * is an hour of that life, so the two read together were a proportion whose halves were counted
 * over different stretches of time (ADR-0045, and `publish-issues.ts`'s `thisCycle`).
 */
export type PublishWindow = Pick<ReportWindow, "runId" | "visitors" | "findings">;

/**
 * One of a study's problems as the thing that files issues needs it: the card a reader sees, the
 * problem in full, the key a filing is recorded under, and whether it may be filed at all.
 */
export interface PublishableCluster {
  /** The card for this problem, counted over the window being published. */
  card: ClusterCardView;
  /**
   * The same problem in full, off the same context — the detail page's own view, which is what the
   * fix prompt is written from (`@populace/fix-prompt`).
   *
   * It is here rather than fetched per issue because fetching it per issue means `cluster()` per
   * issue, and that rebuilds the entire study context each time. It is the real view and not a
   * partial: the prompt reads the reproduction, the replay, the quotes and the conditions.
   *
   * `publishable()` never returns it null. The null is for a caller that has to invent a candidate
   * for a signature this study does not have — a named signature that is `not-found` — which is
   * refused on its skip before anything reads a detail off it.
   */
  detail: ClusterDetailView | null;
  /**
   * EVERY member finding's signature, deduplicated, which is the filing ledger's key
   * (`FiledIssueSchema`) and appears nowhere on the wire.
   *
   * The card's own `signature` is the clustering's REPRESENTATIVE, and `pickRepresentative` sorts
   * on verdict score first — so the digest writing a verdict moves it, inside one execution, with
   * nobody having reworded anything. A record keyed on it is a record filed twice. A finding's own
   * signature never moves: the runner computes it once at file time and never recomputes it.
   */
  signatures: string[];
  /** Why this may never be filed, whatever anybody asked for or any filter says. Null when it may. */
  skip: PublishSkipReason | null;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * The blocks of the project's settings a study sets for itself, named as the Settings screen
 * names them. It asks each override block what it holds rather than comparing it to anything: a
 * block with no fields in it overrides nothing, whoever wrote it and whenever.
 */
function overriding(simulation: Simulation): StudySummaryView["overriding"] {
  const out: StudySummaryView["overriding"] = [];
  if (Object.keys(simulation.overrides.guardrails).length > 0) out.push("spending");
  if (Object.keys(simulation.overrides.verifier).length > 0) out.push("verification");
  if (Object.keys(simulation.overrides.model).length > 0) out.push("model");
  return out;
}

/**
 * The deal of a study's size over its population's weights and then each cohort's mix
 * (ADR-0041), computed with the same arithmetic the builders preview and resolution performs. A
 * member whose cohort has gone is left out before dealing, exactly as resolution leaves it out,
 * so the counts here are the counts a start would send. No population deals nobody.
 */
function dealOf(size: number, population: StoredPopulation | undefined, cohorts: readonly Cohort[]): Dealt {
  if (!population) return { cohorts: [], sends: 0 };
  const byId = new Map(cohorts.map((cohort) => [cohort.id, cohort]));
  const members = population.members.filter((member) => byId.has(member.cohortId));
  return dealStudy(
    size,
    members.map((member) => ({ cohortId: member.cohortId, weight: member.weight })),
    members.map((member) => ({ cohortId: member.cohortId, entries: byId.get(member.cohortId)?.mix ?? [] })),
  );
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
      // `people` is a count of person ROWS that are not archived — everybody some study currently
      // sends, counted once however many studies send them — not a sum of study sizes.
      counts: { studies: simulations.length, targets: targets.length, personas: personas.length, cohorts: cohorts.length, populations: populations.length, people: people.length },
      runningRunIds: runs.filter((run) => running.has(run.id)).map((run) => run.id),
      lastActivityAt: stamps.length ? stamps.reduce((a, b) => (a > b ? a : b)) : null,
      costLast7dUsd: round(recent),
    };
  }

  /**
   * The project home screen in one request. It carries counts, studies and the problems seen in
   * more than one of them — and NOT ONE PERSON'S NAME (SPEC §7.1).
   */
  async overview(project: Project): Promise<ProjectOverviewView> {
    const [base, simulations, runs, triage, settings, killSwitch, targets, populations, filed] = await Promise.all([
      this.summary(project),
      this.store.listSimulations({ projectId: project.id }),
      this.store.listRuns({ projectId: project.id }),
      this.store.listTriage(project.id),
      this.store.getSettings(project.id),
      this.store.getKillSwitch(),
      this.store.listTargets(project.id),
      this.store.listPopulations(project.id),
      this.store.listFiledIssues(project.id),
    ]);
    const findings = runs.length === 0 ? [] : await this.store.listFindings({ runIds: runs.map((r) => r.id) });
    // The same question the people writer's ceiling asks, asked the same way. Two numerators under
    // one `dailyCeilingUsd` would show a project comfortably under a ceiling that is already
    // refusing its jobs (SPEC §5.4).
    const spentToday = await this.store.costSince({ projectId: project.id }, new Date(Date.now() - 86_400_000));
    const views: StudySummaryView[] = [];
    for (const simulation of simulations) views.push(await this.studySummary(simulation, runs));

    const studyOf = new Map(runs.map((run) => [run.id, run.simulationId]));
    const named = new Map(simulations.map((s) => [s.id, s.name]));
    const byTriage = new Map(triage.map((t) => [t.signature, t]));
    const ledger = [...filed].sort((a, b) => a.filedAt.localeCompare(b.filedAt));
    const bySignature = new Map<string, { finding: Finding; studies: Set<string>; people: Set<string> }>();
    for (const finding of findings) {
      const entry = bySignature.get(finding.signature) ?? { finding, studies: new Set<string>(), people: new Set<string>() };
      if (SEVERITY_RANK[finding.severity] < SEVERITY_RANK[entry.finding.severity]) entry.finding = finding;
      const studyId = studyOf.get(finding.runId);
      if (studyId !== undefined) entry.studies.add(studyId);
      entry.people.add(personIdOfAgentId(finding.agentId));
      bySignature.set(finding.signature, entry);
    }

    return {
      ...base,
      studies: views,
      crossStudy: [...bySignature.entries()]
        .filter(([, entry]) => entry.studies.size > 1)
        .map(([signature, entry]) => ({
          signature,
          title: entry.finding.title,
          kind: entry.finding.kind,
          severity: entry.finding.severity,
          tool: entry.finding.tool ?? null,
          studies: [...entry.studies].map((id) => ({ id, name: named.get(id) ?? id })),
          // A headcount, not a roster: how many people is information, who they are is a click away.
          peopleHit: entry.people.size,
          // `primaryTool`, not `finding.tool`: the key was hashed at file time over the tool the
          // finding NAMES or, when it named none, the last tool it reproduced with. Recomputing
          // it over the bare field would never match a finding that named no tool, and every one
          // of them would read as drifted.
          // One signature, as on the project-wide triage list: this row is a rolled-up signature
          // and not a cluster, so there is no member set to intersect and the row's own key is the
          // whole of what it is about.
          triage: triageViewOf(byTriage.get(signature), { kind: entry.finding.kind, tool: primaryTool(entry.finding), title: entry.finding.title }, filedIssueOf(ledger, [signature])),
        }))
        .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.peopleHit - a.peopleHit),
      spentTodayUsd: round(spentToday),
      dailyCeilingUsd: settings?.guardrails.dailyUsd ?? 0,
      killSwitch,
      /*
        The two libraries as rows. Both are derived from lists this method now holds, and the
        per-row study counts come off the `simulations` array it already has — so the whole thing
        is two extra list calls in an existing `Promise.all` and no per-row query.

        `contacted` is the STORED outcome. Nothing here dials a target: asking whether an endpoint
        answers opens a connection to somebody else's server, and that is a POST somebody presses.

        No headcount on a population row: a population is cohorts at weights, and how many go is
        each study's own size (ADR-0041).
      */
      targets: targets.map((target) => ({
        id: target.id,
        name: target.name,
        endpoint: target.mcp[0]?.url ?? null,
        contacted: target.firstContact?.outcome ?? null,
        studies: simulations.filter((simulation) => simulation.targetId === target.id).length,
      })),
      populations: populations.map((population) => ({
        id: population.id,
        name: population.name,
        cohorts: population.members.length,
        studies: simulations.filter((simulation) => simulation.populationId === population.id).length,
      })),
    };
  }

  async listStudies(projectId: string): Promise<StudySummaryView[]> {
    const [simulations, runs] = await Promise.all([this.store.listSimulations({ projectId }), this.store.listRuns({ projectId })]);
    const out: StudySummaryView[] = [];
    for (const simulation of simulations) out.push(await this.studySummary(simulation, runs));
    return out;
  }

  /**
   * One study as the project home renders it. `runs` is passed in when the caller already holds
   * the project's runs, so a project with eight studies is still one query for all of them rather
   * than eight.
   */
  async studySummary(simulation: Simulation, projectRuns?: Run[]): Promise<StudySummaryView> {
    const runs = (projectRuns ?? (await this.store.listRuns({ simulationId: simulation.id }))).filter((run) => run.simulationId === simulation.id).sort((a, b) => a.seq - b.seq);
    const latest = runs.at(-1);
    const [population, cohorts, target] = await Promise.all([
      this.store.getPopulation(simulation.populationId),
      this.store.listCohorts(simulation.projectId),
      this.store.getTarget(simulation.targetId),
    ]);
    const held = population ? population.members.flatMap((member) => cohorts.filter((c) => c.id === member.cohortId)) : [];
    // How many the size actually makes, dealt the way a start deals it. Below `size` when a cohort
    // in the population has no personas to deal into, which is the cue that it needs some.
    const deal = dealOf(simulation.size, population, cohorts);
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

    const status: StudyStatus =
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
      brief: simulation.brief,
      mode: simulation.mode,
      size: simulation.size,
      sends: deal.sends,
      visitsPerPerson: simulation.visitsPerPerson,
      // The timing and the override blocks as the row holds them, so an edit opens on what is
      // saved rather than on the project's defaults. `overriding` below says which blocks are set.
      cadence: simulation.cadence,
      seed: simulation.seed,
      overrides: simulation.overrides,
      autoSweep: simulation.autoSweep,
      requireFreshTarget: simulation.requireFreshTarget,
      // No headcount here: a population has none, the study's `size` is it (ADR-0041).
      population: {
        id: population?.id ?? simulation.populationId,
        name: population?.name ?? "",
        cohorts: held.length,
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
      /** Already in the wire's words: control.ts translates `estimateRun`'s result before it gets here. */
      estimate: EstimateView;
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
    const summary = await this.studySummary(simulation);
    const [population, cohorts, personas, target] = await Promise.all([
      this.store.getPopulation(simulation.populationId),
      this.store.listCohorts(simulation.projectId),
      this.store.listPersonas(simulation.projectId),
      this.store.getTarget(simulation.targetId),
    ]);
    const byId = new Map(cohorts.map((cohort) => [cohort.id, cohort]));
    const personaName = new Map(personas.map((persona) => [persona.id, persona.spec.name]));
    // Who each cohort is drawn from at THIS study's size: the same arithmetic resolution does.
    const deal = dealOf(simulation.size, population, cohorts);
    const people = deal.cohorts.length === 0 ? [] : await this.store.listPeople({ projectId: simulation.projectId });
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
      study: { ...summary, target: { ...summary.target, reachable: input.toolsError === null } },
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
      // One row per cohort the deal reaches, with its personas and their counts at this size. The
      // sample names are the people the deal actually sends — the first few of each persona's
      // share — not whoever happens to be on the cohort's roster for a bigger study.
      cohorts: deal.cohorts.flatMap((entry) => {
        const cohort = byId.get(entry.cohortId);
        if (!cohort) return [];
        const countOf = new Map(entry.lanes.map((lane) => [lane.personaId, lane.count]));
        return [
          {
            slug: cohort.slug,
            name: cohort.name,
            personas: entry.lanes.map((lane) => ({ name: personaName.get(lane.personaId) ?? lane.personaId, people: lane.count })),
            people: sum(entry.lanes.map((lane) => lane.count)),
            sampleNames: people
              .filter((p) => p.cohortId === cohort.id && p.archivedAt === null && p.ordinal < (countOf.get(p.personaId) ?? 0))
              .slice(0, 3)
              .map((p) => p.name),
          },
        ];
      }),
      totalPeople: deal.sends,
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
    const studyName = new Map(simulations.map((s) => [s.id, s.name]));

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
          // The row says `simulationId`; the wire says study (ADR-0032, ADR-0042).
          studyId: sibling.simulationId,
          studyName: studyName.get(sibling.simulationId) ?? sibling.simulationId,
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
    // The execution's own row decides whether anybody is still coming back: see `cohortRollUp`.
    return cohortRollUp(agents, wakes, findings, snapshot?.config.population.members ?? [], stillVisiting(run));
  }

  // ---- results -------------------------------------------------------------

  /**
   * The whole study-results screen in one request, and with NO PERSON NAMES in it: clusters,
   * cohort incidence, coverage, who walked away (by person id and cohort) and the execution
   * history. A name first appears one click further in, on a finding (SPEC §7.1).
   */
  async results(simulation: Simulation, coverage: ToolUsageView): Promise<StudyResultsView> {
    const context = await this.studyContext(simulation);
    const { runs, evidence, evidenceWindow, agents, findings, wakes, members } = context;
    const summary = await this.studySummary(simulation, runs);
    // The counting panels are about ONE execution — the most recent one that visited — so the
    // stats, the cohort roll-up and the people who walked away are all off the same set of rows.
    // `latest` is still in `summary.latest` and in `history`, which is where a run that has not
    // visited yet belongs.
    const latestFindings = findings.filter((f) => f.runId === evidence?.id);
    const latestWakes = wakes.filter((w) => w.runId === evidence?.id);
    // The PROBLEM CARDS are about the newest report WINDOW, which is the only unit the state
    // machine can be read over (ADR-0045, and see `studyContext`). Two things follow from it, and
    // both are the point rather than a side effect.
    //
    // The screen gets the states somebody wrote the copy for. `stateOfCluster`'s longitudinal
    // branch renders `fixed` as "gone quiet" and `regressed` as "back"; counted per execution,
    // neither could ever occur for a longitudinal study, so both rows were dead code and every
    // problem read "new" for ever on the one screen the product's loop is about.
    //
    // And the screen and the publisher now answer the same question. `publishable()` is
    // window-scoped and refuses an absence outright; a screen scoped to the execution offered
    // every problem the run had ever reported, so the dialog listed candidates the server then
    // silently passed over.
    //
    // An ephemeral study has one window per execution, so this is the same set of findings it was
    // before — `latestFindings` for that matter — and the scopes only part where a report cycle
    // has drawn a boundary inside one execution. Where they part, each sentence on the screen is
    // counted over the stretch of time it is about and no other: the headline and the stats say
    // what the execution did, a card says what this window reported.
    const cards = this.resultCards(context, evidenceWindow);
    const walkedAwayWakes = latestWakes.filter((w) => w.status === "gave-up");
    const cohortOf = new Map(agents.map((a) => [a.id, a]));

    const confirmed = latestFindings.filter((f) => f.verification?.verdict === "confirmed").length;
    // Before anything has run, the headline is the deal: how many the size sends, or — at nought,
    // or over cohorts with no personas yet — that nobody goes until the study is given a size.
    // Inflected inline, and every counted noun in it. This is the largest sentence on the screen,
    // so "1 people are ready to go" and "filed 1 report(s)" are read before anything else on the
    // page — and a study of one person is the ordinary way somebody tries this for the first time.
    // The web's `format.ts` helpers cannot be imported here (the server does not depend on the
    // web), which is why this reads like the ternaries in `control.ts` and `sweep.ts` rather than
    // like a call to `plural`.
    const headline =
      evidence === undefined
        ? summary.sends === 0
          ? "This study sends nobody yet: give it a size."
          : `${summary.sends === 1 ? "1 person is" : `${summary.sends} people are`} ready to go; nothing has run yet.`
        : `${agents.length === 1 ? "1 person" : `${agents.length} people`} made ${latestWakes.length === 1 ? "1 visit" : `${latestWakes.length} visits`}, filed ${latestFindings.length === 1 ? "1 report" : `${latestFindings.length} reports`}${confirmed > 0 ? (latestFindings.length === 1 ? ", which is confirmed" : `, ${confirmed} of them confirmed`) : ""}${walkedAwayWakes.length > 0 ? `, and ${walkedAwayWakes.length} walked away` : ""}.`;

    // Triaged and settled: below the fold, not gone. A signature triaged `fixed` that is HERE
    // AGAIN is a regression and stays at the top — burying it under "known" is exactly the
    // failure triage-by-signature exists to prevent (ADR-0028).
    const settled = new Set(cards.filter((c) => c.triage?.state === "wont-fix" || (c.triage?.state === "fixed" && c.state !== "regressed")).map((c) => c.signature));
    return {
      study: summary,
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
      // `evidence` is the execution every row here is counted off, so it is also the one whose
      // liveness decides whether "still coming back" can be said at all (see `cohortRollUp`).
      cohortBreakdown: cohortRollUp(agents, latestWakes, latestFindings, members, stillVisiting(evidence)),
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
    const context = await this.studyContext(simulation);
    // `resultClusters` rather than `resultCards` for one reason: the cluster behind the card is
    // what carries the representative the card's own `verdict` was read off, and the detail has to
    // describe that same finding (see `detailOf`). The cards are the clusters' cards either way.
    //
    // Off the same report window `results()` builds its cards from, and that is not a preference:
    // clustering a different set of findings picks its own representative signatures, so a page
    // keyed on a card the results screen showed would not resolve here and every link on the
    // screen would open a 404. Same window, same keys.
    const entry = this.resultClusters(context, context.evidenceWindow).find(({ card }) => card.signature === signature);
    if (!entry) return undefined;
    const reported = reportedIn(context, signaturesOf(entry.cluster));
    if (reported === undefined) return undefined;
    return this.detailOf(context, entry.card, reported, await this.runExtras(context, reported.run), entry.cluster.representative);
  }

  /**
   * The rows a detail page needs that the study context does not carry: the reporting execution's
   * own roster, its people's accounts, and the config it froze.
   *
   * Loaded per EXECUTION rather than per cluster, because every problem one execution reported
   * shares all three of them. The config is that execution's own and not the latest one: for a
   * signature the newest execution did not report, the evidence is an older run, and describing
   * its calls with today's target name and today's cohort briefs would attribute them to a setup
   * that never made them.
   */
  private async runExtras(context: StudyContext, run: Run): Promise<RunExtras> {
    const agents = run.id === context.evidence?.id ? context.agents : await this.store.listAgents({ runId: run.id });
    const [identities, snapshot] = await Promise.all([
      this.read.identitiesOf(run.id, agents),
      run.configSnapshotId ? this.store.getConfigSnapshot(run.configSnapshotId) : Promise.resolve(undefined),
    ]);
    return { agents, identities, snapshot };
  }

  /** The same, for every execution a set of clusters reports from: one load per execution, not per cluster. */
  private async extrasOf(context: StudyContext, runs: readonly Run[]): Promise<Map<string, RunExtras>> {
    const distinct = new Map(runs.map((run) => [run.id, run]));
    const loaded = await Promise.all([...distinct.values()].map(async (run): Promise<[string, RunExtras]> => [run.id, await this.runExtras(context, run)]));
    return new Map(loaded);
  }

  /**
   * One cluster in full, off a context and an execution's extras that are already in hand.
   *
   * Split out of `cluster()` so `publishable()` can build EVERY problem's detail from the one
   * context it loaded. The thing that files issues needs a real `ClusterDetailView` per problem —
   * it is what the fix prompt is written from — and asking for them one `cluster()` call at a time
   * re-ran the whole study context per problem: every execution, every visit, every report and two
   * clustering passes, forty times over for forty problems.
   *
   * `preferred` is the CLUSTER's own representative, and passing it is what stops the card and the
   * detail describing two different findings of the same problem. `cardOf` reads its `verdict` off
   * `cluster.representative`, which `pickRepresentative` sorts on verdict score first; `reportedIn`
   * has no cluster to hand and takes the reporting execution's first report of the key instead. So
   * one problem with two reports, one of them verified, has the card saying `confirmed` while the
   * detail's `replay` carries the other report's (absent) verification — and the issue body, which
   * is written from the detail, and the comment, which quotes the card, then state two different
   * re-check outcomes for the same problem in the same repository. Mismatched by construction, and
   * it is a reader's word against populace's own.
   *
   * **ONE PAGE, ONE SCOPE: everything about this problem is counted over the report WINDOW
   * `reported` names, which is the window the card above it was counted over** (`resultClusters`,
   * ADR-0045). The card is spread in whole, so `reports`, `state`, `inLatest`, `peopleTotal` and
   * the cohort bars are the window's; `quotes`, `peopleHit` and `peopleMissed` are built from that
   * same window's reports and that same window's visitors. They used to be built from the reporting
   * EXECUTION's, and for a longitudinal study — one execution for its whole life (ADR-0030) — that
   * meant the page's unlabelled numbers were a lifetime total sitting beside a card counted over
   * one report cycle of it. `card.reports` said 1 and the page below listed nine quotes, for the
   * same problem, on the same screen.
   *
   * Two numbers here are deliberately NOT the window's, and both say so where they are read:
   * `history` is one row per EXECUTION because that is what it promises, and a person in
   * `peopleHit` carries their own visits, reports and cost over the whole execution, which is what
   * a person's row means everywhere else in populace and which the only two sentences built from it
   * (`PeopleWhoHit.tsx` and `reachLines`) name as the execution's.
   *
   * The one case where a page is still about two stretches is an ABSENCE card, and it cannot be
   * otherwise: the card's zeroes are the statement that the reported-on window saw none of this,
   * and the evidence under it can only come from the last window that did see it. That is what
   * `inLatest: false`, `state` and `lastSeenAt` are on the card to say. What changed is that both
   * stretches are now report windows — the same unit, named by the same list — rather than one
   * window against one execution.
   */
  private detailOf(context: StudyContext, card: ClusterCardView, reported: ReportedIn, extras: RunExtras, preferred?: Finding): ClusterDetailView {
    const { runs, findings, wakes } = context;
    const signature = card.signature;
    const { run: reportedIn, window, findings: mine } = reported;
    const { agents, identities, snapshot } = extras;
    // Membership in `mine` is the whole test, and it says both of the things that have to be true:
    // the cluster's representative was reported inside the report window this page is ABOUT, and it
    // carries this page's key. A cluster whose representative sits in an older window — which is
    // what an absence card is — falls back to that window's own first report, because describing an
    // older run's finding with this run's roster, accounts and frozen config would attribute its
    // calls to a setup that never made them (see `runExtras`).
    const representative = preferred !== undefined && mine.some((f) => f.id === preferred.id) ? preferred : reported.representative;

    // A person's own row — their visits, their reports, their cost — is scoped to that one
    // EXECUTION and deliberately not to the window, because that is what a person's row means
    // everywhere else in populace and both sentences built from it name the execution out loud
    // ("their whole stay, not only the visits that hit this"). Scoping it to the window would make
    // the same person's visit count differ between this page and their own.
    //
    // Agent ids are deterministic within a study (`populationSlug/cohortSlug.personaSlug#ordinal`),
    // so the cross-execution sets the history below is built from would match this run's
    // participants too — and every person on this page would then report their visits, reports and
    // cost summed over every execution the study has ever had.
    const ownWakes = wakes.filter((w) => w.runId === reportedIn.id);
    const ownFindings = findings.filter((f) => f.runId === reportedIn.id);
    const byAgent = new Map(agents.map((a) => [a.id, a]));
    const visitNumber = new Map(wakes.map((w) => [w.id, w.wakeNumber]));
    const lanes = snapshot?.config.population.members ?? [];
    const memberName = new Map([...context.members.map((m): [string, string] => [m.cohort, m.cohortName]), ...lanes.map((m): [string, string] => [m.cohort, m.cohortName])]);
    const hitCohorts = new Set(mine.map((f) => byAgent.get(f.agentId)?.cohortSlug).filter((slug): slug is string => slug !== undefined));
    // One row per cohort, not per lane. A cohort mixing three personas is three members sharing a
    // slug and a context, and three identical briefs under one heading is noise.
    const conditions = new Map<string, { cohortSlug: string; cohortName: string; context: string }>();
    for (const lane of lanes) {
      if (!hitCohorts.has(lane.cohort) || conditions.has(lane.cohort) || lane.context === "") continue;
      conditions.set(lane.cohort, { cohortSlug: lane.cohort, cohortName: lane.cohortName, context: lane.context });
    }
    const hitAgents = new Set(mine.map((f) => f.agentId));
    // The people who went and did not report this, counted over the SAME report window `mine` is —
    // the window's own visitors, not the execution's whole roster.
    //
    // `peopleHit` and `peopleMissed` are the two halves of one fraction: `PeopleWhoHit.tsx` adds
    // them for "N of M who went ran into this" and the fix prompt's `reachLines` does the same for
    // the sentence that goes into a GitHub issue. A numerator counted over one report cycle and a
    // denominator counted over a longitudinal execution's entire life is a proportion that is true
    // of nothing — and it is the same fraction `ClusterCardView.peopleHit`/`peopleTotal` carries,
    // so the page and the card beside it would also have disagreed about the same problem.
    const wentIn = new Set(window.visitors);
    const missed = new Map<string, { cohortSlug: string; name: string; count: number }>();
    for (const agent of agents) {
      if (hitAgents.has(agent.id) || !wentIn.has(agent.id)) continue;
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
      product: {
        name: snapshot?.config.target.name ?? "",
        description: snapshot?.config.target.description ?? null,
        // Name and URL only. An endpoint also carries `headers` and may carry a static
        // `bearerToken`, and neither has any business on the wire.
        endpoints: (snapshot?.config.target.mcp ?? []).map((endpoint) => ({ name: endpoint.name, url: endpoint.url })),
      },
      conditions: [...conditions.values()],
    };
  }

  /**
   * Every problem the study's results screen shows, with the ledger's key beside it and the hard
   * skips already decided. This is what the thing that files issues iterates.
   *
   * It exists because none of that is reachable from outside otherwise, and the shape that is
   * reachable is a trap. `results()` hands back `ClusterCardView`s carrying only the representative
   * signature, so a publisher given those has one cheap-looking option — record a one-element set
   * holding the representative — and the next digest moves the representative and it files the
   * problem a second time. `PublishableCluster.signatures` is the member set that does not move.
   *
   * It is also ONE call rather than a loop over `cluster()`, which rebuilds the whole study context
   * per call: every run, every visit, every report, plus two full clustering passes. Forty problems
   * would be forty of those — which is why the DETAIL comes back with the card, built off this same
   * context. And a caller must not cluster the findings itself either — a second clustering of the
   * same findings picks its own representatives, so the keys it produced would not resolve against
   * the route that serves one problem, and every issue would link to a 404.
   *
   * There is no `coverage` argument and nothing here dials anybody: see `NO_COVERAGE`.
   *
   * The skips decided here are the ones this model holds the data for, and each is a rule no
   * filter may waive. `already-filed` is deliberately not among them: a caller needs the ledger
   * ROW to comment on rather than the fact that one exists, so it asks the store for it. What the
   * card carries is `filedIssue`, which is the answer a screen wants.
   *
   * **And it is scoped to a report WINDOW, where every screen above is scoped to an EXECUTION.**
   * That difference is the whole reason this takes an argument. A screen reports on the newest
   * execution that visited, which is right for a screen: an execution is what a reader compares.
   * But the state machine whose words go into an issue and its comments is window-scoped
   * (`report-windows.ts`), and a LONGITUDINAL study — the mode this loop is built around — has
   * exactly ONE execution for its whole life. Scoped to that execution, `inLatest` is true for
   * every problem the run has EVER reported, the `absent` skip below never fires, and populace
   * files a problem that went quiet three cycles ago as a brand new issue and then comments "gone
   * quiet" a cycle later on the issue it opened itself. Everything the issue says — `inLatest`,
   * `peopleHit`, `reports` — is therefore counted off the window's own reports, so the numbers
   * belong to the same stretch of time as the sentence they sit under.
   *
   * `window` is the window being reported on, normally the newest one anybody visited. It is
   * `undefined` only for a study with no executions at all, which has no problems either.
   */
  async publishable(simulation: Simulation, window: PublishWindow | undefined): Promise<PublishableCluster[]> {
    const context = await this.studyContext(simulation);
    const entries = this.resultClusters(context, window);
    // The same fold `results()` applies to move a problem below the fold into `known`: a human's
    // judgement stands, unless the signature they called fixed is here again, which is a
    // regression and is the whole reason triage is keyed by signature (ADR-0028).
    const settled = new Set(entries.filter(({ card }) => card.triage?.state === "wont-fix" || (card.triage?.state === "fixed" && card.state !== "regressed")).map(({ card }) => card.signature));
    // By the cluster's MEMBER signatures, which is the same set the ledger and triage are matched
    // on and for the same reason: the representative moves the moment a digest writes a verdict,
    // so a page looked up by it would resolve onto a different set of reports than the card above
    // it was counted from (see `oldestMatching`).
    const reported = entries.map(({ cluster }) => reportedIn(context, signaturesOf(cluster)));
    const extras = await this.extrasOf(context, reported.flatMap((own) => (own === undefined ? [] : [own.run])));
    return entries.flatMap(({ cluster, card }, index) => {
      const own = reported[index];
      const runExtras = own === undefined ? undefined : extras.get(own.run.id);
      // A cluster no execution of this study reported is not a problem of this study: it can only
      // come from a window handed over from somewhere else. Leaving it out is the safe direction —
      // there is no evidence here to write an issue from.
      if (own === undefined || runExtras === undefined) return [];
      return [
        {
          card,
          // The cluster's representative goes down with it, so the body this detail is written
          // from and the comment the card is written from name one finding (see `detailOf`).
          detail: this.detailOf(context, card, own, runExtras, cluster.representative),
          signatures: signaturesOf(cluster),
          skip: skipOf(card, settled),
        },
      ];
    });
  }

  /** Two executions of one study, side by side: what persisted, what went, what turned up. */
  async compare(simulation: Simulation, aId: string, bId: string): Promise<ExecutionCompareView | undefined> {
    const context = await this.studyContext(simulation);
    const a = context.runs.find((r) => r.id === aId);
    const b = context.runs.find((r) => r.id === bId);
    if (!a || !b) return undefined;
    const [detailA, detailB] = await Promise.all([this.read.getRun(a.id), this.read.getRun(b.id)]);
    if (!detailA || !detailB) return undefined;
    // Each side is counted against ITS OWN roster. Neither execution need be the latest, and
    // "3 of 12 planners" with the newest execution's 12 under it is a number about nothing.
    const [castA, castB] = await Promise.all([this.store.listAgents({ runId: a.id }), this.store.listAgents({ runId: b.id })]);
    // B is the side the difference is read against, so a card that only A reported is an ABSENCE
    // and has to say so in the data. Its NUMBERS stay A's own — three of twelve planners hit this
    // in A is the information the screen is for — which is why `cards()` cannot simply be asked
    // for it: `cardOf`'s `inLatest` argument also zeroes the incidence, and zeroing it here would
    // throw away the only thing this side has to show. What the flag and the state are about is B.
    const absentFromB = (card: ClusterCardView): ClusterCardView => ({ ...card, inLatest: false, state: "fixed" });
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
      fixed: cardsA.filter((c) => !inB.has(c.signature)).map(absentFromB),
      appeared: cardsB.filter((c) => !inA.has(c.signature)),
      castIdentical: identicalCast,
      notes,
    };
  }

  async triage(projectId: string): Promise<TriageView[]> {
    const [triage, runs, filed] = await Promise.all([this.store.listTriage(projectId), this.store.listRuns({ projectId }), this.store.listFiledIssues(projectId)]);
    const findings = runs.length === 0 ? [] : await this.store.listFindings({ runIds: runs.map((r) => r.id) });
    // The finding this judgement currently sits on, which is what says whether it still fits.
    const current = new Map(findings.map((f) => [f.signature, f]));
    const ledger = [...filed].sort((a, b) => a.filedAt.localeCompare(b.filedAt));
    return triage.flatMap((row) => {
      const finding = current.get(row.signature);
      // One signature, because that is all a triage row is about: this list is every judgement
      // somebody has made in the project, with no clustering behind it to take a member set from.
      // A card on the results screen matches on the whole cluster and so catches more.
      const view = triageViewOf(row, finding ? { kind: finding.kind, tool: primaryTool(finding), title: finding.title } : null, filedIssueOf(ledger, [row.signature]));
      return view ? [view] : [];
    });
  }

  // ---- shared loading ------------------------------------------------------

  /**
   * Everything one study's screens read, in a fixed handful of calls: its executions, the latest
   * execution's participants, and every visit and report across all of them.
   */
  private async studyContext(simulation: Simulation): Promise<StudyContext> {
    const runs = (await this.store.listRuns({ simulationId: simulation.id })).sort((a, b) => a.seq - b.seq);
    const latest = runs.at(-1);
    const ids = runs.map((r) => r.id);
    const [wakes, findings, triage, filed, jobs] = await Promise.all([
      ids.length === 0 ? Promise.resolve<Wake[]>([]) : this.store.listWakes({ runIds: ids }),
      ids.length === 0 ? Promise.resolve<Finding[]>([]) : this.store.listFindings({ runIds: ids }),
      this.store.listTriage(simulation.projectId),
      // One read of the whole ledger, intersected in memory per card. The alternative is a query
      // per cluster, which is the shape "a screen is a bounded number of queries" exists to
      // forbid, and the row count is bounded by the issues one person reads in one repository.
      this.store.listFiledIssues(simulation.projectId),
      // The jobs, because a report cycle's job row is where a window boundary is read off
      // (ADR-0045 §3) and nothing records one anywhere else. One query per EXECUTION, which is the
      // one dimension a screen is allowed to grow a query count along — `listJobs` takes a single
      // run and has no cross-run form — and it is deliberately the same loop, with the same
      // default limit, as the publisher's own row load (`publish-issues.ts`'s `studyRows`).
      // Matching it is load-bearing rather than tidy: the screen and the publisher have to read
      // the SAME boundaries off the same rows, and a screen offering a problem the publisher
      // silently passes over is exactly the divergence this scoping exists to close.
      Promise.all(runs.map((run) => this.store.listJobs({ runId: run.id }))).then((lists) => lists.flat()),
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
    // The study's report windows: every execution boundary AND every report cycle, in order
    // (ADR-0045). This is the one unit the state machine below is allowed to read, and the reason
    // is that a longitudinal study has exactly ONE execution for its whole life (ADR-0030) — so
    // counted per execution, `inLatest` is true for every problem the run has ever reported, the
    // presence list before it is empty, and `open`, `fixed` and `regressed` are unreachable for
    // the one mode the whole loop is built around. An ephemeral study has one window per execution
    // and therefore gets bit-for-bit what it got before: nothing here branches on mode, and
    // nothing should.
    const windows = reportWindows({ runs, wakes, findings, jobs });
    // The window the screens report ON, chosen exactly as `evidence` is chosen among executions
    // and for the same reason: a window nobody has visited yet says nothing either way, and
    // reading its silence as an absence would turn every open problem into "gone quiet" in the
    // seconds between a cycle closing and the next visit landing. Both fall back to the newest of
    // their kind, so the window is always one of the evidence execution's.
    const evidenceWindow = [...windows].reverse().find((window) => window.visited) ?? windows.at(-1);
    return {
      runs,
      latest,
      evidence,
      windows,
      evidenceWindow,
      agents,
      wakes,
      findings,
      triage,
      // Sorted here rather than trusted from the store, because the tie-break is load-bearing and
      // belongs beside the intersection that uses it (see `filedIssueOf`).
      filed: [...filed].sort((a, b) => a.filedAt.localeCompare(b.filedAt)),
      members: (snapshot?.config.population.members ?? []).map((m) => ({ cohort: m.cohort, cohortName: m.cohortName, count: m.count })),
      // Over the WINDOWS, not the executions: `historiesOf` hands `signatureHistories` one entry
      // per window and the arithmetic runs unchanged (ADR-0045 §1), which is what gives a
      // longitudinal study a state machine at all.
      //
      // One clustering across every execution, so that a problem reported in different words in
      // different executions has ONE history. Asked per signature it would read as an old problem
      // fixed and a new one appearing, which is precisely the question this screen is for and
      // precisely the wrong answer.
      histories: historiesOf(windows, groupsOf(findings)),
    };
  }

  /**
   * Clusters as a card each. `state` is the join between what the machine found and what a human
   * said about it: a signature triaged `fixed` that is here again is a REGRESSION, which is the
   * whole reason triage is keyed by signature rather than by finding id (ADR-0028).
   */
  private cards(context: StudyContext, findings: Finding[], census: CohortCensus[]): ClusterCardView[] {
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
  private resultCards(context: StudyContext, window: PublishWindow | undefined): ClusterCardView[] {
    return this.resultClusters(context, window).map(({ card }) => card);
  }

  /**
   * The same set of cards with the cluster each came out of still attached.
   *
   * `resultCards` is this with the clusters dropped, which is everything a SCREEN needs; what needs
   * the clusters is `publishable`, because the key a filing is recorded under is the cluster's
   * member signatures and no card carries them.
   *
   * `window` is the stretch being reported ON, and every caller passes a report WINDOW: a screen
   * the newest one anybody visited, `publishable` the one the publisher is filing from. Which
   * reports are absent is therefore decided by identity — a cluster none of whose members were
   * reported — rather than by run id, which could only ever answer a screen's question.
   *
   * **The census is the WINDOW's and not the execution's, and that is the whole point of taking
   * the window rather than its findings.** Every incidence number on a card is a fraction: the
   * numerator is what this window reported, so the denominator has to be who visited inside this
   * window. Taken off the evidence execution's roster it was the people a longitudinal study has
   * sent over its entire life, under a numerator counted over one report cycle of it — "1 of 12
   * people", where the 1 and the 12 are counted over stretches of time hours apart. Nobody can
   * read that as anything but a proportion, and as a proportion it was simply false. The
   * derivation is `windowCensus`, which is the read-model half of the one the publisher already
   * makes in `publish-issues.ts`'s `thisCycle` — the two have to agree, because the fraction on
   * the dialog a reader presses and the fraction in the issue it files are the same claim.
   *
   * An ephemeral study on defaults has one window per execution and everybody who went visited
   * inside it, so this is the same census it has always been; the scopes part only where a report
   * cycle has drawn a boundary inside one execution, or where somebody on the roster never went.
   */
  private resultClusters(context: StudyContext, window: PublishWindow | undefined): { cluster: Cluster; card: ClusterCardView }[] {
    const reported = window?.findings ?? [];
    const census = windowCensus(window, context.agents, context.members);
    const present = clusterFindings([...reported], { census }).map((cluster) => ({ cluster, card: this.cardOf(context, cluster, true, census) }));
    const here = new Set(reported.map((f) => f.signature));
    for (const { card } of present) here.add(card.signature);
    const ids = new Set(reported.map((f) => f.id));
    // Clustered across EVERY execution, not just over the findings that are gone. A signature is a
    // hash of an exact token set while the clusterer merges titles that are merely similar, so one
    // problem routinely carries several signatures — and the same search bug, worded differently in
    // two executions, would otherwise appear twice on one screen: once open, once claimed fixed.
    // A cluster that holds anything the reported stretch filed is already on screen.
    const absent = clusterFindings(context.findings, { census })
      .filter((cluster) => !here.has(cluster.signature) && cluster.findings.every((f) => !ids.has(f.id)))
      .map((cluster) => ({ cluster, card: this.cardOf(context, cluster, false, census) }));
    return [...present, ...absent];
  }

  /**
   * One cluster as a card. `inLatest` says whether this is something the stretch being reported on
   * found: when it is not, the incidence numbers are zeroes, because nobody in that stretch hit it
   * — which is the whole point of the `fixed` state.
   *
   * **`census` and `cluster` must be scoped to the same stretch of time, and no caller may mix
   * them.** Everything incidence here is a fraction — `peopleHit` over `peopleTotal`, and
   * `cohorts[].hit` over `cohorts[].total` — and both halves are taken from the two arguments: the
   * numerators off the cluster's members, the denominators off the census. A census of a different
   * stretch than the findings the cluster was built over produces a proportion that is true of
   * nothing, which is a false claim and not a rounding error. The two callers each hold one scope
   * and pass it whole: `resultClusters` a report WINDOW's reports beside that window's visitors,
   * and `cards` (for `compare`) one EXECUTION's reports beside that execution's roster.
   */
  private cardOf(context: StudyContext, cluster: Cluster, inLatest: boolean, census: CohortCensus[]): ClusterCardView {
    // BOTH of these are matched on the cluster's MEMBER signatures and not on the representative
    // below. The representative moves when a digest writes a verdict, so a card that looked either
    // one up by its own key would say "not filed" and "not triaged" in precisely the case both
    // records exist for: the problem whose key flipped after it had already gone out as an issue,
    // or after somebody had already declined it. See `oldestMatching`.
    const signatures = cluster.findings.map((f) => f.signature);
    const filedIssue = filedIssueOf(context.filed, signatures);
    const judged = oldestMatching(context.triage, signatures, (row) => ({ signatures: [row.signature], at: row.updatedAt }));
    const triage = triageViewOf(judged, { kind: cluster.kind, tool: cluster.tool ?? "", title: cluster.title }, filedIssue);
    const history = context.histories.get(cluster.signature);
    // `histories` is scoped to report WINDOWS (ADR-0045), so its presence list is window ordinals
    // and the card carries BOTH scopes rather than one number doing two jobs. The state machine
    // needs the windows — one execution's report cycles are the only sequence a longitudinal study
    // has — and every sentence a screen writes with the word "execution" in it needs the
    // executions, which for that same study is the single run it has been living in all along. The
    // mapping is exact and needs no second pass: each window belongs to exactly one execution, and
    // `context.windows` is the list both were computed from.
    const seenInWindows = history?.seenIn ?? [];
    // A cluster the reported-on stretch did not report shows its incidence as zeroes: nobody in it
    // hit this, which is the whole point of the `fixed` state. The census is still there, so the
    // bar reads "0 of 12" rather than disappearing — and the 12 is the same 12 the numerator would
    // have been counted out of, because it is this stretch's own census and not another's.
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
      inLatest,
      state: stateOf(history, inLatest, triage),
      seenIn: executionSeqsOf(context, seenInWindows),
      seenInWindows,
      firstSeenAt: history?.firstSeenAt ?? null,
      lastSeenAt: history?.lastSeenAt ?? null,
      triage,
      filedIssue,
    };
  }
}

/**
 * Why a problem may never become an issue, whoever asked for it and whatever a filter says.
 *
 * Ordered as `PublishSkipReasonSchema` lists the hard skips, so a reader is told the most specific
 * thing about the problem itself before being told which window did or did not report it. Every one
 * of them is a rule rather than a preference: `praise` has nothing to fix, the two triage answers
 * are a human's judgement standing, and the last is the one populace is forbidden to get wrong.
 */
function skipOf(card: ClusterCardView, settled: ReadonlySet<string>): PublishSkipReason | null {
  if (card.kind === "praise") return "praise";
  if (settled.has(card.signature)) return "settled";
  if (card.triage?.state === "duplicate") return "duplicate";
  // An ABSENCE: nobody reported this problem inside the window being published. Filing it would be
  // populace announcing a repair it cannot see, which is the one thing ADR-0028 forbids outright —
  // and for a longitudinal study, whose whole life is one execution, this is the skip that stops a
  // problem last seen three cycles ago going out as a brand new issue. Read off the card's own
  // flag and not off `state`, which a triage row also drives.
  if (!card.inLatest) return "absent";
  return null;
}

/**
 * The issue populace has already opened for a problem, matched by SIGNATURE-SET INTERSECTION.
 *
 * This is the dedupe rule in one function, and it is deliberately not a lookup by key. The key a
 * card offers is its clustering's representative signature, and `pickRepresentative` sorts on
 * verdict score first — so the digest writing a verdict moves it, inside one execution, with
 * nobody having reworded anything. A finding's own signature never moves: the runner computes it
 * once at file time. So a row matches when any signature it went out holding is any signature this
 * cluster holds now (`FiledIssueSchema` carries the argument in full).
 *
 * `filed` is oldest first, so where two rows have both grown into this cluster's set the issue a
 * reader has been following since it was opened wins — the same tie `matchFiledIssue` breaks the
 * same way, because a screen and a filing must not disagree about which issue this is.
 */
function filedIssueOf(filed: readonly FiledIssue[], signatures: readonly string[]): FiledIssueView | null {
  const row = oldestMatching(filed, signatures, (issue) => ({ signatures: issue.signatures, at: issue.filedAt }));
  return row ? { repo: row.repo, number: row.number, url: row.url, filedAt: row.filedAt } : null;
}

/**
 * The oldest row whose own signatures intersect this cluster's, or none: the one intersection, for
 * the filing ledger and for triage alike.
 *
 * They share it because they are the same question asked of a key that MOVES. A cluster's own
 * `signature` is its clustering's representative and `pickRepresentative` sorts on verdict score
 * first, so a digest writing a verdict moves it inside one execution with nobody having reworded
 * anything. A finding's signature never moves — the runner computes it once at file time and never
 * recomputes it — so the match is over the member signatures. Looked up by the representative
 * instead, the ledger files one problem twice and a human's `wont-fix` silently stops applying the
 * moment a verdict lands, which is the one thing triage-by-signature exists to prevent (ADR-0028).
 *
 * Oldest wins where two rows have both grown into this cluster's set: the issue a reader has been
 * following since it was opened, and the judgement somebody made first. `matchFiledIssue` breaks
 * the same tie the same way, because a screen and a filing must not disagree about which issue
 * this is. It is read off each row's own timestamp rather than off the order they arrive in, so a
 * caller cannot change the answer by sorting its list differently.
 */
function oldestMatching<T>(rows: readonly T[], signatures: readonly string[], of: (row: T) => { signatures: readonly string[]; at: string }): T | undefined {
  if (signatures.length === 0) return undefined;
  const wanted = new Set(signatures);
  let best: { row: T; at: string } | undefined;
  for (const row of rows) {
    const meta = of(row);
    if (!meta.signatures.some((signature) => wanted.has(signature))) continue;
    if (best === undefined || meta.at.localeCompare(best.at) < 0) best = { row, at: meta.at };
  }
  return best?.row;
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
 * One EXECUTION's roster, by cohort: the denominator under an execution-scoped incidence bar,
 * which since the cards moved to report windows means `compare()` and nothing else.
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

/**
 * One report WINDOW's roster, by cohort: the denominator under every incidence bar on a card.
 *
 * **It is who visited inside the window, not who is on the execution's roster**, and the reason is
 * that the numerator beside it is counted over the window's reports. For an EPHEMERAL study on
 * defaults the two are all but the same set — one window per execution, and everybody dealt to it
 * went — but a LONGITUDINAL study has exactly one execution for its whole life (ADR-0030) and as
 * many windows as it has run report cycles. Counted off the execution, a card on its seventh cycle
 * read "1 of 12 people", with the 1 counted over an hour and the 12 over a fortnight. Nobody can
 * read that as anything but a proportion, and as a proportion it was false — and it is the fraction
 * the bulk-file dialog prints, next to a filed issue carrying the window-scoped one.
 *
 * This is the read-model half of the derivation `publish-issues.ts`'s `thisCycle` already makes for
 * the issue body, and the two are deliberately the same: the same stretch of time
 * (`ReportWindow.visitors`), the same unit (PEOPLE, so that the numerator — which the clusterer
 * counts as distinct person ids — and the denominator are the same thing counted), and the same
 * guard that anybody who reported it counts as somebody who went, because a fraction whose top
 * half is larger than its bottom half is the one shape of this sentence nobody would believe.
 *
 * Resolved against the window's own execution roster where the row is there and off the id where it
 * is not, exactly as the rest of this file does it: a person whose row has gone must not silently
 * drop out of a denominator.
 */
function windowCensus(window: PublishWindow | undefined, agents: readonly Agent[], members: readonly { cohort: string; cohortName: string }[]): CohortCensus[] {
  if (window === undefined) return [];
  const named = new Map(members.map((m) => [m.cohort, m.cohortName]));
  const byId = new Map(agents.map((a) => [a.id, a]));
  const people = new Map<string, Set<string>>();
  const count = (agentId: string): void => {
    const agent = byId.get(agentId);
    const slug = agent?.cohortSlug ?? cohortSlugOfAgentId(agentId);
    if (slug === "") return;
    const seen = people.get(slug) ?? new Set<string>();
    seen.add(agent?.personId ?? personIdOfAgentId(agentId));
    people.set(slug, seen);
  };
  for (const agentId of window.visitors) count(agentId);
  for (const finding of window.findings) count(finding.agentId);
  return [...people.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([slug, who]) => ({ slug, name: named.get(slug) ?? slug, people: who.size }));
}

/**
 * A cluster's MEMBER signatures, deduped: the identity of a problem over time.
 *
 * Not its `signature`, which is its clustering's representative and moves the moment a digest
 * writes a verdict (`pickRepresentative` sorts on verdict score first). Everything that has to
 * find the same problem again across a clustering — the filing ledger, triage, and which window's
 * reports a detail page is about — matches on this set and never on the representative. See
 * `oldestMatching`.
 */
function signaturesOf(cluster: Cluster): string[] {
  return [...new Set(cluster.findings.map((f) => f.signature))];
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

/**
 * The executions those report windows belong to: ascending, and each named once.
 *
 * Every window sits inside exactly one execution, so this is a lookup and not an estimate — and it
 * collapses, which is the whole point. Four report cycles of one longitudinal run are four windows
 * and ONE execution, and `ClusterCardView.seenIn` promises executions: handing it the ordinals
 * would make a screen say "reported in 4 executions" about a study that has never had a second one,
 * which is the shape of falsehood ADR-0028's amendment exists to forbid. The window-scoped list
 * goes out beside it under its own name for the arithmetic that genuinely wants windows.
 */
function executionSeqsOf(context: StudyContext, ordinals: readonly number[]): number[] {
  const wanted = new Set(ordinals);
  const seqs = new Set(context.windows.filter((window) => wanted.has(window.ordinal)).map((window) => window.seq));
  return [...seqs].sort((a, b) => a - b);
}

/** What one study's screens are built from: its executions and everything they produced. */
interface StudyContext {
  runs: Run[];
  /** The newest execution, whatever state it is in: what the screen's status line is about. */
  latest: Run | undefined;
  /** The newest execution that actually visited: what the screen's COUNTS are about. */
  evidence: Run | undefined;
  /**
   * The study's report windows, oldest first: every execution boundary and every report cycle
   * (ADR-0045). The unit the state machine reads, and an ephemeral study's are its executions.
   */
  windows: ReportWindow[];
  /**
   * The newest window anybody visited: what the screen's PROBLEMS are about, and the same window
   * the publisher files from, so that the screen never offers a problem the server passes over.
   */
  evidenceWindow: ReportWindow | undefined;
  /** The roster of the evidence execution — the denominator under every incidence bar. */
  agents: Agent[];
  wakes: Wake[];
  findings: Finding[];
  triage: Triage[];
  /**
   * The project's filing ledger, OLDEST FIRST.
   *
   * It is per project and not per study because an issue number outlives the cluster, the run and
   * the study that reported it. Oldest first is the tie-break `filedIssueOf` relies on.
   */
  filed: FiledIssue[];
  members: { cohort: string; cohortName: string; count: number }[];
  /** Every signature this study has ever reported, and where it stands across its report windows. */
  histories: Map<string, SignatureHistory>;
}

/** The report window a cluster's detail page is about, and that window's reports of it. */
interface ReportedIn {
  /** The execution the window lies in: whose roster, accounts and frozen config describe it. */
  run: Run;
  /** The window itself, so the page's people can be counted over the stretch it covers. */
  window: ReportWindow;
  findings: Finding[];
  representative: Finding;
}

/** What a detail page needs beyond the study context, loaded once per execution. */
interface RunExtras {
  agents: Agent[];
  /** Each participant's account, by agent id. */
  identities: Map<string, Identity>;
  snapshot: ConfigSnapshot | undefined;
}

/**
 * Which report WINDOW a cluster's page is ABOUT, and that window's reports of it.
 *
 * Normally the one the screen is reporting on; for a problem that window did not report — a card
 * for something that has gone quiet — the most recent window that did, so an absence still opens
 * onto the evidence that it was ever there.
 *
 * **A window and not an execution, because the card above the page is counted over a window**
 * (`resultClusters`, ADR-0045). Asked per execution, the page's quotes and people were every report
 * the execution had ever made of the problem — which for a longitudinal study is its whole life
 * — sitting under a card counted over one report cycle of it. One screen, two scopes, and the
 * unlabelled number was the one that was wrong.
 *
 * Matched on the cluster's MEMBER signatures rather than on one key, for the same reason the ledger
 * and triage are (`oldestMatching`): the clusterer merges wordings that a signature hash does not,
 * so a cluster routinely holds several, and the card's own `signature` is whichever member
 * `pickRepresentative` put first. Asked for that one key alone, a page showed a subset of the
 * reports its card had counted, inside one window, with nothing changed and nobody reworded.
 *
 * The `representative` here is the window's FIRST report in the set and not the clustering's
 * representative, which this function has no cluster to ask for. It is therefore a fallback:
 * `detailOf` takes the cluster's own when the cluster's own was reported inside this window, so
 * that a card and the detail behind it never describe two different findings of one problem.
 */
function reportedIn(context: StudyContext, signatures: readonly string[]): ReportedIn | undefined {
  if (signatures.length === 0) return undefined;
  const wanted = new Set(signatures);
  const runs = new Map(context.runs.map((run) => [run.id, run]));
  for (const window of [...context.windows].reverse()) {
    const mine = window.findings.filter((f) => wanted.has(f.signature));
    const representative = mine[0];
    const run = runs.get(window.runId);
    if (representative === undefined || run === undefined) continue;
    return { run, window, findings: mine, representative };
  }
  return undefined;
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

/**
 * An execution somebody could still visit — the same test `report-windows.ts`'s `isLive` makes, and
 * deliberately the same words.
 *
 * `paused` is not one: it is resumable rather than terminal, but nobody is woken while it sits
 * there. `pending` is out for the opposite reason, its daemon has not ticked yet; and an execution
 * whose row is missing is out because nothing can be confirmed about it.
 */
function stillVisiting(run: Run | undefined): boolean {
  return run?.status === "running";
}

/**
 * A cohort roll-up over one execution's rows. No names: a cohort is a group, not a person.
 *
 * `running` is the execution's own liveness, and it is an argument rather than something read off
 * the participant rows because **"still coming back" is a claim about the execution as much as
 * about the person.** A participant keeps `status: "active"` when its execution is paused,
 * completed, killed or failed — nothing rewrites those rows on the way down — and `listDueAgents`
 * selects `status = 'active'` (`packages/store-sqlite/src/index.ts:423-427`), so an active row in a
 * stopped execution will never be woken again whatever the cadence says. Read off the row alone,
 * `RunCohortView.stillActive` had the dashboard say "4 still coming back" of a study that stopped
 * days ago (`RunCohorts.tsx:330` renders exactly that sentence). That is the same class of false
 * claim as the one `report-windows.ts` fixed in `ProblemReach.stillActive`, and it is fixed here
 * the same way: active AND running, or nought.
 */
function cohortRollUp(agents: Agent[], wakes: Wake[], findings: Finding[], members: { cohort: string; cohortName: string }[], running: boolean): RunCohortView[] {
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
      personas: [...new Set(own.map((a) => a.persona.name))],
      people: own.length,
      stillActive: running ? own.filter((a) => a.status === "active").length : 0,
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
function triageViewOf(triage: Triage | undefined, current: { kind: FindingKind; tool: string; title: string } | null, filedIssue: FiledIssueView | null): TriageView | null {
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
    // populace's own outbound record, which a triage row does not carry — filing writes no triage
    // state — so it is read off the filing ledger and passed in rather than found here.
    // `externalRef` above is still whatever a human typed, untouched.
    filedIssue,
  };
}

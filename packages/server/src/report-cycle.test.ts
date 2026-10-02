import { GithubConnectionSchema, PopulaceConfigSchema, ReportCycleSchema, tagForRun, type Agent, type AgentQuery, type Job, type PopulaceConfig, type Run, type Simulation, type Store } from "@populace/core";
import { startMockTarget, type RunningMockTarget } from "@populace/mock-target";
import { ScriptedProvider, call, type ScriptContext, type ScriptPolicy } from "@populace/runner/testing";
import { SqliteStore } from "@populace/store-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureProject, ensureSettings, ensureSimulation, materialise, resolveSimulationConfig, seedProjectFromConfig } from "./config-store.js";
import type { IssuesClient } from "./deps.js";
import type { GithubFailure, GithubOutcome, IssueRef, MarkerSearch, RepoCheck } from "./github.js";
import { JobRunner } from "./jobs.js";
import { ProjectReadModel } from "./project-read-model.js";
import { reportIssuesWith } from "./report-cycle.js";
import { reportWindows, type ReportWindow } from "./report-windows.js";
import { RunController, type ReportHandle, type ReportTrigger } from "./runs.js";

/**
 * The AUTOMATIC triggers: the two paths by which a study files what it found with nobody pressing
 * anything.
 *
 * There are two because there have to be two. An ephemeral execution ENDS, and its end is a report
 * window boundary, so its report is the terminal flush in `drive()`. A longitudinal execution never
 * reaches a terminal status at all — it is paused and resumed, never finished — so the flush alone
 * would leave the study type the product's loop is built around with no automatic filing for its
 * whole life. Hence the report cycle, triggered from the visit that made it due.
 *
 * Everything here runs real visits against the in-process mock target with `ScriptedProvider`, and
 * a fake GitHub client where anything is filed at all. There is no `ANTHROPIC_API_KEY`, no
 * `TYPESAFE_API_KEY`, no token that reaches anything and no network.
 */

let target: RunningMockTarget;
beforeEach(async () => {
  target = await startMockTarget({ quiet: true });
});
afterEach(async () => {
  await target.close();
});

const P = "default";
const processConfig = { store: { kind: "sqlite" as const, path: ":memory:" }, digestDir: "digests" };

interface ConfigOptions {
  mode: "ephemeral" | "longitudinal";
  /** Null is a person who never runs out of visits, which is what longitudinal means. */
  visits: number | null;
  autoSweep?: boolean;
  /** Time is left far out of reach in most of these, so the VISIT trigger is what fires. */
  reportCycle?: { every?: string; jitter?: string; initialDelay?: string; everyVisits?: number | null };
  /**
   * `none` — nobody has an account, which is what most of these are about.
   *
   * `signup` is for the one question that cannot be asked without accounts: a finding carries the
   * identity that filed it, `replayFinding` refuses outright once that identity is torn down, and
   * an execution with no identities at all has nothing for a sweep to tear down and nothing for a
   * replay to refuse over. So the ordering test signs people up on the real mock target and lets
   * the sweep really delete the accounts.
   */
  identity?: "none" | "signup";
}

/**
 * One person, visiting the real mock target as fast as the tick loop will let them.
 *
 * `identity: none` by default — the account dance is not what most of this is about — and
 * `verifier.judge: heuristic`, so a digest inside a cycle spends nothing and needs no key.
 */
function config(options: ConfigOptions): PopulaceConfig {
  return PopulaceConfigSchema.parse({
    simulation: {
      id: "sim_triggers",
      slug: "triggers",
      name: "Triggers",
      mode: options.mode,
      visitsPerPerson: options.visits,
      autoSweep: options.autoSweep ?? false,
      ...(options.reportCycle ? { reportCycle: options.reportCycle } : {}),
    },
    target: { name: "Tasklet", mcp: [{ url: target.mcpUrl }], webBaseUrl: target.url, description: "Tasklet keeps your projects and tasks in one place." },
    identity:
      options.identity === "signup"
        ? { strategy: "self-signup", signupTool: "sign_up", tokenPath: "token", userIdPath: "user.id", teardownTool: "delete_account", emailDomain: "populace.test" }
        : { strategy: "none" },
    verifier: { judge: "heuristic" },
    daemon: { tick: "10ms", concurrency: 1 },
    population: {
      id: "tasklet",
      ...(options.visits === null ? {} : { maxWakes: options.visits }),
      cadence: { every: "10ms", jitter: "0s", initialDelay: "0s" },
      members: [{ persona: { id: "casual-lister", name: "Casey Morgan", role: "a list keeper", backstory: "keeps a list", goals: ["keep a list"] } }],
    },
  });
}

/** A visit that walks away for good, so a carry-forward brings nobody across. */
const quits: ScriptPolicy = () => ({ calls: [call("give_up", { title: "Not for me", reason: "Nope.", would_return: false, severity: "medium", evidence_calls: [] })] });

/** A visit that looks around, files one problem on its first pass, and comes back. */
function filing(): ScriptPolicy {
  let visits = 0;
  return (ctx: ScriptContext) => {
    if (ctx.turn === 1) {
      visits += 1;
      return { calls: [call("list_tasks", {})] };
    }
    if (ctx.turn === 2 && visits === 1) {
      return {
        calls: [
          call("file_finding", {
            kind: "bug",
            title: "search_tasks misses a task unless the capitals match",
            description: "This is what happened when I tried it.",
            expected: "It behaves the way the product says it does.",
            observed: "It did not.",
            severity: "high",
            confidence: 0.9,
            tool: "search_tasks",
            evidence_calls: [ctx.allResults[0]?.ref ?? ""],
          }),
        ],
      };
    }
    return { calls: [call("done", { summary: "that is what I found", would_return: true })] };
  };
}

/**
 * The same visit, for a target where everybody has to make an account first.
 *
 * The credentials come out of the visit context, where the runner suggests them, exactly as a real
 * participant reads them — and signing up mid-visit is what puts an `identityId` on the report
 * filed afterwards, which is the whole reason this script exists: a report that names no identity
 * replays as nobody and never reaches the refusal a torn-down account produces.
 */
function signsUpAndFiles(): ScriptPolicy {
  let filed = false;
  return (ctx: ScriptContext) => {
    const suggested = /email (\S+), display name "([^"]+)", password (\S+)/.exec(ctx.wakeContext);
    // The runner suggests credentials only while the participant has no account, so this signs up
    // on the first visit and looks around on every one after it.
    if (ctx.turn === 1 && suggested) return { calls: [call("sign_up", { email: suggested[1] ?? "", displayName: suggested[2] ?? "", password: suggested[3] ?? "" })] };
    if (ctx.turn <= 2) return { calls: [call("list_tasks", {})] };
    // The evidence is the LAST call — the look around, never the sign-up. A replay re-issues the
    // recorded arguments verbatim, so evidence pointing at `sign_up` would have the verifier make
    // a second account every time it checked.
    const evidence = ctx.lastResults[0]?.ref ?? "";
    if (!filed && evidence !== "") {
      filed = true;
      return {
        calls: [
          call("file_finding", {
            kind: "bug",
            title: "search_tasks misses a task unless the capitals match",
            description: "This is what happened when I tried it.",
            expected: "It behaves the way the product says it does.",
            observed: "It did not.",
            severity: "high",
            confidence: 0.9,
            tool: "search_tasks",
            evidence_calls: [evidence],
          }),
        ],
      };
    }
    return { calls: [call("done", { summary: "that is what I found", would_return: true })] };
  };
}

// ---- the doubles -----------------------------------------------------------

/** What a trigger asked for, and what the run row looked like at the moment it asked. */
interface Asked {
  runId: string;
  trigger: ReportTrigger;
  /** Null unless the sweep had already run by the time the report was asked for. */
  sweptAt: string | null;
}

/**
 * A report that records what it was asked and hands back a handle the test controls.
 *
 * The handle is the point. `RunController` holds `finished` as its skip-never-stack flag, so a
 * cycle is "in flight" for exactly as long as this test leaves it unresolved — which is how "a
 * second cycle is skipped, not stacked" is asserted without a real queue.
 */
class FakeReport {
  readonly asked: Asked[] = [];
  private readonly releases: (() => void)[] = [];
  /** Set to make the report throw where a publish would, which must not fail the run. */
  throws = false;

  readonly report = async (run: Run, trigger: ReportTrigger): Promise<ReportHandle> => {
    // Read fresh, not off the row passed in: `autoSweep` stamps `sweptAt`, so this is what proves
    // the flush was asked for BEFORE the accounts went.
    const row = await this.store.getRun(run.id);
    this.asked.push({ runId: run.id, trigger, sweptAt: row?.sweptAt ?? null });
    if (this.throws) throw new Error("github.com said no");
    return {
      finished: new Promise<void>((resolve) => {
        this.releases.push(resolve);
      }),
    };
  };

  constructor(private readonly store: Store) {}

  /** Lets every cycle asked for so far finish, which re-arms the trigger. */
  releaseAll(): void {
    for (const release of this.releases.splice(0)) release();
  }
}

interface Created {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

/**
 * The smallest GitHub that can answer a whole publish, and it reaches nothing.
 *
 * Typed `implements IssuesClient`, which is the shape a route or a cycle builds from a connection:
 * a method renamed or widened on the real client is a compile error here rather than a test that
 * goes on passing against an interface nothing uses any more.
 */
/**
 * What a repository says when populace asks it to open an issue and it will not.
 *
 * Worded as an unrecoverable refusal rather than a rate limit on purpose, because that is the
 * shape that used to wedge the state machine for good: retrying it next cycle fails the same way.
 * It carries none of the four words and none of the forbidden verdict words, since it ends up in
 * a job label a person reads.
 */
const REFUSED_CREATE = "the repository would not take a new issue: somebody has turned issues off for it";

class FakeGithub implements IssuesClient {
  readonly created: Created[] = [];
  labelled = 0;
  /** Creates to refuse before any are accepted, for the pass that must not be fatal. */
  refuseCreates = 0;

  ensureLabels(labels: readonly string[]): Promise<GithubOutcome<{ created: string[]; existing: string[] }>> {
    this.labelled += 1;
    return Promise.resolve({ ok: true, created: [...labels], existing: [] });
  }

  /** Never reached here — the cycle files, and only the check asks what a repository is. */
  getRepo(): Promise<RepoCheck> {
    return Promise.resolve({ outcome: "ready", detail: "a private repository", visibility: "private", expiresAt: null });
  }

  createIssue(input: { title: string; body: string; labels: readonly string[] }): Promise<GithubOutcome<{ issue: IssueRef }>> {
    if (this.refuseCreates > 0) {
      this.refuseCreates -= 1;
      return Promise.resolve({ ok: false, code: "no-issues", message: REFUSED_CREATE, status: 410 });
    }
    const number = this.created.length + 1;
    this.created.push({ number, title: input.title, body: input.body, labels: [...input.labels] });
    return Promise.resolve({ ok: true, issue: this.ref(number) });
  }

  getIssue(number: number): Promise<GithubOutcome<{ issue: IssueRef }>> {
    return Promise.resolve({ ok: true, issue: this.ref(number) });
  }

  addComment(number: number): Promise<GithubOutcome<{ id: number; url: string }>> {
    return Promise.resolve({ ok: true, id: 1, url: `https://github.test/acme/tasklet/issues/${String(number)}#c1` });
  }

  reopenIssue(number: number): Promise<GithubOutcome<{ issue: IssueRef }>> {
    return Promise.resolve({ ok: true, issue: this.ref(number) });
  }

  searchIssues(marker: string): Promise<MarkerSearch> {
    const hit = this.created.find((issue) => issue.body.includes(marker));
    return Promise.resolve(hit === undefined ? { outcome: "none" } : { outcome: "found", issues: [this.ref(hit.number)] });
  }

  outOfTime(): GithubFailure | null {
    return null;
  }

  private ref(number: number): IssueRef {
    return { number, url: `https://github.test/acme/tasklet/issues/${String(number)}`, state: "open", createdAt: new Date().toISOString() };
  }
}

/**
 * A store that can be made to fail `reconcile()`, which is the only await inside `daemon.run()`
 * that is not wrapped in a try/catch — and therefore the only way a run reaches `failed` at all.
 *
 * It is armed rather than broken from the start because the `failed` case has to be tested on a
 * run that HAS visits behind it: with none, the flush is skipped for being over an empty window
 * and the test would pass without ever exercising the status guard. So: run, pause, arm, resume —
 * the resume's own reconcile is let through and `run()`'s is the one that throws.
 *
 * (A tick's errors are caught and logged, and the `listAgents({ status: "active" })` at the top of
 * the daemon's loop is neither caught nor awaited by `run()`, so breaking that one produces an
 * unhandled rejection and a run that never settles rather than a failed one.)
 */
class BreakableStore extends SqliteStore {
  /** Reconciles to let through before throwing. Null disarms it. */
  letThrough: number | null = null;

  override async listAgents(filter: AgentQuery): Promise<Agent[]> {
    // `reconcile()` asks for every agent of the run with no status filter, exactly once; the
    // daemon's loop asks with `status: "active"`. Only the first is a reconcile.
    if (this.letThrough !== null && filter.status === undefined) {
      if (this.letThrough <= 0) throw new Error("the database went away");
      this.letThrough -= 1;
    }
    return super.listAgents(filter);
  }
}

// ---- the harness -----------------------------------------------------------

interface Harness {
  store: Store;
  /** The same store, for the one test that has to make a reconcile fail. */
  breakable: BreakableStore;
  study: Simulation;
  runs: RunController;
  reports: FakeReport;
  github: FakeGithub;
  jobs: JobRunner;
  config: PopulaceConfig;
  start(): Promise<Run>;
  close(): Promise<void>;
}

async function harness(options: ConfigOptions & { connect?: false | { autoFile: boolean }; real?: boolean; script?: ScriptPolicy }): Promise<Harness> {
  const breakable = new BreakableStore(":memory:");
  const store: Store = breakable;
  const cfg = config(options);
  await ensureProject(store);
  await ensureSettings(store);
  await seedProjectFromConfig(store, cfg);
  /*
   * The ROW is what a run resolves its config from (ADR-0025), and `ensureSimulation` writes one
   * with `SimulationSchema`'s own defaults — `autoSweep: true`, the default report cycle — not with
   * the knobs on the config above, which only seeded the target and the population. So the study
   * is written explicitly here; without it these tests would assert the defaults' behaviour under
   * the names of their own options, which is how one of them passed while asserting the opposite.
   */
  const seeded = await ensureSimulation(store);
  const study: Simulation = {
    ...seeded,
    mode: options.mode,
    visitsPerPerson: options.visits,
    autoSweep: options.autoSweep ?? false,
    ...(options.reportCycle ? { reportCycle: ReportCycleSchema.parse(options.reportCycle) } : {}),
  };
  await store.saveSimulation(study);
  await materialise(store, study.id);
  const provider = new ScriptedProvider(options.script ?? filing());
  const reports = new FakeReport(store);
  const github = new FakeGithub();
  const jobs = new JobRunner(store);
  const readModel = new ProjectReadModel(store);

  // The REAL enqueuer, with a fake client, for the one test that proves the wiring. Everywhere
  // else the fake report is what is asserted, because the guards are what those tests are about.
  const real = reportIssuesWith({
    store,
    jobs,
    readModel,
    configForRun: async (runId: string) => {
      const run = await store.getRun(runId);
      if (!run) throw new Error(`no run ${runId}`);
      return (await resolveSimulationConfig(store, processConfig, run.simulationId)).config;
    },
    hasApiKey: () => false,
    githubClient: () => github,
  });

  const runs = new RunController({
    store,
    provider: () => provider,
    resolve: async (simulationId: string) => (await resolveSimulationConfig(store, processConfig, simulationId)).config,
    materialise: (simulationId: string) => materialise(store, simulationId),
    reportIssues: options.real === true ? real : reports.report,
  });

  if (options.connect !== false) {
    const at = new Date().toISOString();
    await store.saveGithubConnection(
      GithubConnectionSchema.parse({
        projectId: P,
        repo: "acme/tasklet",
        token: "ghp_abcdefghijklmnopqrstuvwxyz",
        visibility: "private",
        autoFile: options.connect?.autoFile ?? true,
        createdAt: at,
        updatedAt: at,
      }),
    );
  }

  return {
    store,
    breakable,
    study,
    runs,
    reports,
    github,
    jobs,
    config: cfg,
    start: async () => {
      const resolved = await resolveSimulationConfig(store, processConfig, study.id);
      return runs.start({ config: resolved.config, projectId: P, simulationId: study.id, targetId: resolved.target.id, label: "execution" });
    },
    close: async () => {
      reports.releaseAll();
      await runs.shutdown();
      await store.setKillSwitch(false, "");
      await store.close();
    },
  };
}

/**
 * The real enqueuer, built after a run has already settled, for the tests that are about what the
 * DIGEST half does rather than about what the trigger decided.
 *
 * `hasApiKey: () => false` is the truth of this whole suite — nothing in it holds a model key —
 * which is exactly the condition the digest's pre-flight exists to catch, so it is a real input
 * here rather than a convenience.
 */
function realReport(h: Harness): (run: Run, trigger: ReportTrigger) => Promise<ReportHandle> {
  return reportIssuesWith({
    store: h.store,
    jobs: h.jobs,
    readModel: new ProjectReadModel(h.store),
    configForRun: async (runId: string) => (await resolveSimulationConfig(h.store, processConfig, (await h.store.getRun(runId))?.simulationId ?? "")).config,
    hasApiKey: () => false,
    githubClient: () => h.github,
  });
}

/** The run row a report is asked about, read back rather than remembered. */
async function rowOf(h: Harness, runId: string): Promise<Run> {
  const run = await h.store.getRun(runId);
  if (run === undefined) throw new Error("the run row went away");
  return run;
}

/** Points the project's judge at a credential this process does not have. */
async function judgeBy(h: Harness, judge: "model" | "typesafe" | "heuristic"): Promise<void> {
  const settings = await h.store.getSettings(P);
  if (settings === undefined) throw new Error("the project has no settings");
  await h.store.saveSettings({ ...settings, verifier: { ...settings.verifier, judge } });
}

/** Polls a condition rather than sleeping for a guessed interval. */
async function until(what: () => Promise<boolean> | boolean, why: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await what()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${why}`);
}

const visitCount = async (h: Harness, runId: string): Promise<number> => (await h.store.listWakes({ runIds: [runId] })).length;

/**
 * The report windows of the whole study, read the way the publisher reads them.
 *
 * This is what "closed a window" means in the only terms that matter: a succeeded `issues.cycle`
 * with an end time inside a running execution splits that execution in two, and every later cycle
 * then reports over the newer half. Asserted through `reportWindows` rather than through the job
 * row alone, because it is the arithmetic that decides whether a stretch of time gets reported on
 * twice — and re-reporting the same stretch is re-commenting on every issue in it.
 */
async function windowsOf(h: Harness): Promise<ReportWindow[]> {
  const runs = await h.store.listRuns({ simulationId: h.study.id });
  const runIds = runs.map((run) => run.id);
  const wakes = await h.store.listWakes({ runIds });
  const findings = await h.store.listFindings({ runIds });
  const jobs = (await Promise.all(runIds.map((runId) => h.store.listJobs({ runId })))).flat();
  return reportWindows({ runs, wakes, findings, jobs });
}

/**
 * Visits that have FINISHED, which is what the flush counts.
 *
 * The guard reads `daemon.wakesRun`, and that counter is incremented when a visit completes, while
 * the row appears when it starts. Waiting on the row is therefore not enough: a stop taken between
 * the two leaves the counter at nought, and a test that waited on the row alone would pass the
 * status assertions below for the wrong reason — the empty-window guard rather than the status one.
 */
const endedVisitCount = async (h: Harness, runId: string): Promise<number> => (await h.store.listWakes({ runIds: [runId] })).filter((wake) => wake.endedAt !== null).length;

// ---- the terminal flush ----------------------------------------------------

describe("an execution that has ended", () => {
  it("files what it found once it completes", async () => {
    const h = await harness({ mode: "ephemeral", visits: 1 });
    const run = await h.start();
    await h.runs.settled(run.id);

    expect((await h.store.getRun(run.id))?.status).toBe("completed");
    expect(h.reports.asked).toHaveLength(1);
    expect(h.reports.asked[0]?.trigger.because).toBe("final");
    await h.close();
  });

  it("is offered the teardown, and sweeps itself when the report hands it back", async () => {
    /*
     * The FALLBACK half of the ordering, and it is named for what it actually checks.
     *
     * A report that takes the teardown on puts it on the queue behind its own jobs, which is the
     * test below in "the jobs a report is made of" and is the only place the ordering is really
     * guaranteed. This fake hands it straight back — `ReportHandle.sweeps` is absent — so the
     * controller sweeps itself, which is every process that files nowhere. All this asserts is
     * that it does: the report was asked first, the accounts were still there when it was asked,
     * and they are gone afterwards.
     */
    const h = await harness({ mode: "ephemeral", visits: 1, autoSweep: true });
    const run = await h.start();
    await h.runs.settled(run.id);

    expect(h.reports.asked).toHaveLength(1);
    expect(h.reports.asked[0]?.sweptAt).toBeNull();
    expect(h.reports.asked[0]?.trigger.sweeping).toBe(true);
    // The teardown itself was handed over, or a report that wanted to order it could not.
    expect(typeof h.reports.asked[0]?.trigger.sweep).toBe("function");
    // And the sweep did happen, or the assertion above would pass for the wrong reason.
    expect((await h.store.getRun(run.id))?.sweptAt).not.toBeNull();
    await h.close();
  });

  it("says nothing about sweeping when the accounts are being left alone", async () => {
    const h = await harness({ mode: "ephemeral", visits: 1, autoSweep: false });
    const run = await h.start();
    await h.runs.settled(run.id);
    expect(h.reports.asked[0]?.trigger.sweeping).toBe(false);
    await h.close();
  });

  it("files nothing when the execution was paused", async () => {
    // A drain somebody asked for: the participants still have visits left and the execution can be
    // picked back up, so its last window is not over.
    const h = await harness({ mode: "ephemeral", visits: 6 });
    const run = await h.start();
    await until(async () => (await endedVisitCount(h, run.id)) >= 1, "a visit to finish");
    await h.runs.stop(run.id, "drain");

    expect((await h.store.getRun(run.id))?.status).toBe("paused");
    expect(h.reports.asked).toEqual([]);
    await h.close();
  });

  it("files nothing when the execution was stopped outright", async () => {
    // The kill switch is the one state in which populace should be doing nothing at all.
    const h = await harness({ mode: "ephemeral", visits: 6 });
    const run = await h.start();
    await until(async () => (await endedVisitCount(h, run.id)) >= 1, "a visit to finish");
    await h.runs.stop(run.id, "now");

    expect((await h.store.getRun(run.id))?.status).toBe("killed");
    expect(h.reports.asked).toEqual([]);
    await h.close();
  });

  it("files nothing when the execution failed", async () => {
    /*
     * A failure is not evidence of anything about the product under study.
     *
     * Worth being straight about what this test does and does not pin down. `run()` rejects only
     * at its own `reconcile()`, which happens before any visit of THAT daemon — so a failed run's
     * visit counter is nought whichever way it failed, and the empty-window guard would stop the
     * flush even if the status guard did not. The two paused and killed cases above are the ones
     * that hold the status guard in place; this one records the intent for the third.
     */
    const h = await harness({ mode: "ephemeral", visits: 6 });
    const run = await h.start();
    await until(async () => (await endedVisitCount(h, run.id)) >= 1, "a visit to finish");
    await h.runs.stop(run.id, "drain");
    expect(h.reports.asked).toEqual([]);

    h.breakable.letThrough = 1;
    await h.runs.resume(run.id);
    await h.runs.settled(run.id);
    h.breakable.letThrough = null;

    expect((await h.store.getRun(run.id))?.status).toBe("failed");
    expect(await visitCount(h, run.id)).toBeGreaterThan(0);
    expect(h.reports.asked).toEqual([]);
    await h.close();
  });

  it("files nothing when nobody visited", async () => {
    // A report over a window nobody visited is two jobs on a serial queue to say nothing:
    // `signatureHistories` reads an unvisited window as no evidence either way, which is correct
    // and useless. The reachable shape of that is a carry-forward of an execution everybody walked
    // away from saying they would not be back — nobody comes across, so nobody visits.
    const h = await harness({ mode: "ephemeral", visits: 1, script: quits });
    const parent = await h.start();
    await h.runs.settled(parent.id);
    expect(h.reports.asked).toHaveLength(1);

    const resolved = await resolveSimulationConfig(h.store, processConfig, h.study.id);
    const child = await h.runs.start({ config: resolved.config, projectId: P, simulationId: h.study.id, targetId: resolved.target.id, label: "again", continueFrom: parent.id, continuationReason: "after a fix" });
    await h.runs.settled(child.id);

    expect((await h.store.getRun(child.id))?.status).toBe("completed");
    expect(await visitCount(h, child.id)).toBe(0);
    expect(h.reports.asked.map((asked) => asked.runId)).toEqual([parent.id]);
    await h.close();
  });

  it("files nothing when the project has no repository", async () => {
    const h = await harness({ mode: "ephemeral", visits: 1, connect: false });
    const run = await h.start();
    await h.runs.settled(run.id);

    expect((await h.store.getRun(run.id))?.status).toBe("completed");
    expect(h.reports.asked).toEqual([]);
    await h.close();
  });

  it("files nothing when nobody asked for automatic filing", async () => {
    // `autoFile` defaults to off: a token being pasted is not a request to write to somebody's
    // repository on every completion.
    const h = await harness({ mode: "ephemeral", visits: 1, connect: { autoFile: false } });
    const run = await h.start();
    await h.runs.settled(run.id);

    expect((await h.store.getRun(run.id))?.status).toBe("completed");
    expect(h.reports.asked).toEqual([]);
    await h.close();
  });

  it("settles the execution normally when the filing throws", async () => {
    // An escaping throw would reject `entry.finished`, which is what `stop()` and `shutdown()`
    // await: a failed publish would arrive as a 500 on the stop request.
    const h = await harness({ mode: "ephemeral", visits: 1 });
    h.reports.throws = true;
    const run = await h.start();
    await expect(h.runs.settled(run.id)).resolves.toBeUndefined();

    const settled = await h.store.getRun(run.id);
    expect(settled?.status).toBe("completed");
    expect(settled?.endedAt).not.toBeNull();
    await h.close();
  });
});

// ---- the report cycle ------------------------------------------------------

describe("a longitudinal execution, which never ends", () => {
  it("reports when the visit count crosses the threshold, and does not stack a second", async () => {
    const h = await harness({
      mode: "longitudinal",
      visits: null,
      // The clock is put out of reach BOTH ways — the first deadline a day out and every one after
      // it a day apart — so what fires here can only be the visit count.
      reportCycle: { every: "24h", jitter: "0s", initialDelay: "24h", everyVisits: 2 },
    });
    const run = await h.start();

    await until(() => h.reports.asked.length >= 1, "the first report cycle");
    expect(h.reports.asked[0]?.trigger).toEqual({ because: "visits", sweeping: false });

    // The first cycle is still in flight — the fake has not resolved it — so every visit that
    // lands from here must be counted and none of them may ask for a second one. The queue is a
    // strictly serial FIFO, so a stacked cycle would sit in front of every sweep and target check.
    const at = await visitCount(h, run.id);
    await until(async () => (await visitCount(h, run.id)) >= at + 6, "six more visits");
    expect(h.reports.asked).toHaveLength(1);

    // Let it finish, and the trigger re-arms.
    h.reports.releaseAll();
    await until(() => h.reports.asked.length >= 2, "the next report cycle");
    expect(h.reports.asked[1]?.trigger.because).toBe("visits");
    // Never `final`: a longitudinal execution does not end, and this one is still going.
    expect(h.reports.asked.every((asked) => asked.trigger.because !== "final")).toBe(true);
    expect(h.runs.isRunning(run.id)).toBe(true);

    await h.runs.stop(run.id, "drain");
    await h.close();
  });

  it("reports on the clock too, when no visit count is set", async () => {
    // `everyVisits: null` leaves time as the only trigger, and `initialDelay: 0` means the first
    // window closes as soon as it has something in it — which is a visit, because a window nobody
    // visited says nothing either way and there is no timer anywhere to ask on its behalf.
    const h = await harness({ mode: "longitudinal", visits: null, reportCycle: { every: "24h", jitter: "0s", initialDelay: "0s", everyVisits: null } });
    const run = await h.start();
    await until(() => h.reports.asked.length >= 1, "the first report cycle");
    expect(h.reports.asked[0]?.trigger.because).toBe("elapsed");
    await h.runs.stop(run.id, "drain");
    await h.close();
  });

  it("scatters the first deadline by the jitter, so two studies do not report in lockstep", async () => {
    // Commit f03c5f1, "zero jitter is a herd", and it matters more here than for a person: a cycle
    // is two jobs on a strictly serial FIFO, so two runs reporting together queue behind each other
    // and delay every sweep and target check sitting there. A deadline computed without the jitter
    // would be the run's own start, and the first visit would close the window immediately.
    const h = await harness({ mode: "longitudinal", visits: null, reportCycle: { every: "24h", jitter: "24h", initialDelay: "0s", everyVisits: null } });
    const run = await h.start();
    await until(async () => (await visitCount(h, run.id)) >= 8, "eight visits");
    expect(h.reports.asked).toEqual([]);
    await h.runs.stop(run.id, "drain");
    await h.close();
  });

  it("reports nothing with no repository to report into, however many visits land", async () => {
    const h = await harness({ mode: "longitudinal", visits: null, connect: false, reportCycle: { every: "24h", jitter: "0s", everyVisits: 1 } });
    const run = await h.start();
    await until(async () => (await visitCount(h, run.id)) >= 5, "five visits");
    expect(h.reports.asked).toEqual([]);
    await h.runs.stop(run.id, "drain");
    await h.close();
  });

  it("keeps visiting when a cycle throws", async () => {
    // `configForRun` throws when the live credentials behind a snapshot cannot be restored, which
    // is a state a long-lived study reaches by somebody deleting a target. It must not end the run.
    const h = await harness({ mode: "longitudinal", visits: null, reportCycle: { every: "24h", jitter: "0s", everyVisits: 1 } });
    h.reports.throws = true;
    const run = await h.start();
    await until(() => h.reports.asked.length >= 2, "two attempts");
    expect(h.runs.isRunning(run.id)).toBe(true);
    expect((await h.store.getRun(run.id))?.status).toBe("running");
    await h.runs.stop(run.id, "drain");
    await h.close();
  });

  it("arms no cycle for an ephemeral execution, which has the flush instead", async () => {
    const h = await harness({ mode: "ephemeral", visits: 4, reportCycle: { every: "24h", jitter: "0s", everyVisits: 1 } });
    const run = await h.start();
    await h.runs.settled(run.id);
    // Four visits and a threshold of one: a cycle would have fired three times before the end.
    expect(await visitCount(h, run.id)).toBe(4);
    expect(h.reports.asked.map((asked) => asked.trigger.because)).toEqual(["final"]);
    await h.close();
  });
});

// ---- what the trigger actually enqueues ------------------------------------

describe("the jobs a report is made of", () => {
  it("is a digest and then a filing, and the filing carries the kind a window boundary is read off", async () => {
    const h = await harness({ mode: "ephemeral", visits: 1, real: true });
    const run = await h.start();
    await h.runs.settled(run.id);
    await h.jobs.idle();

    const jobs = await h.store.listJobs({ runId: run.id });
    const digest = jobs.find((job) => job.kind === "digest");
    const boundary = jobs.find((job) => job.kind === "issues.cycle");
    expect(digest).not.toBeUndefined();
    expect(boundary).not.toBeUndefined();
    if (digest === undefined || boundary === undefined) throw new Error("the report enqueued neither half");
    expect([digest.status, boundary.status]).toEqual(["succeeded", "succeeded"]);
    // Both name the project, or `costSince({ projectId })` cannot see what an unattended loop
    // spends — and both name the run, or the boundary is never in `listJobs({ runId })` and the
    // next cycle reports over the same stretch of time again.
    expect([digest.projectId, boundary.projectId]).toEqual([P, P]);
    expect([digest.runId, boundary.runId]).toEqual([run.id, run.id]);
    // Asserted as "the digest had ENDED before the filing STARTED" rather than off the row order,
    // because that is the property: verification lives only in the digest, so a filing that ran
    // first would file nothing at all for a connection set to `onlyConfirmed`.
    expect(digest.endedAt).not.toBeNull();
    expect(boundary.startedAt).not.toBeNull();
    expect(boundary.endedAt).not.toBeNull();
    if (digest.endedAt === null || boundary.startedAt === null) throw new Error("a half of the report never ran");
    expect(Date.parse(digest.endedAt) <= Date.parse(boundary.startedAt)).toBe(true);

    // And it actually filed, which is the only proof the two halves were in the right order and
    // that the publisher was reachable at all.
    expect(h.github.created).toHaveLength(1);
    expect(h.github.created[0]?.title).toContain("search_tasks");

    const filed = await h.store.listFiledIssues(P);
    expect(filed).toHaveLength(1);
    expect(JSON.stringify(filed)).not.toContain("ghp_");

    // The labels the queue shows a person carry none of the four banned words, and no promise
    // about repeatability or a fix.
    const labels = jobs.map((job) => job.progress.label).join(" | ");
    for (const banned of ["agent", "wake", "simulation", "lane", "fixed", "verified", "resolved", "no longer reproducible"]) {
      expect(labels.toLowerCase()).not.toContain(banned);
    }
    await h.close();
  });

  it("says in the label that the accounts are going, when they are", async () => {
    const h = await harness({ mode: "ephemeral", visits: 1, autoSweep: true, real: true });
    const run = await h.start();
    await h.runs.settled(run.id);
    await h.jobs.idle();

    const digest = (await h.store.listJobs({ runId: run.id })).find((job) => job.kind === "digest");
    // The teardown is now a job BEHIND this one, so the true sentence is the other one: this pass
    // did its checking with the accounts alive, and what will not be possible is checking again.
    // Neither wording says anything about whether a problem is still there.
    expect(digest?.progress.label).toContain("the accounts are removed next");
    expect(digest?.progress.label).not.toContain("being removed now");
    await h.close();
  });

  /**
   * The two guards the cycle shares with the button, and the reason they are ONE function.
   *
   * `runDigest` lives in `control.ts` and both the route and the cycle call it. It used to be
   * written out in each, with a comment saying the two copies had to be kept in step — which is
   * the arrangement that eventually diverges. These two tests are the cycle's half of the proof:
   * whatever the route enforces, the clock enforces, because it is the same code.
   *
   * The clock is the side that matters more. A button press with no ceiling over it is a mistake
   * somebody notices once; a report cycle with no ceiling over it is a study spending by itself
   * for as long as it runs.
   */
  it("refuses the digest rather than spending past the project's daily ceiling", async () => {
    const h = await harness({ mode: "ephemeral", visits: 1, real: true });
    const run = await h.start();
    await h.runs.settled(run.id);
    await h.jobs.idle();

    const spent: Job = {
      id: "job_spent",
      kind: "digest",
      status: "succeeded",
      projectId: P,
      runId: run.id,
      costUsd: 1_000,
      progress: { done: 1, total: 1, label: "" },
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    };
    await h.store.saveJob(spent);

    await realReport(h)(await rowOf(h, run.id), { because: "final", sweeping: false });
    await h.jobs.idle();

    const digests = (await h.store.listJobs({ runId: run.id })).filter((job) => job.kind === "digest" && job.id !== spent.id);
    const failed = digests.find((job) => job.status === "failed");
    expect(failed?.error).toContain("ceiling");
    // Refused rather than trimmed, and refused before anything was spent: a cycle that quietly
    // checked half of what was asked for is a bill nobody can account for.
    expect(failed?.costUsd).toBe(0);
    await h.close();
  });

  it("refuses the digest when the configured judge has no key, rather than checking with the free one", async () => {
    const h = await harness({ mode: "ephemeral", visits: 1, real: true });
    const run = await h.start();
    await h.runs.settled(run.id);
    await h.jobs.idle();

    // The project asks for the model judge and this process has no key. Never a silent downgrade:
    // the judge decides what reaches the digest, so checking with the weak one answers a different
    // question than the one that was configured.
    await judgeBy(h, "model");
    for (const finding of await h.store.listFindings({ runIds: [run.id] })) await h.store.saveFinding({ ...finding, verification: null });

    await realReport(h)(await rowOf(h, run.id), { because: "visits", sweeping: false });
    await h.jobs.idle();

    const failed = (await h.store.listJobs({ runId: run.id })).find((job) => job.kind === "digest" && job.status === "failed");
    expect(failed?.error).toContain("ANTHROPIC_API_KEY");
    expect(failed?.costUsd).toBe(0);
    const findings = await h.store.listFindings({ runIds: [run.id] });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.verification === null)).toBe(true);
    await h.close();
  });
});

// ---- what a cycle survives, and what it must not ---------------------------

/**
 * The difference between "some problems could not be filed" and "this cycle did not happen", which
 * is the difference between a line on a live feed and a study that never reports again.
 *
 * A succeeded `issues.cycle` with an end time is the ONE thing that closes a report window
 * (`report-windows.ts`), so failing the job on a per-problem failure wedges the state machine for
 * the life of the study: the window never closes, every later cycle reports over the same stretch
 * of time again and comments again on every issue in it, and nothing on the dashboard can clear
 * it. The failures that matter are unrecoverable, not transient — a developer deleting an issue
 * populace filed is the ordinary one, and the ledger row still names the issue that is gone, so
 * the next pass fails on it too.
 */
describe("a cycle that ran but could not file everything", () => {
  it("succeeds, closes its window, and names what did not go", async () => {
    /*
     * Longitudinal, because that is where a window boundary is observable at all: a boundary at or
     * after a FINISHED execution's end closes the last window rather than opening a new one, which
     * is what keeps an ephemeral study reported once per execution identical to today.
     *
     * The cycle is driven by hand rather than by the visit trigger, and the clock and the visit
     * count are both left out of reach so nothing fires on its own. That is not convenience: with
     * the trigger armed, a second cycle lands behind the first and whether it refiles the refused
     * problem depends on whether a visit happened to land in the window the first cycle opened.
     * One cycle, one create, one boundary — the thing being asserted has no race in it.
     */
    const h = await harness({ mode: "longitudinal", visits: null, reportCycle: { every: "24h", jitter: "0s", initialDelay: "24h", everyVisits: null } });
    const run = await h.start();
    await until(async () => (await h.store.listFindings({ runIds: [run.id] })).length >= 1, "a problem to be reported");
    expect(h.reports.asked).toEqual([]);
    const before = (await windowsOf(h)).length;

    // One refusal, which is the unrecoverable shape: retrying it next cycle fails the same way.
    h.github.refuseCreates = 1;
    await realReport(h)(await rowOf(h, run.id), { because: "visits", sweeping: false });
    await h.jobs.idle();

    const cycle = (await h.store.listJobs({ runId: run.id })).find((job) => job.kind === "issues.cycle");
    // Succeeded, with an end time: the two things a window boundary is read off.
    expect(cycle?.status).toBe("succeeded");
    expect(cycle?.endedAt).not.toBeNull();
    // The failure is not swallowed. It is named in the label, which is the field `JobProgress`
    // renders and the live feed carries — the row's `error` column belongs to the queue, which
    // writes it only for a handler that threw.
    expect(cycle?.progress.label).toContain("1 not filed");
    expect(cycle?.progress.label).toContain(REFUSED_CREATE);
    // Nothing was opened, so nothing can be claimed to have been.
    expect(h.github.created).toEqual([]);
    expect(await h.store.listFiledIssues(P)).toEqual([]);

    // And the window really closed: the execution is split in two, so the next cycle reports on
    // the newer half instead of going round the same stretch of time again and re-commenting on
    // every issue in it.
    expect((await windowsOf(h)).length).toBe(before + 1);

    await h.runs.stop(run.id, "drain");
    await h.close();
  });

  it("closes no window when the pass could not run at all", async () => {
    // Nothing automatic here: the clock is a day out both ways and no visit count is set, so the
    // only cycle is the one this test asks for by hand, on an execution that is still going.
    const h = await harness({ mode: "longitudinal", visits: null, reportCycle: { every: "24h", jitter: "0s", initialDelay: "24h", everyVisits: null } });
    const run = await h.start();
    await until(async () => (await endedVisitCount(h, run.id)) >= 1, "a visit to finish");
    expect(h.reports.asked).toEqual([]);
    const before = (await windowsOf(h)).length;

    /*
     * The global stop, engaged after the jobs are queued, which is the reachable shape: the queue
     * is a serial FIFO with no cancellation, so a cycle queued a moment before somebody pressed
     * the button is still sitting in it and each half has to refuse for itself.
     *
     * Both halves failing is the point twice over. It is finding 2 — the button stops the spending
     * and the writing, not only the visiting — and it is the other side of finding 1: a pass that
     * was refused before it wrote anything genuinely did not happen, so the stretch of time it
     * would have covered stays open for the next cycle rather than being silently skipped.
     */
    await h.store.setKillSwitch(true, "stopped from the dashboard");
    await realReport(h)(await rowOf(h, run.id), { because: "visits", sweeping: false });
    await h.jobs.idle();

    const jobs = await h.store.listJobs({ runId: run.id });
    const digest = jobs.find((job) => job.kind === "digest");
    const cycle = jobs.find((job) => job.kind === "issues.cycle");
    expect([digest?.status, cycle?.status]).toEqual(["failed", "failed"]);
    expect(digest?.error).toContain("everything is stopped");
    expect(cycle?.error).toContain("everything is stopped");
    // Refused before anything was spent and before anything was written.
    expect(digest?.costUsd).toBe(0);
    expect(h.github.created).toEqual([]);
    expect(h.github.labelled).toBe(0);
    expect(await h.store.listFiledIssues(P)).toEqual([]);
    expect((await windowsOf(h)).length).toBe(before);

    await h.runs.stop(run.id, "drain");
    await h.close();
  });
});

// ---- the global stop -------------------------------------------------------

describe("everything stopped", () => {
  it("asks for no report cycle, however many visits land", async () => {
    /*
     * The one control a user reaches for when something is wrong, and the hazard is that a killed
     * visit is still a visit as far as this trigger is concerned: `runWake` refuses at the door
     * and still writes its row and still fires `onWake`, so the question goes on being asked. Left
     * unguarded, cycles went on firing while the stop was engaged — digests spending model money
     * and replaying recorded calls against somebody's product, issues and comments going into
     * somebody's repository.
     *
     * The threshold is put high enough that no cycle can have been due in the moment between the
     * run starting and the switch going on: the visits that then cross it are all killed ones.
     */
    const h = await harness({ mode: "longitudinal", visits: null, reportCycle: { every: "24h", jitter: "0s", initialDelay: "24h", everyVisits: 25 } });
    const run = await h.start();
    await h.store.setKillSwitch(true, "stopped from the dashboard");

    await until(async () => (await h.store.listWakes({ runIds: [run.id] })).filter((wake) => wake.status === "killed").length >= 30, "thirty killed visits");
    expect(h.reports.asked).toEqual([]);
    expect(await h.store.listJobs({ runId: run.id })).toEqual([]);

    await h.runs.stop(run.id, "drain");
    await h.close();
  });
});

// ---- the teardown, and where it sits ---------------------------------------

describe("an ephemeral execution that removes its accounts", () => {
  it("puts the teardown behind the report, so the findings are checked while the accounts still exist", async () => {
    /*
     * The ordering this whole arrangement exists for, asserted where it is actually decided.
     *
     * "Report before the sweep" used to be written as "enqueue the report, then sweep", and those
     * are not the same thing: the flush only QUEUES a digest, so the sweep on the next line tore
     * the accounts down while the digest was still draining. `replayFinding` refuses outright once
     * an identity is torn down, so whether a verdict was a reading of the product or the sentence
     * "the account that filed this was removed" came down to which of two concurrent passes got
     * there first, with nothing on the outside saying which had happened.
     *
     * So the teardown is a `sweep` job enqueued third on the same strictly serial FIFO, and the
     * queue does the ordering. People sign up on the real mock target here because the question
     * cannot be asked without accounts: a report that names no identity replays as nobody and
     * never reaches the refusal at all.
     */
    const h = await harness({ mode: "ephemeral", visits: 1, autoSweep: true, identity: "signup", real: true, script: signsUpAndFiles() });
    const run = await h.start();
    await h.runs.settled(run.id);
    await h.jobs.idle();

    const jobs = await h.store.listJobs({ runId: run.id });
    const digest = jobs.find((job) => job.kind === "digest");
    const cycle = jobs.find((job) => job.kind === "issues.cycle");
    const sweep = jobs.find((job) => job.kind === "sweep");
    if (digest?.endedAt === undefined || digest.endedAt === null) throw new Error("the report enqueued no digest");
    if (cycle?.endedAt === undefined || cycle.endedAt === null) throw new Error("the report enqueued no filing");
    if (sweep?.startedAt === undefined || sweep.startedAt === null) throw new Error("the report did not put the teardown on the queue");
    expect([digest.status, cycle.status, sweep.status]).toEqual(["succeeded", "succeeded", "succeeded"]);
    // Structural, not hoped for: the queue ran them in the order they were enqueued.
    expect(Date.parse(digest.endedAt) <= Date.parse(sweep.startedAt)).toBe(true);
    expect(Date.parse(cycle.endedAt) <= Date.parse(sweep.startedAt)).toBe(true);
    expect(sweep.runId).toBe(run.id);
    expect(sweep.projectId).toBe(P);

    // The accounts did go — this is not the ordering bought by never sweeping — and they went
    // after the checking rather than alongside it.
    const identities = await h.store.listIdentitiesByTag(tagForRun(run.id), true);
    expect(identities.length).toBeGreaterThan(0);
    for (const identity of identities) {
      if (identity.tornDownAt === null) throw new Error(`the account ${identity.id} was never removed`);
      expect(Date.parse(identity.tornDownAt) >= Date.parse(digest.endedAt)).toBe(true);
    }
    expect((await h.store.getRun(run.id))?.sweptAt).not.toBeNull();

    // And so the verdicts are readings of the product rather than the refusal a removed account
    // produces, which is the whole reason the order matters.
    const findings = await h.store.listFindings({ runIds: [run.id] });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.identityId !== null)).toBe(true);
    expect(findings.every((finding) => finding.verification !== null)).toBe(true);
    expect(findings.map((finding) => finding.verification?.reason ?? "").join(" | ")).not.toContain("was removed");
    await h.close();
  });
});

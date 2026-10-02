import type { PublishIssuesSummary } from "@populace/contract";
import {
  FiledIssueSchema,
  GithubConnectionSchema,
  PopulaceConfigSchema,
  type Finding,
  type PopulaceConfig,
  type Run,
  type Simulation,
  type Store,
  type Verification,
  type Wake,
} from "@populace/core";
import { startMockTarget, type RunningMockTarget } from "@populace/mock-target";
import { ScriptedProvider, call, type ScriptContext, type ScriptPolicy } from "@populace/runner/testing";
import { SqliteStore } from "@populace/store-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureProject, ensureSettings, ensureSimulation, materialise, resolveSimulationConfig, seedProjectFromConfig } from "./config-store.js";
import type { GithubFailure, GithubOutcome, IssueRef, MarkerSearch } from "./github.js";
import { ProjectReadModel } from "./project-read-model.js";
import { IssuesNotConnected, markerFor, publishIssues, type IssueClient } from "./publish-issues.js";
import { reportWindows, type ReportWindow } from "./report-windows.js";
import { RunController } from "./runs.js";

/**
 * Filing a study's problems as issues, end to end and offline.
 *
 * Everything here runs real visits against the in-process mock target with `ScriptedProvider` and
 * a fake GitHub client, and asserts the ROWS and the OUTCOMES: which issues went out, which ledger
 * rows exist, which events were appended, and — the ones that matter most — what the copy does not
 * say. There is no `ANTHROPIC_API_KEY`, no token that reaches anything, and no network.
 *
 * The regression guard of the whole design is "the representative moves": a cluster's signature is
 * the representative of a clustering, `pickRepresentative` sorts on verdict score first, and the
 * digest writes verdicts after the run. So a filing keyed on it files the same problem twice inside
 * one execution. That test is below and it is the reason the ledger records a signature SET.
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

/**
 * One person who visits twice against the real mock target. `identity: none` deliberately: the
 * account dance is not what any of this is about, and a target call that comes back refused still
 * records a reproduction step, which is all the fix prompt needs.
 */
function config(webBaseUrl = target.url): PopulaceConfig {
  return PopulaceConfigSchema.parse({
    target: { name: "Tasklet", mcp: [{ url: target.mcpUrl }], webBaseUrl, description: "Tasklet keeps your projects and tasks in one place." },
    identity: { strategy: "none" },
    verifier: { judge: "heuristic" },
    daemon: { tick: "20ms", concurrency: 2 },
    population: {
      id: "tasklet",
      maxWakes: 2,
      cadence: { every: "20ms", jitter: "0s", initialDelay: "0s" },
      members: [{ persona: { id: "casual-lister", name: "Casey Morgan", role: "a list keeper", backstory: "keeps a list", goals: ["keep a list"] } }],
    },
  });
}

// ---- the problems the scripts file -----------------------------------------

interface Report {
  kind: "bug" | "coverage-gap" | "praise";
  title: string;
  tool: string;
  severity: "critical" | "high" | "medium" | "low";
}

/**
 * The mock target's four planted defects, in the words a person would use. Four different
 * `kind|tool` pairs, so the clusterer keeps them four problems rather than merging any two
 * (`packages/mock-target/README.md` documents the defects themselves).
 */
const SEARCH: Report = { kind: "bug", title: "search_tasks misses a task unless the capitals match", tool: "search_tasks", severity: "high" };
const DUE_DATE: Report = { kind: "bug", title: "update_task threw away the due date I gave it", tool: "update_task", severity: "critical" };
const PAGING: Report = { kind: "bug", title: "the second page of list_tasks repeats a row from the first", tool: "list_tasks", severity: "medium" };
const NO_DELETE: Report = { kind: "coverage-gap", title: "there is no tool for deleting a task, and the site says there is", tool: "delete_task", severity: "high" };
const PRAISE: Report = { kind: "praise", title: "signing up and making a first list took under a minute", tool: "create_task", severity: "low" };

/**
 * A visit that looks around once and then files each of `reports`, one per turn.
 *
 * `onlyFirstVisit` makes the people go on visiting and stop reporting, which is the shape the
 * reach numbers in a gone-quiet comment are counted off: a person who came back after the last
 * report and did not repeat it.
 */
function filing(reports: readonly Report[], options: { onlyFirstVisit?: boolean } = {}): ScriptPolicy {
  let visits = 0;
  return (ctx: ScriptContext) => {
    if (ctx.turn === 1) {
      visits += 1;
      return { calls: [call("list_tasks", {})] };
    }
    const report = options.onlyFirstVisit === true && visits > 1 ? undefined : reports[ctx.turn - 2];
    if (report === undefined) return { calls: [call("done", { summary: "that is what I found", would_return: true })] };
    return {
      calls: [
        call("file_finding", {
          kind: report.kind,
          title: report.title,
          description: "This is what happened when I tried it.",
          expected: "It behaves the way the product says it does.",
          observed: "It did not.",
          severity: report.severity,
          confidence: 0.9,
          tool: report.tool,
          evidence_calls: [ctx.allResults[0]?.ref ?? ""],
        }),
      ],
    };
  };
}

/** A visit that finds nothing worth reporting. */
const quiet: ScriptPolicy = () => ({ calls: [call("done", { summary: "all fine today", would_return: true })] });

// ---- the fake GitHub -------------------------------------------------------

interface Created {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

function refused(message: string): GithubFailure {
  return { ok: false, code: "refused", message, status: 422 };
}

/** When GitHub says an issue was opened, for the ledger row that must record its date and not ours. */
const OPENED_AT = "2026-05-01T09:12:33.000Z";

/**
 * GitHub, offline. It implements exactly the slice of `GithubClient` the publisher is typed
 * against, so an operation added there is a compile error here rather than a silent hole.
 */
class FakeGithub implements IssueClient {
  readonly created: Created[] = [];
  readonly comments: { number: number; body: string }[] = [];
  readonly reopened: number[] = [];
  readonly searched: string[] = [];
  readonly closed = new Set<number>();
  /** Creates from this one on (1-based) are refused, for the mid-batch failure. */
  refuseCreatesFrom: number | null = null;
  /** When set, every marker search answers `could-not-answer` with this rather than a result. */
  searchFailure: GithubFailure | null = null;
  /** When set, GitHub reports no creation date, which is the one case with no honest date to file under. */
  noCreationDate = false;
  /** When set, the pass's wall clock is spent after this many checks, which is one per problem. */
  outOfTimeAfter: number | null = null;
  labelled = 0;
  private next = 1;
  private clockChecks = 0;

  ensureLabels(labels: readonly string[]): Promise<GithubOutcome<{ created: string[]; existing: string[] }>> {
    this.labelled += 1;
    return Promise.resolve({ ok: true, created: [...labels], existing: [] });
  }

  createIssue(issue: { title: string; body: string; labels: readonly string[] }): Promise<GithubOutcome<{ issue: IssueRef }>> {
    if (this.refuseCreatesFrom !== null && this.created.length + 1 >= this.refuseCreatesFrom) {
      return Promise.resolve(refused("Validation failed: somebody's repository said no."));
    }
    const number = this.next++;
    this.created.push({ number, title: issue.title, body: issue.body, labels: [...issue.labels] });
    return Promise.resolve({ ok: true, issue: this.ref(number, "open") });
  }

  getIssue(number: number): Promise<GithubOutcome<{ issue: IssueRef }>> {
    return Promise.resolve({ ok: true, issue: this.ref(number, this.closed.has(number) ? "closed" : "open") });
  }

  addComment(number: number, body: string): Promise<GithubOutcome<{ id: number; url: string }>> {
    this.comments.push({ number, body });
    return Promise.resolve({ ok: true, id: this.comments.length, url: `https://github.test/acme/tasklet/issues/${String(number)}#c${String(this.comments.length)}` });
  }

  reopenIssue(number: number): Promise<GithubOutcome<{ issue: IssueRef }>> {
    this.reopened.push(number);
    this.closed.delete(number);
    return Promise.resolve({ ok: true, issue: this.ref(number, "open") });
  }

  searchIssues(marker: string): Promise<MarkerSearch> {
    this.searched.push(marker);
    if (this.searchFailure !== null) return Promise.resolve({ outcome: "could-not-answer", failure: this.searchFailure });
    const hit = this.created.find((issue) => issue.body.includes(marker));
    if (hit === undefined) return Promise.resolve({ outcome: "none" });
    return Promise.resolve({ outcome: "found", issues: [this.ref(hit.number, "open")] });
  }

  outOfTime(): GithubFailure | null {
    this.clockChecks += 1;
    if (this.outOfTimeAfter === null || this.clockChecks <= this.outOfTimeAfter) return null;
    return { ok: false, code: "rate-limited", message: "Filing stopped after 600 seconds: github.com is limiting this token. Whatever was filed before that is filed — the rest can be filed again later.", status: null };
  }

  private ref(number: number, state: "open" | "closed"): IssueRef {
    return { number, url: `https://github.test/acme/tasklet/issues/${String(number)}`, state, createdAt: this.noCreationDate ? null : OPENED_AT };
  }

  /** Everything this fake has written, for the vocabulary assertions. */
  everything(): string {
    return [...this.created.map((issue) => `${issue.title}\n${issue.body}`), ...this.comments.map((comment) => comment.body)].join("\n");
  }
}

// ---- the harness -----------------------------------------------------------

interface Studio {
  store: Store;
  study: Simulation;
  github: FakeGithub;
  /** The one the publisher is given, so a test can watch what it is asked for. */
  readModel: ProjectReadModel;
  /** What the next visit does. Reset between executions to say "we shipped something". */
  script(next: ScriptPolicy): void;
  run(): Promise<Run>;
  publish(signatures?: readonly string[]): Promise<PublishIssuesSummary>;
  close(): Promise<void>;
}

async function studio(options: {
  policy: ScriptPolicy;
  /** `unknown` is the DEFAULT of a real connection, which is why it is a case here and not an edge. */
  visibility?: "private" | "public" | "unknown";
  connect?: boolean;
  github?: FakeGithub;
  /** A web address on a host of its own, which is the case the reduction could not see. */
  webBaseUrl?: string;
}): Promise<Studio> {
  const store: Store = new SqliteStore(":memory:");
  await ensureProject(store);
  await ensureSettings(store);
  await seedProjectFromConfig(store, config(options.webBaseUrl));
  const study = await ensureSimulation(store);
  const readModel = new ProjectReadModel(store);
  const github = options.github ?? new FakeGithub();

  let policy = options.policy;
  const provider = new ScriptedProvider((ctx) => policy(ctx));
  const runs = new RunController({
    store,
    provider: () => provider,
    resolve: async (simulationId: string) => (await resolveSimulationConfig(store, processConfig, simulationId)).config,
    materialise: (simulationId: string) => materialise(store, simulationId),
  });

  if (options.connect !== false) {
    const at = new Date().toISOString();
    await store.saveGithubConnection(
      GithubConnectionSchema.parse({ projectId: P, repo: "acme/tasklet", token: "ghp_abcdefghijklmnopqrstuvwxyz", visibility: options.visibility ?? "private", createdAt: at, updatedAt: at }),
    );
  }

  return {
    store,
    study,
    github,
    readModel,
    script: (next) => {
      policy = next;
    },
    run: async () => {
      const resolved = await resolveSimulationConfig(store, processConfig, study.id);
      const run = await runs.start({ config: resolved.config, projectId: P, simulationId: study.id, targetId: resolved.target.id, label: "execution" });
      await runs.settled(run.id);
      return run;
    },
    publish: (signatures) => publishIssues({ simulation: study, ...(signatures === undefined ? {} : { signatures }) }, { store, readModel, client: () => github }),
    close: async () => {
      await runs.shutdown();
      await store.close();
    },
  };
}

/** The findings of one study, newest execution last. */
const findingsOf = async (h: Studio): Promise<Finding[]> => {
  const runs = await h.store.listRuns({ simulationId: h.study.id });
  return h.store.listFindings({ runIds: runs.map((run) => run.id) });
};

const signatureFor = async (h: Studio, title: string): Promise<string> => {
  const finding = (await findingsOf(h)).find((candidate) => candidate.title === title);
  if (!finding) throw new Error(`nothing filed with the title ${title}`);
  return finding.signature;
};

/**
 * A report cycle that closed a window inside one execution, which is the only way a study gets
 * more than one window per execution — and therefore the only way the longitudinal case is
 * reachable offline.
 *
 * A succeeded `issues.cycle` job with an end time is what closes a window (`report-windows.ts`),
 * and it closes it where the job ended, so the boundary goes a millisecond PAST the visit it is
 * meant to come after: that keeps the reports of that visit on the near side of it.
 */
const closeWindowAfter = async (h: Studio, runId: string, endedAt: string, id: string): Promise<void> => {
  await saveFinishedJob(h, "issues.cycle", runId, endedAt, id);
};

/**
 * What a human's press leaves behind: the very same pass, under the kind a press runs as.
 *
 * It must NOT close a window. "populace has reported on everything up to here" is a claim the
 * automatic cycle makes and a button does not, and the two shared one job kind.
 */
const manualPublishAfter = async (h: Studio, runId: string, endedAt: string, id: string): Promise<void> => {
  await saveFinishedJob(h, "issues.publish", runId, endedAt, id);
};

const saveFinishedJob = async (h: Studio, kind: "issues.publish" | "issues.cycle", runId: string, endedAt: string, id: string): Promise<void> => {
  const at = new Date(Date.parse(endedAt) + 1).toISOString();
  await h.store.saveJob({ id, kind, status: "succeeded", projectId: P, runId, costUsd: 0, progress: { done: 1, total: 1, label: "" }, error: null, createdAt: at, startedAt: at, endedAt: at });
};

/** The end of one execution's first visit, which is where a boundary is placed in these tests. */
const firstVisitEnd = async (h: Studio, runId: string): Promise<string> => {
  const end = (await visitsOf(h, runId))[0]?.endedAt;
  if (end === undefined || end === null) throw new Error("the execution made no visit that ended");
  return end;
};

/**
 * The window a publish reports on, picked the way the publisher picks it: the newest one anybody
 * visited. Every count the publisher reads is scoped to it, so a test asking the read model for the
 * same problems has to ask for the same stretch of time.
 */
const currentWindow = async (h: Studio): Promise<ReportWindow | undefined> => {
  const runs = (await h.store.listRuns({ simulationId: h.study.id })).sort((a, b) => a.seq - b.seq);
  const runIds = runs.map((run) => run.id);
  const [wakes, findings, jobs] = await Promise.all([
    runIds.length === 0 ? Promise.resolve<Wake[]>([]) : h.store.listWakes({ runIds }),
    runIds.length === 0 ? Promise.resolve<Finding[]>([]) : h.store.listFindings({ runIds }),
    Promise.all(runs.map((run) => h.store.listJobs({ runId: run.id }))).then((lists) => lists.flat()),
  ]);
  const windows = reportWindows({ runs, wakes, findings, jobs });
  return [...windows].reverse().find((window) => window.visited) ?? windows.at(-1);
};

/** The visits of one execution, oldest first. */
const visitsOf = async (h: Studio, runId: string): Promise<{ startedAt: string; endedAt: string | null }[]> =>
  (await h.store.listWakes({ runIds: [runId] })).map((wake) => ({ startedAt: wake.startedAt, endedAt: wake.endedAt })).sort((a, b) => a.startedAt.localeCompare(b.startedAt));

// ---- filing ----------------------------------------------------------------

describe("filing a study's problems", () => {
  it("opens one issue per surviving problem and records a ledger row for each", async () => {
    const h = await studio({ policy: filing([SEARCH, DUE_DATE, PAGING, NO_DELETE]) });
    await h.run();

    const summary = await h.publish();
    expect(summary.repo).toBe("acme/tasklet");
    expect(summary.filed).toBe(4);
    expect(summary.commented).toBe(0);
    expect(summary.failed).toBe(0);
    expect(h.github.created).toHaveLength(4);

    // Worst first, so a rate limit part way through costs the least important problem rather than
    // an arbitrary one. `critical` before the two `high`s before `medium`.
    expect(h.github.created[0]?.title).toContain("due date");
    expect(h.github.created[3]?.title).toContain("second page");

    const ledger = await h.store.listFiledIssues(P);
    expect(ledger.map((row) => row.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    // Every row carries the WHOLE member set, which is the key that does not move.
    expect(ledger.every((row) => row.signatures.length >= 1)).toBe(true);
    expect(ledger.every((row) => row.seenIn.length === 1 && row.seenIn[0]?.window === 1)).toBe(true);
    expect(ledger.every((row) => row.supersededBy === null)).toBe(true);

    // The labels are created once for the whole pass, not once per issue.
    expect(h.github.labelled).toBe(1);
    expect(h.github.created.every((issue) => issue.labels.includes("populace"))).toBe(true);

    // Every body carries the marker for every signature behind it, which is what makes a dropped
    // database survivable: the issue can be found again by searching the repository.
    for (const row of ledger) {
      const issue = h.github.created.find((candidate) => candidate.number === row.number);
      for (const signature of row.signatures) expect(issue?.body).toContain(markerFor(signature));
    }

    // The reproduction is in the body, which is the point of the whole feature.
    expect(h.github.created[0]?.body).toContain("## The reproduction");
    expect(h.github.created[0]?.body).toContain("list_tasks");

    const opened = await h.store.listEvents({ types: ["issue.opened"] });
    expect(opened).toHaveLength(4);
    expect(JSON.stringify(opened)).not.toContain("ghp_");
    expect(JSON.stringify(opened)).toContain("acme/tasklet");

    await h.close();
  });

  it("refuses before anything goes out when there is no repository or no token", async () => {
    const h = await studio({ policy: filing([SEARCH]), connect: false });
    await h.run();
    await expect(h.publish()).rejects.toThrow(IssuesNotConnected);

    const at = new Date().toISOString();
    await h.store.saveGithubConnection(GithubConnectionSchema.parse({ projectId: P, repo: "acme/tasklet", createdAt: at, updatedAt: at }));
    const refusal = await h.publish().then(
      () => "",
      (err: Error) => err.message,
    );
    expect(refusal).toContain("acme/tasklet");
    expect(refusal).toContain("no token");
    // The refusal says what is missing and nothing about what is stored.
    expect(refusal).not.toContain("ghp_");
    expect(h.github.created).toHaveLength(0);
    await h.close();
  });

  it("passes over praise, a settled problem, a duplicate and an absence", async () => {
    const h = await studio({ policy: filing([PRAISE, SEARCH, DUE_DATE, PAGING, NO_DELETE]) });
    await h.run();

    const settled = await signatureFor(h, SEARCH.title);
    const duplicate = await signatureFor(h, DUE_DATE.title);
    const at = new Date().toISOString();
    await h.store.saveTriage({ projectId: P, signature: settled, state: "wont-fix", note: "by design", externalRef: "", titleAtTriage: SEARCH.title, updatedAt: at });
    await h.store.saveTriage({ projectId: P, signature: duplicate, state: "duplicate", note: "same as the other one", externalRef: "", titleAtTriage: DUE_DATE.title, updatedAt: at });

    // A second execution that reports only the paging problem, so the coverage gap becomes an
    // ABSENCE card — a card the results screen adds for a problem an earlier window reported and
    // this one did not. Filing one is populace announcing a repair it cannot see (ADR-0028).
    h.script(filing([PAGING]));
    await h.run();

    const summary = await h.publish();
    expect(summary.filed).toBe(1);
    expect(h.github.created).toHaveLength(1);
    expect(h.github.created[0]?.title).toContain("second page");

    const reasons = new Set(summary.results.flatMap((result) => (result.reason === null ? [] : [result.reason])));
    expect(reasons).toContain("praise");
    expect(reasons).toContain("settled");
    expect(reasons).toContain("duplicate");
    expect(reasons).toContain("absent");
    await h.close();
  });

  it("applies the connection's filter to what it opens, and lets a named signature past it", async () => {
    const h = await studio({ policy: filing([PAGING, NO_DELETE]) });
    await h.run();
    const connection = await h.store.getGithubConnection(P);
    if (!connection) throw new Error("the harness did not connect");
    await h.store.saveGithubConnection({ ...connection, filter: { kinds: ["bug"], minSeverity: "critical", onlyConfirmed: false } });

    const filtered = await h.publish();
    expect(filtered.filed).toBe(0);
    expect(new Set(filtered.results.flatMap((r) => (r.reason === null ? [] : [r.reason])))).toEqual(new Set(["kind", "severity"]));

    // Naming one says which problem to consider, never which rules to waive — and the filter is
    // not one of the rules: a reader who pressed the button on this problem asked for this problem.
    const paging = await signatureFor(h, PAGING.title);
    const named = await h.publish([paging]);
    expect(named.filed).toBe(1);
    expect(named.results).toHaveLength(1);

    // A key this study's results do not carry is an answer, not an error: a bulk job cannot 404.
    const missing = await h.publish(["sig1:000000000000"]);
    expect(missing.results[0]?.reason).toBe("not-found");
    await h.close();
  });

  /**
   * A name the reader ticked is looked up against every MEMBER of a problem and not only against
   * the key the results screen happens to show.
   *
   * The screen is clustered over the whole EXECUTION and this pass is clustered over the report
   * WINDOW being published; the two clusterings pick their own representatives and need not draw
   * the same boundaries, so a key that is a cluster's representative on the screen can be a member
   * here. Matched on the representative alone, populace answered `not-found` for a problem plainly
   * visible on the page the button was pressed from — which for a longitudinal study, where the
   * window and the execution are never the same stretch of time, is the ordinary case.
   */
  it("files a problem named by one of its member keys, not only by the key the screen shows", async () => {
    const wordings: Report[] = [
      { kind: "bug", title: "the second page of list_tasks repeats a row from the first", tool: "list_tasks", severity: "high" },
      { kind: "bug", title: "the second page of list_tasks repeats a row, it seems, from the page before", tool: "list_tasks", severity: "high" },
    ];
    const h = await studio({ policy: filing(wordings) });
    await h.run();
    const cluster = (await new ProjectReadModel(h.store).publishable(h.study, await currentWindow(h)))[0];
    if (!cluster || cluster.signatures.length < 2) throw new Error("the two wordings did not cluster into one problem");
    const member = cluster.signatures.find((signature) => signature !== cluster.card.signature);
    if (member === undefined) throw new Error("the cluster is one wording, so there is no member to name");

    const named = await h.publish([member]);
    expect(named.filed).toBe(1);
    expect(named.results.some((result) => result.reason === "not-found")).toBe(false);

    // And two names that turn out to be ONE problem file one issue. The ledger was read for every
    // candidate before the first one wrote its row, so dealing with the same candidate twice would
    // see no match the second time and open a duplicate — the one mistake that cannot be taken
    // back out of somebody's tracker.
    const both = await h.publish([cluster.card.signature, member]);
    expect(h.github.created).toHaveLength(1);
    expect(both.commented).toBe(1);
    expect(both.skipped).toBe(1);
    expect(both.results.map((result) => result.reason)).toEqual([null, "already-filed"]);
    await h.close();
  });
});

// ---- not filing twice ------------------------------------------------------

describe("the same problem is not filed twice", () => {
  /**
   * The regression guard for the whole design.
   *
   * Two wordings of one problem cluster together. The clustering's representative is the one with
   * the higher confidence until a verdict is written, and `pickRepresentative` sorts on verdict
   * score FIRST — so writing `confirmed` on the other member moves the cluster's signature, inside
   * one execution, with nobody having reworded anything. A ledger keyed on that signature would
   * open a second issue here; a ledger keyed on the member SET does not.
   */
  it("comments rather than filing again when a verdict moves the problem's representative", async () => {
    const wordings: Report[] = [
      { kind: "bug", title: "the second page of list_tasks repeats a row from the first", tool: "list_tasks", severity: "high" },
      { kind: "bug", title: "the second page of list_tasks repeats a row, it seems, from the page before", tool: "list_tasks", severity: "high" },
    ];
    const h = await studio({ policy: filing(wordings) });
    await h.run();

    const readModel = new ProjectReadModel(h.store);
    const before = await readModel.publishable(h.study, await currentWindow(h));
    expect(before).toHaveLength(1);
    const cluster = before[0];
    if (!cluster) throw new Error("the two wordings did not cluster");
    expect(cluster.signatures.length).toBeGreaterThan(1);

    const first = await h.publish();
    expect(first.filed).toBe(1);
    const row = (await h.store.listFiledIssues(P))[0];
    expect(row?.signatures.length).toBeGreaterThan(1);

    // The digest's verdict, written after the run, on a member that is NOT the representative.
    const other = (await findingsOf(h)).find((finding) => finding.signature !== cluster.card.signature);
    if (!other) throw new Error("both wordings hashed to one signature");
    await h.store.saveVerification(other.id, {
      verdict: "confirmed",
      reason: "all 1 reproduction step behaved the same on replay",
      judge: "heuristic",
      replay: [],
      verifiedAt: new Date().toISOString(),
      costUsd: 0,
    });

    const after = await readModel.publishable(h.study, await currentWindow(h));
    // The key the screen shows has genuinely moved. This is the premise of the whole test.
    expect(after[0]?.card.signature).not.toBe(cluster.card.signature);

    const second = await h.publish();
    expect(second.filed).toBe(0);
    expect(second.commented).toBe(1);
    expect(h.github.created).toHaveLength(1);
    expect(h.github.comments).toHaveLength(1);
    expect(await h.store.listFiledIssues(P)).toHaveLength(1);
    await h.close();
  });

  it("files once and comments once when the same pass is run twice in a row", async () => {
    const h = await studio({ policy: filing([SEARCH]) });
    await h.run();

    expect((await h.publish()).filed).toBe(1);
    const repeat = await h.publish();
    expect(repeat.filed).toBe(0);
    expect(repeat.commented).toBe(1);
    expect(h.github.created).toHaveLength(1);
    expect(h.github.comments).toHaveLength(1);
    // "Again" is a claim about a history, and the only report populace has ever had of this
    // problem is the one the issue was opened from — so the second publish of one window said
    // "reported again in execution 1" about a single sighting.
    expect(h.github.comments[0]?.body).toContain("**Reported.**");
    expect(h.github.comments[0]?.body).not.toContain("Reported again");
    expect(h.github.comments[0]?.body).toContain("That is the only execution populace has a report of it in.");

    // One window, reported once: a second publish of one window is a double-publish, not a second
    // sighting, so the history a comment counts back through does not grow a phantom entry.
    const ledger = await h.store.listFiledIssues(P);
    expect(ledger[0]?.seenIn).toHaveLength(1);

    const commented = await h.store.listEvents({ types: ["issue.commented"] });
    expect(commented).toHaveLength(1);
    expect(JSON.stringify(commented)).not.toContain("ghp_");
    await h.close();
  });

  /**
   * The marker in the body, which is the second line of defence.
   *
   * The store has no migration framework: a `SCHEMA_SHAPE` change drops every table and rebuilds
   * it (ADR-0011), and a database copied to another machine is the same situation. Without asking
   * the repository what is already there, one schema change re-files every issue in it. A second
   * store over the same repository is exactly that state — the issue exists, nothing local
   * remembers it — and a finding's signature is a pure hash of `kind | tool | sorted title
   * tokens`, so the marker written by the first store is the one the second one searches for.
   */
  /**
   * **Two overlapping publishes file one issue.** The route that files one problem runs OUTSIDE
   * the serial job queue on purpose, and its own comment claimed the ledger read, the marker
   * search and the per-issue ledger write were what stopped a click during a bulk job from filing
   * twice. They are not: both passes read the ledger before either writes a row, both then search
   * for the same marker before either creates, and both are told "nothing found" — because at the
   * moment each asked, nothing had been filed.
   *
   * Two issues for one problem, in somebody's tracker, is the one outcome that cannot be taken
   * back, so passes over one project are chained.
   */
  it("files one issue when two publishes of the same problem overlap", async () => {
    const h = await studio({ policy: filing([SEARCH]) });
    await h.run();
    const key = await signatureFor(h, SEARCH.title);

    const [left, right] = await Promise.all([h.publish([key]), h.publish([key])]);
    expect(h.github.created).toHaveLength(1);
    expect(await h.store.listFiledIssues(P)).toHaveLength(1);
    // One filed and one commented, in whichever order the chain ran them — never two filed.
    expect([left.filed, right.filed].sort((a, b) => a - b)).toEqual([0, 1]);
    expect(left.filed + right.commented + left.commented + right.filed).toBe(2);
    await h.close();
  });

  it("finds an issue by its marker when the local ledger is gone, and comments instead of filing again", async () => {
    const before = await studio({ policy: filing([SEARCH]) });
    await before.run();
    expect((await before.publish()).filed).toBe(1);
    await before.close();

    const rebuilt = await studio({ policy: filing([SEARCH]), github: before.github });
    await rebuilt.run();
    expect(await rebuilt.store.listFiledIssues(P)).toEqual([]);

    const summary = await rebuilt.publish();
    expect(summary.filed).toBe(0);
    expect(summary.commented).toBe(1);
    expect(rebuilt.github.searched.length).toBeGreaterThan(0);
    expect(rebuilt.github.created).toHaveLength(1);
    // And the rebuilt ledger now knows about it, so the next pass does not have to search at all.
    expect(await rebuilt.store.listFiledIssues(P)).toHaveLength(1);
    await rebuilt.close();
  });

  /**
   * Two rows can match one candidate: the ledger records a set per issue, and a problem filed
   * twice under two wordings leaves two rows whose sets are both inside one cluster's today. The
   * oldest wins — it is the issue a reader has been following — and the other is marked as absorbed
   * rather than left matching candidates with nothing recording why nobody writes to it any more.
   */
  it("comments on the oldest of several matching rows and records the rest as superseded", async () => {
    const wordings: Report[] = [
      { kind: "bug", title: "the second page of list_tasks repeats a row from the first", tool: "list_tasks", severity: "high" },
      { kind: "bug", title: "the second page of list_tasks repeats a row, it seems, from the page before", tool: "list_tasks", severity: "high" },
    ];
    const h = await studio({ policy: filing(wordings) });
    await h.run();
    const cluster = (await new ProjectReadModel(h.store).publishable(h.study, await currentWindow(h)))[0];
    if (!cluster || cluster.signatures.length < 2) throw new Error("the two wordings did not cluster into one problem");

    // The two rows, written by hand because this is the state two earlier passes leave behind and
    // there is no way to reach it in one.
    const older = new Date(Date.now() - 60_000).toISOString();
    const newer = new Date(Date.now() - 30_000).toISOString();
    for (const [index, signature] of cluster.signatures.slice(0, 2).entries()) {
      await h.store.saveFiledIssue(
        FiledIssueSchema.parse({
          projectId: P,
          provider: "github",
          repo: "acme/tasklet",
          number: index + 1,
          url: `https://github.test/acme/tasklet/issues/${String(index + 1)}`,
          title: wordings[index]?.title ?? "a problem",
          signatures: [signature],
          filedAt: index === 0 ? older : newer,
          updatedAt: index === 0 ? older : newer,
        }),
      );
    }

    const summary = await h.publish();
    expect(summary.filed).toBe(0);
    expect(summary.commented).toBe(1);
    expect(h.github.comments.map((comment) => comment.number)).toEqual([1]);
    expect(h.github.comments[0]?.body).toContain("Also filed as #2");

    const ledger = await h.store.listFiledIssues(P);
    expect(ledger.find((row) => row.number === 1)?.supersededBy).toBeNull();
    expect(ledger.find((row) => row.number === 2)?.supersededBy).toBe(1);
    // The surviving row has absorbed both wordings, so neither is ever filed again.
    expect(ledger.find((row) => row.number === 1)?.signatures.length).toBeGreaterThan(1);

    // And it is said ONCE. "A later report joined the two under one title" is news the first time
    // and nothing at all in every comment after it, where it reads as something having changed
    // again — #2 is already recorded as absorbed, and the line repeated for ever.
    const again = await h.publish();
    expect(again.commented).toBe(1);
    expect(h.github.comments).toHaveLength(2);
    expect(h.github.comments[1]?.body).not.toContain("Also filed as #2");
    await h.close();
  });

  /**
   * A marker search that did not answer is not a marker search that found nothing, and the whole
   * refusal rests on telling them apart.
   *
   * Read as "nothing found", a rate limit files a duplicate of every problem whose ledger row is
   * gone — which is the case the marker exists for in the first place, so one 403 re-files every
   * issue populace has ever opened, into somebody's public tracker, where a duplicate cannot be
   * taken back. A skipped issue can be filed by running the pass again.
   */
  it("opens nothing when the marker search could not answer, and stops asking after the first refusal", async () => {
    const h = await studio({ policy: filing([DUE_DATE, SEARCH]) });
    await h.run();
    h.github.searchFailure = { ok: false, code: "rate-limited", message: "GitHub is rate limiting this token.", status: 403 };

    const summary = await h.publish();
    expect(summary.filed).toBe(0);
    expect(summary.failed).toBe(2);
    expect(h.github.created).toEqual([]);
    expect(summary.results[0]?.summary).toContain("could not check whether this is already filed");
    expect(summary.results[0]?.error).toContain("rate limiting");
    // One refusal is enough. Three markers per problem against a search endpoint limited to about
    // thirty requests a minute is what turns a bulk pass into a pass that files blind.
    expect(h.github.searched).toHaveLength(1);
    // And nothing was recorded, so the pass after the limit lifts files both.
    expect(await h.store.listFiledIssues(P)).toEqual([]);

    h.github.searchFailure = null;
    expect((await h.publish()).filed).toBe(2);
    await h.close();
  });

  /**
   * The ledger row for an issue found by its marker records when GITHUB says the issue was opened.
   *
   * Stamping the current clock is not a cosmetic error. Every tie-break in the dedupe rule is "the
   * oldest `filedAt` wins, because that is the issue a reader has been following"
   * (`FiledIssueSchema`), so an issue opened in May recorded as filed today loses that tie-break
   * for ever and every future comment goes to whichever issue populace opened most recently.
   */
  it("records the date GitHub says an issue was opened, not the clock it was found at", async () => {
    const before = await studio({ policy: filing([SEARCH]) });
    await before.run();
    expect((await before.publish()).filed).toBe(1);
    await before.close();

    const rebuilt = await studio({ policy: filing([SEARCH]), github: before.github });
    await rebuilt.run();
    expect(await rebuilt.store.listFiledIssues(P)).toEqual([]);

    const summary = await rebuilt.publish();
    expect(summary.commented).toBe(1);
    const row = (await rebuilt.store.listFiledIssues(P))[0];
    expect(row?.filedAt).toBe(OPENED_AT);
    // `updatedAt` is populace's own clock and stays so: it is when this record was last written to.
    expect(row?.updatedAt).not.toBe(OPENED_AT);
    expect(summary.results[0]?.issue?.filedAt).toBe(OPENED_AT);
    await rebuilt.close();
  });

  it("records nothing at all rather than a filing date it invented, when GitHub did not say", async () => {
    const before = await studio({ policy: filing([SEARCH]) });
    await before.run();
    expect((await before.publish()).filed).toBe(1);
    await before.close();

    const rebuilt = await studio({ policy: filing([SEARCH]), github: before.github });
    rebuilt.github.noCreationDate = true;
    await rebuilt.run();

    const summary = await rebuilt.publish();
    // No duplicate — the marker did its job — and no row, because there is no honest date to write
    // one under. The next pass finds the issue the same way.
    expect(rebuilt.github.created).toHaveLength(1);
    expect(summary.commented).toBe(0);
    expect(summary.failed).toBe(1);
    expect(await rebuilt.store.listFiledIssues(P)).toEqual([]);
    expect(summary.results[0]?.error).toContain("no creation date");
    await rebuilt.close();
  });

  /**
   * A pass has a wall clock, and it stops on it rather than grinding through the rest getting
   * refused.
   *
   * Forty problems against a rate-limited endpoint is a job slot held open for as long as the limit
   * lasts, producing nothing anybody can act on. Asked BETWEEN problems, stopping is clean:
   * everything filed is filed and its ledger rows are written, so the next pass carries on.
   */
  it("stops a pass whose wall clock is spent, and keeps everything it filed before that", async () => {
    const h = await studio({ policy: filing([DUE_DATE, SEARCH, PAGING, NO_DELETE]) });
    await h.run();
    h.github.outOfTimeAfter = 2;

    const summary = await h.publish();
    expect(summary.filed).toBe(2);
    expect(summary.failed).toBe(2);
    expect(summary.results).toHaveLength(4);
    expect(h.github.created).toHaveLength(2);
    expect(summary.results.at(-1)?.summary).toContain("Filing stopped after");
    expect(await h.store.listFiledIssues(P)).toHaveLength(2);

    // And the pass that follows files the two it never reached, without duplicating either of the
    // two it did.
    h.github.outOfTimeAfter = null;
    const again = await h.publish();
    expect(again.filed).toBe(2);
    expect(again.commented).toBe(2);
    expect(h.github.created).toHaveLength(4);
    await h.close();
  });

  it("keeps what it has already filed when a create fails part way through", async () => {
    const h = await studio({ policy: filing([DUE_DATE, SEARCH, PAGING]) });
    await h.run();
    h.github.refuseCreatesFrom = 2;

    const summary = await h.publish();
    expect(summary.filed).toBe(1);
    expect(summary.failed).toBe(2);
    expect(h.github.created).toHaveLength(1);
    // The successes are persisted, per issue, before the next one is started.
    expect(await h.store.listFiledIssues(P)).toHaveLength(1);
    const failure = summary.results.find((result) => result.outcome === "failed");
    expect(failure?.error).toContain("Validation failed");
    expect(failure?.issue).toBeNull();

    // And the pass that follows files the two it lost, without a duplicate of the one it kept.
    h.github.refuseCreatesFrom = null;
    const again = await h.publish();
    expect(again.filed).toBe(2);
    expect(again.commented).toBe(1);
    expect(h.github.created).toHaveLength(3);
    await h.close();
  });
});

// ---- what a comment may claim ----------------------------------------------

describe("what populace says about a problem it has already filed", () => {
  /**
   * A reporter who is still visiting, which a study that has run to its cap has nobody of.
   *
   * The EXECUTION has to be running too, and not only the person: a participant row keeps
   * `status: "active"` when its execution is paused or over, so "still visiting" read off the row
   * alone has populace telling a reader that people are still visiting a study that stopped days
   * ago (`ProblemReach.stillActive`).
   */
  const stillVisiting = async (h: Studio, runId: string): Promise<void> => {
    for (const agent of await h.store.listAgents({ runId })) await h.store.upsertAgent({ ...agent, status: "active", retiredReason: null });
    const run = await h.store.getRun(runId);
    if (run) await h.store.saveRun({ ...run, status: "running" });
  };

  it("reports an absence as an absence, with the reach that supports it and none of the forbidden words", async () => {
    const h = await studio({ policy: filing([SEARCH], { onlyFirstVisit: true }) });
    const first = await h.run();
    expect((await h.publish()).filed).toBe(1);

    // A sibling execution that reports nothing. That is an absence, and the comment on it is the
    // payload of the whole loop: the thing a reader sees after a pull request lands.
    h.script(quiet);
    await h.run();
    await stillVisiting(h, first.id);

    const summary = await h.publish();
    expect(summary.filed).toBe(0);
    expect(summary.commented).toBe(1);
    const body = h.github.comments[0]?.body ?? "";

    expect(body).toContain("Gone quiet");
    expect(body).toContain("an absence, not a repair");
    // WHICH study is talking. The ledger and the issue are per project and a project holds several
    // studies against several targets (ADR-0035), so a reader following an issue could not tell
    // which of them had reported what — or that there was more than one.
    expect(body).toContain(`the "${h.study.name}" study`);
    // Real numbers, and only the ones that can be supported: the person came back after the last
    // report and did not repeat it, which is evidence, and the sentence says exactly that much.
    expect(body).toContain("Of the 1 person who hit this, 1 is still visiting, and has been back since it was last reported — 1 visit — without reporting it again.");
    // And the window it names is the one the last report was in, not the one being published.
    expect(body).toContain("the most recent report was in execution 1");
    // This study was reported once per execution and has no cycles in it, so it is not told about
    // a mechanism it never used.
    expect(body).toContain("nobody has reported this in the latest execution");
    expect(body).not.toContain("report cycle");

    // §7.3. An absence is never a fix, and these are the words that would make it one.
    expect(body).not.toMatch(/\bfixed\b/i);
    expect(body).not.toMatch(/\bverified\b/i);
    expect(body).not.toMatch(/\bresolved\b/i);
    expect(body).not.toMatch(/no longer reproducible/i);
    // Nothing was reported in this window, so there is no sighting to record for it.
    expect((await h.store.listFiledIssues(P))[0]?.seenIn).toHaveLength(1);
    await h.close();
  });

  /**
   * One person who hit the same problem in two executions is ONE person, and the statuses under
   * that headline are counted per execution because that is the only unit that has one.
   *
   * Counted as the statuses are, the headline said three people had hit a problem two people had
   * hit — a claim about somebody who does not exist, in populace's most public copy — so the two
   * units are printed as two numbers, each saying which it is.
   */
  it("counts one person who hit it in two executions as one person, and says so", async () => {
    const h = await studio({ policy: filing([SEARCH]) });
    await h.run();
    expect((await h.publish()).filed).toBe(1);

    h.script(filing([SEARCH]));
    await h.run();
    h.script(quiet);
    await h.run();

    const summary = await h.publish();
    expect(summary.commented).toBe(1);
    const body = h.github.comments.at(-1)?.body ?? "";
    expect(body).toContain("Gone quiet");
    expect(body).toContain("1 person hit this, 2 times in all counting each execution separately.");
    expect(body).toContain("Of those 2, none is still visiting an execution that is running");
    // Never "2 people": the same person in two executions is one person.
    expect(body).not.toContain("2 people");
    await h.close();
  });

  it("says a problem is back, and reopens the issue without claiming anything about why it was closed", async () => {
    const h = await studio({ policy: filing([SEARCH]) });
    await h.run();
    await h.publish();
    h.script(quiet);
    await h.run();
    await h.publish();

    // Somebody closed it in the meantime, and then the problem was reported again.
    h.github.closed.add(1);
    h.script(filing([SEARCH]));
    await h.run();

    const summary = await h.publish();
    expect(summary.commented).toBe(1);
    expect(h.github.reopened).toEqual([1]);
    expect(h.github.created).toHaveLength(1);
    const body = h.github.comments.at(-1)?.body ?? "";
    expect(body).toContain("Back.");
    expect(body).toContain("its own sequence of observations");
    expect(body).toContain("populace cannot tell why it was closed");
    // Never a claim about the repository's own state or about a regression in somebody's code.
    expect(body).not.toMatch(/\bfixed\b/i);
    expect(body).not.toMatch(/\bstill broken\b/i);
    await h.close();
  });

  /**
   * A "Reported again" comment names ONE report cycle, so the numbers under it have to be that
   * cycle's — and the running total has to be said separately or it reads as the cycle's own.
   *
   * Every number on a card is counted over the window being published, and for a longitudinal
   * study on its twentieth cycle the lifetime count is a number several times too big to print
   * under "reported again in report cycle 20". So both are printed, each with its scope named.
   */
  it("says what this report cycle saw separately from the study's running total", async () => {
    const h = await studio({ policy: filing([SEARCH]) });
    await h.run();
    expect((await h.publish()).filed).toBe(1);

    h.script(filing([SEARCH]));
    await h.run();
    const summary = await h.publish();
    expect(summary.commented).toBe(1);

    const body = h.github.comments.at(-1)?.body ?? "";
    expect(body).toContain("Reported again");
    // This cycle: one person, the two reports they filed in it, counted over the window this
    // publish is about and nothing wider.
    expect(body).toContain(`- In execution 2 of the "${h.study.name}" study: 1 of 1 person who visited hit it, filing 2 reports between them.`);
    // And the lifetime figure, said as a lifetime figure rather than left to read as this cycle's,
    // with the study it is the lifetime OF named.
    expect(body).toContain(`- Across the "${h.study.name}" study so far: 4 reports in total, in 2 executions.`);
    // The severity is the worst any of them rated it, and never "as the people rated it": the
    // cluster's severity is the maximum over its members, so one person's `critical` among five
    // `low`s was being attributed to all six.
    expect(body).toContain("- Severity, at the worst any of them rated it: **high**.");
    // Windows that are plain executions are called executions, which is the product's own word
    // for them.
    expect(body).not.toContain("report cycle");
    await h.close();
  });

  /**
   * Both halves of "M of N who went hit it" are the report window's.
   *
   * The denominator was `card.peopleTotal`, the roster of the whole EXECUTION, under a sentence
   * naming one cycle whose numerator was that cycle's — so a longitudinal study on its seventh
   * cycle published "1 of 12 people who went hit it" with halves counted over an hour and over the
   * study's whole life. Read as a proportion, which is the only way to read it, it was false.
   */
  it("counts who went over the same report window as who hit it", async () => {
    const h = await studio({ policy: filing([SEARCH]) });
    const run = await h.run();
    // Somebody the study dealt in who never got a visit in. The execution's roster is two and the
    // people who visited the window being published are still one.
    const [went] = await h.store.listAgents({ runId: run.id });
    if (!went) throw new Error("the execution sent nobody");
    await h.store.upsertAgent({ ...went, id: `${went.id}-idle`, personId: `${went.personId}-idle`, name: "Never Visited" });

    expect((await h.publish()).filed).toBe(1);
    await h.publish();
    const body = h.github.comments.at(-1)?.body ?? "";
    expect(body).toContain("1 of 1 person who visited hit it");
    expect(body).not.toContain("of 2 people");
    await h.close();
  });

  /**
   * What an absence may say about the people behind it, sentence by sentence.
   *
   * Three claims used to overreach. "N walked away OVER IT" asserted a cause populace has no datum
   * for — the row says the person gave up, not what drove them off. "N are still visiting — M
   * visits between them" read as though all N had come back when only some had. And a reporter
   * whose participant row is gone was dropped from every bucket, so the numbers under the total
   * did not add up to it, with nothing saying why.
   */
  it("says only what the rows say about who gave up, who came back, and who cannot be looked up", async () => {
    const h = await studio({ policy: filing([SEARCH], { onlyFirstVisit: true }) });
    const first = await h.run();
    expect((await h.publish()).filed).toBe(1);

    h.script(quiet);
    await h.run();
    await stillVisiting(h, first.id);

    // Three more reporters of the same problem, written by hand: they stand for one execution's
    // worth of states one scripted person cannot be in at once.
    const mine = (await h.store.listFindings({ runIds: [first.id] }))[0];
    const who = (await h.store.listAgents({ runId: first.id }))[0];
    if (!mine || !who) throw new Error("the execution reported nothing");
    const quitter = { ...who, id: `${who.id}-quit`, personId: `${who.personId}-quit`, status: "retired" as const, retiredReason: "gave-up" as const };
    const stayed = { ...who, id: `${who.id}-stay`, personId: `${who.personId}-stay` };
    await h.store.upsertAgent(quitter);
    await h.store.upsertAgent(stayed);
    for (const [index, agentId] of [quitter.id, stayed.id, `${who.id}-vanished`].entries()) {
      // The same moment as the real report, so the last-reported time — and therefore which visits
      // count as made since it — is the one the scripted person's visit established.
      await h.store.saveFinding({ ...mine, id: `${mine.id}-${String(index)}`, agentId });
    }

    const summary = await h.publish();
    expect(summary.commented).toBe(1);
    const body = h.github.comments.at(-1)?.body ?? "";
    expect(body).toContain("Gone quiet");

    // What the row supports: they gave up, and nobody woke them again. Not what it does not: that
    // this problem is why.
    expect(body).toContain("1 gave up on the product after hitting this");
    expect(body).toContain("populace cannot tell whether this problem is why they left");
    expect(body).not.toContain("walked away over it");

    // The visits belong to the ones who came back, not to everybody still visiting.
    expect(body).toContain("2 are still visiting; 1 of them has been back since it was last reported — 1 visit between them — and none has reported it again");

    // And the one nobody can look up is accounted for rather than silently dropped: four hit it,
    // and the buckets under that total reach four — two still visiting, one who gave up, one who
    // cannot be looked up.
    expect(body).toContain("populace no longer has a participant record for 1 of them");
    expect(body).toContain("Of the 4 people who hit this");
    await h.close();
  });

  /**
   * **An absence is news, and news is said once.** The regression guard for the defect that would
   * have done the most damage in somebody's repository.
   *
   * Nothing bounded this. A problem that was filed and then stopped being reported got another
   * absence comment on every report window for the rest of the study's life — on the default hourly
   * cycle roughly a hundred and seventy a week, each with a bigger number in it, landing on exactly
   * the issues whose repairs had just worked. The one comment the whole loop exists to deliver
   * became the reason a developer mutes the issue.
   *
   * So the two halves of the assertion are both required: three quiet windows say it ONCE, and a
   * problem that comes back and goes quiet again says it a SECOND time, because that is different
   * news rather than the same news restated.
   */
  it("says a problem has gone quiet once, and again only when it came back and went quiet again", async () => {
    const h = await studio({ policy: filing([SEARCH], { onlyFirstVisit: true }) });
    await h.run();
    expect((await h.publish()).filed).toBe(1);

    // Three windows in a row in which nobody reports it. The first is news. Nobody is left
    // visiting a running execution here, which the comment says out loud — the reach sentence is
    // asserted by the test above and by `closed-loop.test.ts`; this one is about how OFTEN it is
    // written, so the executions are left finished and a new one can be started on top.
    h.script(quiet);
    await h.run();
    const announced = await h.publish();
    expect(announced.commented).toBe(1);
    expect(h.github.comments).toHaveLength(1);
    expect(h.github.comments[0]?.body).toContain("Gone quiet");

    // The second and the third are the same news, so populace writes nothing at all — and says why
    // rather than reporting a comment it did not make.
    for (const _ of [2, 3]) {
      await h.run();
      const again = await h.publish();
      expect(again.commented).toBe(0);
      expect(again.skipped).toBe(1);
      expect(again.results[0]?.reason).toBe("absent");
      expect(again.results[0]?.summary).toContain("already said");
      expect(h.github.comments).toHaveLength(1);
    }

    // One notice on the ledger row, not three, and it names the window the last report was in.
    const row = (await h.store.listFiledIssues(P))[0];
    expect(row?.quietNotices).toHaveLength(1);
    expect(row?.quietNotices[0]?.studyId).toBe(h.study.id);
    expect(row?.quietNotices[0]?.since).toBe(1);

    // It comes back. That is its own comment, and it is what makes the next silence news again.
    h.script(filing([SEARCH], { onlyFirstVisit: true }));
    await h.run();
    expect((await h.publish()).commented).toBe(1);
    expect(h.github.comments.at(-1)?.body).toContain("Back.");

    // And quiet again, from a LATER last report, so populace says so a second time.
    h.script(quiet);
    await h.run();
    expect((await h.publish()).commented).toBe(1);
    const quietAgain = h.github.comments.filter((comment) => comment.body.includes("Gone quiet"));
    expect(quietAgain).toHaveLength(2);
    const grown = (await h.store.listFiledIssues(P))[0];
    expect(grown?.quietNotices.map((notice) => notice.since)).toEqual([1, 5]);
    await h.close();
  });

  /**
   * **The "Re-check:" line names what actually decided it.** It used to assert a replay for every
   * verdict, and two of them are settled by no replay at all: a `coverage-gap` is settled by asking
   * the target again which tools it exposes, and a verdict can be written when the replay never ran
   * — the account was swept, the address could not be reached, or there was nothing recorded to
   * repeat. "confirmed on replay" over a tool-list diff is populace citing an experiment it did not
   * perform, in the body a developer decides what to change from.
   *
   * It also spelled the verdict out itself, while `verdictWords` is stated in `@populace/fix-prompt`
   * to be the one definition of those four words — so an issue and the populace screen it links to
   * gave two accounts of one event.
   */
  const settledBy = async (h: Studio, title: string, replay: Verification["replay"]): Promise<void> => {
    const findings = (await findingsOf(h)).filter((candidate) => candidate.title === title);
    const latest = findings.at(-1);
    if (!latest) throw new Error(`nothing filed with the title ${title}`);
    await h.store.saveVerification(latest.id, {
      verdict: "confirmed",
      reason: "populace asked the target again.",
      judge: "heuristic",
      replay,
      verifiedAt: new Date().toISOString(),
      costUsd: 0,
    });
  };

  it("names the tool list, not a replay, when a tool list is what settled a coverage gap", async () => {
    const h = await studio({ policy: filing([NO_DELETE]) });
    await h.run();
    expect((await h.publish()).filed).toBe(1);

    h.script(filing([NO_DELETE]));
    await h.run();
    await settledBy(h, NO_DELETE.title, []);

    expect((await h.publish()).commented).toBe(1);
    const body = h.github.comments.at(-1)?.body ?? "";
    expect(body).toContain("Re-check: confirmed, from asking the target again which tools it exposes rather than from a replay.");
    // The claim that was false: nothing was replayed, so nothing may say it was.
    expect(body).not.toContain("on replay.");
    await h.close();
  });

  it("says a verdict was reached by nothing that ran, when the replay recorded no steps", async () => {
    const h = await studio({ policy: filing([SEARCH]) });
    await h.run();
    expect((await h.publish()).filed).toBe(1);

    h.script(filing([SEARCH]));
    await h.run();
    await settledBy(h, SEARCH.title, []);

    expect((await h.publish()).commented).toBe(1);
    const body = h.github.comments.at(-1)?.body ?? "";
    expect(body).toContain("Re-check: confirmed, and nothing re-checked it — there was nothing for populace to repeat.");
    await h.close();
  });

  it("says a verdict was reached on replay when there were steps to replay", async () => {
    const h = await studio({ policy: filing([SEARCH]) });
    await h.run();
    expect((await h.publish()).filed).toBe(1);

    h.script(filing([SEARCH]));
    await h.run();
    const replayed = (await findingsOf(h)).find((candidate) => candidate.title === SEARCH.title)?.reproduction ?? [];
    expect(replayed.length).toBeGreaterThan(0);
    await settledBy(h, SEARCH.title, replayed);

    expect((await h.publish()).commented).toBe(1);
    expect(h.github.comments.at(-1)?.body ?? "").toContain("Re-check: confirmed on replay.");
    await h.close();
  });

  it("writes no triage row, ever", async () => {
    const h = await studio({ policy: filing([SEARCH, PAGING]) });
    await h.run();
    await h.publish();
    // Manufacturing a judgement nobody typed would make the finding page say a human settled this
    // minutes ago, and hand `drifted` a title no human stood behind. The link reaches the screens
    // through the LEDGER instead.
    expect(await h.store.listTriage(P)).toEqual([]);
    await h.publish();
    expect(await h.store.listTriage(P)).toEqual([]);
    await h.close();
  });
});

// ---- which stretch of time a claim is about ---------------------------------

describe("the window a publish is reporting on", () => {
  /**
   * The longitudinal case, which is the mode the whole loop is built around and the one an
   * execution-scoped absence guard cannot see at all.
   *
   * A longitudinal study has ONE execution for its whole life, so scoped to the execution
   * `inLatest` is true for every problem the run has ever reported: the absence guard never fires,
   * and populace files a problem that went quiet three cycles ago as a brand new issue — then
   * comments "gone quiet" a cycle later on the issue it opened itself. Scoped to the report WINDOW,
   * the same arithmetic answers the question that was asked.
   */
  it("passes over a problem this report cycle did not report, inside one execution", async () => {
    const h = await studio({ policy: filing([SEARCH], { onlyFirstVisit: true }) });
    const run = await h.run();
    const visits = await visitsOf(h, run.id);
    const first = visits[0]?.endedAt;
    if (first === undefined || first === null) throw new Error("the execution made no visit that ended");
    // A cycle reported after the first visit, which puts the second visit in a window of its own.
    await closeWindowAfter(h, run.id, first, "job-cycle-1");

    // One execution, two report cycles: the report is in the first and the second visited and
    // found nothing. Nothing may be filed off that, and nothing may be filed off its silence.
    expect(await h.store.listRuns({ simulationId: h.study.id })).toHaveLength(1);
    const summary = await h.publish();
    expect(summary.filed).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(summary.results[0]?.reason).toBe("absent");
    expect(h.github.created).toEqual([]);
    await h.close();
  });

  /**
   * A quiet duration counts back from the last report of the whole GROUP — the cluster's own
   * wordings union every signature the ledger row has absorbed — and not from the cluster's alone.
   *
   * The state above the sentence is computed over that group, so a duration counted over anything
   * narrower is a number about a different problem than the sentence it sits under. Here the ledger
   * row has absorbed a wording that was reported one cycle ago, while the cluster's own wording was
   * last reported two cycles ago: counted over the cluster, populace claims this has been quiet for
   * twice as long as it has.
   */
  it("counts a quiet duration from the grown group's last report, not the cluster's", async () => {
    const OLD: Report = { kind: "bug", title: "the second page of list_tasks repeats a row from the first", tool: "list_tasks", severity: "critical" };
    const NEWER: Report = { kind: "bug", title: "search_tasks misses a task unless the capitals match", tool: "search_tasks", severity: "low" };
    const h = await studio({ policy: filing([OLD]) });
    await h.run();
    expect((await h.publish()).filed).toBe(1);

    h.script(filing([NEWER]));
    await h.run();
    // What a pass whose clusterer bridged the two wordings leaves behind: one issue's record now
    // carries both, which is the ledger absorbing drift rather than forking.
    const newer = await signatureFor(h, NEWER.title);
    await h.store.growFiledIssue({ projectId: P, provider: "github", repo: "acme/tasklet", number: 1 }, { signatures: [newer], seenIn: [], updatedAt: new Date().toISOString() });

    h.script(quiet);
    await h.run();

    const summary = await h.publish();
    // Two clusters, one ledger row, ONE comment: the second is passed over as already written to.
    expect(summary.commented).toBe(1);
    expect(h.github.comments.map((comment) => comment.number)).toEqual([1]);
    expect(h.github.created).toHaveLength(1);
    expect(summary.results.filter((result) => result.reason === "already-filed")).toHaveLength(1);

    const body = h.github.comments[0]?.body ?? "";
    expect(body).toContain("Gone quiet");
    expect(body).toContain("nobody has reported this in the latest execution");
    expect(body).toContain("the most recent report was in execution 2");
    expect(body).not.toContain("the last 2 executions");
    await h.close();
  });

  /**
   * Two ledger rows bridged by one signature are one problem, and the comment on each has to be
   * computed from the whole of it.
   *
   * "Shares a signature" is transitive: this cluster shares one with a row, that row shares one
   * with a second row, and the second row is another cluster's. A map from signature to owner
   * cannot represent that — it is last-writer-wins, and the middle signature ends up owned by
   * whichever cluster came later in the loop, leaving the earlier one with a group of one wording
   * and a history that knows nothing about the report that just came in. Which is how populace
   * comes to write "gone quiet" on an issue in the very cycle its problem was reported.
   */
  it("reads one history for two issues bridged by a shared signature", async () => {
    const h = await studio({ policy: filing([DUE_DATE, PAGING]) });
    await h.run();
    expect((await h.publish()).filed).toBe(2);
    const due = await signatureFor(h, DUE_DATE.title);
    const paging = await signatureFor(h, PAGING.title);

    // A third wording, reported in the cycle after, which an earlier pass absorbed into BOTH
    // records — the state two issues for one problem leave behind.
    h.script(filing([NO_DELETE]));
    await h.run();
    const bridge = await signatureFor(h, NO_DELETE.title);
    const at = new Date().toISOString();
    for (const number of [1, 2]) {
      await h.store.growFiledIssue({ projectId: P, provider: "github", repo: "acme/tasklet", number }, { signatures: [bridge], seenIn: [], updatedAt: at });
    }

    const summary = await h.publish([due, paging]);
    expect(summary.commented).toBe(2);
    expect(h.github.comments.map((comment) => comment.number).sort((a, b) => a - b)).toEqual([1, 2]);
    // Both are live: the bridging wording was reported in the window being published, so neither
    // record may be told its problem has gone quiet.
    for (const comment of h.github.comments) {
      expect(comment.body).toContain("Reported again");
      expect(comment.body).not.toContain("Gone quiet");
      // And the count under that sentence is the group's in this cycle, not the one wording's,
      // which for the wording nobody used this cycle would be a nought under "reported again".
      expect(comment.body).toContain(`- In execution 2 of the "${h.study.name}" study: 1 of 1 person who visited hit it, filing 2 reports between them.`);
    }
    await h.close();
  });
});

describe("what closes a report window", () => {
  /**
   * The boundary belongs to the automatic report cycle, and a human pressing "File all" is not
   * one. This is the most consequential test in the file.
   *
   * Both run this same pass, and they shared one job kind. So a manual press advanced the state
   * machine: the window the NEXT publish reported on was the stretch of time since the press,
   * which has no reports in it yet — and every issue in somebody's repository got a comment saying
   * its problem had gone quiet. Two presses of a button, and populace announces an absence for
   * everything it has ever filed, in the most public copy it writes.
   */
  it("is not closed by a publish somebody pressed", async () => {
    const h = await studio({ policy: filing([SEARCH], { onlyFirstVisit: true }) });
    const run = await h.run();
    expect((await h.publish()).filed).toBe(1);

    // Ended between the two visits: exactly where a boundary would cut the report off from the
    // silence that follows it, which is what makes the absence look real.
    const first = await firstVisitEnd(h, run.id);
    await manualPublishAfter(h, run.id, first, "job-pressed");

    const summary = await h.publish();
    expect(summary.commented).toBe(1);
    const body = h.github.comments.at(-1)?.body ?? "";
    expect(body).not.toContain("Gone quiet");
    expect(body).not.toContain("an absence");
    expect(summary.results[0]?.summary).not.toContain("gone quiet");

    // And the cycle still closes one, so the mechanism is intact and it is only the press that no
    // longer drives it: the same moment, recorded by the cycle, makes the second visit's silence a
    // window of its own and the comment an absence.
    await closeWindowAfter(h, run.id, first, "job-cycle-1");
    const after = await h.publish();
    expect(after.commented).toBe(1);
    expect(h.github.comments.at(-1)?.body ?? "").toContain("Gone quiet");
    await h.close();
  });

  /**
   * With no visited window there is no stretch of time to make a claim about, and populace refuses
   * rather than writing one.
   *
   * Reachable, and not only in theory: an execution whose visits have been swept, or a store
   * rebuilt under the reports (ADR-0011), leaves the reports with nothing that visited. What came
   * out was "nobody has reported this in the last 0 report cycles" — said of a problem whose
   * report is in the very window being counted — which is a sentence that reads as an absence and
   * is not one.
   */
  it("refuses to comment when no report window has been visited", async () => {
    const h = await studio({ policy: filing([SEARCH]) });
    const run = await h.run();
    expect((await h.publish()).filed).toBe(1);
    expect(await h.store.deleteWakesByRun(run.id)).toBeGreaterThan(0);

    const summary = await h.publish();
    expect(summary.commented).toBe(0);
    expect(summary.failed).toBe(1);
    expect(h.github.comments).toEqual([]);
    expect(summary.results[0]?.summary).toContain("Nobody has visited this study yet");
    expect(summary.results[0]?.error).toContain("no report window of this study has been visited");
    // And nothing was said about a length of time at all, which is the claim there was no evidence
    // for.
    expect(h.github.everything()).not.toContain("last 0");
    await h.close();
  });
});

// ---- what publishing must not do -------------------------------------------

describe("what publishing costs", () => {
  it("opens no session to the target and makes no request of its own", async () => {
    const h = await studio({ policy: filing([SEARCH]) });
    await h.run();

    // Publishing has no request behind it and no operator sign-in to act with, so it must not dial
    // the product under study — an automatic file that woke somebody's app is a surprise nobody
    // asked for. The read model is passed `NO_COVERAGE` for exactly this reason.
    const real = globalThis.fetch;
    const reached: string[] = [];
    globalThis.fetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      reached.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return real(input, init);
    };
    try {
      expect((await h.publish()).filed).toBe(1);
    } finally {
      globalThis.fetch = real;
    }
    expect(reached).toEqual([]);

    // And the address in the body came off the execution's frozen config, not off a live session.
    expect(h.github.created[0]?.body).toContain(target.mcpUrl);
    await h.close();
  });

  /**
   * The body is written from the problems the read model handed over, and never read back one
   * problem at a time.
   *
   * `cluster()` rebuilds the whole study context per call — every execution, every visit, every
   * report and two clustering passes — so a bulk pass over forty problems did that forty times to
   * write forty bodies off one set of rows. The detail comes back beside the card.
   */
  it("writes every body from the problems it was handed, without reading one back per issue", async () => {
    const h = await studio({ policy: filing([SEARCH, DUE_DATE, PAGING, NO_DELETE]) });
    await h.run();

    const asked: string[] = [];
    h.readModel.cluster = (_simulation, signature) => {
      asked.push(signature);
      return Promise.resolve(undefined);
    };

    const summary = await h.publish();
    expect(asked).toEqual([]);
    expect(summary.filed).toBe(4);
    // And what went out is the real view and not a thinner one: the reproduction is the point.
    expect(h.github.created[0]?.body).toContain("## The reproduction");
    expect(h.github.created[0]?.body).toContain("list_tasks");
    await h.close();
  });

  it("reduces the target's address to its host when the repository is world-readable", async () => {
    const h = await studio({ policy: filing([SEARCH]), visibility: "public" });
    await h.run();
    expect((await h.publish()).filed).toBe(1);
    const body = h.github.created[0]?.body ?? "";

    // A public repository publishes an internal staging address, and a path or a query string can
    // carry rather more than an address. The host is what tells a reader which service the calls
    // went to, which is all the address is in the prompt for.
    expect(body).not.toContain(target.mcpUrl);
    expect(body).toContain(new URL(target.mcpUrl).host);
    await h.close();
  });

  /**
   * **The reduction fails CLOSED.** It used to fire on `visibility === "public"` alone, and
   * `unknown` is not an edge: it is the DEFAULT of the connection schema, it is where every
   * connection sits until somebody presses Check, and it is where one lands again the moment it is
   * re-pointed at another repository. So the automatic path published the target's real endpoints
   * into a repository populace had no idea was world-readable — which ADR-0044 has the `unknown`
   * state for precisely because populace does not know.
   */
  it("reduces the address when it does not know whether the repository is private", async () => {
    const h = await studio({ policy: filing([SEARCH]), visibility: "unknown" });
    await h.run();
    expect((await h.publish()).filed).toBe(1);
    const body = h.github.created[0]?.body ?? "";

    expect(body).not.toContain(target.mcpUrl);
    expect(body).toContain(new URL(target.mcpUrl).host);
    // And the body says which of the two reasons it was reduced for, because "not checked" is a
    // different sentence from "known to be public".
    expect(body).toContain("has not confirmed this repository is private");
    await h.close();
  });

  /**
   * The note is as honest about the LIMIT as about the reduction.
   *
   * What is reduced is an absolute URL on one of the target's own hosts. The transcript is
   * otherwise quoted as it came back, so another service's address, an internal name that is not a
   * URL, or an account id goes out in full — and a reader told "addresses are reduced" and not
   * told the rest will file into a world-readable tracker believing the body was sanitised.
   */
  it("says in the body what the reduction did not do, whenever it ran", async () => {
    const h = await studio({ policy: filing([SEARCH]), visibility: "public" });
    await h.run();
    expect((await h.publish()).filed).toBe(1);
    const body = h.github.created[0]?.body ?? "";
    expect(body).toContain("world-readable");
    expect(body).toContain("Nothing else is scrubbed");
    expect(body).toContain("quoted as they came back");
    await h.close();
  });

  it("makes no such claim on a repository it knows is private, because it reduced nothing", async () => {
    const h = await studio({ policy: filing([SEARCH]) });
    await h.run();
    expect((await h.publish()).filed).toBe(1);
    expect(h.github.created[0]?.body ?? "").not.toContain("Nothing else is scrubbed");
    await h.close();
  });

  /**
   * The reduction is not one field deep, and this is the test that says so.
   *
   * It used to rewrite `product.endpoints` and nothing else, while the same body quoted the
   * product's own responses and the people's own words verbatim — and a real product puts absolute
   * self-URLs in its output constantly: a `next` page link, a resource URL in an error. So the
   * claim "the address is reduced" was true of one line of the body and false of the transcript
   * under it. Now every string a body can print goes through the same pass: a URL on one of the
   * target's own hosts keeps the host, loses the path, and says in place that it was edited.
   */
  it("reduces an address quoted inside the transcript too, not only the configured one", async () => {
    const deep = `${target.url}/tasks/17/history?page=2`;
    const leaky: ScriptPolicy = (ctx: ScriptContext) => {
      if (ctx.turn === 1) return { calls: [call("search_tasks", { query: `anything like ${deep}` })] };
      if (ctx.turn === 2)
        return {
          calls: [
            call("file_finding", {
              kind: "bug",
              title: "search_tasks misses a task unless the capitals match",
              description: `I had ${deep} open at the time.`,
              expected: "It behaves the way the product says it does.",
              observed: `The page at ${deep} came back empty.`,
              severity: "high",
              confidence: 0.9,
              tool: "search_tasks",
              evidence_calls: [ctx.allResults[0]?.ref ?? ""],
            }),
          ],
        };
      return { calls: [call("done", { summary: "that is what I found", would_return: true })] };
    };

    const host = new URL(target.mcpUrl).host;
    const open = await studio({ policy: leaky, visibility: "public" });
    await open.run();
    expect((await open.publish()).filed).toBe(1);
    const published = open.github.created[0]?.body ?? "";
    expect(published).not.toContain("/tasks/17/history");
    expect(published).not.toContain(deep);
    expect(published).toContain(`${host}/[address reduced]`);
    await open.close();

    // On a private repository nothing is reduced: the reduction is about what a world-readable
    // tracker publishes for good, and editing the evidence has a cost of its own.
    const shut = await studio({ policy: leaky });
    await shut.run();
    expect((await shut.publish()).filed).toBe(1);
    expect(shut.github.created[0]?.body ?? "").toContain(deep);
    await shut.close();
  });

  /**
   * The product's WEB address is reduced too, and no field of a problem carries it.
   *
   * `ClusterDetailView.product.endpoints` is the MCP endpoints, so a reduction that looked at the
   * problem alone could not see the address people opened pages at — and that is the address a
   * transcript is full of, because `fetch_page` is how somebody reads a product's own website. So
   * a world-readable repository published `https://app.internal.example/...` in full, three inches
   * under an MCP endpoint that had been carefully cut back to its host.
   */
  it("reduces the product's web address, on a host of its own, along with its endpoints", async () => {
    const WEB = "https://app.tasklet.test";
    const deep = `${WEB}/tasks/17/history?token=abc`;
    const leaky: ScriptPolicy = (ctx: ScriptContext) => {
      if (ctx.turn === 1) return { calls: [call("list_tasks", {})] };
      if (ctx.turn === 2)
        return {
          calls: [
            call("file_finding", {
              kind: "bug",
              title: "search_tasks misses a task unless the capitals match",
              description: `I had ${deep} open at the time.`,
              expected: "It behaves the way the product says it does.",
              observed: `The page at ${deep} came back empty.`,
              severity: "high",
              confidence: 0.9,
              tool: "search_tasks",
              evidence_calls: [ctx.allResults[0]?.ref ?? ""],
            }),
          ],
        };
      return { calls: [call("done", { summary: "that is what I found", would_return: true })] };
    };

    const h = await studio({ policy: leaky, visibility: "public", webBaseUrl: WEB });
    await h.run();
    expect((await h.publish()).filed).toBe(1);
    const body = h.github.created[0]?.body ?? "";
    expect(body).not.toContain(deep);
    expect(body).not.toContain("/tasks/17/history");
    expect(body).not.toContain("token=abc");
    expect(body).toContain("app.tasklet.test/[address reduced]");
    await h.close();
  });

  it("writes none of the rows' own words into a title, a body or a comment", async () => {
    const h = await studio({ policy: filing([SEARCH, PAGING]) });
    await h.run();
    await h.publish();
    h.script(quiet);
    await h.run();
    await h.publish();
    expect(h.github.comments.length).toBeGreaterThan(0);

    // ADR-0032, ADR-0042. An issue is the most public copy populace produces, and a title lands in
    // a search index that outlives the issue being edited or deleted.
    expect(h.github.everything()).not.toMatch(/\b(simulation|agent|wake|lane)s?\b/i);
    // And the token is in none of it either, nor in any event payload.
    expect(h.github.everything()).not.toContain("ghp_");
    expect(JSON.stringify(await h.store.listEvents({ limit: 1000 }))).not.toContain("ghp_");
    await h.close();
  });
});

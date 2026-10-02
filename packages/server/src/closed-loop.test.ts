import { GithubConnectionSchema, PopulaceConfigSchema, type Finding, type Job, type PopulaceConfig, type Run, type Simulation, type Store, type Wake } from "@populace/core";
import { startMockTarget, type Repairable, type RunningMockTarget } from "@populace/mock-target";
import { ScriptedProvider, call, field, type ScriptContext, type ScriptPolicy, type SeenToolResult } from "@populace/runner/testing";
import { SqliteStore } from "@populace/store-sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureProject, ensureSettings, ensureSimulation, materialise, resolveSimulationConfig, seedProjectFromConfig } from "./config-store.js";
import type { GithubOutcome, IssueRef, MarkerSearch } from "./github.js";
import { ProjectReadModel } from "./project-read-model.js";
import { publishIssues, type IssueClient } from "./publish-issues.js";
import { RunController } from "./runs.js";

/**
 * **The north star, as a test rather than as a paragraph.**
 *
 * The loop populace exists to be a component of: it runs continuously against a deployed product,
 * files what it finds, somebody (or something) opens a pull request against the issue, a human
 * approves it — and populace then says, on that same issue, what it has seen since. That last step
 * is the payload, and it is also the step with the most ways to be wrong: it must report an absence
 * as an absence and never as a repair, it must say it once rather than every hour for the rest of
 * the study's life, and it must say "back" if the problem returns without claiming to know why
 * anybody closed anything.
 *
 * So this file plays the whole loop through, offline, with a real longitudinal study against the
 * real mock target:
 *
 * 1. The product ships broken. People visit, find the planted case-sensitive search, and the
 *    problem is filed as an issue.
 * 2. The product is **repaired** — the target is restarted with `repaired: ["search-case"]` on the
 *    same state file, so the accounts and the tasks the people made are still there and the same
 *    people carry on visiting the same product.
 * 3. A report window closes. populace comments **once**, that the problem stopped being reported,
 *    with the reach that supports it and none of the words that would make it a claim of repair.
 * 4. The repair is **reverted**. The people find it again, and populace says it is back.
 *
 * Nothing here needs `ANTHROPIC_API_KEY` or a network: the "model" is `ScriptedProvider` and GitHub
 * is a fake that records what it was asked to write. The script is not a script of what to report,
 * though — it asks the product a question and reports only what the answer warrants, which is what
 * makes steps 2 and 4 change the outcome rather than the test changing it for them.
 */

const P = "default";
const processConfig = { store: { kind: "sqlite" as const, path: ":memory:" }, digestDir: "digests" };

/** What the people in this study complain about, in the words they would use. */
const SEARCH_TITLE = "search_tasks misses a task unless the capitals match";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "populace-closed-loop-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ---- the product -----------------------------------------------------------

/**
 * The product under study, on a port of the test's choosing and a state file that outlives it.
 *
 * The port is pinned from the second start onwards because the study's target — and the frozen
 * config snapshot its execution runs against — names an address. A restart on a fresh port would be
 * a different product as far as populace is concerned, and the point of this test is that it is the
 * SAME one, with the same accounts in it, behaving differently.
 */
async function ship(options: { stateFile: string; port?: number; repaired?: ReadonlySet<Repairable> }): Promise<RunningMockTarget> {
  return startMockTarget({
    quiet: true,
    stateFile: options.stateFile,
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.repaired === undefined ? {} : { repaired: options.repaired }),
  });
}

// ---- what one person does on a visit ---------------------------------------

/** How many entries an array field of a tool result has, with no cast anywhere. */
function count(result: SeenToolResult | undefined, key: string): number {
  const value = result?.data ?? null;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return 0;
  const list = value[key];
  return Array.isArray(list) ? list.length : 0;
}

/** The `id` of the first entry of an array field, for the project a task goes into. */
function firstId(result: SeenToolResult | undefined, key: string): string {
  const value = result?.data ?? null;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "";
  const list = value[key];
  if (!Array.isArray(list)) return "";
  const head = list[0];
  if (head === null || head === undefined || typeof head !== "object" || Array.isArray(head)) return "";
  const id = head.id;
  return typeof id === "string" ? id : "";
}

/**
 * One person's visit: make an account if they have not got one, keep a task, then search for it in
 * the wrong case and report the product if it cannot find it.
 *
 * **The report is a judgement about the answer, not a line in a script.** Tasklet's own description
 * promises its search matches regardless of case; the planted defect compares exact case. So the
 * same policy files a bug against the broken build and files nothing at all against the repaired
 * one, and steps 2 and 4 of the loop above change what populace reports because the PRODUCT
 * changed — which is the only way this test says anything about the loop.
 *
 * The turn order is driven off which tools have already answered rather than off `ctx.turn`,
 * because the first visit signs up and the later ones do not.
 */
const visitor: ScriptPolicy = (ctx: ScriptContext) => {
  const done = (summary: string): { calls: ReturnType<typeof call>[] } => ({ calls: [call("done", { summary, would_return: true })] });
  const seen = (name: string): SeenToolResult | undefined => ctx.allResults.find((result) => result.name === name);

  // The credentials the runner suggests, read out of the visit context exactly as a real
  // participant reads them. Offered only while the person has no account, so this is the first
  // visit and no other.
  const suggested = /email (\S+), display name "([^"]+)", password (\S+)/.exec(ctx.wakeContext);
  if (suggested && !seen("sign_up")) return { calls: [call("sign_up", { email: suggested[1] ?? "", displayName: suggested[2] ?? "", password: suggested[3] ?? "" })] };

  const projects = seen("list_projects");
  if (!projects) return { calls: [call("list_projects", {})] };
  const made = seen("create_project");
  if (count(projects, "projects") === 0 && !made) return { calls: [call("create_project", { name: "Groceries" })] };
  const projectId = made ? field(made, "id") : firstId(projects, "projects");
  if (projectId === "") return done("I could not find anywhere to keep a task, so I gave up on this errand.");

  if (!seen("create_task")) return { calls: [call("create_task", { projectId, title: "Buy Milk" })] };

  const search = seen("search_tasks");
  if (!search) return { calls: [call("search_tasks", { query: "buy milk" })] };
  // The whole loop, in one branch: the product found the task, so there is nothing to report.
  if (count(search, "tasks") > 0) return done("Searched for my task in lower case and it came straight back. Nothing to report.");

  if (!seen("file_finding")) {
    return {
      calls: [
        call("file_finding", {
          kind: "bug",
          title: SEARCH_TITLE,
          description: "I made a task called Buy Milk and then searched for 'buy milk'. Nothing came back.",
          expected: "The site says search does not care about capitals, so it should have found it.",
          observed: "The search returned no tasks at all.",
          severity: "high",
          confidence: 0.9,
          tool: "search_tasks",
          evidence_calls: [search.ref ?? ""],
        }),
      ],
    };
  }
  return done("Reported the search problem. I will try again another day.");
};

// ---- GitHub, offline -------------------------------------------------------

/**
 * The slice of `GithubClient` the publisher is typed against, recording what it was asked to write.
 *
 * Typed off `IssueClient` so an operation added to the real client is a compile error here rather
 * than a silent hole, and it holds no token because there is nothing for it to do with one.
 */
class FakeGithub implements IssueClient {
  readonly created: { number: number; title: string; body: string }[] = [];
  readonly comments: { number: number; body: string }[] = [];
  private next = 1;

  ensureLabels(labels: readonly string[]): Promise<GithubOutcome<{ created: string[]; existing: string[] }>> {
    return Promise.resolve({ ok: true, created: [...labels], existing: [] });
  }

  createIssue(issue: { title: string; body: string }): Promise<GithubOutcome<{ issue: IssueRef }>> {
    const number = this.next++;
    this.created.push({ number, title: issue.title, body: issue.body });
    return Promise.resolve({ ok: true, issue: this.ref(number) });
  }

  getIssue(number: number): Promise<GithubOutcome<{ issue: IssueRef }>> {
    return Promise.resolve({ ok: true, issue: this.ref(number) });
  }

  addComment(number: number, body: string): Promise<GithubOutcome<{ id: number; url: string }>> {
    this.comments.push({ number, body });
    return Promise.resolve({ ok: true, id: this.comments.length, url: `https://github.test/acme/tasklet/issues/${String(number)}#c${String(this.comments.length)}` });
  }

  reopenIssue(number: number): Promise<GithubOutcome<{ issue: IssueRef }>> {
    return Promise.resolve({ ok: true, issue: this.ref(number) });
  }

  searchIssues(marker: string): Promise<MarkerSearch> {
    const hit = this.created.find((issue) => issue.body.includes(marker));
    return Promise.resolve(hit === undefined ? { outcome: "none" } : { outcome: "found", issues: [this.ref(hit.number)] });
  }

  outOfTime(): null {
    return null;
  }

  /** Every gone-quiet comment it has been asked to write, which is the number this file is about. */
  quiet(): string[] {
    return this.comments.filter((comment) => comment.body.includes("Gone quiet")).map((comment) => comment.body);
  }

  private ref(number: number): IssueRef {
    return { number, url: `https://github.test/acme/tasklet/issues/${String(number)}`, state: "open", createdAt: "2026-05-01T09:12:33.000Z" };
  }
}

// ---- the study -------------------------------------------------------------

/**
 * One person on a fast cadence, signing up for their own account so the repair can be a repair of
 * something they own.
 *
 * `identity: self-signup` is load-bearing here and is not in the other publishing tests: the task
 * the search is looking for belongs to an ACCOUNT, so the account has to survive the restart or
 * "the same people visit the repaired product" would be a different person looking at an empty
 * list. The account lives in the target's state file, which is what the restart reuses.
 */
function config(mcpUrl: string, webBaseUrl: string): PopulaceConfig {
  return PopulaceConfigSchema.parse({
    simulation: { id: "sim_closed_loop", slug: "closed-loop", name: "Closed loop", mode: "longitudinal", visitsPerPerson: null },
    target: { name: "Tasklet", mcp: [{ url: mcpUrl }], webBaseUrl, description: "Tasklet keeps your projects and tasks in one place. Search ignores capitals." },
    identity: { strategy: "self-signup", signupTool: "sign_up", tokenPath: "token", userIdPath: "user.id", emailDomain: "populace.test" },
    verifier: { judge: "heuristic" },
    daemon: { tick: "10ms", concurrency: 1 },
    population: {
      id: "tasklet",
      cadence: { every: "10ms", jitter: "0s", initialDelay: "0s" },
      members: [{ persona: { id: "casual-lister", name: "Casey Morgan", role: "a list keeper", backstory: "keeps a list", goals: ["keep a list"] } }],
    },
  });
}

interface Loop {
  store: Store;
  study: Simulation;
  github: FakeGithub;
  runs: RunController;
  publish(): Promise<{ filed: number; commented: number; skipped: number }>;
}

async function loop(mcpUrl: string, webBaseUrl: string): Promise<Loop> {
  const store: Store = new SqliteStore(":memory:");
  await ensureProject(store);
  await ensureSettings(store);
  await seedProjectFromConfig(store, config(mcpUrl, webBaseUrl));
  const created = await ensureSimulation(store);
  // Longitudinal: one execution for the study's whole life, unbounded, paused and picked back up
  // rather than finished. It is the mode the loop above is built around, and `ensureSimulation`
  // makes an ephemeral one.
  const study: Simulation = { ...created, mode: "longitudinal", visitsPerPerson: null, updatedAt: new Date().toISOString() };
  await store.saveSimulation(study);
  await materialise(store, study.id);

  const at = new Date().toISOString();
  // PRIVATE, so the bodies below are the real thing and the address reduction is not what is under
  // test here — `publish-issues.test.ts` owns that.
  await store.saveGithubConnection(
    GithubConnectionSchema.parse({ projectId: P, repo: "acme/tasklet", token: "ghp_abcdefghijklmnopqrstuvwxyz", visibility: "private", createdAt: at, updatedAt: at }),
  );

  const github = new FakeGithub();
  const readModel = new ProjectReadModel(store);
  const provider = new ScriptedProvider(visitor);
  const runs = new RunController({
    store,
    provider: () => provider,
    resolve: async (simulationId: string) => (await resolveSimulationConfig(store, processConfig, simulationId)).config,
    materialise: (simulationId: string) => materialise(store, simulationId),
  });

  return {
    store,
    study,
    github,
    runs,
    publish: async () => {
      const summary = await publishIssues({ simulation: study }, { store, readModel, client: () => github });
      return { filed: summary.filed, commented: summary.commented, skipped: summary.skipped };
    },
  };
}

// ---- waiting, and closing a window -----------------------------------------

async function waitFor(condition: () => Promise<boolean>, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const visitsOf = async (h: Loop, runId: string): Promise<Wake[]> => (await h.store.listWakes({ runIds: [runId] })).filter((wake) => wake.endedAt !== null).sort((a, b) => a.startedAt.localeCompare(b.startedAt));

const findingsOf = async (h: Loop, runId: string): Promise<Finding[]> => h.store.listFindings({ runIds: [runId] });

/**
 * Close the open report window, which is what the automatic cycle does by finishing.
 *
 * A succeeded `issues.cycle` job with an end time is the whole mechanism (`report-windows.ts`), and
 * the end goes a millisecond PAST the last visit so that visit's reports stay on the near side of
 * the boundary — a report written at the instant a cycle ended belongs to the window the cycle
 * opened.
 */
const closeWindow = async (h: Loop, runId: string, id: string): Promise<void> => {
  const last = (await visitsOf(h, runId)).at(-1)?.endedAt;
  if (last === undefined || last === null) throw new Error("no visit has ended, so there is no window to close");
  const at = new Date(Date.parse(last) + 1).toISOString();
  const job: Job = { id, kind: "issues.cycle", status: "succeeded", projectId: P, runId, costUsd: 0, progress: { done: 1, total: 1, label: "" }, error: null, createdAt: at, startedAt: at, endedAt: at };
  await h.store.saveJob(job);
};

/**
 * The execution as it is between the test's phases: paused so nothing is in flight while a publish
 * reads the rows, but recorded as running for the read the publish makes of it.
 *
 * That second half matters and is not a trick. `ProblemReach.stillActive` is deliberately "in an
 * execution that is RUNNING", so that populace never tells a reader people are still visiting a
 * study that stopped days ago — and a longitudinal soak in the loop this file is about IS running.
 * Pausing is how the test stops the clock; the row is put back the way a live soak's row reads so
 * the comment's reach sentence is the one a live soak would get.
 */
const asIfUp = async (h: Loop, runId: string, status: Run["status"]): Promise<void> => {
  const run = await h.store.getRun(runId);
  if (!run) throw new Error(`no run ${runId}`);
  await h.store.saveRun({ ...run, status });
};

// ---- the loop --------------------------------------------------------------

describe("the closed loop: broken, filed, repaired, reported, reverted", () => {
  it("files what it found, says once that it stopped being reported, and says when it is back", async () => {
    const stateFile = join(dir, "tasklet.json");
    let product = await ship({ stateFile });
    const port = Number(new URL(product.url).port);
    const mcpUrl = product.mcpUrl;
    const webBaseUrl = product.url;
    const h = await loop(mcpUrl, webBaseUrl);

    try {
      // ---- 1. the product ships broken, and the problem becomes an issue ----
      const run = await h.runs.start({
        config: (await resolveSimulationConfig(h.store, processConfig, h.study.id)).config,
        projectId: P,
        simulationId: h.study.id,
        targetId: (await resolveSimulationConfig(h.store, processConfig, h.study.id)).target.id,
        label: "soak",
      });
      await waitFor(async () => (await findingsOf(h, run.id)).some((finding) => finding.title === SEARCH_TITLE), "somebody to report the search problem");
      await waitFor(async () => (await visitsOf(h, run.id)).length >= 2, "a second visit, so there is somebody who came back");
      await h.runs.pause(run.id);

      // Every visit against the broken build reports it, so this is however many got in before the
      // pause drained — the number matters only as the baseline phase 2 is compared against.
      const reportedWhileBroken = (await findingsOf(h, run.id)).filter((finding) => finding.title === SEARCH_TITLE).length;
      expect(reportedWhileBroken).toBeGreaterThan(0);

      const filed = await h.publish();
      expect(filed.filed).toBe(1);
      expect(h.github.created).toHaveLength(1);
      expect(h.github.created[0]?.title).toContain("capitals");
      // The reproduction is in it, which is the point of filing at all.
      expect(h.github.created[0]?.body).toContain("search_tasks");
      expect(h.github.created[0]?.body).toContain("## The reproduction");

      // The cycle that reported it also closes the window it reported on, so what happens next is
      // a new window rather than more of this one.
      await closeWindow(h, run.id, "job_cycle_1");

      // ---- 2. somebody ships the repair, on the same accounts ----
      await product.close();
      product = await ship({ stateFile, port, repaired: new Set<Repairable>(["search-case"]) });
      // The account the first visits made is still there, which is what makes the people who come
      // back the same people rather than strangers looking at an empty list.
      expect(product.app.listUsers().length).toBeGreaterThan(0);

      const before = (await visitsOf(h, run.id)).length;
      await h.runs.resume(run.id);
      await waitFor(async () => (await visitsOf(h, run.id)).length >= before + 2, "the same people to visit the repaired product");
      await h.runs.pause(run.id);
      // Nothing new was reported: the product answered the question this time, so the people who
      // came back had nothing to say about it.
      expect((await findingsOf(h, run.id)).filter((finding) => finding.title === SEARCH_TITLE)).toHaveLength(reportedWhileBroken);

      // ---- 3. populace says it stopped being reported. ONCE. ----
      await asIfUp(h, run.id, "running");
      const quiet = await h.publish();
      expect(quiet.commented).toBe(1);
      expect(h.github.created).toHaveLength(1);
      expect(h.github.quiet()).toHaveLength(1);
      const comment = h.github.quiet()[0] ?? "";

      // It names the reach that actually supports the absence: the people who hit it, and that they
      // came back afterwards and did not report it again. That is the evidence; the rest is theirs.
      expect(comment).toContain("Gone quiet");
      expect(comment).toContain("who hit this");
      expect(comment).toContain("has been back since it was last reported");
      expect(comment).toContain("without reporting it again");
      expect(comment).toContain('the "Closed loop" study');
      expect(comment).toContain("This is an absence, not a repair");

      // And it claims nothing. §7.3: an absence is never a fix, and these are the words that would
      // make it one — including in the most public copy populace produces.
      expect(comment).not.toMatch(/\bfixed\b/i);
      expect(comment).not.toMatch(/\bverified\b/i);
      expect(comment).not.toMatch(/\bresolved\b/i);
      expect(comment).not.toMatch(/no longer reproducible/i);
      expect(comment).not.toMatch(/\b(simulation|agent|wake|lane)s?\b/i);

      // The cycle repeats, hourly by default, and the absence does not become a drumbeat: nothing
      // has changed, so there is nothing to say. This is the assertion that stands between a
      // developer and a hundred and seventy comments a week on the issue their repair just closed.
      const again = await h.publish();
      expect(again.commented).toBe(0);
      expect(again.skipped).toBe(1);
      expect(h.github.quiet()).toHaveLength(1);

      await closeWindow(h, run.id, "job_cycle_2");
      await asIfUp(h, run.id, "paused");

      // ---- 4. the repair is reverted, and populace says it is back ----
      await product.close();
      product = await ship({ stateFile, port });
      const beforeRegression = (await visitsOf(h, run.id)).length;
      await h.runs.resume(run.id);
      await waitFor(async () => (await findingsOf(h, run.id)).filter((finding) => finding.title === SEARCH_TITLE).length > reportedWhileBroken, "the problem to be reported again");
      await waitFor(async () => (await visitsOf(h, run.id)).length >= beforeRegression + 1, "the visit that reported it to end");
      await h.runs.pause(run.id);

      const back = await h.publish();
      expect(back.commented).toBe(1);
      expect(h.github.created).toHaveLength(1);
      const returned = h.github.comments.at(-1)?.body ?? "";
      expect(returned).toContain("Back.");
      expect(returned).toContain("its own sequence of observations");
      // populace describes what it saw and makes no claim about anybody's code or anybody's issue.
      expect(returned).not.toMatch(/\bregression\b/i);
      expect(returned).not.toMatch(/\bfixed\b/i);
      expect(h.github.quiet()).toHaveLength(1);
    } finally {
      await h.runs.shutdown();
      await h.store.close();
      await product.close();
    }
  }, 60_000);
});

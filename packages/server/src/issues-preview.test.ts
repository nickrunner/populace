import { GithubConnectionSchema, PopulaceConfigSchema, type Finding, type PopulaceConfig, type Run, type Store } from "@populace/core";
import { startMockTarget, type RunningMockTarget } from "@populace/mock-target";
import { ScriptedProvider, call, type ScriptContext, type ScriptPolicy } from "@populace/runner/testing";
import { SqliteStore } from "@populace/store-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureProject, ensureSettings, ensureSimulation, materialise, resolveSimulationConfig, seedProjectFromConfig } from "./config-store.js";
import { previewIssues } from "./control.js";
import type { GithubOutcome, IssueRef, MarkerSearch } from "./github.js";
import { ProjectReadModel } from "./project-read-model.js";
import { publishIssues, type IssueClient } from "./publish-issues.js";
import { RunController } from "./runs.js";

/**
 * "What would pressing this do?", asked before anything is written.
 *
 * The dialog that confirms filing forty issues used to answer this for itself: `StudyResults.tsx`
 * carried hand-written copies of the hard skips and of the connection's filter, in the browser,
 * with nothing keeping them in step with the server. A skip reason or a filter field added on one
 * side left the dialog listing rows the pass would pass over — and the count next to a button that
 * writes into somebody's repository is the last thing a reader has to go on.
 *
 * So the test that matters is not "the preview says what I expect", it is **"the preview said what
 * the pass then did"**. That is what the last test in this file asserts, over a real pass against
 * the real mock target with a fake GitHub, and it is what would fail if either side moved alone.
 *
 * No `ANTHROPIC_API_KEY`, no token that reaches anything, no network.
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

function config(): PopulaceConfig {
  return PopulaceConfigSchema.parse({
    target: { name: "Tasklet", mcp: [{ url: target.mcpUrl }], webBaseUrl: target.url, description: "Tasklet keeps your projects and tasks in one place." },
    identity: { strategy: "none" },
    verifier: { judge: "heuristic" },
    daemon: { tick: "20ms", concurrency: 2 },
    population: {
      id: "tasklet",
      maxWakes: 1,
      cadence: { every: "20ms", jitter: "0s", initialDelay: "0s" },
      members: [{ persona: { id: "casual-lister", name: "Casey Morgan", role: "a list keeper", backstory: "keeps a list", goals: ["keep a list"] } }],
    },
  });
}

interface Report {
  kind: "bug" | "friction" | "praise";
  title: string;
  tool: string;
  severity: "critical" | "high" | "medium" | "low";
}

/** Four problems chosen so that each lands on a different branch of the selection. */
const SEARCH: Report = { kind: "bug", title: "search_tasks misses a task unless the capitals match", tool: "search_tasks", severity: "high" };
const PAGING: Report = { kind: "bug", title: "the second page of list_tasks repeats a row from the first", tool: "list_tasks", severity: "critical" };
const TYPO: Report = { kind: "bug", title: "the empty list screen has a spelling mistake on it", tool: "create_task", severity: "low" };
const PRAISE: Report = { kind: "praise", title: "signing up and making a first list took under a minute", tool: "create_task", severity: "low" };

/** One visit that looks around and then files each report, one per turn. */
function filing(reports: readonly Report[]): ScriptPolicy {
  return (ctx: ScriptContext) => {
    if (ctx.turn === 1) return { calls: [call("list_tasks", {})] };
    const report = reports[ctx.turn - 2];
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

/** GitHub, offline, and only the half a create-and-comment pass touches. */
class FakeGithub implements IssueClient {
  readonly created: { number: number; title: string; body: string }[] = [];
  readonly comments: { number: number; body: string }[] = [];
  readonly searched: string[] = [];
  readonly reopened: number[] = [];
  /** Everything it was asked to do, in order, for the "a preview asks nothing" assertion. */
  readonly asked: string[] = [];
  private next = 1;

  ensureLabels(labels: readonly string[]): Promise<GithubOutcome<{ created: string[]; existing: string[] }>> {
    this.asked.push("ensureLabels");
    return Promise.resolve({ ok: true, created: [...labels], existing: [] });
  }

  createIssue(issue: { title: string; body: string; labels: readonly string[] }): Promise<GithubOutcome<{ issue: IssueRef }>> {
    this.asked.push("createIssue");
    const number = this.next++;
    this.created.push({ number, title: issue.title, body: issue.body });
    return Promise.resolve({ ok: true, issue: this.ref(number) });
  }

  getIssue(number: number): Promise<GithubOutcome<{ issue: IssueRef }>> {
    this.asked.push("getIssue");
    return Promise.resolve({ ok: true, issue: this.ref(number) });
  }

  addComment(number: number, body: string): Promise<GithubOutcome<{ id: number; url: string }>> {
    this.asked.push("addComment");
    this.comments.push({ number, body });
    return Promise.resolve({ ok: true, id: this.comments.length, url: `https://github.test/acme/tasklet/issues/${String(number)}#c1` });
  }

  reopenIssue(number: number): Promise<GithubOutcome<{ issue: IssueRef }>> {
    this.asked.push("reopenIssue");
    this.reopened.push(number);
    return Promise.resolve({ ok: true, issue: this.ref(number) });
  }

  searchIssues(marker: string): Promise<MarkerSearch> {
    this.asked.push("searchIssues");
    this.searched.push(marker);
    const hit = this.created.find((issue) => issue.body.includes(marker));
    return Promise.resolve(hit === undefined ? { outcome: "none" } : { outcome: "found", issues: [this.ref(hit.number)] });
  }

  outOfTime(): null {
    return null;
  }

  private ref(number: number): IssueRef {
    return { number, url: `https://github.test/acme/tasklet/issues/${String(number)}`, state: "open", createdAt: "2026-05-01T09:12:33.000Z" };
  }
}

/** The store methods that change a row — what a preview is forbidden to call. */
const WRITES = /^(save|upsert|delete|append|set|archive|grow)/;

function counting(inner: Store): { store: Store; calls: string[] } {
  const calls: string[] = [];
  const store = new Proxy(inner, {
    get(object, prop) {
      // eslint-disable-next-line no-restricted-syntax -- reflection over the Store interface; the proxy hands back exactly what the method returns.
      const value = Reflect.get(object, prop) as unknown;
      if (typeof value !== "function") return value;
      // eslint-disable-next-line no-restricted-syntax -- same boundary: the return value goes straight back to the caller, which types it.
      const fn = value as (...args: never[]) => unknown;
      return (...args: never[]) => {
        calls.push(String(prop));
        return fn.apply(object, args);
      };
    },
  });
  return { store, calls };
}

interface Studio {
  store: Store;
  calls: string[];
  github: FakeGithub;
  readModel: ProjectReadModel;
  study: Awaited<ReturnType<typeof ensureSimulation>>;
  run: () => Promise<Run>;
  preview: (signatures?: readonly string[]) => ReturnType<typeof previewIssues>;
  publish: (signatures?: readonly string[]) => ReturnType<typeof publishIssues>;
  signatureFor: (title: string) => Promise<string>;
  close: () => Promise<void>;
}

async function studio(options: { policy: ScriptPolicy; minSeverity?: "critical" | "high" | "medium" | "low"; connect?: boolean }): Promise<Studio> {
  const inner = new SqliteStore(":memory:");
  const counted = counting(inner);
  const store: Store = counted.store;
  await ensureProject(store);
  await ensureSettings(store);
  await seedProjectFromConfig(store, config());
  const study = await ensureSimulation(store);
  const readModel = new ProjectReadModel(store);
  const github = new FakeGithub();
  const provider = new ScriptedProvider(options.policy);
  const runs = new RunController({
    store,
    provider: () => provider,
    resolve: async (simulationId: string) => (await resolveSimulationConfig(store, processConfig, simulationId)).config,
    materialise: (simulationId: string) => materialise(store, simulationId),
  });

  if (options.connect !== false) {
    const at = new Date().toISOString();
    await store.saveGithubConnection(
      GithubConnectionSchema.parse({
        projectId: P,
        repo: "acme/tasklet",
        token: "ghp_abcdefghijklmnopqrstuvwxyz",
        visibility: "private",
        filter: { minSeverity: options.minSeverity ?? "medium" },
        createdAt: at,
        updatedAt: at,
      }),
    );
  }

  return {
    store,
    calls: counted.calls,
    github,
    readModel,
    study,
    run: async () => {
      const resolved = await resolveSimulationConfig(store, processConfig, study.id);
      const run = await runs.start({ config: resolved.config, projectId: P, simulationId: study.id, targetId: resolved.target.id, label: "execution" });
      await runs.settled(run.id);
      return run;
    },
    preview: (signatures) => previewIssues({ store, readModel }, { simulation: study, ...(signatures === undefined ? {} : { signatures }) }),
    publish: (signatures) => publishIssues({ simulation: study, ...(signatures === undefined ? {} : { signatures }) }, { store, readModel, client: () => github }),
    signatureFor: async (title: string) => {
      const runIds = (await store.listRuns({ simulationId: study.id })).map((run) => run.id);
      const findings: Finding[] = runIds.length === 0 ? [] : await store.listFindings({ runIds });
      const finding = findings.find((candidate) => candidate.title === title);
      if (!finding) throw new Error(`nothing filed with the title ${title}`);
      return finding.signature;
    },
    close: async () => {
      await runs.shutdown();
      await inner.close();
    },
  };
}

describe("previewing what a bulk file would do", () => {
  it("writes nothing, asks github.com nothing, and says why each problem would be passed over", async () => {
    const h = await studio({ policy: filing([PAGING, SEARCH, TYPO, PRAISE]) });
    await h.run();
    h.calls.length = 0;

    const preview = await h.preview();
    expect(preview.repo).toBe("acme/tasklet");
    expect(preview.visibility).toBe("private");

    const by = new Map(await Promise.all(preview.items.map(async (item) => [item.signature, item] as const)));
    const would = async (report: Report): Promise<{ would: string; reason: string | null }> => {
      const item = by.get(await h.signatureFor(report.title));
      if (item === undefined) throw new Error(`the preview said nothing about ${report.title}`);
      return { would: item.would, reason: item.reason };
    };

    expect(await would(PAGING)).toEqual({ would: "file", reason: null });
    expect(await would(SEARCH)).toEqual({ would: "file", reason: null });
    // The two that are held back, and for two different reasons: one is below the severity this
    // connection files, the other is a hard skip no filter and no tickbox can waive — somebody
    // saying the product did well is not something to open an issue about.
    expect(await would(TYPO)).toEqual({ would: "skip", reason: "severity" });
    expect(await would(PRAISE)).toEqual({ would: "skip", reason: "praise" });
    expect(preview.wouldFile).toBe(2);
    expect(preview.wouldComment).toBe(0);
    expect(preview.wouldSkip).toBe(2);

    // Nothing was written and nobody was asked. Both matter: a confirmation dialog that filed
    // something in order to tell you what it would file is the worst possible bug in this feature.
    expect(h.calls.filter((name) => WRITES.test(name))).toEqual([]);
    expect(h.github.asked).toEqual([]);
    await h.close();
  });

  it("refuses, in the words the pass uses, when there is nowhere to file", async () => {
    const h = await studio({ policy: filing([SEARCH]), connect: false });
    await h.run();
    await expect(h.preview()).rejects.toThrow(/no repository to file issues into/);
    await h.close();
  });

  /**
   * Naming signatures says which problems to consider, never which rules to waive — the publisher's
   * own rule (`select`), and a preview that got it wrong would show a reader a row as fileable that
   * their press then passed over.
   */
  it("waives the connection's filter for a named problem and no hard skip for any of them", async () => {
    const h = await studio({ policy: filing([TYPO, PRAISE]) });
    await h.run();
    const [typo, praise] = [await h.signatureFor(TYPO.title), await h.signatureFor(PRAISE.title)];

    const named = await h.preview([typo, praise, "nothing-has-this-signature"]);
    expect(named.items.map((item) => [item.signature, item.would, item.reason])).toEqual([
      [typo, "file", null],
      [praise, "skip", "praise"],
      ["nothing-has-this-signature", "skip", "not-found"],
    ]);
    await h.close();
  });

  /**
   * **The agreement test, and the reason this file exists.** The preview is a second copy of the
   * selection policy, so what has to be asserted is that it is the SAME copy: every outcome it
   * promised is the outcome the pass produced, on the same rows, with no digest or edit in between.
   */
  it("said what the pass then did, problem for problem", async () => {
    const h = await studio({ policy: filing([PAGING, SEARCH, TYPO, PRAISE]) });
    await h.run();

    const before = await h.preview();
    const summary = await h.publish();

    const promised = new Map(before.items.map((item) => [item.signature, item]));
    // `filed` and `commented` are the two successes; a preview that says `skip` has to line up with
    // a pass that skipped, and for the same recorded reason.
    for (const result of summary.results) {
      const said = promised.get(result.signature);
      expect(said, `the preview said nothing about ${result.signature}`).toBeDefined();
      if (said === undefined) continue;
      const done = result.outcome === "filed" ? "file" : result.outcome === "commented" ? "comment" : "skip";
      expect(done, `${result.signature}: previewed ${said.would}, pass ${result.outcome}`).toBe(said.would);
      if (result.outcome === "skipped") expect(result.reason).toBe(said.reason);
    }
    expect(summary.filed).toBe(before.wouldFile);
    expect(summary.skipped).toBe(before.wouldSkip);

    // And once they are filed, the same question gets the other answer: a repeat is a comment on
    // the issue that exists, never a second issue.
    const after = await h.preview();
    expect(after.wouldFile).toBe(0);
    expect(after.wouldComment).toBe(2);
    expect(after.items.filter((item) => item.would === "comment").every((item) => item.issue !== null)).toBe(true);
    await h.close();
  });
});

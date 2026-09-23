import { SelfSignupProvider } from "@populace/adapters/self-signup";
import { PopulaceConfigSchema, expandPopulation, newRunId, signatureOf, type Finding, type PopulaceConfig } from "@populace/core";
import { startMockTarget, type RunningMockTarget } from "@populace/mock-target";
import { runWake } from "@populace/runner";
import { ScriptedProvider, byWake, call, field, sequence, type ScriptContext, type ScriptPolicy } from "@populace/runner/testing";
import { SqliteStore } from "@populace/store-sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDigest, clusterFindings, heuristicJudge, normalizeResult, primaryTool, renderDigestMarkdown, signatureHistories, verifyPending, MarkdownFileExporter } from "./index.js";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let target: RunningMockTarget;
beforeAll(async () => {
  target = await startMockTarget({ quiet: true });
});
afterAll(async () => {
  await target.close();
});

const signUp = (ctx: ScriptContext) => {
  const s = /email (\S+), display name "([^"]+)", password (\S+)/.exec(ctx.wakeContext);
  if (!s) throw new Error("no signup suggestion");
  return { calls: [call("sign_up", { email: s[1]!, displayName: s[2]!, password: s[3]! })] };
};
const refOf = (ctx: ScriptContext, name: string, includes = ""): string => ctx.allResults.find((r) => r.name === name && r.text.includes(includes))?.ref ?? "";

/** Persona 1 finds the case-sensitive search bug and the missing delete_task tool. */
const searcher: ScriptPolicy = byWake(
  {
    1: sequence([
      () => ({ calls: [call("get_product_info")] }),
      signUp,
      () => ({ calls: [call("create_project", { name: "Errands" })] }),
      (ctx) => ({ calls: [call("create_task", { projectId: field(ctx.lastResults[0], "id"), title: "Buy Groceries" })] }),
      () => ({ calls: [call("search_tasks", { query: "groceries" })] }),
      () => ({ calls: [call("search_tasks", { query: "Groceries" })] }),
      (ctx) => ({
        calls: [
          call("file_finding", {
            kind: "bug",
            title: "search_tasks is case-sensitive although it says case-insensitive",
            description: "Searching in lower case finds nothing.",
            expected: "'groceries' finds 'Buy Groceries'.",
            observed: "'groceries' returned 0 tasks, 'Groceries' returned 1.",
            severity: "medium",
            confidence: 0.95,
            tool: "search_tasks",
            evidence_calls: [refOf(ctx, "search_tasks", '"groceries"'), refOf(ctx, "search_tasks", '"Groceries"')],
          }),
          call("remember", { kind: "done", text: "Signed up, made project Errands, reported the search bug." }),
        ],
      }),
    ]),
    2: sequence([
      () => ({ calls: [call("list_tasks", {})] }),
      (ctx) => ({
        calls: [
          call("file_finding", {
            kind: "coverage-gap",
            title: "No way to delete a task",
            description: "The product info promises I can delete tasks I no longer need, but the only delete tool removes a whole project.",
            expected: "A delete_task tool exists.",
            observed: "No such tool. Workaround: complete the task and ignore it.",
            severity: "medium",
            confidence: 0.8,
            tool: "delete_task",
            evidence_calls: [refOf(ctx, "get_product_info"), refOf(ctx, "list_tasks")],
          }),
          call("remember", { kind: "annoyance", text: "Cannot delete a single task." }),
        ],
      }),
    ]),
  },
  sequence([]),
);

/** Persona 2 hits the dropped dueDate and independently the search bug (worded differently). */
const planner: ScriptPolicy = byWake(
  {
    1: sequence([
      signUp,
      () => ({ calls: [call("create_project", { name: "Launch" })] }),
      (ctx) => ({ calls: [call("create_task", { projectId: field(ctx.lastResults[0], "id"), title: "Write Announcement", dueDate: "2026-10-01" })] }),
      (ctx) => ({ calls: [call("update_task", { taskId: field(ctx.lastResults[0], "id"), dueDate: "2026-12-24" })] }),
      (ctx) => ({ calls: [call("get_task", { taskId: field(ctx.allResults.find((r) => r.name === "create_task"), "id") })] }),
      (ctx) => ({
        calls: [
          call("file_finding", {
            kind: "bug",
            title: "update_task ignores dueDate",
            description: "I moved the due date and it did not move.",
            expected: "After update_task with dueDate 2026-12-24 the task shows 2026-12-24.",
            observed: "The returned task and get_task both still show 2026-10-01.",
            severity: "high",
            confidence: 0.9,
            tool: "update_task",
            evidence_calls: [refOf(ctx, "create_task"), refOf(ctx, "update_task"), refOf(ctx, "get_task")],
          }),
          call("remember", { kind: "done", text: "Made project Launch; due date bug reported." }),
        ],
      }),
    ]),
    2: sequence([
      () => ({ calls: [call("search_tasks", { query: "announcement" })] }),
      (ctx) => ({
        calls: [
          call("file_finding", {
            kind: "bug",
            title: "search_tasks finds nothing for lower-case query although described as case-insensitive",
            description: "Lower-case search misses my task.",
            expected: "'announcement' matches 'Write Announcement'.",
            observed: "0 results.",
            severity: "medium",
            confidence: 0.8,
            tool: "search_tasks",
            evidence_calls: [refOf(ctx, "search_tasks")],
          }),
        ],
      }),
    ]),
  },
  sequence([]),
);

/** Persona 3 hits the pagination bug, notes friction on the free-plan cap, and gives up. */
const power: ScriptPolicy = byWake(
  {
    1: sequence([
      signUp,
      () => ({ calls: [call("create_project", { name: "P1" }), call("create_project", { name: "P2" }), call("create_project", { name: "P3" })] }),
      () => ({ calls: [call("create_project", { name: "P4" })] }),
      (ctx) => ({
        calls: [
          call("file_finding", {
            kind: "friction",
            title: "Free plan caps projects at 3 without warning up front",
            description: "I only found out about the limit when the fourth project failed.",
            expected: "The limit is visible before I hit it.",
            observed: "create_project returned an error about the free plan.",
            severity: "low",
            confidence: 0.7,
            tool: "create_project",
            evidence_calls: [refOf(ctx, "create_project", "free plan")],
          }),
          call("create_task", { projectId: field(ctx.allResults.find((r) => r.name === "create_project"), "id"), title: "Alpha" }),
        ],
      }),
      () => ({ calls: [call("list_tasks", {})] }),
      () => ({ calls: [call("list_tasks", { page: 1 })] }),
      (ctx) => ({
        calls: [
          call("file_finding", {
            kind: "bug",
            title: "list_tasks page 1 returns an empty page",
            description: "Asking for page 1 explicitly returns nothing although total says 1.",
            expected: "page 1 is the first page and lists my task.",
            observed: "tasks: [] with total: 1.",
            severity: "high",
            confidence: 0.9,
            tool: "list_tasks",
            evidence_calls: [refOf(ctx, "list_tasks", '"page": 1,'), refOf(ctx, "list_tasks", '"page": 1\n')],
          }),
        ],
      }),
      (ctx) => ({
        calls: [
          call("give_up", {
            title: "Leaving: cannot run more than three projects",
            reason: "I manage a dozen projects and the free cap plus the pagination bug make this unusable for me.",
            would_return: true,
            severity: "high",
            evidence_calls: [refOf(ctx, "create_project", "free plan")],
          }),
        ],
      }),
    ]),
  },
  sequence([]),
);

function config(): PopulaceConfig {
  return PopulaceConfigSchema.parse({
    target: { name: "Tasklet", mcp: [{ url: target.mcpUrl }], webBaseUrl: target.url },
    identity: { strategy: "self-signup", signupTool: "sign_up", tokenPath: "token", userIdPath: "user.id", teardownTool: "delete_account" },
    verifier: { judge: "heuristic" },
    population: {
      id: "tasklet",
      members: [
        { persona: { id: "searcher", name: "Sam", role: "a list keeper", backstory: "b", goals: ["g"] } },
        { persona: { id: "planner", name: "Pat", role: "a planner", backstory: "b", goals: ["g"] } },
        { persona: { id: "power", name: "Pia", role: "a power user", backstory: "b", goals: ["g"] } },
      ],
    },
  });
}

describe("reports pipeline against the mock target", () => {
  it("verifies, clusters and renders a digest that lists every planted defect with a reproduction", async () => {
    const store = new SqliteStore(":memory:");
    const cfg = config();
    const runId = newRunId();
    const identityProvider = new SelfSignupProvider(cfg.identity as never);
    const policies: Record<string, ScriptPolicy> = { searcher, planner, power };
    const provider = new ScriptedProvider((ctx) => (policies[ctx.metadata.personaId] ?? sequence([]))(ctx));
    const agents = new Map(expandPopulation(cfg.population, runId, cfg.simulation.id).map((e) => [e.agent.persona.id, e.agent]));
    for (const wakeNumber of [1, 2]) {
      for (const [personaId, agent] of agents) {
        if (personaId === "power" && wakeNumber === 2) continue;
        const result = await runWake({ agent, config: cfg }, { store, provider, identityProvider });
        agents.set(personaId, result.agent);
        expect(["done", "gave-up"]).toContain(result.wake.status);
      }
    }

    const all = await store.listFindings();
    expect(all.map((f) => f.kind).sort()).toEqual(["abandonment", "bug", "bug", "bug", "bug", "coverage-gap", "friction"]);
    for (const f of all) expect(f.reproduction.length).toBeGreaterThan(0);

    const verified = await verifyPending({ store, config: cfg });
    expect(verified).toHaveLength(7);
    const byTitle = new Map(verified.map((f) => [f.title, f.verification!]));
    expect(byTitle.get("search_tasks is case-sensitive although it says case-insensitive")?.verdict).toBe("confirmed");
    expect(byTitle.get("update_task ignores dueDate")?.verdict).toBe("confirmed");
    expect(byTitle.get("list_tasks page 1 returns an empty page")?.verdict).toBe("confirmed");
    expect(byTitle.get("No way to delete a task")?.verdict).toBe("confirmed");
    expect(byTitle.get("No way to delete a task")?.reason).toContain("delete_task");

    const since = new Date(Date.now() - 3_600_000);
    const digest = await buildDigest({ store, config: cfg, since, until: new Date(Date.now() + 60_000) });
    expect(digest.totals.wakes).toBe(5);
    expect(digest.totals.agents).toBe(3);
    expect(digest.totals.findings).toBe(7);
    // the two differently worded search findings cluster together; everything else is distinct
    expect(digest.clusters).toHaveLength(6);
    const search = digest.clusters.find((c) => c.tool === "search_tasks")!;
    expect(search.findings).toHaveLength(2);
    expect(search.personaIds).toEqual(["planner", "searcher"]);
    expect(search.confirmedCount).toBe(2);
    expect(digest.clusters[0]!.severity).toBe("high");

    const markdown = renderDigestMarkdown(digest);
    expect(markdown).toContain("## Bugs");
    expect(markdown).toContain("## Coverage gaps in the MCP surface");
    expect(markdown).toContain("`delete_task`");
    expect(markdown).toContain("search_tasks is case-sensitive");
    expect(markdown).toContain("update_task ignores dueDate");
    expect(markdown).toContain("list_tasks page 1 returns an empty page");
    expect(markdown).toContain('`search_tasks({"query":"groceries"})`');
    expect(markdown).toContain('`update_task({"taskId":');
    expect(markdown).toContain("**Verification:** confirmed");
    expect(markdown).toContain("## Abandonment");
    expect(markdown).toContain("## Friction");

    const outDir = mkdtempSync(join(tmpdir(), "populace-digest-"));
    const exported = await new MarkdownFileExporter().export(digest, { outDir });
    expect(readFileSync(exported.location, "utf8")).toBe(markdown);

    // ---- the signature, end to end ----------------------------------------
    //
    // Every finding carries one, written by the runner at file time from the same (kind, primary
    // tool, title tokens) the clusterer groups on. If that ever stopped being true, "this problem,
    // across every execution" would go back to being a re-clustering instead of a lookup.
    for (const finding of verified) expect(finding.signature).toBe(signatureOf(finding.kind, primaryTool(finding), finding.title));

    // A signature is a function of the finding's CONTENT, so clustering the same findings twice —
    // in a different order, which moves every positional `cluster-N` id — produces the same keys.
    const shuffled = [...verified].reverse();
    const again = clusterFindings(shuffled);
    // Distinct first, THEN equal. Two sets are equal if both collapse to one element, so a
    // `signatureOf` that returned a constant would satisfy the comparison below on its own — and
    // the property this block claims is per-problem keys, not merely order-independent ones.
    expect(new Set(again.map((c) => c.signature)).size).toBe(again.length);
    expect(new Set(digest.clusters.map((c) => c.signature)).size).toBe(digest.clusters.length);
    expect(new Set(again.map((c) => c.signature))).toEqual(new Set(digest.clusters.map((c) => c.signature)));
    // And each of the four planted defects is one of those keys, identically in both clusterings.
    const keyOf = (clusters: { tool?: string; kind: string; signature: string }[], tool: string, kind: string): string | undefined => clusters.find((c) => c.tool === tool && c.kind === kind)?.signature;
    for (const [tool, kind] of [
      ["search_tasks", "bug"],
      ["update_task", "bug"],
      ["list_tasks", "bug"],
      ["delete_task", "coverage-gap"],
    ] as const) {
      const first = keyOf(digest.clusters, tool, kind);
      expect(first, `${tool} has no cluster`).toBeDefined();
      expect(keyOf(again, tool, kind)).toBe(first);
    }

    // ---- per-cohort incidence ---------------------------------------------
    //
    // Agent ids are `populationSlug/cohortSlug.personaSlug#ordinal`, so who was hit is readable
    // from the findings alone; the census supplies the denominator nobody else knows.
    const searchCluster = again.find((c) => c.tool === "search_tasks" && c.kind === "bug")!;
    expect(searchCluster.personIds).toEqual(["planner.planner#1", "searcher.searcher#1"]);
    const census = [
      { slug: "searcher", name: "Searchers", people: 4 },
      { slug: "planner", name: "Planners", people: 3 },
      { slug: "power", name: "Power users", people: 2 },
    ];
    const withCensus = clusterFindings(verified, { census }).find((c) => c.tool === "search_tasks" && c.kind === "bug")!;
    expect(withCensus.cohorts).toEqual([
      { slug: "searcher", name: "Searchers", peopleHit: 1, peopleTotal: 4, reports: 1 },
      { slug: "planner", name: "Planners", peopleHit: 1, peopleTotal: 3, reports: 1 },
      // A cohort that hit nothing still gets a row: "0 of 2" is half of what an incidence bar says.
      { slug: "power", name: "Power users", peopleHit: 0, peopleTotal: 2, reports: 0 },
    ]);

    // ---- across executions -------------------------------------------------
    //
    // Two executions of one ephemeral simulation: the second one no longer reports the search bug
    // and reports one thing the first did not.
    const searchSignature = searchCluster.signature;
    const invented: Finding = { ...verified[0]!, id: "fnd_new", runId: "run_b", title: "create_project silently truncates a long name", tool: "create_project", signature: signatureOf("bug", "create_project", "create_project silently truncates a long name") };
    const executionA = { runId: "run_a", seq: 1, visited: true, findings: verified };
    const executionB = { runId: "run_b", seq: 2, visited: true, findings: [...verified.filter((f) => f.signature !== searchSignature).map((f) => ({ ...f, runId: "run_b" })), invented] };

    const histories = signatureHistories([executionA, executionB]);
    // Present in A, absent from B: the fix landed.
    expect(histories.get(searchSignature)?.state).toBe("fixed");
    expect(histories.get(searchSignature)?.seenIn).toEqual([1]);
    // The reverse — absent from A, present in B — is NOT a regression, it is new. Executions are
    // independent and different people do different things, so one absence is not evidence of a
    // fix and the later presence is not evidence of a relapse (SPEC §4.3).
    expect(histories.get(invented.signature)?.state).toBe("new");
    // Present, absent, present again IS a regression, and is the only shape that earns the word.
    const executionC = { runId: "run_c", seq: 3, visited: true, findings: verified.map((f) => ({ ...f, runId: "run_c" })) };
    const three = signatureHistories([executionA, executionB, executionC]);
    expect(three.get(searchSignature)?.state).toBe("regressed");
    expect(three.get(searchSignature)?.seenIn).toEqual([1, 3]);
    expect(three.get(invented.signature)?.state).toBe("fixed");
    // An execution that made no visits is not evidence of an absence; it says nothing either way.
    const empty = signatureHistories([executionA, { runId: "run_x", seq: 2, visited: false, findings: [] }, executionC]);
    expect(empty.get(searchSignature)?.state).toBe("open");
    // And that holds when it is the LATEST execution, which is the case that matters: a run that
    // has been created and has not visited yet — or one that never got off the ground — would
    // otherwise be read as an absence and call every open problem fixed.
    const pending = signatureHistories([executionA, { runId: "run_x", seq: 2, visited: false, findings: [] }]);
    expect(pending.get(searchSignature)?.state).toBe("new");
    expect(pending.get(searchSignature)?.inLatest).toBe(true);
    expect(pending.get(searchSignature)?.seenIn).toEqual([1]);
    const alsoPending = signatureHistories([executionA, executionB, { runId: "run_y", seq: 3, visited: false, findings: [] }]);
    expect(alsoPending.get(searchSignature)?.state).toBe("fixed");
    expect(alsoPending.get(invented.signature)?.state).toBe("new");

    await store.close();
  });
});

describe("heuristics", () => {
  it("normalises volatile fields", () => {
    expect(normalizeResult({ id: "x", createdAt: "2026-01-01T00:00:00.000Z", title: "T", nested: { taskId: "y", n: 1 } })).toEqual({ id: "<volatile>", createdAt: "<volatile>", title: "T", nested: { taskId: "<volatile>", n: 1 } });
  });

  it("clusters similar titles of the same kind and tool only", () => {
    const base: Finding = {
      id: "a",
      runId: "r",
      tag: "t",
      wakeId: "w",
      agentId: "ag",
      personaId: "p",
      signature: signatureOf("bug", "search_tasks", "search_tasks is case sensitive"),
      kind: "bug",
      title: "search_tasks is case sensitive",
      description: "",
      expected: "",
      observed: "",
      severity: "low",
      confidence: 0.5,
      tool: "search_tasks",
      reproduction: [],
      endpoint: "default",
      identityId: null,
      verification: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const clusters = clusterFindings([
      base,
      { ...base, id: "b", title: "search_tasks case sensitive search", personaId: "q", severity: "high" },
      { ...base, id: "c", title: "search_tasks is case sensitive", kind: "friction" },
      { ...base, id: "d", title: "update_task ignores dueDate", tool: "update_task" },
    ]);
    expect(clusters).toHaveLength(3);
    expect(clusters[0]!.severity).toBe("high");
    expect(clusters[0]!.personaIds).toEqual(["p", "q"]);
  });

  it("marks a coverage gap confirmed only while the tool is missing", () => {
    const finding: Finding = {
      id: "g",
      runId: "r",
      tag: "t",
      wakeId: "w",
      agentId: "ag",
      personaId: "p",
      signature: signatureOf("coverage-gap", "delete_task", "No way to delete a task"),
      kind: "coverage-gap",
      title: "No way to delete a task",
      description: "",
      expected: "",
      observed: "",
      severity: "medium",
      confidence: 0.8,
      tool: "delete_task",
      reproduction: [],
      endpoint: "default",
      identityId: null,
      verification: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(heuristicJudge(finding, { steps: [], toolNames: ["create_task"], identityUsed: null, error: null }).verdict).toBe("confirmed");
    expect(heuristicJudge(finding, { steps: [], toolNames: ["delete_task"], identityUsed: null, error: null }).verdict).toBe("not-reproduced");
    expect(heuristicJudge(finding, { steps: [], toolNames: [], identityUsed: null, error: "down" }).verdict).toBe("inconclusive");
  });
});

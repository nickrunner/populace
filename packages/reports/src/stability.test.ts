import { SelfSignupProvider } from "@populace/adapters/self-signup";
import { PopulaceConfigSchema, expandPopulation, newRunId, type Finding, type PopulaceConfig } from "@populace/core";
import { startMockTarget } from "@populace/mock-target";
import { runWake } from "@populace/runner";
import { ScriptedProvider, call, field, sequence, type ScriptContext, type ScriptPolicy } from "@populace/runner/testing";
import { SqliteStore } from "@populace/store-sqlite";
import { describe, expect, it } from "vitest";
import { clusterFindings } from "./index.js";

/**
 * How stable is a signature, really?
 *
 * ADR-0028 asked for a content key so that "is this the same problem we saw last time?" could be
 * answered without re-clustering. `signatureOf` is that key: a hash of `(kind, primary tool,
 * sorted title tokens)`. The kind and the tool are structural and do not move. **The title is
 * written by a language model, and it is the part that moves.**
 *
 * This file measures the consequence, because the answer decides what the compare screen is
 * allowed to SAY. If signatures recur reliably, `fixed` and `regressed` are verdicts. If they do
 * not, they are warnings and the screen has to admit it. The numbers are INFORMATION: they are
 * recorded in ADR-0028's amendment and printed by the test — though the default reporter `pnpm
 * test` uses does not show a passing test's console output, so reading them takes
 * `pnpm vitest run packages/reports/src/stability.test.ts --reporter=verbose`.
 *
 * Three tiers, all offline against a fresh mock target with `ScriptedProvider`. Each one is a
 * whole ephemeral execution — new run id, new tag, new accounts, new task ids, new timestamps.
 *
 * 1. **Same wording.** Asserted at 1.0, and it is a hard assertion: nothing about an execution may
 *    reach the signature, or every `fixed` on the compare screen is a lie.
 * 2. **Same words, different punctuation and filler.** What the tokenizer is for.
 * 3. **Reworded.** The same complaint said differently, which is what a model actually does. This
 *    is the honest number, and it is not asserted upward — see the comment on that test.
 */

type Defect = "search" | "delete" | "dueDate" | "paging";
type Tier = "same" | "noise" | "reworded";

const PHRASINGS: Record<Defect, Record<Tier, string>> = {
  search: {
    same: "search_tasks is case-sensitive although it says case-insensitive",
    noise: "search_tasks is case-sensitive, although it says: case-insensitive!",
    reworded: "Searching for my task in lower case returns nothing at all",
  },
  delete: {
    same: "No way to delete a task",
    noise: "No way to delete a task.",
    reworded: "There is no tool for removing a single task",
  },
  dueDate: {
    same: "update_task ignores dueDate",
    noise: "update_task ignores the dueDate",
    reworded: "Changing a task's due date does not stick",
  },
  paging: {
    same: "list_tasks page 1 returns an empty page",
    noise: "list_tasks page 1 returns an empty page.",
    reworded: "Task paging is off by one and the first page is empty",
  },
};

const signUp = (ctx: ScriptContext): { calls: ReturnType<typeof call>[] } => {
  const s = /email (\S+), display name "([^"]+)", password (\S+)/.exec(ctx.wakeContext);
  if (!s) throw new Error("no signup suggestion");
  return { calls: [call("sign_up", { email: s[1]!, displayName: s[2]!, password: s[3]! })] };
};

const report = (defect: Defect, tier: Tier, tool: string, kind: "bug" | "coverage-gap", ctx: ScriptContext): ReturnType<typeof call> =>
  call("file_finding", {
    kind,
    title: PHRASINGS[defect][tier],
    description: "What I ran into.",
    expected: "It works the way the description says.",
    observed: "It did not.",
    severity: "medium",
    confidence: 0.9,
    tool,
    evidence_calls: [ctx.lastResults[0]?.ref ?? ""],
  });

/** Signs up, hits the case-sensitive search, and wants a delete that is not there. */
const searcher = (tier: Tier): ScriptPolicy =>
  sequence([
    () => ({ calls: [call("get_product_info")] }),
    signUp,
    () => ({ calls: [call("create_project", { name: "Errands" })] }),
    (ctx) => ({ calls: [call("create_task", { projectId: field(ctx.lastResults[0], "id"), title: "Buy Groceries" })] }),
    () => ({ calls: [call("search_tasks", { query: "groceries" })] }),
    (ctx) => ({ calls: [report("search", tier, "search_tasks", "bug", ctx)] }),
    () => ({ calls: [call("list_tasks", {})] }),
    (ctx) => ({ calls: [report("delete", tier, "delete_task", "coverage-gap", ctx)] }),
    () => ({ calls: [call("done", { summary: "found two things", would_return: true })] }),
  ]);

/** Signs up, moves a due date that does not move, and asks for page 1 of nothing. */
const planner = (tier: Tier): ScriptPolicy =>
  sequence([
    signUp,
    () => ({ calls: [call("create_project", { name: "Launch" })] }),
    (ctx) => ({ calls: [call("create_task", { projectId: field(ctx.lastResults[0], "id"), title: "Write Announcement", dueDate: "2026-10-01" })] }),
    (ctx) => ({ calls: [call("update_task", { taskId: field(ctx.lastResults[0], "id"), dueDate: "2026-12-24" })] }),
    (ctx) => ({ calls: [report("dueDate", tier, "update_task", "bug", ctx)] }),
    () => ({ calls: [call("list_tasks", { page: 1 })] }),
    (ctx) => ({ calls: [report("paging", tier, "list_tasks", "bug", ctx)] }),
    () => ({ calls: [call("done", { summary: "found two things", would_return: true })] }),
  ]);

function configFor(mcpUrl: string, webBaseUrl: string): PopulaceConfig {
  return PopulaceConfigSchema.parse({
    target: { name: "Tasklet", mcp: [{ url: mcpUrl }], webBaseUrl },
    identity: { strategy: "self-signup", signupTool: "sign_up", tokenPath: "token", userIdPath: "user.id", teardownTool: "delete_account" },
    verifier: { judge: "heuristic" },
    population: {
      id: "tasklet",
      members: [
        { persona: { id: "searcher", name: "Searcher", role: "a list keeper", backstory: "b", goals: ["g"] } },
        { persona: { id: "planner", name: "Planner", role: "a planner", backstory: "b", goals: ["g"] } },
      ],
    },
  });
}

/**
 * One execution of the ephemeral simulation: a fresh target, a fresh run id, a fresh cast of
 * accounts. Nothing is carried over, which is exactly what ephemeral means (SPEC §4.1).
 */
async function execute(tier: Tier): Promise<Finding[]> {
  const target = await startMockTarget({ quiet: true });
  const store = new SqliteStore(":memory:");
  try {
    const cfg = configFor(target.mcpUrl, target.url);
    const runId = newRunId();
    const identityProvider = new SelfSignupProvider(cfg.identity as never);
    const policies: Record<string, ScriptPolicy> = { searcher: searcher(tier), planner: planner(tier) };
    const provider = new ScriptedProvider((ctx) => (policies[ctx.metadata.personaId] ?? sequence([]))(ctx));
    for (const { agent } of expandPopulation(cfg.population, runId, cfg.simulation.id)) {
      const result = await runWake({ agent, config: cfg }, { store, provider, identityProvider });
      expect(result.wake.status, result.wake.error ?? "").toBe("done");
    }
    return await store.listFindings({ runIds: [runId] });
  } finally {
    await store.close();
    await target.close();
  }
}

interface Recurrence {
  recurred: number;
  total: number;
  /** The fraction of the first execution's signatures the second one reported too. */
  fraction: number;
  jaccard: number;
}

function recurrence(a: Finding[], b: Finding[]): Recurrence {
  const keysOf = (findings: Finding[]): Set<string> => new Set(clusterFindings(findings).map((c) => c.signature));
  const first = keysOf(a);
  const second = keysOf(b);
  const recurred = [...first].filter((s) => second.has(s)).length;
  const union = new Set([...first, ...second]).size;
  return { recurred, total: first.size, fraction: first.size === 0 ? 0 : recurred / first.size, jaccard: union === 0 ? 0 : recurred / union };
}

/** The measurement is the entire point of this file, so it goes to the console, not to an assertion. */
function announce(label: string, r: Recurrence): void {
  console.log(`[signature stability] ${label}: ${r.recurred}/${r.total} signatures recur (${(r.fraction * 100).toFixed(0)}%), jaccard ${r.jaccard.toFixed(2)}`);
}

describe("signature stability across executions", () => {
  it("carries nothing about the execution into the key: the same complaints twice are the same signatures", async () => {
    const [a, b] = await Promise.all([execute("same"), execute("same")]);
    expect(a).toHaveLength(4);
    expect(b).toHaveLength(4);
    const same = recurrence(a, b);
    announce("identical wording", same);
    // Different run ids, tags, accounts, task ids and timestamps — and the same four keys. If this
    // ever drops below 1, something per-execution has leaked into `signatureOf` and every "fixed"
    // on the compare screen became a lie.
    expect(same.fraction).toBe(1);
  }, 30_000);

  it("absorbs punctuation and filler, which is what tokenising the title is for", async () => {
    const [a, b] = await Promise.all([execute("same"), execute("noise")]);
    const noise = recurrence(a, b);
    announce("punctuation and filler", noise);
    // "update_task ignores dueDate" and "update_task ignores the dueDate" are one problem. The
    // tokenizer drops stopwords, punctuation and words of three letters or fewer, so they hash the
    // same. This is the floor under the number below: rewording that adds no CONTENT word is free.
    expect(noise.fraction).toBe(1);
  }, 30_000);

  it("measures how much survives the model wording the same complaint differently", async () => {
    const [a, b] = await Promise.all([execute("same"), execute("reworded")]);
    const moved = recurrence(a, b);
    announce("reworded from scratch", moved);

    // MEASURED: 0 of 4. And that is not a defect to be tuned away — it is what a hash of an exact
    // token set means. One different content word in the title is a different key, by
    // construction. So the honest reading is:
    //
    //   A signature identifies a problem across executions exactly as well as the model's WORDING
    //   is stable. It is reliable for a run-it-again against the same build, where the same script
    //   produces the same titles, and for triage within one wording. It is NOT reliable enough for
    //   the compare screen to declare "you fixed this" on an absence alone.
    //
    // Stage 8's compare UI therefore states an absence as an absence and not as a verdict, and
    // ADR-0028's amendment carries this number. Loosening the hash (dropping to the tool alone,
    // say) would trade one wrong answer for a worse one: two unrelated problems on one tool would
    // merge and a human's triage would land on the wrong thing. The floor asserted here is the
    // property that actually has to hold — four problems in, four keyed problems out, both times —
    // rather than a number that could be made to look better by weakening the key.
    expect(moved.total).toBe(4);
    expect(clusterFindings(b)).toHaveLength(4);
    for (const finding of [...a, ...b]) expect(finding.signature).toMatch(/^sig1:[0-9a-f]{12}$/);
    // Four problems in, four distinct keys out — each time. `fraction` is not asserted upward for
    // the reason above, and asserting it `>= 0` would assert nothing at all: it is a ratio of two
    // non-negative numbers. This is the property the tier actually establishes, and it is the one
    // a key that collapsed to a constant would fail.
    expect(new Set(a.map((f) => f.signature)).size).toBe(4);
    expect(new Set(b.map((f) => f.signature)).size).toBe(4);
  }, 30_000);
});

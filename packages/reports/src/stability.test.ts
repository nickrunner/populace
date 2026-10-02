import { SelfSignupProvider } from "@populace/adapters/self-signup";
import { PopulaceConfigSchema, expandPopulation, newRunId, type Finding, type PopulaceConfig, type ToolCallRecord, type Verdict } from "@populace/core";
import { startMockTarget } from "@populace/mock-target";
import { runWake } from "@populace/runner";
import { ScriptedProvider, call, field, sequence, type ScriptContext, type ScriptPolicy } from "@populace/runner/testing";
import { SqliteStore } from "@populace/store-sqlite";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { clusterFindings } from "./index.js";
import {
  ENVIRONMENTAL_NOUL_THRESHOLD,
  JEV_INPUT_USD_PER_MTOK,
  RECURRED_CONFIDENCE_FLOOR,
  STATE_CHAR_BUDGET,
  buildJudgeRequest,
  composeVerdict,
  createTypesafeClient,
  typesafeJudge,
  type TypesafeFetch,
} from "./typesafe-judge.js";
import { compareSteps, heuristicJudge, replayFinding, verifyFinding, type ReplayOutcome } from "./verifier.js";

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
 *
 * The second half of the file measures a different thing the same way: **the typed judge against
 * the heuristic one**, on the same replays. Same discipline — a number printed and a bound
 * asserted, rather than a golden value — and the same reason for existing: the answer decides what
 * populace is allowed to SAY, and with the typed judge that copy lands in somebody's GitHub issue.
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

/** What an execution leaves behind, while the target is still up and the store still open. */
interface Execution {
  store: SqliteStore;
  cfg: PopulaceConfig;
  findings: Finding[];
}

/**
 * One execution of the ephemeral simulation: a fresh target, a fresh run id, a fresh cast of
 * accounts. Nothing is carried over, which is exactly what ephemeral means (SPEC §4.1).
 *
 * The callback runs **inside** the execution, before the target closes and the accounts go with
 * it, because the measurements in the second half of the file need a replay that actually ran — and
 * a replay against a torn-down target is refused at the door rather than run (`verifier.ts`), which
 * would make a measurement of nothing look like a measurement of something.
 */
async function inAnExecution<T>(tier: Tier, use: (execution: Execution) => Promise<T>): Promise<T> {
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
    return await use({ store, cfg, findings: await store.listFindings({ runIds: [runId] }) });
  } finally {
    await store.close();
    await target.close();
  }
}

async function execute(tier: Tier): Promise<Finding[]> {
  return inAnExecution(tier, async ({ findings }) => findings);
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

/*
 * ---------------------------------------------------------------------------------------------
 * The typed judge, against the heuristic one, on the same replays
 * ---------------------------------------------------------------------------------------------
 *
 * `typesafe-judge.ts` says in its own comment that its two thresholds "are not yet calibrated" and
 * that "until [this file] says so, the typed judge is not a default". This is that measurement, and
 * the first thing to be honest about is what it can and cannot establish.
 *
 * **It cannot measure the model.** There is no `TYPESAFE_API_KEY` here and nothing leaves the
 * process (offline is a hard rule for this suite), so the model is a SCRIPT: each fixture declares
 * the answer a typed judge that read that evidence correctly would give, and the script returns it
 * through the real client, over the real wire format, parsed by the real schema. What is measured
 * is therefore **populace's half** — the decomposition, the two thresholds, the composition policy,
 * which findings reach a paid judge at all, and what the composed reason says. The model's accuracy
 * on real replays is measured by nobody, and §"what this does not settle" below is why that keeps
 * the typed judge off the default.
 *
 * **It can measure three things that matter**, and each is a pass over the same fixture table with
 * the scripted model behaving differently:
 *
 * 1. *reads the evidence* — the answers a correct judge gives. Agreement with the heuristic is
 *    asserted at 1.0 over every case the heuristic settles confidently, which is the gate the plan
 *    set for offering this judge at all.
 * 2. *unsure* — every answer's confidence just under the floor. The bound asserted is the shape of
 *    the failure: the typed judge DECLINES (`inconclusive`) and never contradicts. An unsure model
 *    costs verdicts, not truth.
 * 3. *confidently wrong* — the opposite answer at 0.97. Agreement is asserted at **0**, because
 *    nothing in the composition catches a confident wrong answer. That is the measurement that
 *    decides the default question, and it is printed rather than hidden.
 *
 * "Confident" is a property of the heuristic, marked per case: its verdict rests on the whole
 * evidence or on a structural fact (a step-for-step match, a tool-list diff, a replay that could not
 * run) rather than on a string comparison standing in for a question about meaning. The cases where
 * it is NOT confident are the cases the typed judge exists for, and the table asserts the
 * disagreement there rather than hiding it — a disagreement the test documents is worth more than
 * one it does not.
 */

const AT = "2026-01-01T00:00:00.000Z";

/** The two option keys on the wire. `typesafe-judge.test.ts` asserts the request offers exactly these. */
const SAME = "same_problem";
const NOT_SAME = "not_the_same_problem";

/** Prose the scripted service volunteers on every answer, so the copy test has something to catch. */
const SMUGGLED = "I reckon the search index is lowercased on write";

const FOUND_NOTHING = '{"tasks":[]}';
const FOUND_THE_TASK = '{"tasks":[{"title":"Buy Groceries"}]}';
const TOOLS_ON_TARGET = ["create_task", "create_project", "search_tasks", "list_tasks", "update_task"];

function stepRecord(ref: string, tool: string, text: string, isError = false): ToolCallRecord {
  return { ref, endpoint: "main", tool, arguments: { query: "groceries" }, result: { text, isError }, latencyMs: 4, traceSeq: 0, at: AT };
}

function fixture(title: string, overrides: Partial<Finding> = {}): Finding {
  return {
    id: `f-${title.length}`,
    runId: "run-1",
    tag: "t1",
    wakeId: "w1",
    agentId: "pop/coh.per#1",
    personaId: "searcher",
    kind: "bug",
    signature: "sig1:abcdef012345",
    title,
    description: "Searching in lower case finds nothing.",
    expected: "'groceries' finds 'Buy Groceries'.",
    observed: "'groceries' returned 0 tasks.",
    severity: "medium",
    confidence: 0.9,
    tool: "search_tasks",
    reproduction: [stepRecord("c1", "create_task", '{"id":"t-1","title":"Buy Groceries"}'), stepRecord("c2", "search_tasks", FOUND_NOTHING)],
    endpoint: "main",
    identityId: null,
    verification: null,
    createdAt: AT,
    ...overrides,
  };
}

function replayOf(steps: ToolCallRecord[], toolNames: string[] = TOOLS_ON_TARGET): ReplayOutcome {
  return { steps, toolNames, identityUsed: null, error: null };
}

/** One answer from the scripted service: a Noul and a Choice, which is all Jev returns. */
interface ScriptedAnswer {
  environmental: number;
  choice: string;
  confidence: number;
}

type ModelBehaviour = "reads-the-evidence" | "unsure" | "confidently-wrong";

interface JudgeCase {
  name: string;
  finding: Finding;
  replay: ReplayOutcome;
  /** What `heuristicJudge` answers on this evidence today. Asserted, so the fixtures cannot rot. */
  heuristic: Verdict;
  /** See the header: whether the heuristic's answer rests on structure rather than on string equality. */
  confident: boolean;
  /** False when the evidence settles it before any paid judge is asked (`settledWithoutAModel`). */
  reachesTheModel: boolean;
  /** The answer a typed judge that read this evidence correctly would give. */
  truth: ScriptedAnswer;
  /** Where the typed pipeline ends up on `truth`. For a case no model is asked about, the heuristic's. */
  typed: Verdict;
}

const WORDING_ONLY = "a difference only in the wording of the result";

const CASES: JudgeCase[] = [
  {
    name: "a clean confirmed replay",
    finding: fixture("search_tasks is case-sensitive although it says case-insensitive"),
    // Ids differ between the two runs and `normalizeResult` strips them, so this is step-for-step
    // identical behaviour — the heuristic's strongest case and the typed judge's easiest.
    replay: replayOf([stepRecord("v1", "create_task", '{"id":"t-9","title":"Buy Groceries"}'), stepRecord("v2", "search_tasks", FOUND_NOTHING)]),
    heuristic: "confirmed",
    confident: true,
    reachesTheModel: true,
    truth: { environmental: 0.02, choice: SAME, confidence: 0.95 },
    typed: "confirmed",
  },
  {
    name: "a clean not-reproduced replay",
    finding: fixture("Lower case search finds nothing at all"),
    // The decisive step now does what the report expected. Both judges should say so.
    replay: replayOf([stepRecord("v1", "create_task", '{"id":"t-9","title":"Buy Groceries"}'), stepRecord("v2", "search_tasks", FOUND_THE_TASK)]),
    heuristic: "not-reproduced",
    confident: true,
    reachesTheModel: true,
    truth: { environmental: 0.03, choice: NOT_SAME, confidence: 0.94 },
    typed: "not-reproduced",
  },
  {
    name: "a mismatch only in a setup step",
    finding: fixture("A due date change does not stick", {
      tool: "update_task",
      reproduction: [stepRecord("c1", "create_project", '{"id":"p-1","name":"Launch"}'), stepRecord("c2", "update_task", '{"id":"t-1","dueDate":"2026-10-01"}')],
    }),
    /*
     * The replay could not recreate the setup — the project is already there from the first pass —
     * but the decisive step behaved exactly as it did originally. This is the deliberate tolerance
     * in `heuristicJudge` (verifier.ts:258-264): setup drift does not cost a confirmation.
     */
    replay: replayOf([
      stepRecord("v1", "create_project", 'a project named "Launch" already exists', true),
      stepRecord("v2", "update_task", '{"id":"t-4","dueDate":"2026-10-01"}'),
    ]),
    heuristic: "confirmed",
    confident: true,
    reachesTheModel: true,
    /*
     * The honest typed answer is a LOW environmental noul, and the reason is worth writing down
     * because it is the whole load the question's wording carries: the `true` criterion is a
     * conjunction — a call failed for a reason outside the behaviour AND "the replay could not
     * exercise the behaviour the report is about". Here the first half holds and the second does
     * not, so the answer is no. A model that reads only the first clause answers yes and a real
     * confirmation is lost; the test below asserts exactly that hazard.
     */
    truth: { environmental: 0.35, choice: SAME, confidence: 0.93 },
    typed: "confirmed",
  },
  {
    name: "a replay that failed environmentally",
    finding: fixture("Searching by tag returns the wrong tasks"),
    replay: replayOf([
      stepRecord("v1", "create_task", "401 unauthorized: the token has expired", true),
      stepRecord("v2", "search_tasks", "401 unauthorized: the token has expired", true),
    ]),
    // The experiment did not run, so there is no observation to report either way.
    heuristic: "inconclusive",
    confident: true,
    reachesTheModel: true,
    // Environmental is what decides it; the choice question is answered in the dark and is ignored.
    truth: { environmental: 0.93, choice: SAME, confidence: 0.4 },
    typed: "inconclusive",
  },
  {
    name: "a coverage gap settled by a tool-list diff",
    finding: fixture("No way to delete a task", {
      kind: "coverage-gap",
      tool: "delete_task",
      reproduction: [stepRecord("c1", "list_tasks", '{"tasks":[{"id":"t-1"}]}')],
    }),
    replay: replayOf([stepRecord("v1", "list_tasks", '{"tasks":[{"id":"t-1"}]}')]),
    heuristic: "confirmed",
    confident: true,
    /*
     * `settledWithoutAModel` hands every coverage gap back to the heuristic whatever the config
     * says, because the question is "is this tool on the list", and a tool list is not a matter of
     * opinion. Most of what keeps a repeating report cycle affordable is this row, so the product
     * path is asserted separately below rather than inferred here.
     */
    reachesTheModel: false,
    truth: { environmental: 0.02, choice: SAME, confidence: 0.9 },
    typed: "confirmed",
  },
  {
    name: WORDING_ONLY,
    finding: fixture("Task search comes back empty for a lower case query"),
    /*
     * Same behaviour, different words: still no tasks, now with a friendly note beside them.
     * `comparable()` is exact equality over normalised JSON, so the note is a different result and
     * the heuristic reports the problem as gone. It is wrong, and this is the case the typed judge
     * was added for.
     */
    replay: replayOf([
      stepRecord("v1", "create_task", '{"id":"t-9","title":"Buy Groceries"}'),
      stepRecord("v2", "search_tasks", '{"tasks":[],"note":"no tasks matched your query"}'),
    ]),
    heuristic: "not-reproduced",
    confident: false,
    reachesTheModel: true,
    truth: { environmental: 0.02, choice: SAME, confidence: 0.9 },
    typed: "confirmed",
  },
];

function answersFor(behaviour: ModelBehaviour, truth: ScriptedAnswer): ScriptedAnswer {
  if (behaviour === "reads-the-evidence") return truth;
  // Just under both bars: the model has an opinion and no confidence in it.
  if (behaviour === "unsure") return { environmental: ENVIRONMENTAL_NOUL_THRESHOLD - 0.1, choice: truth.choice, confidence: RECURRED_CONFIDENCE_FLOOR - 0.1 };
  return { environmental: 0.02, choice: truth.choice === SAME ? NOT_SAME : SAME, confidence: 0.97 };
}

/**
 * The scripted service reads the request it was actually SENT rather than closing over the fixture,
 * so a change that stopped putting the report in the state fails here instead of passing quietly.
 * `JSON.parse` is untyped, so zod narrows it on the spot (ADR-0002) — the same discipline the real
 * client applies to the real response one function along.
 */
const SentRequest = z.object({ state: z.object({ report: z.object({ title: z.string() }) }) });

function scriptedApi(script: { title: string; answer: ScriptedAnswer }[], opts: { inputTokens?: number } = {}): { fetch: TypesafeFetch; asked: string[] } {
  const asked: string[] = [];
  const fetch: TypesafeFetch = async (_url, init) => {
    const sent = SentRequest.parse(JSON.parse(init.body ?? "{}"));
    const title = sent.state.report.title;
    asked.push(title);
    const entry = script.find((s) => s.title === title);
    if (!entry) throw new Error(`the scripted judge was asked about a finding it has no answer for: ${title}`);
    const other = entry.answer.choice === SAME ? NOT_SAME : SAME;
    const body = {
      model: "jev-1.13.0",
      answers: {
        environmental: { type: "noul", noul: entry.answer.environmental },
        recurred: {
          type: "choice",
          choice: entry.answer.choice,
          probabilities: { [entry.answer.choice]: entry.answer.confidence, [other]: Number((1 - entry.answer.confidence).toFixed(2)) },
          confidence: entry.answer.confidence,
          /* Neither a Choice nor a Noul carries prose, but the wire could. None of it may survive. */
          explanation: SMUGGLED,
        },
      },
      // Output is free on Jev, and a big number here is how the cost test proves it is not counted.
      usage: { input_tokens: opts.inputTokens ?? 4_800, output_tokens: 9_000_000 },
    };
    const text = JSON.stringify(body);
    return { ok: true, status: 200, text: async () => text };
  };
  return { fetch, asked };
}

function clientFor(fetchImpl: TypesafeFetch) {
  // No key is read from anywhere: an offline client is handed a string, and the string is asserted
  // absent from every request body by `typesafe-judge.test.ts`.
  return createTypesafeClient({ apiKey: "offline-no-key", fetchImpl, sleep: async () => undefined });
}

interface Judged {
  row: JudgeCase;
  verdict: Verdict;
  reason: string;
  costUsd: number;
}

async function judgeAll(behaviour: ModelBehaviour): Promise<Judged[]> {
  const asked = CASES.filter((c) => c.reachesTheModel);
  const api = scriptedApi(asked.map((c) => ({ title: c.finding.title, answer: answersFor(behaviour, c.truth) })));
  const client = clientFor(api.fetch);
  const out: Judged[] = [];
  for (const row of asked) {
    const decided = await typesafeJudge(row.finding, row.replay, compareSteps(row.finding, row.replay), client);
    out.push({ row, ...decided });
  }
  expect(api.asked).toEqual(asked.map((c) => c.finding.title));
  return out;
}

interface Agreement {
  agreed: number;
  total: number;
  fraction: number;
}

/** As with the signature numbers above: the measurement is the point, so it is printed. */
function announceAgreement(label: string, results: Judged[]): Agreement {
  const confident = results.filter((r) => r.row.confident);
  const agreed = confident.filter((r) => r.verdict === r.row.heuristic);
  const disagreed = confident.filter((r) => r.verdict !== r.row.heuristic).map((r) => `${r.row.name}: heuristic ${r.row.heuristic}, typed ${r.verdict}`);
  const fraction = confident.length === 0 ? 0 : agreed.length / confident.length;
  console.log(
    `[typed judge agreement] ${label}: ${agreed.length}/${confident.length} of the cases the heuristic settles confidently (${(fraction * 100).toFixed(0)}%), over ${results.length} judged${disagreed.length === 0 ? "" : ` — ${disagreed.join(" | ")}`}`,
  );
  return { agreed: agreed.length, total: confident.length, fraction };
}

describe("the typed judge against the heuristic, on the same replays", () => {
  it("answers each fixture the way the heuristic is recorded as answering it", () => {
    // The table's `heuristic` column is the baseline every assertion below compares against, so it
    // is asserted first: a change to `compareSteps` or to the tolerance shows up here as a wrong
    // baseline rather than as a mysterious agreement number.
    for (const row of CASES) expect(heuristicJudge(row.finding, row.replay).verdict, row.name).toBe(row.heuristic);
  });

  it("agrees with the heuristic on every case the heuristic settles confidently", async () => {
    const results = await judgeAll("reads-the-evidence");
    for (const r of results) expect(r.verdict, r.row.name).toBe(r.row.typed);
    const agreement = announceAgreement("model reads the evidence", results);
    // The gate the plan set: the typed judge may not be offered as a default until it agrees with
    // the heuristic where the heuristic is confident. Given answers that read the evidence, it does.
    expect(agreement.fraction).toBe(1);
    expect(agreement.total).toBeGreaterThanOrEqual(4);

    /*
     * And the one disagreement, asserted rather than hidden. Where the replayed result says the
     * same thing in different words, the heuristic reports the problem as gone and the TYPED JUDGE
     * IS RIGHT: `comparable()` is exact equality over normalised JSON, and "no tasks" versus "no
     * tasks, with a note about it" is a wording change, not a behaviour change. A `not-reproduced`
     * here would put "did not recur" into an issue comment about a product that still has the bug —
     * which is the whole reason this judge exists (plan §6b-iii).
     */
    const wording = results.find((r) => r.row.name === WORDING_ONLY);
    expect(wording?.row.heuristic).toBe("not-reproduced");
    expect(wording?.verdict).toBe("confirmed");
  });

  it("declines rather than contradicting when the model is unsure", async () => {
    const results = await judgeAll("unsure");
    /*
     * The bound that matters is the SHAPE of the failure, not its size. Under the floor the typed
     * judge produces no observation at all, on every case, including the ones the heuristic is
     * certain about. So an uncalibrated floor costs verdicts — findings land as "unsure" in a
     * digest and nothing is filed about them — and it cannot manufacture a wrong claim about
     * somebody's product. That is the right way round for copy that reaches a GitHub issue.
     */
    for (const r of results) expect(r.verdict, r.row.name).toBe("inconclusive");
    const agreement = announceAgreement("model is unsure", results);
    // Only the case the heuristic itself called inconclusive still agrees, so agreement collapses.
    expect(agreement.fraction).toBeLessThanOrEqual(0.25);
  });

  it("inherits a confidently wrong answer wholesale, which is the reason it is not a default", async () => {
    const results = await judgeAll("confidently-wrong");
    const agreement = announceAgreement("model is confidently wrong", results);
    /*
     * Zero. Nothing in the decomposition, the thresholds or the composition catches a wrong answer
     * given confidently — typed output guarantees the interface, not the truth. Two of these are
     * worse than a lost verdict:
     *
     *  - the environmental case composes `not-reproduced` over a replay that never ran as the
     *    person who filed the report, which in an issue comment reads as the problem having gone;
     *  - the clean confirmed case composes `not-reproduced` over a step-for-step reproduction.
     *
     * The heuristic cannot do either, because it is not asking anybody. The only thing that bounds
     * how often a real model does is a measurement against real replays, and this suite cannot make
     * one: no network, no key. Hence heuristic stays the default.
     */
    expect(agreement.fraction).toBe(0);
    const environmental = results.find((r) => r.row.name === "a replay that failed environmentally");
    expect(environmental?.row.heuristic).toBe("inconclusive");
    expect(environmental?.verdict).toBe("not-reproduced");
  });

  it("loses a real confirmation if a model reads only the first half of the environmental question", () => {
    /*
     * The hazard named on the setup-step fixture, asserted as arithmetic over `composeVerdict`
     * rather than left as a comment. `ENVIRONMENTAL_NOUL_THRESHOLD` at 0.6 is the ONLY thing
     * standing between a setup call that could not be recreated and a lost confirmation, and which
     * side of it a model lands on depends on it reading the `true` criterion as the conjunction it
     * is. The heuristic is right here and needs no threshold to be: the decisive step behaved
     * identically, so the behaviour under investigation still holds. Recorded so that anyone moving
     * that number can see what it buys and what it costs.
     */
    const row = CASES.find((c) => c.name === "a mismatch only in a setup step");
    if (!row) throw new Error("the setup-step fixture went missing");
    const comparison = compareSteps(row.finding, row.replay);
    const misread = composeVerdict({ environmental: 0.8, recurred: { choice: SAME, probabilities: { [SAME]: 0.93 }, confidence: 0.93 } }, comparison);
    expect(misread.verdict).toBe("inconclusive");
    expect(heuristicJudge(row.finding, row.replay).verdict).toBe("confirmed");
    // Read as the conjunction it is, the same evidence and the same policy land on the heuristic's answer.
    const read = composeVerdict({ environmental: row.truth.environmental, recurred: { choice: SAME, probabilities: { [SAME]: 0.93 }, confidence: 0.93 } }, comparison);
    expect(read.verdict).toBe("confirmed");
  });

  it("is never asked about the findings the evidence already settles, and is asked about the rest", async () => {
    /*
     * The product path, not the fixtures: `verifyFinding` with `judge: "typesafe"` against a live
     * in-process Tasklet, so the routing in `judgement()`/`settledWithoutAModel` is what decides
     * who pays. A coverage gap is a tool-list diff and must cost nothing; a bug with a replay is
     * what the typed judge is for.
     */
    await inAnExecution("same", async ({ store, cfg, findings }) => {
      const config: PopulaceConfig = { ...cfg, verifier: { ...cfg.verifier, judge: "typesafe" } };
      const gap = findings.find((f) => f.kind === "coverage-gap");
      const bug = findings.find((f) => f.kind === "bug" && f.title === PHRASINGS.search.same);
      if (!gap || !bug) throw new Error("the execution did not file the findings this test needs");

      const free = scriptedApi([]);
      const settled = await verifyFinding(gap, { store, config, typesafe: clientFor(free.fetch) });
      expect(settled.judge).toBe("heuristic");
      expect(settled.costUsd).toBe(0);
      expect(free.asked).toEqual([]);

      const paid = scriptedApi([{ title: bug.title, answer: { environmental: 0.02, choice: SAME, confidence: 0.95 } }]);
      const judged = await verifyFinding(bug, { store, config, typesafe: clientFor(paid.fetch) });
      expect(judged.judge).toBe("typesafe");
      expect(judged.costUsd).toBeGreaterThan(0);
      expect(paid.asked).toEqual([bug.title]);
      // A real replay of a real reproduction against a target that still has the defect.
      expect(judged.replay.length).toBe(bug.reproduction.length);
      expect(judged.verdict).toBe("confirmed");
    });
  }, 30_000);

  it("measures the request it builds for real findings and real replays, and leaves the state cap headroom", async () => {
    /*
     * ADR-0044 quotes ~5k input tokens per finding from the price table as an order-of-magnitude
     * ESTIMATE, and this repo's ADRs carry measured numbers. So: measure. Real findings from a real
     * execution against Tasklet, each replayed for real while the target is still up, then the
     * actual request the typed judge would send.
     *
     * Characters, not tokens, because a tokenizer is not a dependency this package is taking — and
     * then divided at a deliberately pessimistic three characters per token, which is the same
     * assumption `STATE_CHAR_BUDGET` is derived from. The API's cap is 32k tokens for `state` plus
     * the longest question; the bound asserted is half of it for `state`, and the whole cap for the
     * whole request, so a finding several times wordier than these still fits.
     */
    const CHARS_PER_TOKEN = 3;
    const STATE_TOKEN_CAP = 32_000;
    const measured = await inAnExecution("same", async ({ store, cfg, findings }) => {
      const rows: { title: string; steps: number; stateChars: number; questionChars: number }[] = [];
      const measure = async (finding: Finding, label: string): Promise<void> => {
        const replay = await replayFinding(finding, { store, config: cfg });
        // A refused replay would make this a measurement of an empty request, which is a
        // measurement of nothing. The accounts are still alive here, so it should never fire.
        expect(replay.error, label).toBeNull();
        const request = buildJudgeRequest(finding, replay);
        rows.push({
          title: label,
          steps: finding.reproduction.length,
          stateChars: JSON.stringify(request.state).length,
          questionChars: JSON.stringify(request.questions).length,
        });
      };
      for (const finding of findings) await measure(finding, finding.title);
      /*
       * And the heavier shape, because the four above each cite one call and that is the thin end
       * of realistic: the runner falls back to the last five target calls whenever the model names
       * no evidence refs, which `give_up` routinely does (plan §6b-ii). So measure a reproduction
       * carrying every call these four findings cite, replayed for real — every argument and every
       * result is one Tasklet actually produced.
       */
      const first = findings[0];
      if (!first) throw new Error("the execution filed nothing to measure");
      await measure({ ...first, reproduction: findings.flatMap((f) => f.reproduction) }, "one finding citing every call the other four cite");
      return rows;
    });

    expect(measured).toHaveLength(5);
    for (const row of measured) {
      console.log(
        `[typed judge request] "${row.title}" (${row.steps} step${row.steps === 1 ? "" : "s"}): state ${row.stateChars} chars ~${Math.ceil(row.stateChars / CHARS_PER_TOKEN)} tokens, questions ${row.questionChars} chars ~${Math.ceil(row.questionChars / CHARS_PER_TOKEN)} tokens`,
      );
    }
    const worstState = Math.max(...measured.map((r) => r.stateChars));
    const worstRequest = Math.max(...measured.map((r) => r.stateChars + r.questionChars));
    console.log(
      `[typed judge request] worst of ${measured.length}: state ${worstState} chars ~${Math.ceil(worstState / CHARS_PER_TOKEN)} tokens; whole request ${worstRequest} chars ~${Math.ceil(worstRequest / CHARS_PER_TOKEN)} tokens, against a 32k-token state cap`,
    );

    expect(worstState).toBeLessThanOrEqual(STATE_CHAR_BUDGET);
    expect(Math.ceil(worstState / CHARS_PER_TOKEN)).toBeLessThan(STATE_TOKEN_CAP / 2);
    expect(Math.ceil(worstRequest / CHARS_PER_TOKEN)).toBeLessThan(STATE_TOKEN_CAP);
  }, 30_000);

  it("bills the input tokens of the request it sent, bills nothing for output, and bills nothing at all when the request failed", async () => {
    const row = CASES[0];
    if (!row) throw new Error("the fixture table is empty");
    const comparison = compareSteps(row.finding, row.replay);

    // 9,000,000 output tokens came back with this answer (see `scriptedApi`) and cost nothing:
    // output is free on Jev, so the bill is one number and it is the input side.
    const api = scriptedApi([{ title: row.finding.title, answer: row.truth }], { inputTokens: 4_800 });
    const decided = await typesafeJudge(row.finding, row.replay, comparison, clientFor(api.fetch));
    expect(decided.costUsd).toBeCloseTo((4_800 / 1_000_000) * JEV_INPUT_USD_PER_MTOK, 12);
    // Three orders of magnitude under an Opus-high verdict on the same evidence, which is what makes
    // a report cycle that turns over by itself affordable at all.
    expect(decided.costUsd).toBeLessThan(0.001);

    /*
     * A request that failed is not charged, and the reason is structural rather than arithmetic: a
     * refusal throws out of the client, so there is no `usage` to multiply and no verdict to attach
     * a cost to. Asserted because the alternative — a caught error with a guessed cost — is the
     * obvious "improvement" somebody could make here, and it would bill a report cycle for answers
     * it never got.
     */
    const refused: TypesafeFetch = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: "invalid api key" }) });
    let charged: number | null = null;
    let said = "";
    try {
      charged = (await typesafeJudge(row.finding, row.replay, comparison, clientFor(refused))).costUsd;
    } catch (err) {
      said = err instanceof Error ? err.message : String(err);
    }
    expect(said).toContain("TYPESAFE_API_KEY");
    expect(charged).toBeNull();

    // And a replay that never ran costs nothing without asking anybody anything.
    const unreplayed: ReplayOutcome = { ...row.replay, error: "could not connect: ECONNREFUSED" };
    const silent = scriptedApi([]);
    const skipped = await typesafeJudge(row.finding, unreplayed, compareSteps(row.finding, unreplayed), clientFor(silent.fetch));
    expect(skipped.costUsd).toBe(0);
    expect(silent.asked).toEqual([]);
  });

  it("composes a reason a GitHub issue can carry, in populace's words only", async () => {
    /*
     * The reason ends up in an issue body, which is the most public copy populace produces. Three
     * rules, over every fixture and all three model behaviours — the whole cross product, because
     * a copy rule that holds only on the happy path is not a copy rule:
     *
     *  1. Nothing a model wrote. Choice and Noul carry no prose; `scriptedApi` volunteers some
     *     anyway, and none of it may appear.
     *  2. None of the forbidden words. "fixed", "verified", "resolved", "regressed" and "no longer
     *     reproducible" are a human's claims about their own product, never populace's, and an
     *     absence is never a repair.
     *  3. None of the four words that do not leave the codebase (ADR-0032/0042) — not "agent", not
     *     "wake", not "simulation", not "lane".
     */
    const FORBIDDEN = /\b(fixed|verified|resolved|regress(ed|ion)?|no longer reproducible)\b/i;
    const NOT_OURS = /\b(agents?|wakes?|simulations?|lanes?)\b/i;
    // Four sentence openings, all of them written here in this repository.
    const POPULACE_S_OWN = /^the typed judge (read the replay|could not tell whether|put the replay's failure|answered with an option|did not answer)/;

    const behaviours: ModelBehaviour[] = ["reads-the-evidence", "unsure", "confidently-wrong"];
    const reasons: string[] = [];
    for (const behaviour of behaviours) for (const r of await judgeAll(behaviour)) reasons.push(r.reason);
    expect(reasons.length).toBe(CASES.filter((c) => c.reachesTheModel).length * behaviours.length);

    for (const reason of reasons) {
      expect(reason).not.toContain(SMUGGLED);
      expect(reason).not.toContain("reckon");
      expect(reason, reason).not.toMatch(FORBIDDEN);
      expect(reason, reason).not.toMatch(NOT_OURS);
      expect(reason, reason).toMatch(POPULACE_S_OWN);
      // Machine option keys stay machine-side; the sentence uses the words populace offered.
      expect(reason).not.toContain(SAME);
      expect(reason).not.toContain(NOT_SAME);
    }

    /*
     * And one thing the typed reason deliberately does NOT carry, asserted because it is a
     * trade-off rather than an oversight: where the heuristic quotes the target's own error text
     * back at the reader, the composed reason quotes nothing a third party wrote. The reader loses
     * the target's words; the issue body gains a guarantee that every string in it came from this
     * repository.
     */
    const environmental = CASES.find((c) => c.name === "a replay that failed environmentally");
    if (!environmental) throw new Error("the environmental fixture went missing");
    const heuristic = heuristicJudge(environmental.finding, environmental.replay);
    expect(heuristic.reason).toContain("401 unauthorized");
    const typed = await judgeAll("reads-the-evidence");
    expect(typed.find((r) => r.row.name === environmental.name)?.reason).not.toContain("401 unauthorized");
  });
});

import { PopulaceConfigSchema, type Finding, type PopulaceConfig, type ToolCallRecord } from "@populace/core";
import { SqliteStore } from "@populace/store-sqlite";
import { describe, expect, it } from "vitest";
import {
  ENVIRONMENTAL_NOUL_THRESHOLD,
  JEV_INPUT_USD_PER_MTOK,
  RECURRED_CONFIDENCE_FLOOR,
  STATE_CHAR_BUDGET,
  TYPESAFE_ENDPOINT,
  TYPESAFE_MAX_ATTEMPTS,
  buildJudgeRequest,
  createTypesafeClient,
  typesafeJudge,
  type TypesafeFetch,
} from "./typesafe-judge.js";
import { compareSteps, verifyFinding, type ReplayOutcome } from "./verifier.js";
/* The package's public surface, imported as a whole because what is asserted about it is what it exports. */
import * as reports from "./index.js";

/**
 * The typed judge, offline. There is no `TYPESAFE_API_KEY` here and nothing leaves the process: a
 * fake `TypesafeFetch` stands in for the API, so every assertion is about what populace *sends* and
 * what it *does with what comes back* rather than about a live model's opinion. This file is the
 * guard on the mechanics.
 *
 * The thresholds themselves are measured next door, in `stability.test.ts`: the same replay
 * fixtures through `heuristicJudge` and through this judge, the agreement printed and bounded, the
 * request size measured on real findings, and the composed reason held to the copy rules. What
 * neither file can measure is the MODEL — offline is a hard rule for this suite — which is why the
 * heuristic judge is still the default.
 */

const AT = "2026-01-01T00:00:00.000Z";

function callRecord(ref: string, tool: string, text: string, isError = false): ToolCallRecord {
  return { ref, endpoint: "main", tool, arguments: { query: "groceries" }, result: { text, isError }, latencyMs: 4, traceSeq: 0, at: AT };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    runId: "run-1",
    tag: "t1",
    wakeId: "w1",
    agentId: "pop/coh.per#1",
    personaId: "searcher",
    kind: "bug",
    signature: "sig1:abcdef012345",
    title: "search_tasks is case-sensitive although it says case-insensitive",
    description: "Searching in lower case finds nothing.",
    expected: "'groceries' finds 'Buy Groceries'.",
    observed: "'groceries' returned 0 tasks.",
    severity: "medium",
    confidence: 0.9,
    tool: "search_tasks",
    reproduction: [callRecord("c1", "create_task", '{"id":"t-1","title":"Buy Groceries"}'), callRecord("c2", "search_tasks", '{"tasks":[]}')],
    endpoint: "main",
    identityId: null,
    verification: null,
    createdAt: AT,
    ...overrides,
  };
}

function replay(overrides: Partial<ReplayOutcome> = {}): ReplayOutcome {
  return {
    steps: [callRecord("v1", "create_task", '{"id":"t-9","title":"Buy Groceries"}'), callRecord("v2", "search_tasks", '{"tasks":[]}')],
    toolNames: ["create_task", "search_tasks"],
    identityUsed: null,
    error: null,
    ...overrides,
  };
}

/** A fake API. `bodies` is what went on the wire; `replies` is what comes back, in order. */
function fakeApi(replies: { status: number; body?: object }[]): { fetch: TypesafeFetch; urls: string[]; headers: Record<string, string>[]; bodies: string[] } {
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  const bodies: string[] = [];
  let next = 0;
  const fetch: TypesafeFetch = async (url, init) => {
    urls.push(url);
    headers.push(init.headers);
    bodies.push(init.body ?? "");
    const reply = replies[Math.min(next, replies.length - 1)];
    next += 1;
    if (!reply) throw new Error("the test ran out of replies");
    const text = JSON.stringify(reply.body ?? {});
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, text: async () => text };
  };
  return { fetch, urls, headers, bodies };
}

function answer(opts: { environmental: number; choice: string; confidence: number; probabilities?: Record<string, number>; inputTokens?: number; extra?: object }): object {
  return {
    model: "jev-1.13.0",
    answers: {
      environmental: { type: "noul", noul: opts.environmental },
      recurred: {
        type: "choice",
        choice: opts.choice,
        probabilities: opts.probabilities ?? { same_problem: opts.confidence, not_the_same_problem: 1 - opts.confidence },
        confidence: opts.confidence,
        ...opts.extra,
      },
    },
    usage: { input_tokens: opts.inputTokens ?? 5000, output_tokens: 20 },
  };
}

const judged = async (reply: object, f = finding(), r = replay()) => {
  const api = fakeApi([{ status: 200, body: reply }]);
  const client = createTypesafeClient({ apiKey: "ts-test-key", fetchImpl: api.fetch, sleep: async () => undefined });
  const decided = await typesafeJudge(f, r, compareSteps(f, r), client);
  return { ...decided, api };
};

describe("the request populace sends", () => {
  it("asks both questions in one request over one shared state", () => {
    const request = buildJudgeRequest(finding(), replay());
    expect(Object.keys(request.questions).sort()).toEqual(["environmental", "recurred"]);
    expect(request.model).toBe("jev-latest");
    expect(request.questions.environmental?.type).toBe("noul");
    expect(Object.keys(request.questions.environmental?.criteria ?? {}).sort()).toEqual(["false", "true"]);
    expect(request.questions.recurred?.type).toBe("choice");
    // Exactly two options, and each one described as a situation rather than named as a label.
    const options = request.questions.recurred?.criteria ?? {};
    expect(Object.keys(options).sort()).toEqual(["not_the_same_problem", "same_problem"]);
    for (const criterion of Object.values(options)) expect(criterion.length).toBeGreaterThan(80);
    // The state carries both sides of the comparison under the names the instructions address.
    expect(Object.keys(request.state).sort()).toEqual(["originalCalls", "replayedAsTheSameAccount", "replayedCalls", "report", "toolsOnTargetNow"]);
  });

  it("goes to the one endpoint with the key as a bearer, and the key appears nowhere else", async () => {
    const { api } = await judged(answer({ environmental: 0.02, choice: "same_problem", confidence: 0.95 }));
    expect(api.urls).toEqual([TYPESAFE_ENDPOINT]);
    expect(api.headers[0]?.authorization).toBe("Bearer ts-test-key");
    expect(api.bodies[0]).not.toContain("ts-test-key");
  });

  it("keeps the state inside the documented budget even when a result is enormous", () => {
    const huge = "x".repeat(400_000);
    const request = buildJudgeRequest(
      finding({ reproduction: [callRecord("c1", "list_tasks", huge)] }),
      replay({ steps: [callRecord("v1", "list_tasks", huge)] }),
    );
    expect(JSON.stringify(request.state).length).toBeLessThanOrEqual(60_000);
  });

  it("keeps the state inside the budget when the REPORT is the enormous part", () => {
    /*
     * The four prose fields are what the person under simulation typed and nothing bounds them.
     * They used to be measured and then sent whole — the trimming only ever dropped calls — so one
     * verbose finding shipped an oversized request, the API refused it, and the refusal took the
     * whole digest down on the finding with the most to say.
     */
    const essay = "y".repeat(400_000);
    const request = buildJudgeRequest(finding({ title: essay, description: essay, expected: essay, observed: essay }), replay());
    expect(JSON.stringify(request.state).length).toBeLessThanOrEqual(STATE_CHAR_BUDGET);
    // And the calls the questions are actually about survived the trim.
    expect(JSON.stringify(request.state)).toContain("search_tasks");
  });

  it("holds the budget when the report, the arguments and the call list are all oversized at once", () => {
    const essay = "z".repeat(50_000);
    const steps = Array.from({ length: 400 }, (_, i) => ({ ...callRecord(`c${i + 1}`, "list_tasks", essay), arguments: { note: essay } }));
    const request = buildJudgeRequest(finding({ description: essay, reproduction: steps }), replay({ steps }));
    expect(JSON.stringify(request.state).length).toBeLessThanOrEqual(STATE_CHAR_BUDGET);
    // Never trimmed down to no evidence: the last calls are the decisive ones and they stay.
    expect(JSON.stringify(request.state)).toContain("list_tasks");
  });
});

describe("what the rest of the product can reach", () => {
  it("exports the client factory, without which judge: typesafe is dead", () => {
    /*
     * `VerifierDeps.typesafe` wants a `TypesafeClient` and `verifyFinding` refuses without one, so
     * a factory that is not exported from the package entry means the configured judge throws on
     * every finding with no way for any caller to prevent it.
     */
    expect(typeof reports.createTypesafeClient).toBe("function");
    const client = reports.createTypesafeClient({ apiKey: "ts-test-key", fetchImpl: fakeApi([{ status: 200, body: {} }]).fetch, sleep: async () => undefined });
    expect(typeof client.ask).toBe("function");
    // And the pieces a call site needs to build one and to say what it built.
    expect(reports.TYPESAFE_ENDPOINT).toBe(TYPESAFE_ENDPOINT);
    expect(reports.JEV_MODEL).toBe("jev-latest");
  });
});

describe("composing the two answers", () => {
  it("reads a confident choice as confirmed", async () => {
    const decided = await judged(answer({ environmental: 0.03, choice: "same_problem", confidence: 0.94, probabilities: { same_problem: 0.96, not_the_same_problem: 0.04 } }));
    expect(decided.verdict).toBe("confirmed");
    expect(decided.reason).toContain("showing the same problem");
    expect(decided.reason).toContain("p=0.96");
  });

  it("reads the other confident choice as not-reproduced", async () => {
    const f = finding();
    const r = replay({ steps: [callRecord("v1", "create_task", '{"id":"t-9"}'), callRecord("v2", "search_tasks", '{"tasks":[{"title":"Buy Groceries"}]}')] });
    const decided = await judged(answer({ environmental: 0.05, choice: "not_the_same_problem", confidence: 0.91, probabilities: { same_problem: 0.09, not_the_same_problem: 0.91 } }), f, r);
    expect(decided.verdict).toBe("not-reproduced");
    expect(decided.reason).toContain("not showing the problem");
    // The mechanical half of the reason is the heuristic judge's own list, verbatim.
    expect(decided.reason).toContain("step 2 (search_tasks) returned a different result");
  });

  it("reads a low-confidence choice as inconclusive, because that is what an absent decision is", async () => {
    const shaky = RECURRED_CONFIDENCE_FLOOR - 0.2;
    const decided = await judged(answer({ environmental: 0.04, choice: "same_problem", confidence: shaky, probabilities: { same_problem: 0.54, not_the_same_problem: 0.46 } }));
    expect(decided.verdict).toBe("inconclusive");
    expect(decided.reason).toContain("could not tell");
    expect(decided.reason).toContain(`under the ${RECURRED_CONFIDENCE_FLOOR} floor`);
    // The distribution is reported in words, not machine option keys.
    expect(decided.reason).toContain("the same problem 0.54, not the same problem 0.46");
    expect(decided.reason).not.toContain("same_problem");
  });

  it("lets a high environmental noul override the choice however confident it is", async () => {
    const decided = await judged(answer({ environmental: ENVIRONMENTAL_NOUL_THRESHOLD + 0.3, choice: "same_problem", confidence: 0.99, probabilities: { same_problem: 0.99, not_the_same_problem: 0.01 } }));
    expect(decided.verdict).toBe("inconclusive");
    expect(decided.reason).toContain("down to the environment");
    expect(decided.reason).not.toContain("confirmed");
  });

  it("does not invent a verdict when the service answers something populace did not ask for", async () => {
    const decided = await judged({ model: "jev-1.13.0", answers: {}, usage: { input_tokens: 100, output_tokens: 0 } });
    expect(decided.verdict).toBe("inconclusive");
    expect(decided.reason).toBe("the typed judge did not answer both questions");
  });

  it("never quotes an option name the service invented", async () => {
    /*
     * `probabilities`' KEYS are a third party's strings — the model can name an option populace
     * never offered — and this sentence is quoted inside a GitHub issue body. Same funnel as every
     * other quoted third-party string: an unknown key is described, never repeated.
     */
    const unsure = await judged(
      answer({ environmental: 0.02, choice: "definitely_broken_lol", confidence: 0.4, probabilities: { definitely_broken_lol: 0.4, same_problem: 0.35, not_the_same_problem: 0.25 } }),
    );
    expect(unsure.verdict).toBe("inconclusive");
    expect(unsure.reason).not.toContain("definitely_broken_lol");
    expect(unsure.reason).toContain("an option populace did not offer");

    const confident = await judged(answer({ environmental: 0.02, choice: "definitely_broken_lol", confidence: 0.98, probabilities: { definitely_broken_lol: 0.98 } }));
    expect(confident.verdict).toBe("inconclusive");
    expect(confident.reason).not.toContain("definitely_broken_lol");
  });

  it("carries nothing a model wrote into the reason", async () => {
    // Choice and Noul return no prose, so there is nothing to leak — this asserts that stays true
    // even when the service volunteers text, because the reason is a GitHub issue body's content.
    const decided = await judged(
      answer({
        environmental: 0.02,
        choice: "same_problem",
        confidence: 0.93,
        extra: { explanation: "I reckon the search index is lowercased on write", rationale: "SMUGGLED PROSE" },
      }),
    );
    expect(decided.reason).not.toContain("SMUGGLED PROSE");
    expect(decided.reason).not.toContain("reckon");
    // Every part of it is either populace's own words, a number, or the mechanical step list.
    expect(decided.reason).toBe("the typed judge read the replay as showing the same problem this report describes (p=0.93, confidence 0.93); all 2 reproduction steps behaved the same on replay");
  });

  it("does not ask anybody when the replay never ran", async () => {
    const api = fakeApi([{ status: 200, body: {} }]);
    const client = createTypesafeClient({ apiKey: "k", fetchImpl: api.fetch, sleep: async () => undefined });
    const r = replay({ error: "could not connect: ECONNREFUSED" });
    const decided = await typesafeJudge(finding(), r, compareSteps(finding(), r), client);
    expect(decided).toEqual({ verdict: "inconclusive", reason: "could not connect: ECONNREFUSED", costUsd: 0 });
    expect(api.urls).toEqual([]);
  });
});

describe("what it costs", () => {
  it("bills input tokens only, because output is free on Jev", async () => {
    const decided = await judged(answer({ environmental: 0.01, choice: "same_problem", confidence: 0.95, inputTokens: 4800 }));
    expect(decided.costUsd).toBeCloseTo((4800 / 1_000_000) * JEV_INPUT_USD_PER_MTOK, 12);
    // For scale: three orders of magnitude under an Opus-high verdict on the same evidence.
    expect(decided.costUsd).toBeLessThan(0.001);
  });
});

describe("when the service will not answer", () => {
  it("backs off a bounded number of times on a rate limit and then says so without quoting the body", async () => {
    const api = fakeApi([{ status: 429, body: { error: "slow down, key ts-secret is over its quota" } }]);
    const slept: number[] = [];
    const client = createTypesafeClient({ apiKey: "ts-secret", fetchImpl: api.fetch, sleep: async (ms) => void slept.push(ms) });
    await expect(client.ask(buildJudgeRequest(finding(), replay()))).rejects.toThrow(/busy \(HTTP 429\) on all 3 attempts/);
    expect(api.urls.length).toBe(TYPESAFE_MAX_ATTEMPTS);
    expect(slept).toEqual([250, 500]);
  });

  it("backs off on an overload the same way", async () => {
    const api = fakeApi([{ status: 529 }, { status: 200, body: answer({ environmental: 0.01, choice: "same_problem", confidence: 0.95 }) }]);
    const slept: number[] = [];
    const client = createTypesafeClient({ apiKey: "k", fetchImpl: api.fetch, sleep: async (ms) => void slept.push(ms) });
    const response = await client.ask(buildJudgeRequest(finding(), replay()));
    expect(response.answers.recurred?.type).toBe("choice");
    expect(api.urls.length).toBe(2);
    expect(slept).toEqual([250]);
  });

  it("does not retry a bad key, and names the environment variable instead of the response", async () => {
    const api = fakeApi([{ status: 401, body: { error: "invalid api key ts-secret" } }]);
    const client = createTypesafeClient({ apiKey: "ts-secret", fetchImpl: api.fetch, sleep: async () => undefined });
    let said = "";
    try {
      await client.ask(buildJudgeRequest(finding(), replay()));
    } catch (err) {
      said = err instanceof Error ? err.message : String(err);
    }
    expect(said).toContain("TYPESAFE_API_KEY");
    expect(said).not.toContain("ts-secret");
    expect(api.urls.length).toBe(1);
  });

  it("does not retry a validation failure, and says the fault is populace's", async () => {
    const api = fakeApi([{ status: 422, body: { error: "questions.recurred.criteria: too few options" } }]);
    const client = createTypesafeClient({ apiKey: "k", fetchImpl: api.fetch, sleep: async () => undefined });
    await expect(client.ask(buildJudgeRequest(finding(), replay()))).rejects.toThrow(/a fault in populace, not in the key/);
    expect(api.urls.length).toBe(1);
  });
});

describe("verifyFinding's choice of judge", () => {
  function config(judge: "typesafe" | "heuristic"): PopulaceConfig {
    return PopulaceConfigSchema.parse({
      target: { name: "Tasklet", mcp: [{ name: "main", url: "http://127.0.0.1:1/mcp" }] },
      identity: { strategy: "none" },
      verifier: { judge },
      population: { id: "p", members: [{ persona: { id: "searcher", name: "Sam", role: "a list keeper", backstory: "b", goals: ["g"] } }] },
    });
  }

  /*
   * A finding naming an account this store has never held is refused by `replayFinding` before any
   * session is opened, which is what keeps this test off the network. It also proves the refusal is
   * about configuration and not about the replay: a missing key is loud even when there was nothing
   * to judge.
   */
  const unreplayable = finding({ identityId: "id-that-was-swept" });

  it("refuses out loud when the typed judge is configured with no client, rather than quietly running the heuristic", async () => {
    const store = new SqliteStore(":memory:");
    await expect(verifyFinding(unreplayable, { store, config: config("typesafe") })).rejects.toThrow(/TYPESAFE_API_KEY/);
    expect(await store.getFinding(unreplayable.id)).toBeUndefined();
  });

  it("hands a coverage gap back to the heuristic rather than paying to classify a tool-list diff", async () => {
    const store = new SqliteStore(":memory:");
    const gap = finding({ kind: "coverage-gap", tool: "delete_task", reproduction: [] });
    await store.saveFinding(gap);
    const api = fakeApi([{ status: 200, body: {} }]);
    const client = createTypesafeClient({ apiKey: "k", fetchImpl: api.fetch, sleep: async () => undefined });
    // The replay cannot reach a target on port 1, so the verdict is the replay's own refusal; what
    // matters is that no request was made to classify it.
    const verification = await verifyFinding(gap, { store, config: config("typesafe"), typesafe: client });
    expect(verification.judge).toBe("heuristic");
    expect(verification.costUsd).toBe(0);
    expect(api.urls).toEqual([]);
  });
});

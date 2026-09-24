import type { ClusterDetailView, Finding, ToolCallRecord } from "@populace/contract";
import { describe, expect, it } from "vitest";

import { buildFixPrompt, clip, isSecretKey, redactJson, redactText } from "./fix-prompt.js";

/**
 * The two things the fix prompt can get catastrophically wrong, asserted directly.
 *
 * This package has no component-rendering tests, so `FindingInFull` is a layout over
 * `buildFixPrompt` and everything worth testing is here.
 *
 * **Redaction is the one that ends the feature if it is wrong.** The text this builds is designed
 * to be pasted into somebody else's chat window, and a `self-signup` target hands every person a
 * bearer token inside a tool result that becomes a reproduction step verbatim. So the bar is not
 * "the redactor has rules"; it is that a known credential shape cannot come out of the assembler
 * at all, which is what `cannot survive` below asserts against the whole prompt rather than
 * against a helper.
 *
 * **Clipping is the one that makes it useless.** A result of eighty properties pasted whole is a
 * prompt nobody sends, and a result cut silently is worse than either — an agent that believes it
 * saw the whole response will reason about fields that were removed.
 */

/** The exact shape `packages/mock-target/src/app.ts` returns from `sign_up`. */
const BEARER = "tk_Qk8vX2hZc3RlbV90b2tlbl9hYmNkZWY";
const PASSWORD = "correct-horse-battery";
const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";

function call(over: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    ref: "c1",
    endpoint: "default",
    tool: "search_tasks",
    arguments: { query: "Groceries" },
    result: { text: `{"tasks":[]}`, isError: false },
    latencyMs: 12,
    traceSeq: 4,
    at: "2026-01-01T10:00:00.000Z",
    ...over,
  };
}

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    runId: "run_1",
    tag: "populace:run_1",
    wakeId: "w1",
    agentId: "everyone/casual-lister#1",
    personaId: "casual-lister",
    kind: "bug",
    signature: "sig1:abcdef123456",
    title: "search misses capitalised tasks",
    description: "I typed the name of a task I had just made and it told me there was nothing.",
    expected: "searching for Groceries finds the task called Groceries",
    observed: "it came back empty until I typed it in lower case",
    severity: "high",
    confidence: 0.8,
    tool: "search_tasks",
    reproduction: [call()],
    endpoint: "default",
    identityId: "id_1",
    verification: null,
    createdAt: "2026-01-01T10:00:00.000Z",
    ...over,
  };
}

function person(over: Partial<ClusterDetailView["peopleHit"][number]> = {}): ClusterDetailView["peopleHit"][number] {
  return {
    id: "everyone/casual-lister#1",
    runId: "run_1",
    personId: "casual-lister.casual-lister#1",
    name: "Dana Whitfield",
    cohortSlug: "casual-lister",
    cohortName: "Casual listers",
    personaSlug: "casual-lister",
    personaName: "Casual lister",
    role: "keeps a short list of errands and checks it twice a week",
    status: "active",
    retiredReason: null,
    continuedFrom: null,
    visits: 3,
    maxVisits: 3,
    findings: 1,
    confirmed: 0,
    costUsd: 0.04,
    wouldReturn: true,
    lastVisitAt: "2026-01-01T10:00:00.000Z",
    nextVisitAt: null,
    account: { email: "dana@populace.test", userId: "u_1" },
    ...over,
  };
}

function cluster(over: Partial<ClusterDetailView> = {}): ClusterDetailView {
  const representative = over.representative ?? finding();
  return {
    signature: representative.signature,
    title: representative.title,
    severity: "high",
    kind: "bug",
    tool: "search_tasks",
    verdict: null,
    peopleTotal: 8,
    reports: 2,
    cohorts: [{ slug: "casual-lister", name: "Casual listers", hit: 2, total: 8 }],
    state: "open",
    seenIn: [1],
    firstSeenAt: "2026-01-01T10:00:00.000Z",
    lastSeenAt: "2026-01-01T10:00:00.000Z",
    triage: null,
    representative,
    quotes: [],
    reproduction: representative.reproduction,
    replay: null,
    peopleHit: [person()],
    peopleMissed: [],
    history: [{ runId: "run_1", seq: 1, reports: 2, verdict: null }],
    product: {
      name: "Tasklet",
      description: "The fastest way to keep a list.",
      endpoints: [{ name: "default", url: "http://127.0.0.1:4310/mcp" }],
    },
    conditions: [{ cohortSlug: "casual-lister", cohortName: "Casual listers", context: "You signed up this morning and have never used a task app before." }],
    ...over,
  };
}

describe("what a key name means", () => {
  it("reads a credential name however it is spelled", () => {
    expect(isSecretKey("token", "anything")).toBe(true);
    expect(isSecretKey("accessToken", "anything")).toBe(true);
    expect(isSecretKey("access_token", "anything")).toBe(true);
    expect(isSecretKey("x-api-key", "anything")).toBe(true);
    expect(isSecretKey("user.refreshToken", "anything")).toBe(true);
    // No separator to split on: the suffix rule is what catches this one.
    expect(isSecretKey("csrftoken", "anything")).toBe(true);
    expect(isSecretKey("Authorization", "anything")).toBe(true);
    expect(isSecretKey("password", "x")).toBe(true);
  });

  it("leaves the evidence alone where a name only looks like one", () => {
    // The exact failure this guard exists for: a target's own error body names the field it did
    // not like, and redacting `{"key": "dueDate"}` destroys the part of the result that IS the bug.
    expect(isSecretKey("key", "dueDate")).toBe(false);
    expect(isSecretKey("code", "not_found")).toBe(false);
    expect(isSecretKey("tokenCount", "4120")).toBe(false);
    expect(isSecretKey("taskId", "task_0192")).toBe(false);
  });

  it("redacts an ambiguous name when the value is shaped like something minted", () => {
    expect(isSecretKey("key", "sk-ant-api03-Zx8y7W6v5U4t3S2r1Q0p")).toBe(true);
    expect(isSecretKey("code", JWT)).toBe(true);
    expect(isSecretKey("key", "aB3dE6gH9jK2mN5pQ8sT1vW4yZ7b")).toBe(true);
    // The OAuth-ish shapes that carry a credential under a bare noun.
    expect(isSecretKey("session", "sess1a2b3c4d5e6f7g8h9i0j")).toBe(true);
    expect(isSecretKey("refresh", "rt1a2b3c4d5e6f7g8h9i0jkl")).toBe(true);
    expect(isSecretKey("session", "expired")).toBe(false);
  });
});

describe("redacting one string", () => {
  it("takes the value out of a JSON pair and leaves the JSON readable", () => {
    const done = redactText(`{"token":"${BEARER}","user":{"id":"u_1"}}`);
    expect(done.text).not.toContain(BEARER);
    expect(done.text).toContain("[redacted: token]");
    expect(done.text).toContain(`"user":{"id":"u_1"}`);
    expect(done.redactions).toBe(1);
  });

  it("takes the whole rest of an auth header, not just the scheme word", () => {
    // The regression this pins: a generic key/value rule stops at the first space and leaves
    // `Authorization: Bearer <token>` with the token intact after the word `Bearer`.
    const done = redactText(`Authorization: Bearer ${BEARER}`);
    expect(done.text).not.toContain(BEARER);
    expect(done.text).toBe("Authorization: [redacted: authorization]");
  });

  it("takes a bearer token that carries no key at all", () => {
    const done = redactText(`the call went out with Bearer ${BEARER} on it`);
    expect(done.text).not.toContain(BEARER);
    expect(done.text).toContain("Bearer [redacted: bearer token]");
  });

  it("takes a token a persona mentioned in a sentence, where there is no key at all", () => {
    // Findings are written by a model that has just been shown the token, so this is not a
    // hypothetical: every key-and-separator rule walks straight past an English sentence.
    const done = redactText(`it said my token was ${BEARER} and then logged me out`);
    expect(done.text).not.toContain(BEARER);
    expect(done.text).toBe("it said my token was [redacted: token] and then logged me out");
  });

  it("takes a JWT wherever it turns up", () => {
    const done = redactText(`something went wrong with ${JWT} apparently`);
    expect(done.text).not.toContain(JWT);
    expect(done.text).toContain("[redacted: jwt]");
  });

  it("takes a vendor-stamped key out of prose", () => {
    const key = "sk-ant-api03-Zx8y7W6v5U4t3S2r1Q0p";
    expect(redactText(`we set it to ${key}`).text).not.toContain(key);
    expect(redactText("ghp_abcdefghijklmnopqrstuvwxyz0123").text).toContain("[redacted: api key]");
  });

  it("keeps the shape of a query string it redacts", () => {
    // The key name stays, so the agent can see WHICH parameter was taken; only the value goes.
    expect(redactText("https://x.test/mcp?api_key=Zx8y7W6v5U4t3S2r1Q0p&page=2").text).toBe(
      "https://x.test/mcp?api_key=[redacted: key]&page=2",
    );
  });

  it("leaves a string with nothing credential-shaped in it exactly as it was", () => {
    const prose = "searching for Groceries found nothing until I typed it in lower case";
    const done = redactText(prose);
    expect(done.text).toBe(prose);
    expect(done.redactions).toBe(0);
  });

  it("counts every value it took, so the prompt can say the transcript is not verbatim", () => {
    expect(redactText(`{"token":"${BEARER}","password":"${PASSWORD}"}`).redactions).toBe(2);
  });
});

describe("redacting a parsed payload", () => {
  it("reaches a credential nested inside arrays and objects", () => {
    const done = redactJson({
      accounts: [{ email: "dana@populace.test", credentials: { bearerToken: BEARER } }],
      page: 1,
    });
    expect(JSON.stringify(done.value)).not.toContain(BEARER);
    expect(JSON.stringify(done.value)).toContain("dana@populace.test");
    expect(done.redactions).toBe(1);
  });

  it("leaves numbers, booleans and nulls alone", () => {
    const done = redactJson({ count: 3, done: true, nothing: null });
    expect(done.value).toEqual({ count: 3, done: true, nothing: null });
    expect(done.redactions).toBe(0);
  });
});

describe("clipping a long value", () => {
  it("leaves a short value whole and unmarked", () => {
    expect(clip("short", 100)).toEqual({ text: "short", clipped: false });
  });

  it("keeps both ends and says how much went from the middle", () => {
    const long = `{"start":true,${"x".repeat(5000)},"end":true}`;
    const cut = clip(long, 400);
    expect(cut.clipped).toBe(true);
    expect(cut.text.length).toBeLessThan(long.length);
    expect(cut.text.startsWith(`{"start":true,`)).toBe(true);
    expect(cut.text.endsWith(`"end":true}`)).toBe(true);
    expect(cut.text).toContain("clipped by populace");
  });

  it("never cuts without leaving the mark that says it did", () => {
    for (const limit of [10, 50, 400, 4000]) {
      const cut = clip("y".repeat(9000), limit);
      expect(cut.clipped).toBe(true);
      expect(cut.text).toContain("[clipped by populace:");
    }
  });
});

describe("the prompt somebody pastes into a coding agent", () => {
  it("carries what the agent needs to find the thing without populace", () => {
    const prompt = buildFixPrompt(cluster());
    expect(prompt.text).toContain("search misses capitalised tasks");
    expect(prompt.text).toContain("Tasklet");
    expect(prompt.text).toContain("The fastest way to keep a list.");
    expect(prompt.text).toContain("search_tasks");
    expect(prompt.text).toContain("http://127.0.0.1:4310/mcp");
    // Reach, intent and the reporters' own words.
    expect(prompt.text).toContain("1 of 8 people");
    expect(prompt.text).toContain("keeps a short list of errands");
    expect(prompt.text).toContain("never used a task app before");
    expect(prompt.text).toContain("searching for Groceries finds the task called Groceries");
    expect(prompt.text).toContain("it came back empty until I typed it in lower case");
    // The reproduction, with the call as it was made.
    expect(prompt.text).toContain("Step 1");
    expect(prompt.text).toContain(`"query": "Groceries"`);
  });

  it("says a report is a report before it says anything else", () => {
    const prompt = buildFixPrompt(cluster());
    const caveat = prompt.text.indexOf("Nobody has re-checked this");
    expect(caveat).toBeGreaterThan(-1);
    // Above the symptom, not in a footnote under it: the recipient is an agent that will act.
    expect(caveat).toBeLessThan(prompt.text.indexOf("## What is wrong"));
    expect(prompt.text).toContain("Confirm it in the source before you fix it");
  });

  it("never claims the problem repeats, and never calls anything fixed", () => {
    const text = buildFixPrompt(cluster({ replay: { verdict: "confirmed", reason: "the search came back empty again", judge: "model", replay: [call()], verifiedAt: "2026-01-02T10:00:00.000Z", costUsd: 0.01 } })).text;
    // ADR-0028, ADR-0030 and DESIGN-SYSTEM §7.3. The word "fixed" is banned outright rather than
    // banned as a claim: it is barred everywhere but the triage control, where a human types it
    // about their own product, and a denial that uses the word still puts it on the page.
    expect(text).not.toMatch(/every time|always happens|reproducible|deterministic|\bfixed\b/i);
    expect(text).toContain("one execution");
  });

  it("puts the judge's verdict and what its replay saw in the prompt", () => {
    const text = buildFixPrompt(
      cluster({
        replay: {
          verdict: "confirmed",
          reason: "the search came back empty again",
          judge: "model",
          replay: [call({ ref: "c1", result: { text: `{"tasks":[]}`, isError: false } })],
          verifiedAt: "2026-01-02T10:00:00.000Z",
          costUsd: 0.01,
        },
      }),
    ).text;
    expect(text).toContain("What the re-check found");
    expect(text).toContain("the search came back empty again");
    expect(text).toContain("A judge replayed the calls below against the same target");
  });

  it("does not put a re-check section on a report nobody re-checked", () => {
    expect(buildFixPrompt(cluster()).text).not.toContain("What the re-check found");
  });

  it("A KNOWN SECRET SHAPE CANNOT SURVIVE THE ASSEMBLER", () => {
    /**
     * The one that decides whether this feature is safe to ship. Every field a credential could
     * ride in on, populated at once: the sign-up call's arguments carry the password, its result
     * carries the bearer token exactly as `mock-target` returns it, a header dump carries an
     * authorization line, and a persona quotes a token in prose because a persona can quote
     * anything it was shown.
     */
    const dirty = cluster({
      representative: finding({
        observed: `it said my token was ${BEARER} and then logged me out`,
        description: `Authorization: Bearer ${JWT}`,
        reproduction: [
          call({
            ref: "c1",
            tool: "sign_up",
            arguments: { email: "dana@populace.test", displayName: "Dana", password: PASSWORD },
            result: { text: `{"token":"${BEARER}","user":{"id":"u_1","email":"dana@populace.test"}}`, isError: false },
          }),
          call({
            ref: "c2",
            tool: "search_tasks",
            arguments: { query: "Groceries", headers: { Authorization: `Bearer ${BEARER}` } },
            result: { text: `{"tasks":[],"debug":{"apiKey":"sk-ant-api03-Zx8y7W6v5U4t3S2r1Q0p"}}`, isError: false },
          }),
        ],
      }),
      product: { name: "Tasklet", description: "Keep a list.", endpoints: [{ name: "default", url: `http://127.0.0.1:4310/mcp?access_token=${BEARER}` }] },
      replay: { verdict: "inconclusive", reason: `the replay used Bearer ${BEARER}`, judge: "model", replay: [call({ result: { text: `{"token":"${BEARER}"}`, isError: false } })], verifiedAt: "2026-01-02T10:00:00.000Z", costUsd: 0.01 },
    });

    const prompt = buildFixPrompt(dirty);
    expect(prompt.text).not.toContain(BEARER);
    expect(prompt.text).not.toContain(PASSWORD);
    expect(prompt.text).not.toContain(JWT);
    expect(prompt.text).not.toContain("sk-ant-api03-Zx8y7W6v5U4t3S2r1Q0p");
    // And it says so, where the reader cannot miss it.
    expect(prompt.redactions).toBeGreaterThan(0);
    expect(prompt.text).toContain("looked like a credential");
    expect(prompt.text).toContain("not verbatim");
    // What is left is still evidence: the calls, the arguments that were not secret, the shape.
    expect(prompt.text).toContain("sign_up");
    expect(prompt.text).toContain("dana@populace.test");
    expect(prompt.text).toContain("[redacted: token]");
  });

  it("says nothing was removed when nothing was", () => {
    const prompt = buildFixPrompt(cluster());
    expect(prompt.redactions).toBe(0);
    expect(prompt.text).toContain("Nothing in the transcript above matched a credential shape");
  });

  it("clips an enormous result and marks every cut", () => {
    const enormous = JSON.stringify({ properties: Array.from({ length: 80 }, (_, i) => ({ id: `p_${i}`, name: `Property ${i}`, blurb: "x".repeat(200) })) });
    const prompt = buildFixPrompt(cluster({ representative: finding({ reproduction: [call({ tool: "searchStays", result: { text: enormous, isError: false } })] }) }));
    expect(prompt.clips).toBeGreaterThan(0);
    expect(prompt.text.length).toBeLessThan(enormous.length);
    expect(prompt.text).toContain("[clipped by populace:");
    expect(prompt.text).toContain("too long to include whole");
  });

  it("gives a failed result far more room than a successful one, because the error is the evidence", () => {
    const body = (marker: string): string => `{"error":"${marker}","detail":"${"d".repeat(3000)}"}`;
    const ok = buildFixPrompt(cluster({ representative: finding({ reproduction: [call({ result: { text: body("ok"), isError: false } })] }) }));
    const bad = buildFixPrompt(cluster({ representative: finding({ reproduction: [call({ result: { text: body("bad"), isError: true } })] }) }));
    expect(ok.clips).toBe(1);
    expect(bad.clips).toBe(0);
    expect(bad.text).toContain("the target flagged this as an error");
  });

  it("fences a payload that contains backticks of its own", () => {
    // A docs tool returns markdown, and a three-backtick fence around it ends early and spills
    // the rest of the evidence into the prose as if the product had written it.
    const markdown = "Use it like this:\n```js\nclient.call()\n```\n";
    const prompt = buildFixPrompt(cluster({ representative: finding({ reproduction: [call({ result: { text: markdown, isError: false } })] }) }));
    expect(prompt.text).toContain("````");
    expect(prompt.text).toContain("client.call()");
  });

  it("says a reproduction is missing rather than pretending there is one", () => {
    const prompt = buildFixPrompt(cluster({ representative: finding({ reproduction: [] }), reproduction: [] }));
    expect(prompt.text).toContain("No tool calls were stored against this report");
  });
});

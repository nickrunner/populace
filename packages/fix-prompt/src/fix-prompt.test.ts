import type { ClusterDetailView, Finding, ToolCallRecord, Verification } from "@populace/contract";
import { describe, expect, it } from "vitest";

import { buildFixPrompt, clip, fitIssueBody, isSecretKey, issueTitleOf, quotableReason, redactJson, redactText, verdictWords } from "./fix-prompt.js";

/**
 * The two things the fix prompt can get catastrophically wrong, asserted directly.
 *
 * Nothing downstream adds anything worth testing: the dashboard's `FindingInFull` is a layout
 * over `buildFixPrompt` and an issue body is the string itself, so everything is here.
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

/** A re-check as the store holds it, so a test can vary one field of it and say which. */
function verification(over: Partial<Verification> = {}): Verification {
  return {
    verdict: "confirmed",
    reason: "the search came back empty again",
    judge: "model",
    replay: [call()],
    verifiedAt: "2026-01-02T10:00:00.000Z",
    costUsd: 0.01,
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
    // A problem the window being read did report, which is the only kind the fix prompt is ever
    // built for: an absence card has nobody to write reproduction steps from.
    inLatest: true,
    state: "open",
    seenIn: [1],
    firstSeenAt: "2026-01-01T10:00:00.000Z",
    lastSeenAt: "2026-01-01T10:00:00.000Z",
    triage: null,
    filedIssue: null,
    representative,
    // Both of these are derived by the read model from ONE list — the reports of this problem in
    // the report WINDOW the evidence comes from (ADR-0045) — so a fixture where they disagree is a
    // fixture that could not happen: two reports, one person who filed them, and seven more who
    // visited in that same window and did not. `peopleMissed` is the rest of that window's own
    // visitors, which is what makes "1 of 8" true of one stretch rather than of two.
    quotes: [
      { personId: "casual-lister.casual-lister#1", name: "Dana Whitfield", cohortSlug: "casual-lister", cohortName: "Casual listers", wakeId: "w1", visitNumber: 1, text: "it came back empty until I typed it in lower case" },
      { personId: "casual-lister.casual-lister#1", name: "Dana Whitfield", cohortSlug: "casual-lister", cohortName: "Casual listers", wakeId: "w2", visitNumber: 2, text: "still nothing for Groceries" },
    ],
    reproduction: representative.reproduction,
    replay: null,
    peopleHit: [person()],
    peopleMissed: [{ cohortSlug: "casual-lister", name: "Casual listers", count: 7 }],
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
    expect(prompt.text).toContain("1 of 8 people who went hit it, filing 2 reports between them");
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

  it("says the verdict in words, not in the enum's spelling", () => {
    const text = buildFixPrompt(cluster({ replay: verification({ verdict: "not-reproduced", reason: "step 1 (search_tasks) returned a different result", judge: "heuristic" }) })).text;
    // `verdictWords`' own phrasing. "not-reproduced" reads to a stranger as "it does not happen",
    // which is a claim about the product that populace cannot make from one replay.
    expect(text).toContain("Verdict: **did not recur**");
    expect(text).not.toContain("not-reproduced");
    expect(buildFixPrompt(cluster({ replay: verification({ verdict: "inconclusive", judge: "heuristic" }) })).text).toContain("Verdict: **unsure**");
    expect(verdictWords("not-reproduced")).toBe("did not recur");
    // The one definition of these words, so the issue and the screen it links to cannot spell the
    // same verdict two ways. `null` is part of the mapping: a verdict that does not exist yet is
    // "not checked yet" everywhere, and a caller left to write that itself writes something else.
    expect(verdictWords(null)).toBe("not checked yet");
    expect(verdictWords("confirmed")).toBe("confirmed");
    expect(verdictWords("inconclusive")).toBe("unsure");
  });

  it("A MODEL JUDGE'S OWN WORDING CANNOT PUT A BANNED CLAIM IN THE ISSUE", () => {
    /**
     * The judge's `reason` is the one unbounded string in this text that populace did not author,
     * and the text is filed as a GitHub issue. A model asked for "one or two sentences" can write
     * anything, including the two things DESIGN-SYSTEM §7.3 forbids outright: that something is
     * fixed, and that it happens every time.
     */
    const text = buildFixPrompt(
      cluster({ replay: verification({ verdict: "confirmed", reason: "The search bug is fixed on the server now, but before that it failed every time I ran it.", judge: "model" }) }),
    ).text;
    expect(text).not.toMatch(/\bfixed\b/i);
    expect(text).not.toContain("every time");
    expect(text).not.toContain("The search bug");
    expect(text).toContain("the wording was withheld");
    // What is withheld is the sentence, not the evidence: the verdict stands above it and the
    // replayed calls are still printed underneath.
    expect(text).toContain("Verdict: **confirmed**");
    expect(text).toContain("search_tasks");
    expect(quotableReason(verification({ reason: "it is no longer reproducible" }))).toBeNull();
  });

  it("quotes a reason that was composed in code, from either judge that composes one", () => {
    const composed = "step 2 (update_task) returned a different result; step 3 (list_tasks) errored on replay but succeeded originally";
    for (const judge of ["heuristic", "typesafe"] as const) {
      const text = buildFixPrompt(cluster({ replay: verification({ judge, reason: composed }) })).text;
      expect(text).toContain(composed);
      expect(text).toContain("composed from the replay");
    }
    // A model reason with nothing wrong in it is still quoted — and attributed, so a sentence
    // populace did not write is not read as populace's claim.
    const quoted = buildFixPrompt(cluster({ replay: verification({ judge: "model", reason: "the search came back empty again" }) })).text;
    expect(quoted).toContain("the search came back empty again");
    expect(quoted).toContain("The judge's own wording");
  });

  it("EVERY REACH NUMBER IS COUNTED OFF THE SAME SET OF RECORDS", () => {
    /**
     * One sentence used to carry three scopes: the people off the execution that reported the
     * problem, the report count off the report WINDOW, and the visits off those people's whole
     * stay. A count that is true of a different scope is a false claim, and this is the most
     * quoted sentence in the issue.
     *
     * So the fixture makes the scopes disagree on purpose: the card says 99 reports, which is the
     * kind of number a window-scoped count and an execution-scoped one differ by, and the prompt
     * must take neither the 99 nor a denominator off `peopleTotal`.
     */
    const text = buildFixPrompt(
      cluster({
        reports: 99,
        peopleTotal: 400,
        quotes: [
          { personId: "p1", name: "Dana Whitfield", cohortSlug: "casual-lister", cohortName: "Casual listers", wakeId: "w1", visitNumber: 1, text: "nothing came back" },
          { personId: "p1", name: "Dana Whitfield", cohortSlug: "casual-lister", cohortName: "Casual listers", wakeId: "w2", visitNumber: 2, text: "still nothing" },
          { personId: "p2", name: "Rafael Ortiz", cohortSlug: "casual-lister", cohortName: "Casual listers", wakeId: "w3", visitNumber: 1, text: "empty for me too" },
        ],
        peopleHit: [person(), person({ id: "everyone/casual-lister#2", personId: "casual-lister.casual-lister#2", name: "Rafael Ortiz", visits: 4 })],
        peopleMissed: [{ cohortSlug: "casual-lister", name: "Casual listers", count: 6 }],
      }),
    ).text;
    // Two people and three reports, both off the same reports; eight who went in that same stretch.
    expect(text).toContain("2 of 8 people who went hit it, filing 3 reports between them.");
    expect(text).not.toContain("99");
    expect(text).not.toContain("400");
    // The visits are the one wider number, on their own line, saying what they are counted over.
    expect(text).toContain("Those people made 7 visits in the whole execution that stretch is part of");
    expect(text).toContain("not only the visits that hit this");
  });

  it("EVERY REACH SENTENCE NAMES THE STRETCH ITS OWN NUMBERS WERE COUNTED OVER", () => {
    /**
     * The fraction is counted over a report WINDOW and the visits over an EXECUTION, and for a
     * longitudinal study those differ sharply: one execution for the study's whole life, one window
     * per report cycle of it (ADR-0030, ADR-0045). So a bare "1 of 2 people who went hit it" in a
     * prompt whose next line says "in that execution" is read as a claim about the execution — and
     * on a study on its twentieth cycle the execution sent twelve people, not two.
     *
     * The fixture is that study: `peopleTotal` 12 is the window census of a card whose own page
     * lists two visitors, and the one person who hit it has nine visits to their name because they
     * have been coming back since cycle one. Every number here is true of exactly one stretch, so
     * the test is whether each SENTENCE says which stretch that is — asserted against the whole
     * line, because the defect is the absence of the clause rather than a wrong number.
     */
    const text = buildFixPrompt(
      cluster({
        peopleTotal: 12,
        reports: 1,
        quotes: [{ personId: "casual-lister.casual-lister#1", name: "Dana Whitfield", cohortSlug: "casual-lister", cohortName: "Casual listers", wakeId: "w9", visitNumber: 9, text: "still empty" }],
        // Nine visits and no cap: a longitudinal study is unbounded and `visitsPerPerson` must be
        // null for one (ADR-0030), which is what a person in it carries as `maxVisits`.
        peopleHit: [person({ visits: 9, maxVisits: null })],
        peopleMissed: [{ cohortSlug: "casual-lister", name: "Casual listers", count: 1 }],
      }),
    ).text;
    const lines = text.split("\n");
    const fraction = lines.filter((line) => line.includes("who went hit it"));
    expect(fraction).toEqual(["- In the stretch of the study this was last reported in: 1 of 2 people who went hit it, filing 1 report between them."]);
    const stay = lines.filter((line) => line.includes("visit"));
    expect(stay).toContain("- That person made 9 visits in the whole execution that stretch is part of — their entire stay, not only the visits that hit this.");
    // The window's census is on the card and is not this page's denominator either way: the page's
    // own two lists are, and the numerator has to be a subset of the denominator it is printed over.
    expect(text).not.toContain("of 12");
  });

  it("says what it could not reconcile when nobody behind the reports is on record", () => {
    /**
     * `peopleHit` empty with reports in hand is the read model failing to match a window's
     * reporters to participant rows of the execution they were filed in — evidence that outlived
     * the rows describing who made it. There is no honest fraction available then, and the sentence
     * that says so names BOTH of the things it failed to reconcile rather than attributing the
     * window's reports to the execution's roster, which is the same conflation in the voice of an
     * apology.
     */
    const text = buildFixPrompt(cluster({ peopleHit: [], peopleMissed: [] })).text;
    expect(text).toContain("- Reach: not recorded — nobody who filed 2 reports of it could be matched to a person the execution it came from still has on record.");
    expect(text).not.toContain("who went hit it");
  });

  it("THE SWEPT-ACCOUNT REASON NEVER REACHES THE ISSUE", () => {
    /**
     * `replayFinding`'s own words when the account that filed a report has been torn down, copied
     * verbatim from `packages/reports/src/verifier.ts`. Three things are wrong with publishing it:
     * it carries a noun that appears in no user-facing copy, it instructs whoever operates
     * populace to change a setting the reader of a GitHub issue does not have, and it used to be
     * printed under a heading saying it was composed from the replay when no replay ran at all.
     */
    const swept =
      "the account that filed this was removed from the target at 2026-01-02T02:49:24.000Z, so there is nobody left to replay as. A simulation with auto-sweep on takes its accounts down as soon as it finishes; verify before the sweep, or run it again with auto-sweep off.";
    const text = buildFixPrompt(cluster({ replay: verification({ verdict: "inconclusive", reason: swept, judge: "heuristic", replay: [] }) })).text;
    expect(text).not.toContain("auto-sweep");
    expect(text).not.toContain("nobody left to replay as");
    // ADR-0032/0042: none of the four words, in the most public copy populace produces.
    expect(text).not.toMatch(/\bagents?\b|\bwakes?\b|\bsimulations?\b|\blanes?\b/i);
    expect(text).not.toContain("composed from the replay");
    // And what it says instead is about this reader's product, in terms they can act on.
    expect(text).toContain("The re-check could not run.");
    expect(text).toContain("Treat it as a lead.");
    expect(text).toContain("There is no second opinion on this report");
    // The blocklist is the backstop under that branch, for the next reason worded internally.
    expect(quotableReason(verification({ reason: swept }))).toBeNull();
    expect(quotableReason(verification({ reason: "the fix was verified against the target" }))).toBeNull();
  });

  it("A VERDICT NO REPLAY DECIDED NEVER CLAIMS A REPLAY", () => {
    /**
     * A coverage gap is a tool-list diff and nothing else (`verifier.ts` `heuristicJudge`): the
     * judge asks the target what it exposes and looks for the tool the person wanted. The calls
     * may still have been re-run on the way — this fixture has them — and the body must not
     * therefore say that replaying them is what settled it.
     */
    const gap = cluster({
      kind: "coverage-gap",
      representative: finding({ kind: "coverage-gap", tool: "delete_task", title: "there is no way to delete a task" }),
      replay: verification({ verdict: "confirmed", reason: "no tool named delete_task among 12 tools on the target", judge: "heuristic", replay: [call()] }),
    });
    const text = buildFixPrompt(gap).text;
    expect(text).not.toContain("A judge replayed the calls below");
    expect(text).toContain("asked the target again which tools it exposes");
    expect(text).toContain("That is a check of what the product offers, not of how it behaves");
    expect(text).toContain("What decided it, composed from the target's tool list:");
    expect(text).toContain("no tool named delete_task among 12 tools on the target");

    // The other half: a tool the target now exposes is not a repair, and does not become one here.
    const back = buildFixPrompt(cluster({ ...gap, replay: verification({ verdict: "not-reproduced", reason: "the target now exposes a tool named delete_task", judge: "heuristic", replay: [] }) })).text;
    expect(back).toContain("it is not a claim that anything has been put right");
    expect(back).not.toMatch(/\bfixed\b|\bresolved\b|\bverified\b/i);
    expect(back).toContain("No calls were replayed. What a coverage gap turns on is the tool list");

    // And a real replay still says what it did, because that claim is the one that is true.
    expect(buildFixPrompt(cluster({ replay: verification({ verdict: "confirmed", judge: "heuristic" }) })).text).toContain("A judge replayed the calls below against the same target");
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

describe("fitting the prompt into a GitHub issue body", () => {
  /** GitHub's own cap. Written out here rather than imported, so the two cannot drift together. */
  const LIMIT = 65_536;

  it("leaves a body that already fits exactly alone", () => {
    const body = "x".repeat(LIMIT);
    const fitted = fitIssueBody(body);
    expect(fitted.truncated).toBe(false);
    expect(fitted.text).toBe(body);
  });

  it("cuts one character over the limit, and says so where the reader can see it", () => {
    // One over is the case that matters: a body refused with a 422 is a filing that failed on
    // the problem with the most evidence behind it, and nothing else would have said why.
    const fitted = fitIssueBody(`${"line of evidence\n".repeat(4000)}${"x".repeat(LIMIT)}`);
    expect(fitted.truncated).toBe(true);
    expect(fitted.text.length).toBeLessThanOrEqual(LIMIT);
    expect(fitted.text).toContain("characters were removed from the END");
    expect(fitted.text).toContain("populace");
  });

  it("keeps the top of the prompt, which is where the caveat and the symptom are", () => {
    const prompt = buildFixPrompt(
      cluster({ representative: finding({ reproduction: Array.from({ length: 40 }, (_, i) => call({ ref: `c${i + 1}`, result: { text: "e".repeat(5000), isError: true } })) }) }),
    );
    const fitted = fitIssueBody(prompt.text);
    expect(fitted.truncated).toBe(true);
    expect(fitted.text.length).toBeLessThanOrEqual(LIMIT);
    expect(fitted.text).toContain("Read this before you change anything");
    expect(fitted.text).toContain("## What is wrong");
  });

  it("A BODY CUT FOR LENGTH STILL CARRIES THE NOTE SAYING IT IS NOT VERBATIM", () => {
    /**
     * The prompt's closing note — how many credential-shaped values were removed, how many results
     * were cut — is the reader's only warning that the transcript in front of them has been
     * altered. It is the LAST thing in the document, and this function cuts from the end, so the
     * body that needs the warning most was the one body that no longer carried it.
     */
    const prompt = buildFixPrompt(
      cluster({
        representative: finding({
          observed: `it said my token was ${BEARER} and then logged me out`,
          reproduction: Array.from({ length: 40 }, (_, i) => call({ ref: `c${i + 1}`, result: { text: "e".repeat(5000), isError: true } })),
        }),
      }),
    );
    expect(prompt.text.length).toBeGreaterThan(LIMIT);
    expect(prompt.redactions).toBeGreaterThan(0);

    const fitted = fitIssueBody(prompt.text);
    expect(fitted.truncated).toBe(true);
    expect(fitted.text.length).toBeLessThanOrEqual(LIMIT);
    expect(fitted.text).toContain("characters were removed from the END");
    expect(fitted.text).toContain("looked like a credential");
    expect(fitted.text).toContain("not verbatim");
    // The note counts over the whole report, including the part just removed, and says so — a
    // number that is right for a wider scope than the sentence it sits under is a false one.
    expect(fitted.text).toContain("counts over the whole report, including the part removed here");
    expect(fitted.text).not.toContain(BEARER);
  });

  it("reserves the note's own length, so a cut lands above it rather than through it", () => {
    // The note is held out of the budget and put back after the cut, which is why a body that is
    // exactly at the limit before the note is added still ends with the note intact.
    const note = "\n\n---\n\n_1 value in the transcript above looked like a credential and was replaced in place._\n";
    const fitted = fitIssueBody(`${"line of evidence\n".repeat(5000)}${note}`);
    expect(fitted.truncated).toBe(true);
    expect(fitted.text.length).toBeLessThanOrEqual(LIMIT);
    expect(fitted.text.endsWith(note)).toBe(true);
    expect(fitted.text).toContain("characters were removed from the END");
  });

  it("closes a code fence the cut landed inside, so the note is not read as more evidence", () => {
    const fitted = fitIssueBody(`Evidence:\n\`\`\`\n${"payload line\n".repeat(6000)}`);
    expect(fitted.truncated).toBe(true);
    const rails = [...fitted.text.matchAll(/^`{3,}$/gm)];
    expect(rails.length % 2).toBe(0);
    expect(fitted.text.trimEnd().endsWith("_")).toBe(true);
  });
});

describe("the issue's title", () => {
  it("redacts the title, because a title lands in a search index", () => {
    // The finding's title is written by a model that has just been handed an account.
    const one = issueTitleOf(cluster({ title: `sign-up said my token was ${BEARER} and then logged me out` }));
    expect(one.title).not.toContain(BEARER);
    expect(one.title).toContain("[redacted:");
    expect(one.redactions).toBe(1);
  });

  it("is one line, short enough to read in a list, and marks its own cut", () => {
    const long = issueTitleOf(cluster({ title: `search\nmisses ${"capitalised tasks ".repeat(20)}` }));
    expect(long.title).not.toContain("\n");
    expect(long.title.length).toBeLessThanOrEqual(120);
    expect(long.title.endsWith("…")).toBe(true);
    expect(long.title.startsWith("search misses capitalised")).toBe(true);
  });

  it("says what it has when the person wrote no title at all", () => {
    const empty = issueTitleOf(cluster({ title: "   " }));
    expect(empty.title).toBe("A bug with no title recorded in search_tasks");
  });
});

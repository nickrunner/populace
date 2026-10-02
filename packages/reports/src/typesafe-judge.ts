import { truncate, type Finding, type JsonObject, type JsonValue, type ToolCallRecord, type Verdict } from "@populace/core";
import { z } from "zod";
/*
 * Type-only, deliberately: `verifier.ts` imports `typesafeJudge` from here, so a value import back
 * the other way would be a runtime cycle. Under `verbatimModuleSyntax` a type import emits no
 * import at all, which is what keeps the edge one-way — verifier owns the replay and the
 * mechanical comparison, this file owns the typed judgement over them.
 */
import type { ReplayOutcome, StepComparison } from "./verifier.js";

/**
 * The typed judge: a System One classification over evidence that already exists, instead of a
 * written verdict from the most expensive model in the table.
 *
 * `VerifierConfigSchema` defaults to `judge: "model"` with `claude-opus-5` at `effort: "high"` and
 * `maxFindings: 50`, which is a defensible price for a digest somebody asked for and an
 * indefensible one for a report cycle that turns over by itself for as long as a study runs. Jev
 * charges $0.042 per million input tokens and nothing at all for output, against Opus-high's $5 in
 * and $25 out, and the question the judge is actually asking — *does this replay show the same
 * problem?* — is a classification, not a generation.
 *
 * Two things follow from that, and both are improvements rather than compromises:
 *
 * 1. The judgement is **decomposed**. One request asks two narrow, independent questions over the
 *    same state: whether the replay failed for a reason about the environment, and whether the
 *    replayed calls showed the problem the report describes. They run in parallel, cannot see each
 *    other, and code composes them — so `inconclusive` stops being a third kind of observation and
 *    becomes what it actually means, the absence of a decision.
 * 2. The `reason` is **composed here, in code**. Choice and Noul return no prose at all, so there
 *    is nothing model-written to carry forward. That matters more than it looks: a verdict's reason
 *    ends up inside a GitHub issue body, the most public copy populace produces, and a deterministic
 *    sentence built from the mechanical mismatch list `heuristicJudge` already computes plus the
 *    model's own probabilities is auditable, reproducible, and cannot leak anything a model
 *    invented.
 */

export const TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

/** The stable alias, so a point release lands without a code change. */
export const JEV_MODEL = "jev-latest";

/** Input only. Output tokens are free, which is why `costUsd` below reads one number. */
export const JEV_INPUT_USD_PER_MTOK = 0.042;

/*
 * Two thresholds, and one warning about both.
 *
 * TypeSafe's docs give three tiers — above 0.9 act automatically, 0.5 to 0.9 proceed with caution,
 * below 0.5 do not act — and are explicit that the numbers scale with the consequences of being
 * wrong and must be validated on the data they will run against. **These two are a starting point,
 * not a universal rule, and they are not yet calibrated**: `packages/reports/src/stability.test.ts`
 * is where that evidence belongs, run against the same replay fixtures as `heuristicJudge`. Until
 * it says so, the typed judge is not a default.
 *
 * They sit at different heights on purpose, because the two questions cost different things to get
 * wrong. Answering "yes, environmental" means *declining to decide*, which is cheap and honest, so
 * that bar sits below the docs' act line. Answering the recurrence question means making a claim
 * about somebody's product in an issue body, so that bar sits at the midpoint of the cautious band
 * rather than at its floor.
 */
export const ENVIRONMENTAL_NOUL_THRESHOLD = 0.6;
export const RECURRED_CONFIDENCE_FLOOR = 0.7;

/**
 * 64k tokens per request, of which `state` plus the longest question may use 32k. Counted in
 * characters because that is what we can measure without a tokenizer, at a deliberately pessimistic
 * three characters per token and with room left for the questions themselves.
 */
export const STATE_CHAR_BUDGET = 60_000;

/** As `describeSteps` in the model judge: enough of a result to judge it by, not the whole payload. */
const MAX_RESULT_CHARS = 1200;
const MIN_RESULT_CHARS = 80;

/**
 * What one of the report's four prose fields may take, and the floor the last resort stops at.
 *
 * The report's fields are model-written and **unbounded**: `title`, `description`, `expected` and
 * `observed` are whatever the person under simulation typed into `file_finding`, and the runner
 * bounds none of them. They are short by convention and nothing enforces the convention, so a
 * single verbose finding used to be measured against the budget and then left in the request whole
 * — the trimming below only ever dropped calls — and the API refuses the request, which fails the
 * whole digest on the one finding with the most to say.
 *
 * Four fields at this share is a fifth of the state budget, which leaves the rest for the calls the
 * questions are actually about.
 */
const REPORT_FIELD_CHARS = 3_000;
const MIN_REPORT_FIELD_CHARS = 200;

/** Bounded, because a report cycle that retries for ever blocks every job behind it. */
export const TYPESAFE_MAX_ATTEMPTS = 3;
const BACKOFF_MS = 250;

// ---- the wire ----

/** The same shape as the provisioning client's, so the workspace has one injectable-fetch idiom. */
export type TypesafeFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface SystemOneQuestion {
  type: "noul" | "choice";
  /** Carries the whole meaning: question ids are for code and are never sent to the model. */
  instructions: string;
  criteria: Record<string, string>;
}

export interface SystemOneRequest {
  state: JsonObject;
  model: string;
  questions: Record<string, SystemOneQuestion>;
}

const NoulAnswerSchema = z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) });
const ChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number().min(0).max(1),
});

const SystemOneResponseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), z.discriminatedUnion("type", [NoulAnswerSchema, ChoiceAnswerSchema])),
  usage: z.object({ input_tokens: z.number().nonnegative(), output_tokens: z.number().nonnegative() }),
});
export type SystemOneResponse = z.infer<typeof SystemOneResponseSchema>;

export interface TypesafeClient {
  ask(request: SystemOneRequest): Promise<SystemOneResponse>;
}

export interface TypesafeClientOptions {
  /** From `TYPESAFE_API_KEY`. Never logged, never carried into a verification, never in a snapshot. */
  apiKey: string;
  fetchImpl?: TypesafeFetch;
  sleep?: (ms: number) => Promise<void>;
  endpoint?: string;
}

const defaultFetch: TypesafeFetch = async (url, init) => {
  const response = await fetch(url, { method: init.method, headers: init.headers, ...(init.body === undefined ? {} : { body: init.body }), signal: AbortSignal.timeout(30_000) });
  return { ok: response.ok, status: response.status, text: () => response.text() };
};

/**
 * One endpoint, so no SDK: a fetch and a schema. The single reason this is a factory rather than a
 * bare function is the two things a test has to replace — the fetch and the sleep between retries.
 *
 * Every failure here is described in populace's own words. The key never appears in a message, and
 * neither does the response body: a judge's failure is reported through a job error, and a raw
 * third-party body in a job error is a body on somebody's screen.
 */
export function createTypesafeClient(options: TypesafeClientOptions): TypesafeClient {
  const endpoint = options.endpoint ?? TYPESAFE_ENDPOINT;
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return {
    async ask(request: SystemOneRequest): Promise<SystemOneResponse> {
      let lastBusyStatus = 0;
      for (let attempt = 1; attempt <= TYPESAFE_MAX_ATTEMPTS; attempt += 1) {
        let response: { ok: boolean; status: number; text(): Promise<string> };
        try {
          response = await fetchImpl(endpoint, {
            method: "POST",
            headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
            body: JSON.stringify(request),
          });
        } catch (err) {
          throw new Error(`the typed judge at ${endpoint} could not be reached: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (response.ok) return parseResponse(await response.text());
        if (response.status === 401) throw new Error("the typed judge refused the key in TYPESAFE_API_KEY; check the key or configure verifier.judge: heuristic");
        // 422 is populace's request being wrong, not the operator's key, and it will be wrong again
        // on the next attempt. Say which of the two it is, or a reader goes looking at their key.
        if (response.status === 422) throw new Error("the typed judge rejected populace's request as malformed (HTTP 422); this is a fault in populace, not in the key");
        if (response.status !== 429 && response.status !== 529) throw new Error(`the typed judge answered HTTP ${response.status}`);
        // Rate limits are documented as adjusting dynamically, so both of these are soft: back off
        // and ask again, a bounded number of times.
        lastBusyStatus = response.status;
        if (attempt < TYPESAFE_MAX_ATTEMPTS) await sleep(BACKOFF_MS * 2 ** (attempt - 1));
      }
      throw new Error(`the typed judge was busy (HTTP ${lastBusyStatus}) on all ${TYPESAFE_MAX_ATTEMPTS} attempts`);
    },
  };
}

function parseResponse(text: string): SystemOneResponse {
  const parsed = SystemOneResponseSchema.safeParse(jsonOf(text));
  if (!parsed.success) throw new Error("the typed judge answered in a shape populace does not recognise; populace may be out of date against the API");
  return parsed.data;
}

function jsonOf(text: string): JsonValue {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- HTTP boundary: untyped until SystemOneResponseSchema narrows it in parseResponse, one line up.
    return JSON.parse(text);
  } catch {
    throw new Error("the typed judge answered with something that is not JSON");
  }
}

// ---- the two questions ----

/**
 * The choice's options. Keys are machine names; the criteria under them are what the model reads,
 * and they describe the two situations concretely rather than naming them — a bare "recurred" or
 * "did not recur" label asks the model to guess what populace means by the word.
 */
const SAME = "same_problem";
const NOT_SAME = "not_the_same_problem";

/** For the composed reason, so no machine key reaches a sentence a person reads. */
const CHOICE_WORDS: Record<string, string> = { [SAME]: "the same problem", [NOT_SAME]: "not the same problem" };

const QUESTIONS: Record<string, SystemOneQuestion> = {
  /*
   * This replaces `/token|unauthori|not found|no longer exists/i` in the heuristic judge — a string
   * match standing in for a semantic question. "not found" is the wrong reason to abandon a verdict
   * when the report is *about* the product failing to find something it should have found, and an
   * expired credential says none of those four things on most products.
   */
  environmental: {
    type: "noul",
    instructions:
      "A person reported a problem with a product by using its tools. `originalCalls` is what they did at the time. `replayedCalls` is those same calls made again just now, and `toolsOnTargetNow` is what the product exposes today. " +
      "If any replayed call failed, decide whether it failed for a reason about the surroundings rather than about the behaviour the report is investigating. Judge only the reason for a failure; do not judge whether the reported problem is real.",
    criteria: {
      true:
        "At least one replayed call failed for a reason outside the behaviour under investigation: a credential that was rejected or has expired, an account or record that no longer exists, a tool the product no longer exposes, a network or server error, or setup data the replay could not recreate. " +
        "The replay could not exercise the behaviour the report is about.",
      false:
        "The replayed calls either succeeded, or failed in a way that is itself about the behaviour the report describes: the product answering a valid request wrongly, rejecting valid input, returning the wrong records, or omitting something it said it would return. " +
        "Also choose this when nothing failed at all.",
    },
  },
  recurred: {
    type: "choice",
    instructions:
      "`originalCalls` is what a person did when they reported a problem with this product, with the results they got. `replayedCalls` is the same calls made again just now, with the results they got now. `report` is what they said was wrong. " +
      "Decide whether the replayed results show the same problem the report describes. Ignore differences in ids, tokens and timestamps: those are expected to differ between the two. Judge the behaviour, not the wording of the results.",
    criteria: {
      [SAME]:
        "The replayed calls show the product doing the thing the report says is wrong — the same wrong records, the same missing capability, the same refusal of valid input, the same dropped field — even if the wording, ordering or ids of the results differ.",
      [NOT_SAME]:
        "The replayed calls show the product doing what the report expected it to do, or show that the report was mistaken about what the product did. The wrong behaviour the report describes is not present in the replayed results.",
    },
  },
};

/**
 * The state both questions read. A JSON object with named fields rather than one prose blob,
 * because the instructions above address its parts by name.
 */
export function buildJudgeRequest(finding: Finding, replay: ReplayOutcome): SystemOneRequest {
  return { state: stateFor(finding, replay), model: JEV_MODEL, questions: QUESTIONS };
}

function reportOf(finding: Finding, share: number): JsonObject {
  return {
    kind: finding.kind,
    severity: finding.severity,
    persona: finding.personaId,
    title: truncate(finding.title, share),
    description: truncate(finding.description, share),
    expected: truncate(finding.expected, share),
    observed: truncate(finding.observed, share),
  };
}

/**
 * The assembled state, and the only thing anything here measures.
 *
 * Every trim below is checked against **this** rather than against the parts, because the tool
 * list, the account flag and the field names are all on the wire too: measuring `[report, calls]`
 * and then sending five named fields is measuring something other than what is sent, and a budget
 * missed by the difference is missed silently.
 */
function stateOf(report: JsonObject, original: JsonObject[], replayed: JsonObject[], replay: ReplayOutcome): JsonObject {
  return {
    report,
    originalCalls: original,
    replayedCalls: replayed,
    toolsOnTargetNow: replay.toolNames,
    /* Whether the replay ran as the person who filed the report, or as nobody. */
    replayedAsTheSameAccount: replay.identityUsed !== null,
  };
}

function stateFor(finding: Finding, replay: ReplayOutcome): JsonObject {
  // Bounded BEFORE the room is measured, or the measurement is of a report that is already too big
  // to send and every trim below is made against a number that cannot come true.
  let report = reportOf(finding, REPORT_FIELD_CHARS);
  const room = STATE_CHAR_BUDGET - JSON.stringify(report).length;
  const calls = finding.reproduction.length + replay.steps.length;
  const cap = Math.max(MIN_RESULT_CHARS, Math.min(MAX_RESULT_CHARS, Math.floor(room / Math.max(1, calls) / 2)));
  let original = finding.reproduction.map((step, i) => describeCall(i, step, cap));
  let replayed = replay.steps.map((step, i) => describeCall(i, step, cap));
  const over = (): boolean => JSON.stringify(stateOf(report, original, replayed, replay)).length > STATE_CHAR_BUDGET;
  /*
   * A last resort that should not fire: reproduction lists are a handful of calls. If one is long
   * enough to blow the budget even clipped, drop from the FRONT — the heuristic judge treats the
   * final step as the decisive one, because the earlier ones are usually setup.
   */
  while (original.length + replayed.length > 2 && over()) {
    if (original.length >= replayed.length) original = original.slice(1);
    else replayed = replayed.slice(1);
  }
  /*
   * And the last resort's last resort: two calls that still will not fit. Previously this fell out
   * of the loop above holding an oversized request and sent it anyway — a 422 that takes the digest
   * down with it. The report is what gives way at this point rather than the two remaining calls,
   * because a question about what the replay did cannot be answered without them, while the report's
   * prose is the part a shorter version of still says the same thing.
   */
  let share = REPORT_FIELD_CHARS;
  while (share > MIN_REPORT_FIELD_CHARS && over()) {
    share = Math.max(MIN_REPORT_FIELD_CHARS, Math.floor(share / 2));
    report = reportOf(finding, share);
  }
  return stateOf(report, original, replayed, replay);
}

function describeCall(index: number, step: ToolCallRecord, cap: number): JsonObject {
  return { step: index + 1, tool: step.tool, arguments: boundedArguments(step.arguments, cap), errored: step.result.isError, result: truncate(step.result.text, cap) };
}

/**
 * A call's arguments are as model-written as the report's prose — the person under simulation chose
 * them, and a `file_finding` report can carry a step whose arguments are a whole document — so they
 * are bounded on the same budget as the result beside them.
 *
 * Over the cap they become the truncated JSON *text* rather than a pruned object, because dropping
 * keys out of an object would present the model with a call that was never made, and the questions
 * above ask it what was actually sent. A truncated string is visibly a fragment.
 */
function boundedArguments(args: JsonValue, cap: number): JsonValue {
  const text = JSON.stringify(args);
  return text.length <= cap ? args : truncate(text, cap);
}

// ---- composing a verdict, and a reason, from the two answers ----

export interface JudgeAnswers {
  /** Probability that the replay's failure was about the environment. A Noul carries no confidence. */
  environmental: number;
  recurred: { choice: string; probabilities: Record<string, number>; confidence: number };
}

/**
 * The policy, written out rather than folded into the question, so it is one readable thing and the
 * two judgements stay reusable:
 *
 *   environmental over its threshold  -> inconclusive, and say what the environment did
 *   recurred confidence under the floor -> inconclusive, because the judge could not tell
 *   otherwise                          -> whichever of the two situations it read
 *
 * The reason is assembled from the answers' own numbers and the mechanical mismatch list the
 * heuristic judge computed over the same replay. Nothing in it was written by a model.
 */
export function composeVerdict(answers: JudgeAnswers, comparison: StepComparison): { verdict: Verdict; reason: string } {
  const mechanics =
    comparison.mismatches.length === 0
      ? `all ${comparison.stepCount} reproduction steps behaved the same on replay`
      : comparison.mismatches.join("; ");

  if (answers.environmental >= ENVIRONMENTAL_NOUL_THRESHOLD) {
    return {
      verdict: "inconclusive",
      reason: `the typed judge put the replay's failure down to the environment rather than to the behaviour under investigation (p=${p(answers.environmental)}, over the ${ENVIRONMENTAL_NOUL_THRESHOLD} threshold); ${mechanics}`,
    };
  }
  const { choice, confidence, probabilities } = answers.recurred;
  if (confidence < RECURRED_CONFIDENCE_FLOOR) {
    return {
      verdict: "inconclusive",
      reason: `the typed judge could not tell whether the replay showed the same problem: confidence ${p(confidence)} is under the ${RECURRED_CONFIDENCE_FLOOR} floor (${distribution(probabilities)}); ${mechanics}`,
    };
  }
  if (choice !== SAME && choice !== NOT_SAME) {
    return { verdict: "inconclusive", reason: `the typed judge answered with an option populace did not offer; ${mechanics}` };
  }
  const read = choice === SAME ? "as showing the same problem this report describes" : "as not showing the problem this report describes";
  return {
    verdict: choice === SAME ? "confirmed" : "not-reproduced",
    reason: `the typed judge read the replay ${read} (p=${p(probabilities[choice] ?? confidence)}, confidence ${p(confidence)}); ${mechanics}`,
  };
}

function p(value: number): string {
  return value.toFixed(2);
}

/**
 * The probabilities, in the words populace offered the model.
 *
 * `probabilities` is parsed as `Record<string, number>`, so its KEYS are a third party's strings:
 * the model can name an option populace never offered, and this sentence ends up in a GitHub issue
 * body. An unknown key is therefore described, never quoted — the same funnel every other quoted
 * third-party string goes through, and the reason the composed reason can be called composed at
 * all.
 */
function distribution(probabilities: Record<string, number>): string {
  return Object.entries(probabilities)
    .sort(([, a], [, b]) => b - a)
    .map(([key, value]) => `${CHOICE_WORDS[key] ?? "an option populace did not offer"} ${p(value)}`)
    .join(", ");
}

/**
 * Asks both questions in one request and composes the answer. `comparison` is the heuristic judge's
 * own mechanical reading of the same replay, passed in rather than recomputed so the two judges
 * cannot drift apart in what they say about the steps.
 */
export async function typesafeJudge(
  finding: Finding,
  replay: ReplayOutcome,
  comparison: StepComparison,
  client: TypesafeClient,
): Promise<{ verdict: Verdict; reason: string; costUsd: number }> {
  if (replay.error) return { verdict: "inconclusive", reason: replay.error, costUsd: 0 };
  const response = await client.ask(buildJudgeRequest(finding, replay));
  // Output tokens are free on Jev, so the whole bill is the state plus the questions we sent.
  const costUsd = (response.usage.input_tokens / 1_000_000) * JEV_INPUT_USD_PER_MTOK;
  const environmental = response.answers.environmental;
  const recurred = response.answers.recurred;
  if (environmental?.type !== "noul" || recurred?.type !== "choice") {
    return { verdict: "inconclusive", reason: "the typed judge did not answer both questions", costUsd };
  }
  const composed = composeVerdict({ environmental: environmental.noul, recurred: { choice: recurred.choice, probabilities: recurred.probabilities, confidence: recurred.confidence } }, comparison);
  return { ...composed, costUsd };
}

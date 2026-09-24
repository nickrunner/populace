import type { ClusterDetailView, JsonValue, ToolCallRecord, Verification } from "@populace/contract";

import { people, plural } from "../format.js";

/**
 * One problem, written out as a prompt somebody can paste into a coding agent pointed at THEIR
 * OWN product's source tree.
 *
 * The reader of this text is not a person reading a bug report. It is an agent that is about to
 * change somebody's code, with no access to populace, no access to this store, and no way to ask
 * a follow-up question. Everything it needs has to be in the string, and everything in the string
 * has to be true — which is what every rule below is for.
 *
 * **It is assembled here, in pure functions, and drawn by `FindingInFull`.** This package has no
 * component-rendering tests (see `digest.ts`), and the two things this feature can get
 * catastrophically wrong — leaking a credential and silently truncating evidence — are both
 * string transforms. So they are functions of their arguments, and `fix-prompt.test.ts` asserts
 * them directly.
 *
 * Four rules, in the order they matter.
 *
 * **1. Nothing shaped like a credential survives.** Reproduction steps are raw tool-call records.
 * On a `self-signup` target the sign-up call's ARGUMENTS carry the person's password and its
 * RESULT carries their bearer token (`packages/mock-target/src/app.ts` returns
 * `{ token: "tk_…" }`), and the whole point of this feature is that the text leaves the product
 * and is pasted somewhere else. Every value that reaches the prompt goes through `redactText`, and
 * the assembled body is swept once more at the end so that a field added later cannot bypass the
 * funnel by being forgotten. Each removal leaves a visible `[redacted: …]` marker, the caveat at
 * the top says the transcript is not verbatim, and the note at the bottom says how many values
 * went — because a transcript that has been altered and does not say so is worse than one that is
 * cut loudly.
 *
 * **2. An unverified claim is labelled as one, at the top.** Most findings have no verdict — a
 * digest built without `?verify=true` judges nothing — and an agent handed "here is a bug" will
 * go and change working code. The first section of the prompt is the caveat, not the symptom.
 *
 * **3. Results can be enormous** — one real `searchStays` result is eighty properties of JSON —
 * and a prompt nobody can afford to send is a prompt nobody sends. Long values are clipped with
 * `clip`, which keeps both ends so the shape stays legible, marks the cut, and says how much went.
 * An error result gets a much larger budget than a success, because the error IS the evidence.
 *
 * **4. Nothing here promises repeatability.** Outcomes vary between executions by design
 * (ADR-0028, ADR-0030). The prompt reports what happened in one window, never that it happens
 * every time, and the word "fixed" does not appear in it at all.
 */

// ---- redaction -------------------------------------------------------------

/**
 * Key names whose value is a credential whatever it looks like.
 *
 * Matched three ways — see `inSet` — none of which is "the name contains one of these". Last
 * segment rather than any segment is the load-bearing part: `accessToken` is a credential and
 * `tokenCount` is a number, and matching anywhere would take the number out of the evidence.
 */
const ALWAYS_SECRET = new Set([
  "token",
  "tokens",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "bearertoken",
  "sessiontoken",
  "authtoken",
  "apitoken",
  "password",
  "passwd",
  "pwd",
  "passphrase",
  "secret",
  "clientsecret",
  "appsecret",
  "apisecret",
  "secretkey",
  "privatekey",
  "signingkey",
  "apikey",
  "xapikey",
  "authorization",
  "proxyauthorization",
  "credential",
  "credentials",
  "cookie",
  "setcookie",
  "sessionid",
  "sessionkey",
  "jwt",
  "bearer",
  "otp",
]);

/**
 * Key names that are a credential only when the value looks like one.
 *
 * `key` and `code` are the reason this second set exists. A target's own error result is full of
 * `{"code": "not_found"}` and `{"key": "dueDate"}`, and redacting those would destroy the exact
 * part of the evidence the agent needs — rule 3's "keep whatever part carries the error" cuts both
 * ways. So these are redacted only when `looksMinted` says the value has the shape of something
 * issued rather than something named.
 */
const MAYBE_SECRET = new Set(["key", "code", "auth", "pin", "sig", "signature", "salt", "session", "sid", "access", "refresh"]);

/**
 * A JWT, which is a credential wherever it appears and whatever it is called.
 *
 * Two spellings of each shape rule below, one global for `replace` and one not for `test`. A
 * global regex carries `lastIndex` across calls, so a single shared constant used both ways
 * answers `false` on every other call — a bug that leaks exactly half of what it is meant to
 * catch, silently.
 */
const JWT = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]{4,})?/g;
const JWT_SHAPE = new RegExp(JWT.source);

/**
 * Credentials whose issuer stamped a recognisable prefix on them. Curated rather than generic: a
 * rule like "any `xx_` followed by twenty characters" also matches `task_01HQ…`, and redacting an
 * id out of a reproduction breaks the reproduction.
 */
const VENDOR_TOKEN =
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}|\bsk_(?:live|test)_[A-Za-z0-9]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bxox[baprse]-[A-Za-z0-9-]{10,}|\bglpat-[A-Za-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[A-Za-z0-9_-]{30,}|\bnpm_[A-Za-z0-9]{30,}|\bshpat_[a-f0-9]{32}\b|\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g;
const VENDOR_SHAPE = new RegExp(VENDOR_TOKEN.source);

/**
 * An auth header, where the value is the whole rest of the line. It is matched before anything
 * else because the generic key/value rule stops at the first space and would leave
 * `Authorization: Bearer <the actual token>` with the token intact after the scheme word.
 */
const AUTH_HEADER = /\b(authorization|proxy-authorization|x-api-key|api-key|cookie|set-cookie)(\\?["']?\s*[:=]\s*\\?["']?)([^\n"'\\]{3,})/gi;

/** `Bearer <token>` anywhere: the scheme word names what follows it, so no key is needed. */
const AUTH_SCHEME = /\b(Bearer|Basic|Digest)\s+([A-Za-z0-9._~+/=-]{8,})/gi;

/**
 * `key: value`, `key=value`, `"key":"value"`, `key is value` — in JSON, in a query string, in a
 * header dump, or in a sentence a persona wrote. The value run deliberately stops at a quote or a
 * backslash so that a closing `"` survives the replacement and the JSON stays readable.
 *
 * **It also stops at `?`, which is not cosmetic.** `replace` advances past a whole match even when
 * the callback returns it unchanged, so in `http://host/mcp?access_token=…` a value run that
 * crossed the `?` would be claimed by the harmless key `http` and the scan would resume AFTER the
 * token — leaking the one credential in the string. Breaking the run at the query mark is what
 * lets `access_token` be seen as a key at all.
 */
const KEY_VALUE = /([A-Za-z][A-Za-z0-9_.-]{0,40})(\\?["']?)(\s*(?::|=|\bis\b)\s*)(\\?["']?)([^\s"'\\,;&?)\]}]{3,})/g;

/**
 * A credential word, and a minted-looking string within a couple of dozen characters of it.
 *
 * The case that needs it: a persona writes *"it said my token was tk_Qk8v…and then logged me
 * out"*. There is no key and no separator — it is a sentence — so every rule above walks past it,
 * and findings are written by a model that has just been shown the token. The window is short and
 * the value still has to pass `looksMinted`, which is what keeps this from eating an id that
 * happens to be mentioned in the same breath.
 */
const SECRET_NEARBY = /\b(?:token|tokens|password|passphrase|secret|credential|credentials|bearer|api[ _-]?key)\b[^\n]{0,24}?([A-Za-z0-9][A-Za-z0-9._~+/=-]{18,}[A-Za-z0-9])/gi;

/** What replaces a removed value. Visible, uniform, and it names what was taken. */
function mark(what: string): string {
  return `[redacted: ${what}]`;
}

/**
 * Whether a value has already been taken. The passes below run over each other's output and the
 * final sweep runs over all of them, so without this a password is replaced, and then the marker
 * standing where it was is matched by the next rule and marked again: `[redacted: password]
 * password]`. Nothing leaks, but the transcript stops being readable, and a reader who cannot read
 * the transcript cannot check the claim.
 */
function alreadyTaken(value: string): boolean {
  return value.startsWith("[redacted:");
}

/** `user.accessToken` → `["user", "access", "token"]`, lowercased. */
function segmentsOf(name: string): string[] {
  return name
    .split(/[^A-Za-z0-9]+/)
    .flatMap((part) => part.split(/(?<=[a-z0-9])(?=[A-Z])/))
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase());
}

function flatten(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Whether a key name means what one of these sets means.
 *
 * Three ways in, because a key name is written three ways in the wild. The whole name flattened
 * catches `x-api-key`; the last segment catches `user.accessToken`; and a SUFFIX of five
 * characters or more catches `mytoken` and `csrfToken`, where there is no separator to split on.
 * Five is the floor that keeps the suffix rule from turning `spin` into a credential because of
 * `pin` — the short ambiguous names still have to match a whole name or a whole segment.
 */
function inSet(set: ReadonlySet<string>, name: string): boolean {
  const flat = flatten(name);
  if (set.has(flat)) return true;
  const last = segmentsOf(name).at(-1);
  if (last !== undefined && set.has(last)) return true;
  for (const member of set) if (member.length >= 5 && flat.endsWith(member)) return true;
  return false;
}

/**
 * Whether a string has the shape of something a machine ISSUED rather than something a human
 * named: long, drawn from a token alphabet, and mixing letters with digits. A slug, a sentence, an
 * ISO timestamp (the colons disqualify it) and an error code all fall outside it.
 */
function looksMinted(value: string): boolean {
  if (JWT_SHAPE.test(value) || VENDOR_SHAPE.test(value)) return true;
  if (value.length < 20) return false;
  if (!/^[A-Za-z0-9._~+/=-]+$/.test(value)) return false;
  return /[0-9]/.test(value) && /[A-Za-z]/.test(value);
}

/** Whether a key name means "the value beside me is a credential", given that value. */
export function isSecretKey(name: string, value: string): boolean {
  if (inSet(ALWAYS_SECRET, name)) return true;
  return inSet(MAYBE_SECRET, name) && looksMinted(value);
}

export interface Redacted {
  text: string;
  /** How many values were removed. Zero means the text below is verbatim. */
  redactions: number;
}

/**
 * Every credential shape this knows about, removed from one string.
 *
 * Applied to every value that reaches the prompt AND once more to the assembled body, so that a
 * field added to this file next month is covered whether or not whoever added it remembered to
 * call this. The passes run most specific first: an auth header consumes its whole line before the
 * generic key/value rule can stop at the space after `Bearer`.
 */
export function redactText(input: string): Redacted {
  let redactions = 0;
  let text = input;

  text = text.replace(AUTH_HEADER, (whole, name: string, joiner: string, value: string) => {
    if (alreadyTaken(value)) return whole;
    redactions += 1;
    return `${name}${joiner}${mark("authorization")}`;
  });

  text = text.replace(AUTH_SCHEME, (_whole, scheme: string) => {
    redactions += 1;
    return `${scheme} ${mark("bearer token")}`;
  });

  // The separator is captured and put back verbatim: `token=abc` stays a query parameter and
  // `"token": "abc"` stays JSON, so what the agent reads is the target's own shape with one value
  // missing rather than a reformatted approximation of it.
  text = text.replace(KEY_VALUE, (whole, name: string, openQuote: string, separator: string, valueQuote: string, value: string) => {
    if (alreadyTaken(value) || !isSecretKey(name, value)) return whole;
    redactions += 1;
    return `${name}${openQuote}${separator}${valueQuote}${mark(segmentsOf(name).at(-1) ?? "secret")}`;
  });

  text = text.replace(SECRET_NEARBY, (whole, value: string) => {
    if (alreadyTaken(value) || !looksMinted(value)) return whole;
    redactions += 1;
    return `${whole.slice(0, whole.length - value.length)}${mark("token")}`;
  });

  text = text.replace(JWT, () => {
    redactions += 1;
    return mark("jwt");
  });

  text = text.replace(VENDOR_TOKEN, () => {
    redactions += 1;
    return mark("api key");
  });

  return { text, redactions };
}

export interface RedactedJson {
  value: JsonValue;
  redactions: number;
}

/**
 * The same, walked over a parsed JSON value rather than over its text.
 *
 * Tool ARGUMENTS arrive as `JsonValue`, and a walk is strictly better than a regex there: the key
 * is a key rather than something that looks like one, and a token nested six levels down inside an
 * array of objects is reached by structure instead of by luck.
 */
export function redactJson(value: JsonValue): RedactedJson {
  let redactions = 0;

  const walk = (node: JsonValue): JsonValue => {
    if (typeof node === "string") {
      const done = redactText(node);
      redactions += done.redactions;
      return done.text;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === "object") {
      const out: { [key: string]: JsonValue } = {};
      for (const [key, child] of Object.entries(node)) {
        if (typeof child === "string" && !alreadyTaken(child) && isSecretKey(key, child)) {
          redactions += 1;
          out[key] = mark(segmentsOf(key).at(-1) ?? "secret");
          continue;
        }
        out[key] = walk(child);
      }
      return out;
    }
    return node;
  };

  const redacted = walk(value);
  return { value: redacted, redactions };
}

// ---- clipping --------------------------------------------------------------

/** A tool call's arguments. Small in practice; a filter object with a long list is the outlier. */
const ARGUMENTS_LIMIT = 900;
/** A successful tool result. Eighty properties of JSON is a real payload and is not sendable. */
const RESULT_LIMIT = 1400;
/**
 * A failed tool result gets several times the room. The error is the evidence, an error body is
 * usually short enough to fit whole, and the one that is not is the one worth paying for.
 */
const ERROR_RESULT_LIMIT = 5000;
/** What a persona wrote. Model-written and already bounded; this is a floor under pathology. */
const PROSE_LIMIT = 2000;

export interface Clipped {
  text: string;
  clipped: boolean;
}

/**
 * Cut a long value down, from the MIDDLE, with a marker saying how much went.
 *
 * Both ends are kept because the shape of a payload lives at its edges: the opening brace and the
 * first few fields say what kind of thing came back, and the closing brackets say how deeply it
 * was nested. A head-only cut hands the agent an object that ends in the middle of a field, which
 * reads as a malformed response from the product rather than as a cut made here.
 */
export function clip(text: string, limit: number): Clipped {
  if (text.length <= limit) return { text, clipped: false };
  const head = Math.max(1, Math.floor(limit * 0.7));
  const tail = Math.max(1, limit - head);
  const removed = text.length - head - tail;
  return {
    text: `${text.slice(0, head)}\n\n[clipped by populace: ${removed.toLocaleString("en-US")} characters removed from the middle of this value]\n\n${text.slice(-tail)}`,
    clipped: true,
  };
}

// ---- the prompt ------------------------------------------------------------

export interface FixPrompt {
  text: string;
  /** How many credential-shaped values were removed on the way. */
  redactions: number;
  /** How many tool-call values were too long to include whole. */
  clips: number;
}

/**
 * A fence long enough to hold its own content. A target that returns markdown — a docs tool, a
 * help string — puts backticks inside the payload, and a three-backtick fence around them ends the
 * block early and spills the rest of the evidence into the prose.
 */
function fence(body: string): string {
  const longest = [...body.matchAll(/`+/g)].reduce((most, run) => Math.max(most, run[0].length), 0);
  return "`".repeat(Math.max(3, longest + 1));
}

function block(body: string, language = ""): string {
  const rail = fence(body);
  return `${rail}${language}\n${body}\n${rail}`;
}

/**
 * What the reader is looking at, said first and said plainly.
 *
 * Every branch of this says the same thing in the end: confirm it before you change anything. A
 * `confirmed` verdict means a judge re-ran the recorded calls and saw it again — which is the
 * strongest thing populace can say, and is still not "this is a defect in your code".
 */
function standingOf(replay: Verification | null): string {
  if (replay === null)
    return "**Nobody has re-checked this.** It is one or more simulated users' account of what happened to them, and no judge has replayed the calls. Treat it as a lead.";
  if (replay.verdict === "confirmed")
    return "**A judge replayed the calls below against the same target and saw the same thing.** That is the strongest evidence this report carries, and it is still evidence that the calls behave this way — not a diagnosis of where in the code they go wrong.";
  if (replay.verdict === "not-reproduced")
    return "**A judge replayed the calls below and did not see it happen again.** Something may have been transient, or the account state may have differed. Weigh this accordingly; do not assume there is anything to fix.";
  return "**A judge replayed the calls below and could not tell either way.** Read the replay at the bottom before you change anything.";
}

/** One tool call, as the agent has to read it: what was sent, and what came back. */
function stepOf(call: ToolCallRecord, index: number): { text: string; redactions: number; clips: number } {
  const args = redactJson(call.arguments);
  const sent = clip(JSON.stringify(args.value, null, 2), ARGUMENTS_LIMIT);
  const raw = redactText(call.result.text);
  const back = clip(raw.text, call.result.isError ? ERROR_RESULT_LIMIT : RESULT_LIMIT);
  const failed = call.result.isError ? " — returned an error" : "";
  return {
    text: [
      `### Step ${index + 1} — \`${call.tool}\`${failed}`,
      `Call ref \`${call.ref}\`, endpoint \`${call.endpoint}\`, took ${Math.round(call.latencyMs)}ms.`,
      "",
      "Arguments:",
      block(sent.text, "json"),
      "",
      call.result.isError ? "What came back (the target flagged this as an error):" : "What came back:",
      block(back.text),
    ].join("\n"),
    redactions: args.redactions + raw.redactions,
    clips: (sent.clipped ? 1 : 0) + (back.clipped ? 1 : 0),
  };
}

/**
 * The whole prompt.
 *
 * Everything in it comes from the stored records and nothing is inferred: the reach numbers are
 * counted off `peopleHit` and `peopleTotal`, the intent comes from the personas' roles and the
 * cohorts' briefs as they were written, and the expected/observed pair is quoted rather than
 * paraphrased. Where a record is absent the prompt says it is absent rather than filling the gap.
 */
export function buildFixPrompt(cluster: ClusterDetailView): FixPrompt {
  let redactions = 0;
  let clips = 0;

  /** Every string off the store goes through here. One funnel, so there is one thing to audit. */
  const stored = (text: string, limit = PROSE_LIMIT): string => {
    const safe = redactText(text);
    redactions += safe.redactions;
    const short = clip(safe.text, limit);
    if (short.clipped) clips += 1;
    return short.text;
  };

  const finding = cluster.representative;
  const product = cluster.product.name === "" ? "the target" : stored(cluster.product.name, 200);
  const visits = cluster.peopleHit.reduce((total, person) => total + person.visits, 0);
  const endpoint = cluster.product.endpoints.find((e) => e.name === finding.endpoint) ?? cluster.product.endpoints[0];

  // One line per persona-and-cohort pair, not per person. Eight people off one persona have one
  // role between them, and eight identical bullets would bury the one cohort that differs.
  const roles = [...new Map(cluster.peopleHit.map((person) => [`${person.personaName}\u0000${person.cohortName}`, person])).values()];

  const steps = cluster.reproduction.map((call, index) => stepOf(call, index));
  for (const step of steps) {
    redactions += step.redactions;
    clips += step.clips;
  }

  const replaySteps = (cluster.replay?.replay ?? []).map((call, index) => stepOf(call, index));
  for (const step of replaySteps) {
    redactions += step.redactions;
    clips += step.clips;
  }

  const sections: string[] = [];

  sections.push(
    [
      `# Look into a problem reported in ${product}`,
      "",
      "## Read this before you change anything",
      "",
      `This came from populace, which sends simulated users through ${product}'s MCP tools and has them write up what went wrong in their own words. Four things about the text below.`,
      "",
      `1. ${standingOf(cluster.replay)}`,
      "2. **Confirm it in the source before you fix it.** Reproduce it against the code, work out whether the behaviour is wrong, and say so if it is not. A simulated user can misread a working product, and a change made on this report alone may be a change to code that is fine.",
      "3. **The transcript is not verbatim.** Credential-shaped values have been removed and long results cut; every removal and every cut is marked in place, and the note at the bottom says how many of each.",
      "4. **This is what happened in one execution.** Outcomes vary between executions by design — populace sends people through the product, it does not replay a script — so read this as one window onto the product rather than as a claim about what the next execution would find.",
    ].join("\n"),
  );

  sections.push(
    [
      "## What is wrong",
      "",
      stored(finding.title, 400),
      "",
      `- Filed as **${finding.kind}**, severity **${finding.severity}** — as the person who hit it rated it, not as a triaged priority.`,
      // Reach, because one person confused and eight people blocked are different problems. The
      // visit count is what the people who hit it did in total, not how many visits hit it: the
      // store knows the first and not the second, and the sentence says which one it is.
      `- ${cluster.peopleHit.length} of ${people(cluster.peopleTotal)} who went hit it, filing ${plural(cluster.reports, "report")} between them across the ${plural(visits, "visit")} ${cluster.peopleHit.length === 1 ? "that person made" : "those people made"} in this execution.`,
      `- Tool at fault: ${finding.tool === undefined || finding.tool === "" ? "none named" : `\`${stored(finding.tool, 120)}\``}${finding.kind === "coverage-gap" ? " — this is a coverage gap, so that tool is one the person expected to find and did not." : ""}`,
      `- Endpoint: \`${stored(finding.endpoint, 200)}\`${endpoint === undefined ? "" : ` (${stored(endpoint.url, 400)})`}`,
      `- populace's key for this problem: \`${finding.signature}\`, first seen ${cluster.firstSeenAt ?? "unknown"}.`,
    ].join("\n"),
  );

  if (cluster.product.description !== null && cluster.product.description !== "")
    sections.push(["## What the product says it is", "", stored(cluster.product.description)].join("\n"));

  const intent: string[] = ["## Who was trying to do what", ""];
  if (roles.length === 0) intent.push("Nothing is recorded about who was calling.");
  for (const person of roles)
    intent.push(`- **${stored(person.personaName, 120)}** — ${stored(person.role, 400)}${person.cohortName === "" ? "" : ` (in the ${stored(person.cohortName, 120)} cohort)`}`);
  for (const condition of cluster.conditions)
    intent.push("", `What everybody in **${stored(condition.cohortName, 120)}** had been told they were in the middle of:`, "", `> ${stored(condition.context).split("\n").join("\n> ")}`);
  sections.push(intent.join("\n"));

  sections.push(
    [
      "## What they expected, and what they got",
      "",
      "They expected:",
      "",
      `> ${stored(finding.expected).split("\n").join("\n> ")}`,
      "",
      "What happened instead:",
      "",
      `> ${stored(finding.observed).split("\n").join("\n> ")}`,
      ...(finding.description === "" ? [] : ["", "In their own words:", "", `> ${stored(finding.description).split("\n").join("\n> ")}`]),
    ].join("\n"),
  );

  sections.push(
    [
      "## The reproduction",
      "",
      steps.length === 0
        ? "No tool calls were stored against this report, which is unusual — there is nothing here to replay."
        : `The exact calls that led to the report, in the order they were made. ${plural(steps.length, "call")}.`,
      ...(steps.length === 0 ? [] : ["", steps.map((step) => step.text).join("\n\n")]),
    ].join("\n"),
  );

  if (cluster.replay !== null)
    sections.push(
      [
        "## What the re-check found",
        "",
        `Verdict: **${cluster.replay.verdict}**, from the ${cluster.replay.judge} judge on ${cluster.replay.verifiedAt}.`,
        "",
        `> ${stored(cluster.replay.reason).split("\n").join("\n> ")}`,
        ...(replaySteps.length === 0
          ? ["", "The judge recorded no replayed calls."]
          : ["", "The calls as the judge re-ran them, in the same order as the reproduction above:", "", replaySteps.map((step) => step.text).join("\n\n")]),
      ].join("\n"),
    );

  sections.push(
    [
      "## What to do",
      "",
      "1. Find the code behind the tool named above and read the path the calls take through it.",
      "2. Decide whether the behaviour in the transcript is actually wrong. If it is not, say so and stop — that is a useful answer and the report may simply be a misreading.",
      "3. If it is wrong, fix it at the source rather than at the tool description, unless what is wrong IS the tool description.",
      "4. Say what you changed, and how somebody could check it by hand. Do not rely on this report recurring: it came from one execution and may be worded differently or not appear at all in the next one.",
    ].join("\n"),
  );

  /**
   * One last sweep over everything, including the scaffolding.
   *
   * Each value above was redacted on its way in, and this is the guarantee that holds even when
   * one of them was not: a field added to this function later is covered whether or not whoever
   * added it routed it through `stored`. The note below is composed AFTER the sweep so the sweep
   * cannot count or rewrite its own numbers.
   */
  const swept = redactText(sections.join("\n\n"));
  redactions += swept.redactions;

  const note =
    redactions === 0
      ? "_Nothing in the transcript above matched a credential shape, so nothing was removed on that account._"
      : `_${plural(redactions, "value")} in the transcript above looked like a credential — a bearer token, a password, an API key — and ${redactions === 1 ? "was" : "were"} replaced in place with a \`[redacted: …]\` marker before this text left populace. The transcript is therefore not verbatim._`;
  const cut =
    clips === 0
      ? ""
      : `\n\n_${plural(clips, "value")} ${clips === 1 ? "was" : "were"} too long to include whole and ${clips === 1 ? "was" : "were"} cut from the middle, each marked with \`[clipped by populace: …]\`. Where you need the whole payload, open this problem in populace._`;

  return { text: `${swept.text}\n\n---\n\n${note}${cut}\n`, redactions, clips };
}

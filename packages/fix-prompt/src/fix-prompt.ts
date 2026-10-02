import type { ClusterDetailView, Finding, JsonValue, ToolCallRecord, Verification } from "@populace/contract";

import { people, plural } from "./words.js";

/**
 * One problem, written out as a prompt somebody can paste into a coding agent pointed at THEIR
 * OWN product's source tree.
 *
 * The reader of this text is not a person reading a bug report. It is an agent that is about to
 * change somebody's code, with no access to populace, no access to this store, and no way to ask
 * a follow-up question. Everything it needs has to be in the string, and everything in the string
 * has to be true — which is what every rule below is for.
 *
 * **It is a leaf package that draws nothing and has two callers that must get the identical
 * string:** the dashboard's finding page, which shows it to a human with a copy button, and the
 * server, which files it as a GitHub issue body for somebody who will never open populace. It
 * depends on `@populace/contract` for types only — every import here is `import type`, so the
 * emitted JavaScript imports nothing at all — which is what lets both of them use it.
 *
 * The two things this feature can get catastrophically wrong — leaking a credential and silently
 * truncating evidence — are both string transforms of the arguments, so they are pure functions
 * and `fix-prompt.test.ts` asserts them directly rather than through either caller.
 *
 * Five rules, in the order they matter.
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
 *
 * **5. Every number and every method named is true of the sentence it sits under.** A count that
 * is right for a different scope is a false claim rather than a rounding error, and so is a
 * sentence describing a check that was not the one made: a coverage gap is settled by a tool-list
 * diff and a failed replay is settled by nobody, so neither may be introduced as "a judge replayed
 * the calls". `reachLines` and `standingOf` are where those two live, and each says what it counted
 * and what it asked.
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
 * The verdict in words, because the enum is a machine's spelling of it and this text is read by
 * somebody who has never seen populace. `not-reproduced` is the one that matters: it means the
 * replay did not show the problem again, which is **not** a claim that the problem is gone, and
 * printing the enum invites exactly that reading.
 *
 * **This is the one definition of these four words**, and it lives here rather than in the
 * dashboard because this is the leaf: the server files issues with it and never builds a screen,
 * so it cannot import `packages/web`, while the dashboard can and does import this (`format.ts`
 * already re-exports `people` and `plural` from here for the same reason). A verdict rendered one
 * way in an issue and another way on the screen the issue links to is two accounts of one event.
 *
 * The `Record` is typed off `Verification` so a fourth verdict fails to compile rather than falling
 * through to the enum's own spelling, and `null` is a case the mapping deliberately carries: a
 * verdict that does not exist yet is "not checked yet" everywhere, and a caller left to write that
 * itself writes something else.
 */
const VERDICT_WORDS: Record<Verification["verdict"], string> = { confirmed: "confirmed", "not-reproduced": "did not recur", inconclusive: "unsure" };

export function verdictWords(verdict: Verification["verdict"] | null): string {
  return verdict === null ? "not checked yet" : VERDICT_WORDS[verdict];
}

/**
 * Vocabulary that may not leave populace, whoever wrote it (DESIGN-SYSTEM §7.3, ADR-0028,
 * ADR-0030, ADR-0032, ADR-0042). Three kinds of word are in here, barred for three reasons.
 *
 * **A claim populace cannot support.** Nothing it writes may promise identical or repeatable
 * results — outcomes vary between executions by design — so "every time", "deterministic" and
 * "reproducible" are out however confident the writer was.
 *
 * **A word that settles it.** "fixed", "resolved", "verified": an absence is never a repair, and
 * these are a human's words about their own product, typed on the triage control.
 *
 * **populace's own machine vocabulary.** "agent", "wake", "simulation" and "lane" appear in no
 * path, no field and no user-facing copy, and an issue body is the most public copy populace
 * produces. They are on a blocklist over text this file did not author because they had already
 * leaked once: `replayFinding`'s swept-account reason used to be written for whoever operates
 * populace — *"a simulation with auto-sweep on takes its accounts down as soon as it finishes;
 * verify before the sweep, or run it again with auto-sweep off"* — and it was being published
 * verbatim into a stranger's issue tracker, where it named a noun populace does not use and gave
 * an instruction the reader cannot act on. That particular reason has since been narrowed to the
 * fact alone (`packages/reports/src/verifier.ts`), with the operator guidance moved to the log,
 * so the example is history rather than a live leak — but the blocklist is not, because it was
 * never the only way in and `standingOf` still needs its branch saying the re-check could not run
 * in words that mean something to that reader. Keeping the quote is the point: it records what a
 * reason written for the wrong reader looks like. Note that "simulated" is deliberately still
 * allowed: the prompt calls the people it sent simulated users, which is the product's own word.
 *
 * It is applied to every judge's reason and not only the model's, for two reasons. The `heuristic`
 * judge's environmental reason quotes the target's own error text verbatim
 * (`verifier.ts` `compareSteps`), so a composed reason can still carry a third party's words — and
 * every string quoted from a third party goes through the same funnel. And a blocklist that runs on
 * one path is a blocklist somebody routes around later.
 */
const BANNED_CLAIM =
  /\bfixed\b|\bresolved\b|\bverified\b|reproducib|deterministic|every time|always happens|identical result|repeatable|still broken|works now|guaranteed|\bagents?\b|\bwakes?\b|\bsimulations?\b|\blanes?\b/i;

/**
 * The judge's reason, or `null` when it may not be quoted.
 *
 * Tested against the RAW reason rather than the redacted-and-clipped one on purpose: `clip` cuts
 * from the middle, so a banned word could be cut in half and pass a check made afterwards. Losing
 * the sentence costs little — the verdict is above it and the replayed calls are printed below in
 * full, so the evidence survives the withholding.
 */
export function quotableReason(replay: Verification): string | null {
  if (replay.reason.trim() === "") return null;
  return BANNED_CLAIM.test(replay.reason) ? null : replay.reason;
}

const WITHHELD =
  "_The judge's own wording is not quoted here. It used language populace does not put its name to — a claim about repeatability, or about a problem being settled — so the wording was withheld. The verdict above and the replayed calls below are what this report stands on._";

/**
 * What is said instead of the re-check's own words when the re-check never ran.
 *
 * The wording populace records on that path is about ITS side of the wire — an account it removed,
 * an address it could not reach, a report with no calls in it — and it is written for whoever
 * operates populace. Quoting it to a stranger reading an issue hands them an instruction about a
 * product they do not have, under a heading claiming it came from a replay. So the reason is not
 * quoted at all here, and this says where it went.
 */
const NO_RECHECK =
  "_populace's own note about why it could not run is about its side of the wire — an account it had already taken down, or an address it could not reach — so it is not quoted here. There is no second opinion on this report: what it stands on is the reproduction above and the words of the person who filed it._";

/**
 * Where the verdict above it actually came from.
 *
 * This exists because "a judge replayed the calls" is a claim about an experiment, and for two of
 * the three ways a verdict gets written no replay decided anything:
 *
 * - **A coverage gap is a tool-list diff and nothing else.** `heuristicJudge` asks the target which
 *   tools it exposes and looks for the one the person wanted (`verifier.ts`), and it settles the
 *   finding that way whatever the configured judge is. The reproduction may still have been re-run
 *   on the way — `replayFinding` runs before any judge — but re-running it is not what decided it.
 * - **A replay that failed never reaches a judge at all.** Every failure path in `replayFinding`
 *   returns no steps, `verifyFinding` stores exactly those steps as `Verification.replay`, and the
 *   verdict is `inconclusive` off the error text. So an empty step list means the experiment did not
 *   happen, and a body that says a judge replayed the calls there is wrong twice over.
 *
 * `inconclusive` on a coverage gap is the same absence of a decision — the tool list could not
 * settle it either (the finding names no tool, or the target could not be asked) — so it lands in
 * `none` with the rest rather than claiming a check that reached no conclusion.
 */
type Method = "replay" | "tool-list" | "none";

function methodOf(replay: Verification, kind: Finding["kind"]): Method {
  if (kind === "coverage-gap") return replay.verdict === "inconclusive" ? "none" : "tool-list";
  return replay.replay.length === 0 ? "none" : "replay";
}

/**
 * What the reader is looking at, said first and said plainly.
 *
 * Every branch of this says the same thing in the end: confirm it before you change anything. The
 * ceiling holds across all of them — even a `confirmed` replay is evidence that the calls behave
 * this way, never a diagnosis of where in the code they go wrong — and what differs between them is
 * only which check was actually made.
 */
function standingOf(replay: Verification | null, kind: Finding["kind"]): string {
  if (replay === null)
    return "**Nobody has re-checked this.** It is one or more simulated users' account of what happened to them, and no judge has replayed the calls. Treat it as a lead.";
  switch (methodOf(replay, kind)) {
    case "none":
      return "**The re-check could not run.** populace tried to check this a second time and never got to: the account that filed the report was gone by then, or the address could not be reached, or there was nothing recorded for it to repeat. Nothing below has been checked by anybody but the person who reported it. Treat it as a lead.";
    case "tool-list":
      return replay.verdict === "confirmed"
        ? "**populace asked the target again which tools it exposes, and the one this report is about was not among them.** That is a check of what the product offers, not of how it behaves — the calls below were not what decided it."
        : "**populace asked the target again which tools it exposes, and a tool by the name this report asks for was among them.** It may have been added since, or the person may have been asking for the wrong name. That is a check of the tool list and nothing else: it is not a claim that anything has been put right, and it says nothing about how the tool behaves.";
    default:
      if (replay.verdict === "confirmed")
        return "**A judge replayed the calls below against the same target and saw the same thing.** That is the strongest evidence this report carries, and it is still evidence that the calls behave this way — not a diagnosis of where in the code they go wrong.";
      if (replay.verdict === "not-reproduced")
        return "**A judge replayed the calls below and did not see it happen again.** Something may have been transient, or the account state may have differed. Weigh this accordingly; do not assume there is anything to fix.";
      return "**A judge replayed the calls below and could not tell either way.** Read the replay at the bottom before you change anything.";
  }
}

/**
 * The heading over the quoted reason, naming what composed it.
 *
 * It said "composed from the replay" for every judge that is not the model one, including the two
 * cases where no replay decided anything — which attributed a sentence to an experiment that was
 * never run. A heading is a claim like any other sentence here.
 */
function reasonLabel(replay: Verification, kind: Finding["kind"]): string {
  if (replay.judge === "model") return "The judge's own wording, as its account and not as populace's:";
  return methodOf(replay, kind) === "tool-list" ? "What decided it, composed from the target's tool list:" : "What decided it, composed from the replay:";
}

/**
 * How far the problem reached, in numbers that are every one of them counted off the SAME records —
 * and **in sentences that each name the stretch of time their own numbers were counted over.**
 *
 * One sentence used to carry three scopes at once — the people off the execution that reported it,
 * the report count off the report window, and the visits off those people's whole stay — and a
 * count that is true of a different scope is a false claim rather than a rounding error. So the
 * fraction and the report count come from one place: the reports of THIS problem in the report
 * WINDOW the evidence below was taken from. `peopleHit` is the people who filed them, `quotes` is
 * one entry per report and `peopleMissed` is the rest of that window's own visitors, all three
 * derived from that one window by the read model (`detailOf`, ADR-0045), so no two of these numbers
 * can disagree with each other.
 *
 * The denominator is deliberately **not** `peopleTotal` even now that the card carries the window's
 * census too: these rows are the people as they were in the execution that REPORTED this, which
 * for a problem the newest window did not report is an older one, possibly with a different cast.
 * Adding this page's own two lists is the only denominator that the numerator is a subset of.
 *
 * **Naming the stretch is what the first line is for, and why it does not say "execution".** A
 * window is an execution boundary for an ephemeral study and a report cycle for a longitudinal one,
 * and a longitudinal study has ONE execution for its whole life (ADR-0030, ADR-0045): a lifetime of
 * visits under a fraction counted over one cycle of it reads as a claim about the whole run, and on
 * a study on its twentieth cycle the denominator is several times too small for that reading. So
 * the line says what it counted — the stretch this problem was last reported in, which is the
 * window `detailOf` built every number here from, in both the present and the absent case.
 *
 * It does not name WHICH stretch, because this view does not carry the window's own identity and a
 * guess is worse than a silence: the only exact judgement of whether a card's stretches are
 * executions at all is `executionScoped` in the dashboard's `format.ts`, which this leaf package
 * cannot import (the dependency runs the other way). Moving that judgement here, beside `people`
 * and `plural`, is what would let this sentence say "execution 3" or "report cycle 7 of execution
 * 1" the way `publish-issues.ts`'s own incidence line does; it is deliberately left for the
 * producer-side scope boolean recorded in ADR-0045 rather than copied, because two places making
 * one judgement is the defect that line was written to close.
 *
 * The visits get their own line because they are the one number with a wider scope, and the line
 * says which: everything those people did in the whole execution that stretch is part of, not the
 * visits that hit this. The store knows the first and not the second.
 */
function reachLines(cluster: ClusterDetailView): string[] {
  const hit = cluster.peopleHit.length;
  const went = hit + cluster.peopleMissed.reduce((total, cohort) => total + cohort.count, 0);
  const visits = cluster.peopleHit.reduce((total, person) => total + person.visits, 0);
  const reports = plural(cluster.quotes.length, "report");
  // Nobody on the roster matched the reports, which is what happens when the evidence outlived the
  // rows describing who made it. There is no honest reach sentence available, so none is written —
  // and the one that says so names both of the things it failed to reconcile, because the reports
  // are the window's and the roster it looked them up in is the execution's.
  if (hit === 0) return [`- Reach: not recorded — nobody who filed ${reports} of it could be matched to a person the execution it came from still has on record.`];
  return [
    `- In the stretch of the study this was last reported in: ${hit} of ${people(went)} who went hit it, filing ${reports} between them.`,
    `- ${hit === 1 ? "That person" : "Those people"} made ${plural(visits, "visit")} in the whole execution that stretch is part of — their entire stay, not only the visits that hit this.`,
  ];
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
 * counted off `peopleHit` and `peopleMissed` — this page's own two lists, which are the window's
 * and NOT `peopleTotal`, for the reason `reachLines` sets out — the intent comes from the personas'
 * roles and the cohorts' briefs as they were written, and the expected/observed pair is quoted
 * rather than paraphrased. Where a record is absent the prompt says it is absent rather than
 * filling the gap.
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
      `1. ${standingOf(cluster.replay, finding.kind)}`,
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
      ...reachLines(cluster),
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

  if (cluster.replay !== null) {
    const verification = cluster.replay;
    const method = methodOf(verification, finding.kind);
    // A verdict nothing decided quotes nothing. On that path the recorded reason is populace's own
    // note about its side of the wire, and `NO_RECHECK` says so in place of it — the blocklist
    // above is the backstop for that, not the plan.
    const reason = method === "none" ? null : quotableReason(verification);
    sections.push(
      [
        "## What the re-check found",
        "",
        `Verdict: **${verdictWords(verification.verdict)}**, from the ${verification.judge} judge on ${verification.verifiedAt}.`,
        "",
        // Attributed rather than stated, when a model wrote it: a sentence populace did not compose
        // must not be read as populace's claim about somebody's product.
        ...(method === "none" ? [NO_RECHECK] : reason === null ? [WITHHELD] : [reasonLabel(verification, finding.kind), "", `> ${stored(reason).split("\n").join("\n> ")}`]),
        // What was replayed is reported whatever decided the verdict: a coverage gap's calls may
        // have been re-run on the way to a tool-list answer, and saying so is not the same as
        // saying they settled it — which is `standingOf`'s job, at the top where it is read first.
        ...(replaySteps.length === 0
          ? ["", finding.kind === "coverage-gap" ? "No calls were replayed. What a coverage gap turns on is the tool list, not a transcript." : "No calls were replayed."]
          : ["", "The calls as they were made a second time, in the same order as the reproduction above:", "", replaySteps.map((step) => step.text).join("\n\n")]),
      ].join("\n"),
    );
  }

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

// ---- the issue -------------------------------------------------------------

/**
 * GitHub's cap on an issue body, which is a hard limit and not a guideline: a body over it is
 * refused with a `422` naming a field, so the first anyone would hear of the prompt being too
 * long is a filing job that fails on the one problem with the most evidence behind it.
 *
 * `clip` bounds each individual VALUE and nothing bounds the assembled whole. Ten error results
 * at `ERROR_RESULT_LIMIT` is 50,000 characters before the replay section starts, and a replay
 * repeats the reproduction call for call — so a real finding can exceed this on its own without
 * any single value being long enough for `clip` to touch.
 */
const ISSUE_BODY_LIMIT = 65_536;

/**
 * A title long enough to say what is wrong and short enough to read in a list. GitHub's own cap
 * is 256, which is far past the width an issue list renders before it truncates on the reader's
 * behalf and without a marker — so the cut is made here, where it can be marked.
 */
const TITLE_LIMIT = 120;

/**
 * Where the body was cut, and where the part that was cut still lives.
 *
 * When the footer is kept (`keptFooter`), the note also says what the footer's numbers are counted
 * over. They are counted over the whole prompt, including the part removed just above — so without
 * that sentence "4 values in the transcript above were replaced" is a count of something the reader
 * can no longer see all of, which is the scope rule broken by omission.
 */
function cutNote(removed: number, keptFooter: boolean): string {
  const scope = keptFooter ? " The note below it counts over the whole report, including the part removed here." : "";
  return `\n\n---\n\n_This report was longer than GitHub allows an issue body to be (${ISSUE_BODY_LIMIT.toLocaleString("en-US")} characters), and ${removed.toLocaleString("en-US")} characters were removed from the END of it — the tail of the reproduction, and the re-check below it if there was one. The whole of it is on this problem's page in populace.${scope}_\n`;
}

/**
 * The unclosed code fence in a body, if the cut landed inside one.
 *
 * Without this the note above is cut off mid-block and GitHub renders it as more evidence, in a
 * monospace box, looking like part of the transcript — which is the one thing a cut must not do.
 * Fences are matched the way `fence` writes them: a rail at the start of a line, closed by a rail
 * at least as long.
 */
function unclosedFence(body: string): string | null {
  let open: string | null = null;
  for (const line of body.split("\n")) {
    const rail = /^(`{3,})/.exec(line)?.[1];
    if (rail === undefined) continue;
    if (open === null) open = rail;
    else if (rail.length >= open.length) open = null;
  }
  return open;
}

export interface FittedBody {
  text: string;
  /** True when evidence was removed from the end. False means the body is the whole prompt. */
  truncated: boolean;
}

/**
 * The rule-and-note the prompt ends with, split off the body so a cut cannot take it.
 *
 * `buildFixPrompt` finishes with `\n\n---\n\n` and then the note saying how many credential-shaped
 * values were removed and how many results were cut. That note is the reader's only warning that
 * the transcript in front of them is not verbatim — and it is the LAST thing in the document, which
 * is exactly what `fitIssueBody` removes. A body cut for length was therefore promising a redaction
 * note it no longer contained.
 *
 * It is found rather than passed so that `fitIssueBody(text)` keeps its one-string signature: the
 * server hands it whatever string it has, and a caller that has to remember to pass the footer
 * separately is a caller that will forget. Two guards keep it from claiming a footer that is really
 * evidence — a footer is short, and a footer contains no code fence — and where neither holds the
 * whole thing is treated as body and cut as before.
 */
const FOOTER_RULE = "\n\n---\n\n";
const FOOTER_LIMIT = 4_000;

function splitFooter(text: string): { head: string; footer: string } {
  const at = text.lastIndexOf(FOOTER_RULE);
  const footer = at === -1 ? "" : text.slice(at);
  if (at === -1 || footer.length > FOOTER_LIMIT || /^`{3,}/m.test(footer)) return { head: text, footer: "" };
  return { head: text.slice(0, at), footer };
}

/**
 * The prompt, cut to fit in a GitHub issue body.
 *
 * Cut from the END rather than from the middle, which is the opposite of `clip` and for the
 * opposite reason: `clip` bounds one value whose shape lives at both its edges, while this bounds
 * a document written in descending order of importance. The caveat, the symptom, the reach, the
 * intent and the first reproduction steps are at the top; what goes is the tail of the
 * transcript, which is the part a reader can still go and read in populace.
 *
 * The note is composed from the length actually removed, so it can be longer than the room left
 * for it; the loop shortens the kept text until body, note and footer together fit. It terminates
 * because every pass that does not fit sets a strictly smaller budget.
 *
 * The prompt's own closing note is held out of the cut and put back after it (`splitFooter`), so
 * the one sentence saying the transcript is not verbatim survives the truncation that makes it
 * matter most.
 */
export function fitIssueBody(text: string): FittedBody {
  if (text.length <= ISSUE_BODY_LIMIT) return { text, truncated: false };
  const { head, footer } = splitFooter(text);
  let budget = ISSUE_BODY_LIMIT - footer.length;
  for (;;) {
    // Back up to a line break so the body does not end halfway through a JSON line, which reads
    // as a malformed response from the product rather than as a cut made here.
    const cut = head.slice(0, Math.max(0, budget));
    const lastBreak = cut.lastIndexOf("\n");
    const body = lastBreak === -1 ? cut : cut.slice(0, lastBreak);
    const rail = unclosedFence(body);
    const tail = `${rail === null ? "" : `\n${rail}`}${cutNote(head.length - body.length, footer !== "")}${footer}`;
    if (body.length + tail.length <= ISSUE_BODY_LIMIT) return { text: `${body}${tail}`, truncated: true };
    budget = ISSUE_BODY_LIMIT - tail.length;
  }
}

export interface IssueTitle {
  title: string;
  /** How many credential-shaped values were removed from the title. Add to the body's count. */
  redactions: number;
}

/**
 * The issue's title: a person's own sentence about what went wrong, on one line.
 *
 * **It goes through `redactText` like every other stored string,** and that is not belt and
 * braces. A finding's title is written by a model that has just been shown the account it was
 * handed, so "sign-up returned my token tk_… and then logged me out" is a title somebody's
 * product can produce — and the title is the one field that leaves this building twice, once into
 * the issue and once into a search index, where it outlives the issue being edited or deleted.
 *
 * Newlines are folded because a title has no second line: GitHub keeps everything up to the first
 * break and drops the rest silently, so a two-line title would lose half of itself without saying
 * so.
 */
export function issueTitleOf(cluster: ClusterDetailView): IssueTitle {
  const written = cluster.title.trim();
  const named = cluster.tool === null || cluster.tool === "" ? "" : ` in ${cluster.tool}`;
  const safe = redactText(written === "" ? `A ${cluster.kind} with no title recorded${named}` : written);
  const line = safe.text.replace(/\s+/g, " ").trim();
  const title = line.length <= TITLE_LIMIT ? line : `${line.slice(0, TITLE_LIMIT - 1).trimEnd()}…`;
  return { title, redactions: safe.redactions };
}

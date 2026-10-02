import type { GithubCheckResult } from "@populace/contract";
import type { JsonObject } from "@populace/core";
import { redactText } from "@populace/fix-prompt";
import { z } from "zod";

/**
 * The half of issue filing that talks to github.com — and the only place in populace that holds
 * YOUR credential to a third party which is not the target (`GithubConnectionSchema`).
 *
 * Three properties matter more here than anywhere else in the server, because everything this
 * file does is an outbound write to somebody else's account:
 *
 * **1. Nothing throws.** Every operation answers with a typed outcome — a code plus a sentence a
 * human can act on — the way `TdkRefusal` carries a code so a caller can tell "change something
 * and ask again" from "never ask again". A publish of forty issues must be able to file the
 * thirty-nine it can and say what happened to the fortieth, which an exception escaping into a
 * job's error field does not allow.
 *
 * **2. The token never comes back down.** It is not in a returned message, not in a `detail`, and
 * not in anything a caller could put in an event or a log line. GitHub's own words are quoted
 * because they are usually the most useful thing a reader gets — and they are quoted only through
 * `sanitize`, because a remote's error message is somewhere a credential can end up: GitHub echoes
 * request context, and an intermediate proxy echoes rather more than that.
 *
 * **3. Content creation is one at a time and backs off.** GitHub enforces a *secondary* rate limit
 * on creating content, separate from the hourly one, and its documented advice is to create
 * serially and to honour `retry-after`. The limits adjust dynamically, so they are treated as soft
 * — bounded retries, a capped wait, and a refusal that names the wait when it is longer than this
 * is willing to hold a job open. Nothing here spins.
 *
 * **4. A pass has a wall clock, not just each call.** Three bounded retries per request is not a
 * bound on a bulk publish: forty issues, each pausing politely twice, is forty times the pause,
 * and the secondary limit on content creation is exactly what a forty-issue pass provokes. So the
 * client carries one budget for its whole life (`budgetMs`), stops going out once it is spent, and
 * answers `rate-limited` instead. A caller with a queue behind it asks `outOfTime()` between
 * issues and stops cleanly with what it filed, rather than grinding to the end of the list.
 *
 * Nothing in this file may write "agent", "wake", "simulation" or "lane" (ADR-0032, ADR-0042): an
 * issue title, body and comment are the most public copy populace produces, and a label or a label
 * description lands in somebody's repository settings for good.
 */

const API = "https://api.github.com";

/** GitHub asks for a User-Agent that names the caller, and answers 403 without one. */
const USER_AGENT = "populace";

/** The pinned API version. Sent on every request so a future default cannot reshape a response. */
const API_VERSION = "2022-11-28";

/**
 * Three attempts, so one retry for a hiccup and one more for a slow recovery. Past that a caller
 * with a job to run is better served by being told than by waiting: the job row is where a person
 * looks, and a request still going ten minutes later is indistinguishable from a wedged queue.
 */
const MAX_ATTEMPTS = 3;

/**
 * The longest this will hold a request open waiting for a limit to clear. A secondary limit clears
 * in a minute or so; an exhausted hourly limit resets at the top of the hour, and sleeping through
 * that inside a serial job queue would block every sweep and target check behind it (ADR-0027). So
 * a wait longer than this is reported rather than slept through.
 */
const MAX_WAIT_MS = 60_000;

/**
 * The wall clock one client may spend across every call it makes, which is the bound a bulk
 * publish actually needs: per-request retries are bounded, but forty of them in a row are bounded
 * only by forty times the bound, and a publish sits in the serial job queue with sweeps and target
 * checks behind it (ADR-0027).
 *
 * Ten minutes because a healthy forty-issue pass is seconds and a pass still going after ten
 * minutes is a throttle being waited out one polite pause at a time — which is a thing to report,
 * not to keep doing. A caller may pass its own, or `null` for a single call from a route where the
 * person pressing the button is the timeout.
 */
const DEFAULT_BUDGET_MS = 10 * 60_000;

/** The slice of `fetch` this needs, so a test can answer offline and assert what went out. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<GithubResponse>;

/**
 * What a `FetchLike` answers with. Response HEADERS are part of it, unlike the `FetchLike` in
 * `provision-url`: `retry-after`, `x-ratelimit-reset` and the token's own expiry all arrive up
 * there and not in the body, and a client that could not read them would have to guess how long to
 * wait and could never tell an expired token from a wrong one.
 */
export interface GithubResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export const defaultFetch: FetchLike = async (url, init) => {
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    ...(init.body === undefined ? {} : { body: init.body }),
    signal: AbortSignal.timeout(30_000),
  });
  return { ok: response.ok, status: response.status, headers: response.headers, text: () => response.text() };
};

/**
 * Why an operation did not happen, in the register `TdkRefusal`'s code is in: what the reader can
 * do about it, rather than which HTTP status it was.
 *
 * - `refused` — GitHub answered and said no. A token with the wrong scope, or one that cannot see
 *   this repository, which GitHub deliberately answers the same way as a repository that does not
 *   exist. Change something and ask again.
 * - `expired` — a fine-grained token is past its lifetime. Its own code because "refused" sends a
 *   reader hunting for a scope they already granted.
 * - `no-issues` — the repository's issue tracker is switched off. A setting on their side; filing
 *   would 410 every time.
 * - `not-found` — the repository is reachable but that issue number is not there. Different from
 *   `refused` because it is about one issue rather than about the connection.
 * - `rate-limited` — a limit is in force and clearing it would take longer than this will wait.
 *   The message names the wait, so a caller can say when to come back.
 * - `unreachable` — github.com did not answer, or answered with its own failure. A transport
 *   problem, not a permission one.
 * - `malformed` — it answered 2xx with a body this cannot read. Almost always something in front
 *   of GitHub rather than GitHub, which is worth being able to say.
 */
export type GithubFailureCode = "refused" | "expired" | "no-issues" | "not-found" | "rate-limited" | "unreachable" | "malformed";

export interface GithubFailure {
  ok: false;
  code: GithubFailureCode;
  /** One line, already through `sanitize`. Safe to show a person and to store. */
  message: string;
  /** The status GitHub answered with, or null when nothing answered. */
  status: number | null;
}

export type GithubOutcome<T> = ({ ok: true } & T) | GithubFailure;

/** An issue, as every operation here reports one. */
export interface IssueRef {
  number: number;
  url: string;
  state: "open" | "closed";
  /**
   * When GITHUB says the issue was opened, in ISO, and null when the payload did not say.
   *
   * It is carried because the caller cannot get it anywhere else and guessing it is a fabricated
   * date in the one record a reader trusts to be a history: a marker search finds an issue that
   * may have been opened months ago, and a ledger row that stamped `filedAt` with the current
   * clock would claim populace filed it just now. That is not a cosmetic error — every tie-break
   * in the dedupe rule is "the oldest `filedAt` wins, because it is the issue a reader has been
   * following" (`FiledIssueSchema`), so a fabricated date can permanently send future comments to
   * the wrong issue.
   *
   * Null rather than a fallback, for the same reason: a row that does not know when its issue was
   * opened should say so, the way `FiledIssueSightingSchema.at` does for a legacy sighting.
   */
  createdAt: string | null;
}

/**
 * What a marker search answered, which is three things and not two.
 *
 * **There is deliberately no `ok` here, and deliberately no `issues` on the other two members.**
 * Every other operation in this file answers `GithubOutcome`, where a caller that writes
 * `if (!answer.ok) …` is handling an error. A marker search is the one call where that shape is a
 * trap: the whole point of searching is to decide "has this been filed already?", so a caller
 * reaching for a list and finding none has to know whether it is looking at *GitHub said there is
 * nothing* or *GitHub did not say*. Those read identically through an empty array, and the
 * consequence of confusing them is not a wasted request — it is a duplicate issue in somebody's
 * repository, filed because a 403 was read as an absence. Worse, the marker search exists
 * precisely for the case where the local ledger is gone (ADR-0011), so the failure mode is one
 * rate limit re-filing every issue populace has ever opened.
 *
 * So the three answers are three tags with nothing in common to collapse them through:
 *
 * - `found` — GitHub answered and the marker is in at least one issue. Non-empty by type, so
 *   `issues[0]` needs no check.
 * - `none` — GitHub answered and the marker is in nothing it returned. Note what this still is
 *   not: search is eventually consistent, so it means "nothing found", never "nothing exists".
 * - `could-not-answer` — nothing usable came back, and `failure` says why. A caller must decide
 *   what to do; it may NOT read it as `none`.
 */
export type MarkerSearch =
  | { outcome: "found"; issues: readonly [IssueRef, ...IssueRef[]] }
  | { outcome: "none" }
  | { outcome: "could-not-answer"; failure: GithubFailure };

/**
 * What the check found, minus the two fields that are the caller's to write: the `summary` sentence
 * belongs to whoever is answering a route, and `checkedAt` to whoever is stamping the row. Typed
 * off the contract's own result so the values this returns cannot drift from the ones served.
 */
export type RepoCheck = Omit<GithubCheckResult, "summary" | "checkedAt">;

// ---- what GitHub answers with ----------------------------------------------

/**
 * Every schema below takes only the fields populace acts on and ignores the rest: a repository
 * payload is upwards of a hundred fields, and a client that insisted on knowing all of them would
 * break the first time GitHub added one.
 */
const RepoSchema = z.object({
  full_name: z.string(),
  private: z.boolean(),
  /** Absent on older payloads, and `internal` on an enterprise repository. */
  visibility: z.string().optional(),
  has_issues: z.boolean(),
});

const IssueSchema = z.object({
  number: z.number().int().positive(),
  html_url: z.string(),
  state: z.string(),
  /**
   * When the issue was opened. Optional and only loosely typed on purpose: it is the truth a
   * ledger row needs instead of the local clock, and a payload that omitted it or worded it oddly
   * must still yield a usable issue reference rather than failing the parse and losing the issue
   * number over a date. `asIso` turns whatever arrived into ISO or into null.
   */
  created_at: z.string().optional(),
});

const CommentSchema = z.object({ id: z.number().int(), html_url: z.string() });

const SearchSchema = z.object({ items: z.array(IssueSchema) });

const LabelSchema = z.object({ name: z.string() });

/** What the issue-labels endpoint answers with: every label now on the issue, not just the new ones. */
const LabelListSchema = z.array(LabelSchema);

/** GitHub's own error shape. `message` is the sentence; `errors[].code` is how 422 says why. */
const ErrorSchema = z.object({
  message: z.string(),
  errors: z.array(z.object({ code: z.string().optional(), field: z.string().optional(), message: z.string().optional() })).optional(),
});

// ---- the client ------------------------------------------------------------

export interface GithubClientOptions {
  /** `owner/name`, validated upstream by `GithubConnectionSchema`. */
  repo: string;
  token: string;
  fetchImpl?: FetchLike;
  /** Injected so a test can assert the backoff without waiting it out. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for the same reason: `x-ratelimit-reset` is a wall-clock instant. */
  now?: () => number;
  /**
   * The wall clock this client may spend across ALL of its calls, `null` for no bound. See
   * `DEFAULT_BUDGET_MS`: it is the bound on a bulk pass, which per-request retries are not.
   */
  budgetMs?: number | null;
}

export class GithubClient {
  private readonly repo: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly budgetMs: number | null;

  /**
   * When the first request went out, which is when the budget starts — not construction time. A
   * publish builds its client, reads a connection, builds a study context and then starts filing,
   * and a budget that had been running through all of that would be a different budget every time
   * depending on how slow the read-model was.
   */
  private startedAt: number | null = null;

  /**
   * The one-at-a-time gate for content creation. A chain rather than a counter because the point
   * is ordering, not concurrency: GitHub's secondary limit is provoked by parallel creates, and a
   * publish of forty issues is the exact shape that provokes it.
   */
  private gate: Promise<void> = Promise.resolve();

  constructor(options: GithubClientOptions) {
    this.repo = options.repo;
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.sleep = options.sleep ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)));
    this.now = options.now ?? (() => Date.now());
    this.budgetMs = options.budgetMs === undefined ? DEFAULT_BUDGET_MS : options.budgetMs;
  }

  /**
   * How long this client may still spend, in milliseconds, and `Infinity` when it was given no
   * budget. Public because a caller with a list to get through wants it for the sentence it shows
   * a person, not only for the decision.
   */
  timeLeftMs(): number {
    if (this.budgetMs === null) return Number.POSITIVE_INFINITY;
    if (this.startedAt === null) return this.budgetMs;
    return Math.max(0, this.budgetMs - (this.now() - this.startedAt));
  }

  /**
   * The refusal to report when this pass is out of wall clock, or null while there is time left.
   *
   * This is the one thing a bulk caller needs from the budget, and it is shaped as the refusal
   * rather than as a boolean so that stopping is one branch and the sentence a person reads is
   * this file's rather than reinvented at the call site: `const stop = client.outOfTime(); if
   * (stop !== null) { record(stop); break; }`. Asked BETWEEN issues it stops a pass cleanly with
   * the thirty-nine it filed; the same check inside `request` is what stops the fortieth going
   * out at all.
   */
  outOfTime(): GithubFailure | null {
    if (this.timeLeftMs() > 0) return null;
    const seconds = Math.round((this.budgetMs ?? 0) / 1000);
    return {
      ok: false,
      code: "rate-limited",
      message: `Filing stopped after ${seconds} seconds: github.com is answering too slowly or is limiting this token. Whatever was filed before that is filed — the rest can be filed again later.`,
      status: null,
    };
  }

  /**
   * The check: does the repository answer, does this token reach it, and can an issue be opened
   * there — plus the two facts the caller cannot get anywhere else.
   *
   * It asks twice on the happy path, deliberately. The repository payload carries `has_issues`,
   * which catches a tracker switched off; but the endpoint that would be filed to is the issues
   * one, and that is what answers **410** when issues are disabled. Checking the thing that will
   * be used is worth one request: the alternative is a check that says `ready` and a filing that
   * 410s, which is the failure this button exists to prevent.
   *
   * Visibility is read from GitHub rather than from anything anybody typed, because it decides
   * whether the target's real address may go into a body at all.
   */
  async getRepo(): Promise<RepoCheck> {
    const answer = await this.request("GET", `/repos/${this.path()}`);
    if (answer.kind === "failed") {
      return { outcome: checkOutcomeFor(answer.failure.code), detail: answer.failure.message, visibility: "unknown", expiresAt: null };
    }
    if (!answer.ok) {
      const failure = this.failureFrom(answer);
      return { outcome: checkOutcomeFor(failure.code), detail: failure.message, visibility: "unknown", expiresAt: answer.expiresAt };
    }
    const repo = parseJson(RepoSchema, answer.text);
    if (repo === undefined) {
      return {
        outcome: "unreachable",
        detail: "github.com answered, but not with a repository this can read — something may be answering in front of it.",
        visibility: "unknown",
        expiresAt: answer.expiresAt,
      };
    }
    // `internal` is not world-readable but is wider than private, and the stored enum has no word
    // for it. Anything that is not literally public is reported private, and the extra confirmation
    // a public repository requires is therefore not asked for an enterprise-internal one.
    const visibility = (repo.visibility === undefined ? !repo.private : repo.visibility === "public") ? "public" : "private";
    if (!repo.has_issues) {
      // `full_name` came off GitHub's payload and lands in a sentence a person reads, so it goes
      // through the same funnel as GitHub's error words. Every string quoted from there, or none.
      return { outcome: "no-issues", detail: `${this.sanitize(repo.full_name)} has its issue tracker switched off.`, visibility, expiresAt: answer.expiresAt };
    }
    const issues = await this.request("GET", `/repos/${this.path()}/issues?per_page=1`);
    if (issues.kind === "failed") {
      return { outcome: checkOutcomeFor(issues.failure.code), detail: issues.failure.message, visibility, expiresAt: answer.expiresAt };
    }
    if (!issues.ok) {
      const failure = this.failureFrom(issues);
      return { outcome: checkOutcomeFor(failure.code), detail: failure.message, visibility, expiresAt: issues.expiresAt ?? answer.expiresAt };
    }
    return { outcome: "ready", detail: null, visibility, expiresAt: issues.expiresAt ?? answer.expiresAt };
  }

  /**
   * Opens one issue, behind the gate, so two callers pressing at once become two requests in a row
   * rather than two at the same moment.
   *
   * Labels are sent with it because GitHub applies them on create — but a label the repository does
   * not have fails the WHOLE create with a 422, so `ensureLabels` runs first and this is where that
   * ordering is owed.
   */
  createIssue(issue: { title: string; body: string; labels: readonly string[] }): Promise<GithubOutcome<{ issue: IssueRef }>> {
    return this.serialize(async (): Promise<GithubOutcome<{ issue: IssueRef }>> => {
      const answer = await this.request("POST", `/repos/${this.path()}/issues`, {
        title: issue.title,
        body: issue.body,
        labels: [...issue.labels],
      });
      return this.asIssue(answer);
    });
  }

  /** The issue as it stands now, which is how a caller learns somebody closed it. */
  async getIssue(number: number): Promise<GithubOutcome<{ issue: IssueRef }>> {
    return this.asIssue(await this.request("GET", `/repos/${this.path()}/issues/${number}`));
  }

  /**
   * Adds a comment. Also behind the gate: a comment is content creation as far as the secondary
   * limit is concerned, and a repeat pass over forty filed issues is forty comments.
   */
  addComment(number: number, body: string): Promise<GithubOutcome<{ id: number; url: string }>> {
    return this.serialize(async (): Promise<GithubOutcome<{ id: number; url: string }>> => {
      const answer = await this.request("POST", `/repos/${this.path()}/issues/${number}/comments`, { body });
      if (answer.kind === "failed") return answer.failure;
      if (!answer.ok) return this.failureFrom(answer);
      const comment = parseJson(CommentSchema, answer.text);
      if (comment === undefined) return this.unreadable(answer.status, "a comment");
      return { ok: true, id: comment.id, url: comment.html_url };
    });
  }

  /**
   * Reopens a closed issue.
   *
   * Populace does this because the problem was reported again and the record of it should be where
   * the reader is looking. It is not a claim about why anybody closed it — populace cannot know
   * that — and the comment that goes with it must say what was observed and leave the reading to
   * the reader.
   */
  async reopenIssue(number: number): Promise<GithubOutcome<{ issue: IssueRef }>> {
    return this.asIssue(await this.request("PATCH", `/repos/${this.path()}/issues/${number}`, { state: "open" }));
  }

  /**
   * Creates each label that is not there yet, and treats "it already exists" as success.
   *
   * This exists because of an asymmetry worth stating: a label GitHub does not know fails the
   * entire `createIssue` with a 422, so the issue is lost over a piece of decoration. Creating
   * first turns that into a call that is expected to be redundant almost every time.
   */
  ensureLabels(labels: readonly string[]): Promise<GithubOutcome<{ created: string[]; existing: string[] }>> {
    return this.serialize(async (): Promise<GithubOutcome<{ created: string[]; existing: string[] }>> => {
      const created: string[] = [];
      const existing: string[] = [];
      for (const name of labels) {
        const answer = await this.request("POST", `/repos/${this.path()}/labels`, { name, description: LABEL_DESCRIPTION });
        if (answer.kind === "failed") return answer.failure;
        if (answer.ok) {
          const label = parseJson(LabelSchema, answer.text);
          // GitHub's echo of the name it created, which a caller may show: same funnel again.
          created.push(label === undefined ? name : this.sanitize(label.name));
          continue;
        }
        // 422 `already_exists` is the expected answer, not a problem: this is create-or-ignore, and
        // a repository that already carries the label is the state being aimed at.
        if (answer.status === 422 && alreadyExists(this.wordsOf(answer))) {
          existing.push(name);
          continue;
        }
        return this.failureFrom(answer);
      }
      return { ok: true, created, existing };
    });
  }

  /**
   * Adds labels to an issue that already EXISTS, which is a different thing from the labels
   * `createIssue` sends with a new one.
   *
   * This exists because a label is not decoration: it is how a filed issue is handed to something
   * that watches the repository for one being added. Handing the same issue over a second time
   * therefore means taking the label off and putting it back, because the label is already there —
   * so this and `removeLabel` are a pair, and both halves have to be able to run blind.
   *
   * GitHub's endpoint is additive and forgiving: adding a label the issue already carries is a 200,
   * not an error, so a caller need not read the issue first to find out.
   *
   * `ensureLabels` must have run first, for the same reason `createIssue` owes it: a label this
   * repository does not have fails the WHOLE call with a 422. Here that would mean an issue that
   * was filed and then never handed over, which is worse than it sounds — the hand-over is the
   * whole point of the label.
   */
  addLabels(number: number, labels: readonly string[]): Promise<GithubOutcome<{ labels: string[] }>> {
    return this.serialize(async (): Promise<GithubOutcome<{ labels: string[] }>> => {
      // Nothing to add is not a request worth making. GitHub answers an empty `labels` array with a
      // 422, so a connection configured with no labels would produce a refusal that reads like a
      // problem with the issue rather than like a setting nobody filled in.
      if (labels.length === 0) return { ok: true, labels: [] };
      const answer = await this.request("POST", `/repos/${this.path()}/issues/${number}/labels`, { labels: [...labels] });
      if (answer.kind === "failed") return answer.failure;
      if (!answer.ok) return this.failureFrom(answer);
      const applied = parseJson(LabelListSchema, answer.text);
      // The labels are already ON the issue by the time this body arrives, so an echo this cannot
      // read must not be reported as a failure: the same reading `ensureLabels` gives an unreadable
      // create, and the alternative is a caller that abandons the hand-over because of a proxy's
      // reply. What was asked for is reported instead.
      if (applied === undefined) return { ok: true, labels: [...labels] };
      // GitHub's echo of the names, which a caller may show: same funnel as its error words.
      return { ok: true, labels: applied.map((label) => this.sanitize(label.name)) };
    });
  }

  /**
   * Takes ONE named label off an issue, and treats a label that was not on it as success.
   *
   * That last part is the whole difficulty here, so it is worth being explicit about. GitHub
   * answers **404 for two completely different things** on this endpoint:
   *
   * - the label is not on the issue — its message is about the LABEL ("Label does not exist");
   * - the issue is not there, or this token cannot see it — its message is GitHub's usual
   *   `Not Found`, and the path's issue number is the part that did not resolve.
   *
   * The first is the state the caller is ASKING for: it wants the label gone, and the label is
   * gone. Reporting it as a failure would abort a remove-then-add half way through, the label would
   * never go back on, and the issue would never be handed over again — a silent nothing, in the one
   * place where silence looks like success. The second is a real failure and stays one.
   *
   * They are told apart by GitHub's own words, which is the only signal in the answer: same status,
   * same path, same empty-ish body otherwise. A 404 whose body cannot be read is reported as the
   * failure, because nothing was learned — the same reading `searchIssues` gives an unreadable body,
   * and the honest direction when the alternative is claiming a label is gone from an issue that may
   * not exist at all.
   */
  removeLabel(number: number, label: string): Promise<GithubOutcome<{ removed: boolean }>> {
    return this.serialize(async (): Promise<GithubOutcome<{ removed: boolean }>> => {
      // The name is a whole path segment and a label may carry a space or a slash — `needs: triage`,
      // `area/web` — so it is encoded here rather than through `path()`, which deliberately keeps
      // the slash in `owner/name`. In a label a slash is part of the name, not a separator.
      const answer = await this.request("DELETE", `/repos/${this.path()}/issues/${number}/labels/${encodeURIComponent(label)}`);
      if (answer.kind === "failed") return answer.failure;
      if (answer.ok) return { ok: true, removed: true };
      if (answer.status === 404 && saysLabel(this.wordsOf(answer))) return { ok: true, removed: false };
      return this.failureFrom(answer);
    });
  }

  /**
   * Issues in this repository whose body carries a marker, which is the dedupe rule's second line
   * of defence: the local ledger is dropped whenever the store rebuilds its schema (ADR-0011), and
   * without asking GitHub what is already there, one schema change re-files every issue in
   * somebody's repository.
   *
   * Search is eventually consistent and has a rate limit of its own, so a caller treats an empty
   * answer as "nothing found", never as "nothing exists" — and a search that did not answer at all
   * as neither. That last distinction is why this one operation answers `MarkerSearch` instead of
   * `GithubOutcome`: see the note on the type. A caller that cannot tell a 403 from an absence
   * files a duplicate.
   */
  async searchIssues(marker: string): Promise<MarkerSearch> {
    const q = encodeURIComponent(`repo:${this.repo} is:issue in:body "${marker}"`);
    const answer = await this.request("GET", `/search/issues?q=${q}&per_page=10`);
    if (answer.kind === "failed") return { outcome: "could-not-answer", failure: answer.failure };
    if (!answer.ok) return { outcome: "could-not-answer", failure: this.failureFrom(answer) };
    const found = parseJson(SearchSchema, answer.text);
    // An unreadable body is a failure to answer and not an absence, for the same reason a 403 is:
    // something is in front of GitHub, and what is actually in the repository is unknown.
    if (found === undefined) return { outcome: "could-not-answer", failure: this.unreadable(answer.status, "search results") };
    const [first, ...rest] = found.items.map(refOf);
    if (first === undefined) return { outcome: "none" };
    return { outcome: "found", issues: [first, ...rest] };
  }

  // ---- the plumbing --------------------------------------------------------

  /** `owner/name`, each half encoded: it reaches a URL, and it came off a form. */
  private path(): string {
    return this.repo
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
  }

  private asIssue(answer: Answer): GithubOutcome<{ issue: IssueRef }> {
    if (answer.kind === "failed") return answer.failure;
    if (!answer.ok) return this.failureFrom(answer);
    const issue = parseJson(IssueSchema, answer.text);
    if (issue === undefined) return this.unreadable(answer.status, "an issue");
    return { ok: true, issue: refOf(issue) };
  }

  private unreadable(status: number, what: string): GithubFailure {
    return {
      ok: false,
      code: "malformed",
      message: `github.com answered ${status}, but not with ${what} this can read — something may be answering in front of it.`,
      status,
    };
  }

  /**
   * One request, with the bounded backoff around it.
   *
   * Retried: a limit in force (403 or 429 carrying a rate-limit signal) and GitHub's own 5xx. Not
   * retried: anything about the token or the repository, because asking again with the same
   * credential gets the same answer and a person is waiting.
   *
   * The loop cannot spin. `attempt` rises on every pass and every branch either returns or sleeps
   * a bounded wait and continues, and continuing is only reachable while `attempt < MAX_ATTEMPTS`
   * — so at most three calls go out, with at most two waits of at most `MAX_WAIT_MS` between them.
   * On top of that the pass budget is checked before each call and before each wait, so a client
   * whose wall clock is spent stops going out rather than starting a fresh bounded retry.
   */
  private async request(method: string, path: string, body?: JsonObject): Promise<Answer> {
    this.startedAt ??= this.now();
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const stop = this.outOfTime();
      if (stop !== null) return { kind: "failed", failure: stop };
      const answer = await this.send(method, path, body);
      const last = attempt >= MAX_ATTEMPTS;
      if (answer.kind === "failed") {
        // A timeout or a dropped connection is the one failure where trying again is plainly worth
        // it, and the wait is this client's own rather than anything GitHub asked for.
        if (last || backoffFor(attempt) > this.timeLeftMs()) return answer;
        await this.sleep(backoffFor(attempt));
        continue;
      }
      if (answer.ok || !retryable(answer)) return answer;
      const wait = this.waitFor(answer, attempt);
      // Out of the pass's wall clock, GitHub's own answer is the more useful thing to report: it
      // names the limit and the wait, where the budget refusal can only name the budget.
      if (last || wait === null || wait > this.timeLeftMs()) return answer;
      await this.sleep(wait);
    }
  }

  private async send(method: string, path: string, body?: JsonObject): Promise<Answer> {
    const url = `${API}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": USER_AGENT,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    };
    try {
      const response = await this.fetchImpl(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return {
        kind: "answered",
        ok: response.ok,
        status: response.status,
        text: await response.text(),
        retryAfter: header(response, "retry-after"),
        rateLimitRemaining: header(response, "x-ratelimit-remaining"),
        rateLimitReset: header(response, "x-ratelimit-reset"),
        expiresAt: asIso(header(response, "github-authentication-token-expiration")),
      };
    } catch (err) {
      // The transport's words, sanitised like everything else: a fetch failure message can carry
      // the request it was making, and this one was making it with a bearer token.
      return {
        kind: "failed",
        failure: {
          ok: false,
          code: "unreachable",
          message: this.sanitize(`github.com could not be reached: ${err instanceof Error ? err.message : String(err)}`),
          status: null,
        },
      };
    }
  }

  /**
   * How long to wait, from what GitHub said. `retry-after` is its explicit instruction and wins;
   * `x-ratelimit-reset` is a wall-clock second and is the fallback; with neither, the client's own
   * backoff applies. Null means "longer than this will hold a job open" — reported, not slept.
   */
  private waitFor(answer: AnsweredCall, attempt: number): number | null {
    const explicit = Number(answer.retryAfter);
    if (answer.retryAfter !== null && Number.isFinite(explicit)) {
      const ms = Math.max(0, explicit) * 1000;
      return ms > MAX_WAIT_MS ? null : ms;
    }
    const reset = Number(answer.rateLimitReset);
    if (answer.rateLimitReset !== null && Number.isFinite(reset)) {
      const ms = Math.max(0, reset * 1000 - this.now());
      return ms > MAX_WAIT_MS ? null : ms;
    }
    return backoffFor(attempt);
  }

  /**
   * GitHub's error body, parsed, with EVERY string in it already through `sanitize` — including
   * the nested `errors[]`, which is the half that was one line from being quoted raw.
   *
   * The funnel is here rather than at each use site on purpose. `failureFrom` quoted only the
   * top-level `message`, while `alreadyExists` was already reading `errors[]` and the nested
   * `message` is the useful half of a 422 ("body is too long", "labels is invalid") — so the next
   * person to quote it would have quoted an unsanitised third-party string, and the property that
   * is supposed to hold for this whole file is that GitHub's words reach a caller only one way.
   * Sanitising at the parse makes that structural instead of remembered.
   */
  private wordsOf(answer: AnsweredCall): GithubWords | undefined {
    const parsed = parseJson(ErrorSchema, answer.text);
    if (parsed === undefined) return undefined;
    return {
      message: this.sanitize(parsed.message),
      errors: (parsed.errors ?? []).map((e) => ({
        code: e.code === undefined ? undefined : this.sanitize(e.code),
        field: e.field === undefined ? undefined : this.sanitize(e.field),
        message: e.message === undefined ? undefined : this.sanitize(e.message),
      })),
    };
  }

  /** GitHub's answer, read as something a person can act on. */
  private failureFrom(answer: AnsweredCall): GithubFailure {
    const said = this.wordsOf(answer);
    const quote = quoteOf(said);

    if (answer.status === 401) {
      // An expired fine-grained token and a wrong one both come back 401, and the difference
      // matters to the reader: one is a lifetime that ran out, the other a value to check. GitHub
      // signals the first in its message and in the expiry header it sends on every answer, so
      // either is enough to report it distinctly — the way `signInStatus` reports a dead grant
      // rather than calling it a failure to connect.
      const expired = (said !== undefined && /expir/i.test(said.message)) || isPast(answer.expiresAt, this.now());
      if (expired) {
        return { ok: false, code: "expired", message: `That token has expired.${quote}`, status: 401 };
      }
      return { ok: false, code: "refused", message: `GitHub did not accept that token.${quote}`, status: 401 };
    }
    if (answer.status === 410) {
      return { ok: false, code: "no-issues", message: `${this.repo} has its issue tracker switched off, so there is nowhere to file.${quote}`, status: 410 };
    }
    if (answer.status === 404) {
      // GitHub answers 404 for a repository a token cannot see as well as for one that is not
      // there, on purpose, so that a token cannot be used to enumerate private repositories. The
      // message says both readings rather than picking the one that sends a reader the wrong way.
      return {
        ok: false,
        code: "not-found",
        message: `GitHub has nothing at that address for this token — either it is not there, or the token cannot see it.${quote}`,
        status: 404,
      };
    }
    if (retryable(answer)) {
      if (answer.status >= 500) {
        return { ok: false, code: "unreachable", message: `github.com answered ${answer.status}.${quote}`, status: answer.status };
      }
      return { ok: false, code: "rate-limited", message: `GitHub is rate limiting this token${waitWords(this.waitSecondsFor(answer))}.${quote}`, status: answer.status };
    }
    if (answer.status === 403) {
      return {
        ok: false,
        code: "refused",
        message: `That token may not do this in ${this.repo} — a fine-grained token needs write access to issues on this one repository.${quote}`,
        status: 403,
      };
    }
    return { ok: false, code: "refused", message: `GitHub refused with HTTP ${answer.status}.${quote}`, status: answer.status };
  }

  /** How long GitHub said to wait, in whole seconds, for a message rather than for a sleep. */
  private waitSecondsFor(answer: AnsweredCall): number | null {
    const explicit = Number(answer.retryAfter);
    if (answer.retryAfter !== null && Number.isFinite(explicit)) return Math.max(0, Math.round(explicit));
    const reset = Number(answer.rateLimitReset);
    if (answer.rateLimitReset !== null && Number.isFinite(reset)) return Math.max(0, Math.round((reset * 1000 - this.now()) / 1000));
    return null;
  }

  /**
   * Everything on its way to a caller passes through here.
   *
   * Two passes, and both are needed. `redactText` knows the shapes — a bearer header, a JWT, a
   * `ghp_`/`github_pat_` prefix — and catches a credential this code has never seen, which is what
   * makes it the right funnel for a stranger's error text. It cannot catch THIS token if the token
   * has no recognisable shape, so the literal value is removed as well, exactly as `scrub` does in
   * the kit: below a handful of characters a "secret" is more likely a word than a credential, so
   * the literal pass has the same length floor.
   */
  private sanitize(text: string): string {
    const withoutShapes = redactText(text).text;
    return this.token.length < 6 ? withoutShapes : withoutShapes.split(this.token).join("[redacted]");
  }

  /**
   * One content-creating call at a time, in the order the calls were made. A failure releases the
   * gate like a success does: a 422 on issue eleven must not wedge the remaining twenty-nine.
   */
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const mine = this.gate.then(work);
    this.gate = mine.then(
      () => undefined,
      () => undefined,
    );
    return mine;
  }
}

/**
 * What each failure code means to the CHECK, whose five outcomes are narrower than the codes: a
 * check is about the connection, so anything that is not about the token's lifetime or the issue
 * tracker being off is either "GitHub said no" or "GitHub did not answer". A rate limit is filed
 * under `unreachable` deliberately — nothing is wrong with the connection, and telling somebody
 * their token was refused when it was throttled sends them to change a setting that is correct.
 */
function checkOutcomeFor(code: GithubFailureCode): RepoCheck["outcome"] {
  if (code === "expired") return "expired";
  if (code === "no-issues") return "no-issues";
  if (code === "unreachable" || code === "rate-limited" || code === "malformed") return "unreachable";
  return "refused";
}

/** Created alongside a label so somebody reading their repository settings knows what put it there. */
const LABEL_DESCRIPTION = "Opened by populace";

interface AnsweredCall {
  kind: "answered";
  ok: boolean;
  status: number;
  text: string;
  retryAfter: string | null;
  rateLimitRemaining: string | null;
  rateLimitReset: string | null;
  expiresAt: string | null;
}

/**
 * Either GitHub answered, or it did not and the reason is already in the shape a caller returns.
 *
 * The failure is carried ready-made rather than as a message, so that the one place a transport
 * problem is turned into a `GithubFailure` is `send`, and every operation forwards it unchanged
 * instead of each rebuilding a `code: "unreachable"` of its own. It is also how a pass that has
 * spent its wall clock reports `rate-limited` without pretending GitHub said anything.
 */
type Answer = AnsweredCall | { kind: "failed"; failure: GithubFailure };

/** GitHub's error body with every string in it sanitised. See `GithubClient.wordsOf`. */
interface GithubWords {
  message: string;
  errors: { code?: string; field?: string; message?: string }[];
}

/**
 * GitHub's words, appended to populace's own sentence — the top-level message plus what the nested
 * `errors[]` said about which field, because on a 422 that is the half that says what to change.
 *
 * Bounded, because this lands in a job's error field and on a screen: the first few entries and a
 * clipped line, rather than however many a validation failure produced.
 */
function quoteOf(said: GithubWords | undefined): string {
  if (said === undefined) return "";
  const details = said.errors.slice(0, 3).map(detailOf).filter(nonEmpty);
  const line = [said.message, ...details].filter(nonEmpty).join(" — ");
  if (line === "") return "";
  return ` GitHub says: ${line.length > MAX_QUOTE ? `${line.slice(0, MAX_QUOTE)}…` : line}`;
}

function detailOf(error: GithubWords["errors"][number]): string {
  const what = error.message ?? error.code ?? "";
  return error.field === undefined || what === "" ? what : `${error.field}: ${what}`;
}

function nonEmpty(text: string): boolean {
  return text.trim() !== "";
}

/** Long enough for a validation failure to be useful, short enough to sit in a job row. */
const MAX_QUOTE = 400;

function refOf(issue: z.infer<typeof IssueSchema>): IssueRef {
  return {
    number: issue.number,
    url: issue.html_url,
    state: issue.state === "closed" ? "closed" : "open",
    createdAt: asIso(issue.created_at ?? null),
  };
}

/**
 * Whether asking again could plausibly answer differently.
 *
 * 403 is the awkward one: it is both "this token may not" and, historically, how GitHub reports a
 * secondary limit. They are told apart by whether the answer carries a limit signal at all — a
 * `retry-after`, an exhausted `x-ratelimit-remaining`, or GitHub's own words naming the limit.
 * Reading a scope refusal as a limit would retry something that can never work; reading a limit as
 * a refusal would give up on something that clears in a minute.
 */
function retryable(answer: AnsweredCall): boolean {
  if (answer.status >= 500) return true;
  if (answer.status !== 403 && answer.status !== 429) return false;
  if (answer.retryAfter !== null) return true;
  if (answer.rateLimitRemaining === "0") return true;
  return /rate limit|abuse detection|secondary/i.test(answer.text);
}

/** 1s, then 2s. Small, fixed and bounded: this is a courtesy pause, not a retry strategy. */
function backoffFor(attempt: number): number {
  return Math.min(MAX_WAIT_MS, 1000 * 2 ** (attempt - 1));
}

function waitWords(seconds: number | null): string {
  if (seconds === null) return "";
  return seconds > 60 ? ` and will not clear for about ${Math.round(seconds / 60)} minutes` : ` and asks for ${seconds} seconds`;
}

function header(response: GithubResponse, name: string): string | null {
  return response.headers.get(name);
}

function alreadyExists(said: GithubWords | undefined): boolean {
  if (said === undefined) return false;
  return said.errors.some((e) => e.code === "already_exists") || /already exists/i.test(said.message);
}

/**
 * Whether a 404 from the remove-a-label endpoint was about the LABEL rather than about the issue.
 * See `removeLabel`: the two arrive as the same status on the same path, and GitHub's sentence —
 * "Label does not exist" against its generic "Not Found" — is the only thing that separates them.
 * Undefined words mean nothing was learned, which is not a licence to call the label gone.
 */
function saysLabel(said: GithubWords | undefined): boolean {
  if (said === undefined) return false;
  return /label/i.test(said.message) || said.errors.some((e) => /label/i.test(e.field ?? "") || /label/i.test(e.message ?? ""));
}

/**
 * A date GitHub gave, in the ISO shape the contract declares — the token's expiry off a response
 * header, and an issue's `created_at` off a payload.
 *
 * Both need the same nudging and both must fail soft. The expiry header is written
 * `2026-12-31 23:59:59 UTC`, which is not a format `Date` is required to parse; `created_at` is
 * already ISO but is reparsed rather than trusted, because it is about to be stored as a
 * `z.iso.datetime()`. Null when there was nothing to read or nothing readable, which is what a
 * classic token with no expiry and an issue payload missing a date both look like.
 */
function asIso(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const normalized = value
    .trim()
    .replace(/\s+([+-]\d{2}:?\d{2})$/, "$1")
    .replace(/\s+UTC$/i, "Z")
    .replace(" ", "T");
  const at = new Date(normalized);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

function isPast(iso: string | null, now: number): boolean {
  if (iso === null) return false;
  const at = new Date(iso).getTime();
  return !Number.isNaN(at) && at <= now;
}

/**
 * GitHub's JSON, narrowed at the boundary and never handled raw (ADR-0001, ADR-0002). Undefined
 * for anything that is not what was asked for, including an HTML error page from a proxy — which a
 * caller reports as "something is answering in front of GitHub" rather than crashing on.
 */
function parseJson<T extends z.ZodType>(schema: T, text: string): z.infer<T> | undefined {
  try {
    // eslint-disable-next-line no-restricted-syntax -- HTTP boundary: github.com's response body, narrowed by the schema on this line before anything reads it.
    const parsed = schema.safeParse(JSON.parse(text) as unknown);
    return parsed.success ? parsed.data : undefined;
  } catch {
    /* not JSON at all: a proxy's HTML, or an empty body */
    return undefined;
  }
}

import { z } from "zod";
import { FindingKindSchema, SeveritySchema } from "./finding.js";

/**
 * YOUR credential to a third party that is NOT the target — the fine-grained token populace holds
 * so it can open issues in your repository on your behalf.
 *
 * This is a THIRD class of credential, and it is worth naming as such because ADR-0036 and
 * ADR-0037 describe only two and ADR-0037 says in as many words that populace holds no vendor
 * credential at all. Both of the originals point at the product under study:
 *
 * - YOUR sign-in to a gated target (`SignInGrant`) — one human's OAuth grant, passed only by the
 *   things acting AS that human, which is checking an address and listing its tools.
 * - THEIRS, one account per person (`identity`) — what `runWake` passes, and the only bearer a
 *   person in a population ever carries.
 *
 * This one points somewhere else entirely: at github.com, which is not the target, was never
 * visited by anybody in a population, and has nothing to do with the study. That makes the
 * confusion rule simpler than the other two rather than harder — **it must never reach `runWake`
 * or `McpSession.connect` at all**, under any name. There is no legitimate path by which the code
 * that talks to somebody's product should be holding the code that talks to their repository, and
 * a token that arrived at a wake would be sent to a stranger's MCP server as a bearer.
 *
 * It lives in its own table for the same reason `sign_in_grants` does, and obeys the same
 * discipline (ADR-0040): it goes up and never comes back down — never in a response body, never in
 * a `ConfigSnapshot`, never in a trace, never in an event payload, never logged.
 *
 * One connection per project, keyed by `projectId`. Nothing is shared across projects (ADR-0035),
 * and a project's finding signatures only roll up within it, so a project's issues only roll up
 * within one repository too.
 */
export const GithubConnectionSchema = z.object({
  projectId: z.string().min(1),
  /**
   * `owner/name`. GitHub allows a hyphen anywhere but the first character of an owner and up to 39
   * characters of it, and allows `.`, `_` and `-` in a repository name — so a regex that only
   * accepted `[a-z0-9-]` on both halves would reject real repositories like `owner/my_repo.js`.
   */
  repo: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/, "expected owner/name"),
  /**
   * The token. A fine-grained PAT with `issues:write` on the one repository is all this needs, and
   * asking for less is the point of naming it here. Optional because a connection may be authored
   * before anybody pastes one, and because the write path is absent-keeps / `""`-clears /
   * value-replaces: a PUT that carries no token is editing the other fields, not clearing this one.
   */
  token: z.string().min(1).optional(),
  /**
   * Whether the repository is world-readable, as the CHECK found it — not as anybody typed it.
   *
   * It is stored because a public repository is a different risk, not a different preference: an
   * issue body carries the target's real MCP endpoint and every hit cohort's brief, so filing to a
   * public repository publishes an internal address and the study's setup. `unknown` is the honest
   * state before a check has run, and it is the default rather than `private` so nothing treats an
   * unchecked connection as safe.
   */
  visibility: z.enum(["private", "public", "unknown"]).default("unknown"),
  /** Opt-in. Default off, because filing is an outbound write to somebody else's server. */
  autoFile: z.boolean().default(false),
  /** Applied to every issue populace opens, created first if the repository lacks them. */
  labels: z.array(z.string().min(1)).default(["populace"]),
  /**
   * What the automatic path is allowed to file. This narrows; it never widens — the hard skips
   * (praise, a settled signature, an absence card, a duplicate, anything the ledger matches) apply
   * whatever is set here.
   */
  filter: z
    .object({
      /**
       * `friction` and `suggestion` are off by default. They are real findings and worth reading on
       * the results screen, and they are not what somebody wants forty of in their issue tracker
       * the first time they leave a study running overnight.
       */
      kinds: z.array(FindingKindSchema).default(["bug", "coverage-gap", "abandonment"]),
      minSeverity: SeveritySchema.default("medium"),
      /**
       * Only file what the verifier confirmed. Off by default: a `coverage-gap` is settled
       * mechanically and an `abandonment` has nothing to replay, so requiring a confirmed verdict
       * silently drops whole kinds rather than raising the bar on them.
       */
      onlyConfirmed: z.boolean().default(false),
    })
    .prefault({}),
  /** When the check last reached the repository. Null before anybody has pressed it. */
  checkedAt: z.iso.datetime().nullable().default(null),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type GithubConnection = z.infer<typeof GithubConnectionSchema>;

/**
 * Where an issue was filed. A single-member enum rather than a literal, deliberately — see the
 * note on `FiledIssueSchema.provider`, which is about what an unparseable ledger row costs.
 */
export const FiledIssueProviderSchema = z.enum(["github"]);
export type FiledIssueProvider = z.infer<typeof FiledIssueProviderSchema>;

/**
 * One report window in which a filed problem was reported — the entry a repeat comment counts.
 *
 * **Why a bare `seq` is not enough, and this is the part that bit.** `seq` counts executions of a
 * study, and a LONGITUDINAL study has exactly one execution for its whole life: one run, `seq` 1,
 * for ever. So a ledger that recorded `{ studyId, runId, seq }` alone would append an identical
 * entry on every report cycle, and nothing downstream could tell cycle 7 from a double-publish of
 * cycle 1. Both of the claims this ledger exists to support would be uncomputable: "reported again
 * in execution N" would always say 1, and "not reported in the last 3 report cycles" has no
 * sequence to count back through at all.
 *
 * `window` is that sequence: the cycle ordinal within the execution, counting from 1, which is
 * also why a plain execution boundary is window 1 rather than nought. `(studyId, runId, seq,
 * window)` is therefore the identity of a sighting, and appending one that is already there is a
 * double-publish to be dropped rather than a second sighting.
 *
 * `studyId` and `runId` are carried and not inferred because `seq` counts within a study while
 * this ledger is per project — ADR-0035 deliberately puts a dev study and a qa study in ONE
 * project, so "also in execution 7" would otherwise name two different executions.
 */
export const FiledIssueSightingSchema = z.object({
  studyId: z.string().min(1),
  runId: z.string().min(1),
  seq: z.number().int().positive(),
  /**
   * The report cycle within that execution, from 1. Defaulted rather than required so a row
   * written before windows existed stays parseable — and it defaults to 1 because that is what a
   * plain execution boundary is.
   */
  window: z.number().int().positive().default(1),
  /**
   * When the window closed. Nullable, and null on a row written before this field existed: a
   * legacy sighting genuinely does not know its own time and inventing one would be a fabricated
   * timestamp in the one record a reader trusts to be a history.
   */
  at: z.iso.datetime().nullable().default(null),
});
export type FiledIssueSighting = z.infer<typeof FiledIssueSightingSchema>;

/**
 * One announcement that this problem stopped being reported: an event, recorded so it is not made
 * twice.
 *
 * **`since` is the whole design.** It is the study-wide ordinal of the last report window that DID
 * report the problem, as populace knew it when the notice went out — so it names WHAT went quiet
 * rather than when somebody happened to publish. Every later quiet cycle looks back at the same
 * last report and so carries the same `since`: that is the same news, and it is dropped. A problem
 * that comes back in a later window and then goes quiet again looks back at THAT window instead, so
 * `since` differs and the absence is news once more. Nought is the honest value where populace has
 * no report of it on record at all, which is the marker-search case — an issue older than the
 * ledger that knows about it.
 *
 * It carries `studyId` because the issue is per PROJECT and a project holds several studies against
 * several targets (ADR-0035): a dev study falling silent is not the qa study's news, and keying the
 * notice on the issue alone would let the first study to publish take the other's turn to speak.
 *
 * It is deliberately NOT a `seenIn` entry. A sighting means "this was reported in that window", and
 * recording an announcement as one would make the one record a reader trusts to be a history say
 * the problem was reported in the very window whose silence the comment is about.
 */
export const FiledIssueQuietNoticeSchema = z.object({
  studyId: z.string().min(1),
  /**
   * The study-wide window ordinal of the last report behind this notice, or nought where populace
   * had no report of the problem on record. Non-negative rather than positive for exactly that
   * case.
   */
  since: z.number().int().nonnegative(),
  /**
   * When the notice went out. Nullable for the same reason a sighting's `at` is: a row written
   * before this field existed does not know, and inventing a time would be a fabricated timestamp.
   */
  at: z.iso.datetime().nullable().default(null),
});
export type FiledIssueQuietNotice = z.infer<typeof FiledIssueQuietNoticeSchema>;

/**
 * One issue populace has filed, and every finding signature the cluster behind it contained. This
 * is the dedupe ledger: the thing that makes "the same problem is not filed twice" true.
 *
 * **Why `signatures` is a SET and not one representative signature.** The obvious key would be
 * `ClusterCardView.signature`, and it does not work, because that field is the *representative* of
 * a clustering over ONE window's findings. `pickRepresentative`
 * (`packages/reports/src/cluster.ts:31`) sorts on verdict score FIRST, and verdicts are written by
 * the digest AFTER the run — so file at the end of an execution, build a digest, and the same
 * cluster now presents under a DIFFERENT representative. The key changes inside a single
 * execution, before anybody has reworded anything, and the second pass files a duplicate.
 *
 * What is actually stable is the individual finding's own `signature`: the runner computes it once
 * at file time from `kind | primary tool | sorted title tokens` and never recomputes it. So the
 * match is set intersection over members — a candidate cluster is already filed if ANY of its
 * members' signatures appears in ANY filed set — and on a match the candidate's new signatures are
 * added to this row, so the set grows and drift is absorbed instead of forking.
 *
 * **The match is scoped to a repository, not to a project.** `provider` and `repo` are part of the
 * key a candidate is matched on, because re-pointing a project at a second repository is one PUT
 * (`saveGithubConnection` upserts on `projectId`) and a dev/qa split in one project is the
 * intended shape (ADR-0035). Match on the project alone and every candidate afterwards matches a
 * row filed into the OLD repository: the publisher comments on a repository the token is not
 * scoped to, and the new one never receives an issue at all. A row filed elsewhere is genuinely
 * not a match — the problem has never been filed there — and it is kept rather than swept, because
 * it is what stops a re-point-and-back from filing everything twice.
 *
 * **A candidate may match MORE than one row,** which is why the store returns all of them. The
 * clusterer is greedy over titles at a 0.3 Jaccard floor, so a later report whose title bridges
 * two previously separate problems merges them into one cluster whose signature set intersects two
 * rows. The oldest wins — it is the issue a reader has been following — and the rest are marked
 * `supersededBy` so an orphan is a stated outcome rather than an accident.
 *
 * **What this does not catch,** and it should be said rather than dressed up as idempotency: a
 * finding reworded from scratch shares no member signature with what was filed, so it gets its own
 * issue. Reworded titles do not merge at the clusterer's 0.3 Jaccard floor either, and ADR-0028's
 * amendment measures recurrence of an identical signature across executions at 0%. The backstops
 * are the `<!-- populace:… -->` marker searched in the repository before creating, and the
 * already-filed column a human reads before pressing the bulk action.
 */
export const FiledIssueSchema = z.object({
  projectId: z.string().min(1),
  /**
   * Who it was filed with. One member today, and a single-member `enum` rather than a `literal`
   * ON PURPOSE: a `literal` makes a second provider's row unparseable, and an unparseable ledger
   * row is one the reads below SKIP — so the row that was supposed to prove the field earns its
   * keep would instead be invisible, and its issue would be filed again. An `enum` widens by
   * adding a member, which is the whole reason this is a field and not an assumption (the store has
   * no migration framework — ADR-0011).
   */
  provider: FiledIssueProviderSchema,
  /**
   * `owner/name` as it was when the issue was opened; a connection may later point elsewhere, and
   * when it does this row stops matching. Part of the match key — see the note above.
   */
  repo: z.string().min(1),
  number: z.number().int().positive(),
  url: z.url(),
  /** The title it went out under, which is not necessarily the cluster's title today. */
  title: z.string().min(1),
  /** EVERY finding signature the filed cluster contained. See the note above — this is the key. */
  signatures: z.array(z.string().min(1)).min(1),
  /**
   * Every report window this problem has been reported in, in order, which is what a repeat
   * comment names and what "not reported in the last 3 report cycles" counts.
   */
  seenIn: z.array(FiledIssueSightingSchema).default([]),
  /**
   * Every time populace has announced on this issue that the problem stopped being reported.
   *
   * **This exists because an absence is NEWS and not a STATE.** The gone-quiet comment is the
   * payload of the whole loop — the thing a developer reads after their pull request lands — and
   * nothing bounded how many times it was written. Once a filed problem stopped being reported,
   * every later report window announced the absence again with a bigger number in it, for the rest
   * of the study's life: on the default hourly cycle roughly a hundred and seventy comments a week,
   * landing on precisely the issues whose repairs had just worked. The one comment a reader is
   * supposed to act on became the one they mute the issue over.
   *
   * So the notice is recorded, and it goes out again only when the NEWS changes: the problem came
   * back (which is the `regressed` comment's job), and then went quiet again from a later report.
   * `since` is what makes those two different pieces of news rather than one restated — see
   * `FiledIssueQuietNoticeSchema`.
   */
  quietNotices: z.array(FiledIssueQuietNoticeSchema).default([]),
  /**
   * The issue that absorbed this one, when a later report merged two problems that were filed
   * separately.
   *
   * This exists because a match is not guaranteed to be unique. `clusterFindings` is greedy over
   * titles at a 0.3 Jaccard floor, so a report whose title bridges two previously separate
   * problems merges them into one cluster — and that candidate's signature set then intersects
   * TWO ledger rows. The publisher comments on the oldest and cross-references the rest, and this
   * field is what says so: without it the newer row is silently orphaned, still matching
   * candidates, with nothing recording that its issue was superseded rather than abandoned.
   *
   * Null is the normal state. A superseded row is kept, not deleted — it is what stops the problem
   * being filed a third time if the clusterer stops bridging.
   */
  supersededBy: z.number().int().positive().nullable().default(null),
  filedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type FiledIssue = z.infer<typeof FiledIssueSchema>;

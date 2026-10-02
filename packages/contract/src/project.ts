import {
  AgentStatusSchema,
  CadenceSchema,
  ContinuedFromSchema,
  DurationSchema,
  FiledIssueSchema,
  FindingKindSchema,
  FindingSchema,
  FirstContactOutcomeSchema,
  GithubConnectionSchema,
  MemorySchema,
  ModelOverrideSchema,
  PersonaSchema,
  PersonOverridesSchema,
  ReportCycleSchema,
  RetiredReasonSchema,
  SeveritySchema,
  ToolCallRecordSchema,
  ToolPolicySchema,
  TraitValueSchema,
  TriageStateSchema,
  VerdictSchema,
  VerificationSchema,
  WakeStatusSchema,
} from "@populace/core/isomorphic";
import { z } from "zod";
import { RunDetailSchema, RunStatusSchema, RunSummarySchema, RunTotalsSchema, StudyModeSchema, ToolUsageViewSchema } from "./views.js";
import { EstimateViewSchema, StudyOverridesInputSchema } from "./setup.js";

/**
 * The project, study and participant read models (SPEC §6.2), served by
 * `packages/server/src/project-read-model.ts`.
 *
 * Two rules shape every shape below.
 *
 * **Decision A — the wire speaks the user's words (ADR-0032).** A `ParticipantSummaryView` is a
 * translation of an `Agent` row: `wakeCount` becomes `visits`, `maxWakes` becomes `maxVisits`, and
 * the word "agent" does not appear on the wire at all. The same rule renames the row the product
 * calls a STUDY: every `Study*` shape here is that row translated (ADR-0042), and the word the row
 * uses for itself appears on the wire nowhere — not in a path, a field, a query parameter or a
 * sentence — and neither does "lane", which is the internal name for a cohort's share of one
 * persona. The rows, the tables and every store method keep their names; this is a boundary, not
 * a rename underneath it.
 *
 * **SPEC §7.1 — the top three levels never name a person.** `ProjectOverviewView` and
 * `StudyResultsView` carry NO person names, deliberately: a name first appears on a finding page,
 * as the author of a quote. The rule is enforced by these payload shapes rather than by screen
 * discipline, so a screen that wants to break it has to add a request to do it.
 */

// ---- projects --------------------------------------------------------------

export const ProjectViewSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  archived: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ProjectView = z.infer<typeof ProjectViewSchema>;

export const ProjectInputSchema = z.object({
  /** Only honoured on create; a slug never changes afterwards. Derived from the name if absent. */
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  name: z.string().min(1),
  description: z.string().optional(),
});
export type ProjectInput = z.infer<typeof ProjectInputSchema>;

export const ProjectCountsSchema = z.object({
  studies: z.number().int().nonnegative(),
  targets: z.number().int().nonnegative(),
  personas: z.number().int().nonnegative(),
  cohorts: z.number().int().nonnegative(),
  /**
   * Saved compositions. Added when populations became something a user can author: the rail's
   * Populations row gated on a count it had no way of getting, so it ran a query of its own and
   * the row was unreachable anyway because nothing in the browser could make a second population.
   */
  populations: z.number().int().nonnegative(),
  /**
   * Person rows that are not archived: everybody some study currently sends, whichever study. It
   * is a count of rows, not a sum of study sizes — two studies over one cohort meet the same
   * people up to the smaller size, and those people are counted once (ADR-0041).
   */
  people: z.number().int().nonnegative(),
});

/** A card on the projects index: what is in it, whether anything is going, what it has cost. */
export const ProjectSummaryViewSchema = ProjectViewSchema.extend({
  counts: ProjectCountsSchema,
  runningRunIds: z.array(z.string()),
  lastActivityAt: z.iso.datetime().nullable(),
  costLast7dUsd: z.number().nonnegative(),
});
export type ProjectSummaryView = z.infer<typeof ProjectSummaryViewSchema>;

// ---- studies ---------------------------------------------------------------

/**
 * `never-run` is not an error state, it is the common one: the zero state is the most important
 * screen in the product, and it is reached by a study that exists and has never gone.
 */
export const StudyStatusSchema = z.enum(["never-run", "running", "paused", "idle", "failed"]);
export type StudyStatus = z.infer<typeof StudyStatusSchema>;

export const StudySummaryViewSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  /** What this study tells its people, after their cohort's context. Empty says nothing extra. */
  brief: z.string(),
  mode: StudyModeSchema,
  /**
   * THE headcount (ADR-0041): how many people this study sends, before the deal. Nought is legal
   * and sends nobody, and a start is refused until it is raised.
   */
  size: z.number().int().nonnegative(),
  /**
   * How many the deal actually sends: the sum over every cohort's personas. Below `size` when a
   * cohort in the population has no personas to deal into, which is the cue that it needs some.
   */
  sends: z.number().int().nonnegative(),
  visitsPerPerson: z.number().int().positive().nullable(),
  /**
   * How often its people come back, as the row holds it: milliseconds once parsed, though a
   * duration such as `"10m"` is accepted on the way in. The builder shows these in edit mode and
   * sends them back only when they moved, so a saved timing is never quietly replaced by a default.
   */
  cadence: CadenceSchema,
  /** Seeds cadence jitter only; the people are drawn from their cohort's seed, not this one. */
  seed: z.string(),
  /**
   * How often a run of this study stops to report — how often populace looks at what it has found
   * and writes to the tracker it is connected to (ADR-0045). Milliseconds once parsed, the same as
   * `cadence`, and shown and sent by the builder the same way.
   *
   * Optional here, and it is the one field on this view a list row may be without: the studies
   * index has no control for it and nothing on that screen reads it, where a study read on its own
   * — which is what the builder opens on — always carries it. A form with nothing to open on falls
   * back to the schema's own rhythm rather than inventing one, since that is what a study nobody
   * has set this on actually runs.
   */
  reportCycle: ReportCycleSchema.optional(),
  autoSweep: z.boolean(),
  requireFreshTarget: z.boolean(),
  /**
   * The override blocks as saved, in the shape a builder sends them back. `overriding` below says
   * WHICH blocks are set, in the Settings screen's words; this is what they hold, so an edit can
   * open on the saved values rather than on the project's defaults. A block with nothing in it
   * overrides nothing.
   */
  overrides: StudyOverridesInputSchema,
  /** Headcount is deliberately absent here: a population has none, the study's `size` is it. */
  population: z.object({ id: z.string(), name: z.string(), cohorts: z.number().int().nonnegative() }),
  /** `reachable` is null when nobody has asked the target yet; checking it costs a connection. */
  target: z.object({ id: z.string(), name: z.string(), reachable: z.boolean().nullable(), resets: z.boolean() }),
  status: StudyStatusSchema,
  latest: z
    .object({
      runId: z.string(),
      seq: z.number().int().positive(),
      startedAt: z.iso.datetime().nullable(),
      endedAt: z.iso.datetime().nullable(),
      status: RunStatusSchema,
      totals: RunTotalsSchema,
    })
    .nullable(),
  confirmed: z.number().int().nonnegative(),
  newSinceLast: z.number().int().nonnegative(),
  fixedSinceLast: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  nextVisitAt: z.iso.datetime().nullable(),
  /**
   * Which blocks of the project's settings this study sets for itself, in the words the Settings
   * screen uses for them. A study that overrides nothing reports nothing, and a screen that shows
   * a limit can say whether editing Settings would move it — otherwise a study quietly running on
   * its own ceilings looks exactly like one running on the project's.
   */
  overriding: z.array(z.enum(["spending", "verification", "model"])),
});
export type StudySummaryView = z.infer<typeof StudySummaryViewSchema>;

/**
 * The report cycle on the way UP: every field optional and not one of them carrying a default.
 *
 * It is written out rather than taken as `ReportCycleSchema.partial()` for the reason
 * `SettingsInputSchema` gives about the guardrail blocks, and it bites harder here. `.partial()`
 * makes a key optional and leaves the field's own `prefault` in place, so
 * `ReportCycleSchema.partial().parse({ every: "2h" })` comes back as all four fields — `jitter` at
 * five minutes, `everyVisits` at twenty-five — and a merge over the saved row would quietly
 * replace two settings the sender never mentioned. What this dial controls is how often populace
 * writes into somebody's issue tracker, so a field nobody sent must mean "leave it".
 *
 * Its keys are asserted against the stored schema's in `project.test.ts`, so a field added there
 * cannot silently become unsettable here.
 */
export const ReportCycleInputSchema = z.object({
  every: DurationSchema.optional(),
  jitter: DurationSchema.optional(),
  initialDelay: DurationSchema.optional(),
  everyVisits: z.number().int().positive().nullable().optional(),
});
export type ReportCycleInput = z.infer<typeof ReportCycleInputSchema>;

/**
 * Creating a study. The builder has the whole form at once, so everything a study is made of is
 * here at creation: `targetId` and `populationId` are REQUIRED — a project holds several of each
 * and the server refuses to guess which (ADR-0035); a POST without them is a 400 that names the
 * choices and creates nothing — and so is `size`, because a study IS a population at a size
 * (ADR-0041) and saving one is what writes its people. `slug` is only honoured here; it never
 * changes afterwards.
 */
export const StudyCreateInputSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  /** What this study tells its people, after their cohort's context. Optional; empty says nothing. */
  brief: z.string().optional(),
  populationId: z.string().min(1),
  targetId: z.string().min(1),
  /** How many people go. Nought is legal, sends nobody, and cannot start until raised. */
  size: z.number().int().nonnegative(),
  /** Null is a longitudinal study; a number is an ephemeral one and its visit cap. */
  visitsPerPerson: z.number().int().positive().nullable().optional(),
  cadence: CadenceSchema.partial().optional(),
  seed: z.string().optional(),
  /**
   * How often a run of this study stops to report, and the one dial on the rate at which populace
   * writes into somebody's issue tracker (ADR-0045) — which is why it is settable at all: the
   * hazard the automatic path carries is writing too often, and a hazard with no dial is a hazard
   * nobody can turn down.
   *
   * A partial, for the same reason `cadence` is a partial: a form that shows two of the four
   * fields must not send the other two carrying a schema default over what is saved. Sent fields
   * are merged over the study's own, field by field. See `ReportCycleInputSchema` for why it is
   * not `ReportCycleSchema.partial()`.
   */
  reportCycle: ReportCycleInputSchema.optional(),
  autoSweep: z.boolean().optional(),
  requireFreshTarget: z.boolean().optional(),
  overrides: StudyOverridesInputSchema.optional(),
});
export type StudyCreateInput = z.infer<typeof StudyCreateInputSchema>;

/**
 * Editing a study sends what changed, and nothing is required. A new `size` re-deals the roster
 * at once (growing re-deals nobody; shrinking puts people aside, not away). A running
 * longitudinal execution takes any of this only through `studyApply`; an ephemeral one uses it
 * next time. The slug is immutable and so is not here.
 */
export const StudyUpdateInputSchema = StudyCreateInputSchema.omit({ slug: true }).partial();
export type StudyUpdateInput = z.infer<typeof StudyUpdateInputSchema>;

// ---- github ----------------------------------------------------------------

/**
 * The project's issue connection as the browser may see it, which is everything about it except
 * the one field that matters most.
 *
 * `tokenSet` is there in place of `token` for the reason every other credential on this wire is
 * write-only (ADR-0036, ADR-0040, `DATA-MODEL.md` §4): **a credential goes up and never comes back
 * down.** A form editing a saved connection has never been shown the token it is editing and does
 * not need to be — it needs to know that one is stored, so that it can offer to replace it and can
 * tell "no token yet" apart from "a token you cannot see". This is the same shape
 * `IdentityConfigView` uses for admin-mint's `apiKey` and provision-url's `secret`.
 *
 * The fields it does carry are the stored schema's own, picked rather than restated, so a default
 * or a nested field added to the connection cannot quietly go missing here. `projectId` is absent
 * because it is in the path, and the timestamps because `checkedAt` is the only one a screen says
 * anything about.
 *
 * `GET` answers `null` when no connection has been made, which a client reads by wrapping this in
 * `.nullable()` — there is nothing to view before somebody types a repository, and an empty object
 * pretending to be a connection would make the settings screen say the project has one.
 *
 * **A route serving this PARSES; it does not build a literal.** `GithubConnectionViewSchema.parse(…)`
 * is the whole guard, because a `z.object` drops every key it does not name and so the token cannot
 * survive the call whatever was handed in. The reason to insist on it is that the natural-looking
 * alternative leaks and the compiler says nothing:
 *
 * ```ts
 * const view: GithubConnectionView = { ...connection, tokenSet: connection.token !== undefined };
 * ```
 *
 * That compiles clean and puts the token on the wire. TypeScript performs no excess-property check
 * across a SPREAD — the check exists only for keys written out in the literal — so `token` rides
 * along with nothing to warn about it. And the shape a route author reaches for first is
 * `settingsView` (`control.ts:1236-1253`), which is safe only because it is a whitelist literal
 * naming every field it serves: the same code with one spread in it is silently a leak. Parsing
 * makes the guard structural instead of a thing the next author has to remember (ADR-0040).
 */
export const GithubConnectionViewSchema = GithubConnectionSchema.pick({
  repo: true,
  visibility: true,
  autoFile: true,
  labels: true,
  /**
   * The label that hands a filed issue over to whatever watches the repository, or null for none.
   *
   * On the view rather than hidden with the token because it is not a credential — it is a label
   * do for a secret. It is also the field a reader goes looking for when they want to know whether
   * populace is handing anything over at all, so it has to come back down.
   */
  filter: true,
  checkedAt: true,
}).extend({
  /** A token is stored. Never which one. */
  tokenSet: z.boolean(),
});
export type GithubConnectionView = z.infer<typeof GithubConnectionViewSchema>;

/**
 * A patch over the stored connection: a field this does not mention keeps the value the project
 * already has, so a form that only flips `autoFile` sends `{ autoFile: true }` and cannot
 * accidentally reword the filter on its way through.
 *
 * **The token's three cases, which are the `mergeIdentity` rule exactly** (`control.ts:173-215`,
 * and `EndpointInputSchema.bearerToken` before it):
 *
 * - **absent** — keep whatever is stored. This is what a form editing the other fields sends,
 *   because it was never shown the token and has nothing to send back.
 * - **the empty string** — clear it. This is the only way to remove a token without deleting the
 *   whole connection, and it has to be a value rather than an absence for exactly that reason.
 * - **a value** — replace it.
 *
 * `repo` is optional for the same reason: a PUT editing the filter keeps the repository. On the
 * first PUT there is nothing to keep, so a body with no `repo` is refused by name rather than
 * inventing one — the server refuses to guess and says what is missing (ADR-0035's rule).
 *
 * `visibility` is deliberately NOT here. Whether a repository is world-readable is something the
 * CHECK found out by asking GitHub, not a preference somebody types; a form that could set it
 * could declare a public repository private and walk past the confirmation that exists because a
 * public one publishes the target's address and the study's setup.
 */
export const GithubConnectionInputSchema = z.object({
  repo: GithubConnectionSchema.shape.repo.optional(),
  /** Absent keeps the stored token, the empty string clears it, a value replaces it. */
  token: z.string().optional(),
  autoFile: z.boolean().optional(),
  labels: z.array(z.string().min(1)).optional(),
  /**
   * A partial filter carrying NO defaults, for the same reason `GuardrailsOverrideSchema` exists:
   * `.partial()` of the stored object would leave each field's `.default()` in place, so
   * `{ minSeverity: "high" }` would arrive carrying `kinds` and `onlyConfirmed` at their schema
   * defaults and overwrite whatever the project had chosen.
   */
  filter: z
    .object({
      kinds: z.array(FindingKindSchema).optional(),
      minSeverity: SeveritySchema.optional(),
      onlyConfirmed: z.boolean().optional(),
    })
    .optional(),
});
export type GithubConnectionInput = z.infer<typeof GithubConnectionInputSchema>;

/**
 * Checking the connection: does the repository answer, does this token reach it, and may it open
 * an issue there. `ProvisioningCheckBodySchema` is the precedent and the split is the same one —
 * the non-secret field is required because the form has it on screen, and the secret is optional
 * because the form has never been shown it.
 */
export const GithubCheckBodySchema = z.object({
  repo: GithubConnectionSchema.shape.repo,
  /** Absent means "use whatever is stored". Present is used as typed, saved or not. */
  token: z.string().optional(),
});
export type GithubCheckBody = z.infer<typeof GithubCheckBodySchema>;

/**
 * What the check found, in the register `ProvisioningCheck` and `FirstContact` use: one sentence a
 * human can act on, and the remote's own words underneath when there are any.
 *
 * Five outcomes, and each is a different thing for the reader to do:
 *
 * - `ready` — the repository answers, the token reaches it, and issues are on. Nothing to do.
 * - `unreachable` — github.com did not answer at all. A network problem, not a permission one.
 * - `refused` — it answered and said no: a token with the wrong scope, a token for the wrong
 *   repository, or a repository that does not exist to this token, which GitHub deliberately
 *   answers the same way as one that does not exist at all.
 * - `no-issues` — the repository is there and has its issue tracker switched off, which is a
 *   setting on their side and not a populace problem. Filing would 410 every time.
 * - `expired` — a fine-grained token has a lifetime and this one is past it. Reported on its own
 *   because "refused" would send a reader hunting for a scope they already granted, the same way
 *   `SignInStatus` reports a dead grant rather than calling it a failure to connect.
 */
export const GithubCheckResultSchema = z.object({
  outcome: z.enum(["ready", "unreachable", "refused", "no-issues", "expired"]),
  summary: z.string(),
  /**
   * GitHub's own words, or the transport's. Null when there was nothing to quote. It goes through
   * `redactText` on the way here: a remote's error message is somewhere a credential can end up.
   */
  detail: z.string().nullable(),
  /**
   * Whether the repository is world-readable, as GITHUB answered — not as anybody typed it — and
   * `unknown` when the check did not get through to ask. It is the stored field's own enum so the
   * value this returns is the value written onto the connection, and the two cannot drift.
   *
   * A public repository is a different risk rather than a different preference: an issue body
   * carries the target's real MCP endpoint and every hit cohort's brief, so this is what the extra
   * confirmation and the reduction of an endpoint to its bare host are decided from.
   */
  visibility: GithubConnectionSchema.shape.visibility,
  /**
   * When the token dies, as GitHub reports it on every answer it gives. Null when it did not say,
   * which is what a classic token with no expiry looks like. `SignInStatus.expiresAt` is the
   * precedent: knowing a credential is about to stop working is worth more than being told it has.
   */
  expiresAt: z.iso.datetime().nullable(),
  checkedAt: z.iso.datetime(),
});
export type GithubCheckResult = z.infer<typeof GithubCheckResultSchema>;

/**
 * An issue populace has already opened, as a screen needs it: enough to name it and link to it.
 *
 * The ledger row behind this also carries every finding signature the filed cluster contained and
 * every window it has been reported in, and neither is here. That set is the dedupe KEY — internal
 * arithmetic about what counts as the same problem (`FiledIssueSchema`) — and a screen that showed
 * it would be showing its reader the machinery rather than the answer, which is "#41, over there".
 */
export const FiledIssueViewSchema = FiledIssueSchema.pick({
  repo: true,
  number: true,
  url: true,
  filedAt: true,
});
export type FiledIssueView = z.infer<typeof FiledIssueViewSchema>;

// ---- triage ----------------------------------------------------------------

export const TriageViewSchema = z.object({
  signature: z.string(),
  state: TriageStateSchema,
  note: z.string(),
  externalRef: z.string(),
  titleAtTriage: z.string(),
  updatedAt: z.iso.datetime(),
  /** True when the signature's current title no longer matches the one it was triaged under. */
  drifted: z.boolean(),
  /**
   * The issue populace opened for this signature, when it has opened one; null otherwise.
   *
   * It sits beside `externalRef` rather than inside it because the two are different claims.
   * `externalRef` is a human's: whatever a person typed on the triage form, which may be a Jira
   * key, a pull request or a sentence. This one is populace's own record of an outbound write it
   * made, read off the filing ledger, and a form that treated them as one field would let a
   * reader's typing erase the link to an issue that exists.
   *
   * `GET /triage` serves this view on its own, as a project-wide list of the problems somebody has
   * ruled on, which is why it is worth carrying here and not only on the result card.
   */
  filedIssue: FiledIssueViewSchema.nullable(),
});
export type TriageView = z.infer<typeof TriageViewSchema>;

export const TriageInputSchema = z.object({
  signature: z.string().min(1),
  state: TriageStateSchema,
  note: z.string().optional(),
  externalRef: z.string().optional(),
});
export type TriageInput = z.infer<typeof TriageInputSchema>;

// ---- project overview ------------------------------------------------------

/**
 * The project home screen, in one request. NO PERSON NAMES: this is level one of three, and the
 * rule that a name first appears on a finding page is enforced here by the absence of a field to
 * put one in (SPEC §7.1).
 */
export const ProjectOverviewViewSchema = ProjectSummaryViewSchema.extend({
  studies: z.array(StudySummaryViewSchema),
  /**
   * The two libraries, as rows rather than counts.
   *
   * The dashboard drew both from separate list requests, which is one round trip each for data
   * the overview was already most of the way to holding, and the studies ledger groups by target
   * when there is more than one, which needs the targets in the same payload or it renders in two
   * frames. `reachable` is deliberately absent: asking whether an endpoint answers opens a
   * connection to somebody else's server, and that is a POST somebody presses, never a field an
   * index fills in.
   */
  targets: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      endpoint: z.string().nullable(),
      /** The stored first-contact outcome, or null when nobody has run one. */
      contacted: FirstContactOutcomeSchema.nullable(),
      /** How many studies point at it. Nought is a loose end; two or more is a hazard. */
      studies: z.number().int().nonnegative(),
    }),
  ),
  /** No headcount on a population row: a population is cohorts at weights, and the size is the study's. */
  populations: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      cohorts: z.number().int().nonnegative(),
      studies: z.number().int().nonnegative(),
    }),
  ),
  /** "Seen in more than one study" — the same signature, wherever it has shown up. */
  crossStudy: z.array(
    z.object({
      signature: z.string(),
      title: z.string(),
      kind: FindingKindSchema,
      severity: SeveritySchema,
      tool: z.string().nullable(),
      studies: z.array(z.object({ id: z.string(), name: z.string() })),
      /** How many distinct PEOPLE hit it, by person id. A headcount is not a name. */
      peopleHit: z.number().int().nonnegative(),
      triage: TriageViewSchema.nullable(),
    }),
  ),
  spentTodayUsd: z.number().nonnegative(),
  dailyCeilingUsd: z.number().nonnegative(),
  killSwitch: z.object({ engaged: z.boolean(), reason: z.string().nullable(), at: z.string().nullable() }),
});
export type ProjectOverviewView = z.infer<typeof ProjectOverviewViewSchema>;

// ---- cohorts and people ----------------------------------------------------

/**
 * One person, as a study's People page shows them (ADR-0041). The row is the cohort's — it is
 * numbered on `cohortSlug.personaSlug`, and every study that sends the cohort meets the same
 * person at the same ordinal — so `cohortSlug`/`cohortName` and `personaSlug`/`personaName` say
 * which group and which kind, and `alsoSentBy` says how many OTHER studies this person is in.
 * The internal name for the cohort-and-persona pair is never printed.
 */
export const PersonViewSchema = z.object({
  /** `cohortSlug.personaSlug#n` */
  id: z.string(),
  cohortSlug: z.string(),
  cohortName: z.string(),
  personaSlug: z.string(),
  personaName: z.string(),
  /** 0-based within the cohort's people of this persona. */
  ordinal: z.number().int().nonnegative(),
  name: z.string(),
  details: z.string(),
  handle: z.string(),
  generatedBy: z.enum(["model", "seeded", "authored"]),
  /** EFFECTIVE values: the sample, then the cohort's overlay, then what was set by hand. */
  patience: z.number().int(),
  budgetUsd: z.number().nonnegative(),
  traits: PersonaSchema.shape.traits,
  /** What was set on this person by hand, so a screen can say which of the above were. */
  overrides: PersonOverridesSchema,
  archived: z.boolean(),
  /**
   * How many OTHER studies also send this person — those whose deal, at their size, reaches this
   * ordinal of this cohort and persona. Above nought, a line written here follows them into
   * every one of those studies, and the People page says so.
   */
  alsoSentBy: z.number().int().nonnegative(),
});
export type PersonView = z.infer<typeof PersonViewSchema>;

/**
 * The people one study sends, in deal order: member order, then mix order, then ordinal.
 *
 * Only rows that exist are in `items`. A cohort and persona whose rows were never written — the
 * study was saved and nothing has materialised them yet — contributes nothing and is counted in
 * `missing` instead, so `items.length + missing === sends` and a screen can say "N not yet
 * written" without a second request. `size` is the study's; `sends` is what the deal makes of it.
 */
export const StudyPeopleViewSchema = z.object({
  items: z.array(PersonViewSchema),
  missing: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
  sends: z.number().int().nonnegative(),
});
export type StudyPeopleView = z.infer<typeof StudyPeopleViewSchema>;

/**
 * A cohort as the wire says it (ADR-0039, ADR-0041): what its people share, which personas they
 * are drawn from and in what ratio. There is no headcount and no people here — how many go is a
 * study's size dealt through the population's weights and then this mix, and the People page of
 * that study is where they are seen. `usedBy` is how many populations hold it, which is what a
 * delete is refused over and what the builder warns about before a weight is changed.
 */
export const CohortViewSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  /** What everybody in it has in common, addressed to them. Never empty. */
  context: z.string(),
  mix: z.array(
    z.object({
      personaId: z.string(),
      personaSlug: z.string(),
      personaName: z.string(),
      weight: z.number().positive(),
      /** `weight / Σ mix[].weight`, 0..1: this persona's share of whatever the cohort is dealt. */
      share: z.number().min(0).max(1),
    }),
  ),
  traits: PersonaSchema.shape.traits,
  tools: ToolPolicySchema,
  model: ModelOverrideSchema,
  cadence: CadenceSchema.partial().nullable(),
  /** The cohort's own visit cap. The row spells it `maxWakes`; the wire does not (ADR-0032). */
  maxVisits: z.number().int().positive().nullable(),
  seed: z.string(),
  notes: z.string(),
  /** How many populations hold this cohort. Deleting is refused while it is above nought. */
  usedBy: z.number().int().nonnegative(),
});
export type CohortView = z.infer<typeof CohortViewSchema>;

export const CohortMixInputSchema = z.object({ personaId: z.string().min(1), weight: z.number().positive().default(1) });

/**
 * Creating asks for a name, a context and at least one persona; editing sends what changed. There
 * is no size here: how many go is a property of the study that sends them (ADR-0041). Changing
 * the mix re-deals this cohort — and only this cohort — in every study that sends it.
 */
export const CohortInputSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  name: z.string().min(1).optional(),
  context: z.string().optional(),
  mix: z.array(CohortMixInputSchema).min(1).optional(),
  traits: PersonaSchema.shape.traits.optional(),
  tools: ToolPolicySchema.optional(),
  model: ModelOverrideSchema.optional(),
  cadence: CadenceSchema.partial().nullable().optional(),
  maxVisits: z.number().int().positive().nullable().optional(),
  seed: z.string().optional(),
  notes: z.string().optional(),
});
export type CohortInput = z.infer<typeof CohortInputSchema>;

/**
 * One person, by hand: name, blurb, and the sampled dimensions — patience, budget, traits. Null
 * clears an override and the sample shows through again. As much or as little individuality as
 * wanted (ADR-0031 amendment).
 */
export const PersonPatchSchema = z.object({
  name: z.string().min(1).optional(),
  details: z.string().optional(),
  patience: z.number().int().min(1).max(5).nullable().optional(),
  budgetUsd: z.number().nonnegative().nullable().optional(),
  traits: z.record(z.string(), TraitValueSchema).nullable().optional(),
});
export type PersonPatch = z.infer<typeof PersonPatchSchema>;

export const GeneratePeopleBodySchema = z.object({
  /** Which people to rewrite, by id. Absent means every one of them. */
  personIds: z.array(z.string().min(1)).optional(),
  /** Regeneration replaces people who already exist, so it is refused without this. */
  confirm: z.boolean().default(false),
});
export type GeneratePeopleBody = z.infer<typeof GeneratePeopleBodySchema>;

// ---- preflight -------------------------------------------------------------

/**
 * "I just set this up — did I set it up right?" Who is going, what they will find when they get
 * there, what it will cost, and the actual system prompt one of them will be given.
 *
 * Sample names are here on purpose and are the exception that proves §7.1's rule: the point of
 * this screen is to show a user that the cast is real people before any money is spent.
 */
export const PreflightViewSchema = z.object({
  study: StudySummaryViewSchema,
  target: z.object({
    id: z.string(),
    name: z.string(),
    /** The tools the people will actually be offered — what the policy leaves, not what the target exposes. */
    tools: z.array(z.string()),
    /**
     * Tools the target exposes that nobody going will be offered, and who they are shut off for.
     * "What will happen if I run this" has to include what will NOT happen: a tool blocked by a
     * typo'd glob is otherwise discovered as a silence in the digest a day later.
     */
    blocked: z.array(z.object({ name: z.string(), who: z.string(), why: z.string() })),
    /** What the merged policy does with tools the target marks destructive (ADR-0013). */
    destructive: z.enum(["allow", "confirm", "deny"]),
    undescribed: z.array(z.string()),
    resets: z.boolean(),
    warnings: z.array(z.string()),
  }),
  cohorts: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      /** Who they are drawn from, and how many of each, at this study's size. */
      personas: z.array(z.object({ name: z.string(), people: z.number().int().nonnegative() })),
      people: z.number().int().nonnegative(),
      sampleNames: z.array(z.string()),
    }),
  ),
  /** The deal's sums: everybody the study sends, and their visits when something caps them. */
  totalPeople: z.number().int().nonnegative(),
  plannedVisits: z.number().int().nonnegative(),
  estimate: EstimateViewSchema,
  promptPreview: z.object({ personName: z.string(), cohortSlug: z.string(), text: z.string() }),
  blockers: z.array(z.string()),
});
export type PreflightView = z.infer<typeof PreflightViewSchema>;

// ---- participants ----------------------------------------------------------

/**
 * One participant in one execution. `id` is the agent id — an id is not a name, and ids stay in
 * ochre monospace on every screen that shows one.
 */
export const ParticipantSummaryViewSchema = z.object({
  id: z.string(),
  runId: z.string(),
  /** The durable person (`cohortSlug.personaSlug#n`) this participant is an instance of. */
  personId: z.string(),
  name: z.string(),
  cohortSlug: z.string(),
  cohortName: z.string(),
  personaSlug: z.string(),
  personaName: z.string(),
  role: z.string(),
  status: AgentStatusSchema,
  retiredReason: RetiredReasonSchema.nullable(),
  continuedFrom: ContinuedFromSchema.nullable(),
  visits: z.number().int().nonnegative(),
  maxVisits: z.number().int().positive().nullable(),
  findings: z.number().int().nonnegative(),
  confirmed: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  /** What they said on their last `done` or `give_up` about coming back. */
  wouldReturn: z.boolean().nullable(),
  lastVisitAt: z.iso.datetime().nullable(),
  nextVisitAt: z.iso.datetime().nullable(),
  /**
   * The account they hold on the target, by its readable handle only. The bearer token the
   * credential also carries is never on the wire (`DATA-MODEL.md` §4).
   */
  account: z.object({ email: z.string().nullable(), userId: z.string().nullable() }).nullable(),
});
export type ParticipantSummaryView = z.infer<typeof ParticipantSummaryViewSchema>;

export const VisitSummaryViewSchema = z.object({
  id: z.string(),
  visitNumber: z.number().int().nonnegative(),
  status: WakeStatusSchema,
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  turns: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  findings: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  summary: z.string(),
  wouldReturn: z.boolean().nullable(),
});
export type VisitSummaryView = z.infer<typeof VisitSummaryViewSchema>;

export const FindingSummaryViewSchema = z.object({
  id: z.string(),
  signature: z.string(),
  kind: FindingKindSchema,
  title: z.string(),
  severity: SeveritySchema,
  tool: z.string().nullable(),
  wakeId: z.string(),
  verdict: VerdictSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type FindingSummaryView = z.infer<typeof FindingSummaryViewSchema>;

/**
 * One person's whole page, in ONE request — memory, visits, findings and where else they have
 * been. The screen it replaces fired a memory query per participant and re-polled it every five
 * seconds (`packages/web/src/screens/Population.tsx`), which is the N+1 this shape exists to
 * make impossible.
 */
export const ParticipantDetailViewSchema = ParticipantSummaryViewSchema.extend({
  details: z.string(),
  traits: PersonaSchema.shape.traits,
  patience: z.number().int(),
  budgetUsd: z.number().nonnegative(),
  model: z.string(),
  effort: z.string(),
  memory: MemorySchema.pick({ notes: true, waitingOn: true, annoyances: true, done: true }),
  visits: z.array(VisitSummaryViewSchema),
  findingsFiled: z.array(FindingSummaryViewSchema),
  /** The same person, in other studies. Empty until they have been in more than one. */
  alsoIn: z.array(
    z.object({
      studyId: z.string(),
      studyName: z.string(),
      runId: z.string(),
      seq: z.number().int().positive(),
      visits: z.number().int().nonnegative(),
      findings: z.number().int().nonnegative(),
    }),
  ),
});
export type ParticipantDetailView = z.infer<typeof ParticipantDetailViewSchema>;

/** A row per cohort in one execution. The results screen's "who was hit" without naming anybody. */
export const RunCohortViewSchema = z.object({
  cohortSlug: z.string(),
  name: z.string(),
  /** The personas who went, by name. A cohort mixes them. */
  personas: z.array(z.string()),
  people: z.number().int().nonnegative(),
  stillActive: z.number().int().nonnegative(),
  gaveUp: z.number().int().nonnegative(),
  visits: z.number().int().nonnegative(),
  findings: z.number().int().nonnegative(),
  confirmed: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  worstSignature: z.string().nullable(),
  headline: z.string(),
});
export type RunCohortView = z.infer<typeof RunCohortViewSchema>;

// ---- results ---------------------------------------------------------------

export const ClusterStateSchema = z.enum(["new", "open", "fixed", "regressed"]);
export type ClusterState = z.infer<typeof ClusterStateSchema>;

export const ClusterCardViewSchema = z.object({
  signature: z.string(),
  title: z.string(),
  severity: SeveritySchema,
  kind: FindingKindSchema,
  tool: z.string().nullable(),
  verdict: VerdictSchema.nullable(),
  peopleHit: z.number().int().nonnegative(),
  peopleTotal: z.number().int().nonnegative(),
  reports: z.number().int().nonnegative(),
  cohorts: z.array(z.object({ slug: z.string(), name: z.string(), hit: z.number().int().nonnegative(), total: z.number().int().nonnegative() })),
  /**
   * Whether the window this card's numbers are about actually reported the problem.
   *
   * It is a field rather than something inferred from `state`, because "this card is an ABSENCE"
   * is an invariant and an invariant carried only by a string is one comparison away from being
   * lost. Two arrays consist of nothing else: the results screen adds a card for every problem an
   * earlier window reported and this one did not (which is how "I shipped a fix; did it work?" is
   * answerable at all), and `ExecutionCompareView.fixed` is the same thing across two executions.
   * Anything that acts on a problem — filing it as an issue, above all — must pass over those, and
   * `state === "fixed"` is the wrong test to do it with: a human's triage can produce that state
   * too, and a state is copy while this is the fact underneath it.
   *
   * False does not mean fixed and nothing built from it may say so. It means nobody reported this
   * in the window being read: gone quiet.
   */
  inLatest: z.boolean(),
  state: ClusterStateSchema,
  /**
   * Execution sequence numbers this has been reported in, ascending.
   *
   * EXECUTIONS, which is not the scope the state machine beside it runs over. `state`, `inLatest`,
   * `firstSeenAt` and `lastSeenAt` are all scoped to report WINDOWS — an execution boundary for an
   * ephemeral study, a report cycle for a longitudinal one (ADR-0045) — because that is what makes
   * "gone quiet" and "back" sayable inside one execution at all. This list is not, and deliberately
   * so: every sentence on a screen that says the word "execution" counts off it, and a longitudinal
   * study has ONE execution and as many windows as it has run report cycles, so a window ordinal
   * printed as "execution 4" is a plain falsehood about a study that only ever had a first.
   *
   * `seenInWindows` is the window-scoped list beside it. For an ephemeral study the two have the
   * same length and each entry of one names the same stretch as the matching entry of the other —
   * one window per execution — and for a longitudinal study they do not, which is the case that has
   * to be got right rather than the exception.
   */
  seenIn: z.array(z.number().int().positive()),
  /**
   * Report-window ordinals this has been reported in, ascending, counted across the whole study.
   *
   * One entry per window that reported it, where a window is an execution boundary for an ephemeral
   * study and a report cycle for a longitudinal one (ADR-0045). This is the sequence `state` is
   * computed over — present, gone, back — and for a longitudinal study it is the only count of
   * "distinct stretches of this study's life that reported this" there is, `seenIn` being one
   * execution for ever.
   *
   * Optional because a producer with no window scope of its own has nothing true to put here, and a
   * made-up ordinal is worse than a missing one; the design fixtures that draw a card are the only
   * such producer, and every view populace serves sets it. A reader that finds it absent may say
   * nothing at all about windows, and must not fall back to `seenIn`, which counts something else.
   */
  seenInWindows: z.array(z.number().int().positive()).optional(),
  firstSeenAt: z.iso.datetime().nullable(),
  lastSeenAt: z.iso.datetime().nullable(),
  triage: TriageViewSchema.nullable(),
  /**
   * The issue populace has already opened for this problem, or null.
   *
   * It is on the CARD as well as on `triage` because filing writes no triage row — manufacturing a
   * judgement nobody typed would make a finding page say a human settled this — so for a problem
   * that has been filed and never ruled on, `triage` is null and there would be nowhere else to
   * say so. The bulk dialog's "already filed" column is read from here, and it is the last thing
   * standing between a reader and a near-duplicate issue: the ledger matches on member signatures
   * and the marker search catches most of the rest, but a problem reworded from scratch shares
   * neither, and then a human seeing "#41" beside it is the only guard there is.
   */
  filedIssue: FiledIssueViewSchema.nullable(),
});
export type ClusterCardView = z.infer<typeof ClusterCardViewSchema>;

export const ExecutionHistoryEntrySchema = z.object({
  runId: z.string(),
  seq: z.number().int().positive(),
  label: z.string(),
  status: RunStatusSchema,
  startedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  visits: z.number().int().nonnegative(),
  findings: z.number().int().nonnegative(),
  confirmed: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export type ExecutionHistoryEntry = z.infer<typeof ExecutionHistoryEntrySchema>;

/**
 * The whole results screen in one request. NO PERSON NAMES (SPEC §7.1): `walkedAway` carries the
 * person ID and the cohort, and the name is fetched by the screen that is allowed to show one.
 */
export const StudyResultsViewSchema = z.object({
  study: StudySummaryViewSchema,
  /**
   * The execution these results are OF: the most recent one that actually sent somebody. A run
   * that has been created and has not visited yet has nothing to report — reading its silence as
   * an absence would call every open problem fixed — so it appears in `study.latest` and in
   * `history`, and the numbers here stay with the execution that has something to say.
   */
  execution: RunDetailSchema.nullable(),
  headline: z.string(),
  stats: z.object({
    people: z.number().int().nonnegative(),
    visits: z.number().int().nonnegative(),
    confirmed: z.number().int().nonnegative(),
    walkedAway: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
  }),
  clusters: z.array(ClusterCardViewSchema),
  cohortBreakdown: z.array(RunCohortViewSchema),
  coverage: ToolUsageViewSchema,
  walkedAway: z.array(
    z.object({
      personId: z.string(),
      cohortSlug: z.string(),
      wakeId: z.string(),
      quote: z.string(),
      wouldReturn: z.boolean().nullable(),
    }),
  ),
  history: z.array(ExecutionHistoryEntrySchema),
  /** Triaged fixed or won't-fix: below the fold, not gone. */
  known: z.array(ClusterCardViewSchema),
});
export type StudyResultsView = z.infer<typeof StudyResultsViewSchema>;

/** The finding page. This is where names are allowed, as the authors of quotes. */
export const ClusterDetailViewSchema = ClusterCardViewSchema.extend({
  representative: FindingSchema,
  quotes: z.array(
    z.object({
      personId: z.string(),
      name: z.string(),
      cohortSlug: z.string(),
      cohortName: z.string(),
      wakeId: z.string(),
      visitNumber: z.number().int().nonnegative(),
      text: z.string(),
    }),
  ),
  reproduction: z.array(ToolCallRecordSchema),
  replay: VerificationSchema.nullable(),
  peopleHit: z.array(ParticipantSummaryViewSchema),
  peopleMissed: z.array(z.object({ cohortSlug: z.string(), name: z.string(), count: z.number().int().nonnegative() })),
  history: z.array(z.object({ runId: z.string(), seq: z.number().int().positive(), reports: z.number().int().nonnegative(), verdict: VerdictSchema.nullable() })),
  /**
   * The product the calls below were made against, in ITS owner's words, read off the frozen
   * config of the execution that produced the evidence rather than off the target as it stands
   * today. A target renamed or re-pointed last week must not re-label evidence filed before it.
   *
   * It is here for the fix prompt (`packages/fix-prompt`): the recipient of
   * that text is a coding agent looking at somebody's source tree with no access to populace, and
   * "the endpoint" and "what the product says it is" are how it works out which service the calls
   * were made against. `headers` and any static bearer an endpoint carries are deliberately
   * absent — a credential goes up and never comes back down (`DATA-MODEL.md` §4).
   */
  product: z.object({
    name: z.string(),
    description: z.string().nullable(),
    endpoints: z.array(z.object({ name: z.string(), url: z.string() })),
  }),
  /**
   * What the cohorts on this page had in common, in the words their people were actually given
   * (`PopulationMember.context`). The persona's role says what kind of person was calling; the
   * condition says what they had been told they were in the middle of, and without it a
   * reproduction is a list of calls with no intent behind them.
   */
  conditions: z.array(z.object({ cohortSlug: z.string(), cohortName: z.string(), context: z.string() })),
});
export type ClusterDetailView = z.infer<typeof ClusterDetailViewSchema>;

export const ExecutionCompareViewSchema = z.object({
  a: RunSummarySchema,
  b: RunSummarySchema,
  persisting: z.array(ClusterCardViewSchema),
  fixed: z.array(ClusterCardViewSchema),
  appeared: z.array(ClusterCardViewSchema),
  /** True when both executions ran the same cast — otherwise a difference may be who went. */
  castIdentical: z.boolean(),
  notes: z.array(z.string()),
});
export type ExecutionCompareView = z.infer<typeof ExecutionCompareViewSchema>;

// ---- bodies ----------------------------------------------------------------

export const StartExecutionBodySchema = z.object({
  label: z.string().optional(),
  /** ADR-0020's child run. "Run it again" passes nothing at all, which is the clean slate. */
  carryForwardFrom: z.string().optional(),
  reason: z.string().optional(),
});
export type StartExecutionBody = z.infer<typeof StartExecutionBodySchema>;

export const CompareQuerySchema = z.object({ a: z.string(), b: z.string() });
export type CompareQuery = z.infer<typeof CompareQuerySchema>;

/**
 * Which of a study's problems to file. Absent means every one that passes the connection's filter,
 * which is what the automatic path sends — it has no reader to tick boxes for it — and what the
 * bulk action sends when nobody has narrowed the list.
 *
 * A named signature is still put through every hard skip. `signatures` says which problems to
 * consider, never which rules to waive: praise, a settled signature, a duplicate, an absence card
 * and anything the ledger already matches are passed over whoever asked.
 */
export const PublishIssuesBodySchema = z.object({
  signatures: z.array(z.string().min(1)).optional(),
});
export type PublishIssuesBody = z.infer<typeof PublishIssuesBodySchema>;

/**
 * Why a problem was passed over, as a value rather than as a sentence, so a screen writes the copy
 * and a test can assert the decision. The first five are hard skips that no filter can waive:
 *
 * - `praise` — somebody said the product did well. There is nothing to fix.
 * - `settled` — a human triaged this fixed or won't-fix. Their judgement stands.
 * - `duplicate` — a human said this is another problem wearing a different title.
 * - `absent` — the results carry a card per problem an earlier window reported and this one did
 *   not, and that card is an ABSENCE. Filing it would be populace announcing a repair it cannot
 *   see (ADR-0028), which is the one thing it may never do.
 * - `already-filed` — the ledger matched, so this went out as an issue before. A repeat comments
 *   on that issue; it never opens a second one.
 *
 * The last three are the connection's filter, which narrows what the automatic path may file and
 * never widens it.
 */
export const PublishSkipReasonSchema = z.enum([
  "praise",
  "settled",
  "duplicate",
  "absent",
  "already-filed",
  "kind",
  "severity",
  "unconfirmed",
  /** Named in the request and not among this study's results. A bulk job cannot answer 404. */
  "not-found",
]);
export type PublishSkipReason = z.infer<typeof PublishSkipReasonSchema>;

/**
 * What happened to one problem. Flat with an `outcome` and nullable details, exactly as
 * `ProvisioningCheck` is, because the four cases share a signature and a sentence and differ only
 * in what is worth carrying beside them.
 *
 * `filed` and `commented` are both successes and the difference between them is the whole point of
 * the ledger: a problem reported again gets a comment on the issue it already has. The comment
 * never says "regression", "fixed" or "still broken" — populace cannot know why somebody closed an
 * issue — so nothing in this shape asks it to.
 */
export const PublishIssueResultSchema = z.object({
  signature: z.string(),
  outcome: z.enum(["filed", "commented", "skipped", "failed"]),
  /** One sentence naming what happened to this problem, in the words a screen shows. */
  summary: z.string(),
  /** The issue, on `filed` and on `commented`. Null on `skipped` and `failed`. */
  issue: FiledIssueViewSchema.nullable(),
  /** Why it was passed over, on `skipped`. Null otherwise. */
  reason: PublishSkipReasonSchema.nullable(),
  /**
   * What went wrong, on `failed`: GitHub's own words through `redactText`, never a raw response
   * and never anything carrying the token. Null otherwise.
   */
  error: z.string().nullable(),
});
export type PublishIssueResult = z.infer<typeof PublishIssueResultSchema>;

/**
 * The whole operation's outcome — what the publish function returns, whichever of the three
 * triggers called it.
 *
 * It is not stored: a `Job` row carries progress and an error and no result payload, and giving it
 * one would be a new column, which drops every database (`store-sqlite/src/index.ts:132-141`). So
 * the bulk route answers 202 with the job row, the job's final progress `label` is composed from
 * these counts, and this shape is what the function hands back and what the single-problem route
 * reports one member of. A caller that needs the detail after the fact re-reads the study's
 * results, where every filed problem now carries its `filedIssue`.
 *
 * There is no spend on it, and that is not an omission: publishing never verifies and never calls a
 * model, so the job's `costUsd` is nought by construction (ADR-0044).
 */
export const PublishIssuesSummarySchema = z.object({
  /** Where they went, as the connection named it at the time. */
  repo: z.string(),
  /** Whether that repository is world-readable, as the last check found it. */
  visibility: GithubConnectionSchema.shape.visibility,
  filed: z.number().int().nonnegative(),
  commented: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /**
   * One entry per problem considered, in the order they were dealt with. A failure mid-way keeps
   * every entry before it: the ledger row is written per issue, before the next one is started, so
   * a process that dies has not lost what it filed.
   */
  results: z.array(PublishIssueResultSchema),
});
export type PublishIssuesSummary = z.infer<typeof PublishIssuesSummarySchema>;

/**
 * What one problem WOULD get, asked before anything goes out.
 *
 * This exists because the dialog that asks a reader to confirm forty issues was deciding for
 * itself which rows the server would pass over — a hand-written copy of the hard skips and of the
 * connection's filter, in the browser, with nothing to keep it in step. A skip reason or a filter
 * field added on the server left it offering rows that would then be silently passed over, which
 * makes the count beside the button false. So the server answers the question instead.
 *
 * `would` is the outcome and not a boolean, because "it would be filed" and "it would be added to
 * the issue it already has" are the two different things this feature does, and a confirmation
 * that called both "file" would promise a reader a new issue that will not appear.
 */
export const PublishPreviewEntrySchema = z.object({
  /** The key that was asked about: the signature the caller named, or the problem's own. */
  signature: z.string(),
  would: z.enum(["file", "comment", "skip"]),
  /** Why it would be passed over, on `skip`. Null otherwise. */
  reason: PublishSkipReasonSchema.nullable(),
  /** The issue it already has, on `comment`. Null otherwise — a preview opens none. */
  issue: FiledIssueViewSchema.nullable(),
});
export type PublishPreviewEntry = z.infer<typeof PublishPreviewEntrySchema>;

/**
 * What a bulk file would do, with nothing written and nothing spent.
 *
 * Three things about it are worth stating plainly, because a preview that oversells itself is
 * worse than none:
 *
 * - **It asks github.com nothing.** The marker search that is the second line of defence against a
 *   duplicate runs only where an issue is actually about to be created, so a preview cannot know
 *   about an issue whose local ledger row is gone. An entry saying `file` therefore means "nothing
 *   here knows of an issue for this", not "an issue does not exist"; the real pass searches before
 *   it creates and comments instead when it finds one.
 * - **The counts are over the report window this study would be publishing**, which is the newest
 *   one anybody visited — the same window the real pass reports on, and not the whole execution.
 * - **It writes nothing and spends nothing.** No model is called, no MCP session is opened, no
 *   ledger row is written, and no report window is closed.
 */
export const PublishPreviewSchema = z.object({
  /** Where they would go, as the connection names it now. */
  repo: z.string(),
  /** Whether that repository is world-readable, as the last check found it. A public one says more. */
  visibility: GithubConnectionSchema.shape.visibility,
  /** How many would be opened as new issues. */
  wouldFile: z.number().int().nonnegative(),
  /** How many would be added to an issue that already exists. */
  wouldComment: z.number().int().nonnegative(),
  /** How many would be passed over, for any of the reasons in `PublishSkipReasonSchema`. */
  wouldSkip: z.number().int().nonnegative(),
  /**
   * One entry per problem considered: in the caller's own order when it named signatures — a
   * ticked box gets an answer, where it was ticked — and otherwise in the order this study's
   * results carry them.
   *
   * It is deliberately NOT promised to be the order the pass deals with them in. The pass takes
   * the worst first so that a rate limit part way through costs the least important problems, and
   * that ordering changes what a cut-off would lose rather than what any entry here says.
   */
  items: z.array(PublishPreviewEntrySchema),
});
export type PublishPreview = z.infer<typeof PublishPreviewSchema>;

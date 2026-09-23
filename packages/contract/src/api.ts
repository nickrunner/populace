import { FindingKindSchema, SeveritySchema } from "@populace/core/isomorphic";
import { z } from "zod";
import { VerdictSchema } from "./views.js";

/** Everything under one version prefix, so M4's CI client and an M5 SDK have a stable base. */
export const API_BASE = "/api/v1";

/**
 * A page of results. `nextCursor` is opaque to the client and is the same cursor the event
 * stream uses, so "load the rest" and "follow it live" are one query at different offsets
 * (ADR-0023, ADR-0026).
 */
export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

export const ErrorBodySchema = z.object({
  error: z.object({
    code: z.enum(["not_found", "bad_request", "conflict", "unavailable", "internal"]),
    message: z.string(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

const cursor = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

/**
 * Run reads stay flat rather than nesting under a project: a run id is globally unique and the
 * row carries its project and its simulation, so a filter is a query parameter and a link to a
 * run never has to know which project it belongs to (SPEC §6.1).
 */
export const RunListQuerySchema = cursor.extend({
  project: z.string().optional(),
  simulation: z.string().optional(),
});
export type RunListQuery = z.infer<typeof RunListQuerySchema>;

/** `participant` is an agent id; the wire never says "agent" (Decision A). */
export const WakeListQuerySchema = cursor.extend({ participant: z.string().optional() });
export type WakeListQuery = z.infer<typeof WakeListQuerySchema>;

export const TraceQuerySchema = cursor.extend({
  /** Trace sequence to resume after; the trace is ordered by `(wakeId, seq)`. */
  afterSeq: z.coerce.number().int().nonnegative().optional(),
});
export type TraceQuery = z.infer<typeof TraceQuerySchema>;

/**
 * Repeated query parameters arrive as a string or an array of strings depending on how many
 * were sent, which is a boundary worth normalising once rather than at every call site.
 */
const multi = <T extends z.ZodType>(item: T) =>
  z
    .union([item, z.array(item)])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]));

export const FindingListQuerySchema = cursor.extend({
  kind: multi(FindingKindSchema),
  severity: multi(SeveritySchema),
  verdict: multi(VerdictSchema),
  /** `true` keeps only findings no judge has ruled on yet. */
  unverified: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  participant: z.string().optional(),
  tool: z.string().optional(),
});
export type FindingListQuery = z.infer<typeof FindingListQuerySchema>;

/**
 * `after` is the event-log cursor; a reconnect resumes from it instead of losing the gap.
 *
 * `project` and `simulation` sit alongside `run` so a project page follows every simulation in it
 * on ONE stream rather than opening a connection per run — which is what the `events.project_id`
 * and `events.simulation_id` columns are for.
 */
export const EventStreamQuerySchema = z.object({
  after: z.coerce.number().int().nonnegative().optional(),
  project: z.string().optional(),
  simulation: z.string().optional(),
  run: z.string().optional(),
});
export type EventStreamQuery = z.infer<typeof EventStreamQuerySchema>;

export const DigestQuerySchema = z.object({
  /** Verify findings that have no verdict yet before building. Off by default: it costs money. */
  verify: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});
export type DigestQuery = z.infer<typeof DigestQuerySchema>;

/**
 * Path segments are encoded, except a `:name` pattern, which is passed through untouched. That is
 * what lets one route table serve both sides: the client calls `routes.run(id)` with a real id and
 * the server registers `routes.run(":id")` as a pattern, so a path can never be spelled two ways.
 */
const seg = (value: string): string => (value.startsWith(":") ? value : encodeURIComponent(value));

/**
 * The route table lives here rather than in the server so that a client, a CI consumer and the
 * server all name the same paths. M1 is read-only; the control and authoring routes arrive with
 * M2 and M3 (`WEB-ARCHITECTURE.md` §5).
 */
export const routes = {
  health: `${API_BASE}/health`,

  // ---- projects ------------------------------------------------------------
  /**
   * Authoring is project-scoped, and the project is a PATH SEGMENT rather than something the
   * process closed over once at startup. One `serve` can hold several projects, and a handler
   * that reads `:p` cannot accidentally answer for the wrong one.
   */
  projects: `${API_BASE}/projects`,
  project: (p: string) => `${API_BASE}/projects/${seg(p)}`,
  projectSetup: (p: string) => `${API_BASE}/projects/${seg(p)}/setup`,

  // ---- the library, all under a project ------------------------------------
  targets: (p: string) => `${API_BASE}/projects/${seg(p)}/targets`,
  target_: (p: string, t: string) => `${API_BASE}/projects/${seg(p)}/targets/${seg(t)}`,
  /** A draft target the wizard has not saved yet. Registered before `/targets/:t`. */
  targetsCheck: (p: string) => `${API_BASE}/projects/${seg(p)}/targets/check`,
  targetCheck: (p: string, t: string) => `${API_BASE}/projects/${seg(p)}/targets/${seg(t)}/check`,
  targetPromises: (p: string, t: string) => `${API_BASE}/projects/${seg(p)}/targets/${seg(t)}/promises`,
  /**
   * One person through the front door, for real: provision an identity, make one read-only call,
   * take the account back down. A POST because it MAKES AN ACCOUNT on somebody's product — the
   * same rule that keeps a run behind a POST (ADR-0023) — and not because it costs model money,
   * which it does not: nothing here calls a model.
   */
  targetFirstContact: (p: string, t: string) => `${API_BASE}/projects/${seg(p)}/targets/${seg(t)}/first-contact`,
  /** Puts the target back by hand, outside a run. 202 and a job, because it is somebody's server. */
  targetReset: (p: string, t: string) => `${API_BASE}/projects/${seg(p)}/targets/${seg(t)}/reset`,

  /**
   * YOUR sign-in to an address, for a server that will not talk to strangers (ADR-0036).
   *
   * Scoped to a project and keyed by the address in the query string, because a sign-in belongs to
   * an ADDRESS rather than to a saved target: the whole point is to sign in while connecting, when
   * there is no target yet to hang it off. GET reports, POST starts a flow and answers with
   * somewhere to send the browser, DELETE forgets the grant.
   */
  signIn: (p: string) => `${API_BASE}/projects/${seg(p)}/sign-in`,
  /**
   * Where the authorization server sends the browser back to. Fixed, and outside every project:
   * it is registered with somebody else's server as this installation's one callback, and a path
   * that varied by project would be a new client registration per project.
   */
  signInCallback: `${API_BASE}/sign-in/callback`,

  /**
   * "Did I wire the kit up right?" — the TDK handshake, asked on the reader's behalf (ADR-0038).
   *
   * It hangs off the PROJECT and not off a target because it has to answer before a target is
   * saved: the two fields it checks are the two most likely to be wrong, and finding out after
   * saving is finding out too late. A POST because the request body carries a secret, which is
   * the same reason first contact is one — not because it writes: `GET /` at the kit's mount
   * point creates nobody and registers nothing, which is what makes it safe to offer here at all
   * (ADR-0036's rule).
   */
  provisioningCheck: (p: string) => `${API_BASE}/projects/${seg(p)}/provisioning/check`,

  personas: (p: string) => `${API_BASE}/projects/${seg(p)}/personas`,
  /** Registered before `/personas/:x` so the literal path is not captured as an id. */
  personaStarters: (p: string) => `${API_BASE}/projects/${seg(p)}/personas/starters`,
  persona: (p: string, x: string) => `${API_BASE}/projects/${seg(p)}/personas/${seg(x)}`,
  /** The system prompt this persona would produce, rendered by the runner's own code. */
  personaPreview: (p: string, x: string) => `${API_BASE}/projects/${seg(p)}/personas/${seg(x)}/preview`,

  cohorts: (p: string) => `${API_BASE}/projects/${seg(p)}/cohorts`,
  cohort: (p: string, c: string) => `${API_BASE}/projects/${seg(p)}/cohorts/${seg(c)}`,
  cohortPeople: (p: string, c: string) => `${API_BASE}/projects/${seg(p)}/cohorts/${seg(c)}/people`,
  cohortPeopleRegenerate: (p: string, c: string) => `${API_BASE}/projects/${seg(p)}/cohorts/${seg(c)}/people/regenerate`,
  /** `person` is the person id (`cohortSlug.personaSlug#n`); the `#` is encoded on the way in. */
  cohortPerson: (p: string, c: string, person: string) => `${API_BASE}/projects/${seg(p)}/cohorts/${seg(c)}/people/${seg(person)}`,

  populations: (p: string) => `${API_BASE}/projects/${seg(p)}/populations`,
  population_: (p: string, pop: string) => `${API_BASE}/projects/${seg(p)}/populations/${seg(pop)}`,

  settings: (p: string) => `${API_BASE}/projects/${seg(p)}/settings`,
  /** Human judgement about a problem, keyed by signature so it survives a re-execution. */
  triage: (p: string) => `${API_BASE}/projects/${seg(p)}/triage`,

  // ---- simulations ---------------------------------------------------------
  simulations: (p: string) => `${API_BASE}/projects/${seg(p)}/simulations`,
  simulation: (p: string, s: string) => `${API_BASE}/projects/${seg(p)}/simulations/${seg(s)}`,
  /** Arithmetic over history. It spends nothing and never starts a run. */
  simulationEstimate: (p: string, s: string) => `${API_BASE}/projects/${seg(p)}/simulations/${seg(s)}/estimate`,
  /** Who is going, and what they will meet — before a penny is spent. */
  simulationPreflight: (p: string, s: string) => `${API_BASE}/projects/${seg(p)}/simulations/${seg(s)}/preflight`,
  simulationRuns: (p: string, s: string) => `${API_BASE}/projects/${seg(p)}/simulations/${seg(s)}/runs`,
  /** The whole results screen, in one request. */
  simulationResults: (p: string, s: string) => `${API_BASE}/projects/${seg(p)}/simulations/${seg(s)}/results`,
  simulationCluster: (p: string, s: string, signature: string) => `${API_BASE}/projects/${seg(p)}/simulations/${seg(s)}/results/${seg(signature)}`,
  simulationCompare: (p: string, s: string) => `${API_BASE}/projects/${seg(p)}/simulations/${seg(s)}/compare`,
  /** Re-resolve and re-snapshot a live longitudinal execution (SPEC §4.2). */
  simulationApply: (p: string, s: string) => `${API_BASE}/projects/${seg(p)}/simulations/${seg(s)}/apply`,

  // ---- runs, read ----------------------------------------------------------
  runs: `${API_BASE}/runs`,
  run: (id: string) => `${API_BASE}/runs/${seg(id)}`,
  /**
   * Decision A: the wire speaks the user's words. A row is still an `Agent` and every store
   * method still says so; this is a translation at the boundary, not a rename underneath it.
   */
  runParticipants: (id: string) => `${API_BASE}/runs/${seg(id)}/participants`,
  participant: (runId: string, pid: string) => `${API_BASE}/runs/${seg(runId)}/participants/${seg(pid)}`,
  participantMemory: (runId: string, pid: string) => `${API_BASE}/runs/${seg(runId)}/participants/${seg(pid)}/memory`,
  runCohorts: (id: string) => `${API_BASE}/runs/${seg(id)}/cohorts`,
  runWakes: (id: string) => `${API_BASE}/runs/${seg(id)}/wakes`,
  runFindings: (id: string) => `${API_BASE}/runs/${seg(id)}/findings`,
  runDigest: (id: string) => `${API_BASE}/runs/${seg(id)}/digest`,
  runSpend: (id: string) => `${API_BASE}/runs/${seg(id)}/spend`,
  runTools: (id: string) => `${API_BASE}/runs/${seg(id)}/tools`,
  wake: (id: string) => `${API_BASE}/wakes/${seg(id)}`,
  wakeTrace: (id: string) => `${API_BASE}/wakes/${seg(id)}/trace`,
  finding: (id: string) => `${API_BASE}/findings/${seg(id)}`,

  // ---- runs, control (ADR-0027) -------------------------------------------
  runStop: (id: string) => `${API_BASE}/runs/${seg(id)}/stop`,
  runRound: (id: string) => `${API_BASE}/runs/${seg(id)}/round`,
  /** Drain and keep everything: a longitudinal execution is paused, not finished. */
  runPause: (id: string) => `${API_BASE}/runs/${seg(id)}/pause`,
  /** The SAME run id, picked back up from its frozen snapshot. */
  runResume: (id: string) => `${API_BASE}/runs/${seg(id)}/resume`,
  /** ADR-0020's child run: "I shipped a fix, do they come back?" (was `/continue`). */
  runCarryForward: (id: string) => `${API_BASE}/runs/${seg(id)}/carry-forward`,
  runSweep: (id: string) => `${API_BASE}/runs/${seg(id)}/sweep`,
  runLive: (id: string) => `${API_BASE}/runs/${seg(id)}/live`,
  runDigestJob: (id: string) => `${API_BASE}/runs/${seg(id)}/digest/job`,
  killSwitch: `${API_BASE}/kill-switch`,
  job: (id: string) => `${API_BASE}/jobs/${seg(id)}`,

  // ---- live (ADR-0026) -----------------------------------------------------
  events: `${API_BASE}/events`,
  /**
   * The same log, paged rather than streamed. An execution's life — started, paused, resumed,
   * reconfigured, ended — is read from here, because those moments are events and nothing else
   * records them (SPEC §4.3).
   */
  eventsHistory: `${API_BASE}/events/history`,
} as const;

import {
  CohortInputSchema,
  CompareQuerySchema,
  EventStreamQuerySchema,
  GeneratePeopleBodySchema,
  GithubCheckBodySchema,
  GithubCheckResultSchema,
  GithubConnectionInputSchema,
  GithubConnectionViewSchema,
  KillSwitchBodySchema,
  PersonaInputSchema,
  PersonaPreviewBodySchema,
  PersonPatchSchema,
  PopulationCreateSchema,
  PopulationInputSchema,
  ProjectEstimateBodySchema,
  PublishIssuesBodySchema,
  ProjectInputSchema,
  SettingsInputSchema,
  ProvisioningCheckBodySchema,
  SignInQuerySchema,
  SignInStartBodySchema,
  StartExecutionBodySchema,
  StopRunBodySchema,
  StudyCreateInputSchema,
  StudyUpdateInputSchema,
  SweepBodySchema,
  TargetCheckBodySchema,
  TargetInputSchema,
  TriageInputSchema,
  routes,
  type ParticipantLive,
  type CohortView,
  type EventView,
  type GithubCheckResult,
  type GithubConnectionView,
  type IdentityConfigInput,
  type IdentityConfigView,
  type PersonaSpecInput,
  type PersonaView,
  type PersonView,
  type PublishIssueResult,
  type PublishSkipReason,
  type PopulationView,
  type ProjectView,
  type RunLive,
  type SettingsView,
  type SetupStatus,
  type StarterPersonaView,
  type StoredTargetView,
  type PublishPreview,
  type PublishPreviewEntry,
  type ReportCycleInput,
  type StudyOverridesInput,
  type StudyPeopleView,
  type StudySummaryView,
} from "@populace/contract";
import {
  blockedBecause,
  effectiveToolPolicy,
  expandPopulation,
  firstContactWorked,
  handleFor,
  isToolPermitted,
  instantiatePersona,
  laneSlugFor,
  nameFrom,
  newCohortId,
  newPersonaId,
  newPopulationId,
  newProjectId,
  newTargetId,
  normalizeEndpointUrl,
  personIdFor,
  slugify,
  tagForRun,
  GithubConnectionSchema,
  ReferencedError,
  StoredTargetSchema,
  SEVERITY_RANK,
  type Agent,
  type Cohort,
  type Event,
  type Finding,
  type GithubConnection,
  type IdentityConfig,
  type McpEndpoint,
  type Person,
  type PopulaceConfig,
  type Project,
  type Simulation,
  type StoredPersona,
  type StoredPopulation,
  type Store,
  type StoredTarget,
  type Target,
  type TraceEvent,
  type Triage,
  type Wake,
} from "@populace/core";
import { identityProviderFor } from "@populace/adapters";
import { buildDigest, verifyPending } from "@populace/reports";
import { finishSignIn, personaSystemPrompt, startSignIn, type SignInProvider } from "@populace/runner";
import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { dealFor, ensureRoster, ensureRosterFor, peopleSentBy, RosterIncomplete, type Deal, type Lane } from "./cohort-store.js";
import { generatePeople, type GenerateOptions, type GeneratedRoster } from "./people-writer.js";
import { ConfigIncomplete, createSimulation, ensureSettings, materialise, planSettings, resolveDraft, resolveSimulationConfig, type ResolvedSimulation, type StudyDraft } from "./config-store.js";
import { estimateRun, toEstimateView, zeroEstimate } from "./estimate.js";
import { needsOf } from "./needs.js";
import { fail, page, param, parseBody, parseQuery } from "./http.js";
import type { JobHandler, JobReport, JobSpend } from "./jobs.js";
import { ProjectReadModel, type PublishableCluster } from "./project-read-model.js";
import { ReadModel } from "./read-model.js";
import { STARTER_PERSONAS, starterBySlug } from "./starters.js";
import { checkPromises, checkTarget, type CheckCredentials } from "./target-check.js";
import { callbackPage, callbackUri, examine, isAddress, pendingFor, providerFor, signInStatus, statusOf } from "./sign-in.js";
import { firstContact } from "./first-contact.js";
import { checkProvisioning } from "./provisioning-check.js";
import { GithubClient, type RepoCheck } from "./github.js";
import { IssuesNotConnected, publishIssues, type PublishIssuesDeps } from "./publish-issues.js";
import { reportWindows } from "./report-windows.js";
import { resetTarget } from "./target-reset.js";
import { targetView as liveTargetView } from "./target.js";
import type { ControlDeps } from "./deps.js";

/**
 * Why the configured judge cannot run here, or null when it can.
 *
 * One definition for both places that verify — the digest job below, and
 * `GET /runs/:id/digest?verify=true` in `app.ts` — because they were drifting: two judges each
 * need a credential this process may not have, and a judge with no key is the one failure that
 * must be a refusal rather than a surprise. Without this, `verifier.judge: "typesafe"` threw from
 * inside `verifyFinding` once per finding, so an operator read a stack trace per problem instead
 * of one sentence naming the key, and a heuristic-judge digest was never affected either way.
 *
 * Deliberately NOT a silent downgrade to the heuristic judge: the judge decides what reaches the
 * digest, and answering a request to check with the strong judge by quietly checking with the weak
 * one would be answering a different question than the one asked.
 */
export function judgeRefusal(judge: PopulaceConfig["verifier"]["judge"], available: { model: boolean; typesafe: boolean }): string | null {
  if (judge === "model" && !available.model) return "the model judge needs an API key; set ANTHROPIC_API_KEY or configure verifier.judge: heuristic";
  if (judge === "typesafe" && !available.typesafe) return "the typed judge needs its own API key; set TYPESAFE_API_KEY or configure verifier.judge: heuristic";
  return null;
}

/**
 * What `runDigest` needs, typed off `ControlDeps` rather than restated: the routes satisfy it by
 * being it, and the report cycle's own deps satisfy it structurally, so a field renamed on one
 * side is a compile error on the other.
 */
export type DigestDeps = Pick<ControlDeps, "store" | "configForRun" | "hasApiKey" | "provider" | "typesafe">;

/**
 * The verify-and-cluster body of a digest job, in ONE place.
 *
 * There are two callers and they are the same job under two triggers: `POST /runs/:id/digest/job`
 * below, which a person presses, and the automatic report cycle (`report-cycle.ts`), which is this
 * same digest on a clock for as long as a longitudinal study runs. It used to be written out in
 * both, with a comment in one saying the two had to be kept in step — and the two things needing
 * to be kept in step were the two about money:
 *
 * - **The pre-flight refusal.** A judge whose credential this process does not have refuses here,
 *   out loud, and never downgrades to the free one: the judge decides what reaches the digest, so
 *   checking with the weak one answers a different question than the one that was configured.
 * - **The project's daily ceiling, read before anything is spent** and refused rather than
 *   trimmed — a digest that quietly verified half of what was asked for is a bill nobody can
 *   account for. The cycle is the caller this matters most for: a button press with no ceiling
 *   over it is a mistake somebody notices once, and an unattended loop with no ceiling over it is
 *   not.
 */
export async function runDigest(deps: DigestDeps, runId: string, report: JobReport, spend: JobSpend): Promise<void> {
  const run = await deps.store.getRun(runId);
  const config = await deps.configForRun(runId);
  await report({ label: "checking the findings nobody has ruled on yet" });
  const refusal = judgeRefusal(config.verifier.judge, { model: deps.hasApiKey(), typesafe: deps.typesafe !== undefined });
  if (refusal !== null) throw new Error(refusal);
  if (run !== undefined) {
    const spent = await deps.store.costSince({ projectId: run.projectId }, new Date(Date.now() - 86_400_000));
    if (spent >= config.guardrails.dailyUsd) {
      throw new Error(`this project spent $${spent.toFixed(2)} in the last 24h, at or over its $${String(config.guardrails.dailyUsd)} ceiling; re-checking findings costs money, so nothing was checked`);
    }
  }
  const verified = await verifyPending(
    {
      store: deps.store,
      config,
      identityProvider: identityProviderFor(config.identity),
      ...(deps.provider ? { provider: deps.provider() } : {}),
      ...(deps.typesafe ? { typesafe: deps.typesafe() } : {}),
    },
    { runIds: [runId] },
  );
  // Summed off the verifications that came back rather than off a running total inside the
  // verifier: `verifyPending` returns the findings it wrote, each carrying what its own judge
  // cost, and a heuristic judge's nought is nought here too (`JobSpend` ignores it).
  await spend(verified.reduce((total, finding) => total + (finding.verification?.costUsd ?? 0), 0));
  await report({ label: "clustering what came back" });
  const wakes = await deps.store.listWakes({ runIds: [runId] });
  const since = wakes[0]?.startedAt ? new Date(wakes[0].startedAt) : new Date(0);
  await buildDigest({ store: deps.store, config, since, until: new Date(), runIds: [runId] });
}

/** What a preview needs: the ledger and the read model, and nothing that could write or spend. */
export interface PreviewIssuesDeps {
  store: Store;
  readModel: ProjectReadModel;
}

/**
 * What a bulk file WOULD do, with nothing written, nothing spent and nobody asked.
 *
 * It exists because the dialog that asks a reader to confirm forty issues was answering this
 * question for itself: `StudyResults.tsx` carried hand-written copies of the hard skips and of the
 * connection's filter, in the browser, with no shared module and nothing keeping them in step. A
 * skip reason or a filter field added on the server left the dialog listing rows that the pass
 * would pass over, which makes the count next to the button false — and the count next to a button
 * that writes into somebody's repository is the last thing a reader has to go on.
 *
 * **The order of the tests below is `dealWith`'s order in `publish-issues.ts`, and it has to stay
 * that way.** It is not the order the reasons are listed in: a problem that already has an issue
 * gets its comment before the absence test, because a problem that has gone quiet SINCE it was
 * filed is the whole point of the loop, while an absence never filed has nothing to say and nowhere
 * to say it. The severity, kind and confirmed tests are `filterSkip`'s, off the same
 * `SEVERITY_RANK` core exports to the publisher, and they are waived for a problem the caller named
 * exactly as the publisher waives them — naming says which problems to consider, never which rules
 * to waive.
 *
 * Two copies of one policy is one too many, and this is the lesser of the two evils available: the
 * alternative is the browser's copy, which is the one with nothing to keep it honest. The right
 * end state is one exported selector in `publish-issues.ts` that both this and the pass call, and
 * `issues-preview.test.ts` pins the two together in the meantime by driving a real pass over the
 * same rows and asserting it did what the preview said it would.
 *
 * **What a preview cannot know, and must not imply.** It asks github.com nothing, so the marker
 * search that is the second line of defence against a duplicate has not run: `file` means "nothing
 * here knows of an issue for this", never "no issue exists". And `comment` means the ledger matched
 * — the repeat goes on the issue that exists rather than opening a second one — which is not a
 * promise that a comment appears, since a repeat with nothing new to say deliberately writes
 * nothing (`comment` in `publish-issues.ts`).
 */
export async function previewIssues(deps: PreviewIssuesDeps, options: { simulation: Simulation; signatures?: readonly string[] }): Promise<PublishPreview> {
  const { simulation } = options;
  const connection = await deps.store.getGithubConnection(simulation.projectId);
  // A preview needs the FILTER and the ledger, and no token at all: a reader who has named a
  // repository and not yet pasted a token can still be shown what pressing the button would do.
  // No repository is the one case there is nothing to answer with, because the filter and the
  // ledger are both per repository.
  if (connection === undefined || connection.repo === "") {
    throw new IssuesNotConnected("This project has no repository to file issues into. Add one in the project's settings, check it, and populace will file there.");
  }

  // The same four reads the publisher's own `studyRows` makes, minus the ones only an issue BODY
  // needs (the roster and the target's hosts): the windows are computed off runs, visits, reports
  // and the publish jobs, and the window is what every candidate below is scoped to. Bounded by how
  // many times the study has been run, which is the one dimension a pass may grow a query along.
  const runs = (await deps.store.listRuns({ simulationId: simulation.id })).sort((a, b) => a.seq - b.seq);
  const runIds = runs.map((run) => run.id);
  const [wakes, findings, jobs] = await Promise.all([
    runIds.length === 0 ? Promise.resolve<Wake[]>([]) : deps.store.listWakes({ runIds }),
    runIds.length === 0 ? Promise.resolve<Finding[]>([]) : deps.store.listFindings({ runIds }),
    Promise.all(runs.map((run) => deps.store.listJobs({ runId: run.id }))).then((lists) => lists.flat()),
  ]);
  const windows = reportWindows({ runs, wakes, findings, jobs });
  // The window this pass would report on, picked the way the publisher picks it: the newest one
  // anybody visited. A window nobody visited is no evidence either way.
  const current = [...windows].reverse().find((window) => window.visited) ?? windows.at(-1);
  const problems = await deps.readModel.publishable(simulation, current);

  // A named signature is looked up against every MEMBER of a cluster and not only against its
  // representative, for the reason `select` gives: the screen the reader ticked boxes on is
  // clustered over the whole execution and these candidates over one window, and the two
  // clusterings need not pick the same representative.
  const named = options.signatures;
  const candidates: { signature: string; problem: PublishableCluster | undefined }[] =
    named === undefined
      ? problems.map((problem) => ({ signature: problem.card.signature, problem }))
      : named.map((signature) => ({ signature, problem: problems.find((problem) => problem.card.signature === signature || problem.signatures.includes(signature)) }));

  const ledger = await Promise.all(candidates.map((candidate) => (candidate.problem === undefined ? Promise.resolve([]) : deps.store.matchFiledIssues(simulation.projectId, "github", connection.repo, candidate.problem.signatures))));

  /** Clusters this preview has already answered for, so two names on one cluster answer once each. */
  const handled = new Set<PublishableCluster>();
  const items = candidates.map((candidate, index): PublishPreviewEntry => {
    // `issue` is null on a skip, as it is on the pass's own `skipped`: a problem that is being
    // passed over is not one this answer is pointing anybody at.
    const skip = (reason: PublishSkipReason): PublishPreviewEntry => ({ signature: candidate.signature, would: "skip", reason, issue: null });
    const problem = candidate.problem;
    if (problem === undefined) return skip("not-found");
    if (handled.has(problem)) return skip("already-filed");
    handled.add(problem);
    const hard = problem.skip;
    if (hard === "praise" || hard === "settled" || hard === "duplicate" || hard === "not-found") return skip(hard);
    const matched = ledger[index] ?? [];
    if (matched.length > 0) {
      // The oldest that has not been absorbed, which is the issue a reader has been following and
      // the one `comment` would write on.
      const ordered = [...matched].sort((a, b) => a.filedAt.localeCompare(b.filedAt) || a.number - b.number);
      const row = ordered.find((one) => one.supersededBy === null) ?? ordered[0];
      if (row === undefined) return skip("already-filed");
      return { signature: candidate.signature, would: "comment", reason: null, issue: { repo: row.repo, number: row.number, url: row.url, filedAt: row.filedAt } };
    }
    if (hard === "absent") return skip("absent");
    if (named === undefined) {
      if (!connection.filter.kinds.includes(problem.card.kind)) return skip("kind");
      // Ranks ascend as severity descends, so "at least this severe" is a rank no greater than the
      // floor's — `filterSkip`'s own arithmetic, off the same constant.
      if (SEVERITY_RANK[problem.card.severity] > SEVERITY_RANK[connection.filter.minSeverity]) return skip("severity");
      if (connection.filter.onlyConfirmed && problem.card.verdict !== "confirmed") return skip("unconfirmed");
    }
    return { signature: candidate.signature, would: "file", reason: null, issue: null };
  });

  return {
    repo: connection.repo,
    visibility: connection.visibility,
    wouldFile: items.filter((item) => item.would === "file").length,
    wouldComment: items.filter((item) => item.would === "comment").length,
    wouldSkip: items.filter((item) => item.would === "skip").length,
    items,
  };
}

/**
 * Authoring config into rows (ADR-0025), driving runs (ADR-0027) and watching one happen
 * (ADR-0026) — all of it PROJECT-SCOPED.
 *
 * The project is a path segment now. It used to be closed over once per process, which was the
 * last place in the API that encoded "there is exactly one of everything": every handler below
 * reads `:p` and answers for that project alone, so two projects in one store cannot see each
 * other's targets, personas, cohorts or runs (SPEC §6).
 *
 * Two rules from M1 hold everywhere. A credential goes up and never comes back down — a target
 * view reports `authenticated` and nothing else. And nothing that spends money happens as a side
 * effect of a GET: every model call is behind a POST that names it.
 *
 * A third rule arrived with ADR-0041: **a GET writes nothing at all.** Reading a cohort, listing
 * the populations or asking what is left to set up used to materialise rows on the way past, and
 * the row it made was whichever the reader happened not to have — a default population, a trial
 * study. Every write below is behind a POST, a PUT or a DELETE that names the thing it writes.
 *
 * The wire speaks the user's words (ADR-0032, ADR-0042). The row is a `Simulation` and every
 * store method still says so; the word on the wire, in a path and in every sentence emitted here
 * is STUDY, and nothing below prints the row's own name, "agent", "wake" or "lane".
 */
export function mountControl(app: Hono, deps: ControlDeps): void {
  const now = (): string => new Date().toISOString();
  const projects = new ProjectReadModel(deps.store, { runningRunIds: () => deps.runs.runningIds });

  type Scope = { ok: true; project: Project } | { ok: false; response: Response };

  /**
   * The project this request is about, by id or by slug. A path that names a project that is not
   * there is a 404 rather than an empty answer: "this project has no targets" and "there is no
   * such project" are different things and a client has to be able to tell them apart.
   */
  const scope = async (c: Context): Promise<Scope> => {
    const project = await projects.project(param(c, "p"));
    return project ? { ok: true, project } : { ok: false, response: fail(c, "not_found", `no project ${param(c, "p")}`) };
  };

  /**
   * The one slug no persona, cohort, population, target or study may take: it is the address of
   * the builder that makes them (`/library/cohorts/new`, `/studies/new`), and a row called `new`
   * would be unreachable by the URL that is supposed to open it. Refused on create, where the slug
   * is decided; a slug never changes afterwards.
   */
  const RESERVED_SLUG = "new";
  const reservedSlug = (c: Context, slug: string, noun: string): Response | null =>
    slug === RESERVED_SLUG ? fail(c, "bad_request", `"${RESERVED_SLUG}" is where a ${noun} is made, so a ${noun} cannot be called that; give it another slug`) : null;

  /** `base`, or `base-2`, `base-3`… — the first one nothing in `taken` already answers to. */
  const uniqueSlug = (base: string, taken: ReadonlySet<string>): string => {
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    return slug;
  };

  const targetView = (target: StoredTarget): StoredTargetView => ({
    id: target.id,
    projectId: target.projectId,
    name: target.name,
    mcp: target.mcp.map((e) => ({ name: e.name, url: e.url, authenticated: e.bearerToken !== undefined || Object.keys(e.headers).length > 0 })),
    webBaseUrl: target.webBaseUrl ?? null,
    description: target.description ?? null,
    identity: identityView(target.identity),
    tools: target.tools,
    firstContact: target.firstContact,
    updatedAt: target.updatedAt,
  });

  /**
   * The two secrets a target can hold go up and never come back down, exactly as a bearer token
   * does: admin-mint's Firebase Web API key, which mints and renews a person's session, and
   * provision-url's shared secret, which is the whole authority populace has over that endpoint.
   * The form is told one is stored, never what it is.
   */
  const identityView = (identity: IdentityConfig): IdentityConfigView => {
    if (identity.strategy === "admin-mint") {
      const { apiKey, ...rest } = identity;
      return { ...rest, apiKeySet: apiKey !== undefined };
    }
    if (identity.strategy === "provision-url") {
      const { secret, ...rest } = identity;
      return { ...rest, secretSet: secret !== undefined };
    }
    return identity;
  };

  /** The write-only rule, the other way round: absent keeps the stored secret, blank clears it. */
  const mergeIdentity = (input: IdentityConfigInput, existing: IdentityConfig | undefined): IdentityConfig => {
    if (input.strategy === "admin-mint") {
      const previous = existing?.strategy === "admin-mint" ? existing.apiKey : undefined;
      const apiKey = input.apiKey === undefined ? previous : input.apiKey === "" ? undefined : input.apiKey;
      return { ...input, ...(apiKey === undefined ? { apiKey: undefined } : { apiKey }) };
    }
    if (input.strategy === "provision-url") {
      const previous = existing?.strategy === "provision-url" ? existing.secret : undefined;
      const secret = input.secret === undefined ? previous : input.secret === "" ? undefined : input.secret;
      return { ...input, ...(secret === undefined ? { secret: undefined } : { secret }) };
    }
    return input;
  };

  /**
   * A blank `bearerToken` clears a stored one and an absent one leaves it alone, which is what
   * lets the form round-trip without ever having been shown the secret it is editing.
   */
  const mergeEndpoints = (input: { name: string; url: string; bearerToken?: string }[], existing: McpEndpoint[]): McpEndpoint[] =>
    input.map((endpoint) => {
      const previous = existing.find((e) => e.name === endpoint.name);
      const token = endpoint.bearerToken === undefined ? previous?.bearerToken : endpoint.bearerToken === "" ? undefined : endpoint.bearerToken;
      return { name: endpoint.name, url: endpoint.url, ...(token === undefined ? {} : { bearerToken: token }), headers: previous?.headers ?? {} };
    });

  /**
   * What a CHECK may connect as: the user's own sign-in for that address, and the probe that tells
   * a gated address apart from a dead one (ADR-0036).
   *
   * It is built here, at the one altitude that knows both the project and the browser's origin,
   * and it is handed only to `checkTarget`. Nothing that sends a PERSON anywhere is given one: a
   * grant is the owner's account, and a population wearing it would be forty people with one face.
   */
  const asTheUser = async (c: Context, projectId: string): Promise<CheckCredentials> => {
    // Loaded up front so the decision below can be made synchronously, but mostly so that a
    // provider is handed over ONLY for an address already signed in to. The SDK's transport treats
    // a provider as permission to do whatever getting in takes — including registering this
    // installation with the authorization server the first time it meets a 401 — and pressing
    // Check must not register anything with anybody. Signing in is a button, and that is the only
    // thing that writes to somebody else's authorization server.
    const held = new Map((await deps.store.listSignInGrants(projectId)).filter((grant) => grant.tokens !== null).map((grant) => [grant.url, grant]));
    return {
      signIn: (endpoint) =>
        isAddress(endpoint.url) && held.has(normalizeEndpointUrl(endpoint.url))
          ? providerFor(deps.store, projectId, endpoint.url, callbackUri(c, routes.signInCallback))
          : undefined,
      askAboutSignIn: (endpoint) => examine(deps.store, projectId, endpoint.url),
    };
  };

  /**
   * The two things a first-contact result is evidence about — where the target is and how a person
   * gets an account there — as one comparable string.
   *
   * Both sides are put back through their own schema rather than stringified as they are: key
   * order is what an equality-by-serialisation gets wrong, and a schema parse rebuilds an object
   * in schema order whichever construction site it came from.
   */
  const addressAndIdentity = (target: Pick<StoredTarget, "mcp" | "identity">): string =>
    `${JSON.stringify(StoredTargetSchema.shape.mcp.parse(target.mcp))}|${JSON.stringify(StoredTargetSchema.shape.identity.parse(target.identity))}`;

  /** A row belonging to another project is not this project's to read, edit or delete. */
  const owned = <T extends { projectId: string }>(row: T | undefined, projectId: string): T | undefined => (row && row.projectId === projectId ? row : undefined);

  /**
   * The project's library, loaded once per request and joined in memory: the views below need a
   * persona's name for a mix entry, a cohort for a population member, and how many populations or
   * studies hold a thing, and a query per row is the shape SPEC §6.2 exists to forbid.
   *
   * `studies` includes the archived ones on purpose: the store refuses to delete a population that
   * ANY study names, archived or not, and `usedBy` has to agree with the refusal it warns about.
   */
  interface Library {
    personas: ReadonlyMap<string, StoredPersona>;
    cohorts: ReadonlyMap<string, Cohort>;
    populations: readonly StoredPopulation[];
    studies: readonly Simulation[];
  }
  const libraryOf = async (projectId: string): Promise<Library> => {
    const [personas, cohorts, populations, studies] = await Promise.all([
      deps.store.listPersonas(projectId),
      deps.store.listCohorts(projectId),
      deps.store.listPopulations(projectId),
      deps.store.listSimulations({ projectId, includeArchived: true }),
    ]);
    return { personas: new Map(personas.map((p) => [p.id, p])), cohorts: new Map(cohorts.map((c) => [c.id, c])), populations, studies };
  };

  /** `weight / Σ weights`, 0..1; nought when nothing weighs anything, so a screen never divides by zero. */
  const shareOf = (weight: number, total: number): number => (total > 0 ? weight / total : 0);

  // ---- projects -----------------------------------------------------------

  app.get(routes.projects, async (c) => c.json({ items: await projects.listProjects(), nextCursor: null }));

  app.post(routes.projects, async (c) => {
    const body = await parseBody(c, ProjectInputSchema);
    if (!body.ok) return body.response;
    const taken = new Set((await deps.store.listProjects()).map((p) => p.slug));
    const base = body.value.slug ?? (slugify(body.value.name) || "project");
    if (!/^[a-z0-9][a-z0-9-]*$/.test(base)) return fail(c, "bad_request", "a project needs a name that makes a slug, or an explicit one");
    const slug = uniqueSlug(base, taken);
    const at = now();
    const project: Project = { id: newProjectId(), slug, name: body.value.name, description: body.value.description ?? "", archived: false, createdAt: at, updatedAt: at };
    await deps.store.saveProject(project);
    await ensureSettings(deps.store, project.id);
    return c.json(project satisfies ProjectView, 201);
  });

  app.get(routes.project(":p"), async (c) => {
    const s = await scope(c);
    return s.ok ? c.json(await projects.overview(s.project)) : s.response;
  });

  app.put(routes.project(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const body = await parseBody(c, ProjectInputSchema);
    if (!body.ok) return body.response;
    // The slug is immutable: it is the URL segment a user bookmarks and any future CI run names.
    const updated: Project = { ...s.project, name: body.value.name, description: body.value.description ?? s.project.description, updatedAt: now() };
    await deps.store.saveProject(updated);
    return c.json(updated satisfies ProjectView);
  });

  /**
   * Gone, not archived. It used to set `archived` and answer 204, which the projects list reads
   * as "do not show this" — so the row survived, nothing in the product could ever see it again,
   * and the only thing a user could do about a project they did not want was accumulate more of
   * them. Archiving is the right answer for a STUDY, whose executions are history worth keeping
   * under a name; a project is the scope that history lives in, and a user deleting one is saying
   * they want the scope gone.
   *
   * `?archive=1` keeps the old behaviour for a caller that wants the row hidden and kept.
   *
   * A running execution is the one refusal. Its process is mid-visit against somebody else's
   * product, and deleting the rows underneath it would leave accounts on that target with nothing
   * left in the database that knows they exist — the exact thing `sweep` is for.
   */
  app.delete(routes.project(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    if (c.req.query("archive") === "1") {
      await deps.store.saveProject({ ...s.project, archived: true, updatedAt: now() });
      return c.body(null, 204);
    }
    const running = new Set(deps.runs.runningIds);
    const live = (await deps.store.listRuns({ projectId: s.project.id })).filter((run) => running.has(run.id));
    if (live.length > 0) {
      return fail(c, "conflict", `${s.project.name} has ${live.length === 1 ? "an execution" : `${String(live.length)} executions`} running; stop ${live.length === 1 ? "it" : "them"} first, and sweep if accounts were made`);
    }
    await deps.store.deleteProject(s.project.id);
    return c.body(null, 204);
  });

  /**
   * What is left to do, and whether the go button may be pressed. A GET, and it now CREATES
   * NOTHING (ADR-0041): it used to write a trial study and a default population on the way past,
   * so that the first-run panel would have a row to estimate against. The estimate takes a draft
   * now (`POST /projects/:p/estimate`), the builders make the rows, and a project set up in the
   * browser reaches `ready` when its own study says so.
   */
  app.get(routes.projectSetup(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const projectId = s.project.id;
    const [target, personas, studies, killSwitch, runs] = await Promise.all([
      deps.store.listTargets(projectId).then((targets) => targets[0]),
      deps.store.listPersonas(projectId),
      deps.store.listSimulations({ projectId }),
      deps.store.getKillSwitch(),
      deps.store.listRuns({ projectId }),
    ]);
    /*
      One builder, in `needs.ts`. `blockers` is derived from it rather than assembled beside it,
      so the flat list two older screens read and the scoped list the dashboard reads can never
      come to disagree about what is left. See `needsOf` for why the scope is worth carrying.
    */
    const needs = await needsOf(deps.store, {
      projectId,
      projectName: s.project.name,
      hasApiKey: deps.hasApiKey(),
      killSwitch: { engaged: killSwitch.engaged, reason: killSwitch.reason },
    });
    // Only the ones that actually stop an execution. `ready` is the go button's gate, and an
    // advisory need — an unchecked target, a population with no cohorts — must not close it.
    const blockers = needs.filter((need) => need.blocking).map((need) => need.sentence);
    const running = new Set(deps.runs.runningIds);
    const status: SetupStatus = {
      ready: blockers.length === 0,
      blockers,
      needs,
      targetId: target?.id ?? null,
      personaCount: personas.length,
      hasApiKey: deps.hasApiKey(),
      killSwitch,
      runningRunIds: runs.filter((run) => running.has(run.id)).map((run) => run.id),
      // No headcount beside them: how many go is each study's own `size`, and there is no default
      // population to count any more.
      studyIds: studies.map((study) => ({ id: study.id, slug: study.slug, name: study.name })),
    };
    return c.json(status);
  });

  // ---- targets ------------------------------------------------------------

  app.get(routes.targets(":p"), async (c) => {
    const s = await scope(c);
    return s.ok ? c.json({ items: (await deps.store.listTargets(s.project.id)).map(targetView), nextCursor: null }) : s.response;
  });

  app.post(routes.targets(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const body = await parseBody(c, TargetInputSchema);
    if (!body.ok) return body.response;
    const at = now();
    // The slug is the immutable URL segment and is unique within the project, but two targets may
    // legitimately be given the same name, so a taken slug is disambiguated rather than refused.
    const taken = new Set((await deps.store.listTargets(s.project.id)).map((t) => t.slug));
    const base = slugify(body.value.name) || "target";
    const reserved = reservedSlug(c, base, "target");
    if (reserved) return reserved;
    const slug = uniqueSlug(base, taken);
    const target: StoredTarget = {
      id: newTargetId(),
      projectId: s.project.id,
      slug,
      name: body.value.name,
      mcp: mergeEndpoints(body.value.mcp, []),
      ...(body.value.webBaseUrl ? { webBaseUrl: body.value.webBaseUrl } : {}),
      ...(body.value.description ? { description: body.value.description } : {}),
      identity: mergeIdentity(body.value.identity, undefined),
      tools: body.value.tools ?? { allow: [], deny: [], destructive: "allow" },
      firstContact: null,
      reset: { kind: "none" },
      createdAt: at,
      updatedAt: at,
    };
    await deps.store.saveTarget(target);
    return c.json(targetView(target), 201);
  });

  /**
   * A draft target the wizard has not saved yet. Declared before `/targets/:t`.
   *
   * `target` names a row to merge the endpoints against, and it is what makes a SECOND check work
   * (ADR-0040). Connecting now writes the target on the first successful check, so by the time the
   * reader corrects a typo and presses Check again there is a row holding the bearer they typed —
   * and a bearer goes up and never comes back down, so the form no longer has it to send. Without
   * this the re-check would go at a gated address with no token and report it as dead, which is
   * the opposite of what changed.
   */
  app.post(routes.targetsCheck(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const body = await parseBody(c, TargetCheckBodySchema);
    if (!body.ok) return body.response;
    const known = body.value.target === undefined ? undefined : owned(await deps.store.getTarget(body.value.target), s.project.id);
    return c.json(await checkTarget(mergeEndpoints(body.value.mcp, known?.mcp ?? []), body.value.identity, await asTheUser(c, s.project.id)));
  });

  app.get(routes.target_(":p", ":t"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const target = owned(await deps.store.getTarget(param(c, "t")), s.project.id);
    return target ? c.json(targetView(target)) : fail(c, "not_found", "no such target");
  });

  app.put(routes.target_(":p", ":t"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const existing = owned(await deps.store.getTarget(param(c, "t")), s.project.id);
    if (!existing) return fail(c, "not_found", "no such target");
    const body = await parseBody(c, TargetInputSchema);
    if (!body.ok) return body.response;
    const mcp = mergeEndpoints(body.value.mcp, existing.mcp);
    const identity = mergeIdentity(body.value.identity, existing.identity);
    // A first-contact result is evidence about ONE address and ONE set of identity settings.
    // Repoint either and it stops being evidence about anything: a green tick would go on
    // suppressing "nobody has tried getting an account here yet" for a configuration nobody has
    // tried, and a red one would go on blocking preflight after the user has fixed precisely what
    // it complained about. Both mislead on the screen whose whole job is "what will happen if I
    // run this", so the result is dropped and the check is offered again.
    const aboutSomethingElse = addressAndIdentity({ mcp, identity }) !== addressAndIdentity(existing);
    const updated: StoredTarget = {
      ...existing,
      name: body.value.name,
      mcp,
      ...(body.value.webBaseUrl ? { webBaseUrl: body.value.webBaseUrl } : { webBaseUrl: undefined }),
      ...(body.value.description ? { description: body.value.description } : { description: undefined }),
      identity,
      ...(aboutSomethingElse ? { firstContact: null } : {}),
      // Absent leaves the stored policy alone, exactly as an absent bearer token does: a client
      // that does not know about tool policy must not be able to delete one by saving a name.
      tools: body.value.tools ?? existing.tools,
      updatedAt: now(),
    };
    await deps.store.saveTarget(updated);
    return c.json(targetView(updated));
  });

  app.delete(routes.target_(":p", ":t"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    if (!owned(await deps.store.getTarget(param(c, "t")), s.project.id)) return fail(c, "not_found", "no such target");
    // A study still pointing at it is a refusal that names the study, not a 500 (SPEC §2.14): the
    // user is being told which thing to take apart first.
    try {
      await deps.store.deleteTarget(param(c, "t"));
    } catch (err) {
      if (err instanceof ReferencedError) return fail(c, "conflict", err.message);
      throw err;
    }
    return c.body(null, 204);
  });

  /**
   * POST, not GET: it opens a connection to someone else's server. That is a side effect on their
   * side even though it costs nothing here, and a link that a browser may prefetch should not do
   * it.
   */
  app.post(routes.targetCheck(":p", ":t"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const target = owned(await deps.store.getTarget(param(c, "t")), s.project.id);
    if (!target) return fail(c, "not_found", "no such target");
    return c.json(await checkTarget(target.mcp, target.identity, await asTheUser(c, s.project.id)));
  });

  /**
   * One person through the front door, for real.
   *
   * POST because it PROVISIONS AN ACCOUNT on somebody's product and makes a call with it — the
   * ADR-0023 rule is that nothing with effects is a side effect of a GET, and this has the most
   * side effects of anything on this screen. It calls no model, so it costs nothing in Anthropic
   * spend whatever it finds; the screen says so.
   *
   * The result is written back onto the target row so that preflight — which is a GET and must
   * therefore never provision anything — can say whether anybody has checked, and what happened.
   */
  app.post(routes.targetFirstContact(":p", ":t"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const target = owned(await deps.store.getTarget(param(c, "t")), s.project.id);
    if (!target) return fail(c, "not_found", "no such target");
    const result = await firstContact(target);
    await deps.store.saveTarget({ ...target, firstContact: result, updatedAt: now() });
    return c.json(result);
  });

  app.get(routes.targetPromises(":p", ":t"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const target = owned(await deps.store.getTarget(param(c, "t")), s.project.id);
    if (!target) return fail(c, "not_found", "no such target");
    const check = await checkTarget(target.mcp, target.identity, await asTheUser(c, s.project.id));
    return c.json(await checkPromises(target.webBaseUrl ?? null, check.tools));
  });

  /**
   * Does the app's provisioning endpoint answer, and what can it do (ADR-0038)?
   *
   * Off the PROJECT rather than off a target, because the two fields it checks are typed before
   * a target exists and finding out afterwards is finding out too late. A POST because the body
   * carries a secret — the same reason first contact is one — and not because it writes: the
   * handshake is a `GET` at somebody else's mount point that creates nobody and registers
   * nothing, which is what makes it safe to offer before Save (ADR-0036).
   *
   * An absent secret is read off the named target, so the saved-target editor — which has never
   * been shown the secret it is editing — can ask the same question as the connect screen.
   */
  app.post(routes.provisioningCheck(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const body = await parseBody(c, ProvisioningCheckBodySchema);
    if (!body.ok) return body.response;
    let secret = body.value.secret;
    if ((secret === undefined || secret === "") && body.value.target !== undefined) {
      const target = owned(await deps.store.getTarget(body.value.target), s.project.id);
      if (target?.identity.strategy === "provision-url") secret = target.identity.secret;
    }
    return c.json(await checkProvisioning(body.value.url, secret));
  });

  // ---- signing in to an address (ADR-0036) ---------------------------------

  /**
   * What is known about a sign-in to this address: whether the endpoint wants one, whether it
   * publishes enough for populace to do it, and whether one is held. It asks the address itself,
   * which is a read and registers nothing with anybody.
   *
   * Never the token. A credential goes up and never comes back down, here as everywhere else.
   */
  app.get(routes.signIn(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const q = parseQuery(c, SignInQuerySchema);
    if (!q.ok) return q.response;
    if (!isAddress(q.value.url)) return fail(c, "bad_request", `${q.value.url} is not an address`);
    return c.json(await signInStatus(deps.store, s.project.id, q.value.url, { probe: true }));
  });

  /**
   * Start one. POST because it REGISTERS THIS INSTALLATION as an OAuth client with somebody else's
   * authorization server the first time — the ADR-0023 rule that nothing with effects hides behind
   * a GET — and because what it produces is a consent screen a human is about to be sent to.
   *
   * The answer is a URL rather than a redirect: the caller is a `fetch` from the dashboard, and a
   * 302 to a login screen answered into an XHR would be followed by nobody.
   */
  app.post(routes.signIn(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const body = await parseBody(c, SignInStartBodySchema);
    if (!body.ok) return body.response;
    const provider = providerFor(deps.store, s.project.id, body.value.url, callbackUri(c, routes.signInCallback));
    let authorizeUrl: URL | null;
    try {
      authorizeUrl = await startSignIn(provider, body.value.url);
    } catch (err) {
      // Discovery and registration are somebody else's server answering, so this is an ordinary
      // outcome with a sentence attached rather than a 500 with a stack behind it.
      return fail(c, "conflict", `this address could not be signed in to: ${err instanceof Error ? err.message : String(err)}`);
    }
    return c.json({
      authorizeUrl: authorizeUrl === null ? null : authorizeUrl.href,
      status: statusOf(body.value.url, await provider.load()),
    });
  });

  /** Forget it. The grant goes; the authorization server is not told, because it did not ask. */
  app.delete(routes.signIn(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const q = parseQuery(c, SignInQuerySchema);
    if (!q.ok) return q.response;
    if (!isAddress(q.value.url)) return fail(c, "bad_request", `${q.value.url} is not an address`);
    await deps.store.deleteSignInGrant(s.project.id, q.value.url);
    return c.json(await signInStatus(deps.store, s.project.id, q.value.url, { probe: false }));
  });

  /**
   * Where the authorization server sends the browser back. It answers with a PAGE, not JSON: a
   * human is looking at it, having just consented in a tab populace opened for them.
   *
   * Outside every project, because it is one URL registered with somebody else's server for this
   * whole installation. `state` is what says which project and which address it belongs to — which
   * is the job OAuth gives `state` — and a callback whose state matches no flow in flight is the
   * shape a forged or stale one has, so it is refused rather than guessed at.
   */
  app.get(routes.signInCallback, async (c) => {
    const failed = c.req.query("error");
    const state = c.req.query("state") ?? "";
    const code = c.req.query("code") ?? "";
    if (failed) return c.html(callbackPage({ ok: false, message: `The authorization server said: ${failed}.` }), 400);
    if (code === "" || state === "") return c.html(callbackPage({ ok: false, message: "That callback arrived without a code." }), 400);
    const grant = await pendingFor(deps.store, state);
    if (!grant) return c.html(callbackPage({ ok: false, message: "That sign-in is not one this populace started, or it has already been finished." }), 400);
    const provider = providerFor(deps.store, grant.projectId, grant.url, grant.redirectUri);
    try {
      await finishSignIn(provider, grant.url, code);
    } catch (err) {
      return c.html(callbackPage({ ok: false, message: err instanceof Error ? err.message : String(err) }), 502);
    }
    return c.html(callbackPage({ ok: true, resource: grant.resourceName }));
  });

  /** Putting the target back by hand. A job, because it changes somebody else's database. */
  app.post(routes.targetReset(":p", ":t"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const target = owned(await deps.store.getTarget(param(c, "t")), s.project.id);
    if (!target) return fail(c, "not_found", "no such target");
    const study = (await deps.store.listSimulations({ projectId: s.project.id, targetId: target.id }))[0];
    if (!study) return fail(c, "conflict", "a target is reset through a study, and no study points at this one yet");
    const job = await deps.jobs.enqueue(
      "target.reset",
      async () => {
        const { config } = await resolveSimulationConfig(deps.store, deps.processConfig, study.id);
        // No run: a reset somebody asked for by hand belongs to the PROJECT, and stamping it as
        // such is what keeps "I put the target back" on `GET /events?project=…` rather than on a
        // stream nothing can match.
        await resetTarget(deps.store, config, { runId: null, projectId: s.project.id, simulationId: study.id });
        return undefined;
      },
      { projectId: s.project.id, label: `putting ${target.name} back` },
    );
    return c.json(job, 202);
  });

  // ---- personas -----------------------------------------------------------

  /** How many cohorts draw on a persona. Headcount is the study's business, not the persona's. */
  const cohortsDrawingOn = async (projectId: string, personaId: string): Promise<number> =>
    (await deps.store.listCohorts(projectId)).filter((cohort) => cohort.mix.some((entry) => entry.personaId === personaId)).length;

  const personaView = async (persona: StoredPersona): Promise<PersonaView> => ({
    id: persona.id,
    projectId: persona.projectId,
    slug: persona.slug,
    spec: persona.spec,
    origin: persona.origin,
    updatedAt: persona.updatedAt,
    cohorts: await cohortsDrawingOn(persona.projectId, persona.id),
    // The starter's own line about what people of its kind share, offered to the cohort builder
    // as a first draft. Only for a persona that still IS the starter: an edit moves the origin to
    // `authored`, and a starter the library no longer carries under this slug suggests nothing.
    suggestedContext: persona.origin === "starter" ? (starterBySlug(persona.slug)?.context ?? null) : null,
  });

  /**
   * The prebuilt personas, whole. Declared before `/personas/:x` so the literal path is not eaten
   * by the parameter. A GET and nothing else: taking a starter used to be a POST here that made a
   * persona, a cohort and a population member in one step behind the reader's back (ADR-0029),
   * and that one-request path is what hid the model and produced the confusion ADR-0043 records.
   * The builder now offers these INSIDE itself; choosing one fills the form, and saving the form
   * is `POST /personas` with `origin: "starter"`.
   */
  app.get(routes.personaStarters(":p"), (c) => {
    const items: StarterPersonaView[] = STARTER_PERSONAS.map((s) => {
      // The spec without its `id`: the slug is the row's to give, and a draft has no row yet.
      const { id: _id, ...spec } = s.spec;
      return { slug: s.slug, name: s.spec.name, role: s.spec.role, summary: s.summary, spec, context: s.context };
    });
    return c.json({ items, nextCursor: null });
  });

  /**
   * The system prompt a persona would produce, rendered by the runner's own code rather than by a
   * second copy of it: a preview that drifts from what the model is actually given is worse than
   * no preview at all (product judge gap #6).
   *
   * It takes a SPEC, not a row, so the builder can preview what it has not saved yet.
   */
  const renderPersonaPreview = (spec: PersonaSpecInput, slug: string, target: StoredTarget | undefined): string => {
    const lane = laneSlugFor("preview", slug);
    const seed = `preview:${lane}:0`;
    const agent: Agent = {
      id: `preview/${lane}#1`,
      runId: "preview",
      simulationId: "preview",
      populationId: "preview",
      cohortSlug: "preview",
      personId: `${lane}#1`,
      context: "",
      cohortTools: { allow: [], deny: [], destructive: "allow" },
      name: "Sample Person",
      details: "",
      handle: `${slug}-1`,
      persona: instantiatePersona({ ...spec, id: slug }, seed),
      ordinal: 0,
      status: "active",
      retiredReason: null,
      continuedFrom: null,
      identityId: null,
      wakeCount: 0,
      maxWakes: null,
      nextWakeAt: null,
      lastWakeAt: null,
      createdAt: now(),
    };
    // With no target in the project the preview is rendered against a placeholder product, so a
    // reader building their first persona still sees the shape of what will be said.
    const rendered: Target = target
      ? {
          name: target.name,
          mcp: target.mcp,
          ...(target.webBaseUrl ? { webBaseUrl: target.webBaseUrl } : {}),
          ...(target.description ? { description: target.description } : {}),
          tools: target.tools,
          reset: target.reset,
        }
      : { name: "your product", mcp: [], tools: { allow: [], deny: [], destructive: "allow" }, reset: { kind: "none" } };
    return personaSystemPrompt(agent, rendered);
  };

  /*
    A prompt preview is a preview OF A TARGET: the system prompt carries the target's own
    description and its tool list, so which target it is changes what comes back. Picking
    `listTargets[0]` meant the preview silently described whichever target was edited last.
    `asked` says which; one target still defaults; several without it is a refusal that names
    them, exactly as `POST /studies` does; none renders against the placeholder. The two routes
    read `asked` from different places — the draft preview from `targetId` in its body, the saved
    persona's from `?target=` — so the refusal is told which, and says the one the caller can use.
  */
  const previewTarget = async (c: Context, projectId: string, asked: string | undefined, sayWhichWith: string): Promise<{ ok: true; target: StoredTarget | undefined } | { ok: false; response: Response }> => {
    const targets = await deps.store.listTargets(projectId);
    if (asked !== undefined) {
      const target = targets.find((t) => t.id === asked || t.slug === asked);
      return target ? { ok: true, target } : { ok: false, response: fail(c, "not_found", `no target called ${asked} in this project`) };
    }
    if (targets.length > 1) {
      return { ok: false, response: fail(c, "bad_request", `this project has ${targets.length} targets and a preview is of one of them — say which with ${sayWhichWith}: ${targets.map((t) => `${t.name} (${t.id})`).join(", ")}`) };
    }
    return { ok: true, target: targets[0] };
  };

  /** "How this reads to them", for a persona that may not be saved yet. Declared before `/personas/:x`. */
  app.post(routes.personasPreview(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const body = await parseBody(c, PersonaPreviewBodySchema);
    if (!body.ok) return body.response;
    const target = await previewTarget(c, s.project.id, body.value.targetId, "targetId in the body");
    if (!target.ok) return target.response;
    const slug = slugify(body.value.spec.name) || "persona";
    return c.json({ personaSlug: slug, text: renderPersonaPreview(body.value.spec, slug, target.target) });
  });

  app.get(routes.personas(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const personas = await deps.store.listPersonas(s.project.id);
    return c.json({ items: await Promise.all(personas.map(personaView)), nextCursor: null });
  });

  app.post(routes.personas(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const body = await parseBody(c, PersonaInputSchema);
    if (!body.ok) return body.response;
    const slug = body.value.slug ?? slugify(body.value.spec.name);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return fail(c, "bad_request", "a persona needs a name that makes a slug, or an explicit one");
    const reserved = reservedSlug(c, slug, "persona");
    if (reserved) return reserved;
    if ((await deps.store.listPersonas(s.project.id)).some((p) => p.slug === slug)) return fail(c, "conflict", `there is already a persona called ${slug} here`);
    const at = now();
    // `starter` is the builder saying it began from one of the prebuilt personas, and it is
    // honoured as sent: it is what lets the cohort builder find the starter's suggested context
    // later. Anything else is authored.
    const persona: StoredPersona = { id: newPersonaId(), projectId: s.project.id, slug, spec: { ...body.value.spec, id: slug }, origin: body.value.origin ?? "authored", createdAt: at, updatedAt: at };
    await deps.store.savePersona(persona);
    // A persona alone. Which cohorts draw on it, and how many go, are the cohort's and the study's
    // decisions (ADR-0039, ADR-0041); nothing is sent anywhere by writing a kind of person.
    return c.json(await personaView(persona), 201);
  });

  app.get(routes.persona(":p", ":x"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const persona = owned(await deps.store.getPersona(param(c, "x")), s.project.id);
    return persona ? c.json(await personaView(persona)) : fail(c, "not_found", "no such persona");
  });

  app.put(routes.persona(":p", ":x"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const existing = owned(await deps.store.getPersona(param(c, "x")), s.project.id);
    if (!existing) return fail(c, "not_found", "no such persona");
    const body = await parseBody(c, PersonaInputSchema);
    if (!body.ok) return body.response;
    // The slug is immutable and the spec's id follows it, whatever the body says. Participant ids
    // are built from a cohort slug and continuations match on the persona's, so a slug that moved
    // would silently break them — the one thing this product cannot afford to get wrong. An
    // edit also moves a starter to `authored`: it is the reader's persona now, and the origin is
    // never moved back by an update.
    const updated: StoredPersona = { ...existing, spec: { ...body.value.spec, id: existing.slug }, origin: existing.origin === "starter" ? "authored" : existing.origin, updatedAt: now() };
    await deps.store.savePersona(updated);
    return c.json(await personaView(updated));
  });

  app.delete(routes.persona(":p", ":x"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const persona = owned(await deps.store.getPersona(param(c, "x")), s.project.id);
    if (!persona) return c.body(null, 204);
    // A persona a cohort still draws on is refused, and the refusal names the cohorts (SPEC §2.14):
    // the mix is where a persona is taken out, and deleting cohorts on the reader's behalf would
    // unmake people that executions already name.
    try {
      await deps.store.deletePersona(persona.id);
    } catch (err) {
      if (err instanceof ReferencedError) return fail(c, "conflict", err.message);
      throw err;
    }
    return c.body(null, 204);
  });

  /** The saved persona's prompt: the same renderer, over the stored spec. `?target=` picks the target. */
  app.post(routes.personaPreview(":p", ":x"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const persona = owned(await deps.store.getPersona(param(c, "x")), s.project.id);
    if (!persona) return fail(c, "not_found", "no such persona");
    const target = await previewTarget(c, s.project.id, c.req.query("target"), "?target=");
    if (!target.ok) return target.response;
    return c.json({ personaSlug: persona.slug, text: renderPersonaPreview(persona.spec, persona.slug, target.target) });
  });

  // ---- cohorts ------------------------------------------------------------

  /**
   * A cohort as the wire says it: what its people share and who they are drawn from, in what
   * ratio. No headcount and no people (ADR-0041) — how many go is a study's size dealt through a
   * population's weights and then this mix, and a study's People page is where they are seen.
   */
  const cohortViewOf = (cohort: Cohort, lib: Library): CohortView => {
    const total = cohort.mix.reduce((sum, entry) => sum + entry.weight, 0);
    return {
      id: cohort.id,
      slug: cohort.slug,
      name: cohort.name,
      context: cohort.context,
      mix: cohort.mix.map((entry) => ({
        personaId: entry.personaId,
        personaSlug: lib.personas.get(entry.personaId)?.slug ?? "",
        personaName: lib.personas.get(entry.personaId)?.spec.name ?? entry.personaId,
        weight: entry.weight,
        share: shareOf(entry.weight, total),
      })),
      traits: cohort.traits,
      tools: cohort.tools,
      model: cohort.model,
      cadence: cohort.cadence ?? null,
      // The row spells it `maxWakes`; the wire does not (ADR-0032).
      maxVisits: cohort.maxWakes ?? null,
      seed: cohort.seed,
      notes: cohort.notes,
      // The populations holding it: what a delete is refused over, and what the builder warns
      // about before a weight is moved.
      usedBy: lib.populations.filter((population) => population.members.some((member) => member.cohortId === cohort.id)).length,
    };
  };
  const cohortView = async (projectId: string, cohort: Cohort): Promise<CohortView> => cohortViewOf(cohort, await libraryOf(projectId));

  /** A mix as sent, checked against the project's personas. */
  const mixOf = async (
    projectId: string,
    entries: readonly { personaId: string; weight: number }[],
  ): Promise<{ ok: true; mix: Cohort["mix"]; names: string[] } | { ok: false; message: string }> => {
    const personas = new Map((await deps.store.listPersonas(projectId)).map((persona) => [persona.id, persona]));
    const unknown = entries.filter((entry) => !personas.has(entry.personaId)).map((entry) => entry.personaId);
    if (unknown.length) return { ok: false, message: `no such persona: ${unknown.join(", ")}` };
    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.personaId)) return { ok: false, message: `a persona goes into a mix once (${personas.get(entry.personaId)?.spec.name ?? entry.personaId} is in it twice)` };
      seen.add(entry.personaId);
    }
    return {
      ok: true,
      mix: entries.map((entry) => ({ personaId: entry.personaId, weight: entry.weight })),
      names: entries.map((entry) => personas.get(entry.personaId)?.spec.name ?? entry.personaId),
    };
  };

  /**
   * Re-lanes one cohort at the sizes the studies give it, and forgives the one thing that can
   * stop it: a mix naming a persona that has since gone. The cohort row is already saved by the
   * time this runs, and that gap is reported where it is read — a 409 on the study's People page,
   * a missing lane in preflight — rather than by failing the save that did not cause it.
   */
  const relane = async (cohortId: string): Promise<void> => {
    try {
      await ensureRoster(deps.store, cohortId);
    } catch (err) {
      if (!(err instanceof RosterIncomplete)) throw err;
    }
  };

  app.get(routes.cohorts(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const lib = await libraryOf(s.project.id);
    return c.json({ items: [...lib.cohorts.values()].map((cohort) => cohortViewOf(cohort, lib)), nextCursor: null });
  });

  app.post(routes.cohorts(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const body = await parseBody(c, CohortInputSchema);
    if (!body.ok) return body.response;
    // What they share is required: a cohort with nothing in common is a saved recipe, not a
    // cohort, and the word would stop meaning anything (ADR-0039).
    const context = body.value.context?.trim() ?? "";
    if (context === "") return fail(c, "bad_request", "a cohort is people who share something; say what it is");
    const mix = await mixOf(s.project.id, body.value.mix ?? []);
    if (!mix.ok) return fail(c, "bad_request", mix.message);
    if (mix.mix.length === 0) return fail(c, "bad_request", "a cohort draws on at least one persona; name one");
    const name = body.value.name ?? mix.names.join(" and ");
    const taken = new Set((await deps.store.listCohorts(s.project.id)).map((cohort) => cohort.slug));
    const base = body.value.slug ?? (slugify(name) || "cohort");
    const reserved = reservedSlug(c, base, "cohort");
    if (reserved) return reserved;
    const slug = uniqueSlug(base, taken);
    const at = now();
    const cohort: Cohort = {
      id: newCohortId(),
      projectId: s.project.id,
      slug,
      name,
      context,
      mix: mix.mix,
      traits: body.value.traits ?? {},
      tools: body.value.tools ?? { allow: [], deny: [], destructive: "allow" },
      model: body.value.model ?? {},
      seed: body.value.seed ?? "populace",
      notes: body.value.notes ?? "",
      ...(body.value.cadence ? { cadence: body.value.cadence } : {}),
      ...(body.value.maxVisits === undefined || body.value.maxVisits === null ? {} : { maxWakes: body.value.maxVisits }),
      createdAt: at,
      updatedAt: at,
    };
    await deps.store.saveCohort(cohort);
    // A cohort has no size, so a new one is laned at whatever the studies already give it — which
    // for a cohort nothing holds yet is nobody. The study that sends it is what writes the roster
    // (ADR-0041); this keeps the one rule that every writer re-lanes the cohorts it touched.
    await relane(cohort.id);
    return c.json(await cohortView(s.project.id, cohort), 201);
  });

  /** `:c` is a row id or a slug, as `:s` is for a study: the slug is what a bookmark and a person id carry. */
  const cohortOf = async (c: Context, projectId: string): Promise<Cohort | undefined> => {
    const id = param(c, "c");
    const direct = owned(await deps.store.getCohort(id), projectId);
    if (direct) return direct;
    return (await deps.store.listCohorts(projectId)).find((cohort) => cohort.slug === id);
  };

  app.get(routes.cohort(":p", ":c"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const cohort = await cohortOf(c, s.project.id);
    // Nothing is materialised on read any more: a cohort view carries no people to count, and a
    // GET writes nothing (ADR-0041).
    return cohort ? c.json(await cohortView(s.project.id, cohort)) : fail(c, "not_found", "no such cohort");
  });

  app.put(routes.cohort(":p", ":c"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const existing = await cohortOf(c, s.project.id);
    if (!existing) return fail(c, "not_found", "no such cohort");
    const body = await parseBody(c, CohortInputSchema);
    if (!body.ok) return body.response;
    // The slug is immutable: it is the first half of every person id and every participant id,
    // so renaming it would orphan memory and silently empty a continuation.
    const updated: Cohort = {
      ...existing,
      name: body.value.name ?? existing.name,
      seed: body.value.seed ?? existing.seed,
      notes: body.value.notes ?? existing.notes,
      traits: body.value.traits ?? existing.traits,
      tools: body.value.tools ?? existing.tools,
      model: body.value.model ?? existing.model,
      updatedAt: now(),
    };
    if (body.value.context !== undefined) {
      const context = body.value.context.trim();
      if (context === "") return fail(c, "bad_request", "a cohort is people who share something; say what it is");
      updated.context = context;
    }
    if (body.value.mix !== undefined) {
      const mix = await mixOf(s.project.id, body.value.mix);
      if (!mix.ok) return fail(c, "bad_request", mix.message);
      updated.mix = mix.mix;
    }
    if (body.value.cadence === null) delete updated.cadence;
    else if (body.value.cadence !== undefined) updated.cadence = body.value.cadence;
    if (body.value.maxVisits === null) delete updated.maxWakes;
    else if (body.value.maxVisits !== undefined) updated.maxWakes = body.value.maxVisits;
    await deps.store.saveCohort(updated);
    // A changed mix re-lanes the cohort — and only this cohort — at the sizes the studies give
    // it: a persona whose share shrank puts its tail aside, one that grew draws new people, and
    // nobody who stays is touched.
    await relane(updated.id);
    return c.json(await cohortView(s.project.id, updated));
  });

  app.delete(routes.cohort(":p", ":c"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const cohort = await cohortOf(c, s.project.id);
    if (!cohort) return fail(c, "not_found", "no such cohort");
    // A cohort a population still holds is REFUSED, and the refusal names the populations (SPEC
    // §2.14), exactly as a persona a cohort mixes and a population a study sends are. It used to
    // strip the cohort out of every population on the reader's behalf first, which quietly moved
    // people in every study sending those populations — the population builder is where a cohort
    // is taken out, and the reader is told which ones to open.
    try {
      await deps.store.deleteCohort(cohort.id);
    } catch (err) {
      if (err instanceof ReferencedError) return fail(c, "conflict", err.message);
      throw err;
    }
    return c.body(null, 204);
  });

  // ---- populations and settings -------------------------------------------

  /**
   * A population as the wire says it: which cohorts, at what weights, and each cohort's own mix
   * at ITS weights — every number a screen needs to preview the deal of any size with
   * `dealStudy`, and no headcount anywhere (ADR-0041). The execution plan — how often people
   * come back, how many visits each gets, the jitter seed — lives on the STUDY (SPEC §2.6), and
   * the settings are only the defaults a new study is created with.
   */
  const populationViewOf = (population: StoredPopulation, lib: Library): PopulationView => {
    // A cohort id that no longer resolves is left out rather than thrown over: the row is
    // composition, and a dangling reference is a display problem, not a reason to refuse a read.
    const held = population.members.flatMap((member) => {
      const cohort = lib.cohorts.get(member.cohortId);
      return cohort ? [{ member, cohort }] : [];
    });
    const total = held.reduce((sum, { member }) => sum + member.weight, 0);
    return {
      id: population.id,
      slug: population.slug,
      name: population.name,
      members: held.map(({ member, cohort }) => {
        const mixTotal = cohort.mix.reduce((sum, entry) => sum + entry.weight, 0);
        return {
          cohortId: cohort.id,
          cohort: cohort.slug,
          cohortName: cohort.name,
          context: cohort.context,
          weight: member.weight,
          share: shareOf(member.weight, total),
          personas: cohort.mix.map((entry) => ({
            personaId: entry.personaId,
            slug: lib.personas.get(entry.personaId)?.slug ?? "",
            name: lib.personas.get(entry.personaId)?.spec.name ?? entry.personaId,
            weight: entry.weight,
            share: shareOf(entry.weight, mixTotal),
          })),
          maxVisits: cohort.maxWakes ?? null,
        };
      }),
      // The studies naming it, archived or not: the store refuses to delete a population any of
      // them names, and this number is the warning for that refusal.
      usedBy: lib.studies.filter((study) => study.populationId === population.id).length,
    };
  };
  const populationView = async (population: StoredPopulation): Promise<PopulationView> => populationViewOf(population, await libraryOf(population.projectId));

  /**
   * Members as sent, checked against the project's cohorts. A member at nought is taken out, so a
   * browser can drop a row or send it at zero and mean the same; a cohort is in a population once.
   */
  const membersOf = (
    input: readonly { cohortId: string; weight: number }[],
    lib: Library,
  ): { ok: true; members: StoredPopulation["members"] } | { ok: false; message: string } => {
    const strangers = input.filter((member) => !lib.cohorts.has(member.cohortId)).map((member) => member.cohortId);
    if (strangers.length) return { ok: false, message: `no such cohort: ${strangers.join(", ")}` };
    const seen = new Set<string>();
    for (const member of input) {
      if (seen.has(member.cohortId)) return { ok: false, message: `a cohort goes into a population once (${lib.cohorts.get(member.cohortId)?.name ?? member.cohortId} is in it twice)` };
      seen.add(member.cohortId);
    }
    return { ok: true, members: input.filter((member) => member.weight > 0).map((member) => ({ cohortId: member.cohortId, weight: member.weight })) };
  };

  app.get(routes.populations(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    // Listing writes nothing (ADR-0041). It used to create a default "Everyone" population when
    // the project had none, so an empty project answered with one row it had never been given.
    const lib = await libraryOf(s.project.id);
    return c.json({ items: lib.populations.map((population) => populationViewOf(population, lib)), nextCursor: null });
  });

  app.post(routes.populations(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const body = await parseBody(c, PopulationCreateSchema);
    if (!body.ok) return body.response;
    const lib = await libraryOf(s.project.id);
    // Composed in one request: the builder has the whole form at once, so the cohorts arrive with
    // the name and there is no empty population to fill in afterwards.
    const members = membersOf(body.value.members ?? [], lib);
    if (!members.ok) return fail(c, "bad_request", members.message);
    const at = now();
    const taken = new Set(lib.populations.map((pop) => pop.slug));
    const base = body.value.slug ?? (slugify(body.value.name) || "population");
    const reserved = reservedSlug(c, base, "population");
    if (reserved) return reserved;
    const slug = uniqueSlug(base, taken);
    const population: StoredPopulation = { id: newPopulationId(), projectId: s.project.id, slug, name: body.value.name, members: members.members, createdAt: at, updatedAt: at };
    await deps.store.savePopulation(population);
    // Nothing is written for the people: without a study sending it, a population is a recipe.
    return c.json(populationViewOf(population, lib), 201);
  });

  /** `:pop` is a row id or a slug, as `:s` is for a study and `:c` for a cohort. */
  const populationOf = async (c: Context, projectId: string): Promise<StoredPopulation | undefined> => {
    const id = param(c, "pop");
    const direct = owned(await deps.store.getPopulation(id), projectId);
    if (direct) return direct;
    return (await deps.store.listPopulations(projectId)).find((population) => population.slug === id);
  };

  app.get(routes.population_(":p", ":pop"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const population = await populationOf(c, s.project.id);
    return population ? c.json(await populationView(population)) : fail(c, "not_found", "no such population");
  });

  app.put(routes.population_(":p", ":pop"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const population = await populationOf(c, s.project.id);
    if (!population) return fail(c, "not_found", "no such population");
    const body = await parseBody(c, PopulationInputSchema);
    if (!body.ok) return body.response;
    const lib = await libraryOf(s.project.id);
    let current: StoredPopulation = population;
    if (body.value.name !== undefined) current = { ...current, name: body.value.name, updatedAt: now() };
    if (body.value.members) {
      // The member list REPLACES what is there: the whole ordered set, weights and all.
      const members = membersOf(body.value.members, lib);
      if (!members.ok) return fail(c, "bad_request", members.message);
      current = { ...current, members: members.members, updatedAt: now() };
    }
    await deps.store.savePopulation(current);
    // Changing a weight moves people in every study that sends this population (ADR-0039 accepts
    // this; the builder says so), so every cohort it now holds is re-laned at the sizes those
    // studies give it — and so is every cohort that was taken OUT, whose lanes may have shrunk to
    // whatever another population still gives them.
    await ensureRosterFor(deps.store, current.id);
    const stillHeld = new Set(current.members.map((member) => member.cohortId));
    for (const member of population.members) if (!stillHeld.has(member.cohortId) && lib.cohorts.has(member.cohortId)) await relane(member.cohortId);
    return c.json(populationViewOf(current, lib));
  });

  app.delete(routes.population_(":p", ":pop"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const population = await populationOf(c, s.project.id);
    if (!population) return fail(c, "not_found", "no such population");
    // The one refusal: the store refuses a population a study still names, and naming the
    // referrer is the point of that refusal (SPEC §2.14). Uncaught it was a 500, which tells the
    // user nothing. There is no "only population" or "default population" to protect any more —
    // nothing falls back to a population it was not given (ADR-0041), so the last one may go.
    try {
      await deps.store.deletePopulation(population.id);
    } catch (err) {
      if (err instanceof ReferencedError) return fail(c, "conflict", err.message);
      throw err;
    }
    return c.body(null, 204);
  });

  const settingsView = async (projectId: string): Promise<SettingsView> => {
    const settings = await ensureSettings(deps.store, projectId);
    const { apiKey: _apiKey, ...model } = settings.model;
    // The timing goes out too, under the wire's word for the cap: a study builder inherits these
    // when its form names no timing, and without them on this view it would have to invent
    // defaults of its own and disagree with what saving actually does.
    return {
      model,
      guardrails: settings.guardrails,
      verifier: settings.verifier,
      daemon: settings.daemon,
      cadence: settings.cadence,
      seed: settings.seed,
      maxVisits: settings.maxWakes,
      hasApiKey: deps.hasApiKey(),
      // Both judges' keys, because both judges are offered on the screen this view feeds and each
      // fails on its own. `deps.typesafe` IS the flag for the typed one — its absence is how this
      // process says it has no `TYPESAFE_API_KEY` (see `ControlDeps.typesafe`) — and what goes out
      // is that one boolean. The key itself never comes down the wire, and neither does anything
      // derived from it.
      hasTypesafeKey: deps.typesafe !== undefined,
      updatedAt: settings.updatedAt,
    };
  };

  app.get(routes.settings(":p"), async (c) => {
    const s = await scope(c);
    return s.ok ? c.json(await settingsView(s.project.id)) : s.response;
  });

  app.put(routes.settings(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const body = await parseBody(c, SettingsInputSchema);
    if (!body.ok) return body.response;
    const settings = await ensureSettings(deps.store, s.project.id);
    await deps.store.saveSettings({
      ...settings,
      // The key is never in the form, so a partial update must not be able to drop the one the
      // process was configured with.
      model: { ...settings.model, ...body.value.model },
      guardrails: { ...settings.guardrails, ...body.value.guardrails, perWake: { ...settings.guardrails.perWake, ...body.value.guardrails?.perWake } },
      verifier: { ...settings.verifier, ...body.value.verifier },
      daemon: { ...settings.daemon, ...body.value.daemon },
      updatedAt: now(),
    });
    return c.json(await settingsView(s.project.id));
  });

  // ---- triage --------------------------------------------------------------

  app.get(routes.triage(":p"), async (c) => {
    const s = await scope(c);
    return s.ok ? c.json({ items: await projects.triage(s.project.id), nextCursor: null }) : s.response;
  });

  app.put(routes.triage(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const body = await parseBody(c, TriageInputSchema);
    if (!body.ok) return body.response;
    const runs = await deps.store.listRuns({ projectId: s.project.id });
    const findings = runs.length === 0 ? [] : await deps.store.listFindings({ runIds: runs.map((r) => r.id) });
    const current = findings.find((f) => f.signature === body.value.signature);
    const existing = await deps.store.getTriage(s.project.id, body.value.signature);
    const triage: Triage = {
      projectId: s.project.id,
      signature: body.value.signature,
      state: body.value.state,
      note: body.value.note ?? existing?.note ?? "",
      externalRef: body.value.externalRef ?? existing?.externalRef ?? "",
      // The title AT TRIAGE, so a signature whose title has since drifted shows up as an orphan
      // instead of quietly carrying a human's judgement onto a different problem (ADR-0028).
      titleAtTriage: current?.title ?? existing?.titleAtTriage ?? "",
      updatedAt: now(),
    };
    await deps.store.saveTriage(triage);
    return c.json({ ...triage, drifted: false });
  });

  // ---- studies -------------------------------------------------------------

  const studyOf = async (c: Context, projectId: string): Promise<Simulation | undefined> => {
    const id = param(c, "s");
    const direct = await deps.store.getSimulation(id);
    if (direct && direct.projectId === projectId) return direct;
    return (await deps.store.listSimulations({ projectId, includeArchived: true })).find((study) => study.slug === id);
  };

  /** The overrides block as the row carries it: a block the form did not send overrides nothing. */
  const overridesOf = (input: StudyOverridesInput): Simulation["overrides"] => ({ model: input.model ?? {}, guardrails: input.guardrails ?? {}, verifier: input.verifier ?? {} });

  /**
   * The report cycle a patch leaves behind: what is saved, with only the fields that were sent
   * replaced.
   *
   * Field by field and never wholesale, exactly as `cadence` is merged, because this is the one
   * dial on how often populace writes into somebody's issue tracker (ADR-0045) and a form that
   * shows two of its four fields must not carry the other two along at a default. `ReportCycleInput`
   * has no defaults of its own for that reason; see its comment.
   */
  const reportCycleOf = (existing: Simulation["reportCycle"], patch: ReportCycleInput | undefined): Simulation["reportCycle"] => ({
    every: patch?.every ?? existing.every,
    jitter: patch?.jitter ?? existing.jitter,
    initialDelay: patch?.initialDelay ?? existing.initialDelay,
    // `everyVisits` is nullable and null MEANS something — time is the only trigger — so it is
    // undefined that falls through here, not falsiness.
    everyVisits: patch?.everyVisits === undefined ? existing.everyVisits : patch.everyVisits,
  });

  /**
   * A study as its own page reads it.
   *
   * It is the index's summary plus the study's report cycle, and the cycle is added here rather
   * than in the read model because that is where its one reader is: the builder opens on a study
   * read on its own, and a studies index that carried a timing for every row would be shipping a
   * setting nothing on that screen can act on. See `StudySummaryView.reportCycle`.
   */
  const studyView = async (study: Simulation): Promise<StudySummaryView> => ({ ...(await projects.studySummary(study)), reportCycle: study.reportCycle });

  /** A saved study as a draft, so the saved and the unsaved are estimated by one path. */
  const draftOf = (study: Simulation): StudyDraft => ({
    projectId: study.projectId,
    targetId: study.targetId,
    populationId: study.populationId,
    size: study.size,
    visitsPerPerson: study.visitsPerPerson,
    cadence: study.cadence,
    seed: study.seed,
    autoSweep: study.autoSweep,
    requireFreshTarget: study.requireFreshTarget,
    overrides: study.overrides,
    brief: study.brief,
  });

  /**
   * Writes the people a study's deal calls for, and forgives the one thing that can stop it: a
   * cohort whose mix names a persona that has gone. The study row is saved by the time this runs,
   * and the gap is reported where it is read — a 409 on the People page and in preflight — rather
   * than by failing a save that did not cause it.
   */
  const materialiseQuietly = async (studyId: string): Promise<void> => {
    try {
      await materialise(deps.store, studyId);
    } catch (err) {
      if (!(err instanceof RosterIncomplete)) throw err;
    }
  };

  app.get(routes.studies(":p"), async (c) => {
    const s = await scope(c);
    return s.ok ? c.json({ items: await projects.listStudies(s.project.id), nextCursor: null }) : s.response;
  });

  /**
   * Making a study. `populationId`, `targetId` and `size` are REQUIRED: a project holds several
   * targets and several populations, and the server refuses to guess which (ADR-0035) — a POST
   * without them is a 400 that NAMES the choices and creates nothing, because "ambiguous" is a
   * puzzle and a list of the two targets is an answer. The size is what makes it a study at all
   * (ADR-0041): saving it is what writes the people.
   */
  app.post(routes.studies(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    // Parsed with the two ids relaxed, so a body missing one is answered with the choices rather
    // than with the schema's word for "required".
    const body = await parseBody(c, StudyCreateInputSchema.partial({ populationId: true, targetId: true }));
    if (!body.ok) return body.response;
    const lib = await libraryOf(s.project.id);
    const targets = await deps.store.listTargets(s.project.id);
    if (body.value.targetId === undefined) {
      return fail(
        c,
        "bad_request",
        targets.length === 0
          ? "connect a target before making a study; a study names the target its people visit"
          : `say which target this study visits (targetId): ${targets.map((t) => `${t.name} (${t.id})`).join(", ")}`,
      );
    }
    if (body.value.populationId === undefined) {
      return fail(
        c,
        "bad_request",
        lib.populations.length === 0
          ? "compose a population before making a study; a study names the population it sends"
          : `say which population this study sends (populationId): ${lib.populations.map((p) => `${p.name} (${p.id})`).join(", ")}`,
      );
    }
    const target = owned(await deps.store.getTarget(body.value.targetId), s.project.id);
    if (!target) return fail(c, "bad_request", "that target is not in this project");
    const population = owned(await deps.store.getPopulation(body.value.populationId), s.project.id);
    if (!population) return fail(c, "bad_request", "that population is not in this project");
    const settings = await ensureSettings(deps.store, s.project.id);
    const taken = new Set(lib.studies.map((study) => study.slug));
    const base = body.value.slug ?? (slugify(body.value.name) || "study");
    const reserved = reservedSlug(c, base, "study");
    if (reserved) return reserved;
    const slug = uniqueSlug(base, taken);
    const study = await createSimulation(deps.store, {
      projectId: s.project.id,
      slug,
      name: body.value.name,
      ...(body.value.description === undefined ? {} : { description: body.value.description }),
      ...(body.value.brief === undefined ? {} : { brief: body.value.brief }),
      populationId: population.id,
      targetId: target.id,
      size: body.value.size,
      visitsPerPerson: body.value.visitsPerPerson === undefined ? settings.maxWakes : body.value.visitsPerPerson,
      cadence: { ...settings.cadence, ...body.value.cadence },
      seed: body.value.seed ?? settings.seed,
      ...(body.value.autoSweep === undefined ? {} : { autoSweep: body.value.autoSweep }),
      ...(body.value.requireFreshTarget === undefined ? {} : { requireFreshTarget: body.value.requireFreshTarget }),
      ...(body.value.overrides === undefined ? {} : { overrides: overridesOf(body.value.overrides) }),
    });
    // The report cycle is merged onto the row after it exists rather than passed through the
    // create draft, because a partial has to be merged over something and the thing it is merged
    // over is the schema's own rhythm — which only exists once the row has been parsed. A second
    // write on a path that then writes a whole roster anyway.
    const withCycle: Simulation = body.value.reportCycle === undefined ? study : { ...study, reportCycle: reportCycleOf(study.reportCycle, body.value.reportCycle) };
    if (withCycle !== study) await deps.store.saveSimulation(withCycle);
    // Setting the size is what writes the people (ADR-0041): every cohort the population holds is
    // laned at the largest count any study gives it, this one included.
    await materialiseQuietly(study.id);
    return c.json(await studyView(withCycle), 201);
  });

  app.get(routes.study(":p", ":s"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const study = await studyOf(c, s.project.id);
    return study ? c.json(await studyView(study)) : fail(c, "not_found", "no such study");
  });

  app.put(routes.study(":p", ":s"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const existing = await studyOf(c, s.project.id);
    if (!existing) return fail(c, "not_found", "no such study");
    const body = await parseBody(c, StudyUpdateInputSchema);
    if (!body.ok) return body.response;
    const visits = body.value.visitsPerPerson === undefined ? existing.visitsPerPerson : body.value.visitsPerPerson;
    // The same ownership check the POST makes. Taken raw, a study in project A could be pointed
    // at project B's target — and resolution looks a target up by id with no project predicate,
    // so the run would go to B's server carrying B's stored bearer token.
    if (body.value.populationId !== undefined && !owned(await deps.store.getPopulation(body.value.populationId), s.project.id)) {
      return fail(c, "bad_request", "that population is not in this project");
    }
    if (body.value.targetId !== undefined && !owned(await deps.store.getTarget(body.value.targetId), s.project.id)) {
      return fail(c, "bad_request", "that target is not in this project");
    }
    const updated: Simulation = {
      ...existing,
      name: body.value.name ?? existing.name,
      description: body.value.description ?? existing.description,
      brief: body.value.brief ?? existing.brief,
      populationId: body.value.populationId ?? existing.populationId,
      targetId: body.value.targetId ?? existing.targetId,
      size: body.value.size ?? existing.size,
      // The cap decides the mode, so the two can never disagree: a capped study ENDS and is
      // ephemeral, an uncapped one runs until somebody stops it and is longitudinal.
      mode: visits === null ? "longitudinal" : "ephemeral",
      visitsPerPerson: visits,
      cadence: { ...existing.cadence, ...body.value.cadence },
      seed: body.value.seed ?? existing.seed,
      reportCycle: reportCycleOf(existing.reportCycle, body.value.reportCycle),
      autoSweep: body.value.autoSweep ?? existing.autoSweep,
      requireFreshTarget: body.value.requireFreshTarget ?? existing.requireFreshTarget,
      // When sent, the object IS the overrides block: a form that shows all three blocks sends
      // all three, and a block it left empty overrides nothing.
      overrides: body.value.overrides === undefined ? existing.overrides : overridesOf(body.value.overrides),
      updatedAt: now(),
    };
    await deps.store.saveSimulation(updated);
    // A new size re-deals the roster at once: growing re-deals nobody, shrinking puts people
    // aside rather than away (ADR-0031). A population that was swapped out is re-laned too,
    // because its cohorts may now be sent by nobody.
    await materialiseQuietly(updated.id);
    if (updated.populationId !== existing.populationId && (await deps.store.getPopulation(existing.populationId))) {
      await ensureRosterFor(deps.store, existing.populationId);
    }
    return c.json(await studyView(updated));
  });

  /**
   * Archived, not deleted: a study's executions are the user's history, so removing it from the
   * list leaves them exactly where they are. `?runs=delete` is the user having been shown how many
   * executions that is and said to take them too — then the study row goes as well, and the
   * archive path is never reached. (A study that has never run has no history to keep, and the
   * store lets its row go either way.)
   *
   * Either way the people it alone was sending are put aside, not deleted: the roster is re-laned
   * at the sizes the REMAINING studies give it (an archived study with a running or paused
   * execution still counts), and they come back if a study sends them again (ADR-0031). This is
   * the one writer that re-lanes through the population rather than through `materialise`,
   * because the row it would materialise may just have gone.
   */
  app.delete(routes.study(":p", ":s"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const study = await studyOf(c, s.project.id);
    if (!study) return fail(c, "not_found", "no such study");
    const withRuns = c.req.query("runs") === "delete";
    if (withRuns) {
      const running = new Set(deps.runs.runningIds);
      const live = (await deps.store.listRuns({ simulationId: study.id })).filter((run) => running.has(run.id));
      if (live.length > 0) return fail(c, "conflict", `${study.name} is running; stop it first, and sweep if accounts were made`);
    }
    await deps.store.deleteSimulation(study.id, withRuns ? { withRuns: true } : {});
    try {
      await ensureRosterFor(deps.store, study.populationId);
    } catch (err) {
      // A cohort whose persona has gone is reported where it is read, not by failing the archive.
      if (!(err instanceof RosterIncomplete)) throw err;
    }
    return c.body(null, 204);
  });

  /** Resolves a study into the config a run would execute, or says what is missing. Reads only. */
  const resolve = async (c: Context, study: Simulation): Promise<{ ok: true; value: ResolvedSimulation } | { ok: false; response: Response }> => {
    try {
      return { ok: true, value: await resolveSimulationConfig(deps.store, deps.processConfig, study.id) };
    } catch (err) {
      if (err instanceof ConfigIncomplete) return { ok: false, response: fail(c, "conflict", err.missing.join("; ")) };
      throw err;
    }
  };

  /**
   * Pure arithmetic over a draft, saved or not. It reads history and spends nothing, writes no
   * person and never starts a run. A study that sends nobody — a size of nought, or a population
   * whose cohorts have no personas yet — is a ZERO estimate, never a 409: the builder asks this on
   * every keystroke and the number is the answer it wants. The model and the ceilings in that
   * answer are still the real ones, from the settings the study would run under.
   */
  const estimateFor = async (c: Context, draft: StudyDraft): Promise<Response> => {
    // The same ownership check a POST makes: a draft in project A must not be priced against
    // project B's population or target.
    if (!owned(await deps.store.getPopulation(draft.populationId), draft.projectId)) return fail(c, "bad_request", "that population is not in this project");
    if (!owned(await deps.store.getTarget(draft.targetId), draft.projectId)) return fail(c, "bad_request", "that target is not in this project");
    try {
      const { config } = await resolveDraft(deps.store, deps.processConfig, draft);
      return c.json(toEstimateView(await estimateRun(deps.store, { config })));
    } catch (err) {
      if (!(err instanceof ConfigIncomplete)) throw err;
      if (!err.sendsNobody) return fail(c, "conflict", err.missing.join("; "));
      const plan = planSettings(await ensureSettings(deps.store, draft.projectId), draft.overrides);
      return c.json(toEstimateView(await zeroEstimate(deps.store, { model: plan.model, guardrails: plan.guardrails, visitsPerPerson: draft.visitsPerPerson })));
    }
  };

  /**
   * The estimate for a study that does not exist yet, or for a saved one as the form now has it.
   * The body is the draft; `cadence`, `seed` and `overrides` fall through to the project's
   * settings when absent, exactly as they would on the row a POST would write.
   */
  app.post(routes.projectEstimate(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const body = await parseBody(c, ProjectEstimateBodySchema);
    if (!body.ok) return body.response;
    const settings = await ensureSettings(deps.store, s.project.id);
    return estimateFor(c, {
      projectId: s.project.id,
      targetId: body.value.targetId,
      populationId: body.value.populationId,
      size: body.value.size,
      visitsPerPerson: body.value.visitsPerPerson,
      cadence: { ...settings.cadence, ...body.value.cadence },
      seed: body.value.seed ?? settings.seed,
      ...(body.value.overrides === undefined ? {} : { overrides: overridesOf(body.value.overrides) }),
    });
  });

  /** The same arithmetic for a saved study, as the row has it. */
  app.post(routes.studyEstimate(":p", ":s"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const study = await studyOf(c, s.project.id);
    if (!study) return fail(c, "not_found", "no such study");
    return estimateFor(c, draftOf(study));
  });

  /**
   * Who is going, what they will meet, and what one of them will actually be told. No spending,
   * and no writing: resolution reads the roster and fills a missing ordinal in memory, so a study
   * saved a moment ago previews the same names a start would write (ADR-0041).
   */
  app.get(routes.studyPreflight(":p", ":s"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const study = await studyOf(c, s.project.id);
    if (!study) return fail(c, "not_found", "no such study");
    const resolved = await resolve(c, study);
    if (!resolved.ok) return resolved.response;
    const { config } = resolved.value;
    const view = await liveTargetView(config, true, (await asTheUser(c, s.project.id)).signIn);
    const [estimate, killSwitch] = await Promise.all([estimateRun(deps.store, { config }), deps.store.getKillSwitch()]);
    const first = expandPopulation(config.population, "preflight", study.id)[0];
    const blockers: string[] = [];
    if (!deps.hasApiKey()) blockers.push("Set ANTHROPIC_API_KEY before starting a run; the people are model calls.");
    if (killSwitch.engaged) blockers.push(`Everything is stopped${killSwitch.reason ? ` (${killSwitch.reason})` : ""}. Release it to start a run.`);
    if (study.requireFreshTarget && config.target.reset.kind === "none")
      blockers.push("This study insists on a fresh target, and the target declares no reset.");
    // A first contact that FAILED is a blocker: it is the one thing on this page that has actually
    // been tried against the target, and starting a run past it spends money to rediscover it.
    // Never having run one is not a blocker — it is a warning — because a check that provisions an
    // account cannot be made a precondition of a page that must not provision anything.
    const contact = resolved.value.target.firstContact;
    if (contact && !firstContactWorked(contact)) blockers.push(`First contact with ${resolved.value.target.name} did not work: ${contact.summary}`);

    // What the policy leaves, and what it takes away, tool by tool. The target's policy is the
    // floor everybody stands on; a persona can only narrow it further, which is why a tool blocked
    // by the target is reported as blocked for "everyone" and a tool a persona refuses names the
    // cohorts it is shut off for.
    const targetOnly = effectiveToolPolicy(config.target.tools);
    // One entry per cohort AND persona: a cohort mixing two personas is shut out of a tool per
    // persona, and the cohort's own policy narrows every one of its people.
    const cohorts = config.population.members.map((member) => ({
      label: `${member.cohortName || member.cohort} (${member.persona.name})`,
      policy: effectiveToolPolicy(config.target.tools, member.persona.tools, member.tools),
    }));
    // A self-signup target whose own policy blocks its sign-up tool is a dead configuration and it
    // is detectable without touching anything: nobody sent here could make an account, so every
    // visit would end auth-failed. First contact reports it too, but only once somebody has run
    // one, and this costs nothing to say up front.
    // A target that was connected and never finished (ADR-0040). It is the cheapest blocker on
    // this page — no address is asked anything, the row itself says so — and it is the one that
    // must never be advisory: `identityProviderFor` refuses an unfinished target, so a run started
    // past it dies before its first visit with a message from four layers down.
    if (config.identity.strategy === "undecided")
      blockers.push(`Nobody has said how people get accounts on ${resolved.value.target.name}. Open the target and answer that — until then there is no account for anybody sent there to use.`);
    if (config.identity.strategy === "self-signup" && !isToolPermitted(config.identity.signupTool, targetOnly))
      blockers.push(`The target's own tool policy blocks ${config.identity.signupTool}, which is the tool an account is made with — nobody sent here could sign up.`);
    const exposed = view.tools ?? [];
    const allowed = exposed.filter((tool) => isToolPermitted(tool.name, targetOnly));
    const blocked = exposed.flatMap((tool) => {
      if (!isToolPermitted(tool.name, targetOnly)) {
        return [{ name: tool.name, who: "everyone", why: `the target's tool policy — ${blockedBecause(tool.name, targetOnly) ?? "blocked"}` }];
      }
      const shutOut = cohorts.filter((cohort) => !isToolPermitted(tool.name, cohort.policy));
      if (shutOut.length === 0) return [];
      const why = blockedBecause(tool.name, shutOut[0]?.policy ?? targetOnly) ?? "blocked";
      return [{ name: tool.name, who: shutOut.length === cohorts.length ? "everyone" : shutOut.map((cohort) => cohort.label).join(", "), why: `their persona's or cohort's tool policy — ${why}` }];
    });

    return c.json(
      await projects.preflight(study, {
        estimate: toEstimateView(estimate),
        tools: allowed.map((t) => ({ name: t.name, description: t.description })),
        blocked,
        // The TARGET's setting, not the strictest across the population: this is the target
        // section, and one cautious persona must not make the screen read "nobody may" for
        // everybody. A persona that tightens it further shows up in `blocked`.
        destructive: config.target.tools.destructive,
        firstContact: contact,
        toolsError: view.toolsError,
        promptPreview: first
          ? // The study's brief is the third argument, exactly as the real visit passes it
            // (`runWake`). Rendering the preview without it made this page the one screen that
            // showed a prompt nobody would ever be sent: the brief is the per-study text handed to
            // everybody the study sends, so leaving it out dropped the study's own words from the
            // only place a user can read them before spending anything.
            { personName: first.agent.name, cohortSlug: first.agent.cohortSlug, text: personaSystemPrompt(first.agent, config.target, config.simulation.brief) }
          : { personName: "", cohortSlug: "", text: "" },
        blockers,
      }),
    );
  });

  /**
   * Starting an execution. The run is created inside the job so that a failure to start is a
   * failed job the browser can read, rather than a request that timed out with nothing to point
   * at (ADR-0027).
   */
  const startExecution = async (c: Context, study: Simulation, carryForwardFrom?: string): Promise<Response> => {
    const body = await parseBody(c, StartExecutionBodySchema);
    if (!body.ok) return body.response;
    if (!deps.hasApiKey()) return fail(c, "unavailable", "starting a run needs ANTHROPIC_API_KEY; the people are model calls");
    // Materialised BEFORE the snapshot (ADR-0041): resolution is read-only and would fill a
    // missing person in memory, and a cast the snapshot freezes has to be a cast that is stored,
    // so that the same person is met by the next execution and by every other study on the cohort.
    await materialiseQuietly(study.id);
    const resolved = await resolve(c, study);
    if (!resolved.ok) return resolved.response;
    const parent = carryForwardFrom ?? body.value.carryForwardFrom;
    if (parent !== undefined) {
      const parentRun = await deps.store.getRun(parent);
      if (!parentRun && (await deps.store.listAgents({ runId: parent })).length === 0) {
        return fail(c, "not_found", `no run ${parent} to carry on from`);
      }
      // A carry-forward copies the parent's memory and its ACCOUNTS onto this run's participants,
      // so the parent has to be an earlier execution of THIS study. Anything else seeds one
      // project's people with another's, and `reconcile` then silently drops every inherited
      // participant whose id is not in this population.
      if (parentRun && parentRun.simulationId !== study.id) {
        return fail(c, "conflict", `run ${parent} is an execution of a different study; carry it forward from its own`);
      }
      if (parentRun && parentRun.projectId !== study.projectId) {
        return fail(c, "not_found", `no run ${parent} to carry on from`);
      }
    }
    if (study.requireFreshTarget && resolved.value.config.target.reset.kind === "none") {
      return fail(c, "conflict", `${study.name} insists on a fresh target, and ${resolved.value.target.name} declares no reset`);
    }
    // Refused here, at the request, and not left to the job (ADR-0040). `identityProviderFor`
    // throws on an unfinished target, so without this the press starts a job, the job fails, and
    // the reader is shown a failed execution for a question they were never asked. A target
    // connected and left half-answered is a normal state now — the connect screen writes one on
    // purpose — so the way out of it has to be a sentence naming the target, not a stack trace.
    if (resolved.value.config.identity.strategy === "undecided") {
      return fail(c, "conflict", `nobody has said how people get accounts on ${resolved.value.target.name}; answer that on the target before sending anybody there`);
    }
    const label = body.value.label?.trim() || `${resolved.value.target.name} · ${new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`;

    let runId = "";
    let snapshotId = "";
    const job = await deps.jobs.enqueue(
      parent === undefined ? "run.start" : "run.continue",
      async (_job, report) => {
        const run = await deps.runs.start(
          {
            config: resolved.value.config,
            projectId: study.projectId,
            simulationId: study.id,
            targetId: resolved.value.target.id,
            label,
            ...(parent === undefined ? {} : { continueFrom: parent, continuationReason: body.value.reason ?? "" }),
          },
          (visits) => void report({ done: visits, label: `${visits} visit(s) done` }),
        );
        runId = run.id;
        snapshotId = run.configSnapshotId;
        return { runId: run.id };
      },
      { projectId: study.projectId, label: parent === undefined ? "starting the run" : "carrying the run on" },
    );

    // The daemon keeps ticking after `start` resolves; this only waits for the run row to exist,
    // which is what the browser needs in order to navigate to it.
    const deadline = Date.now() + 15_000;
    while (runId === "" && Date.now() < deadline) {
      const current = await deps.store.getJob(job.id);
      if (current?.status === "failed") return fail(c, "conflict", current.error ?? "the run could not be started");
      await new Promise((resolve_) => setTimeout(resolve_, 20));
    }
    if (runId === "") return fail(c, "unavailable", "the run is taking longer than expected to start; watch the job for progress");
    return c.json({ runId, jobId: job.id, configSnapshotId: snapshotId, label }, 201);
  };

  app.post(routes.studyRuns(":p", ":s"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const study = await studyOf(c, s.project.id);
    if (!study) return fail(c, "not_found", "no such study");
    return startExecution(c, study);
  });

  app.get(routes.studyRuns(":p", ":s"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const study = await studyOf(c, s.project.id);
    if (!study) return fail(c, "not_found", "no such study");
    return c.json({ items: await new ReadModel(deps.store).listRuns({ simulationId: study.id }), nextCursor: null });
  });

  app.post(routes.studyApply(":p", ":s"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const study = await studyOf(c, s.project.id);
    if (!study) return fail(c, "not_found", "no such study");
    const live = (await deps.store.listRuns({ simulationId: study.id })).find((run) => run.status === "running" || run.status === "pending");
    if (!live) return fail(c, "conflict", "nothing is running, so there is nothing to apply the changes to; run it again instead");
    // The re-resolve inside `applyChanges` reads the roster, so what it is about to freeze has to
    // be written first — the same rule a start follows.
    await materialiseQuietly(study.id);
    try {
      const run = await deps.runs.applyChanges(live.id);
      return c.json({ runId: run.id, configSnapshotId: run.configSnapshotId });
    } catch (err) {
      return fail(c, "conflict", err instanceof Error ? err.message : String(err));
    }
  });

  app.get(routes.studyResults(":p", ":s"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const study = await studyOf(c, s.project.id);
    if (!study) return fail(c, "not_found", "no such study");
    const latest = (await deps.store.listRuns({ simulationId: study.id })).sort((a, b) => a.seq - b.seq).at(-1);
    const coverage = latest ? await coverageOf(latest.id, (await asTheUser(c, s.project.id)).signIn) : { items: [], exposedCount: 0, neverCalledCount: 0, toolsError: null };
    return c.json(await projects.results(study, coverage));
  });

  app.get(routes.studyCluster(":p", ":s", ":sig"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const study = await studyOf(c, s.project.id);
    if (!study) return fail(c, "not_found", "no such study");
    const detail = await projects.cluster(study, param(c, "sig"));
    return detail ? c.json(detail) : fail(c, "not_found", "nothing with that signature in this study");
  });

  app.get(routes.studyCompare(":p", ":s"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const study = await studyOf(c, s.project.id);
    if (!study) return fail(c, "not_found", "no such study");
    const q = parseQuery(c, CompareQuerySchema);
    if (!q.ok) return q.response;
    const compared = await projects.compare(study, q.value.a, q.value.b);
    return compared ? c.json(compared) : fail(c, "not_found", "those two executions are not both in this study");
  });

  /**
   * The tool list a run's coverage is measured against, from the config that run froze.
   *
   * `signIn` is the OPERATOR's grant, threaded in from the request: reading which tools a target
   * exposes is one of the things ADR-0036 means by acting as the user. It is not the credential
   * the run itself used, and cannot become one — a visit builds its own session.
   */
  const coverageOf = async (runId: string, signIn?: (endpoint: McpEndpoint) => SignInProvider | undefined) => {
    const read = new ReadModel(deps.store);
    let config: PopulaceConfig | undefined;
    try {
      config = await deps.configForRun(runId);
    } catch {
      config = undefined;
    }
    const view = config ? await liveTargetView(config, true, signIn) : { name: "", endpoints: [], webBaseUrl: null, description: null, identityStrategy: "", tools: null, toolsError: "no target is set up" };
    return read.toolUsage(runId, view);
  };

  // ---- github: the connection, and filing what a study found (ADR-0044) ----

  /**
   * The connection as the browser may see it.
   *
   * It **parses**; it does not build a literal, and that is the whole guard rather than a style
   * preference. `GithubConnectionViewSchema` is a `z.object`, so it drops every key it does not
   * name and the token cannot survive the call whatever was handed in. The natural-looking
   * alternative —
   *
   * ```ts
   * const view: GithubConnectionView = { ...connection, tokenSet: connection.token !== undefined };
   * ```
   *
   * — compiles clean and puts the token on the wire: TypeScript's excess-property check exists
   * only for keys written out in a literal and does not reach across a spread. `settingsView`
   * above is safe only because it is a whitelist literal naming every field it serves; the same
   * code with one spread in it would be silently a leak. Parsing makes the guard structural
   * instead of something the next author has to remember (ADR-0040).
   */
  const githubView = (connection: GithubConnection): GithubConnectionView =>
    GithubConnectionViewSchema.parse({ ...connection, tokenSet: connection.token !== undefined && connection.token !== "" });

  /**
   * The connection, or `null` before anybody has made one.
   *
   * `null` rather than an empty object, because "no repository yet" and "a repository whose token
   * you cannot see" are different states and the settings screen has to be able to tell them
   * apart — the same reason `GET /target` answers a target row or nothing.
   */
  app.get(routes.github(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const connection = await deps.store.getGithubConnection(s.project.id);
    return c.json(connection === undefined ? null : githubView(connection));
  });

  /**
   * A patch over the stored connection, with the write-only rule on the token: **absent keeps,
   * the empty string clears, a value replaces** — `mergeIdentity` above, exactly.
   *
   * Two fields are deliberately not the caller's to set. `visibility` and `checkedAt` are what the
   * CHECK found out by asking GitHub, so a PUT cannot declare a public repository private and walk
   * past the confirmation that exists because a public one publishes the target's address and the
   * study's setup. And when the repository CHANGES, both are reset: what the last check learned
   * was about somewhere else, and carrying it over would make an unchecked repository read as
   * checked and private.
   */
  app.put(routes.github(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const body = await parseBody(c, GithubConnectionInputSchema);
    if (!body.ok) return body.response;
    const existing = await deps.store.getGithubConnection(s.project.id);
    const repo = body.value.repo ?? existing?.repo;
    // The server refuses to guess rather than inventing a repository (ADR-0035's rule): on a first
    // PUT there is nothing stored to keep, so the missing field is named.
    if (repo === undefined) return fail(c, "bad_request", "say which repository to file into, as owner/name; there is none stored to keep");
    const token = body.value.token === undefined ? existing?.token : body.value.token === "" ? undefined : body.value.token;
    const sameRepo = existing !== undefined && existing.repo === repo;
    const at = now();
    const connection = GithubConnectionSchema.parse({
      projectId: s.project.id,
      repo,
      ...(token === undefined || token === "" ? {} : { token }),
      visibility: sameRepo ? existing.visibility : "unknown",
      checkedAt: sameRepo ? existing.checkedAt : null,
      autoFile: body.value.autoFile ?? existing?.autoFile,
      labels: body.value.labels ?? existing?.labels,
      // Field by field, because the body's `filter` carries no defaults on purpose: spreading a
      // partial over the stored block is right, but `{ ...existing.filter, ...body.value.filter }`
      // would also write an explicitly-present `undefined` over a stored value. An absent field
      // here falls through to the stored one and then to the schema's default.
      filter: {
        kinds: body.value.filter?.kinds ?? existing?.filter.kinds,
        minSeverity: body.value.filter?.minSeverity ?? existing?.filter.minSeverity,
        onlyConfirmed: body.value.filter?.onlyConfirmed ?? existing?.filter.onlyConfirmed,
      },
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    });
    await deps.store.saveGithubConnection(connection);
    return c.json(githubView(connection));
  });

  /** Forget the whole thing, token included. GitHub is not told, because it did not ask. */
  app.delete(routes.github(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    await deps.store.deleteGithubConnection(s.project.id);
    return c.body(null, 204);
  });

  /** One sentence a person can act on, per outcome. GitHub's own words go in `detail`. */
  const checkWords = (repo: string, check: RepoCheck): string => {
    switch (check.outcome) {
      case "ready":
        return check.visibility === "public"
          ? `${repo} answers and this token can open an issue there. It is a PUBLIC repository: an issue carries the target's address and the conditions the people were given, and anybody can read it.`
          : `${repo} answers and this token can open an issue there.`;
      case "unreachable":
        return `github.com did not answer, so populace cannot tell yet whether ${repo} can be filed into. Nothing was sent.`;
      case "refused":
        return `github.com refused this token for ${repo}. Check that it has write access to issues on that repository — a repository a token cannot see is answered exactly the same way as one that does not exist.`;
      case "no-issues":
        return `${repo} has its issue tracker switched off, so nothing can be filed there until somebody turns it back on.`;
      case "expired":
        return `this token has expired. Make a new one with write access to issues on ${repo}, then press Check again.`;
    }
  };

  /**
   * "Will this token open an issue in that repository?"
   *
   * A POST for three reasons, each of which would be enough on its own: the body may carry a token
   * nobody has saved yet (the `provisioningCheck` precedent), it reaches somebody else's server,
   * and it WRITES what it learned — the visibility and the time — onto the connection, which a GET
   * may not do (ADR-0023, ADR-0041).
   *
   * An absent token falls back to the stored one, so the settings form — which has never been
   * shown the token it is editing — can ask the same question as somebody pasting a fresh one.
   */
  app.post(routes.githubCheck(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const body = await parseBody(c, GithubCheckBodySchema);
    if (!body.ok) return body.response;
    const existing = await deps.store.getGithubConnection(s.project.id);
    const typed = body.value.token === undefined || body.value.token === "" ? undefined : body.value.token;
    const token = typed ?? existing?.token;
    const checkedAt = now();
    // Nothing goes out at all without a token: an unauthenticated request to a private repository
    // is answered 404, which reads as "no such repository" and would send somebody hunting for a
    // typo in a name that is correct.
    if (token === undefined || token === "") {
      const nothingToTryWith: GithubCheckResult = GithubCheckResultSchema.parse({
        outcome: "refused",
        summary: `populace has no token to reach ${body.value.repo} with. Paste one with write access to issues on that repository, then press Check.`,
        detail: null,
        visibility: "unknown",
        expiresAt: null,
        checkedAt,
      });
      return c.json(nothingToTryWith);
    }
    const client = (deps.githubClient ?? ((connection) => new GithubClient(connection)))({ repo: body.value.repo, token });
    const check = await client.getRepo();
    /*
     * Recorded only against the connection this check was actually about, and only when github.com
     * ANSWERED.
     *
     * A check run from the form before a save has no row to stamp, and stamping the stored row with
     * what was learned about a different repository is how an unchecked address comes to read as
     * checked. `unreachable` is the third case and the subtle one: nothing was learned, so nothing
     * is written — `checkedAt` means "when the check reached the repository", and a timestamp
     * written beside `visibility: "unknown"` would be a row claiming it had been checked and found
     * to be neither public nor private.
     */
    if (existing !== undefined && existing.repo === body.value.repo && check.outcome !== "unreachable") {
      await deps.store.saveGithubConnection({ ...existing, visibility: check.visibility, checkedAt, updatedAt: checkedAt });
    }
    return c.json(GithubCheckResultSchema.parse({ ...check, summary: checkWords(body.value.repo, check), checkedAt }));
  });

  /**
   * What the publisher needs, assembled here so both triggers below are the same pass.
   *
   * `projects` is the read model this whole file already shares, which is the point: the publisher
   * builds ONE study context and derives every cluster from it, where a `cluster()` per candidate
   * would rebuild every execution, visit and report — twice over, for the two clustering passes —
   * for each issue it filed.
   */
  const publishDeps = (): PublishIssuesDeps => ({
    store: deps.store,
    readModel: projects,
    ...(deps.githubClient ? { client: deps.githubClient } : {}),
  });

  /**
   * Whether there is anywhere to file, asked BEFORE a job is enqueued.
   *
   * The synchronous route below needs none of this and deliberately has none: `publishIssues`
   * refuses on its own — it has to, because the automatic cycle has no route in front of it — and
   * the throw it makes happens before any outbound write, so a 409 carrying the publisher's own
   * sentence is both correct and free. A JOB cannot do that: "you have not set up a repository"
   * would arrive as a failed job row, which is the wrong place to learn it from a button press.
   *
   * **These two sentences are a second copy of `requireConnection`'s in `publish-issues.ts` and
   * have to be kept in step with it.** The alternative is worse rather than better: asking the
   * publisher itself, even over an empty signature list, loads the whole study context and runs
   * `publishable` before it would notice there is nothing to file with — the one recompute that
   * file exists to do once, done twice per press.
   */
  const notConnected = async (projectId: string): Promise<string | null> => {
    const connection = await deps.store.getGithubConnection(projectId);
    if (connection === undefined || connection.repo === "") return "This project has no repository to file issues into. Add one in the project's settings, check it, and populace will file there.";
    if (connection.token === undefined || connection.token === "") return `populace has ${connection.repo} to file into but no token to file with. Paste a token with write access to issues on that repository and press Check.`;
    return null;
  };

  /**
   * ONE problem, filed now.
   *
   * Synchronous and not a job: one issue is one round trip, and a reader who pressed a button on a
   * finding page wants the link rather than a job row to watch. It runs OUTSIDE the serial queue,
   * which is exactly why it goes through the same `publishIssues` as the bulk path — the ledger
   * read, the marker search and the per-issue ledger write are what stop a double click, or a
   * click while a bulk job is running, from filing the same problem twice.
   *
   * 201 only when an issue was CREATED. A repeat comments on the issue that already exists and a
   * skip creates nothing, so both answer 200 with the same typed result; a `failed` one answers
   * 200 too, because the pass ran and its outcome is the answer — an error envelope would throw
   * away the sentence the screen shows and the reason GitHub gave.
   */
  app.post(routes.studyIssue(":p", ":s", ":sig"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const study = await studyOf(c, s.project.id);
    if (!study) return fail(c, "not_found", "no such study");
    let result: PublishIssueResult | undefined;
    try {
      const summary = await publishIssues({ simulation: study, signatures: [param(c, "sig")] }, publishDeps());
      result = summary.results[0];
    } catch (err) {
      // The only throw the publisher makes, and it happens before any outbound write. A race
      // between the pre-flight above and the pass itself lands here rather than as a 500.
      // The publisher's own refusal, and the only throw it makes: it happens before any outbound
      // write, so a project with nowhere to file has sent nothing to anybody.
      if (err instanceof IssuesNotConnected) return fail(c, "conflict", err.message);
      throw err;
    }
    // A bulk job cannot answer 404 and so reports an unknown signature as a skip; a route can, and
    // "there is nothing with that signature in this study" is not the same answer as "populace
    // passed over it".
    if (result === undefined || result.reason === "not-found") return fail(c, "not_found", "nothing with that signature in this study");
    return c.json(result, result.outcome === "filed" ? 201 : 200);
  });

  /**
   * Every problem this study found that passes the connection's filter, or the ones named — as a
   * JOB, because forty issues is forty round trips to somebody else's server (ADR-0027).
   *
   * The kind is `issues.publish` and NOT `issues.cycle`, and the difference is load-bearing rather
   * than cosmetic: a succeeded `issues.cycle` is the one thing that closes a report window
   * (`report-windows.ts`), because "populace has reported on everything up to here" is a claim the
   * automatic cycle makes and a button press does not. Under the cycle's kind, a person pressing
   * File all would move that boundary, and the next cycle would tell every issue in the repository
   * that its problem had gone quiet.
   *
   * **`?preview=1` asks what it WOULD do and does none of it** — 200 with a `PublishPreview`, no
   * job, no request to github.com, no row written and nothing spent. It is the same route and the
   * same body on purpose: the dialog previews with exactly what it is about to send, so the answer
   * it shows is about the press it is confirming and not about a similar one. A POST rather than a
   * GET because the body carries the ticked signatures, and it stays inside the rule a GET is held
   * to anyway — it writes nothing (ADR-0023).
   */
  app.post(routes.studyIssues(":p", ":s"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const study = await studyOf(c, s.project.id);
    if (!study) return fail(c, "not_found", "no such study");
    const body = await parseBody(c, PublishIssuesBodySchema);
    if (!body.ok) return body.response;
    if (c.req.query("preview") === "1") {
      try {
        return c.json(await previewIssues({ store: deps.store, readModel: projects }, { simulation: study, ...(body.value.signatures === undefined ? {} : { signatures: body.value.signatures }) }));
      } catch (err) {
        // The same refusal the pass makes, in the same words: there is nowhere to file, so there is
        // nothing to preview either. A preview needs no TOKEN, which is why it is this refusal and
        // not `notConnected`'s — a reader with a repository and no token yet can still be shown
        // what the press would do.
        if (err instanceof IssuesNotConnected) return fail(c, "conflict", err.message);
        throw err;
      }
    }
    const refusal = await notConnected(s.project.id);
    if (refusal !== null) return fail(c, "conflict", refusal);
    const connection = await deps.store.getGithubConnection(s.project.id);
    const named = body.value.signatures;
    /*
     * The execution this pass reports on, which is the newest one — the publisher itself reports on
     * the newest window anybody visited, and that window lies inside this run.
     *
     * A `Job` names a project and a run and never a study, and changing that is a core schema with
     * many construction sites. Naming the run is what puts the progress rows on that execution's
     * live feed, where somebody who pressed the button on its results screen is looking.
     *
     * It also puts this row into `listJobs({ runId })`, which is what `report-windows.ts` reads
     * boundaries out of — so the KIND below is doing real work: `reportWindows` takes only a
     * succeeded `issues.cycle`, and this row sitting in that list under the wrong kind would close
     * a report window that nothing has reported on.
     */
    const latest = (await deps.store.listRuns({ simulationId: study.id })).sort((a, b) => a.seq - b.seq).at(-1);
    const job = await deps.jobs.enqueue(
      "issues.publish",
      async (_job, report) => {
        await report({ label: "reading what this study found", done: 0, total: named?.length ?? null });
        /**
         * Progress writes, serialised.
         *
         * `onProgress` is synchronous and `report` is not, so firing each one as a loose promise
         * would let two writes of the same job row race and leave the count going backwards on
         * the live screen. Chaining keeps them in order and lets the handler wait for the last one
         * before it settles — after which `JobRunner` ignores them anyway.
         */
        let writes: Promise<void> = Promise.resolve();
        const summary = await publishIssues(
          { simulation: study, ...(named === undefined ? {} : { signatures: named }) },
          {
            ...publishDeps(),
            onProgress: (done, total) => {
              writes = writes.then(() => report({ done, total, label: `${String(done)} of ${String(total)} looked at` }));
            },
          },
        );
        await writes;
        const counts = [
          summary.filed > 0 ? `${String(summary.filed)} filed` : "",
          summary.commented > 0 ? `${String(summary.commented)} commented on` : "",
          summary.skipped > 0 ? `${String(summary.skipped)} passed over` : "",
          summary.failed > 0 ? `${String(summary.failed)} not filed` : "",
        ].filter((part) => part !== "");
        // The counts are reported BEFORE the throw below, so a partial failure keeps them: the
        // ledger rows are written per issue inside the pass, so everything counted here is
        // already persisted and the row a person reads has to say so.
        await report({ done: summary.results.length, total: summary.results.length, label: counts.length > 0 ? `${counts.join(", ")} in ${summary.repo}` : `nothing to file in ${summary.repo}` });
        if (summary.failed > 0) {
          const first = summary.results.find((entry) => entry.outcome === "failed");
          // Named counts first, then the first reason, so the row says what survived as well as
          // what went wrong. `error` is GitHub's words through `redactText` — never a raw body,
          // and never anything carrying the token.
          throw new Error(`${counts.join(", ")}. The first that did not go: ${first?.error ?? "no reason given"}`);
        }
        return undefined;
      },
      { projectId: s.project.id, ...(latest ? { runId: latest.id } : {}), label: `filing what ${study.name} found in ${connection?.repo ?? "the project's repository"}` },
    );
    return c.json(job, 202);
  });

  // ---- the people a study sends (ADR-0041) --------------------------------

  /** A person as the wire says them: effective values, and what was set by hand beside them. */
  const personView = (person: Person, lane: Lane | undefined, elsewhere: ReadonlyMap<string, readonly number[]>): PersonView => ({
    id: person.id,
    cohortSlug: person.cohortSlug,
    cohortName: lane?.cohort.name ?? person.cohortSlug,
    personaSlug: person.personaSlug,
    personaName: lane?.persona.spec.name ?? person.personaSlug,
    ordinal: person.ordinal,
    name: person.name,
    details: person.details,
    handle: person.handle,
    generatedBy: person.generatedBy,
    // The same layering expansion does (`individuate`): the sample, the cohort, then the hand.
    patience: person.overrides.patience ?? person.persona.patience,
    budgetUsd: person.overrides.budgetUsd ?? person.persona.budgetUsd,
    traits: { ...person.persona.traits, ...(lane?.cohort.traits ?? {}), ...person.overrides.traits },
    overrides: person.overrides,
    archived: person.archivedAt !== null,
    // How many OTHER studies reach this ordinal of this cohort and persona at their own size. A
    // line written here follows them into every one of those, and the People page says so.
    alsoSentBy: (elsewhere.get(person.laneSlug) ?? []).filter((count) => count > person.ordinal).length,
  });

  /**
   * How many people every OTHER study sends per cohort-and-persona, keyed the way person rows
   * are. The studies that count are the ones the roster rule counts (D3): not archived, or
   * archived with an execution still running or paused. One deal per study, and never a query
   * per person: the lists are loaded once and joined here.
   */
  const otherSenders = async (projectId: string, except: Simulation): Promise<Map<string, number[]>> => {
    const [studies, runs, populations] = await Promise.all([
      deps.store.listSimulations({ projectId, includeArchived: true }),
      deps.store.listRuns({ projectId }),
      deps.store.listPopulations(projectId),
    ]);
    const stillGoing = new Set(runs.filter((run) => run.status === "running" || run.status === "paused").map((run) => run.simulationId));
    const counts = new Map<string, number[]>();
    for (const study of studies) {
      if (study.id === except.id || (study.archived && !stillGoing.has(study.id))) continue;
      const population = populations.find((p) => p.id === study.populationId);
      if (!population) continue;
      let deal: Deal;
      try {
        deal = await dealFor(deps.store, population, study.size);
      } catch (err) {
        // A study over a cohort whose persona has gone sends nobody from it until that is fixed.
        if (err instanceof RosterIncomplete) continue;
        throw err;
      }
      for (const lane of deal.lanes) counts.set(lane.laneSlug, [...(counts.get(lane.laneSlug) ?? []), lane.count]);
    }
    return counts;
  };

  /** The people a study sends, or the one refusal: a cohort in its population draws on a persona that is gone. */
  const sentBy = async (c: Context, study: Simulation): Promise<{ ok: true; value: Awaited<ReturnType<typeof peopleSentBy>> } | { ok: false; response: Response }> => {
    try {
      return { ok: true, value: await peopleSentBy(deps.store, study) };
    } catch (err) {
      if (err instanceof RosterIncomplete) return { ok: false, response: fail(c, "conflict", err.message) };
      throw err;
    }
  };

  /** Every person id the deal reaches, in deal order — rows written or not. */
  const idsDealt = (lanes: readonly Lane[]): string[] => lanes.flatMap((lane) => Array.from({ length: lane.count }, (_, ordinal) => personIdFor(lane.laneSlug, ordinal)));

  /**
   * Writing people is refused while anything is executing. A live run is reading this cast through
   * its config snapshot and signing accounts up from these handles; re-casting underneath it would
   * leave that run's own participants unexplainable.
   */
  const refuseWhileRunning = async (projectId: string, studyName: string): Promise<string | null> => {
    const live = [...(await deps.store.listRuns({ projectId, status: "running" })), ...(await deps.store.listRuns({ projectId, status: "pending" }))];
    return live.length === 0 ? null : `${live.length} execution(s) are reading these people right now; pause or stop them before writing the people of ${studyName}`;
  };

  /**
   * The `people.generate` handler, for one cohort. Tier 1 fills every empty slot for free before a
   * token is spent, so this succeeds with a complete cast even when there is no API key — what the
   * model adds is names and individuating details, and what it cannot do is leave a cohort half-cast.
   */
  const runWriter = async (cohortId: string, options: GenerateOptions, report: JobReport, spend: JobSpend): Promise<GeneratedRoster> => {
    const generated = await generatePeople({ store: deps.store, ...(deps.provider ? { provider: deps.provider } : {}), report, spend }, cohortId, options);
    await report({ label: generated.fellBackBecause ?? `wrote ${generated.written} of ${generated.written + generated.seeded}` });
    return generated;
  };

  /** Writes the placeholders among the given people, cohort by cohort: the writer briefs one cohort at a time. */
  const writePeople =
    (batches: readonly { cohortId: string; personIds: string[] }[]): JobHandler =>
    async (_job, report, spend) => {
      for (const batch of batches) await runWriter(batch.cohortId, { personIds: batch.personIds }, report, spend);
      return undefined;
    };

  /**
   * The people this study sends, in deal order: cohorts in the population's order, personas in
   * each cohort's mix order, then by ordinal. Only rows that exist are items; the ordinals nobody
   * has written yet are counted in `missing`, so the screen can say "N not yet written" without a
   * second request. Bounded: one roster read per project, one deal per study, whatever the size.
   */
  app.get(routes.studyPeople(":p", ":s"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const study = await studyOf(c, s.project.id);
    if (!study) return fail(c, "not_found", "no such study");
    const sent = await sentBy(c, study);
    if (!sent.ok) return sent.response;
    const { deal, people, missing } = sent.value;
    const laneOf = new Map(deal.lanes.map((lane) => [lane.laneSlug, lane]));
    const elsewhere = await otherSenders(s.project.id, study);
    const view: StudyPeopleView = {
      items: people.map((person) => personView(person, laneOf.get(person.laneSlug), elsewhere)),
      missing,
      size: study.size,
      sends: deal.sends,
    };
    return c.json(view);
  });

  /**
   * Fills the slots nobody has written yet, among the people THIS study sends. A job, because
   * tier 2 — a model writing them — is a model call, and it is the first model call this product
   * makes outside a visit (SPEC §5.4). The rows are materialised first, so the writer meets every
   * ordinal the deal reaches; it writes only the placeholders among them and leaves the rest.
   */
  app.post(routes.studyPeople(":p", ":s"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const study = await studyOf(c, s.project.id);
    if (!study) return fail(c, "not_found", "no such study");
    const refusal = await refuseWhileRunning(s.project.id, study.name);
    if (refusal) return fail(c, "conflict", refusal);
    await materialiseQuietly(study.id);
    const sent = await sentBy(c, study);
    if (!sent.ok) return sent.response;
    if (sent.value.deal.sends === 0) return fail(c, "conflict", "this study sends nobody yet: give it a size");
    const batches = sent.value.deal.cohorts.flatMap((entry) => {
      const personIds = idsDealt(entry.lanes);
      return personIds.length === 0 ? [] : [{ cohortId: entry.cohort.id, personIds }];
    });
    const job = await deps.jobs.enqueue("people.generate", writePeople(batches), { projectId: s.project.id, label: `writing the people of ${study.name}` });
    return c.json(job, 202);
  });

  /**
   * Regeneration REPLACES people who already exist, which is why it needs `confirm`. Writing over
   * a cast that past executions name is the one destructive thing in the people model. It is
   * limited to the people this study sends; a row is shared by every study on the cohort, and the
   * People page says so.
   */
  app.post(routes.studyPeopleRegenerate(":p", ":s"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const study = await studyOf(c, s.project.id);
    if (!study) return fail(c, "not_found", "no such study");
    const body = await parseBody(c, GeneratePeopleBodySchema);
    if (!body.ok) return body.response;
    // A refusal, not a conflict: nothing about the study's state makes this impossible, the
    // request is simply missing the acknowledgement that it rewrites who these people are and
    // breaks comparison with every execution that already named them.
    if (!body.value.confirm) return fail(c, "bad_request", "re-casting changes who these people are and breaks comparison with earlier executions; send confirm: true");
    const refusal = await refuseWhileRunning(s.project.id, study.name);
    if (refusal) return fail(c, "conflict", refusal);
    await materialiseQuietly(study.id);
    const sent = await sentBy(c, study);
    if (!sent.ok) return sent.response;
    const wanted = body.value.personIds === undefined ? undefined : new Set(body.value.personIds);
    const recast = sent.value.people.filter((person) => person.archivedAt === null && (wanted === undefined || wanted.has(person.id)));
    if (recast.length === 0) return fail(c, "not_found", wanted === undefined ? "this study sends nobody yet: give it a size" : "none of those people go in this study");
    const job = await deps.jobs.enqueue(
      "people.generate",
      async (_job, report, spend) => {
        // Re-casting is the one path that lets go of people who already exist. The rows are not
        // deleted — a past execution's participants still name them, and the id is the slot — they
        // are put back to being placeholders, which is the one state the writer will write into.
        //
        // Put back PROPERLY: the name is re-drawn from the seeded bank as well. A reset that kept
        // the old model-written name while stamping the row `seeded` with no details left a person
        // who was neither re-cast nor intact — and if the model then could not be reached, that is
        // what the cohort was left holding.
        const at = now();
        let written = 0;
        let fellBackBecause: string | null = null;
        for (const entry of sent.value.deal.cohorts) {
          const mine = recast.filter((person) => person.cohortId === entry.cohort.id);
          if (mine.length === 0) continue;
          const roster = await deps.store.listPeople({ cohortId: entry.cohort.id, includeArchived: true });
          const recasting = new Set(mine.map((person) => person.id));
          // Names are unique within the cohort, so the draw avoids everybody who is staying.
          const used = new Set(roster.filter((person) => !recasting.has(person.id)).map((person) => person.name));
          for (const person of mine) {
            const name = nameFrom(person.seed, used);
            used.add(name);
            // The handle follows the name here, unlike a hand rename: re-casting is refused while
            // anything is running, so nobody has signed an account up as this person yet.
            await deps.store.savePerson({ ...person, name, handle: handleFor(name, person.laneSlug, person.ordinal), details: "", generatedBy: "seeded", generatedByModel: "", archivedAt: null, updatedAt: at });
          }
          const generated = await runWriter(entry.cohort.id, { personIds: mine.map((person) => person.id) }, report, spend);
          written += generated.written;
          fellBackBecause = generated.fellBackBecause ?? fellBackBecause;
        }
        // A confirmed re-cast that wrote nobody is a failure, not a quiet success: the cast the
        // user asked to replace is gone and what stands in its place is the free one.
        if (written === 0 && fellBackBecause !== null) throw new Error(`nobody was re-cast: ${fellBackBecause}`);
        return undefined;
      },
      { projectId: s.project.id, label: `re-casting the people of ${study.name}` },
    );
    return c.json(job, 202);
  });

  /**
   * One person, by hand: a name, a blurb, and the sampled dimensions — patience, budget, traits —
   * which is as much individuality as a person carries (ADR-0031 amendment). Goals, constraints
   * and tool policy stay on the persona. The row is the cohort's, shared by every study that sends
   * the cohort, so it has to be one this study actually reaches.
   */
  app.patch(routes.studyPerson(":p", ":s", ":person"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const study = await studyOf(c, s.project.id);
    if (!study) return fail(c, "not_found", "no such study");
    const body = await parseBody(c, PersonPatchSchema);
    if (!body.ok) return body.response;
    const sent = await sentBy(c, study);
    if (!sent.ok) return sent.response;
    const person = sent.value.people.find((candidate) => candidate.id === param(c, "person"));
    if (!person) return fail(c, "not_found", "nobody by that id goes in this study");
    // Null clears an override and the sample shows through again; absent leaves it alone.
    const overrides: Person["overrides"] = { ...person.overrides, traits: { ...person.overrides.traits } };
    if (body.value.patience === null) delete overrides.patience;
    else if (body.value.patience !== undefined) overrides.patience = body.value.patience;
    if (body.value.budgetUsd === null) delete overrides.budgetUsd;
    else if (body.value.budgetUsd !== undefined) overrides.budgetUsd = body.value.budgetUsd;
    if (body.value.traits === null) overrides.traits = {};
    else if (body.value.traits !== undefined) overrides.traits = body.value.traits;
    // The handle is NOT re-derived from a new name: it is what the account on the target was
    // signed up with, and a rename must not orphan it (SPEC §5.3.5).
    //
    // And the row is stamped `authored`, which is what takes it out of the writer's reach. A
    // rename that left it looking like a placeholder — seeded, no details — would be handed
    // straight back to the next generate, which would overwrite the typed name AND re-derive the
    // handle this line just refused to move.
    const updated: Person = { ...person, name: body.value.name ?? person.name, details: body.value.details ?? person.details, overrides, generatedBy: "authored", updatedAt: now() };
    await deps.store.savePerson(updated);
    const lane = sent.value.deal.lanes.find((candidate) => candidate.laneSlug === person.laneSlug);
    return c.json(personView(updated, lane, await otherSenders(s.project.id, study)));
  });

  // ---- run control --------------------------------------------------------

  /**
   * One execution and everything it produced: participants, their memory, their visits, the
   * traces of those visits, the findings filed in them and the run's own event log.
   *
   * The refusal that matters is not "this is history" — the user pressing this is saying they
   * know — it is ACCOUNTS. A run that signed people up on somebody else's product and has not
   * been swept is the only record of which accounts those are; delete the rows and they are
   * stranded there with nothing left that can find them. So an unswept run with live identities
   * says to sweep first, and `?force=1` is the user accepting the strand. A running execution is
   * refused outright: there is a process mid-visit writing the rows this would remove.
   */
  app.delete(routes.run(":id"), async (c) => {
    const run = await deps.store.getRun(param(c, "id"));
    if (!run) return c.body(null, 204);
    if (deps.runs.runningIds.includes(run.id)) return fail(c, "conflict", "that execution is running; stop it first");
    if (c.req.query("force") !== "1") {
      // `static` is somebody's own login out of a pool file: populace never made it and deleting
      // these rows strands nothing. The other two strategies are accounts this run created.
      const live = (await deps.store.listIdentitiesByTag(tagForRun(run.id))).filter((identity) => identity.tornDownAt === null && identity.strategy !== "static");
      if (live.length > 0) {
        return fail(c, "conflict", `this execution made ${live.length === 1 ? "an account" : `${String(live.length)} accounts`} that ${live.length === 1 ? "is" : "are"} still on the target; sweep it first, or the only record of ${live.length === 1 ? "it" : "them"} goes with these rows`);
      }
    }
    await deps.store.deleteRun(run.id);
    return c.body(null, 204);
  });

  app.post(routes.runStop(":id"), async (c) => {
    const body = await parseBody(c, StopRunBodySchema);
    if (!body.ok) return body.response;
    const run = await deps.runs.stop(param(c, "id"), body.value.mode);
    return run ? c.json({ runId: run.id, status: run.status }) : fail(c, "not_found", "no such run");
  });

  /** Drain and keep everything: memory, accounts and visit counts are all keyed by this run id. */
  app.post(routes.runPause(":id"), async (c) => {
    const run = await deps.runs.pause(param(c, "id"));
    return run ? c.json({ runId: run.id, status: run.status, pauseReason: run.pauseReason }) : fail(c, "not_found", "no such run");
  });

  /** The SAME run id, picked back up from its frozen snapshot with the live credentials put back. */
  app.post(routes.runResume(":id"), async (c) => {
    if (!deps.hasApiKey()) return fail(c, "unavailable", "picking a run back up needs ANTHROPIC_API_KEY; the people are model calls");
    try {
      const run = await deps.runs.resume(param(c, "id"));
      return c.json({ runId: run.id, status: run.status, resumes: run.resumes });
    } catch (err) {
      return fail(c, "conflict", err instanceof Error ? err.message : String(err));
    }
  });

  /** ADR-0020's child run: the same people, their memory and their accounts, after a fix. */
  app.post(routes.runCarryForward(":id"), async (c) => {
    const parent = await deps.store.getRun(param(c, "id"));
    if (!parent) return fail(c, "not_found", `no run ${param(c, "id")} to carry on from`);
    const study = await deps.store.getSimulation(parent.simulationId);
    if (!study) return fail(c, "conflict", "that run's study is gone, so there is nothing to carry it on into");
    return startExecution(c, study, parent.id);
  });

  app.post(routes.runRound(":id"), async (c) => {
    const runId = param(c, "id");
    if (!deps.runs.isRunning(runId)) return fail(c, "conflict", "that run is not going at the moment, so there is nothing to send a round to");
    return c.json({ runId, participants: await deps.runs.round(runId) });
  });

  app.post(routes.runSweep(":id"), async (c) => {
    const body = await parseBody(c, SweepBodySchema);
    if (!body.ok) return body.response;
    const runId = param(c, "id");
    if (deps.runs.isRunning(runId)) return fail(c, "conflict", "stop the run before sweeping the accounts it created");
    const job = await deps.jobs.enqueue(
      "sweep",
      async (_job, report) => {
        await deps.sweep(runId, body.value, report);
        return undefined;
      },
      { runId, label: "removing the accounts this run created" },
    );
    return c.json(job, 202);
  });

  /**
   * Verification is a model call, so it is behind a POST and named in the request (ADR-0014).
   *
   * Two things here are about MONEY, and both were holes.
   *
   * The job row carries the PROJECT as well as the run. `costSince({ projectId, kind: "authoring" })`
   * sums `jobs.cost_usd` by `project_id`, so a digest job with a null project spent dollars that
   * the project's day could not see — and an automatic report cycle, which is a digest on a timer
   * for as long as a study runs, was therefore invisible to the only dollar ceiling in the system.
   *
   * And the judge's spend is CHARGED, through the job's `spend` callback, exactly as
   * `people.generate` charges the model calls that write people. Verification spends outside a
   * wake — a `model` judge at the default `claude-opus-5` on `effort: "high"`, up to `maxFindings`
   * of them — and `Wake.costUsd` is the only other place a dollar is ever recorded, so without
   * this the whole bill sat in a number nothing added up. With it, `costSince` sees a cycle's
   * spend, the project's daily ceiling counts it, and `runDigest`'s refusal stops the next one.
   */
  app.post(routes.runDigestJob(":id"), async (c) => {
    const runId = param(c, "id");
    // Read here rather than in the handler so the row is stamped with the project from the moment
    // it is queued: a job that only learns its project once it runs is a job whose spend is
    // unattributable for as long as it sits in the queue.
    const run = await deps.store.getRun(runId);
    const job = await deps.jobs.enqueue(
      "digest",
      async (_job, report, spend) => {
        // The whole body is `runDigest`, which the automatic report cycle calls too. The
        // pre-flight refusal and the daily ceiling are in there, and being in there once is the
        // point: this used to be one of two copies.
        await runDigest(deps, runId, report, spend);
        return undefined;
      },
      { runId, ...(run ? { projectId: run.projectId } : {}), label: "building the digest" },
    );
    return c.json(job, 202);
  });

  app.post(routes.killSwitch, async (c) => {
    const body = await parseBody(c, KillSwitchBodySchema);
    if (!body.ok) return body.response;
    await deps.store.setKillSwitch(body.value.engaged, body.value.reason ?? (body.value.engaged ? "stopped from the dashboard" : ""));
    return c.json(await deps.store.getKillSwitch());
  });

  app.get(routes.job(":id"), async (c) => {
    const job = await deps.store.getJob(param(c, "id"));
    return job ? c.json(job) : fail(c, "not_found", "no such job");
  });

  // ---- live ---------------------------------------------------------------

  /**
   * Everything the live screen needs in one request, derived from rows rather than from the
   * stream. A browser that reloads mid-run renders the correct screen with no live connection at
   * all, and then resumes the stream from the cursor this returns.
   */
  app.get(routes.runLive(":id"), async (c) => {
    const runId = param(c, "id");
    const [stored, agents, wakes, findings, cursor] = await Promise.all([
      deps.store.getRun(runId),
      deps.store.listAgents({ runId }),
      deps.store.listWakes({ runIds: [runId] }),
      deps.store.listFindings({ runIds: [runId] }),
      deps.store.latestEventSeq(),
    ]);
    if (!stored && agents.length === 0 && wakes.length === 0) return fail(c, "not_found", "no such run");

    const running = agents.flatMap((agent) => {
      const current = wakes.find((w) => w.agentId === agent.id && w.status === "running");
      return current ? [current.id] : [];
    });
    // Only the visits in flight need their traces read, and they are read in ONE call.
    const traces = running.length === 0 ? [] : await deps.store.getTraces(running);
    const live: ParticipantLive[] = agents.map((agent) => {
      const own = wakes.filter((w) => w.agentId === agent.id);
      const current = own.find((w) => w.status === "running");
      const trace: TraceEvent[] = current ? traces.filter((e) => e.wakeId === current.id) : [];
      const lastCall = [...trace].reverse().find((e) => e.type === "tool.call");
      return {
        participantId: agent.id,
        personId: agent.personId,
        name: agent.name,
        cohortSlug: agent.cohortSlug,
        personaName: agent.persona.name,
        status: current ? "here" : agent.status === "active" ? "away" : "retired",
        wakeId: current?.id ?? own.at(-1)?.id ?? null,
        visitNumber: current?.wakeNumber ?? agent.wakeCount,
        maxVisits: agent.maxWakes,
        turn: trace.filter((e) => e.type === "model.call").length,
        lastCall: lastCall?.type === "tool.call" ? lastCall.tool : null,
        nextVisitAt: agent.nextWakeAt,
        costUsd: Number(own.reduce((sum, w) => sum + w.costUsd, 0).toFixed(6)),
        findings: findings.filter((f) => f.agentId === agent.id).length,
      };
    });

    const planned = agents.reduce((sum, a) => sum + (a.maxWakes ?? a.wakeCount), 0);
    const view: RunLive = {
      runId,
      status: stored?.status ?? (agents.some((a) => a.status === "active") ? "running" : "completed"),
      mode: stored?.mode ?? "longitudinal",
      // A run this process is not driving reads as paused with no reason only when the row says
      // so; `process-ended` is what `reconcileOrphans` writes, and the screen says it in words.
      pauseReason: stored?.pauseReason ?? null,
      startedAt: stored?.startedAt ?? wakes[0]?.startedAt ?? null,
      endedAt: stored?.endedAt ?? null,
      cursor,
      visitsDone: wakes.filter((w) => w.status !== "running").length,
      visitsPlanned: Math.max(planned, wakes.length),
      costUsd: Number(wakes.reduce((sum, w) => sum + w.costUsd, 0).toFixed(6)),
      findings: findings.length,
      participants: live,
    };
    return c.json(view);
  });

  /**
   * One line of the event log as the browser reads it (ADR-0026). The row names the study by the
   * row's own word; the wire speaks the user's (ADR-0032, ADR-0042), so that one field is
   * translated on the way out and everything else crosses unchanged.
   */
  const eventView = (event: Event): EventView => ({
    seq: event.seq,
    at: event.at,
    projectId: event.projectId,
    studyId: event.simulationId,
    runId: event.runId,
    wakeId: event.wakeId,
    type: event.type,
    payload: event.payload,
  });

  /**
   * One stream for the whole screen (ADR-0026). Everything before `after` comes from the table, so
   * a reconnecting browser replays the gap instead of losing it; everything after arrives live.
   *
   * `project` and `study` sit alongside `run`, so a project page follows every study in it on one
   * connection rather than opening one per execution.
   */
  app.get(routes.events, (c) => {
    const q = parseQuery(c, EventStreamQuerySchema);
    if (!q.ok) return q.response;
    // `Last-EventID` is what EventSource sends by itself on a reconnect, so it wins over a cursor
    // the page put in the URL when it first loaded.
    const header = c.req.header("last-event-id");
    const resumeFrom = header !== undefined && header !== "" ? Number.parseInt(header, 10) : q.value.after;
    const filter = { ...(q.value.run === undefined ? {} : { runId: q.value.run }), ...(q.value.project === undefined ? {} : { projectId: q.value.project }), ...(q.value.study === undefined ? {} : { simulationId: q.value.study }) };
    const matches = (event: Event): boolean =>
      (filter.runId === undefined || event.runId === filter.runId) &&
      (filter.projectId === undefined || event.projectId === filter.projectId) &&
      (filter.simulationId === undefined || event.simulationId === filter.simulationId);

    return streamSSE(c, async (stream) => {
      const queue: Event[] = [];
      let notify: (() => void) | null = null;
      const unsubscribe = deps.hub.subscribe((event) => {
        if (!matches(event)) return;
        queue.push(event);
        notify?.();
      });

      let cursor = Number.isFinite(resumeFrom) && resumeFrom !== undefined ? resumeFrom : await deps.store.latestEventSeq();
      try {
        // Replay first, in pages, so a long gap does not arrive as one enormous frame.
        for (;;) {
          const missed = await deps.store.listEvents({ afterSeq: cursor, ...filter, limit: 200 });
          if (missed.length === 0) break;
          for (const event of missed) {
            await stream.writeSSE({ id: String(event.seq), event: event.type, data: JSON.stringify(eventView(event)) });
            cursor = event.seq;
          }
        }

        while (!stream.closed) {
          const event = queue.shift();
          if (event === undefined) {
            // A comment frame keeps proxies and load balancers from closing an idle stream, and
            // costs one line every fifteen seconds.
            await Promise.race([new Promise<void>((resolve_) => (notify = resolve_)), new Promise((resolve_) => setTimeout(resolve_, 15_000))]);
            notify = null;
            if (queue.length === 0 && !stream.closed) await stream.writeSSE({ event: "ping", data: String(Date.now()) });
            continue;
          }
          // Events replayed above may also be in the queue; the cursor is what makes this idempotent.
          if (event.seq <= cursor) continue;
          await stream.writeSSE({ id: String(event.seq), event: event.type, data: JSON.stringify(eventView(event)) });
          cursor = event.seq;
        }
      } finally {
        unsubscribe();
      }
    });
  });

  // Paging over the event log, for anything that wants history without a stream.
  app.get(routes.eventsHistory, async (c) => {
    const q = parseQuery(c, EventStreamQuerySchema);
    if (!q.ok) return q.response;
    const events = await deps.store.listEvents({
      ...(q.value.after === undefined ? {} : { afterSeq: q.value.after }),
      ...(q.value.run === undefined ? {} : { runId: q.value.run }),
      ...(q.value.project === undefined ? {} : { projectId: q.value.project }),
      ...(q.value.study === undefined ? {} : { simulationId: q.value.study }),
      limit: 500,
    });
    return c.json(page(events.map(eventView), undefined, 500));
  });
}

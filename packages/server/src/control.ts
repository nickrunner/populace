import {
  AddStarterBodySchema,
  CohortInputSchema,
  CompareQuerySchema,
  EventStreamQuerySchema,
  GeneratePeopleBodySchema,
  KillSwitchBodySchema,
  PersonaInputSchema,
  PersonPatchSchema,
  PopulationCreateSchema,
  PopulationInputSchema,
  ProjectInputSchema,
  SettingsInputSchema,
  SignInQuerySchema,
  SignInStartBodySchema,
  SimulationInputSchema,
  StartExecutionBodySchema,
  StopRunBodySchema,
  SweepBodySchema,
  TargetInputSchema,
  TriageInputSchema,
  routes,
  type ParticipantLive,
  type CohortView,
  type IdentityConfigInput,
  type IdentityConfigView,
  type PersonaView,
  type PersonView,
  type PopulationView,
  type ProjectView,
  type RunLive,
  type SettingsView,
  type SetupStatus,
  type StoredTargetView,
} from "@populace/contract";
import {
  blockedBecause,
  effectiveToolPolicy,
  expandPopulation,
  firstContactWorked,
  handleFor,
  isToolPermitted,
  instantiatePersona,
  nameFrom,
  newCohortId,
  newPersonaId,
  newPopulationId,
  newProjectId,
  newTargetId,
  normalizeEndpointUrl,
  slugify,
  tagForRun,
  ReferencedError,
  StoredTargetSchema,
  type Agent,
  type Cohort,
  type Event,
  type IdentityConfig,
  type McpEndpoint,
  type Person,
  type PopulaceConfig,
  type Project,
  type Simulation,
  type StoredPersona,
  type StoredPopulation,
  type StoredTarget,
  type TraceEvent,
  type Triage,
} from "@populace/core";
import { identityProviderFor } from "@populace/adapters";
import { buildDigest, verifyPending } from "@populace/reports";
import { finishSignIn, personaSystemPrompt, startSignIn } from "@populace/runner";
import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { ensureRoster } from "./cohort-store.js";
import { generatePeople, type GenerateOptions, type GeneratedRoster } from "./people-writer.js";
import {
  ConfigIncomplete,
  cohortsOf,
  cohortsOfPopulation,
  createSimulation,
  ensurePopulation,
  ensureSettings,
  ensureSimulation,
  resolveSimulationConfig,
  removePersonaCohorts,
  setCohortSize,
  type ResolvedSimulation,
} from "./config-store.js";
import { estimateRun } from "./estimate.js";
import { needsOf } from "./needs.js";
import { fail, page, param, parseBody, parseQuery } from "./http.js";
import type { JobHandler, JobReport, JobSpend } from "./jobs.js";
import { ProjectReadModel } from "./project-read-model.js";
import { ReadModel } from "./read-model.js";
import { STARTER_PERSONAS, starterBySlug } from "./starters.js";
import { checkPromises, checkTarget, type CheckCredentials } from "./target-check.js";
import { callbackPage, callbackUri, isAddress, pendingFor, providerFor, signInStatus, statusOf } from "./sign-in.js";
import { firstContact } from "./first-contact.js";
import { resetTarget } from "./target-reset.js";
import { targetView as liveTargetView } from "./target.js";
import type { ControlDeps } from "./deps.js";

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
      askAboutSignIn: (endpoint) => signInStatus(deps.store, projectId, endpoint.url, { probe: true }),
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

  // ---- projects -----------------------------------------------------------

  app.get(routes.projects, async (c) => c.json({ items: await projects.listProjects(), nextCursor: null }));

  app.post(routes.projects, async (c) => {
    const body = await parseBody(c, ProjectInputSchema);
    if (!body.ok) return body.response;
    const taken = new Set((await deps.store.listProjects()).map((p) => p.slug));
    const base = body.value.slug ?? (slugify(body.value.name) || "project");
    if (!/^[a-z0-9][a-z0-9-]*$/.test(base)) return fail(c, "bad_request", "a project needs a name that makes a slug, or an explicit one");
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
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
   * them. Archiving is the right answer for a SIMULATION, whose executions are history worth
   * keeping under a name; a project is the scope that history lives in, and a user deleting one
   * is saying they want the scope gone.
   *
   * `?archive=1` keeps the old behaviour for a caller that wants the row hidden and kept.
   *
   * A running execution is the one refusal. Its process is mid-wake against somebody else's
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

  app.get(routes.projectSetup(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const projectId = s.project.id;
    const target = (await deps.store.listTargets(projectId))[0];
    const personas = await deps.store.listPersonas(projectId);
    // A project that CAN run has something to run. A simulation row is otherwise created only by a
    // YAML import or by an explicit POST, so a project set up entirely in the browser reached
    // `ready: true` with no simulation and its go button posted to `/simulations//runs` — a 404.
    //
    // KNOWN WART, deliberately left: this is a GET that writes a row, which is wrong, and it is
    // not the only one (`GET /populations` calls `ensurePopulation` for the same sort of reason).
    // Removing it costs more than it saves today: the first-run panel's cost estimate is keyed by
    // simulation id, so with no row there is no estimate, and "3 people × 4 visits ≈ $1.44" is the
    // most useful sentence on that step. The fix is an estimate that takes a target and a
    // population rather than a simulation, and it belongs with that change, not here. The panel
    // below no longer DEPENDS on this having happened — it creates the simulation itself when
    // there is none — so this is now a convenience rather than the only path.
    if (target) {
      try {
        await ensureSimulation(deps.store, projectId);
      } catch (err) {
        if (!(err instanceof ConfigIncomplete)) throw err;
      }
    }
    const simulations = await deps.store.listSimulations({ projectId });
    const peopleCount = (await cohortsOf(deps.store, projectId)).reduce((sum, cohort) => sum + cohort.size, 0);
    const killSwitch = await deps.store.getKillSwitch();
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
    // advisory need — an unchecked target, an empty population nothing runs — must not close it.
    const blockers = needs.filter((need) => need.blocking).map((need) => need.sentence);
    const runs = await deps.store.listRuns({ projectId });
    const running = new Set(deps.runs.runningIds);
    const status: SetupStatus = {
      ready: blockers.length === 0,
      blockers,
      needs,
      targetId: target?.id ?? null,
      personaCount: personas.length,
      peopleCount,
      hasApiKey: deps.hasApiKey(),
      killSwitch,
      runningRunIds: runs.filter((run) => running.has(run.id)).map((run) => run.id),
      simulationIds: simulations.map((simulation) => ({ id: simulation.id, slug: simulation.slug, name: simulation.name })),
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
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    const target: StoredTarget = {
      id: newTargetId(),
      projectId: s.project.id,
      slug,
      name: body.value.name,
      mcp: mergeEndpoints(body.value.mcp, []),
      ...(body.value.webBaseUrl ? { webBaseUrl: body.value.webBaseUrl } : {}),
      ...(body.value.description ? { description: body.value.description } : {}),
      identity: mergeIdentity(body.value.identity, undefined),
      tools: body.value.tools ?? { allow: [], deny: [], destructive: "confirm" },
      firstContact: null,
      reset: { kind: "none" },
      createdAt: at,
      updatedAt: at,
    };
    await deps.store.saveTarget(target);
    return c.json(targetView(target), 201);
  });

  /** A draft target the wizard has not saved yet. Declared before `/targets/:t`. */
  app.post(routes.targetsCheck(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const body = await parseBody(c, TargetInputSchema.pick({ mcp: true }).extend({ identity: TargetInputSchema.shape.identity.optional() }));
    if (!body.ok) return body.response;
    return c.json(await checkTarget(mergeEndpoints(body.value.mcp, []), body.value.identity, await asTheUser(c, s.project.id)));
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
    // A simulation still pointing at it is a refusal that names the simulation, not a 500 (SPEC
    // §2.14): the user is being told which thing to take apart first.
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
    const simulation = (await deps.store.listSimulations({ projectId: s.project.id, targetId: target.id }))[0];
    if (!simulation) return fail(c, "conflict", "a target is reset through a simulation, and no simulation points at this one yet");
    const job = await deps.jobs.enqueue(
      "target.reset",
      async () => {
        const { config } = await resolveSimulationConfig(deps.store, deps.processConfig, simulation.id);
        // No run: a reset somebody asked for by hand belongs to the PROJECT, and stamping it as
        // such is what keeps "I put the target back" on `GET /events?project=…` rather than on a
        // stream nothing can match.
        await resetTarget(deps.store, config, { runId: null, projectId: s.project.id, simulationId: simulation.id });
        return undefined;
      },
      { projectId: s.project.id, label: `putting ${target.name} back` },
    );
    return c.json(job, 202);
  });

  // ---- personas -----------------------------------------------------------

  const memberCountOf = async (projectId: string, personaId: string): Promise<number> =>
    (await cohortsOf(deps.store, projectId)).find((cohort) => cohort.personaId === personaId)?.size ?? 0;

  const personaView = async (persona: StoredPersona): Promise<PersonaView> => ({
    id: persona.id,
    projectId: persona.projectId,
    slug: persona.slug,
    spec: persona.spec,
    origin: persona.origin,
    updatedAt: persona.updatedAt,
    count: await memberCountOf(persona.projectId, persona.id),
  });

  // Declared before `/personas/:x` so the literal path is not eaten by the parameter.
  app.get(routes.personaStarters(":p"), (c) => c.json({ items: STARTER_PERSONAS.map((s) => ({ slug: s.slug, name: s.spec.name, role: s.spec.role, summary: s.summary })), nextCursor: null }));

  /** Copies a starter into this project and puts it in the population in one step. */
  app.post(routes.personaStarters(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const body = await parseBody(c, AddStarterBodySchema);
    if (!body.ok) return body.response;
    const starter = starterBySlug(body.value.slug);
    if (!starter) return fail(c, "not_found", `no starter called ${body.value.slug}`);
    const at = now();
    const existing = (await deps.store.listPersonas(s.project.id)).find((p) => p.slug === starter.slug);
    const persona: StoredPersona = existing ?? { id: newPersonaId(), projectId: s.project.id, slug: starter.slug, spec: starter.spec, origin: "starter", createdAt: at, updatedAt: at };
    if (!existing) await deps.store.savePersona(persona);
    // The default population, explicitly. Adopting a starter is the first-run path and there is
    // one population then; a project with several composes them on the Populations screen.
    await setCohortSize(deps.store, await ensurePopulation(deps.store, s.project.id), persona, body.value.count);
    return c.json(await personaView(persona), existing ? 200 : 201);
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
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return fail(c, "bad_request", "a person needs a name that makes a slug, or an explicit one");
    if ((await deps.store.listPersonas(s.project.id)).some((p) => p.slug === slug)) return fail(c, "conflict", `there is already someone called ${slug} here`);
    const at = now();
    const persona: StoredPersona = { id: newPersonaId(), projectId: s.project.id, slug, spec: { ...body.value.spec, id: slug }, origin: "authored", createdAt: at, updatedAt: at };
    await deps.store.savePersona(persona);
    await setCohortSize(deps.store, await ensurePopulation(deps.store, s.project.id), persona, 1);
    return c.json(await personaView(persona), 201);
  });

  app.get(routes.persona(":p", ":x"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const persona = owned(await deps.store.getPersona(param(c, "x")), s.project.id);
    return persona ? c.json(await personaView(persona)) : fail(c, "not_found", "no such person");
  });

  app.put(routes.persona(":p", ":x"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const existing = owned(await deps.store.getPersona(param(c, "x")), s.project.id);
    if (!existing) return fail(c, "not_found", "no such person");
    const body = await parseBody(c, PersonaInputSchema);
    if (!body.ok) return body.response;
    // The slug is immutable and the spec's id follows it, whatever the body says. Agent ids are
    // built from a cohort slug and continuations match on the persona's, so a slug that moved
    // would silently break them — the one thing this product cannot afford to get wrong.
    const updated: StoredPersona = { ...existing, spec: { ...body.value.spec, id: existing.slug }, origin: existing.origin === "starter" ? "authored" : existing.origin, updatedAt: now() };
    await deps.store.savePersona(updated);
    return c.json(await personaView(updated));
  });

  app.delete(routes.persona(":p", ":x"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const persona = owned(await deps.store.getPersona(param(c, "x")), s.project.id);
    if (!persona) return c.body(null, 204);
    // Check first, mutate second (SPEC §2.14). `setCohortSize(..., 0)` finds ONE cohort, so a
    // persona backing two of them used to have the first deleted — people archived and all — and
    // then `deletePersona` refused because the second still named it: a half-applied destructive
    // change and a 500. A refusal that names the referrers is what the rule asks for.
    const referrers = (await deps.store.listCohorts(s.project.id)).filter((cohort) => cohort.personaId === persona.id);
    if (referrers.length > 1) {
      return fail(c, "conflict", `${persona.spec.name} is the persona behind ${referrers.length} cohorts (${referrers.map((cohort) => cohort.slug).join(", ")}); take those apart first`);
    }
    // Every population that holds a cohort on this persona lets go, then the cohorts go. Doing
    // this against ONE population left the cohort in every other population that held it, and
    // `deletePersona` then refused because a cohort still named it.
    await removePersonaCohorts(deps.store, s.project.id, persona);
    try {
      await deps.store.deletePersona(persona.id);
    } catch (err) {
      if (err instanceof ReferencedError) return fail(c, "conflict", err.message);
      throw err;
    }
    return c.body(null, 204);
  });

  /**
   * The system prompt this persona would produce, rendered by the runner's own code rather than
   * by a second copy of it: a preview that drifts from what the model is actually given is worse
   * than no preview at all (product judge gap #6).
   */
  app.post(routes.personaPreview(":p", ":x"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const persona = owned(await deps.store.getPersona(param(c, "x")), s.project.id);
    if (!persona) return fail(c, "not_found", "no such person");
    /*
      A prompt preview is a preview OF A TARGET: the system prompt carries the target's own
      description and its tool list, so which target it is changes what comes back. Picking
      `listTargets[0]` meant the preview silently described whichever target was edited last.
      `?target=` says which; one target still defaults; several without it is a refusal that names
      them, exactly as `POST /simulations` does.
    */
    const targets = await deps.store.listTargets(s.project.id);
    const asked = c.req.query("target");
    if (asked === undefined && targets.length > 1) {
      return fail(c, "bad_request", `this project has ${targets.length} targets and a preview is of one of them — add ?target= : ${targets.map((t) => `${t.name} (${t.id})`).join(", ")}`);
    }
    const target = asked === undefined ? targets[0] : targets.find((t) => t.id === asked || t.slug === asked);
    if (asked !== undefined && !target) return fail(c, "not_found", `no target called ${asked} in this project`);
    const seed = `preview:${persona.slug}:0`;
    const agent: Agent = {
      id: `preview/${persona.slug}#1`,
      runId: "preview",
      simulationId: "preview",
      populationId: "preview",
      cohortSlug: persona.slug,
      personId: `${persona.slug}#1`,
      name: "Sample Person",
      details: "",
      handle: `${persona.slug}-1`,
      persona: instantiatePersona({ ...persona.spec, id: persona.slug }, seed),
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
    const text = personaSystemPrompt(agent, {
      name: target?.name ?? "the target",
      mcp: target?.mcp ?? [],
      ...(target?.webBaseUrl ? { webBaseUrl: target.webBaseUrl } : {}),
      ...(target?.description ? { description: target.description } : {}),
      tools: target?.tools ?? { allow: [], deny: [], destructive: "confirm" },
      reset: target?.reset ?? { kind: "none" },
    });
    return c.json({ personaSlug: persona.slug, text });
  });

  // ---- cohorts and people -------------------------------------------------

  const cohortView = async (projectId: string, cohort: Cohort): Promise<CohortView> => {
    const [persona, people, populations] = await Promise.all([deps.store.getPersona(cohort.personaId), deps.store.listPeople({ cohortId: cohort.id, includeArchived: true }), deps.store.listPopulations(projectId)]);
    const live = people.filter((p) => p.ordinal < cohort.size);
    return {
      id: cohort.id,
      slug: cohort.slug,
      name: cohort.name,
      personaId: cohort.personaId,
      personaName: persona?.spec.name ?? cohort.name,
      size: cohort.size,
      generated: {
        model: live.filter((p) => p.generatedBy === "model").length,
        seeded: live.filter((p) => p.generatedBy === "seeded").length,
        authored: live.filter((p) => p.generatedBy === "authored").length,
      },
      cadence: cohort.cadence ?? null,
      // The row spells it `maxWakes`; the wire does not (ADR-0032).
      maxVisits: cohort.maxWakes ?? null,
      notes: cohort.notes,
      usedByPopulations: populations.filter((pop) => pop.cohortIds.includes(cohort.id)).map((pop) => ({ id: pop.id, name: pop.name })),
    };
  };

  const personView = (person: Person, size: number): PersonView => ({
    id: person.id,
    ordinal: person.ordinal,
    name: person.name,
    details: person.details,
    handle: person.handle,
    generatedBy: person.generatedBy,
    patience: person.persona.patience,
    budgetUsd: person.persona.budgetUsd,
    traits: person.persona.traits,
    archived: person.archivedAt !== null || person.ordinal >= size,
  });

  /**
   * Writing people is refused while anything is executing. A live run is reading this cast through
   * its config snapshot and signing accounts up from these handles; re-casting underneath it would
   * leave that run's own participants unexplainable.
   */
  const refuseWhileRunning = async (projectId: string, cohortName: string): Promise<string | null> => {
    const live = [...(await deps.store.listRuns({ projectId, status: "running" })), ...(await deps.store.listRuns({ projectId, status: "pending" }))];
    return live.length === 0 ? null : `${live.length} execution(s) are reading these people right now; pause or stop them before writing the ${cohortName} cohort`;
  };

  /**
   * The `people.generate` handler. Tier 1 fills every empty slot for free before a token is spent,
   * so this succeeds with a complete cast even when there is no API key — what the model adds is
   * names and individuating details, and what it cannot do is leave a cohort half-cast.
   */
  const runWriter = async (cohortId: string, options: GenerateOptions, report: JobReport, spend: JobSpend): Promise<GeneratedRoster> => {
    const generated = await generatePeople({ store: deps.store, ...(deps.provider ? { provider: deps.provider } : {}), report, spend }, cohortId, options);
    await report({ label: generated.fellBackBecause ?? `wrote ${generated.written} of ${generated.written + generated.seeded}` });
    return generated;
  };

  const writePeople =
    (cohortId: string, options: GenerateOptions = {}): JobHandler =>
    async (_job, report, spend) => {
      await runWriter(cohortId, options, report, spend);
      return undefined;
    };

  app.get(routes.cohorts(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const cohorts = await deps.store.listCohorts(s.project.id);
    return c.json({ items: await Promise.all(cohorts.map((cohort) => cohortView(s.project.id, cohort))), nextCursor: null });
  });

  app.post(routes.cohorts(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const body = await parseBody(c, CohortInputSchema);
    if (!body.ok) return body.response;
    const persona = body.value.personaId === undefined ? undefined : owned(await deps.store.getPersona(body.value.personaId), s.project.id);
    if (!persona) return fail(c, "bad_request", "a cohort is N people on one persona; name the persona");
    const taken = new Set((await deps.store.listCohorts(s.project.id)).map((cohort) => cohort.slug));
    const base = body.value.slug ?? (slugify(body.value.name ?? persona.spec.name) || "cohort");
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    const at = now();
    const cohort: Cohort = {
      id: newCohortId(),
      projectId: s.project.id,
      slug,
      name: body.value.name ?? persona.spec.name,
      personaId: persona.id,
      size: body.value.size ?? 1,
      seed: body.value.seed ?? "populace",
      notes: body.value.notes ?? "",
      ...(body.value.cadence ? { cadence: body.value.cadence } : {}),
      ...(body.value.maxVisits === undefined || body.value.maxVisits === null ? {} : { maxWakes: body.value.maxVisits }),
      createdAt: at,
      updatedAt: at,
    };
    await deps.store.saveCohort(cohort);
    // The cast is written on the way in, so a cohort created here reads back with its people
    // rather than with an empty roster nobody asked to fill. Tier 1 is seeded, free and offline.
    await ensureRoster(deps.store, cohort.id);
    if (body.value.inPopulation !== false) {
      const population = await ensurePopulation(deps.store, s.project.id);
      await deps.store.savePopulation({ ...population, cohortIds: [...population.cohortIds, cohort.id], updatedAt: at });
    }
    return c.json(await cohortView(s.project.id, cohort), 201);
  });

  app.get(routes.cohort(":p", ":c"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const cohort = owned(await deps.store.getCohort(param(c, "c")), s.project.id);
    if (!cohort) return fail(c, "not_found", "no such cohort");
    // On first read of a cohort (SPEC §5.1): `generated` counts people, and counting rows nobody
    // has written yet reports a cohort of twelve as nought of anything.
    await ensureRoster(deps.store, cohort.id);
    return c.json(await cohortView(s.project.id, cohort));
  });

  app.put(routes.cohort(":p", ":c"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const existing = owned(await deps.store.getCohort(param(c, "c")), s.project.id);
    if (!existing) return fail(c, "not_found", "no such cohort");
    const body = await parseBody(c, CohortInputSchema);
    if (!body.ok) return body.response;
    // The slug is immutable: it is the middle segment of every agent id and the first segment of
    // every person id, so renaming it would orphan memory and silently empty a continuation.
    const updated: Cohort = { ...existing, name: body.value.name ?? existing.name, size: body.value.size ?? existing.size, seed: body.value.seed ?? existing.seed, notes: body.value.notes ?? existing.notes, updatedAt: now() };
    if (body.value.cadence === null) delete updated.cadence;
    else if (body.value.cadence !== undefined) updated.cadence = body.value.cadence;
    if (body.value.maxVisits === null) delete updated.maxWakes;
    else if (body.value.maxVisits !== undefined) updated.maxWakes = body.value.maxVisits;
    await deps.store.saveCohort(updated);
    // Shrinking puts people aside rather than deleting them, so growing back meets the same cast.
    await ensureRoster(deps.store, updated.id);
    if (body.value.inPopulation !== undefined) {
      const population = await ensurePopulation(deps.store, s.project.id);
      const ids = body.value.inPopulation ? [...new Set([...population.cohortIds, updated.id])] : population.cohortIds.filter((id) => id !== updated.id);
      await deps.store.savePopulation({ ...population, cohortIds: ids, updatedAt: now() });
    }
    return c.json(await cohortView(s.project.id, updated));
  });

  app.delete(routes.cohort(":p", ":c"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const cohort = owned(await deps.store.getCohort(param(c, "c")), s.project.id);
    if (!cohort) return fail(c, "not_found", "no such cohort");
    // The population lets go first: the store refuses to delete a cohort a population still holds,
    // and naming the referrer is the point of that refusal (SPEC §2.14).
    for (const population of await deps.store.listPopulations(s.project.id)) {
      if (!population.cohortIds.includes(cohort.id)) continue;
      await deps.store.savePopulation({ ...population, cohortIds: population.cohortIds.filter((id) => id !== cohort.id), updatedAt: now() });
    }
    await deps.store.deleteCohort(cohort.id);
    return c.body(null, 204);
  });

  app.get(routes.cohortPeople(":p", ":c"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const cohort = owned(await deps.store.getCohort(param(c, "c")), s.project.id);
    if (!cohort) return fail(c, "not_found", "no such cohort");
    // The roster is materialised on read (SPEC §5.1), not only on a size change: a cohort created
    // through the API otherwise answers `{ items: [] }` until somebody posts the generate job.
    await ensureRoster(deps.store, cohort.id);
    const roster = await deps.store.listPeople({ cohortId: cohort.id, includeArchived: true });
    return c.json({ items: roster.map((person) => personView(person, cohort.size)), nextCursor: null });
  });

  /**
   * Fills the slots nobody has written yet. A job, because tier 2 — a model writing them — is a
   * model call, and it is the first model call this product makes outside a wake (SPEC §5.4).
   */
  app.post(routes.cohortPeople(":p", ":c"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const cohort = owned(await deps.store.getCohort(param(c, "c")), s.project.id);
    if (!cohort) return fail(c, "not_found", "no such cohort");
    const refusal = await refuseWhileRunning(s.project.id, cohort.name);
    if (refusal) return fail(c, "conflict", refusal);
    const job = await deps.jobs.enqueue("people.generate", writePeople(cohort.id), { projectId: s.project.id, label: `writing the ${cohort.name} cohort` });
    return c.json(job, 202);
  });

  /**
   * Regeneration REPLACES people who already exist, which is why it needs `confirm`. Writing over
   * a cast that past executions name is the one destructive thing in the people model.
   */
  app.post(routes.cohortPeopleRegenerate(":p", ":c"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const cohort = owned(await deps.store.getCohort(param(c, "c")), s.project.id);
    if (!cohort) return fail(c, "not_found", "no such cohort");
    const body = await parseBody(c, GeneratePeopleBodySchema);
    if (!body.ok) return body.response;
    // A refusal, not a conflict: nothing about the cohort's state makes this impossible, the
    // request is simply missing the acknowledgement that it rewrites who these people are and
    // breaks comparison with every execution that already named them.
    if (!body.value.confirm) return fail(c, "bad_request", "re-casting changes who these people are and breaks comparison with earlier executions; send confirm: true");
    const refusal = await refuseWhileRunning(s.project.id, cohort.name);
    if (refusal) return fail(c, "conflict", refusal);
    const ordinals = body.value.ordinals;
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
        const roster = await deps.store.listPeople({ cohortId: cohort.id, includeArchived: true });
        const recast = roster.filter((person) => person.ordinal < cohort.size && (ordinals === undefined || ordinals.includes(person.ordinal)));
        const used = new Set(roster.filter((person) => !recast.includes(person)).map((person) => person.name));
        for (const person of recast) {
          const name = nameFrom(person.seed, used);
          used.add(name);
          // The handle follows the name here, unlike a hand rename: re-casting is refused while
          // anything is running, so nobody has signed an account up as this person yet.
          await deps.store.savePerson({ ...person, name, handle: handleFor(name, cohort.slug, person.ordinal), details: "", generatedBy: "seeded", generatedByModel: "", archivedAt: null, updatedAt: at });
        }
        const generated = await runWriter(cohort.id, ordinals ? { ordinals } : {}, report, spend);
        // A confirmed re-cast that wrote nobody is a failure, not a quiet success: the cast the
        // user asked to replace is gone and what stands in its place is the free one.
        if (generated.written === 0 && generated.fellBackBecause !== null) throw new Error(`nobody was re-cast: ${generated.fellBackBecause}`);
        return undefined;
      },
      { projectId: s.project.id, label: `re-casting the ${cohort.name} cohort` },
    );
    return c.json(job, 202);
  });

  /** The escape hatch: one person, renamed or re-blurbed by hand. */
  app.patch(routes.cohortPerson(":p", ":c", ":ordinal"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const cohort = owned(await deps.store.getCohort(param(c, "c")), s.project.id);
    if (!cohort) return fail(c, "not_found", "no such cohort");
    const body = await parseBody(c, PersonPatchSchema);
    if (!body.ok) return body.response;
    const ordinal = Number.parseInt(param(c, "ordinal"), 10);
    const person = (await deps.store.listPeople({ cohortId: cohort.id, includeArchived: true })).find((p) => p.ordinal === ordinal);
    if (!person) return fail(c, "not_found", "nobody at that place in the cohort");
    // The handle is NOT re-derived from a new name: it is what the account on the target was
    // signed up with, and a rename must not orphan it (SPEC §5.3.5).
    //
    // And the row is stamped `authored`, which is what takes it out of the writer's reach. A
    // rename that left it looking like a placeholder — seeded, no details — would be handed
    // straight back to the next generate, which would overwrite the typed name AND re-derive the
    // handle this line just refused to move.
    const updated: Person = { ...person, name: body.value.name ?? person.name, details: body.value.details ?? person.details, generatedBy: "authored", updatedAt: now() };
    await deps.store.savePerson(updated);
    return c.json(personView(updated, cohort.size));
  });

  // ---- populations and settings -------------------------------------------

  /**
   * The simulations that run this population. The execution plan — how often people come back, how
   * many visits each gets, the jitter seed — lives on THEM (SPEC §2.6), so the composition screen
   * reads it from there and writes it back there. Settings are only the defaults a NEW simulation
   * is created with.
   */

  const populationView = async (projectId: string, population: StoredPopulation): Promise<PopulationView> => {
    const cohorts = await cohortsOfPopulation(deps.store, population);
    const personas = new Map((await deps.store.listPersonas(projectId)).map((p) => [p.id, p]));
    // `seed`, `cadence` and `maxWakes` used to be reported here, read off the first simulation
    // running this population and falling back to the project settings. They are not properties
    // of a composition — see `PopulationInputSchema` — and reporting them made a population look
    // like it owned a schedule and a visit cap that actually belong to a cohort and a simulation.
    return {
      id: population.id,
      slug: population.slug,
      name: population.name,
      members: cohorts.map((cohort) => {
        const persona = personas.get(cohort.personaId);
        return {
          cohortId: cohort.id,
          cohort: cohort.slug,
          cohortName: cohort.name,
          personaId: cohort.personaId,
          slug: persona?.slug ?? cohort.slug,
          name: persona?.spec.name ?? cohort.name,
          count: cohort.size,
          maxVisits: cohort.maxWakes ?? null,
        };
      }),
    };
  };

  app.get(routes.populations(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    await ensurePopulation(deps.store, s.project.id);
    const populations = await deps.store.listPopulations(s.project.id);
    return c.json({ items: await Promise.all(populations.map((population) => populationView(s.project.id, population))), nextCursor: null });
  });

  app.post(routes.populations(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const body = await parseBody(c, PopulationCreateSchema);
    if (!body.ok) return body.response;
    const at = now();
    const taken = new Set((await deps.store.listPopulations(s.project.id)).map((pop) => pop.slug));
    const base = body.value.slug ?? (slugify(body.value.name) || "population");
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    const population: StoredPopulation = { id: newPopulationId(), projectId: s.project.id, slug, name: body.value.name, cohortIds: [], createdAt: at, updatedAt: at };
    await deps.store.savePopulation(population);
    return c.json(await populationView(s.project.id, population), 201);
  });

  const populationOf = async (c: Context, projectId: string): Promise<StoredPopulation | undefined> => owned(await deps.store.getPopulation(param(c, "pop")), projectId);

  app.get(routes.population_(":p", ":pop"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const population = await populationOf(c, s.project.id);
    return population ? c.json(await populationView(s.project.id, population)) : fail(c, "not_found", "no such population");
  });

  app.put(routes.population_(":p", ":pop"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const population = await populationOf(c, s.project.id);
    if (!population) return fail(c, "not_found", "no such population");
    const body = await parseBody(c, PopulationInputSchema);
    if (!body.ok) return body.response;
    const personas = new Map((await deps.store.listPersonas(s.project.id)).map((p) => [p.id, p]));
    const unknown = (body.value.members ?? []).filter((m) => !personas.has(m.personaId)).map((m) => m.personaId);
    if (unknown.length) return fail(c, "bad_request", `no such person: ${unknown.join(", ")}`);

    /*
      A population is composition and NOTHING else (ADR-0029), and this handler used to write
      three things that are not composition: `seed`, `cadence` and `maxWakes` went to the project
      settings row and were then fanned onto every simulation running this population.

      The fan-out was not a bug in itself — writing only to settings made "lower the visit cap to
      one" answer 200 and change nothing, and the fan-out is what fixed that. The bug is that
      those fields are on a population at all. The visit cap decides the MODE (`visits === null ?
      "longitudinal" : "ephemeral"`), so editing a population could flip a simulation between
      ephemeral and longitudinal — an ADR-0030 property of the simulation, changed from a screen
      that never says the word mode, for every simulation on that population at once.

      Both halves go together. The fields are off `PopulationInput`, the fan-out is gone with
      them, and the cap and the mode are set where they belong: on the simulation, by the
      simulation editor.
    */

    // `cohortIds`, when sent, IS the composition — the whole ordered set, add and remove in one.
    if (body.value.cohortIds) {
      const known = new Set((await deps.store.listCohorts(s.project.id)).map((cohort) => cohort.id));
      const strangers = body.value.cohortIds.filter((id) => !known.has(id));
      if (strangers.length) return fail(c, "bad_request", `no such cohort: ${strangers.join(", ")}`);
      await deps.store.savePopulation({ ...population, cohortIds: [...body.value.cohortIds], updatedAt: now() });
    }

    // The member list REPLACES what is there when it is sent at all. The browser drops a persona
    // from the array rather than sending `count: 0`, so a handler that only walked the array left
    // the cohort at its old size and the stepper snapped back.
    if (body.value.members) {
      const sent = new Set(body.value.members.map((m) => m.personaId));
      // Re-read: `cohortIds` above may have just changed what this population holds.
      const current = (await deps.store.getPopulation(population.id)) ?? population;
      for (const cohort of await cohortsOfPopulation(deps.store, current)) {
        const persona = personas.get(cohort.personaId);
        if (persona && !sent.has(cohort.personaId)) {
          await setCohortSize(deps.store, (await deps.store.getPopulation(population.id)) ?? current, persona, 0);
        }
      }
      for (const member of body.value.members) {
        const persona = personas.get(member.personaId);
        if (!persona) continue;
        const fresh = (await deps.store.getPopulation(population.id)) ?? current;
        await setCohortSize(deps.store, fresh, persona, member.count, member.maxVisits);
      }
    }
    const after = (await deps.store.getPopulation(population.id)) ?? population;
    return c.json(await populationView(s.project.id, after));
  });

  app.delete(routes.population_(":p", ":pop"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const population = await populationOf(c, s.project.id);
    if (!population) return fail(c, "not_found", "no such population");
    /*
      The last one does not go, and neither does the default.

      `ensurePopulation` resolves the row whose slug is `everyone` and falls back to
      `populations[0]` when there is none (`config-store.ts`). Five surfaces lean on it — the
      setup status, the persona-keyed composition path, `cohortsOf`, `ensureSimulation` and the
      first-run panel — so deleting the default silently retargets every one of them at whichever
      population happens to be first, and deleting the last one leaves them creating a fresh empty
      "Everyone" behind the reader's back. Neither is a thing a Remove button should be able to do
      quietly, and the Populations screen puts a Remove button on exactly this row.

      A project always has somewhere for a cohort to go. Rename it if you do not like the name.
    */
    const all = await deps.store.listPopulations(s.project.id);
    if (all.length <= 1) {
      return fail(c, "conflict", `${population.name} is the only population in ${s.project.name}; a project keeps one. Compose another first, or empty this one.`);
    }
    /*
      Asked the way `ensurePopulation` answers it, not by comparing the slug. The default is the
      row slugged `everyone` OR, when there is none — which is every YAML-seeded project, since an
      import names its population whatever the file says — `populations[0]`. A slug comparison
      guards the first case and misses the second entirely, which is the case a real install is
      most likely to be in.
    */
    const fallback = await ensurePopulation(deps.store, s.project.id);
    if (fallback.id === population.id) {
      return fail(c, "conflict", `${population.name} is this project's default population — new cohorts land in it, and anything that has not been told which cast to use reads it. Empty it instead, or make another the default by removing this one's cohorts.`);
    }
    // The store refuses a population a simulation still names, and naming the referrer is the
    // point of that refusal (SPEC §2.14). Uncaught it was a 500, which tells the user nothing.
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
    return { model, guardrails: settings.guardrails, verifier: settings.verifier, daemon: settings.daemon, hasApiKey: deps.hasApiKey(), updatedAt: settings.updatedAt };
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

  // ---- simulations ---------------------------------------------------------

  const simulationOf = async (c: Context, projectId: string): Promise<Simulation | undefined> => {
    const id = param(c, "s");
    const direct = await deps.store.getSimulation(id);
    if (direct && direct.projectId === projectId) return direct;
    return (await deps.store.listSimulations({ projectId, includeArchived: true })).find((simulation) => simulation.slug === id);
  };

  app.get(routes.simulations(":p"), async (c) => {
    const s = await scope(c);
    return s.ok ? c.json({ items: await projects.listSimulations(s.project.id), nextCursor: null }) : s.response;
  });

  app.post(routes.simulations(":p"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const body = await parseBody(c, SimulationInputSchema);
    if (!body.ok) return body.response;
    const settings = await ensureSettings(deps.store, s.project.id);
    const population = body.value.populationId ? owned(await deps.store.getPopulation(body.value.populationId), s.project.id) : await ensurePopulation(deps.store, s.project.id);
    if (!population) return fail(c, "bad_request", "that population is not in this project");

    /*
      **With several targets, say which. Do not guess.**

      This was `listTargets(projectId)[0]` — and `listTargets` orders `updated_at DESC`, so "the
      first" meant "whichever you edited last". A project with a dev and a qa endpoint got a
      simulation pointed at whichever of them had most recently been touched, silently, and the
      row froze that choice forever.

      One target still defaults, because with one there is nothing to choose and making every
      caller say so would be ceremony. Zero keeps the refusal it always had. Two or more without
      a `targetId` is a refusal that NAMES the choices, because a 400 saying "ambiguous" is a
      puzzle and a 400 listing the two targets is an answer. `SimulationInputSchema.targetId`
      stays optional, so this is a runtime refusal rather than a contract break.
    */
    const targets = await deps.store.listTargets(s.project.id);
    if (!body.value.targetId && targets.length > 1) {
      return fail(c, "bad_request", `this project has ${targets.length} targets — say which one this simulation visits: ${targets.map((t) => `${t.name} (${t.id})`).join(", ")}`);
    }
    const target = body.value.targetId ? owned(await deps.store.getTarget(body.value.targetId), s.project.id) : targets[0];
    if (!target) return fail(c, "conflict", "connect a target before making a simulation; a simulation names the target its runs go to");

    // Same rule for the cast. `ensurePopulation` above resolves the default, which is right while
    // there is one; with several, a simulation that does not say who goes is a guess about the
    // most expensive thing on the row.
    const populations = await deps.store.listPopulations(s.project.id);
    if (!body.value.populationId && populations.length > 1) {
      return fail(c, "bad_request", `this project has ${populations.length} populations — say which cast this simulation sends: ${populations.map((p) => `${p.name} (${p.id})`).join(", ")}`);
    }
    const taken = new Set((await deps.store.listSimulations({ projectId: s.project.id, includeArchived: true })).map((sim) => sim.slug));
    const base = body.value.slug ?? (slugify(body.value.name) || "simulation");
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    const simulation = await createSimulation(deps.store, {
      projectId: s.project.id,
      slug,
      name: body.value.name,
      ...(body.value.description === undefined ? {} : { description: body.value.description }),
      populationId: population.id,
      targetId: target.id,
      visitsPerPerson: body.value.visitsPerPerson === undefined ? settings.maxWakes : body.value.visitsPerPerson,
      cadence: { ...settings.cadence, ...body.value.cadence },
      seed: body.value.seed ?? settings.seed,
      ...(body.value.autoSweep === undefined ? {} : { autoSweep: body.value.autoSweep }),
      ...(body.value.requireFreshTarget === undefined ? {} : { requireFreshTarget: body.value.requireFreshTarget }),
    });
    return c.json(await projects.simulationSummary(simulation), 201);
  });

  app.get(routes.simulation(":p", ":s"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const simulation = await simulationOf(c, s.project.id);
    return simulation ? c.json(await projects.simulationSummary(simulation)) : fail(c, "not_found", "no such simulation");
  });

  app.put(routes.simulation(":p", ":s"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const existing = await simulationOf(c, s.project.id);
    if (!existing) return fail(c, "not_found", "no such simulation");
    const body = await parseBody(c, SimulationInputSchema);
    if (!body.ok) return body.response;
    const visits = body.value.visitsPerPerson === undefined ? existing.visitsPerPerson : body.value.visitsPerPerson;
    // The same ownership check the POST makes. Taken raw, a simulation in project A could be
    // pointed at project B's target — and resolution looks a target up by id with no project
    // predicate, so the run would go to B's server carrying B's stored bearer token.
    if (body.value.populationId !== undefined && !owned(await deps.store.getPopulation(body.value.populationId), s.project.id)) {
      return fail(c, "bad_request", "that population is not in this project");
    }
    if (body.value.targetId !== undefined && !owned(await deps.store.getTarget(body.value.targetId), s.project.id)) {
      return fail(c, "bad_request", "that target is not in this project");
    }
    const updated: Simulation = {
      ...existing,
      name: body.value.name,
      description: body.value.description ?? existing.description,
      populationId: body.value.populationId ?? existing.populationId,
      targetId: body.value.targetId ?? existing.targetId,
      // The cap decides the mode, so the two can never disagree: a capped simulation ENDS and is
      // ephemeral, an uncapped one runs until somebody stops it and is longitudinal.
      mode: visits === null ? "longitudinal" : "ephemeral",
      visitsPerPerson: visits,
      cadence: { ...existing.cadence, ...body.value.cadence },
      seed: body.value.seed ?? existing.seed,
      autoSweep: body.value.autoSweep ?? existing.autoSweep,
      requireFreshTarget: body.value.requireFreshTarget ?? existing.requireFreshTarget,
      updatedAt: now(),
    };
    await deps.store.saveSimulation(updated);
    return c.json(await projects.simulationSummary(updated));
  });

  /**
   * Archived, not deleted: a simulation's executions are the user's history, so removing it from
   * the list leaves them exactly where they are. `?runs=delete` is the user having been shown how
   * many executions that is and said to take them too — then the simulation row goes as well, and
   * the archive path is never reached.
   */
  app.delete(routes.simulation(":p", ":s"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const simulation = await simulationOf(c, s.project.id);
    if (!simulation) return fail(c, "not_found", "no such simulation");
    const withRuns = c.req.query("runs") === "delete";
    if (withRuns) {
      const running = new Set(deps.runs.runningIds);
      const live = (await deps.store.listRuns({ simulationId: simulation.id })).filter((run) => running.has(run.id));
      if (live.length > 0) return fail(c, "conflict", `${simulation.name} is running; stop it first, and sweep if accounts were made`);
    }
    await deps.store.deleteSimulation(simulation.id, withRuns ? { withRuns: true } : {});
    return c.body(null, 204);
  });

  /** Resolves a simulation into the config a run would execute, or says what is missing. */
  const resolve = async (c: Context, simulation: Simulation): Promise<{ ok: true; value: ResolvedSimulation } | { ok: false; response: Response }> => {
    try {
      return { ok: true, value: await resolveSimulationConfig(deps.store, deps.processConfig, simulation.id) };
    } catch (err) {
      if (err instanceof ConfigIncomplete) return { ok: false, response: fail(c, "conflict", err.missing.join("; ")) };
      throw err;
    }
  };

  /** Pure arithmetic. It reads history and spends nothing; the estimate never starts a run. */
  app.post(routes.simulationEstimate(":p", ":s"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const simulation = await simulationOf(c, s.project.id);
    if (!simulation) return fail(c, "not_found", "no such simulation");
    const resolved = await resolve(c, simulation);
    if (!resolved.ok) return resolved.response;
    return c.json(await estimateRun(deps.store, { config: resolved.value.config }));
  });

  /** Who is going, what they will meet, and what one of them will actually be told. No spending. */
  app.get(routes.simulationPreflight(":p", ":s"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const simulation = await simulationOf(c, s.project.id);
    if (!simulation) return fail(c, "not_found", "no such simulation");
    const resolved = await resolve(c, simulation);
    if (!resolved.ok) return resolved.response;
    const { config } = resolved.value;
    const view = await liveTargetView(config);
    const [estimate, killSwitch] = await Promise.all([estimateRun(deps.store, { config }), deps.store.getKillSwitch()]);
    const first = expandPopulation(config.population, "preflight", simulation.id)[0];
    const blockers: string[] = [];
    if (!deps.hasApiKey()) blockers.push("Set ANTHROPIC_API_KEY before starting a run; the people are model calls.");
    if (killSwitch.engaged) blockers.push(`Everything is stopped${killSwitch.reason ? ` (${killSwitch.reason})` : ""}. Release it to start a run.`);
    if (simulation.requireFreshTarget && config.target.reset.kind === "none")
      blockers.push("This simulation insists on a fresh target, and the target declares no reset.");
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
    const cohorts = config.population.members.map((member) => ({
      label: member.cohortName || member.cohort,
      policy: effectiveToolPolicy(config.target.tools, member.persona.tools),
    }));
    // A self-signup target whose own policy blocks its sign-up tool is a dead configuration and it
    // is detectable without touching anything: nobody sent here could make an account, so every
    // wake would end auth-failed. First contact reports it too, but only once somebody has run
    // one, and this costs nothing to say up front.
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
      return [{ name: tool.name, who: shutOut.length === cohorts.length ? "everyone" : shutOut.map((cohort) => cohort.label).join(", "), why: `their persona's tool policy — ${why}` }];
    });

    return c.json(
      await projects.preflight(simulation, {
        estimate,
        tools: allowed.map((t) => ({ name: t.name, description: t.description })),
        blocked,
        // The TARGET's setting, not the strictest across the population: this is the target
        // section, and one cautious persona must not make the screen read "nobody may" for
        // everybody. A persona that tightens it further shows up in `blocked`.
        destructive: config.target.tools.destructive,
        firstContact: contact,
        toolsError: view.toolsError,
        promptPreview: first
          ? { personName: first.agent.name, cohortSlug: first.agent.cohortSlug, text: personaSystemPrompt(first.agent, config.target) }
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
  const startExecution = async (c: Context, simulation: Simulation, carryForwardFrom?: string): Promise<Response> => {
    const body = await parseBody(c, StartExecutionBodySchema);
    if (!body.ok) return body.response;
    if (!deps.hasApiKey()) return fail(c, "unavailable", "starting a run needs ANTHROPIC_API_KEY; the people are model calls");
    const resolved = await resolve(c, simulation);
    if (!resolved.ok) return resolved.response;
    const parent = carryForwardFrom ?? body.value.carryForwardFrom;
    if (parent !== undefined) {
      const parentRun = await deps.store.getRun(parent);
      if (!parentRun && (await deps.store.listAgents({ runId: parent })).length === 0) {
        return fail(c, "not_found", `no run ${parent} to carry on from`);
      }
      // A carry-forward copies the parent's memory and its ACCOUNTS onto this run's participants,
      // so the parent has to be an earlier execution of THIS simulation. Anything else seeds one
      // project's people with another's, and `reconcile` then silently drops every inherited agent
      // whose id is not in this population.
      if (parentRun && parentRun.simulationId !== simulation.id) {
        return fail(c, "conflict", `run ${parent} is an execution of a different simulation; carry it forward from its own`);
      }
      if (parentRun && parentRun.projectId !== simulation.projectId) {
        return fail(c, "not_found", `no run ${parent} to carry on from`);
      }
    }
    if (simulation.requireFreshTarget && resolved.value.config.target.reset.kind === "none") {
      return fail(c, "conflict", `${simulation.name} insists on a fresh target, and ${resolved.value.target.name} declares no reset`);
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
            projectId: simulation.projectId,
            simulationId: simulation.id,
            targetId: resolved.value.target.id,
            label,
            ...(parent === undefined ? {} : { continueFrom: parent, continuationReason: body.value.reason ?? "" }),
          },
          (wakes) => void report({ done: wakes, label: `${wakes} visit(s) done` }),
        );
        runId = run.id;
        snapshotId = run.configSnapshotId;
        return { runId: run.id };
      },
      { projectId: simulation.projectId, label: parent === undefined ? "starting the run" : "carrying the run on" },
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

  app.post(routes.simulationRuns(":p", ":s"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const simulation = await simulationOf(c, s.project.id);
    if (!simulation) return fail(c, "not_found", "no such simulation");
    return startExecution(c, simulation);
  });

  app.get(routes.simulationRuns(":p", ":s"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const simulation = await simulationOf(c, s.project.id);
    if (!simulation) return fail(c, "not_found", "no such simulation");
    return c.json({ items: await new ReadModel(deps.store).listRuns({ simulationId: simulation.id }), nextCursor: null });
  });

  app.post(routes.simulationApply(":p", ":s"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const simulation = await simulationOf(c, s.project.id);
    if (!simulation) return fail(c, "not_found", "no such simulation");
    const live = (await deps.store.listRuns({ simulationId: simulation.id })).find((run) => run.status === "running" || run.status === "pending");
    if (!live) return fail(c, "conflict", "nothing is running, so there is nothing to apply the changes to; run it again instead");
    try {
      const run = await deps.runs.applyChanges(live.id);
      return c.json({ runId: run.id, configSnapshotId: run.configSnapshotId });
    } catch (err) {
      return fail(c, "conflict", err instanceof Error ? err.message : String(err));
    }
  });

  app.get(routes.simulationResults(":p", ":s"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const simulation = await simulationOf(c, s.project.id);
    if (!simulation) return fail(c, "not_found", "no such simulation");
    const latest = (await deps.store.listRuns({ simulationId: simulation.id })).sort((a, b) => a.seq - b.seq).at(-1);
    const coverage = latest ? await coverageOf(latest.id) : { items: [], exposedCount: 0, neverCalledCount: 0, toolsError: null };
    return c.json(await projects.results(simulation, coverage));
  });

  app.get(routes.simulationCluster(":p", ":s", ":sig"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const simulation = await simulationOf(c, s.project.id);
    if (!simulation) return fail(c, "not_found", "no such simulation");
    const detail = await projects.cluster(simulation, param(c, "sig"));
    return detail ? c.json(detail) : fail(c, "not_found", "nothing with that signature in this simulation");
  });

  app.get(routes.simulationCompare(":p", ":s"), async (c) => {
    const s = await scope(c);
    if (!s.ok) return s.response;
    const simulation = await simulationOf(c, s.project.id);
    if (!simulation) return fail(c, "not_found", "no such simulation");
    const q = parseQuery(c, CompareQuerySchema);
    if (!q.ok) return q.response;
    const compared = await projects.compare(simulation, q.value.a, q.value.b);
    return compared ? c.json(compared) : fail(c, "not_found", "those two executions are not both in this simulation");
  });

  /** The tool list a run's coverage is measured against, from the config that run froze. */
  const coverageOf = async (runId: string) => {
    const read = new ReadModel(deps.store);
    let config: PopulaceConfig | undefined;
    try {
      config = await deps.configForRun(runId);
    } catch {
      config = undefined;
    }
    const view = config ? await liveTargetView(config) : { name: "", endpoints: [], webBaseUrl: null, description: null, identityStrategy: "", tools: null, toolsError: "no target is set up" };
    return read.toolUsage(runId, view);
  };

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
   * refused outright: there is a process mid-wake writing the rows this would remove.
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
    const simulation = await deps.store.getSimulation(parent.simulationId);
    if (!simulation) return fail(c, "conflict", "that run's simulation is gone, so there is nothing to carry it on into");
    return startExecution(c, simulation, parent.id);
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

  /** Verification is a model call, so it is behind a POST and named in the request (ADR-0014). */
  app.post(routes.runDigestJob(":id"), async (c) => {
    const runId = param(c, "id");
    const job = await deps.jobs.enqueue(
      "digest",
      async (_job, report) => {
        const config = await deps.configForRun(runId);
        await report({ label: "checking the findings nobody has ruled on yet" });
        if (config.verifier.judge === "model" && !deps.hasApiKey()) throw new Error("the model judge needs ANTHROPIC_API_KEY; switch the judge to heuristic or set a key");
        await verifyPending({ store: deps.store, config, identityProvider: identityProviderFor(config.identity), ...(deps.provider ? { provider: deps.provider() } : {}) }, { runIds: [runId] });
        await report({ label: "clustering what came back" });
        const wakes = await deps.store.listWakes({ runIds: [runId] });
        const since = wakes[0]?.startedAt ? new Date(wakes[0].startedAt) : new Date(0);
        await buildDigest({ store: deps.store, config, since, until: new Date(), runIds: [runId] });
        return undefined;
      },
      { runId, label: "building the digest" },
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
   * One stream for the whole screen (ADR-0026). Everything before `after` comes from the table, so
   * a reconnecting browser replays the gap instead of losing it; everything after arrives live.
   *
   * `project` and `simulation` sit alongside `run`, so a project page follows every simulation in
   * it on one connection rather than opening one per execution.
   */
  app.get(routes.events, (c) => {
    const q = parseQuery(c, EventStreamQuerySchema);
    if (!q.ok) return q.response;
    // `Last-EventID` is what EventSource sends by itself on a reconnect, so it wins over a cursor
    // the page put in the URL when it first loaded.
    const header = c.req.header("last-event-id");
    const resumeFrom = header !== undefined && header !== "" ? Number.parseInt(header, 10) : q.value.after;
    const filter = { ...(q.value.run === undefined ? {} : { runId: q.value.run }), ...(q.value.project === undefined ? {} : { projectId: q.value.project }), ...(q.value.simulation === undefined ? {} : { simulationId: q.value.simulation }) };
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
            await stream.writeSSE({ id: String(event.seq), event: event.type, data: JSON.stringify(event) });
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
          await stream.writeSSE({ id: String(event.seq), event: event.type, data: JSON.stringify(event) });
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
      ...(q.value.simulation === undefined ? {} : { simulationId: q.value.simulation }),
      limit: 500,
    });
    return c.json(page(events, undefined, 500));
  });

}

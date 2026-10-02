import { createHash } from "node:crypto";
import { z } from "zod";
import {
  DEFAULT_PROJECT_ID,
  GuardrailsSchema,
  PopulaceConfigSchema,
  SimulationSchema,
  VerifierConfigSchema,
  newCohortId,
  newPersonaId,
  newPopulationId,
  newSimulationId,
  newTargetId,
  personIdFor,
  resolveModel,
  slugify,
  JsonValueSchema,
  type Cadence,
  type Cohort,
  type ConfigSnapshot,
  type Guardrails,
  type GuardrailsOverride,
  type JsonValue,
  type ModelConfig,
  type ModelOverride,
  type Person,
  type PersonaSpec,
  type PersonProfile,
  type ToolPolicy,
  type TraitValue,
  type PopulaceConfig,
  type Project,
  type Simulation,
  type SimulationContext,
  type Store,
  type StoredPersona,
  type StoredPopulation,
  type StoredSettings,
  type StoredTarget,
  type VerifierConfig,
  type VerifierOverride,
} from "@populace/core";
import { dealFor, draftPerson, ensureRosterFor, rosterProfiles, RosterIncomplete, type Deal } from "./cohort-store.js";

/**
 * Assembly between the authored rows and the resolved `PopulaceConfig` the runner consumes
 * (ADR-0025). Resolution is assembly, not translation: every shape stored here is the same zod
 * schema `PopulaceConfig` already uses, which is what keeps YAML import and export lossless and
 * keeps the runner ignorant of where its config came from.
 *
 * Resolution is READ-ONLY and materialisation is explicit (ADR-0041, D3). `resolveDraft` and
 * `resolveSimulationConfig` read the roster and fill a slot no writer has reached yet in memory;
 * `materialise` is the write, and it is called by the routes that change who goes — never by a
 * GET, never by a resolve.
 */

export interface ProcessConfig {
  /** Where the database lives. A property of the process, never of a project row. */
  store: PopulaceConfig["store"];
  digestDir: string;
}

function now(): string {
  return new Date().toISOString();
}

/** The study a project gets before anybody creates a second one. */
export const DEFAULT_SIMULATION_SLUG = "trial";

/** What `SimulationContextSchema` fills in for a config that names no simulation at all. */
const PLACEHOLDER_SIMULATION_SLUG = "simulation";

/**
 * One study as a file or a form describes it, before it is a row: the plan, without the ids that
 * only the store can mint. `populace.yaml`'s `simulations:` (or `studies:`) block parses into
 * these.
 */
export interface SimulationPlan {
  slug: string;
  name: string;
  description?: string;
  /** Null is a longitudinal study; a number is an ephemeral one and its visit cap. */
  visitsPerPerson: number | null;
  cadence: Cadence;
  seed: string;
  autoSweep?: boolean;
  requireFreshTarget?: boolean;
  /**
   * How many people the study sends (ADR-0041). A file that says nothing sends exactly the lane
   * counts it wrote — the importer puts their sum here — so an import is lossless either way.
   */
  size?: number;
}

/**
 * The study a config implies when it names none of its own: the cap decides the mode. A file
 * that caps visits describes something that ENDS, which is what ephemeral means; one that does not
 * describes a soak, which is longitudinal. Its size is the config's own when the loader set one
 * and the sum of the lane counts otherwise — the same number, said twice, so a hand-built config
 * that never heard of sizes still sends everybody it lists.
 */
export function simulationPlanOf(config: PopulaceConfig): SimulationPlan {
  const named = config.simulation.slug !== PLACEHOLDER_SIMULATION_SLUG;
  const counted = config.population.members.reduce((sum, member) => sum + member.count, 0);
  return {
    slug: named ? config.simulation.slug : DEFAULT_SIMULATION_SLUG,
    name: named ? config.simulation.name : `${config.target.name} — ${config.population.name}`,
    visitsPerPerson: config.simulation.visitsPerPerson ?? config.population.maxWakes,
    cadence: config.population.cadence,
    seed: config.population.seed,
    size: config.simulation.size > 0 ? config.simulation.size : counted,
    // `autoSweep` is deliberately NOT copied off the context: its default there is false (a config
    // that has never heard of studies must not silently delete accounts), while a study row's
    // default is true (SPEC §2.7). A file that means it says so in its `simulations:` block, which
    // reaches this function as an explicit plan rather than through a context.
    ...(named && config.simulation.autoSweep ? { autoSweep: true } : {}),
  };
}

/**
 * The project a config is imported into, created if it is not there yet.
 *
 * `name` is what the caller knows and this function does not: `serve` passes the target's name,
 * so importing a `populace.yaml` for Tasklet lands in a project called "Tasklet". Without it the
 * fallback used to be the literal word "Default", which told a reader nothing about what was in
 * the project and was the first row on their dashboard.
 */
export async function ensureProject(store: Store, projectId = DEFAULT_PROJECT_ID, options: { name?: string } = {}): Promise<Project> {
  const existing = await store.getProject(projectId);
  if (existing) return existing;
  const at = now();
  const fallback = projectId === DEFAULT_PROJECT_ID ? "Your first project" : projectId;
  const project: Project = {
    id: projectId,
    slug: projectId === DEFAULT_PROJECT_ID ? DEFAULT_PROJECT_ID : projectId,
    name: options.name?.trim() || fallback,
    description: "",
    archived: false,
    createdAt: at,
    updatedAt: at,
  };
  await store.saveProject(project);
  return project;
}

/** Settings a project has before anyone touches the form: every schema default, nothing invented. */
function defaultSettings(projectId: string): StoredSettings {
  const base = PopulaceConfigSchema.parse({
    target: { name: "unset", mcp: [{ url: "http://127.0.0.1:1/" }] },
    // `none` and not a self-signup naming a tool called "unset": these are the SCHEMA DEFAULTS a
    // fresh project starts from, a target overrides every one of them, and a placeholder that
    // names a tool no target has is the sort of thing that surfaces in an error message one day.
    identity: { strategy: "none" },
    population: { id: "unset", members: [{ persona: { id: "unset", name: "unset", role: "unset", backstory: "unset", goals: ["unset"] } }] },
  });
  return {
    projectId,
    model: base.model,
    guardrails: base.guardrails,
    verifier: base.verifier,
    daemon: base.daemon,
    cadence: base.population.cadence,
    maxWakes: base.population.maxWakes,
    seed: base.population.seed,
    updatedAt: now(),
  };
}

/** The project's settings row, written with the defaults when there is none yet. */
export async function ensureSettings(store: Store, projectId = DEFAULT_PROJECT_ID): Promise<StoredSettings> {
  const existing = await store.getSettings(projectId);
  if (existing) return existing;
  const settings = defaultSettings(projectId);
  await store.saveSettings(settings);
  return settings;
}

/**
 * The project's settings for READING: the row, or the defaults it would be written with. This is
 * what resolution uses, because resolution writes nothing — not even a row of defaults, which a
 * GET on an empty project would otherwise leave behind (ADR-0041, D3).
 */
export async function settingsOf(store: Store, projectId = DEFAULT_PROJECT_ID): Promise<StoredSettings> {
  return (await store.getSettings(projectId)) ?? defaultSettings(projectId);
}

/**
 * What everybody in a cohort made from one persona alone has in common, when nobody has said.
 * An import whose lanes carry no context gets this line, and the cohort builder is where it is
 * rewritten.
 */
export const DEFAULT_COHORT_CONTEXT = "You came across this product on your own and are trying it for your own reasons.";

/**
 * One cohort as the resolved config carries it. The same shape `PopulationMemberSchema` takes as
 * input; naming it here is what lets the loop below build members conditionally without the
 * compiler losing track of which fields are optional.
 */
interface ResolvedMember {
  cohort: string;
  context: string;
  traits: Record<string, TraitValue>;
  tools: ToolPolicy;
  model: ModelOverride;
  cohortName: string;
  persona: PersonaSpec;
  count: number;
  seed: string;
  people: PersonProfile[];
  cadence?: Partial<Cadence>;
  maxWakes?: number;
}

/**
 * The blocks of the project's settings a study sets for itself. A block that is absent overrides
 * nothing; a field absent from a block falls through to the project's value. `Simulation["overrides"]`
 * satisfies this, and so does the partial a form sends before the row exists.
 */
export interface StudyOverrides {
  model?: ModelOverride;
  guardrails?: GuardrailsOverride;
  verifier?: VerifierOverride;
}

/**
 * A study as the form has it, saved or not: everything resolution needs that is not an id the
 * store mints. A saved row resolves through exactly this shape (`draftOf`), so a builder's cost
 * estimate and the run it goes on to start are one arithmetic.
 */
export interface StudyDraft {
  projectId: string;
  targetId: string;
  populationId: string;
  /** THE headcount (ADR-0041): what `dealStudy` deals across the population's weights. */
  size: number;
  /** Null is longitudinal; a number is ephemeral and its visit cap. Decides the mode. */
  visitsPerPerson: number | null;
  cadence: Cadence;
  seed: string;
  autoSweep?: boolean;
  requireFreshTarget?: boolean;
  overrides?: StudyOverrides;
  /** What the study tells its people, after their cohort's context (D3b). */
  brief?: string;
}

/**
 * The rows a draft resolves out of, alongside the config they assembled into and the deal that
 * decided who is in it. The callers that start a run need the target's row id (it goes on the
 * run), so it comes back rather than being looked up twice.
 */
export interface ResolvedDraft {
  config: PopulaceConfig;
  target: StoredTarget;
  population: StoredPopulation;
  /** The population's cohorts that still exist, in member order. */
  cohorts: Cohort[];
  /** Every persona in the project, for the screens that name one. */
  personas: StoredPersona[];
  deal: Deal;
}

/** A saved study, resolved: the draft's rows plus the row itself. */
export interface ResolvedSimulation extends ResolvedDraft {
  simulation: Simulation;
}

/** The one sentence a start is refused with when the deal comes to nought. */
export const SENDS_NOBODY = "this study sends nobody yet: give it a size";

/**
 * Why a study cannot be run yet, in the words the screen shows. `sendsNobody` marks the one case
 * that is not a missing row but an empty deal — a size of nought, or weights that leave every lane
 * empty — because the estimate route answers that one with a zero estimate rather than a refusal.
 */
export class ConfigIncomplete extends Error {
  readonly sendsNobody: boolean;

  constructor(
    readonly missing: string[],
    options: { sendsNobody?: boolean } = {},
  ) {
    super(missing.join("; "));
    this.name = "ConfigIncomplete";
    this.sendsNobody = options.sendsNobody ?? false;
  }
}

/** The cohorts a population holds, in the population's own order. A cohort that is gone is left out. */
export async function cohortsOfPopulation(store: Store, population: StoredPopulation): Promise<Cohort[]> {
  const byId = new Map((await store.listCohorts(population.projectId)).map((cohort) => [cohort.id, cohort]));
  return population.members.flatMap((member) => {
    const cohort = byId.get(member.cohortId);
    return cohort ? [cohort] : [];
  });
}

/**
 * The project's settings with a study's overrides layered on, field-wise, exactly as a persona's
 * model override layers over the global one: an unset field falls through. Parsed back through
 * the config schemas so the result is typed, which is what lets a zero estimate name the ceilings
 * that would have applied to a study that sends nobody.
 */
export function planSettings(settings: StoredSettings, overrides: StudyOverrides = {}): { model: ModelConfig; guardrails: Guardrails; verifier: VerifierConfig } {
  return {
    model: resolveModel(settings.model, overrides.model),
    guardrails: GuardrailsSchema.parse({ ...settings.guardrails, ...overrides.guardrails, perWake: { ...settings.guardrails.perWake, ...overrides.guardrails?.perWake } }),
    verifier: VerifierConfigSchema.parse({ ...settings.verifier, ...overrides.verifier, model: { ...settings.verifier.model, ...overrides.verifier?.model } }),
  };
}

/** A partial with its `undefined` entries dropped, so a spread of it never blanks a field. */
function definedOnly<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(value) as (keyof T)[]) if (value[key] !== undefined) out[key] = value[key];
  return out;
}

/**
 * Assembles a study — saved or still a form — into the object `runWake()` already takes.
 *
 * READ-ONLY, and that is the contract (ADR-0041, D3): it writes no person, no settings row,
 * nothing. The deal decides who is in (`dealFor`: the size across the population's weights, then
 * each cohort's count across its mix), the roster is read once for the project, and a slot no
 * writer has reached yet is filled IN MEMORY by `draftPerson` — the same draw `ensureRoster` makes
 * for that slot, so the person a snapshot freezes is the person the next write puts in the row.
 * That fill is walked the way the writer walks it, in mix order with the cohort's taken names, and
 * it can differ from the write in exactly one case: rows missing while ANOTHER study sizes an
 * earlier lane larger than this one does. Every writer materialises before anything resolves, so
 * that case is a draft that was never saved, whose estimate freezes nothing.
 *
 * Lanes with a count of nought are omitted. Throws `ConfigIncomplete` rather than returning a
 * half-built config — a run started on a config with no target is a run that spends money to
 * fail — and with `sendsNobody` when the rows are all there and the deal is empty.
 *
 * `context` is the saved row's identity (id, slug, name, mode…) when there is one; a draft gets
 * the schema's placeholders, which nothing that reads an estimate looks at.
 */
export async function resolveDraft(store: Store, process: ProcessConfig, draft: StudyDraft, context: Partial<SimulationContext> = {}): Promise<ResolvedDraft> {
  const who = context.name === undefined ? "this study" : `the ${context.name} study`;
  const missing: string[] = [];
  const target = await store.getTarget(draft.targetId);
  if (!target) missing.push(`${who} points at a target that no longer exists (${draft.targetId})`);
  const population = await store.getPopulation(draft.populationId);
  if (!population) missing.push(`${who} points at a population that no longer exists (${draft.populationId})`);
  if (!target || !population) throw new ConfigIncomplete(missing);

  let deal: Deal;
  try {
    deal = await dealFor(store, population, draft.size);
  } catch (err) {
    if (!(err instanceof RosterIncomplete)) throw err;
    throw new ConfigIncomplete([err.message]);
  }
  if (deal.sends === 0) throw new ConfigIncomplete([SENDS_NOBODY], { sendsNobody: true });

  const settings = await settingsOf(store, draft.projectId);
  const personas = await store.listPersonas(draft.projectId);
  // One read of the project's people, archived included: an archived row within the deal is still
  // that person (a write would restore them), and their name is still taken in the cohort.
  const stored = new Map<string, Person[]>();
  for (const person of await store.listPeople({ projectId: draft.projectId, includeArchived: true })) {
    stored.set(person.cohortId, [...(stored.get(person.cohortId) ?? []), person]);
  }
  const at = now();

  const members: ResolvedMember[] = [];
  for (const share of deal.cohorts) {
    const { cohort } = share;
    const rows = stored.get(cohort.id) ?? [];
    const byId = new Map(rows.map((person) => [person.id, person]));
    const used = new Set(rows.map((person) => person.name));
    for (const lane of share.lanes) {
      if (lane.count === 0) continue;
      const cast: Person[] = [];
      for (let ordinal = 0; ordinal < lane.count; ordinal++) cast.push(byId.get(personIdFor(lane.laneSlug, ordinal)) ?? draftPerson(lane, ordinal, used, at));
      members.push({
        // The cohort slug and the persona's immutable slug are what lane slugs, and therefore
        // agent ids, are built from: a continuation matches on both, so neither may follow a
        // display-name rename (`DATA-MODEL.md` §5).
        cohort: cohort.slug,
        cohortName: cohort.name,
        context: cohort.context,
        traits: cohort.traits,
        tools: cohort.tools,
        model: cohort.model,
        persona: { ...lane.persona.spec, id: lane.persona.slug },
        count: lane.count,
        seed: cohort.seed,
        // The cast is frozen into the snapshot, so a three-month-old execution still renders the
        // right names even if the cohort has been re-cast since.
        people: rosterProfiles(cast),
        ...(cohort.cadence ? { cadence: cohort.cadence } : {}),
        ...(cohort.maxWakes === undefined ? {} : { maxWakes: cohort.maxWakes }),
      });
    }
  }

  const plan = planSettings(settings, draft.overrides);
  const config = PopulaceConfigSchema.parse({
    version: 2,
    simulation: {
      // The plan as the draft has it, then the saved row's identity where there is one. The two
      // agree by construction for a row (`draftOf` and `contextOf` read the same fields).
      mode: draft.visitsPerPerson === null ? "longitudinal" : "ephemeral",
      visitsPerPerson: draft.visitsPerPerson,
      size: draft.size,
      brief: draft.brief ?? "",
      ...(draft.autoSweep === undefined ? {} : { autoSweep: draft.autoSweep }),
      ...definedOnly(context),
    },
    // The target's tool policy is resolved into the config the runner sees, alongside the address
    // and the reset hook. The runner merges it with each persona's; nothing else may.
    target: { name: target.name, mcp: target.mcp, ...(target.webBaseUrl ? { webBaseUrl: target.webBaseUrl } : {}), ...(target.description ? { description: target.description } : {}), tools: target.tools, reset: target.reset },
    identity: target.identity,
    // The study's overrides layer over the project's settings field-wise (`planSettings`).
    model: plan.model,
    guardrails: plan.guardrails,
    verifier: plan.verifier,
    daemon: settings.daemon,
    store: process.store,
    digestDir: process.digestDir,
    population: {
      id: population.slug,
      name: population.name,
      members,
      // The execution plan is the study's, not the project's: `maxWakes` IS `visitsPerPerson`,
      // which is the whole mechanism by which an ephemeral run ends on its own.
      cadence: draft.cadence,
      maxWakes: draft.visitsPerPerson,
      seed: draft.seed,
    },
  });
  return { config, target, population, cohorts: deal.cohorts.map((share) => share.cohort), personas, deal };
}

/** A saved study as the draft it resolves through. */
function draftOf(simulation: Simulation): StudyDraft {
  return {
    projectId: simulation.projectId,
    targetId: simulation.targetId,
    populationId: simulation.populationId,
    size: simulation.size,
    visitsPerPerson: simulation.visitsPerPerson,
    cadence: simulation.cadence,
    seed: simulation.seed,
    autoSweep: simulation.autoSweep,
    requireFreshTarget: simulation.requireFreshTarget,
    overrides: simulation.overrides,
    brief: simulation.brief,
  };
}

/** The slice of a saved study that rides in the resolved config, so a snapshot says what ran. */
function contextOf(simulation: Simulation): SimulationContext {
  return {
    id: simulation.id,
    slug: simulation.slug,
    name: simulation.name,
    mode: simulation.mode,
    visitsPerPerson: simulation.visitsPerPerson,
    autoSweep: simulation.autoSweep,
    reportCycle: simulation.reportCycle,
    size: simulation.size,
    brief: simulation.brief,
  };
}

/**
 * Assembles the authored rows into the object `runWake()` already takes, FOR ONE SAVED STUDY:
 * `resolveDraft` over the row's own fields.
 *
 * Everything that decides what a run does is named by the row: its target by id, its population
 * by id, its size, and the plan (cadence, visit cap, seed, mode) that used to live on the
 * project's settings. Two studies in one project pointing at different targets therefore resolve
 * to different targets, which the project-wide `listTargets(projectId)[0]` this replaced could not
 * do — it handed both of them whichever target had been edited most recently.
 *
 * READ-ONLY, like everything it calls. Throws `ConfigIncomplete` when the row is gone, when its
 * target or population is, or when the deal sends nobody.
 */
export async function resolveSimulationConfig(store: Store, process: ProcessConfig, simulationId: string): Promise<ResolvedSimulation> {
  const simulation = await store.getSimulation(simulationId);
  if (!simulation) throw new ConfigIncomplete([`there is no study ${simulationId}`]);
  const resolved = await resolveDraft(store, process, draftOf(simulation), contextOf(simulation));
  return { ...resolved, simulation };
}

/**
 * THE write that follows a change to who goes (ADR-0041, D3): the roster of every cohort in the
 * study's population, sized by `laneSizes` — which reads every study, so the row must be SAVED
 * before this is called, or it sizes the roster at the numbers it is replacing. Called by
 * `POST /studies`, `PUT /studies/:s`, a study's archive, an execution start (before the snapshot)
 * and an import; a study whose population is gone has nothing to write.
 */
export async function materialise(store: Store, simulationId: string, now: Date = new Date()): Promise<void> {
  const simulation = await store.getSimulation(simulationId);
  if (!simulation) throw new Error(`no study ${simulationId}`);
  await ensureRosterFor(store, simulation.populationId, now);
}

/**
 * The study a project-scoped caller means when it has not been given one — FOR TESTS. The product
 * never creates a study on a reader's behalf: `POST /studies` requires the ids the builder always
 * has, and a GET creates nothing (ADR-0035, ADR-0041). A test that wants one row without walking
 * the routes gets it here, from the project's first target and its oldest population, at
 * `options.size` people (nought when not asked: a test that sends people says how many), and the
 * roster is written for it. An existing study is returned as it is, resized when a different size
 * is asked for.
 *
 * Oldest-first for the population, ties broken on id, so two rows written in the same millisecond
 * still resolve the same way on every call.
 */
export async function ensureSimulation(store: Store, projectId = DEFAULT_PROJECT_ID, options: { size?: number } = {}): Promise<Simulation> {
  const existing = (await store.listSimulations({ projectId })).find((simulation) => !simulation.archived);
  if (existing) {
    if (options.size === undefined || options.size === existing.size) return existing;
    const resized: Simulation = { ...existing, size: options.size, updatedAt: now() };
    await store.saveSimulation(resized);
    await materialise(store, resized.id);
    return resized;
  }
  const target = (await store.listTargets(projectId))[0];
  if (!target) throw new ConfigIncomplete(["no target is set up yet"]);
  const population = [...(await store.listPopulations(projectId))].sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt)))[0];
  if (!population) throw new ConfigIncomplete(["no population is composed yet"]);
  const settings = await ensureSettings(store, projectId);
  const simulation = await createSimulation(store, {
    projectId,
    slug: DEFAULT_SIMULATION_SLUG,
    name: `${target.name} — ${population.name}`,
    populationId: population.id,
    targetId: target.id,
    size: options.size ?? 0,
    visitsPerPerson: settings.maxWakes,
    cadence: settings.cadence,
    seed: settings.seed,
  });
  await materialise(store, simulation.id);
  return simulation;
}

export interface SimulationDraft {
  projectId: string;
  slug: string;
  name: string;
  description?: string;
  populationId: string;
  targetId: string;
  /** How many people the study sends. Nought is legal, and a start refuses until it is raised. */
  size: number;
  /**
   * The visit cap, which is also what decides the mode: a capped study ENDS on its own and is
   * therefore ephemeral, an uncapped one runs until somebody stops it and is therefore longitudinal
   * (`SimulationSchema` binds the two, so they cannot disagree).
   */
  visitsPerPerson: number | null;
  cadence: Cadence;
  seed: string;
  autoSweep?: boolean;
  requireFreshTarget?: boolean;
  /** Absent overrides nothing; each block absent from it overrides nothing. */
  overrides?: StudyOverrides;
  /** What the study tells its people (D3b). Absent says nothing. */
  brief?: string;
}

/**
 * Writes the row and nothing else. The roster it sends is written by `materialise`, which the
 * caller runs afterwards — kept apart so an import can create every study first and size the
 * roster once, at the largest count any of them deals.
 */
export async function createSimulation(store: Store, draft: SimulationDraft): Promise<Simulation> {
  const at = now();
  const simulation: Simulation = SimulationSchema.parse({
    id: newSimulationId(),
    projectId: draft.projectId,
    slug: draft.slug,
    name: draft.name,
    description: draft.description ?? "",
    populationId: draft.populationId,
    targetId: draft.targetId,
    mode: draft.visitsPerPerson === null ? "longitudinal" : "ephemeral",
    size: draft.size,
    brief: draft.brief ?? "",
    visitsPerPerson: draft.visitsPerPerson,
    cadence: draft.cadence,
    seed: draft.seed,
    ...(draft.autoSweep === undefined ? {} : { autoSweep: draft.autoSweep }),
    ...(draft.requireFreshTarget === undefined ? {} : { requireFreshTarget: draft.requireFreshTarget }),
    ...(draft.overrides === undefined ? {} : { overrides: draft.overrides }),
    createdAt: at,
    updatedAt: at,
  });
  await store.saveSimulation(simulation);
  return simulation;
}

/**
 * Puts the live credentials back into a config read out of a snapshot.
 *
 * A snapshot is redacted on the way in (`redactConfig`), which is right: a local database gets
 * copied around and attached to bug reports. But a resume executes the frozen snapshot, and a
 * frozen snapshot with `[redacted]` where a bearer token used to be would resume against a target
 * it can no longer authenticate to. The plan comes from the snapshot; the secrets come from the
 * rows, which is where they have always lived.
 */
export function withLiveSecrets(frozen: PopulaceConfig, live: PopulaceConfig): PopulaceConfig {
  const mcp = frozen.target.mcp.map((endpoint) => {
    const current = live.target.mcp.find((e) => e.name === endpoint.name);
    if (!current) return endpoint;
    const headers = { ...endpoint.headers };
    for (const [key, value] of Object.entries(headers)) if (value === REDACTED && current.headers[key] !== undefined) headers[key] = current.headers[key];
    const token = endpoint.bearerToken === REDACTED ? current.bearerToken : endpoint.bearerToken;
    return { ...endpoint, ...(token === undefined ? {} : { bearerToken: token }), headers };
  });
  const model = { ...frozen.model };
  if (model.apiKey === REDACTED) {
    if (live.model.apiKey === undefined) delete model.apiKey;
    else model.apiKey = live.model.apiKey;
  }
  let reset = frozen.target.reset;
  if (reset.kind === "http" && live.target.reset.kind === "http") {
    const current = live.target.reset.headers;
    const headers = { ...reset.headers };
    for (const [key, value] of Object.entries(headers)) if (value === REDACTED && current[key] !== undefined) headers[key] = current[key];
    reset = { ...reset, headers };
  }
  // A resumed run renews its people's sessions through the same key it minted them with, so a
  // frozen `[redacted]` here would be a population that authenticates until its first hour is up.
  let identity = frozen.identity;
  if (identity.strategy === "admin-mint" && identity.apiKey === REDACTED) {
    const current = live.identity.strategy === "admin-mint" ? live.identity.apiKey : undefined;
    identity = current === undefined ? { ...identity, apiKey: undefined } : { ...identity, apiKey: current };
  }
  return { ...frozen, target: { ...frozen.target, mcp, reset }, model, identity };
}

/**
 * The config a run is executing, ready to CONNECT with: its frozen snapshot (ADR-0024) with the
 * live credentials put back, or a live resolve when the run froze nothing.
 *
 * EVERY path that opens a connection to the target from a stored run belongs here — sweep,
 * verification's replay, the tool list a run's coverage is measured against — because a redacted
 * snapshot handed to any of them authenticates with the literal string `[redacted]`. That is not a
 * visible failure: verification comes back "not reproduced" with nothing on screen to say why, and
 * sweep reports accounts removed that are still sitting on somebody's product.
 *
 * Which is why this is STRICT and has no fallback to the frozen plan. Secrets live in the rows and
 * nowhere else, so a run whose rows no longer resolve — a deleted target, a persona a cohort still
 * points at, a cohort edited down to nobody — has no live credentials to be had, and the only
 * honest answers are "here they are" and `undefined`. Handing back the snapshot instead would be
 * the same silent `[redacted]` by a different door. Describing a run is the other job and it is
 * `frozenConfigForRun`'s; a caller that connects must never fall back to that one.
 */
export async function liveConfigForRun(
  store: Store,
  runId: string,
  resolveLive: (simulationId: string) => Promise<PopulaceConfig>,
): Promise<PopulaceConfig | undefined> {
  const run = await store.getRun(runId);
  if (!run) return undefined;
  let live: PopulaceConfig;
  try {
    live = await resolveLive(run.simulationId);
  } catch {
    return undefined;
  }
  const snapshot = run.configSnapshotId ? await store.getConfigSnapshot(run.configSnapshotId) : undefined;
  // The plan comes from the snapshot, the credentials from the rows. With no snapshot there is no
  // frozen plan to execute and the live one is what this run is running.
  return snapshot ? withLiveSecrets(snapshot.config, live) : live;
}

/**
 * The plan a run executed, for DESCRIBING it: the frozen snapshot exactly as stored, credentials
 * and all redacted out of it.
 *
 * A digest rendered today, a spend ceiling, a cohort's display name: all of them have to describe
 * what ran rather than what the forms say now, and all of them are better served by a redacted
 * plan than by nothing — a run whose target has since been deleted is still a run somebody wants
 * to read. Nothing that connects may use this.
 */
export async function frozenConfigForRun(store: Store, runId: string): Promise<PopulaceConfig | undefined> {
  const run = await store.getRun(runId);
  if (!run?.configSnapshotId) return undefined;
  return (await store.getConfigSnapshot(run.configSnapshotId))?.config;
}

/**
 * Writes a resolved `PopulaceConfig` into the authored tables. This is how a `populace.yaml`
 * becomes rows on first open and how `POST /config/import` works; both go through one path so a
 * YAML file and a form produce the same rows.
 *
 * Existing rows are left alone. Seeding is a first-run convenience, not a sync: a user who has
 * edited their target in the browser must not have it overwritten because a stale file is still
 * sitting in the working directory.
 *
 * A file writes LANE COUNTS and the rows hold WEIGHTS and one size (ADR-0041), and the import is
 * lossless across that: a cohort's mix weights are its lane counts, a population member's weight
 * is the sum of its cohort's counts, and the study's size is the plan's when it names one and the
 * sum of every count otherwise. Sainte-Laguë returns a target vector exactly when the weights are
 * proportional to it and sum to the size, so the deal gives back the numbers the file wrote.
 */
export async function seedProjectFromConfig(
  store: Store,
  config: PopulaceConfig,
  projectId = DEFAULT_PROJECT_ID,
  options: { simulations?: readonly SimulationPlan[] } = {},
): Promise<{ seeded: boolean; reason: string }> {
  await ensureProject(store, projectId);
  const targets = await store.listTargets(projectId);
  if (targets.length > 0) return { seeded: false, reason: "this project already has a target; YAML is an import, not a sync" };

  const at = now();
  const target: StoredTarget = {
    id: newTargetId(),
    projectId,
    slug: "target",
    name: config.target.name,
    mcp: config.target.mcp,
    ...(config.target.webBaseUrl ? { webBaseUrl: config.target.webBaseUrl } : {}),
    ...(config.target.description ? { description: config.target.description } : {}),
    identity: config.identity,
    tools: config.target.tools,
    firstContact: null,
    reset: config.target.reset,
    createdAt: at,
    updatedAt: at,
  };
  await store.saveTarget(target);

  const existingPersonas = new Map((await store.listPersonas(projectId)).map((p) => [p.slug, p]));
  const existingCohorts = new Map((await store.listCohorts(projectId)).map((cohort) => [cohort.slug, cohort]));
  // A file's members are LANES: one cohort mixing three personas is three members sharing a
  // cohort slug. They are folded back into one cohort whose weights are the counts, so the
  // apportionment gives back exactly the numbers the file wrote.
  const byCohort = new Map<string, PopulaceConfig["population"]["members"]>();
  for (const member of config.population.members) byCohort.set(member.cohort, [...(byCohort.get(member.cohort) ?? []), member]);
  const members: StoredPopulation["members"] = [];
  let counted = 0;
  for (const [slug, lanes] of byCohort) {
    const mix: Cohort["mix"] = [];
    for (const member of lanes) {
      const personaSlug = member.persona.id;
      let persona = existingPersonas.get(personaSlug);
      if (!persona) {
        persona = { id: newPersonaId(), projectId, slug: personaSlug, spec: member.persona, origin: "imported", createdAt: at, updatedAt: at };
        await store.savePersona(persona);
        existingPersonas.set(personaSlug, persona);
      }
      if (!mix.some((entry) => entry.personaId === persona.id)) mix.push({ personaId: persona.id, weight: member.count });
    }
    const first = lanes[0];
    if (!first) continue;
    const existing = existingCohorts.get(slug);
    const cohort: Cohort = {
      id: existing?.id ?? newCohortId(),
      projectId,
      slug,
      name: first.cohortName,
      context: first.context || DEFAULT_COHORT_CONTEXT,
      mix,
      traits: first.traits,
      tools: first.tools,
      model: first.model,
      seed: first.seed,
      notes: "",
      ...(first.cadence ? { cadence: first.cadence } : {}),
      ...(first.maxWakes === undefined ? {} : { maxWakes: first.maxWakes }),
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    };
    await store.saveCohort(cohort);
    existingCohorts.set(cohort.slug, cohort);
    // The member's weight is the cohort's share of the file's people: its lane counts, summed. A
    // weight has to be positive, and a cohort the file sends nobody from is not in its population.
    const sent = lanes.reduce((sum, member) => sum + member.count, 0);
    if (sent <= 0) continue;
    members.push({ cohortId: cohort.id, weight: sent });
    counted += sent;
  }

  // The file's population is a row of its own, under the file's slug — de-duplicated against
  // whatever the project already holds, because a slug is a URL and two rows cannot share one.
  const taken = new Set((await store.listPopulations(projectId)).map((population) => population.slug));
  const base = slugify(config.population.id) || "everyone";
  let populationSlug = base;
  for (let n = 2; taken.has(populationSlug); n++) populationSlug = `${base}-${n}`;
  const population: StoredPopulation = { id: newPopulationId(), projectId, slug: populationSlug, name: config.population.name, members, createdAt: at, updatedAt: at };
  await store.savePopulation(population);

  await store.saveSettings({
    projectId,
    model: config.model,
    guardrails: config.guardrails,
    verifier: config.verifier,
    daemon: config.daemon,
    cadence: config.population.cadence,
    maxWakes: config.population.maxWakes,
    seed: config.population.seed,
    updatedAt: at,
  });

  // One study per plan, each pointing at the target and the population this import just wrote.
  // The cap decides the mode: a file that names a visit cap describes something that ENDS, which
  // is what ephemeral means; one that does not describes a soak, which is longitudinal. A plan
  // with no size sends the people the file counted.
  const simulations = options.simulations ?? [simulationPlanOf(config)];
  const created: Simulation[] = [];
  const takenSlugs = new Set<string>();
  for (const plan of simulations) {
    const slugBase = slugify(plan.slug) || DEFAULT_SIMULATION_SLUG;
    let slug = slugBase;
    for (let n = 2; takenSlugs.has(slug); n++) slug = `${slugBase}-${n}`;
    takenSlugs.add(slug);
    created.push(
      await createSimulation(store, {
        projectId,
        slug,
        name: plan.name,
        ...(plan.description === undefined ? {} : { description: plan.description }),
        populationId: population.id,
        targetId: target.id,
        size: plan.size ?? counted,
        visitsPerPerson: plan.visitsPerPerson,
        cadence: plan.cadence,
        seed: plan.seed,
        ...(plan.autoSweep === undefined ? {} : { autoSweep: plan.autoSweep }),
        ...(plan.requireFreshTarget === undefined ? {} : { requireFreshTarget: plan.requireFreshTarget }),
      }),
    );
  }
  // Once, after every study exists, so the roster is sized at the largest deal among them.
  await ensureRosterFor(store, population.id, new Date(at));
  return { seeded: true, reason: `imported ${members.length} cohort(s), ${created.length} study(ies) and the ${config.target.name} target` };
}

/** What a redacted secret is replaced by, so a reader can see that one was used. */
const REDACTED = "[redacted]";

/** Header names that hold a credential. Deliberately broad: a false positive costs a reader a word. */
const SECRETISH = /auth|token|key|secret|cookie/i;

/**
 * A `github` block carrying a token, if one is ever in a config on its way to a snapshot.
 *
 * Nothing puts one there today. The GitHub connection lives in its own table for exactly this
 * reason, `PopulaceConfig` is assembled field by field below, and `PopulaceConfigSchema` has no
 * passthrough — so three separate facts each independently keep this token out of a snapshot. That
 * is why the clause is here: the protection is currently a coincidence of three things nobody
 * wrote down as a guarantee, and the other four branches of `redactConfig` exist for the same
 * reason. A local database gets copied around and attached to bug reports (see below), and the
 * cost of a clause that never fires is nothing.
 *
 * Loose, and narrow to the one field: whatever else somebody hung off a `github` block passes
 * through untouched, and only the credential is replaced.
 */
const GithubInConfigSchema = z.looseObject({ github: z.looseObject({ token: z.string().min(1) }) });

/**
 * Strips credentials out of a config before it is written to a snapshot (`DATA-MODEL.md` §4). A
 * local database gets copied around and attached to bug reports, so the snapshot records *that* a
 * credential was used and never its value. The live config the daemon runs keeps its secrets; only
 * the stored copy loses them.
 */
export function redactConfig(config: PopulaceConfig): { config: PopulaceConfig; redacted: string[] } {
  const redacted: string[] = [];
  const mcp = config.target.mcp.map((endpoint) => {
    const headers = { ...endpoint.headers };
    for (const key of Object.keys(headers)) {
      if (SECRETISH.test(key)) {
        headers[key] = REDACTED;
        redacted.push(`target.mcp.${endpoint.name}.headers.${key}`);
      }
    }
    if (endpoint.bearerToken === undefined) return { ...endpoint, headers };
    redacted.push(`target.mcp.${endpoint.name}.bearerToken`);
    return { ...endpoint, bearerToken: REDACTED, headers };
  });
  const model = { ...config.model };
  if (model.apiKey !== undefined) {
    model.apiKey = REDACTED;
    redacted.push("model.apiKey");
  }
  // The reset hook is an admin route, and an admin route's header is a credential like any other.
  let reset = config.target.reset;
  if (reset.kind === "http") {
    const headers = { ...reset.headers };
    for (const key of Object.keys(headers)) {
      if (!SECRETISH.test(key)) continue;
      headers[key] = REDACTED;
      redacted.push(`target.reset.headers.${key}`);
    }
    reset = { ...reset, headers };
  }
  // The identity block holds a credential too. admin-mint's `apiKey` is what turns a custom token
  // into a live session and what renews it, so a snapshot that carried it would hand a session
  // minter to anyone the database is copied to. The other strategies hold PATHS, never material.
  let identity = config.identity;
  if (identity.strategy === "admin-mint" && identity.apiKey !== undefined) {
    identity = { ...identity, apiKey: REDACTED };
    redacted.push("identity.apiKey");
  }
  // And the third class of credential (ADR-0044): the token populace files issues with, which
  // points at github.com rather than at the target. It is not a field of `PopulaceConfig` and no
  // code path puts it in one, so this is a clause about a shape the type does not describe —
  // detected by parsing rather than by reading a property, and spread back in so the compiler is
  // not asked to believe in a key it does not know. Dead until somebody makes it live, which is
  // the whole point: this file redacts what a snapshot must never carry, and it should not first
  // learn about a new secret from a bug report somebody attached a database to.
  let stray: { github?: { token: string } } = {};
  const found = GithubInConfigSchema.safeParse(config);
  if (found.success) {
    stray = { github: { ...found.data.github, token: REDACTED } };
    redacted.push("github.token");
  }
  return { config: { ...config, ...stray, target: { ...config.target, mcp, reset }, model, identity }, redacted };
}

/**
 * `JSON.stringify` with object keys ordered, so the hash is over the config's content rather than
 * over whatever order the assembler happened to build it in. The value is a zod-parsed
 * `PopulaceConfig`, so it is JSON by construction; `JsonValue` is what says so to the compiler.
 */
function stableStringify(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v === undefined ? null : v)}`).join(",")}}`;
}

/**
 * Freezes a config into a snapshot, reusing an identical one if it is already stored. The hash is
 * over the redacted config with keys ordered, so two runs on the same config share a row whatever
 * order the assembler happened to build the object in.
 */
export async function snapshotConfig(store: Store, config: PopulaceConfig): Promise<ConfigSnapshot> {
  const { config: safe, redacted } = redactConfig(config);
  // eslint-disable-next-line no-restricted-syntax -- a zod-parsed config is JSON by construction; JsonValueSchema proves it here.
  const hash = `sha256:${createHash("sha256").update(stableStringify(JsonValueSchema.parse(JSON.parse(JSON.stringify(safe)) as unknown))).digest("hex").slice(0, 32)}`;
  const existing = await store.findConfigSnapshotByHash(hash);
  if (existing) return existing;
  const snapshot: ConfigSnapshot = { id: `cfg_${hash.slice(7, 19)}`, createdAt: now(), hash, config: safe, redacted };
  await store.saveConfigSnapshot(snapshot);
  return snapshot;
}

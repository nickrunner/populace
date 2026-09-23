import { createHash } from "node:crypto";
import {
  DEFAULT_PROJECT_ID,
  PopulaceConfigSchema,
  SimulationSchema,
  newCohortId,
  newPersonaId,
  newPopulationId,
  newSimulationId,
  newTargetId,
  resolveModel,
  slugify,
  JsonValueSchema,
  type Cadence,
  type Cohort,
  type ConfigSnapshot,
  type JsonValue,
  type ModelOverride,
  type PersonaSpec,
  type PersonProfile,
  type ToolPolicy,
  type TraitValue,
  type PopulaceConfig,
  type Project,
  type Simulation,
  type Store,
  type StoredPersona,
  type StoredPopulation,
  type StoredSettings,
  type StoredTarget,
} from "@populace/core";
import { ensureRoster, lanesOf, rosterProfiles, RosterIncomplete, sizeIn } from "./cohort-store.js";

/**
 * Assembly between the authored rows and the resolved `PopulaceConfig` the runner consumes
 * (ADR-0025). Resolution is assembly, not translation: every shape stored here is the same zod
 * schema `PopulaceConfig` already uses, which is what keeps YAML import and export lossless and
 * keeps the runner ignorant of where its config came from.
 */

export interface ProcessConfig {
  /** Where the database lives. A property of the process, never of a project row. */
  store: PopulaceConfig["store"];
  digestDir: string;
}

function now(): string {
  return new Date().toISOString();
}

/** The population a project gets before anybody composes a second one. */
export const DEFAULT_POPULATION_SLUG = "everyone";

/** The simulation a project gets before anybody creates a second one. */
export const DEFAULT_SIMULATION_SLUG = "trial";

/** What `SimulationContextSchema` fills in for a config that names no simulation at all. */
const PLACEHOLDER_SIMULATION_SLUG = "simulation";

/**
 * One simulation as a file or a form describes it, before it is a row: the plan, without the ids
 * that only the store can mint. `populace.yaml`'s `simulations:` block parses into these.
 */
export interface SimulationPlan {
  slug: string;
  name: string;
  description?: string;
  /** Null is a longitudinal simulation; a number is an ephemeral one and its visit cap. */
  visitsPerPerson: number | null;
  cadence: Cadence;
  seed: string;
  autoSweep?: boolean;
  requireFreshTarget?: boolean;
}

/**
 * The simulation a config implies when it names none of its own: the cap decides the mode. A file
 * that caps visits describes something that ENDS, which is what ephemeral means; one that does not
 * describes a soak, which is longitudinal.
 */
export function simulationPlanOf(config: PopulaceConfig): SimulationPlan {
  const named = config.simulation.slug !== PLACEHOLDER_SIMULATION_SLUG;
  return {
    slug: named ? config.simulation.slug : DEFAULT_SIMULATION_SLUG,
    name: named ? config.simulation.name : `${config.target.name} — ${config.population.name}`,
    visitsPerPerson: config.simulation.visitsPerPerson ?? config.population.maxWakes,
    cadence: config.population.cadence,
    seed: config.population.seed,
    // `autoSweep` is deliberately NOT copied off the context: its default there is false (a config
    // that has never heard of simulations must not silently delete accounts), while a simulation
    // row's default is true (SPEC §2.7). A file that means it says so in its `simulations:` block,
    // which reaches this function as an explicit plan rather than through a context.
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
export async function ensureSettings(store: Store, projectId = DEFAULT_PROJECT_ID): Promise<StoredSettings> {
  const existing = await store.getSettings(projectId);
  if (existing) return existing;
  const base = PopulaceConfigSchema.parse({
    target: { name: "unset", mcp: [{ url: "http://127.0.0.1:1/" }] },
    // `none` and not a self-signup naming a tool called "unset": these are the SCHEMA DEFAULTS a
    // fresh project starts from, a target overrides every one of them, and a placeholder that
    // names a tool no target has is the sort of thing that surfaces in an error message one day.
    identity: { strategy: "none" },
    population: { id: "unset", members: [{ persona: { id: "unset", name: "unset", role: "unset", backstory: "unset", goals: ["unset"] } }] },
  });
  const settings: StoredSettings = {
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
  await store.saveSettings(settings);
  return settings;
}

/**
 * The project's default population — the one called "everyone", created on first use.
 *
 * A project may hold several: a population is composition, and a simulation names the one it runs
 * (`simulation.populationId`). This is only the fallback for the surfaces that have not been given
 * a population to work with yet.
 *
 * **The fallback is the OLDEST, and that is a fix, not a detail.** It used to be
 * `find(slug === "everyone") ?? populations[0]`, and the comment above it claimed that looking up
 * by slug meant "a second population cannot silently become the default". Only the first half of
 * that expression is by slug. A YAML-seeded project has no row slugged `everyone` — an import
 * names its population whatever the file says — so those installs fell through to
 * `populations[0]`, and `listPopulations` is `ORDER BY slug`. **Composing a population whose slug
 * sorts earlier therefore made it the project's default**, silently retargeting `cohortsOf`, the
 * setup status, `ensureSimulation` and the first-run panel at a cast the reader had just invented.
 * Nothing would have reported it; the headcount would simply have changed.
 *
 * Oldest-first is stable under anything added later, which is the only property this fallback
 * actually needs. `createdAt` ties break on id, so two rows written in the same millisecond still
 * resolve the same way on every call.
 */
export async function ensurePopulation(store: Store, projectId = DEFAULT_PROJECT_ID): Promise<StoredPopulation> {
  const populations = await store.listPopulations(projectId);
  const oldest = [...populations].sort((a, b) =>
    a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt),
  )[0];
  const existing = populations.find((population) => population.slug === DEFAULT_POPULATION_SLUG) ?? oldest;
  if (existing) return existing;
  const at = now();
  const population: StoredPopulation = {
    id: newPopulationId(),
    projectId,
    slug: DEFAULT_POPULATION_SLUG,
    name: "Everyone",
    members: [],
    createdAt: at,
    updatedAt: at,
  };
  await store.savePopulation(population);
  return population;
}

/**
 * The population's cohorts, in the population's own order.
 *
 * `population.members` is authoritative in both directions. A cohort id that no longer resolves
 * is dropped rather than throwing — the population row is composition and a dangling reference is
 * a display problem, not a reason to refuse to run. A cohort the population does NOT hold is not
 * added back: this is the list that decides who is expanded into agents and spends money, and a
 * project can hold cohorts outside its population (a YAML import rewrites the members and leaves
 * whatever was authored in the browser behind). Those belong to a library listing, not here.
 */
export async function cohortsOf(store: Store, projectId = DEFAULT_PROJECT_ID): Promise<Cohort[]> {
  return cohortsOfPopulation(store, await ensurePopulation(store, projectId));
}

/**
 * What everybody in a cohort made from one persona alone has in common, when nobody has said.
 * A starter carries its own line; an authored persona adopted straight into a cohort gets this
 * one, and the cohort screen is where it is rewritten.
 */
export const DEFAULT_COHORT_CONTEXT = "You came across this product on your own and are trying it for your own reasons.";

/**
 * Sets how many of `cohortId`'s people this population sends, and writes the people that number
 * calls for (ADR-0039). Nought takes the cohort out of THIS population and nothing else: a cohort
 * is a library object, the same people in every cast that holds it, so "send none of them here"
 * and "delete these people" are different acts and only the second touches the row.
 *
 * The roster is written where the headcount is decided, not later on a screen that happens to
 * read the cohort: `counts.people` is the number of PEOPLE ROWS and is what the zero state gates
 * the way forward on. `ensureRoster` sizes the cohort at the largest size any population gives
 * it, so a shrink here archives people only if no other population still sends them.
 */
export async function setPopulationMember(store: Store, population: StoredPopulation, cohortId: string, size: number): Promise<StoredPopulation> {
  const at = now();
  const held = population.members.some((member) => member.cohortId === cohortId);
  const members =
    size <= 0
      ? population.members.filter((member) => member.cohortId !== cohortId)
      : held
        ? population.members.map((member) => (member.cohortId === cohortId ? { cohortId, size } : member))
        : [...population.members, { cohortId, size }];
  const updated: StoredPopulation = { ...population, members, updatedAt: at };
  await store.savePopulation(updated);
  await ensureRoster(store, cohortId, new Date(at));
  return updated;
}

/**
 * The cohort that IS this persona and nothing else — a mix of one — sent at `count` people in
 * `population`. This is the first-run path: adopting a starter has to make a persona, a cohort,
 * a population member and a roster in one request without the reader learning the word cohort
 * (ADR-0029). It finds an existing one-persona cohort on this persona before making one, and
 * prefers the one the population already holds.
 */
export async function ensurePersonaCohort(store: Store, population: StoredPopulation, persona: StoredPersona, count: number, context = DEFAULT_COHORT_CONTEXT): Promise<Cohort> {
  const projectId = population.projectId;
  const cohorts = await store.listCohorts(projectId);
  const soleOn = cohorts.filter((cohort) => cohort.mix.length === 1 && cohort.mix[0]?.personaId === persona.id);
  const existing = soleOn.find((cohort) => sizeIn(population, cohort.id) > 0) ?? soleOn[0];
  const at = now();
  let cohort = existing;
  if (!cohort) {
    // A cohort's slug is the first half of every lane slug, so two cohorts in one project cannot
    // share one — the same de-dup loop `POST /cohorts` carries.
    const taken = new Set(cohorts.map((c) => c.slug));
    let slug = persona.slug;
    for (let n = 2; taken.has(slug); n++) slug = `${persona.slug}-${String(n)}`;
    cohort = {
      id: newCohortId(),
      projectId,
      slug,
      name: persona.spec.name,
      context,
      mix: [{ personaId: persona.id, weight: 1 }],
      traits: {},
      tools: { allow: [], deny: [], destructive: "confirm" },
      model: {},
      seed: "populace",
      notes: "",
      createdAt: at,
      updatedAt: at,
    };
    await store.saveCohort(cohort);
  }
  await setPopulationMember(store, population, cohort.id, count);
  return cohort;
}

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
 * The rows a simulation resolves out of, alongside the config they assembled into. The callers
 * that start a run need the target's row id (it goes on the run) and the simulation's, so they
 * come back rather than being looked up twice.
 */
export interface ResolvedSimulation {
  config: PopulaceConfig;
  simulation: Simulation;
  target: StoredTarget;
  population: StoredPopulation;
  cohorts: Cohort[];
  personas: StoredPersona[];
}

/** Why a simulation cannot be run yet, in the words the screen shows. */
export class ConfigIncomplete extends Error {
  constructor(readonly missing: string[]) {
    super(missing.join("; "));
    this.name = "ConfigIncomplete";
  }
}

/** The cohorts a population holds, in the population's own order. */
export async function cohortsOfPopulation(store: Store, population: StoredPopulation): Promise<Cohort[]> {
  const byId = new Map((await store.listCohorts(population.projectId)).map((cohort) => [cohort.id, cohort]));
  return population.members.flatMap((member) => {
    const cohort = byId.get(member.cohortId);
    return cohort ? [cohort] : [];
  });
}

/**
 * The simulation a project-scoped caller means when it has not been given one.
 *
 * It is created once, from the project's default population and its target, and from then on it is
 * a row like any other: the target it names is the target its runs go to. That is the end of
 * `listTargets(projectId)[0]` deciding — the choice is made once, visibly, and frozen on the row
 * rather than being re-decided by `updated_at DESC` every time a run starts.
 */
export async function ensureSimulation(store: Store, projectId = DEFAULT_PROJECT_ID): Promise<Simulation> {
  const existing = (await store.listSimulations({ projectId })).find((simulation) => !simulation.archived);
  if (existing) return existing;
  const target = (await store.listTargets(projectId))[0];
  if (!target) throw new ConfigIncomplete(["no target is set up yet"]);
  const population = await ensurePopulation(store, projectId);
  const settings = await ensureSettings(store, projectId);
  return createSimulation(store, {
    projectId,
    slug: DEFAULT_SIMULATION_SLUG,
    name: `${target.name} — ${population.name}`,
    populationId: population.id,
    targetId: target.id,
    visitsPerPerson: settings.maxWakes,
    cadence: settings.cadence,
    seed: settings.seed,
  });
}

export interface SimulationDraft {
  projectId: string;
  slug: string;
  name: string;
  description?: string;
  populationId: string;
  targetId: string;
  /**
   * The visit cap, which is also what decides the mode: a capped simulation ENDS on its own and is
   * therefore ephemeral, an uncapped one runs until somebody stops it and is therefore longitudinal
   * (`SimulationSchema` binds the two, so they cannot disagree).
   */
  visitsPerPerson: number | null;
  cadence: Cadence;
  seed: string;
  autoSweep?: boolean;
  requireFreshTarget?: boolean;
}

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
    visitsPerPerson: draft.visitsPerPerson,
    cadence: draft.cadence,
    seed: draft.seed,
    ...(draft.autoSweep === undefined ? {} : { autoSweep: draft.autoSweep }),
    ...(draft.requireFreshTarget === undefined ? {} : { requireFreshTarget: draft.requireFreshTarget }),
    createdAt: at,
    updatedAt: at,
  });
  await store.saveSimulation(simulation);
  return simulation;
}

/**
 * Assembles the authored rows into the object `runWake()` already takes, FOR ONE SIMULATION.
 *
 * Everything that decides what a run does is named by the simulation row: its target by id, its
 * population by id, and the plan (cadence, visit cap, seed, mode) that used to live on the
 * project's settings. Two simulations in one project pointing at different targets therefore
 * resolve to different targets, which the project-wide `listTargets(projectId)[0]` this replaces
 * could not do — it handed both of them whichever target had been edited most recently.
 *
 * Throws `ConfigIncomplete` rather than returning a half-built config, because a run started on a
 * config with no target is a run that spends money to fail.
 */
export async function resolveSimulationConfig(store: Store, process: ProcessConfig, simulationId: string): Promise<ResolvedSimulation> {
  const simulation = await store.getSimulation(simulationId);
  if (!simulation) throw new ConfigIncomplete([`there is no simulation ${simulationId}`]);
  const missing: string[] = [];
  const target = await store.getTarget(simulation.targetId);
  if (!target) missing.push(`the ${simulation.name} simulation points at a target that no longer exists (${simulation.targetId})`);
  const population = await store.getPopulation(simulation.populationId);
  if (!population) missing.push(`the ${simulation.name} simulation points at a population that no longer exists (${simulation.populationId})`);
  const settings = await ensureSettings(store, simulation.projectId);
  const personas = await store.listPersonas(simulation.projectId);
  const cohorts = population ? await cohortsOfPopulation(store, population) : [];

  const members: ResolvedMember[] = [];
  for (const cohort of cohorts) {
    const size = population ? sizeIn(population, cohort.id) : 0;
    let lanes;
    let roster;
    try {
      // The lanes at THIS population's size. The roster is written at the largest size any
      // population gives the cohort, so it is a superset, and each lane takes its first `count`.
      lanes = await lanesOf(store, cohort, size);
      // Reading a cohort fills its empty slots, so a cohort sized a moment ago has a cast by the
      // time anything asks who is going. It never overwrites a person who already exists.
      roster = await ensureRoster(store, cohort.id);
    } catch (err) {
      if (!(err instanceof RosterIncomplete)) throw err;
      missing.push(err.message);
      continue;
    }
    for (const lane of lanes) {
      if (lane.count === 0) continue;
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
        people: rosterProfiles(roster.filter((person) => person.laneSlug === lane.laneSlug && person.ordinal < lane.count)),
        ...(cohort.cadence ? { cadence: cohort.cadence } : {}),
        ...(cohort.maxWakes === undefined ? {} : { maxWakes: cohort.maxWakes }),
      });
    }
  }
  if (members.length === 0) missing.push("nobody is in the population yet");
  if (missing.length || !target || !population) throw new ConfigIncomplete(missing);

  const overrides = simulation.overrides;
  const config = PopulaceConfigSchema.parse({
    version: 2,
    simulation: {
      id: simulation.id,
      slug: simulation.slug,
      name: simulation.name,
      mode: simulation.mode,
      visitsPerPerson: simulation.visitsPerPerson,
      autoSweep: simulation.autoSweep,
    },
    // The target's tool policy is resolved into the config the runner sees, alongside the address
    // and the reset hook. The runner merges it with each persona's; nothing else may.
    target: { name: target.name, mcp: target.mcp, ...(target.webBaseUrl ? { webBaseUrl: target.webBaseUrl } : {}), ...(target.description ? { description: target.description } : {}), tools: target.tools, reset: target.reset },
    identity: target.identity,
    // The simulation's overrides layer over the project's settings field-wise, exactly as a
    // persona's model override layers over the global one. An unset field falls through.
    model: resolveModel(settings.model, overrides.model),
    guardrails: { ...settings.guardrails, ...overrides.guardrails, perWake: { ...settings.guardrails.perWake, ...overrides.guardrails.perWake } },
    verifier: { ...settings.verifier, ...overrides.verifier, model: { ...settings.verifier.model, ...overrides.verifier.model } },
    daemon: settings.daemon,
    store: process.store,
    digestDir: process.digestDir,
    population: {
      id: population.slug,
      name: population.name,
      members,
      // The execution plan is the simulation's, not the project's: `maxWakes` IS
      // `visitsPerPerson`, which is the whole mechanism by which an ephemeral run ends on its own.
      cadence: simulation.cadence,
      maxWakes: simulation.visitsPerPerson,
      seed: simulation.seed,
    },
  });
  return { config, simulation, target, population, cohorts, personas };
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
    members.push({ cohortId: cohort.id, size: lanes.reduce((sum, member) => sum + member.count, 0) });
  }

  const population = await ensurePopulation(store, projectId);
  const stored: StoredPopulation = { ...population, slug: config.population.id, name: config.population.name, members, updatedAt: at };
  await store.savePopulation(stored);
  for (const member of members) await ensureRoster(store, member.cohortId);

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

  // One simulation per file, pointing at the target and the population this import just wrote.
  // The cap decides the mode: a file that names a visit cap describes something that ENDS, which
  // is what ephemeral means; one that does not describes a soak, which is longitudinal.
  const simulations = options.simulations ?? [simulationPlanOf(config)];
  const created: Simulation[] = [];
  const taken = new Set<string>();
  for (const plan of simulations) {
    const base = slugify(plan.slug) || DEFAULT_SIMULATION_SLUG;
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);
    created.push(
      await createSimulation(store, {
        projectId,
        slug,
        name: plan.name,
        ...(plan.description === undefined ? {} : { description: plan.description }),
        populationId: stored.id,
        targetId: target.id,
        visitsPerPerson: plan.visitsPerPerson,
        cadence: plan.cadence,
        seed: plan.seed,
        ...(plan.autoSweep === undefined ? {} : { autoSweep: plan.autoSweep }),
        ...(plan.requireFreshTarget === undefined ? {} : { requireFreshTarget: plan.requireFreshTarget }),
      }),
    );
  }
  return { seeded: true, reason: `imported ${members.length} cohort(s), ${created.length} simulation(s) and the ${config.target.name} target` };
}

/** What a redacted secret is replaced by, so a reader can see that one was used. */
const REDACTED = "[redacted]";

/** Header names that hold a credential. Deliberately broad: a false positive costs a reader a word. */
const SECRETISH = /auth|token|key|secret|cookie/i;

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
  return { config: { ...config, target: { ...config.target, mcp, reset }, model, identity }, redacted };
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

import { createHash } from "node:crypto";
import {
  DEFAULT_PROJECT_ID,
  PopulaceConfigSchema,
  newCohortId,
  newPersonaId,
  newPopulationId,
  newTargetId,
  seededRoster,
  JsonValueSchema,
  type Cohort,
  type ConfigSnapshot,
  type JsonValue,
  type PopulaceConfig,
  type Project,
  type Store,
  type StoredPersona,
  type StoredPopulation,
  type StoredSettings,
  type StoredTarget,
} from "@populace/core";

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

export async function ensureProject(store: Store, projectId = DEFAULT_PROJECT_ID): Promise<Project> {
  const existing = await store.getProject(projectId);
  if (existing) return existing;
  const at = now();
  const project: Project = {
    id: projectId,
    slug: projectId === DEFAULT_PROJECT_ID ? DEFAULT_PROJECT_ID : projectId,
    name: projectId === DEFAULT_PROJECT_ID ? "Default" : projectId,
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
    identity: { strategy: "self-signup", signupTool: "unset" },
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
 * The project's one population row. Populations become plural at M4; until then a project has
 * exactly one and the UI edits it by adding and removing cohorts.
 */
export async function ensurePopulation(store: Store, projectId = DEFAULT_PROJECT_ID): Promise<StoredPopulation> {
  const existing = (await store.listPopulations(projectId))[0];
  if (existing) return existing;
  const at = now();
  const population: StoredPopulation = {
    id: newPopulationId(),
    projectId,
    slug: "everyone",
    name: "Everyone",
    cohortIds: [],
    createdAt: at,
    updatedAt: at,
  };
  await store.savePopulation(population);
  return population;
}

/**
 * The population's cohorts, in the population's own order.
 *
 * `population.cohortIds` is authoritative in both directions. A cohort id that no longer resolves
 * is dropped rather than throwing — the population row is composition and a dangling reference is
 * a display problem, not a reason to refuse to run. A cohort the population does NOT hold is not
 * added back: this is the list that decides who is expanded into agents and spends money, and a
 * project can hold cohorts outside its population (a YAML import rewrites `cohortIds` and leaves
 * whatever was authored in the browser behind). Those belong to a library listing, not here.
 */
export async function cohortsOf(store: Store, projectId = DEFAULT_PROJECT_ID): Promise<Cohort[]> {
  const population = await ensurePopulation(store, projectId);
  const byId = new Map((await store.listCohorts(projectId)).map((cohort) => [cohort.id, cohort]));
  return population.cohortIds.flatMap((id) => {
    const cohort = byId.get(id);
    return cohort ? [cohort] : [];
  });
}

/**
 * Sets the headcount of the cohort on `personaId`, creating it on the way up and removing it on
 * the way to zero. One cohort per persona is what the setup UI can express today; the data model
 * allows several, and stage 3's composition screen is what will let a user say so.
 *
 * `maxWakes` is the cohort's own visit cap, which overrides the population's for this group alone
 * (SPEC §2.4). Leaving it `undefined` leaves whatever is stored alone; `null` clears it.
 */
export async function setCohortSize(store: Store, projectId: string, persona: StoredPersona, count: number, maxWakes?: number | null): Promise<void> {
  const population = await ensurePopulation(store, projectId);
  const cohorts = await store.listCohorts(projectId);
  const existing = cohorts.find((cohort) => cohort.personaId === persona.id);
  const at = now();
  if (count <= 0) {
    if (!existing) return;
    // The population lets go first: the store refuses to delete a cohort a population still holds,
    // and naming the referrer is the point of that refusal (SPEC §2.14).
    await store.savePopulation({ ...population, cohortIds: population.cohortIds.filter((id) => id !== existing.id), updatedAt: at });
    await store.deleteCohort(existing.id);
    return;
  }
  const base: Cohort = existing
    ? { ...existing, size: count, updatedAt: at }
    : { id: newCohortId(), projectId, slug: persona.slug, name: persona.spec.name, personaId: persona.id, size: count, seed: "populace", notes: "", createdAt: at, updatedAt: at };
  const cap = maxWakes === undefined ? base.maxWakes : (maxWakes ?? undefined);
  const cohort: Cohort = { ...base };
  if (cap === undefined) delete cohort.maxWakes;
  else cohort.maxWakes = cap;
  await store.saveCohort(cohort);
  if (!population.cohortIds.includes(cohort.id)) await store.savePopulation({ ...population, cohortIds: [...population.cohortIds, cohort.id], updatedAt: at });
}

export interface ResolvedProject {
  config: PopulaceConfig;
  target: StoredTarget;
  population: StoredPopulation;
  cohorts: Cohort[];
  personas: StoredPersona[];
}

/** Why a project cannot be run yet, in the words the screen shows. */
export class ConfigIncomplete extends Error {
  constructor(readonly missing: string[]) {
    super(missing.join("; "));
    this.name = "ConfigIncomplete";
  }
}

/**
 * Assembles the authored rows into the object `runWake()` already takes. Throws `ConfigIncomplete`
 * rather than returning a half-built config, because a run started on a config with no target is
 * a run that spends money to fail.
 */
export async function resolveProjectConfig(store: Store, process: ProcessConfig, projectId = DEFAULT_PROJECT_ID): Promise<ResolvedProject> {
  const missing: string[] = [];
  const target = (await store.listTargets(projectId))[0];
  if (!target) missing.push("no target is set up yet");
  const population = await ensurePopulation(store, projectId);
  const cohorts = await cohortsOf(store, projectId);
  const settings = await ensureSettings(store, projectId);
  const personas = await store.listPersonas(projectId);
  const byId = new Map(personas.map((p) => [p.id, p]));

  const members = cohorts.flatMap((cohort) => {
    const persona = byId.get(cohort.personaId);
    if (!persona) {
      missing.push(`the ${cohort.name} cohort points at a persona that no longer exists (${cohort.personaId})`);
      return [];
    }
    return [
      {
        // The cohort slug is what agent ids are built from, and the persona is inlined with its
        // immutable slug as the id: a continuation matches on both, so neither may follow a
        // display-name rename (`DATA-MODEL.md` §5).
        cohort: cohort.slug,
        cohortName: cohort.name,
        persona: { ...persona.spec, id: persona.slug },
        count: cohort.size,
        seed: cohort.seed,
        // The cast is frozen into the snapshot, so a three-month-old execution still renders the
        // right names. Stage 3 reads stored `Person` rows here; until then the seeded tier writes
        // exactly what those rows would have held for the same seed.
        people: seededRoster(cohort.slug, cohort.seed, cohort.size),
        ...(cohort.cadence ? { cadence: cohort.cadence } : {}),
        ...(cohort.maxWakes === undefined ? {} : { maxWakes: cohort.maxWakes }),
      },
    ];
  });
  if (members.length === 0) missing.push("nobody is in the population yet");
  if (missing.length || !target) throw new ConfigIncomplete(missing);

  const config = PopulaceConfigSchema.parse({
    version: 2,
    // Project-scoped even while it is a placeholder: the id lands in durable rows (`runs.seq`,
    // snapshots, digests) and two projects sharing one simulation id would pool their executions.
    simulation: { id: `sim_local:${projectId}`, name: `${target.name} — ${population.name}` },
    target: { name: target.name, mcp: target.mcp, ...(target.webBaseUrl ? { webBaseUrl: target.webBaseUrl } : {}), ...(target.description ? { description: target.description } : {}), reset: target.reset },
    identity: target.identity,
    model: settings.model,
    guardrails: settings.guardrails,
    verifier: settings.verifier,
    daemon: settings.daemon,
    store: process.store,
    digestDir: process.digestDir,
    population: {
      id: population.slug,
      name: population.name,
      members,
      cadence: settings.cadence,
      maxWakes: settings.maxWakes,
      seed: settings.seed,
    },
  });
  return { config, target, population, cohorts, personas };
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
export async function seedProjectFromConfig(store: Store, config: PopulaceConfig, projectId = DEFAULT_PROJECT_ID): Promise<{ seeded: boolean; reason: string }> {
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
    reset: config.target.reset,
    createdAt: at,
    updatedAt: at,
  };
  await store.saveTarget(target);

  const existingPersonas = new Map((await store.listPersonas(projectId)).map((p) => [p.slug, p]));
  const existingCohorts = new Map((await store.listCohorts(projectId)).map((cohort) => [cohort.slug, cohort]));
  const cohortIds: string[] = [];
  for (const member of config.population.members) {
    const slug = member.persona.id;
    let persona = existingPersonas.get(slug);
    if (!persona) {
      persona = { id: newPersonaId(), projectId, slug, spec: member.persona, origin: "imported", createdAt: at, updatedAt: at };
      await store.savePersona(persona);
      existingPersonas.set(slug, persona);
    }
    const existing = existingCohorts.get(member.cohort);
    const cohort: Cohort = {
      id: existing?.id ?? newCohortId(),
      projectId,
      slug: member.cohort,
      name: member.cohortName,
      personaId: persona.id,
      size: member.count,
      seed: member.seed,
      notes: "",
      ...(member.cadence ? { cadence: member.cadence } : {}),
      ...(member.maxWakes === undefined ? {} : { maxWakes: member.maxWakes }),
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    };
    await store.saveCohort(cohort);
    existingCohorts.set(cohort.slug, cohort);
    cohortIds.push(cohort.id);
  }

  const population = await ensurePopulation(store, projectId);
  await store.savePopulation({ ...population, slug: config.population.id, name: config.population.name, cohortIds, updatedAt: at });

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
  return { seeded: true, reason: `imported ${cohortIds.length} cohort(s) and the ${config.target.name} target` };
}

/** What a redacted secret is replaced by, so a reader can see that one was used. */
const REDACTED = "[redacted]";

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
      if (/auth|token|key|secret|cookie/i.test(key)) {
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
  return { config: { ...config, target: { ...config.target, mcp }, model }, redacted };
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

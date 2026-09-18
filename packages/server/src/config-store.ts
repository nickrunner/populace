import { createHash } from "node:crypto";
import {
  DEFAULT_PROJECT_ID,
  PopulaceConfigSchema,
  newPersonaId,
  newPopulationId,
  newTargetId,
  JsonValueSchema,
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
  const project: Project = { id: projectId, name: projectId === DEFAULT_PROJECT_ID ? "Default" : projectId, createdAt: now() };
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
  const settings: StoredSettings = { projectId, model: base.model, guardrails: base.guardrails, verifier: base.verifier, daemon: base.daemon, updatedAt: now() };
  await store.saveSettings(settings);
  return settings;
}

/**
 * The project's one population row. Populations become plural at M4; until then a project has
 * exactly one and the UI edits it by adding and removing members.
 */
export async function ensurePopulation(store: Store, projectId = DEFAULT_PROJECT_ID): Promise<StoredPopulation> {
  const existing = (await store.listPopulations(projectId))[0];
  if (existing) return existing;
  const population: StoredPopulation = {
    id: newPopulationId(),
    projectId,
    slug: "everyone",
    members: [],
    scale: 1,
    cadence: { every: 600_000, jitter: 0, initialDelay: 0 },
    seed: "populace",
    createdAt: now(),
    updatedAt: now(),
  };
  await store.savePopulation(population);
  return population;
}

export interface ResolvedProject {
  config: PopulaceConfig;
  target: StoredTarget;
  population: StoredPopulation;
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
  const settings = await ensureSettings(store, projectId);
  const personas = await store.listPersonas(projectId);
  const byId = new Map(personas.map((p) => [p.id, p]));

  const members = population.members.flatMap((member) => {
    const persona = byId.get(member.personaId);
    if (!persona) {
      missing.push(`a population member points at a person who no longer exists (${member.personaId})`);
      return [];
    }
    return [
      {
        // The snapshot and the runner see the persona inlined, with its immutable slug as the id:
        // agent ids are `populationId/personaId#ordinal`, so this is what a continuation matches on
        // and it must not follow a display-name rename (`DATA-MODEL.md` §5).
        persona: { ...persona.spec, id: persona.slug },
        count: member.count,
        ...(member.cadence ? { cadence: member.cadence } : {}),
        ...(member.maxWakes === undefined ? {} : { maxWakes: member.maxWakes }),
      },
    ];
  });
  if (members.length === 0) missing.push("nobody is in the population yet");
  if (missing.length || !target) throw new ConfigIncomplete(missing);

  const config = PopulaceConfigSchema.parse({
    version: 1,
    target: { name: target.name, mcp: target.mcp, ...(target.webBaseUrl ? { webBaseUrl: target.webBaseUrl } : {}), ...(target.description ? { description: target.description } : {}) },
    identity: target.identity,
    model: settings.model,
    guardrails: settings.guardrails,
    verifier: settings.verifier,
    daemon: settings.daemon,
    store: process.store,
    digestDir: process.digestDir,
    population: {
      id: population.slug,
      members,
      scale: population.scale,
      cadence: population.cadence,
      ...(population.maxWakes === undefined ? {} : { maxWakes: population.maxWakes }),
      seed: population.seed,
    },
  });
  return { config, target, population, personas };
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
    name: config.target.name,
    mcp: config.target.mcp,
    ...(config.target.webBaseUrl ? { webBaseUrl: config.target.webBaseUrl } : {}),
    ...(config.target.description ? { description: config.target.description } : {}),
    identity: config.identity,
    createdAt: at,
    updatedAt: at,
  };
  await store.saveTarget(target);

  const existingPersonas = new Map((await store.listPersonas(projectId)).map((p) => [p.slug, p]));
  const members: StoredPopulation["members"] = [];
  for (const member of config.population.members) {
    const slug = member.persona.id;
    let persona = existingPersonas.get(slug);
    if (!persona) {
      persona = { id: newPersonaId(), projectId, slug, spec: member.persona, origin: "imported", createdAt: at, updatedAt: at };
      await store.savePersona(persona);
      existingPersonas.set(slug, persona);
    }
    members.push({
      personaId: persona.id,
      count: member.count,
      ...(member.cadence ? { cadence: member.cadence } : {}),
      ...(member.maxWakes === undefined ? {} : { maxWakes: member.maxWakes }),
    });
  }

  const population = await ensurePopulation(store, projectId);
  await store.savePopulation({
    ...population,
    slug: config.population.id,
    members,
    scale: config.population.scale,
    cadence: config.population.cadence,
    ...(config.population.maxWakes === undefined ? {} : { maxWakes: config.population.maxWakes }),
    seed: config.population.seed,
    updatedAt: at,
  });

  await store.saveSettings({ projectId, model: config.model, guardrails: config.guardrails, verifier: config.verifier, daemon: config.daemon, updatedAt: at });
  return { seeded: true, reason: `imported ${members.length} person(s) and the ${config.target.name} target` };
}

/** What a redacted secret is replaced by, so a reader can see that one was used. */
export const REDACTED = "[redacted]";

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
 * Puts the live credentials back into a config that came out of a snapshot.
 *
 * A snapshot is the record of *what ran* and deliberately carries `[redacted]` in place of every
 * secret, because it gets copied around and attached to bug reports. Two things read a snapshot
 * and then open a connection with it — the verifier replaying a finding's tool calls, and sweep
 * deleting the accounts a run created — and against an authenticated target both would send
 * `Authorization: Bearer [redacted]`. Replay would 401, every finding would come back
 * `not-reproduced`, the digest would drop them without a word, and sweep would leave real accounts
 * on someone's product.
 *
 * So the snapshot stays redacted and the credential is put back at the point of use, from the
 * authored `targets` row, which is the only place a secret lives. An endpoint whose credential is
 * gone fails loudly here rather than connecting with a placeholder.
 *
 * `model.apiKey` is different and is not put back: it is a property of the process, never of a row
 * (`history.ts` refuses to persist one), so there is nowhere to read it from. It is dropped rather
 * than left as `[redacted]`, because a caller that built a provider from this config would
 * otherwise send the placeholder as a key and get a 401 that reads like a model outage. Dropping
 * it lands on the same fallback every command already uses, `process.env.ANTHROPIC_API_KEY`.
 */
export async function withLiveCredentials(store: Store, snapshot: PopulaceConfig, projectId = DEFAULT_PROJECT_ID): Promise<PopulaceConfig> {
  const config = snapshot.model.apiKey === REDACTED ? { ...snapshot, model: { ...snapshot.model, apiKey: undefined } } : snapshot;
  const needsToken = config.target.mcp.some((e) => e.bearerToken === REDACTED || Object.values(e.headers).includes(REDACTED));
  if (!needsToken) return config;

  const live = (await store.listTargets(projectId)).flatMap((target) => target.mcp);
  const byName = new Map(live.map((e) => [e.name, e]));
  const byUrl = new Map(live.map((e) => [e.url, e]));
  const mcp = config.target.mcp.map((endpoint) => {
    // Name first, url second: an endpoint that was renamed is still the same endpoint, and one
    // that moved is still the one that answers at that name.
    const source = byName.get(endpoint.name) ?? byUrl.get(endpoint.url);
    const headers = { ...endpoint.headers };
    for (const [key, value] of Object.entries(headers)) {
      if (value !== REDACTED) continue;
      const replacement = source?.headers[key];
      if (replacement === undefined) throw new Error(`the ${key} header for the ${endpoint.name} endpoint is not in this project's target any more; reconnect the target and try again`);
      headers[key] = replacement;
    }
    if (endpoint.bearerToken !== REDACTED) return { ...endpoint, headers };
    if (source?.bearerToken === undefined) throw new Error(`the credential for the ${endpoint.name} endpoint is not in this project's target any more; reconnect the target and try again`);
    return { ...endpoint, bearerToken: source.bearerToken, headers };
  });
  return { ...config, target: { ...config.target, mcp } };
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

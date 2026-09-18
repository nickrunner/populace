import {
  AuthoredDocumentSchema,
  PopulaceConfigSchema,
  newPersonaId,
  newRevisionId,
  newTargetId,
  tagForRun,
  type AuthoredDocument,
  type ConfigRevision,
  type PopulaceConfig,
  type Store,
  type StoredPersona,
  type StoredPopulation,
  type StoredTarget,
} from "@populace/core";
import { ensurePopulation, ensureProject, ensureSettings } from "./config-store.js";

/**
 * The authored layer's history (`DATA-MODEL.md` §5), and the YAML import that writes over it.
 *
 * M2 is the first release where a person's work lives in the database rather than in a file they
 * had in version control, and the first where the dashboard can overwrite that work in one click.
 * A revision is the cheapest correct undo: a copy of every authored row, taken around each change,
 * with a line saying what the change was.
 */

/** How many revisions a project keeps. Old enough to undo a bad afternoon, small enough to ignore. */
export const REVISIONS_KEPT = 50;

function now(): string {
  return new Date().toISOString();
}

/** Every authored row of one project, as one value. */
export async function captureAuthored(store: Store, projectId: string): Promise<AuthoredDocument> {
  const [targets, personas, population, settings] = await Promise.all([
    store.listTargets(projectId),
    store.listPersonas(projectId),
    ensurePopulation(store, projectId),
    ensureSettings(store, projectId),
  ]);
  return AuthoredDocumentSchema.parse({ version: 1, targets, personas, population, settings });
}

/**
 * The targets a run still needs, mapped to how many runs need each.
 *
 * A run keeps its `targetId` and its accounts on the product long after it has finished, until
 * someone sweeps it. Sweep and verification both go through `withLiveCredentials`, which reads the
 * credential out of the authored `targets` row — so deleting that row strands the accounts, and
 * the only way back is recreating a target with the same endpoint name *and* the same token, which
 * the person may no longer have. The authored layer cannot see the produced layer, so this is the
 * one place that looks the other way across (`DATA-MODEL.md` §5).
 */
export async function targetsInUse(store: Store, projectId: string): Promise<Map<string, number>> {
  const inUse = new Map<string, number>();
  for (const run of await store.listRuns({ projectId })) {
    if (run.targetId === "") continue;
    const live = await store.listIdentitiesByTag(tagForRun(run.id));
    if (live.length === 0) continue;
    inUse.set(run.targetId, (inUse.get(run.targetId) ?? 0) + 1);
  }
  return inUse;
}

/**
 * Writes a captured document back, removing rows that are not in it. A restore that only added
 * would leave behind the person you deleted, which is not what "put it back the way it was" means.
 *
 * A target a run still has accounts on is the exception: it is kept rather than dropped, because
 * restoring an old config should not cost someone the ability to clean up after a run they already
 * finished. The revision is the authored layer's history; the accounts are not in it.
 *
 * The population row keeps its own id whatever the document says, so member references stay valid
 * and nothing else in the database has to be re-pointed.
 */
export async function applyAuthored(store: Store, projectId: string, document: AuthoredDocument): Promise<void> {
  const at = now();
  const targetIds = new Set(document.targets.map((t) => t.id));
  const keep = await targetsInUse(store, projectId);
  for (const existing of await store.listTargets(projectId)) {
    if (!targetIds.has(existing.id) && !keep.has(existing.id)) await store.deleteTarget(existing.id);
  }
  for (const target of document.targets) await store.saveTarget({ ...target, projectId, updatedAt: at });

  const personaIds = new Set(document.personas.map((p) => p.id));
  for (const existing of await store.listPersonas(projectId)) {
    if (!personaIds.has(existing.id)) await store.deletePersona(existing.id);
  }
  for (const persona of document.personas) await store.savePersona({ ...persona, projectId, updatedAt: at });

  const population = await ensurePopulation(store, projectId);
  // Members that point at a person the document does not carry would break config resolution, so
  // they are dropped here rather than discovered when someone next presses start.
  const members = document.population.members.filter((member) => personaIds.has(member.personaId));
  await store.savePopulation({ ...document.population, id: population.id, projectId, members, updatedAt: at });
  await store.saveSettings({ ...document.settings, projectId, updatedAt: at });
}

/**
 * Runs a change to the authored layer with an undo point on each side of it.
 *
 * The first change to a project also records where it started, because a history whose oldest
 * entry is "after your first edit" cannot take you back to before it.
 */
export async function withRevision<T>(
  store: Store,
  projectId: string,
  change: { summary: string; source: ConfigRevision["source"] },
  mutate: () => Promise<T>,
): Promise<T> {
  const existing = await store.listConfigRevisions(projectId, 1);
  if (existing.length === 0) {
    await save(store, { projectId, summary: "before the first change", source: "baseline", document: await captureAuthored(store, projectId) });
  }
  const result = await mutate();
  await save(store, { projectId, summary: change.summary, source: change.source, document: await captureAuthored(store, projectId) });
  return result;
}

async function save(store: Store, revision: Omit<ConfigRevision, "id" | "at">): Promise<ConfigRevision> {
  const saved: ConfigRevision = { ...revision, id: newRevisionId(), at: now() };
  await store.saveConfigRevision(saved);
  await store.pruneConfigRevisions(revision.projectId, REVISIONS_KEPT);
  return saved;
}

/**
 * A revision as the `PopulaceConfig` it would resolve to, so a past config can be read as YAML
 * before anyone puts it back. Returns null when the revision predates a target or a population,
 * which is a normal state for the baseline written before someone's first change: there is
 * genuinely no runnable config to render.
 */
export function renderRevision(document: AuthoredDocument): PopulaceConfig | null {
  const target = document.targets[0];
  const byId = new Map(document.personas.map((p) => [p.id, p]));
  const members = document.population.members.flatMap((member) => {
    const persona = byId.get(member.personaId);
    if (!persona) return [];
    return [
      {
        persona: { ...persona.spec, id: persona.slug },
        count: member.count,
        ...(member.cadence ? { cadence: member.cadence } : {}),
        ...(member.maxWakes === undefined ? {} : { maxWakes: member.maxWakes }),
      },
    ];
  });
  if (!target || members.length === 0) return null;
  const { apiKey: _apiKey, ...model } = document.settings.model;
  return PopulaceConfigSchema.parse({
    version: 1,
    target: { name: target.name, mcp: target.mcp, ...(target.webBaseUrl ? { webBaseUrl: target.webBaseUrl } : {}), ...(target.description ? { description: target.description } : {}) },
    identity: target.identity,
    model,
    guardrails: document.settings.guardrails,
    verifier: document.settings.verifier,
    daemon: document.settings.daemon,
    population: {
      id: document.population.slug,
      members,
      scale: document.population.scale,
      cadence: document.population.cadence,
      ...(document.population.maxWakes === undefined ? {} : { maxWakes: document.population.maxWakes }),
      seed: document.population.seed,
    },
  });
}

/**
 * An exported file names its secrets as `${VAR}` placeholders rather than carrying them, so a
 * file re-imported on a machine without those variables set arrives with the credential blank.
 * Writing that blank over a working target would quietly break every run, so a blank credential
 * keeps whatever is stored — exactly as the target form does, which never sees a saved token
 * either.
 */
function mergeCredentials(incoming: PopulaceConfig["target"]["mcp"], existing: PopulaceConfig["target"]["mcp"]): { mcp: PopulaceConfig["target"]["mcp"]; keptCredentials: string[] } {
  const byName = new Map(existing.map((e) => [e.name, e]));
  const byUrl = new Map(existing.map((e) => [e.url, e]));
  const keptCredentials: string[] = [];
  const mcp = incoming.map((endpoint) => {
    const previous = byName.get(endpoint.name) ?? byUrl.get(endpoint.url);
    const headers = { ...endpoint.headers };
    for (const [key, value] of Object.entries(headers)) {
      const kept = previous?.headers[key];
      if (value !== "" || kept === undefined) continue;
      headers[key] = kept;
      keptCredentials.push(`${endpoint.name}.${key}`);
    }
    if (endpoint.bearerToken !== undefined && endpoint.bearerToken !== "") return { ...endpoint, headers };
    if (previous?.bearerToken === undefined) {
      const { bearerToken: _blank, ...rest } = endpoint;
      return { ...rest, headers };
    }
    // An exported file names its secret rather than carrying it, so this is the ordinary case for
    // a round trip and the reader is told it happened rather than left to wonder.
    keptCredentials.push(endpoint.name);
    return { ...endpoint, bearerToken: previous.bearerToken, headers };
  });
  return { mcp, keptCredentials: [...new Set(keptCredentials)] };
}

export interface ImportResult {
  /** What changed, in the words the screen shows. */
  lines: string[];
  personas: number;
  replacedTarget: boolean;
}

/**
 * Writes a parsed config over a project's authored rows (ADR-0025).
 *
 * This is deliberately not `seedProjectFromConfig`, which seeds an empty project once and refuses
 * to touch one that has been edited. Someone who pastes a file into the import box has *asked* for
 * their config to be replaced, so it is replaced — and the revision recorded around it is what
 * makes that safe to have asked for.
 *
 * People are matched by slug, not by row id: a re-import of a file that has been edited elsewhere
 * updates the same person rather than creating a second one with the same agent ids.
 */
export async function importConfig(store: Store, config: PopulaceConfig, projectId: string): Promise<ImportResult> {
  await ensureProject(store, projectId);
  const lines: string[] = [];
  const at = now();

  const existingTargets = await store.listTargets(projectId);
  const first = existingTargets[0];
  const { mcp, keptCredentials } = mergeCredentials(config.target.mcp, first?.mcp ?? []);
  const target: StoredTarget = {
    id: first?.id ?? newTargetId(),
    projectId,
    name: config.target.name,
    mcp,
    ...(config.target.webBaseUrl ? { webBaseUrl: config.target.webBaseUrl } : {}),
    ...(config.target.description ? { description: config.target.description } : {}),
    identity: config.identity,
    createdAt: first?.createdAt ?? at,
    updatedAt: at,
  };
  await store.saveTarget(target);
  for (const extra of existingTargets.slice(1)) await store.deleteTarget(extra.id);
  lines.push(first ? `replaced the target with ${config.target.name}` : `set the target to ${config.target.name}`);
  if (keptCredentials.length) lines.push(`kept the stored credential for ${keptCredentials.join(", ")}, which the file names but does not carry`);

  const bySlug = new Map((await store.listPersonas(projectId)).map((p) => [p.slug, p]));
  const members: StoredPopulation["members"] = [];
  const imported = new Set<string>();
  for (const member of config.population.members) {
    const slug = member.persona.id;
    const existing = bySlug.get(slug);
    const persona: StoredPersona = {
      id: existing?.id ?? newPersonaId(),
      projectId,
      slug,
      spec: member.persona,
      origin: existing?.origin === "authored" ? "authored" : "imported",
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    };
    await store.savePersona(persona);
    imported.add(slug);
    members.push({
      personaId: persona.id,
      count: member.count,
      ...(member.cadence ? { cadence: member.cadence } : {}),
      ...(member.maxWakes === undefined ? {} : { maxWakes: member.maxWakes }),
    });
  }
  lines.push(`${members.length} ${members.length === 1 ? "person" : "people"} in the population`);

  // Someone the file does not mention stays written down but goes home: the import replaces the
  // population, and deleting a person nobody asked to delete would throw away their work.
  const parked = [...bySlug.keys()].filter((slug) => !imported.has(slug));
  if (parked.length) lines.push(`${parked.length} ${parked.length === 1 ? "person is" : "people are"} not in this file and stay out of the next run (${parked.join(", ")})`);

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

  const settings = await ensureSettings(store, projectId);
  // `apiKey` is a property of the process, never of a row: an imported file that carries one is
  // ignored here rather than writing a secret into the database from a paste box.
  const { apiKey: _apiKey, ...model } = config.model;
  await store.saveSettings({ ...settings, projectId, model: { ...model }, guardrails: config.guardrails, verifier: config.verifier, daemon: config.daemon, updatedAt: at });
  lines.push("limits, model and verifier settings replaced");

  return { lines, personas: members.length, replacedTarget: first !== undefined };
}

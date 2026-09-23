import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CadenceSchema, PersonaSpecSchema, PopulaceConfigSchema, apportion, type PersonaSpec, type PopulaceConfig } from "@populace/core";
import type { SimulationPlan } from "@populace/server";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export interface LoadedConfig {
  config: PopulaceConfig;
  /**
   * The file's `simulations:` block, for the import that turns a file into rows. The FIRST one is
   * the plan `config` carries, because a CLI command runs one simulation; the rest are created as
   * rows by `populace serve` and picked in the browser.
   */
  simulations: SimulationPlan[];
  path: string;
  dir: string;
}

/** Replaces `${VAR}` with the environment value; unset variables become empty strings and are reported. */
export function substituteEnv(text: string, env: NodeJS.ProcessEnv = process.env): { text: string; missing: string[] } {
  const missing: string[] = [];
  const out = text.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, name: string) => {
    const value = env[name];
    if (value === undefined) missing.push(name);
    return value ?? "";
  });
  return { text: out, missing: [...new Set(missing)] };
}

/** A persona written inline, or the path of a file holding one. */
const RawPersonaSchema = z.union([z.string(), z.record(z.string(), z.json())]);

const RawMemberSchema = z.looseObject({ persona: RawPersonaSchema });

/**
 * A cohort as the file writes it (ADR-0039): what its people share, which personas they are drawn
 * from and in what ratio, and how many of them the file's population sends. `persona:` alone is
 * the mix of one. `population.members` is still accepted — a member is a lane, and always was.
 */
const RawMixEntrySchema = z.object({ persona: RawPersonaSchema, weight: z.number().positive().optional() });

const RawCohortSchema = z.object({
  slug: z.string().optional(),
  name: z.string().optional(),
  /** What everybody in the cohort has in common, addressed to them. */
  context: z.string().optional(),
  /** Which personas, in what ratio. Either this or `persona`. */
  mix: z.array(RawMixEntrySchema).min(1).optional(),
  persona: RawPersonaSchema.optional(),
  /** How many people this file's population sends from the cohort. There is no `scale`. */
  size: z.number().int().positive().optional(),
  traits: z.record(z.string(), z.json()).optional(),
  tools: z.record(z.string(), z.json()).optional(),
  model: z.record(z.string(), z.json()).optional(),
  seed: z.string().optional(),
  cadence: z.record(z.string(), z.json()).optional(),
  maxWakes: z.number().int().positive().optional(),
});

/** A simulation as the file writes it: the population against the target, in one of two modes. */
const RawSimulationSchema = z.object({
  slug: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  mode: z.enum(["ephemeral", "longitudinal"]).optional(),
  /** Required for `ephemeral` (it is what makes the execution end), absent for `longitudinal`. */
  visitsPerPerson: z.number().int().positive().nullable().optional(),
  cadence: z.record(z.string(), z.json()).optional(),
  seed: z.string().optional(),
  autoSweep: z.boolean().optional(),
  requireFreshTarget: z.boolean().optional(),
});

const RawConfigSchema = z.looseObject({
  population: z.looseObject({ members: z.array(RawMemberSchema).optional() }).optional(),
  cohorts: z.array(RawCohortSchema).optional(),
  simulations: z.array(RawSimulationSchema).optional(),
});

/** Loads YAML, substitutes env, resolves `persona: file.yaml` references and validates. */
export function loadConfig(path = "populace.yaml"): LoadedConfig {
  const absolute = resolve(path);
  if (!existsSync(absolute)) throw new Error(`config not found: ${absolute} (run \`populace init\` to create one)`);
  const dir = dirname(absolute);
  const { text, missing } = substituteEnv(readFileSync(absolute, "utf8"));
  if (missing.length) console.warn(`warning: environment variables not set: ${missing.join(", ")}`);
  // eslint-disable-next-line no-restricted-syntax -- YAML boundary, validated with zod below.
  const raw = RawConfigSchema.parse(parseYaml(text) as unknown);

  type RawPersona = z.infer<typeof RawPersonaSchema>;
  const personaOf = (ref: RawPersona): PersonaSpec | Exclude<RawPersona, string> => {
    if (typeof ref !== "string") return ref;
    // eslint-disable-next-line no-restricted-syntax -- YAML boundary, validated with zod.
    return PersonaSpecSchema.parse(parseYaml(readFileSync(resolve(dir, ref), "utf8")) as unknown);
  };

  const members = [
    ...(raw.population?.members ?? []).map((member) => ({ ...member, persona: personaOf(member.persona) })),
    // A cohort resolves into one member per LANE — one per persona in its mix, each with the
    // share of `size` the ratio gives it — so a member list and a cohort list are one list.
    ...(raw.cohorts ?? []).flatMap((cohort) => {
      const entries = cohort.mix ?? (cohort.persona === undefined ? [] : [{ persona: cohort.persona, weight: 1 }]);
      if (entries.length === 0) throw new Error(`cohort ${cohort.slug ?? cohort.name ?? "?"}: name a persona, or a mix of them`);
      const counts = apportion(cohort.size ?? 1, entries.map((entry) => entry.weight ?? 1));
      const shared = {
        ...(cohort.slug === undefined ? {} : { cohort: cohort.slug }),
        ...(cohort.name === undefined ? {} : { cohortName: cohort.name }),
        ...(cohort.context === undefined ? {} : { context: cohort.context }),
        ...(cohort.traits === undefined ? {} : { traits: cohort.traits }),
        ...(cohort.tools === undefined ? {} : { tools: cohort.tools }),
        ...(cohort.model === undefined ? {} : { model: cohort.model }),
        ...(cohort.seed === undefined ? {} : { seed: cohort.seed }),
        ...(cohort.cadence === undefined ? {} : { cadence: cohort.cadence }),
        ...(cohort.maxWakes === undefined ? {} : { maxWakes: cohort.maxWakes }),
      };
      return entries.flatMap((entry, index) => {
        const count = counts[index] ?? 0;
        return count === 0 ? [] : [{ ...shared, persona: personaOf(entry.persona), count }];
      });
    }),
  ];

  const simulations = (raw.simulations ?? []).map(planOf);
  const first = simulations[0];
  // The execution plan belongs to the simulation now. A file with no `simulations:` block keeps
  // saying it on the population, and the cap it names there is what decides the mode on import.
  const population = {
    ...raw.population,
    members,
    ...(first === undefined ? {} : { cadence: first.cadence, maxWakes: first.visitsPerPerson, seed: first.seed }),
  };
  const config = PopulaceConfigSchema.parse({
    ...raw,
    ...(first === undefined
      ? {}
      : {
          simulation: {
            slug: first.slug,
            name: first.name,
            mode: first.visitsPerPerson === null ? "longitudinal" : "ephemeral",
            visitsPerPerson: first.visitsPerPerson,
            ...(first.autoSweep === undefined ? {} : { autoSweep: first.autoSweep }),
          },
        }),
    population,
  });
  return { config, simulations, path: absolute, dir };
}

/**
 * One `simulations:` entry as a plan the importer can write as a row. `mode` and `visitsPerPerson`
 * are bound to each other — an ephemeral simulation has to end, a longitudinal one does not — so a
 * file that sets one and not the other is refused here rather than half-applied.
 */
function planOf(raw: z.infer<typeof RawSimulationSchema>, index: number): SimulationPlan {
  const slug = raw.slug ?? `simulation-${index + 1}`;
  const visitsPerPerson = raw.visitsPerPerson ?? null;
  if (raw.mode === "ephemeral" && visitsPerPerson === null) throw new Error(`simulation ${slug}: an ephemeral simulation has to end — give it visitsPerPerson`);
  if (raw.mode === "longitudinal" && visitsPerPerson !== null) throw new Error(`simulation ${slug}: a longitudinal simulation does not end — remove visitsPerPerson`);
  return {
    slug,
    name: raw.name ?? slug,
    ...(raw.description === undefined ? {} : { description: raw.description }),
    visitsPerPerson,
    cadence: CadenceSchema.parse(raw.cadence ?? {}),
    seed: raw.seed ?? "populace",
    ...(raw.autoSweep === undefined ? {} : { autoSweep: raw.autoSweep }),
    ...(raw.requireFreshTarget === undefined ? {} : { requireFreshTarget: raw.requireFreshTarget }),
  };
}

/**
 * The config file if there is one, and nothing if there is not.
 *
 * From M2 the database is the source of truth (ADR-0025), so `populace serve` has to start in a
 * directory with no `populace.yaml` at all — that is how a new user begins, and setting the target
 * up in the browser is the point. Every other command still needs a file and still says so.
 */
export function loadConfigIfPresent(path = "populace.yaml"): LoadedConfig | undefined {
  return existsSync(resolve(path)) ? loadConfig(path) : undefined;
}

/** Where the store goes when no config file has named one. */
export const DEFAULT_STORE_PATH = ".populace/populace.sqlite";

export function storePath(loaded: LoadedConfig): string {
  return loaded.config.store.path === ":memory:" ? ":memory:" : resolve(loaded.dir, loaded.config.store.path);
}

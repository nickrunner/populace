import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PersonaSpecSchema, PopulaceConfigSchema, substituteEnv, type PopulaceConfig } from "@populace/core";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export interface LoadedConfig {
  config: PopulaceConfig;
  path: string;
  dir: string;
}

const RawMemberSchema = z.looseObject({ persona: z.union([z.string(), z.record(z.string(), z.json())]) });
const RawConfigSchema = z.looseObject({ population: z.looseObject({ members: z.array(RawMemberSchema) }) });

/** Loads YAML, substitutes env, resolves `persona: file.yaml` references and validates. */
export function loadConfig(path = "populace.yaml"): LoadedConfig {
  const absolute = resolve(path);
  if (!existsSync(absolute)) throw new Error(`config not found: ${absolute} (run \`populace init\` to create one)`);
  const dir = dirname(absolute);
  const { text, missing } = substituteEnv(readFileSync(absolute, "utf8"), process.env);
  if (missing.length) console.warn(`warning: environment variables not set: ${missing.join(", ")}`);
  // eslint-disable-next-line no-restricted-syntax -- YAML boundary, validated with zod below.
  const raw = RawConfigSchema.parse(parseYaml(text) as unknown);
  const members = raw.population.members.map((member) => {
    if (typeof member.persona !== "string") return member;
    const personaPath = resolve(dir, member.persona);
    // eslint-disable-next-line no-restricted-syntax -- YAML boundary, validated with zod.
    const persona = PersonaSpecSchema.parse(parseYaml(readFileSync(personaPath, "utf8")) as unknown);
    return { ...member, persona };
  });
  const config = PopulaceConfigSchema.parse({ ...raw, population: { ...raw.population, members } });
  return { config, path: absolute, dir };
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

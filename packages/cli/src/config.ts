import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PersonaSpecSchema, PopulaceConfigSchema, type PopulaceConfig } from "@populace/core";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export interface LoadedConfig {
  config: PopulaceConfig;
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

const RawMemberSchema = z.looseObject({ persona: z.union([z.string(), z.record(z.string(), z.json())]) });
const RawConfigSchema = z.looseObject({ population: z.looseObject({ members: z.array(RawMemberSchema) }) });

/** Loads YAML, substitutes env, resolves `persona: file.yaml` references and validates. */
export function loadConfig(path = "populace.yaml"): LoadedConfig {
  const absolute = resolve(path);
  if (!existsSync(absolute)) throw new Error(`config not found: ${absolute} (run \`populace init\` to create one)`);
  const dir = dirname(absolute);
  const { text, missing } = substituteEnv(readFileSync(absolute, "utf8"));
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

export function storePath(loaded: LoadedConfig): string {
  return loaded.config.store.path === ":memory:" ? ":memory:" : resolve(loaded.dir, loaded.config.store.path);
}

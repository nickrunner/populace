import { PersonaSpecSchema, PopulaceConfigSchema, envPlaceholder, substituteEnv, type PopulaceConfig } from "@populace/core";
import { Scalar, parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

/**
 * YAML in and out of the dashboard (ADR-0025). From M2 the database is the source of truth and
 * the file is an exchange format: a way to put a config in a repository, hand it to a colleague,
 * or drive the same population from CI at M4.
 *
 * The round trip has to be lossless, which it is for one reason: both ends are the same
 * `PopulaceConfig` zod schema that the CLI parses and the runner consumes. Nothing here
 * translates; it serialises.
 */

/**
 * A header that says what this file is and where its secrets went.
 *
 * The variables are named bare here, never as `${NAME}`. Substitution runs over the whole file,
 * comments included, so a placeholder written in a comment would be reported to the reader as a
 * variable their config depends on — and, on a machine where it is set, would put the secret's
 * value into the comment.
 */
function header(replaced: { name: string; what: string }[]): string {
  const lines = [
    "# Exported from populace. This is the config the dashboard is holding right now.",
    "# Edit it, commit it, and import it back — or run it from the CLI with `populace run`.",
  ];
  if (replaced.length) {
    lines.push("#", "# No secret is in this file. Set these in the environment before running it:", ...replaced.map((entry) => `#   ${entry.name} — ${entry.what}`));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * A placeholder, quoted. An unquoted `${VAR}` is a plain YAML scalar, so a file read on a machine
 * where the variable is not set substitutes to nothing and the key parses as null rather than as
 * the empty string — which turns "this secret is supplied elsewhere" into a type error on import.
 */
function placeholder(value: string): Scalar<string> {
  const node = new Scalar(value);
  node.type = Scalar.QUOTE_DOUBLE;
  return node;
}

export interface ExportedConfig {
  yaml: string;
  /** The env vars this file now depends on, in the words the screen shows. */
  placeholders: string[];
}

/** `${NAME}` for the file, `NAME` for anything that talks about it. */
function named(...parts: string[]): { name: string; placeholder: string } {
  const placeholder = envPlaceholder(...parts);
  return { name: placeholder.slice(2, -1), placeholder };
}

/**
 * Serialises a resolved config, with every credential replaced by the environment variable that
 * supplies it. A file that carried a live bearer token would be a file nobody could safely commit,
 * which would make export useless for the thing people want it for.
 */
export function toYaml(config: PopulaceConfig): ExportedConfig {
  const replaced: { name: string; what: string }[] = [];
  const mcp = config.target.mcp.map((endpoint) => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(endpoint.headers)) {
      if (!/auth|token|key|secret|cookie/i.test(key)) {
        headers[key] = value;
        continue;
      }
      const variable = named("populace", endpoint.name, "header", key);
      headers[key] = variable.placeholder;
      replaced.push({ name: variable.name, what: `header ${key} on the ${endpoint.name} endpoint` });
    }
    if (endpoint.bearerToken === undefined) return { ...endpoint, headers: quoted(headers) };
    const variable = named("populace", endpoint.name, "token");
    replaced.push({ name: variable.name, what: `the bearer token for the ${endpoint.name} endpoint` });
    return { ...endpoint, bearerToken: placeholder(variable.placeholder), headers: quoted(headers) };
  });

  const { apiKey: _apiKey, ...model } = config.model;

  // The key is read from the environment by every command already, so an exported file names the
  // variable rather than a placeholder of its own invention.
  if (config.model.apiKey !== undefined) replaced.push({ name: "ANTHROPIC_API_KEY", what: "the model API key" });

  const document = { ...config, target: { ...config.target, mcp }, model };
  return { yaml: `${header(replaced)}${stringifyYaml(document, { lineWidth: 100 })}`, placeholders: replaced.map((entry) => `${entry.name} — ${entry.what}`) };
}

/** Header values that are placeholders get the same quoting the bearer token does. */
function quoted(headers: Record<string, string>): Record<string, string | Scalar<string>> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, value.startsWith("${") ? placeholder(value) : value]));
}

/** What an import could not do, in the words the screen shows. */
export class ImportRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportRejected";
  }
}

const RawMemberSchema = z.looseObject({ persona: z.union([z.string(), z.record(z.string(), z.json())]) });
/**
 * A credential is allowed to arrive empty or null: that is what an exported file looks like on a
 * machine where its `${VAR}` is not set, and it means "the one already stored stays", not "clear
 * it" (`history.ts`, `mergeCredentials`). Anything else about the file is the config schema's job.
 */
const RawEndpointSchema = z.looseObject({ bearerToken: z.union([z.string(), z.null()]).optional(), headers: z.record(z.string(), z.union([z.string(), z.null()])).optional() });
const RawConfigSchema = z.looseObject({
  target: z.looseObject({ mcp: z.array(RawEndpointSchema).optional() }).optional(),
  population: z.looseObject({ members: z.array(RawMemberSchema) }),
});

export interface ParsedConfig {
  config: PopulaceConfig;
  /** Placeholders the environment did not supply. They became empty strings; the screen says so. */
  missing: string[];
}

/**
 * Parses pasted or uploaded YAML exactly as the CLI parses a file, with one deliberate difference:
 * a `persona: some-file.yaml` reference cannot be followed, because there is no directory on this
 * side of the wire. Saying that plainly beats importing a config with a person silently missing.
 */
export function fromYaml(text: string, env: Record<string, string | undefined> = process.env): ParsedConfig {
  const { text: substituted, missing } = substituteEnv(text, env);
  let raw: z.infer<typeof RawConfigSchema>;
  try {
    // eslint-disable-next-line no-restricted-syntax -- YAML boundary, validated with zod on this line.
    raw = RawConfigSchema.parse(parseYaml(substituted) as unknown);
  } catch (err) {
    throw new ImportRejected(err instanceof z.ZodError ? z.prettifyError(err) : `that is not a populace config: ${err instanceof Error ? err.message : String(err)}`);
  }
  const referenced = raw.population.members.flatMap((member) => (typeof member.persona === "string" ? [member.persona] : []));
  if (referenced.length) {
    throw new ImportRejected(
      `this file points at ${referenced.length} person written in another file (${referenced.join(", ")}). Paste the whole config, or import it with the CLI where those files are.`,
    );
  }
  const members = raw.population.members.map((member) => ({ ...member, persona: PersonaSpecSchema.parse(member.persona) }));
  const mcp = raw.target?.mcp?.map((endpoint) => {
    const { bearerToken, headers, ...rest } = endpoint;
    return {
      ...rest,
      ...(bearerToken === undefined || bearerToken === null || bearerToken === "" ? {} : { bearerToken }),
      ...(headers === undefined ? {} : { headers: Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== null && value !== "")) }),
    };
  });
  const result = PopulaceConfigSchema.safeParse({
    ...raw,
    ...(mcp === undefined ? {} : { target: { ...raw.target, mcp } }),
    population: { ...raw.population, members },
  });
  if (!result.success) throw new ImportRejected(z.prettifyError(result.error));
  return { config: result.data, missing };
}

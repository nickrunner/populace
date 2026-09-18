import type Anthropic from "@anthropic-ai/sdk";
import { FindingKindSchema, MemoryOperationSchema, SeveritySchema, type JsonObject, JsonObjectSchema, type JsonValue } from "@populace/core";
import { z } from "zod";

/**
 * The reporter toolset (ADR-0007). One `file_finding` tool covers every kind of
 * report; `kind` selects which. Schemas stay inside the structured-outputs subset
 * (all keys required, no additional properties, optional values as nullable, no
 * `minLength`/`minimum` keywords) so `strict` can be switched back on per tool,
 * but no tool sets it today — see `toStrictInputSchema` for why.
 */
export const FileFindingInput = z.object({
  kind: FindingKindSchema.describe(
    "bug: the product did something wrong. friction: it worked but was slower, more confusing or more annoying than it should have been. coverage-gap: you wanted to do something and no tool lets you (name the tool you wanted in `tool`). suggestion: it could do something better. praise: it did something well. abandonment: you are leaving and want to say why (prefer give_up if you are leaving now).",
  ),
  title: z.string().min(3).max(120).describe("One line, specific. Name the tool and what went wrong."),
  description: z.string().min(1).describe("What you were trying to do and what happened, in your own words."),
  expected: z.string().min(1).describe("What you expected, concretely. For a coverage-gap, the tool you went looking for."),
  observed: z.string().min(1).describe("What actually happened, concretely, quoting the result where useful. For a coverage-gap, say so and give any workaround you found."),
  severity: SeveritySchema.describe("critical: blocks core use or loses data. high: a main flow is broken. medium: wrong but there is a workaround. low: cosmetic."),
  confidence: z.number().min(0).max(1).describe("How sure you are this is the product's fault and not yours, 0 to 1."),
  tool: z.string().nullable().describe("The tool at fault, or for a coverage-gap the tool you wish existed (e.g. delete_task), or null."),
  evidence_calls: z.array(z.string()).describe("Call refs like c4, c5 of the tool calls that show the problem, in order. Empty means the last few calls."),
});

export const GiveUpInput = z.object({
  title: z.string().min(3).max(120),
  reason: z.string().min(1).describe("Why you are leaving, honestly, as this persona."),
  would_return: z.boolean().describe("Whether something specific changing would bring you back."),
  severity: SeveritySchema,
  evidence_calls: z.array(z.string()),
});

export const RememberInput = MemoryOperationSchema;

export const DoneInput = z.object({
  summary: z.string().min(1).describe("Two or three sentences on what you did this session and how you feel about the product."),
  would_return: z.boolean().describe("Whether you would come back for another session."),
});

export const FetchPageInput = z.object({
  path: z.string().min(1).describe("Path under the product's website, e.g. / or /pricing."),
});

export const REPORTER_TOOL_NAMES = ["file_finding", "give_up", "remember", "done", "fetch_page"] as const;
export type ReporterToolName = (typeof REPORTER_TOOL_NAMES)[number];

export function isReporterTool(name: string): name is ReporterToolName {
  return (REPORTER_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * Keywords a strict tool schema may not contain: the Messages API validates strict
 * schemas against the structured-outputs subset and rejects the whole request with a
 * 400 ("For 'number' type, properties maximum, minimum are not supported") if any
 * survive. zod emits them from .min()/.max()/.regex(), so strip them at every depth.
 * The zod schema still runs client-side on the tool input, so nothing is lost.
 *
 * We keep this even though no tool sets `strict` today, so that turning it back on for
 * one tool stays a one-line change rather than a 400 at the first turn of a wake.
 */
const UNSUPPORTED_STRICT_KEYWORDS = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
]);

/** Keywords whose value is a subschema, or an array of them. */
const SUBSCHEMA_KEYS = ["items", "additionalItems", "not", "anyOf", "allOf", "oneOf", "prefixItems"];
/** Keywords whose value is a map of name -> subschema, so the values are schemas but the map is not. */
const SUBSCHEMA_MAP_KEYS = ["properties", "patternProperties", "$defs", "definitions"];

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Copies a schema, dropping unsupported keywords and closing every object, depth first. */
function strictify(node: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED_STRICT_KEYWORDS.has(key)) continue;
    if (SUBSCHEMA_MAP_KEYS.includes(key) && isJsonObject(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, isJsonObject(sub) ? strictify(sub) : sub]));
    } else if (!SUBSCHEMA_KEYS.includes(key)) {
      out[key] = value;
    } else if (Array.isArray(value)) {
      out[key] = value.map((branch) => (isJsonObject(branch) ? strictify(branch) : branch));
    } else if (isJsonObject(value)) {
      out[key] = strictify(value);
    } else {
      out[key] = value;
    }
  }
  const properties = out.properties;
  if (properties && isJsonObject(properties)) {
    out.required = out.required ?? Object.keys(properties);
    out.additionalProperties = false;
  }
  return out;
}

/** zod -> JSON Schema suitable for a strict tool: no $schema key, every object closed, no unsupported keywords. */
export function toStrictInputSchema(schema: z.ZodType): Anthropic.Beta.BetaTool.InputSchema {
  const parsed = JsonObjectSchema.parse(z.toJSONSchema(schema, { target: "draft-7" }));
  delete parsed.$schema;
  const json = strictify(parsed);
  const properties = isJsonObject(json.properties ?? {}) ? (json.properties as JsonObject) : {};
  const required = Array.isArray(json.required) ? (json.required as string[]) : Object.keys(properties);
  return { ...json, type: "object", properties, required, additionalProperties: false };
}

/**
 * `strict` is deliberately off. The API compiles every strict schema into a grammar under a
 * budget shared across the request, and it is smaller than it looks: these tools' own schemas
 * exceeded it (400 "Schema is too complex.") before the wake took a single turn, and the error
 * names no tool. The runner re-validates every reporter call against its zod schema anyway
 * (`handleReporterTool` in `wake.ts`), so the only thing lost is server-side enforcement.
 * `eager_input_streaming` does not require `strict` and is kept.
 */
function tool(name: string, description: string, schema: z.ZodType): Anthropic.Beta.BetaTool {
  return { name, description, input_schema: toStrictInputSchema(schema), eager_input_streaming: true };
}

export function reporterTools(options: { webFetch: boolean }): Anthropic.Beta.BetaTool[] {
  const tools = [
    tool(
      "file_finding",
      "Report anything you noticed about the product: a bug, friction, a missing capability, a suggestion, praise, or why you are abandoning it. Set `kind` to say which. This is the only way your observations reach the product team; writing them in prose does nothing.",
      FileFindingInput,
    ),
    tool("give_up", "Stop using the product for good and explain why. Ends this session. Use it when a real person like you would walk away.", GiveUpInput),
    tool(
      "remember",
      "Write to your long-term memory for future sessions. kinds: note (anything), waiting_on (something you expect the product or someone to do), annoyance (something that bothered you), done (something you completed so you do not redo it), resolved (a waiting_on that is now settled; text is matched against existing entries).",
      RememberInput,
    ),
    tool("done", "End this session. Call it when a real person like you would stop for now. Say what you did and whether you will come back.", DoneInput),
  ];
  if (options.webFetch) tools.push(tool("fetch_page", "Fetch a page from the product's public website (same site only) and read it as text.", FetchPageInput));
  return tools;
}

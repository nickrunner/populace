import { JsonObjectSchema, type JsonObject, type JsonValue } from "@populace/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FileFindingInput, REPORTER_TOOL_NAMES, RememberInput, reporterTools, toStrictInputSchema } from "./tools.js";

/**
 * The Messages API validates strict tool schemas against the structured-outputs subset and
 * rejects the whole request with a 400 if an unsupported keyword survives, which takes down
 * the wake before turn one. zod emits these from .min()/.max()/.regex(), so guard the output.
 */
const UNSUPPORTED = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern", "minItems", "maxItems", "uniqueItems"];

function keywordsIn(node: JsonValue, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) for (const item of node) keywordsIn(item, found);
  else if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (UNSUPPORTED.includes(key)) found.add(key);
      keywordsIn(value, found);
    }
  }
  return found;
}

/** Tool schemas are typed by the SDK, not by us; re-parse them as plain JSON to walk them. */
const asJson = (schema: object): JsonObject => JsonObjectSchema.parse(schema);

describe("reporter tool schemas", () => {
  it("exposes every reporter tool with a closed object schema", () => {
    const tools = reporterTools({ webFetch: true });
    expect(tools.map((t) => t.name)).toEqual([...REPORTER_TOOL_NAMES]);
    for (const tool of tools) {
      // Strict is off: the API compiles strict schemas into grammars under a shared budget that
      // this toolset exceeded, failing the whole wake with a 400 that names no tool.
      expect(tool.strict).toBeUndefined();
      expect(tool.input_schema.type).toBe("object");
      expect(tool.input_schema.additionalProperties).toBe(false);
      // An empty property bag means the schema failed to serialise and the model cannot call the tool.
      expect(Object.keys(tool.input_schema.properties ?? {}).length).toBeGreaterThan(0);
    }
  });

  it("strips keywords the API rejects in a strict schema", () => {
    for (const tool of reporterTools({ webFetch: true })) {
      expect([tool.name, [...keywordsIn(asJson(tool.input_schema))]]).toEqual([tool.name, []]);
    }
  });

  it("strips them at every depth and closes nested objects", () => {
    const schema = toStrictInputSchema(
      z.object({
        score: z.number().min(0).max(1),
        nested: z.object({ tags: z.array(z.string().min(1)).min(1) }),
      }),
    );
    const json = asJson(schema);
    expect([...keywordsIn(json)]).toEqual([]);
    expect(json).toMatchObject({ properties: { nested: { additionalProperties: false, required: ["tags"] } } });
  });

  it("files every finding kind through the one file_finding tool", () => {
    const base = { title: "No way to delete a task", description: "d", expected: "a delete_task tool", observed: "no such tool", severity: "medium", confidence: 0.8, tool: "delete_task", evidence_calls: [] };
    for (const kind of ["bug", "friction", "coverage-gap", "suggestion", "abandonment", "praise"]) {
      expect(FileFindingInput.safeParse({ ...base, kind }).success).toBe(true);
    }
    expect(FileFindingInput.safeParse({ ...base, kind: "nope" }).success).toBe(false);
  });

  it("still enforces the stripped constraints client-side", () => {
    expect(RememberInput.safeParse({ kind: "note", text: "" }).success).toBe(false);
    expect(RememberInput.safeParse({ kind: "nope", text: "x" }).success).toBe(false);
    expect(RememberInput.safeParse({ kind: "resolved", text: "email verification" }).success).toBe(true);
  });
});

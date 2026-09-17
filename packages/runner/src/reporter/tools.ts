import type Anthropic from "@anthropic-ai/sdk";
import { FindingKindSchema, MemoryOperationSchema, SeveritySchema, type JsonObject, JsonObjectSchema } from "@populace/core";
import { z } from "zod";

/**
 * The reporter toolset (ADR-0007). Every schema is strict: all keys required,
 * no additional properties, optional values expressed as nullable.
 */
export const FileFindingInput = z.object({
  kind: FindingKindSchema.exclude(["friction", "coverage-gap"]).describe("bug: the product did something wrong. suggestion: it could do something better. praise: it did something well. abandonment: you are leaving and want to say why (prefer give_up if you are leaving now)."),
  title: z.string().min(3).max(120).describe("One line, specific. Name the tool and what went wrong."),
  description: z.string().min(1).describe("What you were trying to do and what happened, in your own words."),
  expected: z.string().min(1).describe("What you expected, concretely."),
  observed: z.string().min(1).describe("What actually happened, concretely, quoting the result where useful."),
  severity: SeveritySchema.describe("critical: blocks core use or loses data. high: a main flow is broken. medium: wrong but there is a workaround. low: cosmetic."),
  confidence: z.number().min(0).max(1).describe("How sure you are this is the product's fault and not yours, 0 to 1."),
  tool: z.string().nullable().describe("The tool at fault, or null."),
  evidence_calls: z.array(z.string()).describe("Call refs like c4, c5 of the tool calls that show the problem, in order. Empty means the last few calls."),
});

export const NoteFrictionInput = z.object({
  title: z.string().min(3).max(120),
  description: z.string().min(1).describe("What slowed you down, confused you or made you hesitate."),
  expected: z.string().min(1),
  observed: z.string().min(1),
  severity: SeveritySchema,
  tool: z.string().nullable(),
  evidence_calls: z.array(z.string()),
});

export const ReportCoverageGapInput = z.object({
  title: z.string().min(3).max(120),
  wanted_tool: z.string().min(1).describe("A name for the tool you looked for and could not find, e.g. delete_task."),
  description: z.string().min(1).describe("What you wanted to do and why no available tool lets you do it."),
  workaround: z.string().nullable().describe("A workaround you found, or null."),
  severity: SeveritySchema,
  evidence_calls: z.array(z.string()),
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

export const REPORTER_TOOL_NAMES = ["file_finding", "note_friction", "report_coverage_gap", "give_up", "remember", "done", "fetch_page"] as const;
export type ReporterToolName = (typeof REPORTER_TOOL_NAMES)[number];

export function isReporterTool(name: string): name is ReporterToolName {
  return (REPORTER_TOOL_NAMES as readonly string[]).includes(name);
}

/** zod -> JSON Schema suitable for a strict tool: no $schema key, additionalProperties false at the root. */
export function toStrictInputSchema(schema: z.ZodType): Anthropic.Beta.BetaTool.InputSchema {
  const json = JsonObjectSchema.parse(z.toJSONSchema(schema, { target: "draft-7" }));
  delete json.$schema;
  const properties = (json.properties as JsonObject | undefined) ?? {};
  const required = (json.required as string[] | undefined) ?? Object.keys(properties);
  return { type: "object", properties, required, additionalProperties: false };
}

function tool(name: string, description: string, schema: z.ZodType): Anthropic.Beta.BetaTool {
  return { name, description, input_schema: toStrictInputSchema(schema), strict: true, eager_input_streaming: true };
}

export function reporterTools(options: { webFetch: boolean }): Anthropic.Beta.BetaTool[] {
  const tools = [
    tool(
      "file_finding",
      "Report something you noticed about the product: a bug, a suggestion, praise, or why you are abandoning it. This is the only way your observations reach the product team; writing them in prose does nothing.",
      FileFindingInput,
    ),
    tool("note_friction", "Report friction: something that worked in the end but was slower, more confusing or more annoying than it should have been.", NoteFrictionInput),
    tool(
      "report_coverage_gap",
      "Report that you wanted to do something and no available tool lets you do it (a missing capability), especially if the product's own description promised it.",
      ReportCoverageGapInput,
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

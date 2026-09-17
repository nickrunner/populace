import { z } from "zod";
import { JsonValueSchema } from "../json.js";

export const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationInputTokens: z.number().int().nonnegative().default(0),
  cacheReadInputTokens: z.number().int().nonnegative().default(0),
});
export type Usage = z.infer<typeof UsageSchema>;

export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}

/** One content block of a tool result, normalised from MCP. */
export const ToolResultContentSchema = z.object({
  /** Text rendering of the result exactly as the model saw it (after the call-ref prefix). */
  text: z.string(),
  /** MCP structuredContent when present. */
  structured: JsonValueSchema.optional(),
  isError: z.boolean(),
});
export type ToolResultContent = z.infer<typeof ToolResultContentSchema>;

/** A full record of one target tool call: the unit of reproduction. */
export const ToolCallRecordSchema = z.object({
  /** Call ref shown to the model, e.g. `c7`. */
  ref: z.string(),
  endpoint: z.string(),
  tool: z.string(),
  arguments: JsonValueSchema,
  result: ToolResultContentSchema,
  latencyMs: z.number().nonnegative(),
  /** Trace sequence number of the corresponding `tool.call` event. */
  traceSeq: z.number().int().nonnegative(),
  at: z.string().datetime(),
});
export type ToolCallRecord = z.infer<typeof ToolCallRecordSchema>;

const base = { seq: z.number().int().nonnegative(), at: z.string().datetime(), wakeId: z.string() };

export const TraceEventSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("wake.start"), agentId: z.string(), personaId: z.string(), runId: z.string(), wakeNumber: z.number().int() }),
  z.object({
    ...base,
    type: z.literal("model.call"),
    turn: z.number().int(),
    model: z.string(),
    effort: z.string(),
    /** The request as sent, minus the stable system prompt and tools which are stored once per wake. */
    request: z.object({ messageCount: z.number().int(), lastUserContent: z.string() }),
    response: z.object({ stopReason: z.string().nullable(), content: JsonValueSchema, servedBy: z.string() }),
    usage: UsageSchema,
    costUsd: z.number().nonnegative(),
    latencyMs: z.number().nonnegative(),
  }),
  z.object({
    ...base,
    type: z.literal("tool.call"),
    ref: z.string(),
    endpoint: z.string(),
    tool: z.string(),
    arguments: JsonValueSchema,
    result: ToolResultContentSchema,
    latencyMs: z.number().nonnegative(),
  }),
  z.object({ ...base, type: z.literal("reporter.call"), tool: z.string(), arguments: JsonValueSchema, result: z.string(), accepted: z.boolean() }),
  z.object({
    ...base,
    type: z.literal("guardrail"),
    rule: z.enum(["kill-switch", "per-wake-tokens", "per-wake-usd", "daily-usd", "tool-denied", "destructive-confirm", "destructive-denied", "max-turns", "web-fetch-denied"]),
    detail: z.string(),
    tool: z.string().optional(),
  }),
  z.object({ ...base, type: z.literal("identity"), event: z.enum(["provisioned", "captured", "missing", "reconnected"]), strategy: z.string(), detail: z.string() }),
  z.object({ ...base, type: z.literal("finding"), findingId: z.string(), kind: z.string(), title: z.string() }),
  z.object({ ...base, type: z.literal("memory"), operation: z.string(), text: z.string() }),
  z.object({ ...base, type: z.literal("note"), text: z.string() }),
  z.object({ ...base, type: z.literal("wake.end"), status: z.string(), summary: z.string(), usage: UsageSchema, costUsd: z.number().nonnegative(), turns: z.number().int(), toolCalls: z.number().int() }),
]);
export type TraceEvent = z.infer<typeof TraceEventSchema>;
export type TraceEventInput = TraceEvent extends infer E ? (E extends TraceEvent ? Omit<E, "seq" | "at" | "wakeId"> : never) : never;

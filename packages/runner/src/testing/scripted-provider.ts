import type Anthropic from "@anthropic-ai/sdk";
import { JsonValueSchema, type JsonObject, type JsonValue } from "@populace/core";
import type { ModelProvider, ModelRequest, ModelRequestMetadata, ModelResponse } from "../model/provider.js";

/** A tool result as the scripted policy sees it: the ref the runner assigned plus the text and parsed data. */
export interface SeenToolResult {
  toolUseId: string;
  name: string;
  ref: string | null;
  text: string;
  data: JsonValue | null;
  isError: boolean;
}

export interface ScriptContext {
  /** 1-based model turn within this wake. */
  turn: number;
  metadata: ModelRequestMetadata;
  /** Text of the first user message (the wake context). */
  wakeContext: string;
  /** Results of the tool calls made on the previous turn, in order. */
  lastResults: SeenToolResult[];
  /** Every result seen so far in this wake, in order. */
  allResults: SeenToolResult[];
  /** Names of the tools offered on this turn. */
  toolNames: string[];
  messages: Anthropic.Beta.BetaMessageParam[];
}

export interface ScriptedCall {
  name: string;
  input: JsonObject;
}

export interface ScriptedTurn {
  text?: string;
  calls: ScriptedCall[];
}

export type ScriptPolicy = (ctx: ScriptContext) => ScriptedTurn;

/**
 * Deterministic ModelProvider for tests (ADR-0016). Produces real BetaMessage
 * objects with usage so the trace, cost accounting and guardrails are exercised.
 */
export class ScriptedProvider implements ModelProvider {
  readonly name = "scripted";
  private readonly seen = new Map<string, SeenToolResult[]>();
  private readonly turns = new Map<string, number>();
  private readonly toolNamesByUseId = new Map<string, string>();
  private counter = 0;

  constructor(
    private readonly policy: ScriptPolicy,
    private readonly tokensPerCall = { input: 1200, output: 150 },
  ) {}

  complete(request: ModelRequest): Promise<ModelResponse> {
    const key = request.metadata.wakeId;
    const turn = (this.turns.get(key) ?? 0) + 1;
    this.turns.set(key, turn);
    const allResults = this.seen.get(key) ?? [];
    const lastResults = this.collectResults(request.messages);
    allResults.push(...lastResults);
    this.seen.set(key, allResults);
    const first = request.messages[0];
    const wakeContext = first && typeof first.content === "string" ? first.content : "";

    const scripted = this.policy({ turn, metadata: request.metadata, wakeContext, lastResults, allResults, toolNames: request.tools.map((t) => t.name), messages: request.messages });
    const content: Anthropic.Beta.BetaContentBlock[] = [];
    if (scripted.text) content.push({ type: "text", text: scripted.text, citations: null });
    for (const call of scripted.calls) {
      const id = `toolu_${String(++this.counter).padStart(5, "0")}`;
      this.toolNamesByUseId.set(id, call.name);
      content.push({ type: "tool_use", id, name: call.name, input: call.input });
    }
    const usage: Anthropic.Beta.BetaUsage = {
      input_tokens: this.tokensPerCall.input + turn * 300,
      output_tokens: this.tokensPerCall.output,
      cache_creation_input_tokens: turn === 1 ? 2000 : 0,
      cache_read_input_tokens: turn === 1 ? 0 : 2000,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
      inference_geo: null,
      iterations: null,
      speed: null,
      fallback_credit: null,
      output_tokens_details: null,
    };
    const message: Anthropic.Beta.BetaMessage = {
      id: `msg_${String(this.counter).padStart(5, "0")}`,
      type: "message",
      role: "assistant",
      model: request.model,
      content,
      stop_reason: scripted.calls.length > 0 ? "tool_use" : "end_turn",
      stop_sequence: null,
      stop_details: null,
      usage,
      container: null,
      context_management: null,
      diagnostics: null,
    };
    return Promise.resolve({
      message,
      usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0, cacheReadInputTokens: usage.cache_read_input_tokens ?? 0 },
      latencyMs: 1,
      servedBy: request.model,
    });
  }

  private collectResults(messages: Anthropic.Beta.BetaMessageParam[]): SeenToolResult[] {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "user" || typeof last.content === "string") return [];
    const out: SeenToolResult[] = [];
    for (const block of last.content) {
      if (block.type !== "tool_result") continue;
      const text = typeof block.content === "string" ? block.content : (block.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join("\n");
      const refMatch = /^\[(c\d+)\] /.exec(text);
      const body = refMatch ? text.slice(refMatch[0].length) : text;
      let data: JsonValue | null = null;
      try {
        // eslint-disable-next-line no-restricted-syntax -- tool result text from the runner, validated right after.
        const parsed = JsonValueSchema.safeParse(JSON.parse(body) as unknown);
        if (parsed.success) data = parsed.data;
      } catch {
        /* not JSON */
      }
      out.push({ toolUseId: block.tool_use_id, name: this.toolNamesByUseId.get(block.tool_use_id) ?? "?", ref: refMatch?.[1] ?? null, text: body, data, isError: block.is_error === true });
    }
    return out;
  }
}

/** Typed constructor for a scripted tool call, so mixed arrays of calls keep the `ScriptedCall` type. */
export function call(name: string, input: JsonObject = {}): ScriptedCall {
  return { name, input };
}

/** Reads a field from the last result's JSON data, e.g. `field(ctx, "id")` or `field(ctx, "user.id")`. */
export function field(result: SeenToolResult | undefined, path: string): string {
  let current: JsonValue | null | undefined = result?.data ?? null;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object" || Array.isArray(current)) return "";
    current = current[segment];
  }
  return typeof current === "string" ? current : typeof current === "number" ? String(current) : "";
}

/**
 * Builds a policy from an ordered list of steps: each step is a function of the
 * context returning the calls for that turn. Steps advance one per turn; after
 * the last step the policy ends the wake with `done`.
 */
export function sequence(steps: ((ctx: ScriptContext) => ScriptedTurn)[], finalSummary = "Done for today."): ScriptPolicy {
  return (ctx) => {
    const step = steps[ctx.turn - 1];
    if (step) return step(ctx);
    return { calls: [{ name: "done", input: { summary: finalSummary, would_return: true } }] };
  };
}

/** Sequence keyed by wake number, so a persona behaves differently on return visits. */
export function byWake(scripts: Record<number, ScriptPolicy>, fallback: ScriptPolicy): ScriptPolicy {
  return (ctx) => (scripts[ctx.metadata.wakeNumber] ?? fallback)(ctx);
}

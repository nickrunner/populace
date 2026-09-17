import Anthropic from "@anthropic-ai/sdk";
import type { ModelConfig } from "@populace/core";
import { usageFrom, type ModelProvider, type ModelRequest, type ModelResponse } from "./provider.js";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Claude via the Anthropic SDK. Every call is streamed and resolved with
 * `finalMessage()`; adaptive thinking; effort from the request; server-side
 * refusal fallbacks when enabled (ADR-0006).
 */
export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(config: Pick<ModelConfig, "apiKey"> = {}, client?: Anthropic) {
    this.client = client ?? new Anthropic(config.apiKey ? { apiKey: config.apiKey } : {});
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const started = Date.now();
    const stream = this.client.beta.messages.stream({
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      tools: request.tools,
      messages: request.messages,
      thinking: { type: "adaptive" },
      output_config: { effort: request.effort },
      metadata: { user_id: request.metadata.agentId },
      ...(request.fallbacks ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
    });
    const message = await stream.finalMessage();
    return { message, usage: usageFrom(message.usage), latencyMs: Date.now() - started, servedBy: message.model };
  }
}

export function isRetryableJsonError(err: Error): boolean {
  // finalMessage() rejects with a plain error when an eagerly streamed tool input is not parseable JSON.
  return !(err instanceof Anthropic.APIError) && /JSON/i.test(err.message);
}

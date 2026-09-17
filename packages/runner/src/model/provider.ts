import type Anthropic from "@anthropic-ai/sdk";
import type { Effort, Usage } from "@populace/core";

/** Stable identity of a wake, passed to providers for request metadata and to test doubles for scripting. */
export interface ModelRequestMetadata {
  wakeId: string;
  wakeNumber: number;
  agentId: string;
  personaId: string;
  runId: string;
}

export interface ModelRequest {
  model: string;
  effort: Effort;
  maxTokens: number;
  /** Stable for the wake; the last block carries a cache breakpoint. */
  system: Anthropic.Beta.BetaTextBlockParam[];
  /** Stable for the wake; the last tool carries a cache breakpoint. */
  tools: Anthropic.Beta.BetaTool[];
  /** Append-only within a wake (ADR-0006). */
  messages: Anthropic.Beta.BetaMessageParam[];
  fallbacks: boolean;
  metadata: ModelRequestMetadata;
}

export interface ModelResponse {
  message: Anthropic.Beta.BetaMessage;
  usage: Usage;
  latencyMs: number;
  /** Model that actually produced the response (differs from the request when a fallback served it). */
  servedBy: string;
}

/**
 * Thin seam in front of the model (ADR-0006). One production implementation
 * (Anthropic); a scripted test double lives in `./testing`.
 */
export interface ModelProvider {
  readonly name: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export function usageFrom(usage: Anthropic.Beta.BetaUsage): Usage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
  };
}

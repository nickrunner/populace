# ADR-0006: Claude via the Anthropic SDK

**Status:** accepted (fixed by brief)

## Decision

- Provider: `@anthropic-ai/sdk`. Default model `claude-opus-5`, configurable.
- Server-side refusal fallbacks on by default: `fallbacks: "default"` with beta `server-side-fallback-2026-07-01`. Configurable off.
- Thinking: adaptive. The `thinking` parameter is omitted (equivalent to `{type: "adaptive"}`); `budget_tokens` is never used.
- `output_config.effort` is configurable per wake; default `high`.
- Every call is streamed with `client.beta.messages.stream()` and resolved with `finalMessage()`. Reporter tools set `eager_input_streaming: true`; the runner validates every tool input against its zod schema before running it.
- Message history within a wake is append-only: earlier turns are never edited or deleted. Budget exhaustion and policy notices are appended as new user turns.
- Prompt order is `tools -> system -> messages`. The persona system prompt and the target tool list are stable for the wake and carry `cache_control` breakpoints; the volatile wake context (date, wake number, memory) is the first user message.
- SDK types (`Anthropic.Beta.BetaMessageParam`, tool block types) are used throughout; no parallel type definitions.
- Reporter tools are declared `strict: true` with `additionalProperties: false`.
- `ModelProvider` is a thin interface (`complete(request) -> {message, usage, cost, latency}`). Only `AnthropicProvider` is built. A scripted provider exists for tests (ADR-0016) and is not a second product provider.
- Cost is computed by the runner from `usage` and a per-model price table (input, output, cache write, cache read), so every trace event carries dollars.


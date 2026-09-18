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
- A third breakpoint rolls to the end of `messages` before every turn, so the growing transcript is read from cache rather than re-sent (see the amendment below). Older breakpoints are cleared first, keeping the request within the four the API allows.
- The model, effort and max tokens are resolved per wake: a persona's `model` override layers over the global `model` block, so one population can mix models. The verifier's judge resolves its own (`verifier.model`).
- SDK types (`Anthropic.Beta.BetaMessageParam`, tool block types) are used throughout; no parallel type definitions.
- Reporter tool schemas use `additionalProperties: false` and stay inside the structured-outputs subset. They are *not* declared `strict: true`: the shared grammar-complexity budget rejected the toolset outright (ADR-0007 amendment).
- `ModelProvider` is a thin interface (`complete(request) -> {message, usage, cost, latency}`). Only `AnthropicProvider` is built. A scripted provider exists for tests (ADR-0016) and is not a second product provider.
- Cost is computed by the runner from `usage` and a per-model price table (input, output, cache write, cache read), so every trace event carries dollars.


## Amendment (2026-09-18): cache the conversation, not just the prefix

Only the stable prefix was cached, so every turn re-sent the whole transcript as fresh input.
Measured over five wakes: 458K uncached input tokens against 334K cache reads - 70% of spend
was input, and it grew with the square of the session length, because turn N pays for turns
1..N-1 again. The worst wake (18 turns, 54 tool calls) spent 225K uncached input tokens alone.

`rollCacheBreakpoint` now moves one breakpoint to the end of `messages` before each request.
Same persona, same model, measured before and after: uncached input per wake fell from 225,703
tokens to 14, cache hit rate rose from 29% to 82%, and cost per turn fell from $0.0804 to
$0.0278. The remaining uncached share is the cache write for each turn's new content, which is
inherent.

A user turn must be block-form to carry `cache_control`, so a string body is normalised to a
single text block; thinking, redacted-thinking and fallback blocks are the three that cannot
hold a breakpoint and are skipped.

## Amendment (2026-09-18): model and effort are per persona, and the judge picks its own

`model` was global: every agent and the verifier's judge ran the same model at the same effort.
Personas differ in how much judgement they need, and the judge decides what reaches the digest,
so both now carry a `ModelOverride` (`model`, `effort`, `maxTokens`) that layers over the global
block via `resolveModel`. Unset fields fall through, so the global block still sets the default.

The shipped config runs agents on `claude-sonnet-5` at `medium`, the judge on `claude-opus-5` at
`high`, and gives the one persona that stress-tests scale (`power-organizer`) the stronger model.

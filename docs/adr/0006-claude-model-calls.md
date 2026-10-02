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

## Amendment (2026-10-01): the cheap setting is the default, and a missing price row is not free

A subscription cannot pay for this. Anthropic's Agent SDK documentation is explicit — "Anthropic
does not allow third party developers to offer claude.ai login or rate limits for their products,
including agents built on the Claude Agent SDK" — and consumer OAuth (`claude setup-token` /
`CLAUDE_CODE_OAUTH_TOKEN`) is scoped to Claude Code and claude.ai, with enforcement against clients
presenting themselves as Claude Code since January 2026. populace bills an API credential or a
cloud provider, and the only lever on what a study costs is what a study asks for. So the defaults
have to be the cheap ones.

Three defaults move. Agents: `claude-sonnet-5-5` at `effort: "low"`, where the shipped config ran a
Sonnet at `medium` and `DEFAULT_MODEL` was `claude-opus-5` at `high`. A person meeting somebody
else's product for the first time is not deliberating, and a study pays for that thinking on every
visit by every person it sends; a cohort or persona that needs a considered agent raises it through
the `ModelOverride` the amendment above added. The judge: `judge: "heuristic"` (ADR-0014,
`SWEEP-AND-VERIFY.md`), because ADR-0045's report cycle made the paid judge an unattended caller on
a clock. `judge: "model"` now names `claude-opus-5-5` at `high` **pinned**, not inherited from
`DEFAULT_MODEL`, since a judge that followed the agents' default would be weaker than the thing it
judges.

**`DEFAULT_PRICES` is load-bearing in a way that does not announce itself.** `priceFor` bills an
unlisted model at the most expensive known rate so ceilings stay conservative — correct for a model
nobody recognises, and badly wrong for a current one whose row was never added. `claude-sonnet-5-5`
had no row, so a study running it was priced as Opus 5: reported spend read **2.5x high** and
`perWake.maxUsd` and `dailyUsd` fired that much early. Adding a model to the config without adding
its row is a silent 2.5-5x error in every trace event, the status output and the ceilings. There is
a test (`core.test.ts`, "prices every model it defaults to") asserting the default model and the
pinned judge are each priced as themselves rather than as the fallback.

Two things were weighed and rejected. **The Batch API** halves the price of everything, and nothing
waits on a wake — but a wake is sequential, turn N+1 needing turn N's tool results, so the only
batchable axis is turn N across every agent in lockstep. That takes the loop away from `runWake()`,
pays batch latency per turn rather than per wake (40 turns of minutes each, against an hourly
cadence), and `fallbacks` is rejected outright on Batches. **Haiku 4.5** is half the price per token
of a Sonnet, but `output_config.effort` errors on it, and it strips previously-cached thinking
blocks when a plain user message follows tool use — which is exactly how this ADR appends notices
and budget warnings, so every notice would drop the messages cache from that point on and cost more
than the model saved.

`thinking: {type: "between_tools"}` is the next lever and is deliberately not taken yet: it is the
lowest thinking setting on Claude Sonnet 5.5 and fits a 40-turn tool loop, but it is that model
alone and every other model 400s on it, so it cannot coexist with the server-side `fallbacks` this
ADR leaves on by default. Taking it means branching the provider per model family and dropping
`fallbacks` when it is set.

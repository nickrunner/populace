# ADR-0009: Guardrails live in the runner, not the prompt

**Status:** accepted (fixed by brief)

## Decision

Enforced in code, checked before every model call and every tool call:

- per-wake token ceiling and dollar ceiling (`guardrails.perWake`)
- per-population daily dollar ceiling (`guardrails.dailyUsd`, summed from the store over the trailing 24h)
- global kill switch (`populace kill`, a flag in the store checked at every step)
- allowlist and denylist of tool names per persona (glob patterns)
- destructive-tool policy from MCP `annotations.destructiveHint`: `allow`, `confirm` (ADR-0013) or `deny`
- a hard cap on model turns per wake

When a ceiling trips mid-wake the runner appends a user turn telling the agent to wrap up, allows one more turn for `remember`/`done`, then ends the wake with status `budget-exceeded` regardless.


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


## Amendment (2026-09-18): model spend outside a wake

This ADR assumed every model call happens inside `runWake`, and that assumption is now false.
Writing a cohort's people (ADR-0031) is a model call made at authoring time, from a job, with no
agent, no wake and no per-wake ceiling to charge against. Both design judges flagged it before it
was built.

The answer is not a second guardrail system but the same one, reached from a job:

- the job reads the kill switch before it starts and aborts between batches if it is engaged;
- its cost is recorded on the `Job` row and counted against the project's daily ceiling through the
  same `costSince` path, under a `costKind` so the spend screen can separate *authoring* from
  *visits*;
- a cohort larger than `guardrails.maxPeoplePerGenerate` (default 100) is written in batches, each
  its own model call and its own progress tick;
- the button states the estimated price before it is pressed.

The per-wake ceilings are unchanged and still do the work that matters. What changed is that
"everything that spends money is inside a wake" is no longer the sentence that makes the daily
ceiling complete — "everything that spends money is counted against the day" is.

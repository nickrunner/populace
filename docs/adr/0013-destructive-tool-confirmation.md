# ADR-0013: Destructive tools are confirmed by an identical repeat call

**Status:** accepted

## Decision

When a tool carries `annotations.destructiveHint: true` and the persona policy is `confirm`, the first call returns a tool error explaining that the tool is destructive and asking the agent to call it again with identical arguments if it really intends to. An identical call within the same wake proceeds. Both calls are in the trace. `allow` skips this; `deny` always refuses. Default is `confirm`.

This keeps the target tool schema untouched, works with any MCP server, and produces a visible intent signal in the trace.

## Amendment (ADR-0033)

The setting is no longer the persona's alone. A target carries one too, and the effective setting
for a wake is the **stricter** of the two: `deny` beats `confirm` beats `allow`. A persona that
says `allow` cannot soften a target that says `confirm`, for the same reason a persona cannot widen
an allowlist — a tool that is dangerous is dangerous whoever reaches for it.

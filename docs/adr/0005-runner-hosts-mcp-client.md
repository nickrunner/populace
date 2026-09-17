# ADR-0005: The runner hosts its own MCP client and intercepts every tool call

**Status:** accepted (fixed by brief)

## Decision

The runner connects to the target with `@modelcontextprotocol/sdk` over Streamable HTTP with bearer auth. Tool calls from the model never go to the target directly; they pass through `McpSession.call()` which applies guardrails (allow/deny lists, destructive policy, kill switch), captures self-signup credentials, measures latency, and writes a `tool.call` trace event with arguments and results.

The Anthropic MCP connector is not used: it would not reach private QA environments and would hide calls from the trace.

## Consequences

Tool results are JSON from the wire and cross a justified `unknown` boundary where they are normalised to text plus structured content.


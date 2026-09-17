# ADR-0016: A scripted model provider makes wakes deterministic in tests

**Status:** accepted

## Decision

`@populace/runner/testing` exports `ScriptedProvider`, a `ModelProvider` whose turns are produced by a test-supplied policy function that sees the message history and returns tool calls. It produces real `BetaMessage` objects with usage so cost accounting is exercised. It is the only way CI runs wakes; it is not a second product provider and is never selectable from the CLI.


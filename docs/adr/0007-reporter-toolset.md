# ADR-0007: Reporter toolset is the only way findings and memory are produced

**Status:** accepted (fixed by brief)

## Decision

Every wake gets a runner-owned toolset alongside the target tools:

| Tool | Effect |
| --- | --- |
| `file_finding` | Files a `bug`, `suggestion`, `praise` or `abandonment` finding with expected vs observed, severity, confidence and evidence call refs |
| `note_friction` | Files a `friction` finding |
| `report_coverage_gap` | Files a `coverage-gap` finding: something the persona wanted to do that no tool allows |
| `give_up` | Files an `abandonment` finding and ends the wake |
| `remember` | Appends to memory (note, waiting_on, annoyance, done, or resolves a waiting_on) |
| `done` | Ends the wake with a one-line summary |

The runner never parses findings out of free text. If the model writes a bug report in prose and never calls `file_finding`, no finding exists. The system prompt tells the model this.

## Consequences

Findings have a guaranteed schema, always carry their evidence, and are cheap to verify. The cost is that the prompt must make reporting feel natural to the persona.


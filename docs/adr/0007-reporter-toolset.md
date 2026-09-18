# ADR-0007: Reporter toolset is the only way findings and memory are produced

**Status:** accepted (fixed by brief)

## Decision

Every wake gets a runner-owned toolset alongside the target tools:

| Tool | Effect |
| --- | --- |
| `file_finding` | Files a finding of any kind (`bug`, `friction`, `coverage-gap`, `suggestion`, `praise`, `abandonment`) with expected vs observed, severity, confidence and evidence call refs. `kind` selects which; for a `coverage-gap`, `tool` names the tool the persona wished existed |
| `give_up` | Files an `abandonment` finding and ends the wake |
| `remember` | Appends to memory (note, waiting_on, annoyance, done, or resolves a waiting_on) |
| `done` | Ends the wake with a one-line summary |

The runner never parses findings out of free text. If the model writes a bug report in prose and never calls `file_finding`, no finding exists. The system prompt tells the model this.

## Consequences

Findings have a guaranteed schema, always carry their evidence, and are cheap to verify. The cost is that the prompt must make reporting feel natural to the persona.


## Amendment (2026-09-18): one `file_finding` instead of three tools

`note_friction` and `report_coverage_gap` were folded into `file_finding` as values of
`kind`. They never did anything `file_finding` could not: the runner was synthesising their
`expected`/`observed` text and a fixed `confidence` from a narrower set of arguments, so the
model had less control over the finding than it does now, for three tools' worth of surface.

The forcing function was the API rejecting the whole toolset (see the amendment below), but
the merge stands on its own: one reporting tool with a `kind` is also what the finding schema
has always looked like.

## Amendment (2026-09-18): reporter tools are no longer `strict`

ADR-0006 declared reporter tools `strict: true`. That is withdrawn. The API compiles each
strict schema into a grammar under a complexity budget shared across the request, and this
toolset exceeded it: every wake failed with `400 Schema is too complex.` at turn zero, an
error that names no tool. The budget is smaller than it looks — it rises steeply with the
number of fields in a single tool (one tool of 20 plain string fields already fails, while
eight tools of five fields each do not), and the four largest reporter tools together were
over it. A separate cap allows at most 20 strict tools per request.

Nothing is lost: `handleReporterTool` already re-validates every reporter call against the
zod schema and returns `INVALID_JSON` with the zod issues on a mismatch, which is where the
guarantee actually comes from. `eager_input_streaming` does not depend on `strict` and is
kept. Schemas still stay inside the structured-outputs subset (`toStrictInputSchema`) so
`strict` can be re-enabled on one small tool without re-hitting the 400.

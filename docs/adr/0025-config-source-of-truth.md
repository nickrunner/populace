# ADR-0025: The store becomes the source of truth for configuration at M2

**Status:** accepted 2026-09-18 (roadmap decision D3). Nick's reason: users will author config through the dashboard anyway, so the database is where it should move.

## Decision

From M2, authored configuration — targets, personas, populations, model, guardrails, verifier and daemon settings — lives in the store as rows. YAML becomes import and export rather than the entry point.

The runner is unaffected either way. It consumes a resolved `PopulaceConfig`, and the only thing that changes is where that object is assembled from. `populace run -c populace.yaml` keeps working end to end: the file is parsed, resolved and snapshotted into the run exactly as the UI would. Nothing is ever authoritative in two places for one project.

`populace export` writes a project's config back as YAML so it can still be committed to a repo, and config rows are versioned so "what changed between these two runs" is answerable.

## Consequences

The alternative is keeping YAML authoritative and having the UI write the file back, as `populace scale` already does through the `yaml` document AST. That preserves git-reviewable config, which the developer audience may genuinely want. It cannot survive M5, and round-tripping comments and anchors through a form editor is a known misery. The mitigation is export plus versioned rows, which for fix validation is better than a file.

Deciding this before M2 design work matters because the target wizard and persona editor are built against whichever answer wins. D1 moved authoring from M3 to M2, so this binds a milestone earlier than first scoped.

## Amendment (2026-09-18): resolution is per simulation, and it freezes the cast

This ADR said config is assembled from rows into a `PopulaceConfig`. What it did not say — because
there was only ever one of everything — is *which* rows, and the answer is no longer "the project's".

**Resolution is per simulation.** `resolveSimulationConfig(simulation)` reads the simulation's own
population, its own target and its own execution plan, layered over the project's settings. Two
simulations in one project point at two different targets and run two different casts, and both are
resolved from rows without either one being "the" config. The process-wide
`config: () => Promise<PopulaceConfig>` thunk and `ControlDeps.projectId` are deleted with it: there
is no such thing as "the config" any more, and a function that returns one can only be wrong.

**Resolution inlines the roster.** `member.people[]` carries each person's id, name, details and
handle (ADR-0031), so the snapshot **freezes the cast**. A three-month-old execution still renders
the right names after its cohort has been re-cast or resized, because the names it ran with are in
its snapshot rather than looked up live. This is the same reason the snapshot inlines the full
`PersonaSpec` rather than referencing a row.

**`scale` is gone.** A cohort's `size` is the only number that decides headcount, so resolution is
a join over cohorts rather than an arithmetic over two numbers edited on two screens.

The seam this ADR drew is unchanged and is doing more work than before: the runner still consumes a
resolved `PopulaceConfig` and still does not care where it came from — a YAML file, a project's
rows, or a snapshot being picked back up with its live secrets put back in.

# ADR-0025: The store becomes the source of truth for configuration at M2

**Status:** accepted 2026-09-18 (roadmap decision D3). Nick's reason: users will author config through the dashboard anyway, so the database is where it should move.

## Decision

From M2, authored configuration — targets, personas, populations, model, guardrails, verifier and daemon settings — lives in the store as rows. YAML becomes import and export rather than the entry point.

The runner is unaffected either way. It consumes a resolved `PopulaceConfig`, and the only thing that changes is where that object is assembled from. `populace run -c populace.yaml` keeps working end to end: the file is parsed, resolved and snapshotted into the run exactly as the UI would. Nothing is ever authoritative in two places for one project.

`populace export` writes a project's config back as YAML so it can still be committed to a repo, and config rows are versioned so "what changed between these two runs" is answerable.

## Consequences

The alternative is keeping YAML authoritative and having the UI write the file back, as `populace scale` already does through the `yaml` document AST. That preserves git-reviewable config, which the developer audience may genuinely want. It cannot survive M5, and round-tripping comments and anchors through a form editor is a known misery. The mitigation is export plus versioned rows, which for fix validation is better than a file.

Deciding this before M2 design work matters because the target wizard and persona editor are built against whichever answer wins. D1 moved authoring from M3 to M2, so this binds a milestone earlier than first scoped.

## Amendment (M2, 2026-09-18)

YAML import is **once, on first open, and never a sync.** If a project already has a target, a
`populace.yaml` sitting in the working directory is ignored and the import says so. A user who has
edited their target in the browser must not have it overwritten because a stale file is still on
disk, and a file and a form that both write the same rows would be exactly the two-sources-of-truth
this ADR rejects.

A persona's `slug` is immutable and is what a resolved config's `persona.id` carries, separate from
the mutable display name. Agent ids are `populationId/personaId#ordinal`, so a rename that reached
the slug would silently detach every continuation from its own memory.

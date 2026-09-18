# ADR-0025: The store becomes the source of truth for configuration at M2

**Status:** proposed — this is roadmap decision D3, escalated to Nick

## Decision

From M2, authored configuration — targets, personas, populations, model, guardrails, verifier and daemon settings — lives in the store as rows. YAML becomes import and export rather than the entry point.

The runner is unaffected either way. It consumes a resolved `PopulaceConfig`, and the only thing that changes is where that object is assembled from. `populace run -c populace.yaml` keeps working end to end: the file is parsed, resolved and snapshotted into the run exactly as the UI would. Nothing is ever authoritative in two places for one project.

`populace export` writes a project's config back as YAML so it can still be committed to a repo, and config rows are versioned so "what changed between these two runs" is answerable.

## Consequences

The alternative is keeping YAML authoritative and having the UI write the file back, as `populace scale` already does through the `yaml` document AST. That preserves git-reviewable config, which the developer audience may genuinely want. It cannot survive M5, and round-tripping comments and anchors through a form editor is a known misery. The mitigation is export plus versioned rows, which for fix validation is better than a file.

Deciding this before M2 design work matters because the target wizard and persona editor are built against whichever answer wins. D1 moved authoring from M3 to M2, so this binds a milestone earlier than first scoped.

# ADR-0018: Configuration is a single YAML file validated by zod

**Status:** accepted

## Decision

`populace.yaml` holds target, identity provider, model, guardrails, schedule, store path and population. Personas may be inline or `file:` references. `populace validate` parses with the core schema and connects to the target to list tools. Environment variables are referenced as `${VAR}` and substituted before parsing so bearer tokens stay out of the file.


## Amendment (2026-09-18): `version: 2`, with cohorts and simulations

The file follows the entity model (ADR-0029). `populace.yaml` goes to `version: 2` and:

- gains a top-level `cohorts:` list — `slug`, `name`, `persona`, `size`, and optional `seed`,
  `cadence` and `maxWakes` overrides;
- gains a top-level `simulations:` list — `slug`, `name`, `population`, `target`, and
  `visitsPerPerson` (a number for an ephemeral simulation, null for a longitudinal one);
- loses `population.scale` entirely. A cohort's `size` is the only number that decides how many
  people exist;
- keeps `population:` as composition: a name and the cohorts in it.

`population.members[]` is still read, because a member list IS a list of cohorts and always was: an
entry with a `count` becomes a cohort of that size on that persona, and a file with no
`simulations:` block keeps stating its plan on the population, where `maxWakes` is what decides the
mode on import. That is a reading, not a migration, and it lives only in the CLI's loader.

A file that explicitly declares `version: 1` is refused rather than converted — `version` is
`z.literal(2)`. That is the greenfield decision applied to the file as well as to the store
(ADR-0011 amendment): no v1 file exists outside this repository, and a converter for a file nobody
has is a converter nobody keeps correct.

Import remains one-way (ADR-0025). The file seeds rows on first open and the rows are the truth
afterwards; there is still no export for the new layers, so a cohort cast in the browser is not in
anybody's git repository yet. That is a known gap, not an oversight.

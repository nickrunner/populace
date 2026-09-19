# ADR-0029: Project, simulation, population, cohort, person

**Status:** accepted 2026-09-18

## Context

Until now the product had one noun between "the app" and "an agent": a `Population`, which held
persona members with a `count` and a `scale` factor, and a run was started from it directly. Three
things could not be said at all.

**Two groups on one persona.** `agentIdFor(populationId, personaId, ordinal)` keyed an agent by its
persona, so "twelve first-timers who come back every ten minutes" and "eight first-timers on mobile
who come back every four" collided on ids, on cadence and on traits. The population could hold one
member per persona and no more.

**Two ways of running the same people.** A population carried `cadence` and `maxWakes` itself, so
"send these 37 people on a bounded four-visit sweep" and "leave these 37 people running for a
fortnight" were two populations with duplicated composition, not two ways of running one.

**How many people there are.** `count × scale` meant the headcount was the product of two numbers
edited on two screens. Nobody could answer "how many people is this?" by reading one field.

## Decision

Five nouns, each owning exactly one thing:

```
Project ── Target,  Persona,  Cohort,  Population,  Simulation,  Settings,  Triage
                                 │         │            │
                              Person    cohorts[]   population + target + mode
                                                         │
                                                       Run (an execution), seq 1..n
                                                         │
                                                       Agent (a participant), Wake (a visit)
```

- **Project** scopes authoring. A persona, a target, a cohort and a signature belong to one project
  and are never shared across two. Projects are scoping, not tenancy.
- **Persona** is a template: role, backstory, goals, constraints, tool policy, and traits that may
  be fixed or sampled. It has no headcount.
- **Cohort** is **N people on one persona**, and it owns the headcount, the seed, and the cadence
  and visit-cap overrides. It is the layer that did not exist, and its absence is what made every
  problem above unsayable.
- **Population** is composition and nothing else: an ordered set of cohorts. It has no size of its
  own; its size is the sum of its cohorts'.
- **Simulation** is a population, a target, and a way of running them (ADR-0030). It is what a user
  presses go on, what they bookmark, and what results belong to.
- **Person** is a durable individual in a cohort: `cohortSlug#ordinal`, with a name, a detail line
  and a handle, written once and stored (ADR-0031).

An **agent** is still what the runner takes, and a **run** is still what the daemon drives. A run is
now an *execution of a simulation*, carrying `simulationId` and a `seq` that counts from one.

## Why the cohort owns the people and the seed

The seed decides which traits, patience and budget each ordinal is sampled with, and which fallback
name it is given. Put the seed on the population and two cohorts of the same persona in one
population draw the same people; put it on the simulation and the same population re-cast itself
every time it was run, which destroys comparison across executions. The cohort is the only level at
which "these particular people" is a stable, meaningful set — which is also why a person id is
`cohortSlug#ordinal` and carries neither the population nor the simulation.

Cohorts are therefore reusable: two populations may hold the same cohort, and both get the same
twelve individuals.

## Consequences

`scale` is deleted everywhere — config, API, CLI template and the store. A cohort's `size` is the
only number that decides how many people exist. `populace scale 2` still exists and multiplies every
cohort's size, writing the numbers back.

Agent ids become `populationSlug/cohortSlug#ordinal`, so two cohorts on one persona no longer
collide, and `upsertAgent` is keyed `(run_id, id)` rather than `id` alone (ADR-0024 amendment). Ids
are deterministic *within a run* and repeat across runs by design; anything keyed by agent id alone
leaks between executions, so every query keys by run as well.

A population with one cohort is the common case and the UI keeps the concept implicit until there
are two: the sidebar has one "The people" item, not a "Cohorts" and a "Populations" (SPEC §7.2).

The cost is a deeper authoring model than a single-target local tool strictly needs, and the
mitigation is that the setup flow creates all of it without naming any of it: adopting a starter
persona creates a cohort, a population called "Everyone" and a roster in one request.

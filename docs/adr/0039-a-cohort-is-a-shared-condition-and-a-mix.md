# ADR-0039: A cohort is a shared condition and a mix of personas; the population says how many

**Status:** accepted 2026-09-23

## Context

ADR-0029 fixed a cohort as *N people on one persona*, owning the headcount, and a population as
composition and nothing else: an ordered set of cohorts. Five days of using that model turned up
two things.

**The two nouns felt like one.** With one persona per cohort, a cohort is a persona with a
number on it, and the population editor is a checkbox per cohort. "Compose a population" and
"make cohorts" are the same act seen from two screens, and the user said so: *"the cohorts concept
in the UI is very close to the same thing as a population setup."*

**One persona per cohort forces a cross product.** A cohort in the demographic sense is defined
by a shared exposure — a birth year, a diagnosis, an industry, a habit — and within it people
vary. Populace had no way to say that. To test a condition (mobile-only signups, launch-week
arrivals, a region) across six personas you made six cohorts, one per persona, and scaling the
cast meant editing six sizes. Six personas and two conditions was twelve cohorts.

## Decision

Four things move, and everything downstream of `expandPopulation` stays where it is.

**A cohort is a shared condition and a mix.** It carries `context` — REQUIRED, one or two
sentences addressed to its people, handed to every one of them under their persona's backstory —
and `mix: [{ personaId, weight }]`, at least one entry, no persona twice. Weights are a ratio, not
percentages. It also carries what it applies to everyone in it: a fixed `traits` overlay, a
`tools` policy that can only narrow, a `model` override layered global → persona → cohort →
simulation, and, as before, the seed, cadence and visit-cap overrides. **It has no size.**

**The population says how many.** `StoredPopulation.members: [{ cohortId, size }]` replaces
`cohortIds`. This is the only place a headcount lives, and setting it is what writes the people.
A simulation is still population + target + mode; its screens edit the population's numbers
inline and say so.

**People are numbered per lane.** A lane is one (cohort, persona) pair, slugged
`cohortSlug.personaSlug`; slugs are `[a-z0-9-]`, so the dot is unambiguous. A person id is
`${laneSlug}#${ordinal}` and an agent id `${populationSlug}/${laneSlug}#${ordinal}`;
`cohortSlugOfAgentId` still reads the group off any id. Ordinals count within the lane, which is
what keeps ADR-0031 true under scaling: the sixth first-timer in the mobile cohort is the sixth
first-timer whether the cohort is sent at ten people or at forty.

**A size is apportioned by highest averages.** `apportion(size, weights)` is Sainte-Laguë, ties
to the earlier entry. The property that matters is that it is house-monotone: growing a cohort
never shrinks a lane, so raising a population from 10 to 11 adds one person and archives nobody.
Largest-remainder rounding does not have that property (the Alabama paradox), and a cohort that
archived somebody because it grew would break ADR-0031 for no reason anybody could see. At small
sizes a light entry gets nobody, and the editor says so rather than rounding it up.

**The roster is sized at the largest size any population gives the cohort.** The same cohort at
ten in one population and forty in another is one roster of forty, of which the first population
meets the first ten of each lane. A cohort in no population has nobody, and a person past their
lane's count — because the cohort was sent at fewer, its weights moved, or their persona left the
mix — is archived, never deleted, and comes back exactly as they were.

**A person may be given individuality by hand** (ADR-0031 amended). `Person.overrides` carries
`patience`, `budgetUsd` and `traits`, applied last: the spec sampled from the seed, then the
cohort's overlay, then the hand. Goals, constraints, backstory and tool policy stay on the
persona, for the reason ADR-0031 gave: those are what make a persona a template.

## What this supersedes

- ADR-0029: *"Cohort is N people on one persona, and it owns the headcount"* — a cohort is a
  condition and a mix, and owns no headcount. *"Population is composition and nothing else; it
  has no size of its own"* — a population is which cohorts go and how many of each.
- ADR-0031: *"A person carries a name and a detail line and nothing else"* — and the sampled
  dimensions, if set by hand.
- ADR-0035: *"A population is composition and nothing else"* — as above. The rest of ADR-0035
  stands: several targets, several populations, a simulation is the pairing, nouns do not
  inflect, refuse to guess.

## Consequences

- `cohorts` loses `persona_id` and `size`; `cohort_personas(cohort_id, persona_id)` is the mix
  lifted out of the blob for the persona-delete guard; `people` gains `lane_slug`;
  `populations.json` carries members with sizes. `SCHEMA_SHAPE` is bumped and every local
  database is rebuilt — affordable, and only because no database elsewhere exists yet
  (ADR-0011). This is the last such change that can be made this way.
- The starter flow is unchanged from the reader's side: adopting a starter at a count makes a
  persona, a cohort of that persona alone with the starter's own `context`, a population member
  at that size, and a roster. `POST /personas` makes a persona and nothing else.
- Deleting a persona is refused while any cohort's mix names it. The mix is where a persona is
  taken out; deleting cohorts on the reader's behalf would unmake people that executions name.
- `RunEstimate.perCohort`, `PreflightView.cohorts`, `RunCohortView` and the population view
  report per lane, or list personas, where they reported one persona per cohort.
- A static identity pool keyed by cohort may be keyed by lane (`"mobile.first-timer"`); a pool
  serving more than one lane is refused at run start, as a persona-keyed pool serving two
  cohorts already was.
- `populace scale` multiplies the sizes the YAML file writes; a YAML cohort may carry `mix:`
  and `context:`, and `persona:` alone is the mix of one.
- The Populations row in the rail appears at the first cohort, not the second: there is a
  number to set the moment there is a cohort.

# ADR-0031: People are written once and stored

**Status:** accepted 2026-09-18

## Context

A cohort is N people on one persona (ADR-0029), and until now those N were distinguishable only by
an ordinal: the prompt opened `You are Casey Morgan, a list keeper.` twelve times over, the signup
email was `casual-1@…`, `casual-2@…`, and every screen that wanted to say who found something could
only say the persona's name. A population of thirty-seven was thirty-seven copies of six people.

Giving each of them a name and a sentence of their own is cheap and changes what the product can
say. The question is where the name comes from, and the tempting answer — generate it on demand from
the seed — is the wrong one as soon as a model writes it, because a model call is not a pure
function of a seed.

## Decision

A **person** is a row: `(projectId, cohortId, ordinal)` with an id `cohortSlug#ordinal`, a name, a
`details` line of one or two sentences, a handle used as the signup email's local part, and a
`generatedBy` of `seeded`, `model` or `authored`.

`ensureRoster(cohortId)` materialises them on first read of a cohort, on every size change, and from
the explicit generate job. **It fills only the slots that have no row. It never overwrites.**

Two tiers:

- **Seeded** — free, offline, always available. `nameFrom(seed)` draws from two frozen ~200-entry
  multi-origin name arrays with the existing `seededRandom`, rejecting names already used in the
  cohort. `details` is empty. This is what runs with no `ANTHROPIC_API_KEY`, which is what keeps the
  offline test suite offline.
- **Model-written** — one model call per cohort (batched at `guardrails.maxPeoplePerGenerate`),
  returning `{ordinal, name, details}[]`, validated with zod at the boundary. It never runs during a
  run and never overwrites an existing row.

**Names are stable because the row is stored, not because the generator is deterministic.** Growing
a cohort from 25 to 30 adds ordinals 25–29 and touches nobody. Shrinking to 20 marks 20–24 inactive
rather than deleting them, so growing back restores the same five individuals. **Changing the cohort
seed renames nobody** — the composition screen says so: *the seed decides who the next person is,
not who these people are.*

The only path that overwrites is `POST …/cohorts/:c/people/regenerate` with `confirm: true`, and the
UI states plainly that it changes who these people are and breaks comparison with earlier
executions.

## How a person reaches the model

`resolveSimulationConfig` reads the roster and inlines it as `member.people[]`, so **a config
snapshot freezes the cast** and a three-month-old execution still renders the right names after the
cohort has been re-cast. `expandPopulation` copies `name`, `details` and `personId` onto the agent;
`personaSystemPrompt` opens `You are <name>, <role>.` and inserts `details` after the backstory; the
wake context says the person's name; and `SelfSignupProvider` uses the name as the display name and
the handle as the email local part — which is also the fix for two cohorts on one persona colliding
on signup emails.

## Consequences

Per-person text now sits inside the cached system prefix. Per-agent variance there is already the
norm (traits are sampled per agent), so it costs no prompt-cache hit rate — and that is checked
rather than assumed: a runner test asserts `usage.cache_read_input_tokens > 0` on the second turn of
a wake (ADR-0006 amendment).

Writing people is the first model spend outside `runWake`, which the guardrail architecture did not
anticipate. It is kill-switched, priced onto the job row and counted against the project's daily
ceiling (ADR-0009 amendment).

A person carries a name and a detail line and **nothing else**. No goals, no tool policy, no budget
of their own: the moment a person carries authored content, the persona stops being a template and
the cohort stops meaning anything. Editing one person is an escape hatch — `PATCH
…/people/:ordinal`, name and blurb only — and it sets `generatedBy: "authored"` so regeneration
leaves it alone.

## Amendment — the sampled dimensions may be set by hand (ADR-0039)

*Added 2026-09-23.* "Nothing else" is narrowed. A person also carries `overrides` — `patience`,
`budgetUsd`, `traits` — the dimensions the persona already SAMPLES per person, applied last at
expansion over the sample and the cohort's overlay. Setting what was going to be drawn anyway does
not make the persona stop being a template; goals, constraints, backstory and tool policy still
cannot be set on a person, for the reason above. `PATCH …/people/:personId` takes them, null hands
a dimension back to the draw, and any edit stamps `authored`. People are numbered per lane
(`cohortSlug.personaSlug#ordinal`), and the roster is sized by the populations that send the
cohort rather than by a `size` on the cohort, which no longer exists.

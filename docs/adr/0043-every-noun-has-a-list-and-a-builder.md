# ADR-0043: Every noun has a list and a builder, and the builders chain

**Status:** accepted 2026-09-25

## Context

The user's words, paraphrased faithfully in the brief this record implements:

> *"The Cohorts page is confusing: it shows how cohorts are used in populations, creation is a tiny
> form at the bottom, and it forces picking a persona before naming the cohort. It should list the
> cohorts I made and let me create a new one on a page with room for a detailed definition."*

> *"Personas: the list pushes prebuilt personas with a 'Take them' button. Instead: list my
> personas, let me create one. Prebuilt personas are offered INSIDE the builder as a starting
> point."*

> *"For each entity: (1) a dashboard listing every item with edit and delete, (2) a New button,
> (3) one create/edit builder page exposing ALL details and settings at creation time."*

> *"Builders chain: study → target/population builders; population → cohort builder; cohort →
> persona builder, whenever the thing to pick from does not exist yet."*

Two decisions had shaped the library screens before this. ADR-0029's rail amendment kept the
**one-request starter path** — adopting a starter persona created the persona, a cohort of it, an
"Everyone" population member at a count and a roster in one press — as the mitigation for a deeper
authoring model, and refused a population wizard in front of a first run on the grounds that it
would abandon that mitigation. ADR-0039 preserved the starter path through the cohort restructure
and put the headcount on the population, so the Populations screen became the place where numbers
were set and the Cohorts screen showed how each cohort was used.

**The mitigation produced the confusion it was meant to prevent.** A press that makes four things
without naming any of them leaves the reader with four things they did not make and cannot place:
a cohort they never composed, a population called "Everyone" they never asked for, and a list of
personas that leads with six strangers and a button. The Cohorts page then showed those cohorts *as
used by populations* — which is the population's fact, not the cohort's — with creation at the
bottom, and made the reader pick a persona before they could say what the cohort was. Every one of
the complaints above is a place where the shortcut hid the model instead of teaching it.

**And the headcount had moved.** With ADR-0041 the study owns the size, a population is a weighted
mix and a cohort is a weighted mix, so the two library screens that used to set numbers now set
ratios, and a ratio is a thing that wants a visible balance rather than a count field. The screens
had to be rebuilt anyway; the question was around what.

## Decision

**Every authored noun — persona, cohort, population, target, study — has a list page with edit and
delete, a New button, and one builder page that serves both creating and editing and shows every
field at creation time. Builders chain forward when the thing to pick from does not exist yet, and
return when it does. Starters are a starting point inside the persona builder, not a list of their
own.**

### 1. The rail and the list pages

The rail reads **Studies** — pointing at the project index, which IS the studies dashboard — then a
Library group of **Targets, Personas, Cohorts, Populations**, then Settings. **No count gates.**
ADR-0029's amendment showed Populations only from the second cohort; with the size on the study
there is a reason to compose a population the moment there is one cohort, and a rail item that
appears and disappears with the data cannot be learned (ADR-0035, nouns do not inflect). Inside a
study the group's "Population" item becomes **People**, at `studies/:study/people`, with the study's
`size` as its trailing figure.

A list page is a `DocumentPage` with a `PageHeader` carrying one primary "New …" button and a
`Ledger` of rows. A row links to the item's page — the builder for a persona, cohort, population
or target; the results page for a study — and its aside is ONE icon button opening a menu with
**Edit** and **Delete** (or **Archive** for a study), the destructive item in the danger tone and
opening a controlled `AlertDialog` rendered as a sibling of the menu, never inside it. That menu
trigger is the sanctioned aside for edit-plus-delete, and the design inventory is amended to say so.

**A row states one fact and no headcount.** Persona: role. Cohort: the first sentence of its
context and "N personas". Population: "N cohorts". Target: address and way in. Study: "Target ×
Population", size, mode, status, its actions, and the "Read the results" / "Watch it live" link. No
person's name appears on any list, and no persona, cohort or population row says how many people
— it has no number to say. Stubs stay what each list uses today — an avatar for a persona, brand
glyphs for cohorts, populations and targets, a position for a study — and are never a count.

**Delete copy states what the server will do, including refusal.** The control is at a bound with
the reason when the thing is in use — a cohort "in N populations", a population "N studies send
it", a persona while cohorts mix it, a target while a study points at it — and a 409 that gets
through anyway is shown through `WhatWentWrong`. A study is archived by default, with a checkbox to
delete its executions too, and the dialog adds: *"People no other study sends are put aside, not
deleted, and come back if a study sends them again."* An empty list is a `StateBlock` with a serif
sentence and a link to the builder.

**The studies dashboard is `ProjectHome`.** Header with studies, targets and today's spend; a needs
panel, "What needs doing", listing every leftover from `SetupStatus.needs` with a link per §6; the
studies ledger, grouped by target when the project has more than one; then the existing "Seen in
more than one study" section (`crossStudy`) when there is more than one study. The Targets and
Who-can-go bands, `PairingsGrid` and `FirstRun.tsx` are removed: each was a second place to author
something that now has a list and a builder of its own.

### 2. One builder per noun, serving `new` and `:id`

The template splits the existing `FormPane` into `FormBody` — the `<form noValidate>`, Enter to
submit, focus on the first invalid field on the falling edge of `busy`, and a `blocked` flag under
which Enter is a no-op — and a bar: `FormPane` is `FormBody` plus a `SaveBar`, and the new
`BuilderPage` is a `DocumentPage` around a `FormBody` with an `ActionBar` in create mode and a
`SaveBar` in edit mode. Create mode passes `guard={false}`, because the draft is persisted (below)
and a navigation guard over a saved draft is noise.

**Every field is visible at creation.** Long text — `context`, `backstory`, `description`, `notes`,
`brief` — is a text area of at least eight rows at full column width, because the complaint was a
tiny form. The slug is derived from the name in create mode and editable before the first save; in
edit mode it is a read-only fact, because agent ids and URLs are built from it (DATA-MODEL §5).

**Only create mode persists a draft.** Each builder declares a zod `DraftSchema` for its form state,
reads it with `safeParse` inside a try/catch (session storage can throw), writes it debounced under
`populace:draft:${pathname}`, and removes it on a successful save, on Cancel and on "Start blank".
When a draft was read the page says "Draft restored" once, with "Start blank" beside it.

**Chaining is one hook, `useThen()`, used by every builder.** A link to the next builder carries
`then = encodeURIComponent(pathname + search)` of the CURRENT builder, so a nested chain carries the
outer `then` inside the inner one. On success the next builder rebuilds that URL, sets `picked=<id>`
on ITS search params and navigates there; `then` is honoured only when it starts with the project's
own base, otherwise the created item's own page is used. The action bar under a `then` reads "Make
this persona and go back". The returning builder invalidates the specific list key in its create
mutation BEFORE navigating; the receiver applies `picked` only once the options include it, adds it
idempotently, then removes `picked` from the URL with a replace. Every create mutation invalidates
its own list key and never the whole cache.

**Persona builder.** Create mode opens with "Start from one of these": the six starters as
selectable rows with an avatar, name, role and summary. Picking one fills the draft from the
starter's spec and shows the starter's suggested cohort context as a hint sentence; "Start blank"
undoes it. Fields: name, role, backstory, goals, constraints, patience as a fixed value or a range,
budget, traits, tool policy (the target's policy as the floor when the project has exactly one
target, a picker when several, none when none — ADR-0033), and a model override behind a
disclosure. "How this reads to them" previews the DRAFT in both modes, through a new
`POST /projects/:p/personas/preview` taking `{ spec, targetId? }`; the saved persona's preview
delegates to it with the stored spec, and with no target in the project the server renders against
a placeholder target named "your product".

**Cohort builder.** Name; then context — large, required, glossed "what these people have in
common, said to them"; when it is empty and the mix's first persona carries a `suggestedContext`,
it is prefilled and the hint says so; then the **Mix**, a `WeightedMixEditor` (§4) over personas,
whose empty state links to the persona builder with `?then=`; then fixed traits, a narrowing tool
policy, a model override, a "Timing" disclosure with the cadence override and the visit cap, the
seed with ADR-0031's gloss, and notes. Nothing here shows people, headcounts or populations. When
the cohort is in a population a study sends, the mix section says: *"Changing weights moves people
in N studies that send this cohort."*

**Population builder.** Name; then **Cohorts**, a `WeightedMixEditor` over cohorts with the first
sentence of each context as its detail, whose empty state links to the cohort builder with
`?then=`. A local "Try a size" number — default 20, never saved — previews the deal: the screen
calls `dealStudy` from `@populace/core/isomorphic` over the population's weights, hands the counts
to the editor, and renders one sentence per persona-in-cohort in product words: *"First-time
visitors in Mobile signups: 3"*, *"Power users in Mobile signups would send nobody at this size."*

**Study builder** — replacing `NewSimulation` and `SimulationSettings`. "What": name, description,
brief (ADR-0041 §4, labelled "What this study tells them", optional). "Where": a target select,
whose empty state links to the target builder with `?then=`. "Who": a population select with the
same empty-state rule; **Size**, a number from 0 with no maximum, default 10 on create, with a
stepper; and the deal preview computed client-side with `dealStudy` — a ledger of cohorts, each
with its personas and counts, provisional dots labelled "someone from <cohort> (<persona>), not yet
written", and the "would send nobody" sentence per empty persona-in-cohort. "How": the mode as a
conditional fieldset reusing the two labelled, glossed radios verbatim, cadence, seed, and on the
ephemeral branch `autoSweep` and `requireFreshTarget`. "Overrides" behind a disclosure: model,
guardrails, verifier, written as the study's `overrides` block. The cost panel reads an
`EstimateView`; for an unsaved draft or a changed form it asks `POST /projects/:p/estimate` with the
draft's target, population, size, cap, cadence, seed and overrides, which resolves without writing
and returns a zero estimate with `people: 0` — never a 409 — when the deal sends nobody. Create is
`POST /studies` then the study's page; edit is `PUT /studies/:s`. When a longitudinal execution is
running or paused and anything changed, the save bar says the running execution takes the change
only through "Apply to the running execution", and that button PUTs then POSTs the apply; on an
ephemeral study it says "The next execution uses it."

**Study people** at `studies/:study/people`: *"N people; this study meets the first of each cohort.
A line you write here follows them into every study that sends the cohort."* with a link to the
builder to change the size; grouped by cohort, then persona-in-cohort; each row expandable to the
per-person editor that used to live on the cohort page; "also sent by N other studies" when
`alsoSentBy > 0`; "Write their details" at a bound with the server's reason while any execution
runs. The per-execution cohorts screen moves to `studies/:study/executions/:runId/cohorts`, linked
from the executions list.

### 3. Starters move inside the builder

`GET /personas/starters` returns each starter's full `spec` and its suggested cohort `context`.
`POST /personas/starters` and its body schema are removed — it was the one-request path — and
`POST /personas` accepts `origin: "starter"` so a persona made from one still says so.
`PersonaView.suggestedContext` carries the starter's context when the origin is a starter that
still exists, else null, which is what the cohort builder prefills from.

### 4. `WeightedMixEditor`

One organism, in the design system, importing nothing from core: `entries {id, name, detail?,
weight}[]`, `options`, `onChange`, `addLabel`, `emptyState`, `min` (default 1) with its reason,
and optionally `previewCounts` — one per entry, same order, computed by the SCREEN — and a
`previewSentence` ("At 20 people: …"). Each row: the name, the detail, a `NumberInput` from 1 with
no maximum as the authoritative control (integers only; a non-integer stored weight is shown
rounded and written back only when the row is touched), a `Slider` for coarse adjustment with its
`valueLabel` ("3 of 7 parts, about 43%"), a `Meter` of the weight over the total as the share mark
— never a `Capsule`, whose length means a headcount — a tabular percent rounded by largest
remainder so the column sums to 100, the preview count when given, and a quiet remove button that
is disabled, not gone, at the minimum. Below the rows, an "Add …" select over the options. Feedback
is instant: no transitions.

The editor knows weights and nothing else. The deal is the screen's to compute, which is why
`dealStudy` is browser-safe (ADR-0041 §2), and why the editor cannot be made to mean a headcount
by accident.

### 5. The target builder is the exception

Connecting a target keeps its connect-then-finish flow: `ConnectTarget`, the ways in, then the
saved-target editor. ADR-0040 made a successful check the act that creates the row, so that a secret
generated for the reader is stored before it is shown — and that is the opposite of "save at the
end", on purpose. Only the copy changes and the list page follows §1. A target is the one noun
whose builder writes before the reader presses save, and this record says so rather than forcing
it into the template.

### 6. Needs

`needsOf` returns blocking needs in order: `no-target` → `no-population` (*"Compose a population:
personas are kinds of people, cohorts are people who share something, a population is which
cohorts go, and a study says how many."*) → `no-study` → `no-api-key` → `kill-switch`. Advisory:
`target-unfinished`, `target-unchecked`, `population-empty:<id>` (no cohorts), `study-empty:<id>`
(the deal sends nobody), `study-target-gone:<id>`. Blocking per study: `study-target-unfinished:<id>`
(ADR-0040). The web derives every link: project-scoped needs by id — `no-target` to the target
builder, `no-population` to the population builder, `no-study` to the study builder, the key and
the kill switch to settings — and the rest by `scope.kind` and `scope.id`. `SetupStatus` drops
`peopleCount`, renames `simulationIds` to `studyIds`, and `ready` means no blocking need.
**`GET /setup` creates nothing** (ADR-0041 §3).

### 7. The delete rules

One table, because five screens say these sentences and they must agree with the server.

| Noun | Default act | Refused while… | Sentence at the bound |
| --- | --- | --- | --- |
| Persona | Delete | a cohort's mix names it | "in N cohorts" |
| Cohort | Delete | a population holds it (409 naming them) | "in N populations" |
| Population | Delete | a study names it (409 naming them) | "N studies send it" |
| Target | Delete | a study points at it (409 naming them) | "a study points at it" |
| Study | **Archive**; "Delete its executions too" opts in | — | "People no other study sends are put aside, not deleted, and come back if a study sends them again." |
| Person | Never; archived by the roster rule (ADR-0041 §3) | — | — |
| Project | Cascade, in one transaction (DATA-MODEL §5) | — | — |

Nothing is deleted on the reader's behalf. Deleting a cohort no longer strips it out of populations;
deleting a persona never unmakes a cohort; the reader is told which thing to take apart first.

## What this supersedes

- ADR-0029, rail amendment: *"**Populations**, which appears at `counts.cohorts > 1 ||
  counts.populations > 1`"* — no count gates; four library items, always. *"Adopting a starter
  persona still creates the persona, the cohort, the roster and the 'Everyone' population in one
  request, and a first-time user still reaches a first execution without reading the word
  *cohort*"* — the one-request path is removed; a first-time user reads the word cohort in the rail
  and in the needs panel's sentence, and the sentence is the mitigation now. *"A population wizard
  standing in front of a first run would abandon it, and that was considered and refused"* — what
  stands in front of a first run is not a wizard but four builders that chain on demand, and the
  reasoning is reversed: the one-request path hid the model and produced the confusion the user
  reported. From the decision itself: *"the mitigation is that the setup flow creates all of it
  without naming any of it"* — the setup flow names all of it, one page each.
- ADR-0035: *"the setup panel is shown on a project that has not begun and never again, and … there
  is no permanent numbered checklist on the dashboard"* — refined. "What needs doing" is shown
  whenever there is a need and never otherwise, and it is a list of leftovers with a link each, not
  a numbered sequence; the loop ADR-0035 described ("you come back and add a qa target in month
  three") is exactly what a leftover is.
- ADR-0039, consequences: *"The starter flow is unchanged from the reader's side: adopting a
  starter at a count makes a persona, a cohort of that persona alone with the starter's own
  `context`, a population member at that size, and a roster"* — gone with the size (ADR-0041); a
  starter fills a persona builder and its context prefills a cohort builder. *"The Populations row
  in the rail appears at the first cohort, not the second"* — it is always there.
- ADR-0040 is not superseded; §5 records the target as the deliberate exception to §2.

## Consequences

**No store change.** Every screen here reads and writes through routes ADR-0041 and ADR-0042
already describe; `SCHEMA_SHAPE` is untouched.

**The design documents change to match**, and this record is where the changes are decided: the
atomic inventory gains `WeightedMixEditor` (§3, organism 36, with its signature under the same
number), `FormBody` (§4, template 5's three-way split) and `BuilderPage` (§4, template 9), the
aside menu pattern for edit-plus-delete (the amendment under §3 organism 4, `LedgerRowProps.aside`),
and the page table's list and builder rows (§5, rewritten under one dated amendment); the design
system's vocabulary adds **study**, demotes **simulation** to the code's word, fixes the population
and cohort rows to say weights and not sizes, and forbids "lane" in copy (DESIGN-SYSTEM §7.1 and
§7.2, both amended 2026-09-25 under ADR-0041 and ADR-0042). Those files are edited beside this one.

> **Amendment (2026-09-25, same day) — what the screens became where they differ from §1–§5.**
> Read against the code after the build, four things are more specific than the decision said and
> are recorded here so the decision and the inventory agree:
>
> - **The study builder is two components in one file**, `CreateStudy` at `studies/new` and
>   `EditStudy` at `studies/:study/edit`, chosen by `useParams().study`. §2 said "one screen per
>   entity serving `new` and `:id`"; that holds for the persona, cohort and population builders,
>   whose edit address is the item's own (`library/cohorts/:c`). A study's own address is its
>   RESULTS (§1: the row's `to` is the results page), so its builder in edit mode sits at `/edit`
>   inside the study shell — where `useStudy()` already holds the row — and the retired settings
>   screen's address redirects there. The split is two components rather than one with a flag
>   because hooks cannot be conditional.
> - **The population builder passes a rail.** §2 described "Try a size" as a local number with a
>   sentence per persona-in-cohort; the screen puts that preview in `BuilderPage`'s `rail` slot,
>   which the study builder also uses for its cost. The inventory's note that only the results
>   screen passes a `DocumentPage` rail is amended (§4 template 2).
> - **The cohort builder previews with `apportion`, not `dealStudy`.** A cohort has one level of
>   mix, so its "Try a size" is one call to `apportion(size, weights)`; `dealStudy` is the two-level
>   deal and belongs to the population and study builders. Both are core's own arithmetic, so what
>   the preview says is what a study of that size would send.
> - **The per-execution cohorts screen is titled "Who went"**, at
>   `studies/:study/executions/:runId/cohorts`, linked from each `Executions` row and from
>   `StudyResults`' "Who we sent" footer as "Who went, by name" beside "The people this study
>   sends" (→ `studies/:study/people`). It is in no rail group, because it is a fact about one
>   execution and not about the study. **The targets list's one act reads "Connect a target"**, not
>   "New target", because what it opens is §5's exception and the verb says so.

**Web screens removed:** `NewSimulation`, `SimulationSettings`, `FirstRun`, the `PairingsGrid`
organism and the Targets and Who-can-go bands of the project home. The old paths redirect
(ADR-0042 §2). The per-person editor moves from the cohort page to the study's people page and is
not otherwise changed.

**Screens stay a bounded number of store calls.** The study's people page costs the same number of
queries for one person as for sixty, asserted the way the results screen already is
(WEB-ARCHITECTURE §5).

**What is knowingly left open:**

- **No builder is covered by a test that renders it.** The web package has no DOM test setup
  (ADR-0040 recorded the same gap), so the chain — create, `then`, `picked`, invalidate, apply — is
  asserted at the server end of each step and in the pure functions the screens call, and the
  brief's last step is a person walking the dashboard in a browser.
- **Drafts are per tab.** Session storage is what makes a draft vanish when the tab closes, which
  is the behaviour wanted for an abandoned form; it also means a draft is invisible from a second
  tab, and a reader with two tabs open on one builder gets whichever wrote last.
- **`then` stays within the project.** A chain that starts outside the project base — a marketing
  page, another project — is ignored and the created item's own page is used. Nothing has asked
  for a chain across projects, and ADR-0035 says nothing is shared across them anyway.
- **A refused delete is a dead end.** The dialog says which populations hold a cohort and links
  nowhere; the reader opens each population's builder and removes the cohort by hand. A "remove
  from all N" is a cascade with a confirmation, and that is a decision on its own.
- **The saved-target editor still shows a generated secret before storing it.** ADR-0040 left this
  open and §5 keeps that screen as it was; the exception carries the exception's debt.

**The argument against all of this, recorded so it is not re-discovered.** Five lists and five
builders is more surface than a first-time user needs to get to a first execution, and the
one-request starter path got them there without reading a single noun — ADR-0029's amendment
weighed exactly this and chose the shortcut. Removing it means a new project's first visit is a
needs panel with a sentence and four links, and a reader who only wanted to point populace at a
demo now makes a persona, a cohort, a population and a study before pressing go. That cost is real,
and the chain is the mitigation — each builder opens the next with the outer one's place kept — not
a removal of it. What would change the decision is a measured first-run drop-off at the needs panel;
the answer then is a builder that pre-fills the whole chain from one starter (a study builder that
offers "start from a starter" and makes the cohort and population behind a disclosure), which is a
shortcut that names what it makes, not a return to one that did not.

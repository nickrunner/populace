# ADR-0033: A tool policy belongs to the target; a persona may only narrow it

**Status:** accepted 2026-09-18

## Context

`ToolPolicy` — an allowlist, a denylist and what to do with tools the target annotates
`destructiveHint` — existed only on a **persona**. That is the wrong altitude for the decision.

A user pointing populace at their own deployed product found this immediately. Their MCP server
exposes `acceptStay`, `rejectStay`, `publishStayPromotion`, `updateOrgClaimStatus`,
`createAnnouncement` and `updateAssistantPrompt` alongside a pile of enumeration tools
(`getUsers`, `getUserByEmail`, `getTransactions`, `getAllFeedback`). Every one of those is
dangerous, or a privacy problem, **regardless of which persona reaches for it**. With policy only
on personas, keeping the population off them meant writing identical deny globs on all six
personas — and a persona added next month silently inherits the whole surface.

A policy that fails open as the population grows is not a policy.

## Decision

`ToolPolicy` also lives on the **target** (`TargetSchema`, `StoredTargetSchema`), is resolved into
`config.target.tools`, and the effective policy for a wake is the target's **merged with** the
persona's:

- **deny is a union** — a deny from either side is a deny;
- **allow is an intersection** — a tool must clear *every* non-empty allowlist;
- **destructive takes the stricter setting** — `deny` beats `confirm` beats `allow` (ADR-0013).

So narrowing is the only direction a persona can move. It can take more away; it can never put
anything back.

The merge is `effectiveToolPolicy()` in core, and the merged shape keeps each source's allowlist as
its own gate (`allow: string[][]`) rather than flattening them into one list. That is not
fastidiousness: the intersection of two glob sets is not a glob set — `list_*` ∩ `*_tasks` is
neither pattern — and concatenating them would **union** them, which is exactly the failure this
ADR exists to prevent.

The merge is applied in `runWake`, in the one loop that decides which target tools are offered to
the model at all, and the same merged setting drives the destructive check on dispatch. It is
deliberately not applied in the config assembler: a wake built by hand — the CLI, a test, a future
cloud job — would then run on the persona's policy alone, and a merge that is right but applied in
the wrong place is still a hole.

## Consequences

The target editor shows the target's live tool list with every tool marked allowed or blocked
under the globs as they are typed, because a glob is only as good as what it matches. The persona
editor applies the target's policy first, so the tools it strikes through are the tools that will
actually be unreachable rather than the ones the persona alone would have removed.

Preflight names what is blocked and for whom. "What will happen if I run this" has to include what
will *not* happen: a tool taken away by a typo'd glob is otherwise discovered as a silence in the
digest a day later.

`populace validate` reports the target's blocked tools once and each participant's separately,
instead of reporting a persona's policy as though it were the whole story.

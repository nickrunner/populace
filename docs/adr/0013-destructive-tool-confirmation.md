# ADR-0013: Destructive tools are confirmed by an identical repeat call

**Status:** accepted

## Decision

When a tool carries `annotations.destructiveHint: true` and the persona policy is `confirm`, the first call returns a tool error explaining that the tool is destructive and asking the agent to call it again with identical arguments if it really intends to. An identical call within the same wake proceeds. Both calls are in the trace. `allow` skips this; `deny` always refuses. Default is `confirm`.

This keeps the target tool schema untouched, works with any MCP server, and produces a visible intent signal in the trace.

## Amendment (ADR-0033)

The setting is no longer the persona's alone. A target carries one too, and the effective setting
for a wake is the **stricter** of the two: `deny` beats `confirm` beats `allow`. A persona that
says `allow` cannot soften a target that says `confirm`, for the same reason a persona cannot widen
an allowlist — a tool that is dangerous is dangerous whoever reaches for it.

## Amendment: the default is `allow` (2026-09-30)

The default inverted, from `confirm` to `allow`. The mechanism is unchanged — three settings, the
stricter of target and persona, an identical repeat to confirm. What changed is which one you get
when nobody says.

`confirm` as a default was buying safety with fidelity, and populace is an instrument. The
refusal it returns is a tool error no real user would ever meet, so the agent on the other side
learns something about the harness rather than something about the product; it costs a turn
against `maxTurns` every time, and `pendingConfirm` is per-wake, so a longitudinal agent pays it
again on every visit for the same delete. Worse, it can suppress exactly the coverage it was
guarding: an agent that reads the refusal as "this is not available" routes around the destructive
path instead of repeating, and the destructive path is where the interesting bugs are. A
population that never deletes anything never finds the delete bugs.

The assumption behind the flip, stated so it can be argued with: **the environment a study runs
against is disposable.** Nothing in `TargetSchema` records that, and ADR-0033's own motivating
case — a shared, long-lived deployment exposing `rejectStay` and `updateOrgClaimStatus` — is a
target where it is false. So the setting stays, and so does the one-way merge of ADR-0033. A
target that is not disposable says `confirm` or `deny` on the target, where the fact lives, and no
persona can soften it. The default now serves the common case instead of the rare one.

Two things did not simply follow the default. `first-contact`'s probe is pinned to `deny`: a check
acts on the *operator's* behalf against an address nobody has run a study against yet, which makes
it the one caller that must never destroy anything. And the `power-user` starter dropped its
`confirm` override entirely — its "Never destroys a whole workspace by accident" constraint is
character, and character belongs in the prompt, not in a guardrail.

The hazards the old default covered are real and are now unguarded: an agent that calls
`delete_account` destroys its own identity, and every later wake for that person fails on auth and
files noise; on a target where self-signup lands everyone in one shared workspace, one agent's
delete takes another's work with it and the phantom findings trace to populace, not the product.
Neither is addressed here. Both are reasons an operator sets the target's policy.

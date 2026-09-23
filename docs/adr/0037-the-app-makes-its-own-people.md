# ADR-0037: The app makes its own people

**Status:** accepted 2026-09-22

## Context

ADR-0036 made connecting to a gated target a sign-in, and its amendment made the way in a question
the screen asks rather than a guess. Both left the harder half standing: **on a real product, none
of the three ways in works without a lot of lifting.**

- `self-signup` needs a tool on the MCP surface that makes an account. Many servers authenticate at
  the transport, before dispatch — the server instance is built *from* the resolved caller, so
  there is nowhere to put an anonymous tool without inverting that. And an account-making tool on a
  machine-facing surface bypasses whatever anti-abuse the human sign-up accumulated, because an
  agent cannot do a captcha.
- `static` needs N accounts made by hand into a JSON file, and it implements no `refresh` — so a
  pool of anything with an expiry (a Firebase ID token lasts an hour) is dead before a run of any
  length finishes.
- `admin-mint` needs a vendor service account. For Firebase that is `createCustomToken` for ANY
  uid, which is impersonation of any user in the project including an admin, sitting in a SQLite
  file on a laptop. And it still fails on a product that resolves callers against its own database,
  because a Firebase user is not yet a user of the product.

The question that produced this was about productization, not about any one target: *"I don't want
populace users to have to do a ton of lifting to get populace to work with their app. I want to
ship a starting point and have them wire it up so that there is as little friction as possible."*

## Decision

**The app makes its own people, behind an endpoint it owns.** populace calls it with one shared
secret and holds no vendor credential at all.

The app-side half ships as `@populace/tdk` — a Target Development Kit, because provisioning is its
first job and not its only one. The populace-side half is the `provision-url` identity strategy in
this repo. The form asks for **an address and a secret**, and nothing else.

### One function, not one endpoint

populace cannot know how a product makes a user, so somebody has to write that — that is the
irreducible work, and it is about fifteen lines. **Everything else is generic**: the wire, the
constant-time secret, the run tag, expiry and renewal, idempotent teardown, listing by tag, the
dev-only guard, the error shapes. Every app re-implementing that is the friction being deleted, so
it lives in the kit and the app implements `createPerson`.

### It is the least-privilege option, which is why it is offered first

`self-signup`'s one real virtue was that populace held nothing — it got in as any stranger could.
This keeps that property without putting an account factory on the public MCP surface: the app
keeps its own admin credentials, and populace holds a **dev-scoped, revocable, single-purpose
secret** that can only make throwaway users in one environment.

That is a different conversation with a security reviewer than "give this laptop tool your Firebase
service account", and it is the reason this is the first way in the form offers.

### The sweep follows the cursor

The kit pages its listing, and its defaults are deliberately tolerant of a populace older than
itself: no version header means "same version as me", no cursor means "page one". **The one place
that tolerance could hide a bug is the sweep** — a provider that took page one and believed it
would report every account removed while leaving everyone past the hundredth on somebody's product.
`listByTag` follows `nextCursor` to the end, with a page ceiling so a cursor that never terminates
is an error rather than a hang, and the test walks 250 people to prove it.

### Both halves are tested against each other, not against a fixture

`packages/adapters/src/provision-url.test.ts` drives the real kit handler from the real provider.
The only fake is the app's own `createPerson`. Two implementations of one contract tested against
separate fixtures is how they come to agree about something neither one does; this cannot.

It earned that immediately. populace has always built an identity's email as
`handle+tag@domain`, and a tag is `populace:run_x_y` — **a colon is not legal in an unquoted email
local part** (RFC 5321), so the kit's `z.email()` refused an address populace had been generating
all along. `provision-url` now puts the run id in the local part, which is legal, stable and
recoverable by prefixing `populace:`; the authoritative tag goes in the request body untouched.

## Consequences

No store schema changed: an identity strategy is a field inside an already-JSON-encoded target row,
so `SCHEMA_SHAPE` is untouched and no database was dropped (ADR-0011).

The secret follows the rule every credential in this system follows — up and never down.
`identityView` reports `secretSet` and `mergeIdentity` treats absent as "keep" and blank as
"clear", exactly as admin-mint's `apiKey` does. Both branches now live in one place rather than
one being a special case.

First contact (ADR-0034) needed no new machinery: it provisions through whatever strategy is
configured, so pressing it on a `provision-url` target exercises the endpoint, the token against
the real MCP server, and teardown — and its refusal wording gained a branch that points at the
app's own `createPerson` rather than at populace.

**What is knowingly left open:**

- **Nothing verifies that the tag survives.** `createPerson` returns no tag, so an app that drops
  it on the way in is discovered by a sweep that finds nothing. The kit's own author called this
  out, and it is the argument for the conformance-check capability the TDK will grow, not a hole in
  the wire.
- **`expiresAt: null` means both "never expires" and "nobody said"** on both sides of this wire,
  because `Credential` has always conflated them. Splitting it is a populace-side change or
  nothing.
- **The strategy is not offered in `populace.yaml`'s starter template**, so a config-first user
  finds it only through the dashboard.

## Amendment — every provider builds a legal address now

The note above said `admin-mint` and `self-signup` kept the invalid form and that changing them
would move the addresses of accounts existing runs had created. That caution does not apply to a
build with no runs to protect, and the reply was to say so: *"This is a greenfield build — don't
worry about existing runs."*

So `emailTagFor` moved to `packages/core/src/ids.ts`, beside `tagForRun` and `slugify` where it
belongs, and all three providers use it. Every address populace generates is now one that
`z.email()` accepts.

Two call sites had encoded the old shape and are the reason this is worth recording rather than
just doing:

- **`e2e.test.ts` asked the mock target for a run's accounts by `?tag=populace:<runId>`**, and that
  route matches an email substring the way a real admin API would. It asks by run id now. Nothing
  in populace's own sweep does this — `self-signup` sweeps from stored rows and `admin-mint` from a
  Firebase custom claim — so the reference target was the only thing that had to learn.
- **`wake.test.ts` asserted the tag was in the address.** It asserts the run id is, and that a
  colon is not.

The email has never been the authoritative copy of the tag: the identity row carries it, and on the
provisioning wire it goes in the request body. What the address carries is a fallback for a target
with nowhere else to put it, and a fallback that makes the address invalid was worth nobody's
tolerance.

## Amendment — attributes, so one person can differ from another

`createPerson` was handed five fields, and every one of them had the same shape for everybody: a
handle, a name, an address, a run, a password. A reader integrating the kit asked the obvious
question — *"different apps will require different sign up parameters… is there a custom params
field?"* — and the honest answer was no. What the docs called "supply them yourself" meant
hardcoding a constant in your own function, which cannot express a population where half the people
are on the paid plan.

**`POST /people` now carries `attributes`: flat key/values drawn from the persona the person was
invented from.** `individuate` already merges persona traits, the cohort's overlay and per-person
overrides into one bag; this sends that bag. populace had the data all along and nowhere to put it.

Three properties, decided deliberately:

- **It is advisory, not a schema.** The keys are whatever a persona author typed. The kit's own
  documentation tells an app to read what it recognises and ignore the rest, and says plainly that
  `attributes.admin` is a sentence somebody wrote rather than a claim anybody checked — a product
  reading one into a role has handed its test fixtures a privilege escalation.
- **A value the kit cannot use is dropped, not refused.** Strictness would be paid in the wrong
  place: the kit runs inside somebody else's server on their deploy cadence, so a populace that one
  day sends a nested trait would make every already-installed kit refuse every person, failing a
  whole run's provisioning over one odd value. Dropping costs an app an attribute it did not
  recognise anyway.
- **It needed no version bump of the contract.** `tdk` stays at 1. `PersonRequestSchema` is not
  `strict`, so a 0.1.0 kit silently ignores the new field and every person arrives as before —
  which is the behaviour that existed yesterday, not a failure. The kit's package version goes to
  0.2.0 because it gained a capability; the wire did not break.

What this does not do: populace still cannot send anything the persona model cannot hold. A trait
is a string, a number or a boolean, so an app needing a nested object or a list gets neither, and
the answer for now is to flatten it into keys.

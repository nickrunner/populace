# ADR-0038: A way in for a target with no accounts, and three answers instead of four peers

**Status:** accepted 2026-09-23

## Context

ADR-0036 made connecting a sign-in and ADR-0037 gave the app a way to make its own people. A reader
arriving at the finished screen — four radio buttons with four hints and no hierarchy between them
— asked six questions in one breath:

> *"What if my MCP server doesn't require a user account? Does this step even apply? Then if it
> does apply I don't really understand the options. Are we still leaving the admin SDK minting
> option? Or are we removing that? What does 'My app makes them' even mean? That's the TDK option
> right meaning the user has to have a developer integrate the TDK into the app. Is that the
> recommended path? 'They sign themselves up' is currently marked recommended but doesn't that
> method have other security risks? Would MCP servers actually be built to allow that? Maybe? The
> accounts from file option is intriguing but it requires a ton of setup and it's kind of unclear
> how a user would even accomplish a task like that of setting up a complicated json file for
> dozens of accounts."*

Every question was fair. Two of them the screen answered *wrongly*: it still called self-signup
"Recommended", which ADR-0037 had overturned the day before, and it still counted three ways where
there were four.

The first question was the sharpest, because it named a capability the product did not have.
`TargetInputSchema.identity` was required, `IdentityConfigSchema` was a four-member union and
`identityProviderFor` had four cases and no null branch. There was no way to say *this server has
no users*.

`docs/design/WAYS-IN-AUDIT.md` is the audit that came out of it, and this record is what was built.

## Decision

### 1. There is a fifth way in, and it is the answer to "does this step even apply?"

**`{ strategy: "none" }` — "They don't need one."**

A documentation server, a search index, an internal read-only tool: the MCP surface is a library
rather than an account, everybody who visits sees the same thing, and there is nothing to provision.

**The runner was already most of the way there and could not be reached.** `runWake`'s connect
section reads `identity?.credential.bearerToken` and the refusal above it is guarded on the identity
existing, so a null identity connects with `McpSession(endpoint, undefined)` and falls back to
whatever the ADDRESS carries. But the only path that left `identity` null was a `provision()` that
returned `kind: "self-service"`, and only `SelfSignupProvider` returned it. So the state was real
and unreachable — which is why this is a third `ProvisionResult` variant (`{ kind: "none" }`) and
not merely a fifth member of a schema union. A schema member with no variant behind it would have
had to invent a credential in order to say there was not one.

**Nothing is written and nothing is claimed.** No identity row, so a sweep finds nothing and reports
nothing; `ownsAccounts = false`, so a no-op can never be counted as a removal. First contact drops
to the question one step lower — connect with the address's own credentials and make one read-only
call — which is the same six-outcome vocabulary minus `provision-failed`, because nothing was
provisioned. Its `rejected` sentence names both things a refusal can mean there: the address wants a
credential of its own, or the product does have users after all and this is the wrong answer.

**No database was dropped.** An identity strategy is a field inside an already-JSON-encoded target
row, so `SCHEMA_SHAPE` is untouched (ADR-0011), exactly as ADR-0037 found for `provision-url`.

**It is also the honest answer to the strongest argument against the recommended path** (below): the
first thing somebody points populace at is often a read-only surface they are still working out the
shape of, and until now they were told to invent a sign-up tool or stopped at a Save button that
never appeared.

### 2. `provision-url` stays the recommended way in — ADR-0037 was re-examined and kept

The audit put the question back to the repo's owner, whose answer settles it:

> *"I think we can start with OAuth as the preferred connection strategy. As long as the integration
> is dead simple and there are clear instructions and provided code samples and clear documentation
> — I think recommending the populace TDK is totally fine. I think that gives us the most control
> over things and allows users to confidently integrate their own security protocols as we build out
> the TDK."*

The argument that beats every alternative is not convenience, it is **what populace ends up
holding**: a revocable, dev-scoped, single-purpose secret that can make throwaway users in one
environment, against a vendor service account, against N real logins on a real product, against an
account factory on a public machine surface. That is a different conversation with a security
reviewer, and it is the conversation that decides whether populace gets used on anything that
matters. It is also the only option that works for a product whose API resolves callers against its
own database, which is most products.

**The endorsement is conditional, and the condition is in scope.** "As long as the integration is
dead simple" is a requirement, not a hope, so three things ship with the recommendation:

- **The snippet is in the product, with a secret already in it.** Choosing "My app makes them" shows
  copy-paste code for the reader's own stack — Express, a `fetch` route handler, Hono, which are the
  three mounts `Mounted` actually offers and no more — with a freshly generated secret printed in it
  and already filling the form's field. Generating it beats asking somebody to invent one and paste
  it identically into two places, which is a typo that presents three screens later as
  `unauthorized`.
- **The wiring check is immediate.** A `Check this endpoint` button beside the two fields, answered
  in the same register first contact uses. §3 below.
- **`docs/TARGET-SETUP.md`** is written for somebody integrating populace into their own product for
  the first time: which of the three they are, the fifteen lines, and what to check when it does not
  answer. Linked from the screen and from `README.md`.

### 3. The handshake is wired, and it was a live bug as well as a missing feature

`ProvisionUrlProvider.describe()` — a `GET` at the kit's mount point that creates nobody — existed
and was called **nowhere outside its own tests**. Two consequences, and the second is worse than the
first.

The missing check is now `POST /projects/:p/provisioning/check`. It hangs off the project and not
off a target because it has to answer before a target is saved; it is a `POST` because the body
carries a secret, which is the same reason first contact is one, and not because it writes. It obeys
ADR-0036's rule exactly: a `GET` against somebody else's server that registers nothing and creates
nobody is the one thing safe to do before a button press.

The bug is that **`cannotRemove` is guarded on state only `describe()` sets.** In a real sweep it was
`undefined`, which reads as "it can remove them", so an app that soft-deletes had every teardown
attempted, every one refused `unsupported`, and the run reported **N failures** where the truth is
**N accounts left behind**. ADR-0037 promised the other outcome in writing: *"An app that
soft-deletes says `teardown: false` and a sweep then reports the accounts it left behind instead of
counting a no-op as a removal."* `describe()` now runs in front of the teardown loop in `sweepRun`
and in front of `cannotRemove` in first contact's cleanup, and a test drives it from an app that
says `teardown: false`.

`IdentityProvider` grows an optional `describe(): Promise<ProviderDescription>` for this. It is
optional because it is only meaningful for a provider that learns what it can do from the target
rather than from its own source.

### 4. Two demotions, and neither is a removal

**`self-signup` loses "Recommended" and is offered only when the check found a tool.** It stays,
because it is the one way in where populace holds no credential at all — it gets in the way any
stranger could — and because when a sign-up tool *is* on the list it is the cheapest correct answer
in the product. But an account-making tool on a machine-facing surface bypasses whatever anti-abuse
the human sign-up accumulated, because nothing there can do a captcha, and many servers authenticate
at the transport before dispatch so there is nowhere to put an anonymous tool at all. When
`guessIdentity` found nothing, the radio is `aria-disabled` with that sentence as its reason rather
than removed: a control at a bound is inert, not gone (DESIGN-SYSTEM §6), and a reader who has just
been told nobody can sign up here should not be left to infer why an option vanished.

**`admin-mint` moves behind "Other ways", with the risk named.** Not removed: it is the only option
that needs no change to the app, and an evaluator pointed at a build they do not own is a real
reader. But `createCustomToken` for *any* uid is impersonation of any user in the project, including
an admin, and the credential sits in a SQLite file on a laptop — while `@populace/tdk`'s `firebase()`
preset does the same job at rung one with no functions at all, and the service account stays with the
app. Offering the two side by side with equal weight is offering a choice between two doors, one of
which has a hole in the floor.

**`static` moves behind "Other ways" too, and its one invisible limitation is finally said out
loud.** There is no `refresh` on `StaticIdentityProvider` and nothing for it to redeem, so `wake.ts`
skips renewal entirely: a pool of Firebase ID tokens is dead in an hour and the product said nothing
until every visit ended `auth-failed`. `checkPopulation` had every `expiresAt` in hand at run start
and did not look. It looks now — naming the entries by pool key and position, never by token — and
refuses to start; the form warns separately, without blocking, because an expiry a day out is
perfectly valid today and will not be on Thursday.

### 5. The question changes altitude, and the answers are not peers

The legend was `Way in` and the options were mechanisms. A reader who does not already know which
mechanism their product uses cannot answer a question phrased that way. It is now **"How do people
get accounts on your app?"**, and the options are answers to it: *my app makes them*, *they sign
themselves up*, *they don't need one* — with the two escape hatches behind a `Disclosure` in the same
radio group, which opens by itself when one of them is the saved answer.

The order is what the check learned and nothing else. The recommended one is always first. After it,
self-signup comes second when the tool list holds a sign-up — that is the cheapest correct answer
when it is available — and last, inert, when it does not.

**`ConditionalFieldset` grew both mechanisms** (`disabled?: { reason }` and `folded`), so they are
design-system behaviour rather than one screen's arrangement, and `Radio` grew `atBound` to carry
`aria-disabled` without leaving the tab order. ATOMIC-INVENTORY §2 row 36 records both.

### 6. A bearer field on Connect, and Save without a green check

This closes ADR-0036's last "knowingly left open" bullet, and it is what makes the fifth way in
usable for the gateway case.

A server gated by a plain bearer with no OAuth to discover **could not have a target saved at all**:
Connect posted no bearer, the check failed, and the identity section and the Save button rendered
only behind `result?.ok !== true ? null :`. The one field that would have fixed it lived on the
saved-target editor, which is reachable only for a target that already exists. That is the same shape
as the bug ADR-0036's own amendment fixed — the one screen that could set the thing behind the one
screen that needed it — and it had no workaround.

There is a bearer field beside the address now, sent with both the check and the save. And the
sections render once a check has been *attempted* rather than once one has *succeeded*: Save is at a
bound with the reason named in `aria-describedby`, and a line says plainly that nothing has confirmed
the address yet and saving anyway is fine.

## Consequences

**No store change.** `SCHEMA_SHAPE` is untouched and no database was dropped.

**A fresh project's default identity is `{ strategy: "none" }`.** It was
`{ strategy: "self-signup", signupTool: "unset" }`, which names a tool that exists on no target and
was exactly the sort of placeholder that surfaces in an error message one day. Every target
overrides it either way; the difference is what an unconfigured project says about itself.

**The word "none" is a wire value and never UI copy.** The screen says *they don't need one*, the
check says *nobody needs an account here*, and the vocabulary rules (DESIGN-SYSTEM §7) hold.

**What is knowingly left open:**

- **The per-user-surface heuristic is not built.** A tool list with `whoami`, `get_me` or
  descriptions in the second person is a product with accounts; a list of `search_docs` and
  `get_page` probably is not. The audit's §4 proposes it in the same register as `checkPromises` —
  it would order the options and write one sentence of reason, and it would never choose. Until it
  exists, "they don't need one" is offered in a fixed position and the reader decides, because a
  tool list genuinely cannot establish that a product has no users (ADR-0035: refuse to guess, and
  name the choices).
- **`none` and `provision-url` are still absent from `populace.yaml`'s starter template**, so a
  config-first user finds both only through the dashboard. ADR-0037 left the second one open and
  this adds a first.
- **There is no `populace accounts template` command.** A generator that wrote a cohort-keyed
  skeleton with the right slugs in it is the only thing that would make the static pool's setup cost
  honest, and the reader who called it "a ton of setup" was right until it exists.
- **Preflight still only knows how one strategy can be dead.** It blocks a run whose tool policy
  forbids its sign-up tool. There is no equivalent for a `provision-url` target with no secret
  stored, or a `static` file that has been moved since it was configured. Both are knowable without
  touching anything.
- **`emailDomain` still defaults to `populace.test`.** Fine for a product that never sends mail, an
  invisible wall for one that verifies addresses before the account works, and no copy anywhere says
  so.

**The argument against all of this, recorded so it is not re-discovered.** The recommended path asks
a developer to merge code into the product before populace does anything at all, and the person
evaluating populace is frequently not that developer. It optimises the steady state at the cost of
the trial, and a product nobody finishes the trial of has no steady state. The mitigation is not to
re-promote admin-mint — its security posture is what it is — but to make the trial not need accounts
at all, which is the fifth way in and the reason it shipped first. What would change the decision is
evidence that the first target a new user points populace at usually *does* have per-user accounts
and they cannot get code into it; nobody has run this on enough real products to know.

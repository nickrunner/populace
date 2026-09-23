# The ways in: an audit and a recommendation

**Status:** a proposal. Nothing here is built. It asks for one new way in, three demotions, one
reshaped screen and about four days of work, and it argues that ADR-0037 got the recommendation
right and the screen got it wrong.

## What prompted it

A user, mid-setup, looking at four radio buttons with no hierarchy between them:

> *"What if my MCP server doesn't require a user account? Does this step even apply? Then if it
> does apply I don't really understand the options. Are we still leaving the admin SDK minting
> option? Or are we removing that? What does 'My app makes them' even mean? That's the TDK option
> right meaning the user has to have a developer integrate the TDK into the app. Is that the
> recommended path? 'They sign themselves up' is currently marked recommended but doesn't that
> method have other security risks? Would MCP servers actually be built to allow that? Maybe? The
> accounts from file option is intriguing but it requires a ton of setup and it's kind of unclear
> how a user would even accomplish a task like that of setting up a complicated json file for
> dozens of accounts."*

Every question is fair and the screen answers none of them. Two of them the screen answers
*wrongly*: it still calls self-signup "Recommended" (`packages/web/src/screens/library/ways-in.tsx:223`),
which ADR-0037 overturned the day before, and it still counts three ways where there are four
(`packages/web/src/screens/library/ConnectTarget.tsx:311`).

But the sharpest question is the first one, because it names a capability the product does not
have at all.

---

## 1. What each option actually is

### 1.1 There is no fifth option, and there should be

**A target with no user accounts cannot be expressed.** `TargetInputSchema.identity` is required
(`packages/contract/src/setup.ts:83`), `PopulaceConfigSchema.identity` is required
(`packages/core/src/schemas/config.ts:32`), `IdentityConfigSchema` is a four-member discriminated
union (`packages/core/src/schemas/identity-config.ts:100`), and `identityProviderFor` has four
cases and no null branch (`packages/adapters/src/index.ts:12-22`). Every one of the four demands a
field the reader would have to invent.

The runner is most of the way to supporting it already. In `runWake`'s connect section, the bearer
is `identity?.credential.bearerToken` and the refusal above it is guarded on the identity existing:

```ts
// packages/runner/src/wake.ts:329-334
const bearer = identity?.credential.bearerToken;
if (identity && bearer === undefined) {
  const summary = "this person has no usable credential: …";
```

A null identity therefore connects with `McpSession(endpoint, undefined)`, which falls back to the
endpoint's own token, or to nothing. **But no configuration can produce a null identity.** The only
path that leaves `identity` null is a `provision()` that returned `kind: "self-service"`
(`packages/runner/src/wake.ts:275-297`), and `SelfSignupProvider` is the only provider that returns
it. So the capability is one `ProvisionResult` variant away from existing, not zero.

The practical dead end is worse than "name a sign-up tool that does not exist". For a server gated
by a single gateway token on the endpoint — the QA-gateway case `McpEndpoint.bearerToken` was
written for (`packages/core/src/schemas/target.ts:9`) — the Connect screen cannot save a target at
all. It posts `mcp: [{ name: "default", url }]` with no bearer
(`packages/web/src/screens/library/ConnectTarget.tsx:158`), the whole identity section and the Save
button render only behind `result?.ok !== true ? null :` (line 300), and the check cannot succeed
without the token. The one field that would fix it lives on the saved-target editor
(`packages/web/src/screens/library/Target.tsx:372`), which is reachable only for a target that
already exists. That is ADR-0036's fourth "knowingly left open" bullet, still open, and it is the
same shape as the bug ADR-0036's own amendment fixed: the one screen that could set the thing is
behind the one screen that needs it.

**Who it is for:** documentation servers, search and retrieval servers, internal read-only tools,
anything whose MCP surface is a library rather than an account. Also, and more commonly than the
category suggests, the *first* thing somebody points populace at while they are still working out
what it does.

**What it costs to support honestly:** about half a day. The enumeration is in §5.

### 1.2 `provision-url` — the app makes its own people

**Capability:** total. One HTTP call to an endpoint the app owns
(`packages/adapters/src/provision-url/index.ts:127-151`), `refresh` (line 158), idempotent
`teardown` (line 180), and a `listByTag` that follows `nextCursor` to the end with a page ceiling
(line 193-209). It is the only strategy that can serve a product whose API resolves callers against
its own database, because creating the vendor user and creating the app's row are one operation on
the app's side of the wire.

**Setup cost:** a developer mounts `@populace/tdk` and writes one function. The kit's ladder makes
the real number honest: rung one is a Firebase preset with no functions at all, rung two is the
preset plus an `afterCreate` that writes the app's own user row, rung three is about fifteen lines
(`packages/tdk/README.md:43-85`). The irreducible part is "how does your app make a user", which
nobody but the app can answer.

**Failure modes:** a wrong address answers nothing; a wrong secret answers `unauthorized`; an older
kit answers with a sentence naming the upgrade. All three are distinguishable and all three are
already worded. The endpoint is dev-only by default and refuses everything in production, including
the handshake (`packages/tdk/README.md:206-210`).

**Security posture:** the best of the five by a distance. populace holds a dev-scoped, revocable,
single-purpose secret that can do exactly what the app wrote into `createPerson`, on the deployment
it was mounted in, and nothing else. Rotation is one environment variable.

**Who it is really for:** anybody shipping a real product who can merge a pull request into it.

### 1.3 `self-signup` — they sign themselves up

**Capability:** provision is a *suggestion*, not a credential — the provider hands back
`kind: "self-service"` and the runner watches the sign-up tool for a token
(`packages/adapters/src/self-signup/index.ts:45-71`). No `refresh` (the token is "taken at its word
until the target refuses it", line 63-64). Teardown only if the target also exposes a delete-account
tool; without one, `cannotRemove` says so in the user's words and a sweep reports the accounts as
stranded (`packages/adapters/src/self-signup/index.ts:30-32`, `packages/server/src/sweep.ts:89-91`).

**Setup cost:** zero, *when the tool exists*. `guessIdentity` finds it from the tool list and
pre-fills four fields (`packages/server/src/target-check.ts:82-109`). This is the only option that
the check can fill in for the reader.

**Failure modes:** `tokenPath` is a guess — MCP publishes an input schema, not an output one, so
where the token comes back is not knowable and the default is simply `"token"`
(`packages/server/src/target-check.ts:118-127`). That is the field first contact exists to catch,
and its failure leaves an account on the product with no credential to delete it with
(ADR-0034).

**Security posture:** the one option where populace holds no credential at all — it gets in the way
any stranger could. That is a real advantage and should not be argued away. The cost is on the
other side of the wire: an account-making tool on a machine-facing surface bypasses whatever
anti-abuse the human sign-up accumulated, because nothing there can do a captcha, and many servers
authenticate at the transport before dispatch, so there is nowhere to put an anonymous tool without
inverting how the server is built.

**Who it is really for:** the reference target, and products that deliberately expose sign-up to
machines. `packages/mock-target` has one because it is a toy. That is not an argument against the
option; it is an argument against it being the default.

### 1.4 `static` — accounts from a file

**Capability:** the narrowest. One entry per person, assigned deterministically by cohort and
ordinal, with no modulo, so a short pool is an error rather than two people sharing a login
(`packages/adapters/src/static/index.ts:139-148`). `checkPopulation` catches three
population-shaped mistakes before a run starts: too few entries, one legacy pool serving two
cohorts, and the same bearer pasted twice (lines 156-199). It is the most carefully written
provider in the package.

**And it has no `refresh`.** There is no such method on `StaticIdentityProvider`, and
`IdentityProvider.refresh` is optional (`packages/core/src/interfaces/identity-provider.ts:84`), so
`wake.ts:304` skips redemption entirely. `credentialNeedsRedeem` would have returned true ten
minutes before the expiry (`packages/core/src/schemas/identity.ts:72-75`); nothing consults it.
The visit connects with a dead bearer and ends `auth-failed`. **Nothing warns.** `checkPopulation`
has every entry's `expiresAt` in hand at run start and does not look at it.

**Setup cost:** the reason the user called it "a ton of setup" is that it is. Twelve people means
twelve real accounts made by hand on a real product, twelve tokens copied out of twelve places, and
a JSON file keyed by cohort slug — a slug the reader has to go and find. The form's hint is one
line of JSON in a `hint` prop (`packages/web/src/screens/library/ways-in.tsx:377`) and there is no
generator, no validator, and no example file in the repo.

**Security posture:** populace holds N real credentials for real accounts on a real product, in a
SQLite file. `ownsAccounts = false` is honest about the consequence — a sweep leaves them alone and
says so — but it also means the mess those accounts make is permanent.

**Who it is really for:** a staging database that was seeded with users months ago; a product where
making an account costs money or sends mail; an environment where a human already has the logins in
a password manager. These are real, and they are rare.

### 1.5 `admin-mint` — minted by a Firebase service account

**Capability:** complete, including `refresh` with a genuinely subtle implementation — the renewal
path is chosen by where the credential was *minted*, not by what is configured, because Google's
secure-token endpoint only knows refresh tokens Google issued
(`packages/adapters/src/firebase-admin/index.ts:193-221`). `listByTag` reads a custom claim back
from Firebase, so leaked users are discoverable with the store gone (line 294).

**Setup cost:** a service account JSON on disk, plus a Web API key, plus the knowledge that a
Firebase custom token is not an ID token. The form warns about the last of those without blocking
(`packages/web/src/screens/library/ways-in.tsx:189-193`) and the provider refuses at the mint rather
than at construction, so `sweep` still works for a run configured this way
(`packages/adapters/src/firebase-admin/index.ts:118-127`).

**Failure modes:** the one first contact has to name outright — the account is real and the backend
does not accept this issuer's tokens (`packages/server/src/first-contact.ts:404-406`). And the one
nothing can fix: a product that resolves callers against its own database, where a Firebase user is
not yet a user of the product.

**Security posture:** the worst of the five. `createCustomToken` for *any* uid is impersonation of
any user in the project, including an admin, and the credential sits in a SQLite file on a laptop.
There is no narrower Firebase credential to ask for.

**Who it is really for:** somebody who cannot deploy code into the app — an evaluator, a contractor,
a tester pointed at a build they do not own. That is a real population and it is why this stays in
the codebase. It is not a reason to offer it as a peer.

---

## 2. The recommendation

Stated plainly, and early.

**1. Add a fifth way in: `{ strategy: "none" }`, "They don't need one."** The runner already
connects with no identity; nothing can configure it. This is the answer for an open server or one
gated by a single endpoint token, and today those users are told to invent a sign-up tool or are
stopped at a Save button that never appears. Half a day, no database rebuild — identity lives inside
the `targets` row's JSON (`packages/store-sqlite/src/index.ts:123-125`), so `SCHEMA_SHAPE` is
untouched, exactly as ADR-0037 found.

**2. Keep `provision-url` as the recommended path. ADR-0037 was right.** The argument that beats
every alternative is not convenience, it is what populace ends up holding: a revocable, dev-scoped
secret that can make throwaway users in one environment, versus a vendor service account, versus N
real logins, versus an account factory on a public machine surface. That is a different conversation
with a security reviewer, and it is the conversation that decides whether populace gets used on
anything that matters. It is also the only option that works for a product whose API resolves callers
against its own database, which is most products.

**3. Stop presenting five peers.** The screen's problem is not its options, it is that four radios
with four hints assert that these are four comparable choices a reader should weigh. They are not.
Three of them are answers to "what is your product like" and two are escape hatches. §3 proposes the
shape.

**4. Demote `self-signup` from "Recommended" and let the check decide whether to offer it at all.**
It stays, because it is the only way in where populace holds nothing, and because when a sign-up tool
*is* on the list it is the cheapest correct answer in the product. But it is offered when
`guessIdentity` found a tool, and shown inert with the reason when it did not
(DESIGN-SYSTEM §6: a control at a bound is inert, not gone). A radio the reader was just told is
impossible should not be pressable.

**5. Demote `admin-mint` out of the list and behind "Other ways", with copy that names the risk.**
Not removed. It is the only option that needs no change to the app, and that is a real capability for
an evaluator. But `@populace/tdk`'s `firebase()` preset does the same job at rung one with no
functions at all (`packages/tdk/README.md:45-62`), and the difference between the two is entirely
about who keeps the service account. Offering them side by side with equal weight is offering a
reader a choice between two doors, one of which has a hole in the floor.

**6. Keep `static`, behind "Other ways", and tell the truth about renewal in the form.** It is a real
escape hatch for a seeded staging database, and its `checkPopulation` is good work. It is also the
only option whose central limitation is invisible: a pool of Firebase ID tokens is dead in an hour
and the product says nothing until every visit fails. That is a `whatIdentityWillNotDo` branch and a
`checkPopulation` line, not a removal.

**7. Wire the TDK handshake into the screen.** `ProvisionUrlProvider.describe()` exists
(`packages/adapters/src/provision-url/index.ts:120-125`), is a `GET` that creates nobody, and is
called *nowhere outside the tests*. It is the read-only check ADR-0036's rule was written to permit,
and it turns the two fields most likely to be wrong into a five-second answer.

---

## 3. The screen

### 3.1 The question changes altitude

Today the legend is `"Way in"` (`packages/web/src/screens/library/ways-in.tsx:199`) and the options
are mechanisms. A reader who does not already know which mechanism their product uses cannot answer
a question phrased that way. The legend becomes a question about their product:

> **How do people get accounts on your app?**

Under it, a line that says what is being decided and what it is not — the connect screen has one
already (`ConnectTarget.tsx:303-307`) and the saved-target editor should carry the same one:

> Not the sign-in above — that one is yours, and it is how populace reads this tool list. This is
> how the people a simulation sends get accounts of their *own*, which is the whole point of sending
> them.

### 3.2 Three answers, then a disclosure

Three radios, ordered by what the check learned, then `Other ways` as a disclosure holding the two
escape hatches. Sentence case throughout, no exclamation, no arrows (§7.4).

**1 — They don't need one**

- hint: *This server has no users. Everyone who visits it sees the same thing.*
- note, when chosen: *Nobody will be signed up, and there is nothing to clean up afterwards. If the
  address itself needs a token, it goes on the endpoint below and every person uses it.*
- Shown first when the anonymous check succeeded and nothing in the tool list looks first-person.

**2 — My app makes them**

- hint: *Recommended. Your app answers on an address populace calls, and keeps everything else.*
- note: *Mount `@populace/tdk` in your app, write the one function that makes a user, and point this
  at it. It is about fifteen lines. It is the only way in that works when your accounts are not made
  through an MCP tool, and the only one where populace holds no credential of your vendor's — just a
  secret you can rotate in one environment variable.*
- Fields unchanged, plus the handshake check from §3.4.

**3 — They sign themselves up**

- hint, when the check found one: *`sign_up` is on this server, so each person makes their own
  account through it.* (the tool name in a `ToolName`, as the connect screen already renders it)
- hint, when it did not: *Nothing on this server looks like a sign-up, so nobody could.* — and the
  radio is `aria-disabled` with that sentence as its reason, not removed.
- note: *populace holds no credential at all this way, which is its one real advantage. It also puts
  account creation on a machine-facing surface, where your sign-up form's defences are not.*

**Other ways** *(a disclosure, closed by default)*

**Accounts I already have**

- hint: *A file of logins, one per person. Nothing is created, and nothing is removed afterwards.*
- note: *One entry per person, keyed by cohort — twelve people need twelve logins. populace cannot
  renew any of them, so a token with an hour on it will be refused partway through and those people
  stop.*

**Minted with a Firebase service account**

- hint: *populace holds a key that can sign in as anybody on your Firebase project.*
- note: *For a product you cannot deploy code into. The service account it needs can mint a token for
  any uid, including an admin's, and it is kept on this machine. If you can add a dependency to your
  app, `@populace/tdk`'s `firebase()` preset does the same job and that credential stays yours.*

### 3.3 The sentences on the connect screen that are wrong now

`ConnectTarget.tsx:308-313` says, when no sign-up tool was found:

> Nothing in the tool list looks like a sign-up, so they cannot make their own accounts here. **The
> other two ways both need something from you.**

Three errors in one sentence: the count, the framing ("something from you" is true of every option
including the recommended one), and the implication that this is a problem. Replace with a branch on
what the check actually learned:

- No sign-up tool, endpoint answered anonymously:
  > Nothing here looks like a sign-up, and this server answered without asking who we were. If it has
  > no users at all, say so below and nobody will be signed up. If it does, your app will have to make
  > them.
- No sign-up tool, endpoint is gated:
  > Nothing here looks like a sign-up, so nobody can make their own account. Whoever runs this app
  > will have to make them — the recommended way is the first one below.
- Sign-up tool found: unchanged.

And the file's own prose has the same stale count in three more places:
`ways-in.tsx:20` ("the three mechanisms"), `:42` ("three unselected radios"), `:210` ("The three ways
a PERSON gets an account"). Those are comments, and they are the reason the sentence on screen went
stale: four places recording one number.

### 3.4 One button that answers two fields

Beside the provisioning address and secret, a **Check this endpoint** button. It calls
`describe()` — `GET /` at the mount point, authenticated by the secret, creating nobody — and
prints:

> Answered. It speaks TDK 1, it is running in development, and it can renew and remove accounts and
> list them again.

or, from the kit's own refusal shapes (`packages/tdk/README.md:157-166`):

> The secret was missing or wrong.

This obeys ADR-0036's rule exactly: a `GET` against somebody else's server that registers nothing and
creates nobody. It is a `POST` on populace's own API because the request body carries a secret, which
is the same reason first contact is a `POST` (ADR-0034, ADR-0023).

---

## 4. What the check should already know

The tool list is in hand when this question is asked. Four things can be inferred and one cannot.

**Already known, already on the wire.** Whether the address talks to strangers at all:
`checkTarget` probes the failure and sets `signIn.required`
(`packages/server/src/target-check.ts:47-51`). A check that *succeeded anonymously* is a server with
no transport-level auth, which is the precondition for both "they don't need one" and self-signup.
Nothing on the screen uses that fact to order the options.

**Already known, already used.** Whether a sign-up tool exists, and a guess at its token path and its
teardown tool (`guessIdentity`, `packages/server/src/target-check.ts:82-109`). This is what should
drive whether self-signup is offered or shown inert, rather than only what pre-fills it.

**Inferable, read-only, not built.** Whether this surface is per-user at all. A tool list with
`whoami`, `get_me`, `current_user`, `my_tasks`, or descriptions written in the second person is a
product with accounts; a list of `search_docs` and `get_page` probably is not. This is a heuristic
in the same register as `checkPromises` (`packages/server/src/target-check.ts:145`) and should be
presented the same way — it orders the options and writes one sentence of reason, and it never
chooses. `guessIdentity`'s `because` array is the existing mechanism for exactly that.

**Inferable, read-only, not built, and the highest value of the four.** Whether a provisioning
endpoint is already there. `describe()` is a `GET`; §3.4.

**Not inferable.** Whether the product has users in the sense the business means. A server can expose
nothing but reads and still be a product with accounts, and the right answer for it may still be
"my app makes them". That is the one question to ask, and phrasing it as a question about the product
rather than about mechanisms is what lets a reader answer it without knowing what any of the five
providers do.

---

## 5. What to build, in order

**1. "They don't need one" — half a day.**

- `packages/core/src/schemas/identity-config.ts`: a fifth member, `z.object({ strategy: z.literal("none") })`, and into the union at line 100.
- `packages/core/src/schemas/identity.ts:3`: `"none"` into `IdentityStrategySchema`.
- `packages/core/src/interfaces/identity-provider.ts:12-21`: a third `ProvisionResult` variant, `{ kind: "none" }` — *there is no account and there will not be one*.
- `packages/adapters/src/no-accounts/index.ts`: the provider. `ownsAccounts = false`, `provision` returns the new variant, `teardown` is a no-op, `listByTag` returns the stored rows (there will be none).
- `packages/adapters/src/index.ts:12`: the fifth case. The `switch` is exhaustive, so the compiler names every other site.
- `packages/runner/src/wake.ts:275-297`: the new variant leaves `identity` and `signup` null. The connect section below it already does the right thing (line 329).
- `packages/server/src/first-contact.ts:404,424`: two `switch`es gain a case. The check becomes "connect with the endpoint's own credentials and make one read-only call", which is still the six-outcome vocabulary minus `provision-failed`.
- `packages/contract/src/setup.ts:54,69`: both unions gain the member; neither carries a secret, so `identityView`/`mergeIdentity` (`packages/server/src/control.ts:152-176`) pass it through unchanged.
- `packages/web/src/screens/library/ways-in.tsx`: a branch with no fields, `identityFrom` returns `{ strategy: "none" }`, `whatIdentityNeeds` returns null for it.
- `packages/server/src/config-store.ts:126`: the default for a fresh project becomes `{ strategy: "none" }` instead of `{ strategy: "self-signup", signupTool: "unset" }`, which names a tool that exists on no target.

No store change. Two tests: a wake against the mock target with no identity configured that still
reaches a tool, and a sweep that reports nothing to remove without claiming it removed anything.

**2. The three stale sentences — one hour.** `ways-in.tsx:223` loses "Recommended:";
`ConnectTarget.tsx:311` gets the branch from §3.3; the three comments at `ways-in.tsx:20,42,210`
stop counting.

**3. The reshaped fieldset — one day, plus a design-system entry.** `ConditionalBranch` gains
`disabled?: { reason: string }` and `ConditionalFieldset` renders such a branch `aria-disabled` with
the reason as its hint (§6's rule, applied to a radio for the first time). A `Disclosure` for
"Other ways" — check `ATOMIC-INVENTORY.md` for one before adding it. The legend becomes the product
question. `WaysIn` takes the `TargetCheck` so it can order and disable, which both call sites already
hold.

**4. The handshake, wired — one day.** `POST /projects/:p/provisioning/check` with `{ url, secret }`,
calling `describe()`. It must work before the target is saved, which is why it hangs off the project
and not off a target. The same call goes in front of `teardown` in `sweepRun` and in first contact's
cleanup, so `ProvisionUrlProvider.cannotRemove` can be something other than `undefined` — see §6.

**5. Static tells the truth about renewal — one hour.** A `whatIdentityWillNotDo` branch for
`static`, and a `checkPopulation` line naming the entries whose `expiresAt` is already past or inside
`REDEEM_SKEW_MS`. Every field it needs is parsed already (`EntrySchema` extends `CredentialSchema`).

**6. A bearer field on Connect, and Save without a green check — half a day.** This closes ADR-0036's
last open bullet and it is what makes "they don't need one" usable for the gateway case. The Save
button is at a bound with the reason named, rather than a section that does not render.

**7. ADR-0038 — half a day.** Recording the fifth way, the two demotions, and the fact that ADR-0037's
recommendation was re-examined and kept. ADR-0037 is days old; an audit that confirms a decision is
worth as much as one that overturns it, and cheaper to trust later.

**Later, and separable:** the per-user-surface heuristic (§4); `provision-url` and `none` in
`populace.yaml`'s starter template, which ADR-0037 left open; a `populace accounts template` command
that writes a cohort-keyed skeleton for the static pool with the right slugs in it, which is the only
thing that would make that option's setup cost honest.

---

## 6. Things nobody has asked about

**`describe()` is dead code in production.** Nothing outside `provision-url.test.ts` calls it. Two
consequences. The first is the missed check in §3.4. The second is a promise ADR-0037 makes that does
not hold: *"An app that soft-deletes says `teardown: false` and a sweep then reports the accounts it
left behind instead of counting a no-op as a removal."* `cannotRemove` is guarded on
`this.capabilities !== undefined` (`packages/adapters/src/provision-url/index.ts:110`), and
`capabilities` is only ever set by `describe()`. In a real sweep it is `undefined`, so
`sweep.ts:89` never fires, every teardown is attempted, each one comes back `unsupported` (501), and
the run reports *N failures* rather than *N accounts left behind*. Not silent — the kit's own message
is printed — but it is the wrong outcome word, and `sweptAt` is correctly withheld either way
(`packages/server/src/sweep.ts:114`). Fixing it is one `await provider.describe()` before the loop,
which is item 4.

**A fresh project's default identity names a tool no target has.** `ensureSettings` writes
`{ strategy: "self-signup", signupTool: "unset" }` (`packages/server/src/config-store.ts:126`).
Harmless while a target overrides it, and exactly the sort of placeholder that surfaces in an error
message one day.

**Preflight only knows how one strategy can be dead.** `control.ts:1457` blocks a run when the
target's own tool policy forbids its sign-up tool — good, and cheap. There is no equivalent for a
`provision-url` target with no secret stored (which refuses at the first provision,
`provision-url/index.ts:244-246`), or a `static` file that has been moved since it was configured
(which throws in the provider's *constructor*, `static/index.ts:85`, and so fails wherever the
provider is built). Both are knowable without touching anything.

**`emailDomain` defaults to `populace.test`.** Fine for a product that never sends mail, and an
invisible wall for one that verifies addresses before the account works. No copy anywhere says so.

---

## 7. The strongest argument against all of this

The recommended path asks a developer to merge code into the product before populace does anything at
all. The person evaluating populace is frequently not that developer, and "install our package in
your app" is the highest-friction first step a tool can ask for: it turns a twenty-minute look into a
ticket, a review and a week. `admin-mint` and `static` both let somebody run a population *today*
against an app they cannot change.

So the recommendation optimises the steady state at the cost of the trial, and a product nobody
finishes the trial of has no steady state. The honest mitigation is not to re-promote admin-mint —
its security posture is what it is — but to make the trial not need accounts at all, which is the
fifth way in, item 1, and the reason it is first on the list rather than last.

**What would change my mind:** evidence that the first target a new user points populace at usually
*does* have per-user accounts and they cannot get code into it. I do not have that; nobody has run
this on enough real products yet. If it turns out to be true, the answer is a read-only mode — send
the population in with the endpoint's own credentials, find the discoverability and usability
problems that do not need an account, and put the accounts question behind the first digest. That is
a bigger change than anything above, and item 1 is the first quarter of it.

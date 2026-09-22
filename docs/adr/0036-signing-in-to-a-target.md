# ADR-0036: Connecting is a sign-in, and your sign-in is not the population's

**Status:** accepted 2026-09-21

## Context

A user connected a real target — a Firebase-backed product behind a Streamable HTTP MCP server —
and got this back on the Connect screen:

```
Could not reach it. Nothing was saved; the address is still yours to fix.
default: Streamable HTTP error: Error POSTing to endpoint: {"error":"Missing bearer token"}
```

The address was fine. The server was up. Their question was the right one:

> *"as a user where do I get the bearer token? How do I come up with this? In my other MCP
> connector harnesses I can just connect the MCP server and everything just works. I can sign in
> with my account. Now I understand that the agents that use the server will have to come up with
> their own token — but at the top level it seems like I should be able to login to connect the
> target."*

There was no answer to give them. The three ways to get a token were: mint a Firebase ID token by
hand against the product's Web API key, dig one out of the dev app's browser session, or run the
OAuth flow manually with `curl` and paste the result. Every one of them expires in an hour.

What the endpoint was actually saying went unread. It answers a `401` with

```
www-authenticate: Bearer resource_metadata="https://…/.well-known/oauth-protected-resource/mcp"
```

and publishes an authorization server with dynamic client registration, PKCE and refresh tokens.
Claude.ai and MCP Inspector "just work" against it because they implement the MCP OAuth client.
populace implemented none of it: `McpSession.connect` set a static `authorization` header and that
was the whole auth story, while `ConnectTarget.tsx` posted `{ mcp: [{ name, url }] }` and offered
nowhere to put a credential at all. The screen's own docstring named *"the bearer is wrong"* as a
failure it exists to catch.

Two smaller things were wrong underneath and are worth recording, because they are why a bearer
field would not have been a fix:

- **`Save` is gated on a successful check**, so an address that needed a credential could not be
  saved from the UI, and the saved-target editor — which has had a bearer field all along — is
  only reachable for a target that is already saved. The one screen that could set a credential
  was behind the one screen that needed it.
- **An hour later it breaks.** A pasted token is not refreshed anywhere. The saved target would
  have started failing mid-week, and a target that 401s reads from every screen as a product that
  has gone down.

## Decision

**Connecting to an address that will not talk to strangers is a sign-in, done by populace on the
user's behalf, using the OAuth client the MCP SDK already ships. And the credential it produces is
the USER's, never the population's.**

### The two credentials are different things and the screen says so

This is the part that is a decision rather than an implementation.

- **Yours**, to connect and look: check the address, list the tools, see whether there is a
  sign-up. One human's account, consented to at a browser, refreshed while it is held.
- **Theirs**, one per person, to run: `identity` on the target — self-signup, a static pool, or
  admin-mint. The people a simulation sends are supposed to be *strangers with accounts of their
  own*. That is the entire premise of the product.

They are kept apart by construction, not by care. `McpSession` takes a sign-in provider as a third
constructor argument, and the only callers that pass one are the ones acting as the user —
`checkTarget` and the tool list behind it. `runWake` passes an identity's bearer and nothing else.
A grant that leaked into a wake would send forty people to the target wearing the owner's face, and
every finding they filed would be about an account the product's real users do not have. An
explicit token also wins over a provider inside `connect()`, so an identity's bearer can never be
refreshed out from under itself by a sign-in.

The copy carries the distinction wherever the two could be confused: the sign-in panel says it
signs in *you* and that the people need accounts of their own, and the signed-in line above the
tool count says the same thing from the other side.

### "Could not reach it" and "it will not talk to strangers" are different sentences

`TargetCheck` gains `signIn`, null unless the address answered and refused. A failed connection is
followed by one read-only probe — `POST`, read the `401`, follow `WWW-Authenticate` to the RFC 9728
document — which yields the resource's own name, its authorization server and the scopes it wants.
The screen then either offers a button or says plainly that the address is gated but publishes
nothing to sign in against, so populace cannot do it for the reader.

### Pressing Check registers nothing with anybody

The SDK's transport treats an `authProvider` as permission to do whatever getting in takes,
including dynamic client registration on the first `401`. Registration is a write on somebody
else's authorization server, and it must not be a side effect of pressing Check — the same rule
that keeps first contact behind a button (ADR-0034) and every run behind a POST (ADR-0023).

So a provider is handed to the check **only for an address already signed in to**, and `POST
/projects/:p/sign-in` is the one thing that registers. The probe is a `GET` of two documents and a
`POST` that gets refused; it writes nothing anywhere.

### A sign-in belongs to an address, not to a target

Keyed `(projectId, url)`. It has to be, because signing in happens *while connecting*, when there
is no saved target to hang it off. Two targets in one project on one address are one server and one
sign-in (ADR-0035); two projects are never one sign-in, because nothing is shared across projects.

### The callback is one fixed URL, and `state` carries everything else

`GET /api/v1/sign-in/callback` sits outside every project: it is registered with somebody else's
server as this installation's one callback, and a path that varied by project would mean a client
registration per project. OAuth's `state` is what says which project and which address a callback
belongs to — which is the job `state` is for — and it is looked up against flows actually in
flight, so a forged or stale callback is refused rather than guessed at.

The PKCE verifier is persisted on the grant row rather than held in a map in memory, because the
two halves of the flow are two HTTP requests with a login screen in between.

The redirect URI is derived from the origin the browser is using rather than baked in: `serve`
takes whatever port it is given. A registration made against a different origin is detected in
`clientInformation()` and redone, because the alternative is a `redirect_uri` mismatch at the
authorization server with nothing local to explain it.

### The row holds the secret and the wire does not

`SignInStatus` reports `connected`, `expiresAt`, `renewable`, the resource's name, its
authorization server and the scopes — and no token, ever. The same rule as every other credential
in the system. `renewable` is on the wire because "signed in, and it will stay signed in" and
"signed in for an hour" are different promises and the reader should not have to find out which
one they got by coming back tomorrow.

## Consequences

**No database was dropped.** `sign_in_grants` is a new table and `SCHEMA_SHAPE` is unchanged, which
is a rule and not a dodge: every statement in `SCHEMA` runs under `CREATE TABLE IF NOT EXISTS` on
every open, including the open that finds the recorded shape current, so a table nothing else
references appears in an existing database by itself. The shape guards tables that *change*, where
an old file's columns are wrong and the rebuild is the whole migration story (ADR-0011). Changing
this table later is a bump like any other. A project delete cascades to it.

The flow is covered end to end against a hand-written gated server — `401` with
`WWW-Authenticate`, RFC 9728 metadata, RFC 7591 registration, PKCE verified at the token endpoint —
rather than against an SDK server, which would have agreed with the client for the wrong reason.
The tests assert the things that are decisions: that Check registers nothing, that the token never
reaches the wire, that a callback with an unknown `state` is refused, and that a revoked consent
comes back as an offer to sign in again rather than as a transport error.

**What is knowingly left open:**

- **Signing in does not mean a population can run.** The copy says so; nothing enforces it. For a
  product that resolves its callers against its own database, a minted Firebase user is not yet a
  user of the product — `exchangeUrl` is where that shim belongs, and nothing here builds it.
- **A sign-in is never used by a run, deliberately, and that includes the parts of a run that act
  as the operator** — the verification replay and a run's tool list both connect with the run's own
  credentials. If a gated target is ever driven by a static identity pool, those paths will want
  thinking about again.
- **Nothing renews in the background.** A grant is refreshed when something connects with it, which
  is what the SDK's transport does on a `401`. A refresh token that expires while nobody is looking
  is discovered at the next check.
- **A gated address that publishes no authorization server still has no path through the UI.** The
  screen says so honestly instead of pretending, but the fix — a bearer field on Connect, which is
  what `McpEndpoint.bearerToken` has always been for — is not built here.

## Amendment — the way in had to be asked for, not assumed

The first target connected through the finished sign-in could not be saved:

```
Too small: expected string to have >=1 characters
  → at identity.signupTool
```

`ConnectTarget` sent `{ strategy: "self-signup", signupTool: "" }` for every target it created —
listed above as knowingly left open, and found by a reader thirty seconds later, because the
targets that need a sign-in are disproportionately the ones whose accounts are *not* made through
an MCP tool. `signupTool` is `min(1)`, so the body was invalid; the screen had no field to fix it
with; and the saved-target editor, which has had the full identity form all along, is only
reachable for a target that already exists. The one screen that could set a way in was behind the
one screen that needed it.

**The identity form now lives in `ways-in.tsx` and both screens use it.** What was duplicated was
never the fields — it was the mapping from form to config, which `ConnectTarget` had a second,
wrong copy of.

**`undecided` is a real state.** A tool list with no sign-up in it has no honest default: the
check has just said nobody can sign themselves up here, so opening the form on that branch would
be asking for a tool the reader was told does not exist. It matches no branch, `ConditionalFieldset`
already renders nothing for a value it does not know, and the three radios come up unselected —
which is ADR-0035's "refuse to guess, and name the choices" applied to the one screen that was
still guessing. `identityFrom` returns `null` for it, and the compiler found both construction
sites.

**What is missing is said here, in the reader's words, before anything is sent.**
`whatIdentityNeeds` blocks the save and names what it wants; `whatIdentityWillNotDo` warns without
blocking, for the admin-mint config that will save happily and then refuse at the mint because a
custom token is not an ID token. The distinction is the schema boundary: what the server will
refuse is a blocker, what the *run* will refuse is a warning.

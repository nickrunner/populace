# ADR-0040: Connecting a target creates it, and a secret is never shown before it is stored

**Status:** accepted 2026-09-23

## Context

The reader's words:

> *"The target page clears when I refresh. We should save the target as a partial state when we
> connect to it successfully. Because it makes it hard when I lose the secret on the page before
> I've fully set everything up."*

Everything on `ConnectTarget` lived in React state until Save: the address, the bearer token, the
name, the way in, and the provisioning secret. A refresh took all of it.

**The losses are not equal, and that is what made this urgent rather than annoying.** The address
and the name cost twenty seconds to retype. The secret does not. `tdk-setup.tsx` generates it in
the browser with `crypto.getRandomValues`, prints it in a block captioned *paste this into your
app's environment*, and tells the reader to do exactly that. From the moment they do, their
endpoint accepts precisely one credential — and the only copy populace had was a component state
variable. After a refresh the app holds a secret populace has never seen and cannot reproduce; the
endpoint then refuses populace forever, and nothing on screen can explain why. The reader is
locked out of their own endpoint by a product that showed them something and did not keep it.

So the rule, which is the whole record in one line:

> **Never show somebody a secret you have not stored.**

Everything below is what it takes to make that true on this screen.

## Decision

### 1. Connecting IS creating the target

The screen is called "Connect a target". A check that gets through means you have found it; what
is left — what to call it, how people get accounts — is *configuration of a thing that now
exists*. So a successful `POST /targets/check` is followed immediately by a save carrying the
address, the bearer token if one was typed, and a default name (the server's own reported name,
else the host). It is a POST already, so ADR-0023's "nothing that writes is a GET" is satisfied
without argument.

A check that did **not** get through still writes nothing. There is no evidence yet that there is
anything at the end of that address, and it is still the reader's to fix.

The row's id goes into the URL as `?t=…`, because the URL is the only part of a screen that
survives a refresh. A reload reads the row back: the address, the name, the way in, and the two
facts about credentials that are all a credential may ever say on the way down — `authenticated`
for the endpoint's bearer and `secretSet` for the provisioning secret. **A credential goes up and
never comes back down, and that rule does not bend here.** What the screen owes the reader instead
is to say plainly that the stored secret cannot be shown again, and that generating a new one
replaces it in both places or in neither.

### 2. `undecided` is a storable identity strategy

`{ strategy: "undecided" }` joins the five in `IdentityConfigSchema`, in both contract unions, and
in `IdentityStrategySchema`.

It already existed as a form state in `ways-in.tsx` — the shape of "nothing picked". This promotes
it so that a connected-but-unfinished target can be represented honestly. The alternative was to
write `none`, and `none` is a **real answer** meaning *this server has no users* (ADR-0038). A
half-built target recorded as `none` would send a population at somebody's product connecting as
nobody, every visit would report that product's own auth wall as a finding, and the project would
have read as ready to run the whole time.

The consequences are exactly the exhaustive switches, and the compiler found every one:

- **`identityProviderFor` refuses it**, with a sentence naming the unfinished half rather than the
  missing class. Mapping it to `NoAccountsProvider` to keep the switch total would have been the
  silent version of the bug above.
- **First contact refuses it before connecting.** The question it answers is "can a person get an
  account and use it", and on an unfinished target that cannot be reached by opening a session —
  only by finishing the target. It reports `provision-failed` with a summary naming the target,
  `handle: null`, `tornDown: false`, `leftBehind: null`, because nothing was tried.
- **Preflight blocks a run on it**, the start request is refused with a 409 naming the target, and
  `needsOf` carries the pair: an *advisory* need on the unfinished target, and a *blocking* need
  on any simulation that points at one. The split matters because a project holds several targets
  (ADR-0035) and a half-answered dev endpoint must not stop an execution against a finished qa
  one.
- **The targets list shows it as unfinished** — a `warn` chip and a sentence — rather than as an
  ordinary target somebody can send people to.
- **The saved-target editor's first-contact panel is at a bound** with its own reason, rather than
  telling the reader to save something they have already saved. `FirstContactPanel` grew
  `blocked?: string` for it.

### 3. The screen creates at most one target and updates it

The id is held after the first save, so a second Check with a corrected address updates that row.
A reader fixing a typo must not end up with two targets.

This has a consequence on the check itself. A bearer token goes up and never comes back down, so
after a reload the form no longer holds the one it sent — and a re-check would ask a gated address
anonymously and report it dead, which is the opposite of what changed. `POST /targets/check` takes
an optional `target` id and merges the body's endpoints against that row's stored ones, exactly as
`POST /provisioning/check` already reads a stored secret off a named target.

### 4. The secret is written the moment it is generated

Not at Save. Generating it is now an edit to a row that exists.

**This reordered the TDK panel, and the reorder is the honest consequence of the rule rather than
a compromise with it.** The secret is stored as part of a `provision-url` identity, and that
identity has nowhere to live without a URL — `ProvisionUrlConfigSchema.url` is required, and
relaxing it to make a half-built config storable would have pushed the same emptiness down into
`ProvisionUrlProvider`. So the panel now holds the generation back until the provisioning address
parses as a full `http(s)` URL — a gate on emptiness alone fired on the first keystroke, wrote a
secret against `h`, and got a 400 with the secret already printed, which is this same failure
reached by a different road — and says so where the secret would have been. The reader sees the
code, gives the address, and gets a secret that is already saved. `TdkSetup` takes `onGenerated`
for this; a caller that supplies it is promising to write the value before the reader can act on
it, and the saved-target editor, which has a Save button in front of the reader and a row that
already has one, does not.

If that write fails, the screen says the loudest thing on it: *populace made that secret and could
NOT store it — do not paste it into your app.* A failed save of a name is a save that did not
happen; a failed save of a shown secret is a trap.

### 5. Save becomes "finish", not "create"

Its blocked reasons are unchanged — a name, and an answer to how people get accounts. What changed
is what it means: the target exists from the check onwards, and this is the press that completes
it. Until it happens the row honestly says `undecided`, and everything downstream says so too.

## Consequences

**No store change.** Identity lives inside the `targets` row's JSON, so `SCHEMA_SHAPE` is
untouched and no database was dropped — the same finding ADR-0037 and ADR-0038 made for
`provision-url` and `none`.

**A target now exists before anybody has decided anything about it**, which is a new state for
every screen that lists or resolves one. Five places were taught to say so, and they are listed in
§2. A sixth is `populace.yaml`: `IdentityConfigSchema` accepts `strategy: undecided`, so a
config-first user *can* write one, and `openContext` will refuse the command with the same
sentence `identityProviderFor` throws. That is the right refusal but it arrives at a worse moment
than a dashboard's does, and the starter template does not mention the word.

**The guess no longer overwrites an answer.** `ask.onSuccess` used to replace the identity draft
from every check, which was harmless while the draft was thrown away on every reload. It is not
harmless now: a second check would have reset a chosen way in — and the provisioning address
beside a secret already stored — back to nothing. The guess fills an unanswered question only.

**What is knowingly left open:**

- **The saved-target editor still shows a generated secret before it is stored.** It has a Save
  button in front of the reader and the row already exists, so the window is small and visible —
  but it is the same rule, and the same refresh loses the same thing. Giving that screen the
  immediate write means deciding what a partial save does to the rest of a form somebody is
  mid-edit in, which is a bigger question than this record.
- **The bearer merge on a re-check is not covered behaviourally.** The mock target lists its tools
  to anybody, so there is no gated address in this suite to prove that the stored token was used.
  What is asserted is the shape around it: the route accepts `target`, and the row still reports
  `authenticated` after a save that could not send one.
- **The connect screen's own wiring is not covered by a test that renders it.** The web package
  has no DOM test setup, so the sequence — check, save, correct, save again, generate, store,
  finish — is asserted at the server end of each step and in the pure functions the screen calls.
- **The address stored alongside a just-generated secret may be a prefix.** `https://d` parses, so
  the generator can fire on it and the row then holds a half-typed URL until Finish. It is the
  cheap half — an address costs twenty seconds to retype, and the secret is what was in danger —
  but a reader who reloads mid-typing finds the field holding less than they had typed.
- **A target left `undecided` is never cleaned up.** A reader who connects three addresses and
  finishes none has three unfinished rows and only the list's chip to tell them. Nothing expires
  them, and nothing should without being asked.

**The argument against, recorded so it is not re-discovered.** Writing on a check means a reader
who was only *trying an address* now owns a row they did not ask for, and the targets list fills up
with experiments. That is a real cost and it is the reason the write is gated on a check that
actually got through: an address that answered MCP is not an experiment, it is a found endpoint.
What would change the decision is evidence that people check many more addresses than they keep —
in which case the answer is a way to remove an unfinished target from the list, not a way to stop
storing the secret.

# ADR-0034: First contact — one account, one read-only call, before a run

**Status:** accepted 2026-09-18

## Context

Nothing in the product could answer "is my identity configuration actually right?".

The connection panel lists tools, which proves the endpoint answers and nothing about whether a
person can get in. The identity form is guesses with reasons attached. The first thing that
actually provisions an account is a **run**, which costs money, involves a population, and reports
a misconfiguration as a confusing wall of failed wakes.

The case that forced it: a Firebase-authenticated MCP server. Does it accept a Firebase **ID
token** as a bearer, or only tokens its own `/token` endpoint issued? That is one HTTP call to find
out and there was no way to make it.

## Decision

A **first contact** check: with a target saved, provision ONE identity through the configured
strategy, make ONE read-only call with it, take the account back down, and report precisely what
happened.

It is a **POST** (`/projects/:p/targets/:t/first-contact`). Not because it spends money — it calls
no model and costs nothing in Anthropic spend, and the screen says so — but because it creates an
account on somebody's product. ADR-0023's rule is that nothing with effects is a side effect of a
GET, and this has the most effects of anything on that screen.

It **never writes**. The tool it tries is one the target itself annotated `readOnlyHint`, is
permitted by the target's tool policy (ADR-0033), and takes no required arguments — a read-only
tool called without its required id answers with a validation error, which would read as a broken
identity when it is nothing of the kind. When nothing qualifies it reports `connected-only`: the
connection is verified, a call is not, and nothing that might write was reached for.

It **distinguishes the failure modes**, which is the entire value:

| outcome | what it means |
| --- | --- |
| `unreachable` | the endpoint never answered; nothing was created |
| `provision-failed` | the endpoint answered and the strategy could not make an account; the provider's own error is carried |
| `rejected` | the account was made and the target refused its credential (401/403) |
| `accepted` | the account was made and a read-only tool answered it |
| `tool-failed` | the credential got through — the target ran the handler — and that one tool errored |
| `connected-only` | no read-only tool could be called, and the summary says which of the three reasons it was: nothing is annotated `readOnlyHint`, the target's own tool policy blocks all of them, or every one needs arguments |

For `admin-mint`, `rejected` says out loud that this is the "your backend may not accept this
issuer's tokens" case and names the two ways out (`identity.exchangeUrl`, or verifying the issuer).
A user cannot be expected to infer that from a 401.

It **cleans up after itself**, and when it cannot it says so. The account is torn down through the
provider that made it; when the provider declares `ownsAccounts: false` (a static pool it never
owned) or `cannotRemove` (self-signup with no teardown tool), or teardown throws, the result
carries `leftBehind` with the account **named**. Never silently leaving an account on somebody's
product is the same rule sweep follows (706aa7d).

That includes a failure **during** provisioning. Self-signup calls the target's sign-up tool and
only then reads a credential out of the result, so a wrong `tokenPath` — one of the two fields most
likely to be wrong, and therefore one of the things this check exists to catch — fails with the
account already made. `provision-failed` carries the account it created, and "nothing was left
behind" is said only when that is known rather than as a default.

The check obeys the **target's tool policy** (ADR-0033) for the tools it calls on a person's
behalf: the read-only tool it tries, and the sign-up tool. A policy that blocks the sign-up tool
makes an account unobtainable for every person in the population — `runWake` filters on the same
merged policy — so the check reports that rather than signing up anyway and answering "they can get
in" for a configuration in which nobody can. Preflight says the same thing without touching
anything. **Teardown is exempt**, deliberately: it is populace's own housekeeping, never offered to
a model, and refusing to call it to honour a rule about what agents may do would leave an account
on somebody's product — strictly worse.

No credential material reaches the result, the log or the stored row. The account **handle** is the
only thing carried out, and every string that came from somebody else's code — the provider's
error, the target's error, the reason an account could not be removed — is passed through a
redactor on the one path out of the function, because those are exactly the strings nobody wrote by
hand. The redactor is seeded from the **configuration** and before the first connection, not only
from the credential and not only once one exists: a gateway that answers 401 with the
`Authorization` header it received puts the endpoint's own token into an `unreachable` detail
before any account exists, and that detail is stored on the target row and rendered in the editor,
where the same token is otherwise reduced to `authenticated: boolean`. So endpoint bearer tokens,
endpoint header values, the Firebase Web API key and the password offered to a sign-up tool are all
known to it from the start.

## Consequences

The result is stored on the target row, so preflight can report it — and is dropped when the
address or the identity settings it ran against change, because it is evidence about those and
nothing else. Keeping it would mislead in both directions: a passed check suppressing "nobody has
tried getting an account here yet" for settings nobody has tried, and a failed one going on
blocking preflight after the user fixed exactly what it complained about. Preflight is a GET and must
never provision anything, which is why it reads the last check rather than running one. A check
that **failed** is a preflight blocker — it is the only thing on that page that has actually been
tried — and never having run one is a warning, because a check that makes an account cannot be a
precondition of a page that must not.

The probe identity is never persisted. Its tag is `populace:first-contact` rather than
`tagForRun(...)` of an invented run id, so a sweep cannot mistake it for an execution's account.

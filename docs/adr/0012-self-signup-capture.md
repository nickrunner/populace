# ADR-0012: Self-signup credentials are captured by intercepting the signup tool

**Status:** accepted

## Decision

The `self-signup` provider is configured with the name of the target signup tool and JSON paths to the token and user id in its result:

```yaml
identity:
  strategy: self-signup
  signupTool: sign_up
  tokenPath: token
  userIdPath: user.id
  teardownTool: delete_account   # optional
  emailDomain: populace.test
```

The provider `provision()` returns no credential; the wake context tells the agent it has no account. When the interceptor sees a successful call to the signup tool it extracts the credential, records an `identity` trace event, persists the identity with the run tag and reconnects the MCP session with the bearer token. The agent chooses its own display name; the runner supplies a deterministic email containing the run tag so the identity is discoverable later.

`teardown` calls `teardownTool` with the identity bearer. `listByTag` reads the store, which is the system of record for identities this population created.


## Amendment (2026-09-18): the `static` pool is keyed by cohort and assigned by ordinal

The sibling strategy, `static`, handed entries out with a per-instance counter and
`list[index % list.length]`. Both halves were wrong.

The modulo meant a pool smaller than the population WRAPPED. Ten people against three entries
gave people 4-10 accounts 1-3, so several simulated people were literally the same account on the
target: they saw each other's data, their "independent" reports were nothing of the kind, and a
per-user-state defect was indistinguishable from two people sharing a login. There was no
warning. Exhaustion is an error now.

The counter was process state, so it survived exactly as long as the process. An identity is
provisioned once per agent and read from the store thereafter, so the counter only mattered for
agents that had not provisioned yet — which is precisely what a restart hits, and pause/resume
makes restarts a routine part of a longitudinal simulation rather than an accident. Assignment is
derived from the agent instead: person n of a cohort gets entry n, which is stable across
processes and gives the same person the same account in every execution.

Indexing by ordinal is only unambiguous when the list belongs to ONE cohort, because two cohorts
sharing a persona both have a person 1. So the preferred file shape is keyed by cohort —
`{ "byCohort": { "<cohortSlug>": [ … ] } }` — and the shipped shapes (a persona-keyed record, a
flat array) keep working. A legacy pool that would serve more than one cohort cannot be resolved
and is REFUSED rather than mis-assigned.

The provider sees one agent at a time and cannot see any of this, so "every person gets a distinct
account" is asserted through a new `IdentityProvider.checkPopulation()` where the population is
visible: `LocalDaemon.reconcile()` and `RunController.start()`, before a config snapshot, before an
ephemeral start resets the target, and before a model call is paid for. Starting a run that will
collide is worse than refusing to start.

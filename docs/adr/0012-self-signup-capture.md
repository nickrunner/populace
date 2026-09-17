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


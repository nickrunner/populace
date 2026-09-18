# @populace/contract

The HTTP wire format, as zod schemas, shared by `@populace/server` and `@populace/web`.

No I/O and no Node built-ins: this package is imported by the browser bundle, so it depends on
`@populace/core/isomorphic` only (ADR-0021, ADR-0023). Both sides parse against these schemas;
the server on the way out, the client on the way in.

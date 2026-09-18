# ADR-0023: REST API under a zod contract, loopback by default

**Status:** accepted

## Decision

The API is REST-shaped JSON under `/api/v1`. Every request body, query and response is a zod schema in `@populace/contract`, parsed on both sides (ADR-0002 at a new boundary).

Not tRPC: it couples the client build to the server build and leaves M4's non-interactive CI mode without a plain HTTP surface. Not GraphQL: the query shapes are few and known.

The server binds `127.0.0.1` and refuses any other host without both an explicit `--host` flag and a token. There is no cookie authentication before M5, so there is no CSRF surface.

## Consequences

The process holds an Anthropic API key and can spend money on request, so the default binding is a safety property, not ceremony.

Trace and finding endpoints are cursor-paginated on the same monotonic cursor the SSE stream uses, so "load the rest of the trace" and "follow it live" are one query at different offsets.

`contract` is also what an M4 CI client or an M5 SDK consumes, which is why it holds the route table rather than the server.

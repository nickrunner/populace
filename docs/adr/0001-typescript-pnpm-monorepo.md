# ADR-0001: TypeScript, pnpm workspaces, Node 22, ESM, strict TS

**Status:** accepted (fixed by brief)

## Decision

- TypeScript 5.x, `strict` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- pnpm workspaces monorepo. Packages build with `tsc -b` project references; tests run with Vitest against source via aliases.
- Node 22, ESM only (`"type": "module"`, `NodeNext` resolution).
- `any` and `unknown` are prohibited by lint (`no-explicit-any`, and a `no-restricted-syntax` rule on `TSUnknownKeyword`). The only exemptions are narrowly justified adapter boundaries, each marked with an `eslint-disable` comment that names the reason: JSON coming off the wire (MCP tool results, SQLite rows, provider SDK objects) is parsed with zod immediately at that boundary.

## Consequences

Data crossing a boundary must have a zod schema (ADR-0002). This is more typing up front and far less debugging later; every persisted or transported shape is documented by its schema.


# ADR-0021: Web app packages and stack

**Status:** accepted

## Decision

Two packages join the workspace. `@populace/server` is the HTTP API, built on **Hono** with `@hono/node-server`. `@populace/web` is the dashboard, a **React 19 + Vite + TypeScript** SPA using React Router, TanStack Query and Tailwind v4, built into `server`'s static assets. A third, `@populace/contract`, holds the wire schemas both sides import and depends on `core` alone.

Hono over Express or Fastify because its handlers run unchanged on Node, in a container and on an edge runtime, which is the seam M5 needs, and because routing, SSE and static hosting are otherwise ours to write. `contract` is a separate package so the browser bundle never depends on a package that imports `node:sqlite`.

Dependency direction stays downward: `cli -> server -> reports/runner/adapters/store-sqlite -> core`, with `web -> contract -> core`.

## Consequences

`@populace/core` has to be importable in a browser. Its two `node:crypto` imports become `globalThis.crypto.getRandomValues` and an explicitly bounded import, and a lint rule forbids new `node:` imports in `core`.

`pnpm build` gains a Vite step alongside `tsc -b`. `pnpm check` stays the single CI gate.

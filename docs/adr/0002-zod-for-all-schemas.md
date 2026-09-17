# ADR-0002: Zod for every config and persisted schema

**Status:** accepted (fixed by brief)

## Decision

Every configuration object, every row persisted by a Store, every trace event, finding, memory document and identity is defined as a zod schema in `@populace/core`. TypeScript types are inferred from the schemas (`z.infer`), never hand-written alongside them.

Stores parse JSON blobs with the schema on read, so a corrupted or out-of-date row fails loudly at the boundary.

## Consequences

Schemas are the single source of truth for docs, validation (`populace validate`) and types. Reporter tool input schemas are also zod and are converted to JSON Schema for the model.


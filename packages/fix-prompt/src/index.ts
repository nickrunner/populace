/**
 * The entry point is `src/index.ts` and has to stay there: the root `vitest.config.ts` maps
 * `@populace/NAME` to `packages/NAME/src/index.ts` by position, so a differently named entry
 * resolves to nothing under test while still building fine.
 */
export * from "./fix-prompt.js";
export * from "./words.js";

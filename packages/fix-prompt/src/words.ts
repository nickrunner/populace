/**
 * The two counting helpers the prompt writes its reach sentences with.
 *
 * They lived in `packages/web/src/format.ts` and came here with the prompt, because the prompt is
 * the reason they have to be exact: "1 people who went hit it" inside a GitHub issue is read by
 * somebody who has never seen populace and has only that paragraph to judge it by. `format.ts`
 * re-exports these rather than keeping a second copy, so the dashboard and the issue body cannot
 * drift into two spellings of the same count.
 */

/**
 * Counts of people, in a sentence. "1 people" is the kind of thing that makes a product feel
 * unfinished, and this count appears on nearly every screen.
 */
export const people = (n: number): string => `${n} ${n === 1 ? "person" : "people"}`;

/** The same, for the other nouns that get counted beside it. */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

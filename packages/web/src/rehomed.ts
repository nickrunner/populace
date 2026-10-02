/**
 * Where an address the product used to answer on lives now.
 *
 * Both of these are pure string functions, and they live here rather than beside the redirect
 * components in `App.tsx` so that a test can read them without importing `App.tsx` — which pulls
 * in every screen in the product, under a node test environment with no DOM. A bookmark is a
 * promise (ADR-0042), and a promise nothing tests is a promise nobody is keeping.
 */

/**
 * `/p/:proj/s/:sim/anything` → `../studies/:sim/anything`. The tail is re-encoded segment by
 * segment rather than passed through, so a slug that needed encoding on the way in needs it on
 * the way out too, and an empty tail leaves no trailing slash behind.
 */
export function rehomedStudyPath(sim: string, rest: string): string {
  const tail = rest.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `../studies/${encodeURIComponent(sim)}${tail ? `/${tail}` : ""}`;
}

/**
 * The trailing segments a bookmarked `/runs/:id/…` used, and where each lives now. `null` keeps
 * the segment as it was; an empty list drops the whole tail.
 *
 *  - `gaps` and `wakes` were renamed on the way to the user's words (coverage, visits).
 *  - `agents` was the cast of that execution, which is `executions/:runId/cohorts` now — the one
 *    entry that needs the run id, which is why this is a function and not a map.
 *  - `findings` maps to nothing: a cluster used to be identified by its place in one execution's
 *    digest and is identified by its signature now, so an old link to one can only land on the
 *    results screen that lists them all (ADR-0028).
 */
export function rehomed(segment: string, runId: string): readonly string[] | null {
  switch (segment) {
    case "gaps":
      return ["coverage"];
    case "wakes":
      return ["visits"];
    case "agents":
      return ["executions", runId, "cohorts"];
    case "findings":
      return [];
    default:
      return null;
  }
}

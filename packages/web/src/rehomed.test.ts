import { describe, expect, it } from "vitest";

import { rehomed, rehomedStudyPath } from "./rehomed.js";

/**
 * The redirects that keep old addresses working.
 *
 * These are the least visible thing in the app and the easiest to break, because nothing on any
 * screen links to them any more: the only reader who arrives is one with a bookmark or a link
 * somebody pasted into a ticket months ago, and a bookmark is a promise (ADR-0042). So the
 * mapping is tested directly rather than through the router — the components that use it do
 * nothing but read params and hand them here.
 */
describe("rehomedStudyPath", () => {
  it("sends a bare old study address to its studies/ twin, with no trailing slash", () => {
    expect(rehomedStudyPath("checkout-run", "")).toBe("../studies/checkout-run");
  });

  it("carries a tail of several segments across", () => {
    expect(rehomedStudyPath("checkout-run", "executions/r7/cohorts")).toBe(
      "../studies/checkout-run/executions/r7/cohorts",
    );
  });

  it("re-encodes the study and every segment of the tail", () => {
    // A signature is a path segment that can hold anything, so it is the tail that most needs
    // this: `search tasks` unencoded would split into two segments and match nothing.
    expect(rehomedStudyPath("first pass", "f/search tasks/people")).toBe(
      "../studies/first%20pass/f/search%20tasks/people",
    );
  });

  it("drops the empty segments a doubled or trailing slash leaves", () => {
    expect(rehomedStudyPath("checkout-run", "/coverage//")).toBe("../studies/checkout-run/coverage");
  });
});

describe("rehomed", () => {
  it("renames the segments that moved to the user's words", () => {
    expect(rehomed("gaps", "run_1")).toEqual(["coverage"]);
    expect(rehomed("wakes", "run_1")).toEqual(["visits"]);
  });

  it("sends the old cast address to the execution that had that cast", () => {
    // The one entry that needs the execution's id, which is why this is a function at all.
    expect(rehomed("agents", "run_1")).toEqual(["executions", "run_1", "cohorts"]);
  });

  it("drops a tail that maps to nothing, rather than keeping it", () => {
    // A cluster is identified by its signature now, so an old link to one by position can only
    // land on the screen that lists them all (ADR-0028). Empty list, not null.
    expect(rehomed("findings", "run_1")).toEqual([]);
  });

  it("keeps a segment it does not know about", () => {
    for (const segment of ["", "coverage", "visits", "left", "live", "people", "executions"]) {
      expect(rehomed(segment, "run_1")).toBeNull();
    }
  });
});

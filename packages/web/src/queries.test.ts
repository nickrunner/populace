import { describe, expect, it } from "vitest";

import { familyOf as family, keys, staleAfter, type StaleEvent } from "./queries.js";

/**
 * What the project's event stream makes stale (ADR-0026).
 *
 * This package has no component-rendering tests and is not getting any, so what is asserted here
 * is the one piece of the data layer a screen cannot see go wrong: an execution changes status,
 * the stream says so, and the study's summary, results and executions list are asked for again.
 * The prefixes are read off the `keys` factories rather than spelled here, so this test is about
 * `staleAfter` deriving them correctly and not about what the queries happen to be called.
 */

function event(over: Partial<StaleEvent>): StaleEvent {
  return { type: "run.status", runId: "run_1", projectId: "prj_1", studyId: "sim_1", wakeId: null, ...over };
}

describe("staleAfter", () => {
  it("a run.status event carrying a studyId returns the study's keys", () => {
    const out = staleAfter(event({ type: "run.status" }));

    expect(out).toContainEqual(family(keys.study("p", "s")));
    expect(out).toContainEqual(family(keys.results("p", "s")));
    expect(out).toContainEqual(family(keys.studyRuns("p", "s")));
    expect(out).toContainEqual(family(keys.studyPeople("p", "s")));
    expect(out).toContainEqual(family(keys.cluster("p", "s", "sig")));
    expect(out).toContainEqual(family(keys.compare("p", "s", "a", "b")));
    // The project is the study's project, so what it lists moved too.
    expect(out).toContainEqual(family(keys.studies("p")));
    expect(out).toContainEqual(family(keys.project("p")));
    // The run's own keys are exact, because a run id is a run id everywhere.
    expect(out).toContainEqual(keys.run("run_1"));
    expect(out).toContainEqual(keys.live("run_1"));
    expect(out).toContainEqual(keys.runEvents("run_1"));
  });

  it("an event with no studyId touches nothing study-scoped", () => {
    const out = staleAfter(event({ studyId: null }));
    expect(out).not.toContainEqual(family(keys.study("p", "s")));
    expect(out).not.toContainEqual(family(keys.results("p", "s")));
    expect(out).toContainEqual(family(keys.project("p")));
  });

  it("the pre-flight and the estimate are never invalidated from the stream", () => {
    // The pre-flight opens a connection to the target to list its tools; nothing in a project's
    // event stream may do that at visit rate.
    for (const type of ["run.status", "run.config", "wake.ended", "finding.filed", "run.ended"]) {
      const out = staleAfter(event({ type }));
      expect(out).not.toContainEqual(family(keys.preflight("p", "s")));
      expect(out).not.toContainEqual(family(keys.estimate("p", "s")));
    }
  });

  it("a trace row makes nothing stale", () => {
    expect(staleAfter(event({ type: "trace.appended", wakeId: "wake_1" }))).toEqual([]);
  });

  it("a filed finding covers every filter of the run's findings", () => {
    const out = staleAfter(event({ type: "finding.filed" }));
    // The prefix stops at the run id, so `["findings", run_1, "?kind=bug"]` is under it.
    expect(out).toContainEqual([keys.findings("run_1")[0], "run_1"]);
    expect(out).toContainEqual(keys.digest("run_1"));
  });

  it("every prefix is a genuine prefix of a key the factories make", () => {
    // If a family were spelled as a literal and the factory renamed, this is what would catch it.
    const made = [
      keys.project("p"),
      keys.studies("p"),
      keys.runs("p"),
      keys.setup("p"),
      keys.study("p", "s"),
      keys.results("p", "s"),
      keys.studyRuns("p", "s"),
      keys.studyPeople("p", "s"),
      keys.cluster("p", "s", "sig"),
      keys.compare("p", "s", "a", "b"),
      keys.run("run_1"),
      keys.live("run_1"),
      keys.runEvents("run_1"),
      keys.job("job_1"),
    ];
    for (const prefix of staleAfter(event({ type: "job.updated" }))) {
      expect(made.some((key) => prefix.every((segment, i) => key[i] === segment))).toBe(true);
    }
  });
});

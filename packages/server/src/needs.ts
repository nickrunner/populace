import type { Store } from "@populace/core";

import { cohortsOf } from "./config-store.js";

/**
 * What is left to do in a project, as sentences that know what they are about.
 *
 * **Why this exists.** The blockers list was a `string[]` built inline in the `/setup` handler,
 * and the browser had three different ways of showing it: the first-run panel printed all of them
 * under step 3, `Preflight` printed them again above its own go button, and the project dashboard
 * printed a fourth voice of its own devising. A reader on a half-built project met the same
 * leftover three times, in three shapes, none of which said *which thing* it was about — so "add
 * at least one person to the population" appeared on a project with four populations and named
 * none of them.
 *
 * A `Need` carries its **scope**, so the screen can put the sentence on the row it is about
 * instead of in a pile at the top. That is the whole design: a task lives on the thing it is a
 * task about, and the only ones that belong in a list of their own are the ones about the project
 * as a whole.
 *
 * **There is no `act` here, and there must not be.** An earlier draft gave each need a
 * `{label, path}` so the server could say where to go. A browser path in a server payload is a
 * routing table maintained in two repositories at once — and this product had just moved
 * `library/target` to `library/targets`, which would have silently broken every act the server
 * emitted. The web derives the link from `scope.kind` and `scope.id`; the server says what is
 * wrong and what it is wrong about, and nothing else.
 */
export type NeedScope =
  | { kind: "project"; id: string }
  | { kind: "target"; id: string }
  | { kind: "population"; id: string }
  | { kind: "simulation"; id: string };

export interface Need {
  /** Stable across requests, so a screen can key a list on it without reordering flicker. */
  id: string;
  /** One sentence, in the user's own words, that says what is missing and why it matters. */
  sentence: string;
  /** What the sentence is about. `project` is the pile at the top; the rest hang off a row. */
  scope: NeedScope;
  /**
   * Whether this actually STOPS an execution, as opposed to merely being left to do.
   *
   * The distinction is the whole reason this field exists. `ready` and `blockers` on the setup
   * payload gate the go button, and a need like "nobody has checked that Tasklet answers" is
   * worth saying and must not stop anybody: the check costs nothing and finds real problems, but
   * a project is perfectly able to run without it. Folding the two together made `ready` false on
   * a project that was ready, which is a product that cries wolf.
   *
   * Blocking needs are the five that have always been blockers. Everything scoped to a single
   * target, population or simulation is advisory.
   */
  blocking: boolean;
}

export interface NeedsInput {
  projectId: string;
  projectName: string;
  hasApiKey: boolean;
  killSwitch: { engaged: boolean; reason: string | null };
}

/**
 * Every leftover in one project, in the order a reader should meet them.
 *
 * The order is the order a project fills up in — somewhere to go, somebody to send, something to
 * send them on — followed by the two that stop a run whatever else is true (no key, and the kill
 * switch). It is not a checklist and it is never rendered as numbered steps: on a project that has
 * run forty times the only interesting members of this list are the last two, and a permanent
 * "step 1 of 4" above them would be a fourth voice all over again.
 *
 * Every sentence here is the product speaking about the reader's own project, so they name the
 * thing (§7.4) and none of them promises what an execution will find (§7.3).
 */
export async function needsOf(store: Store, input: NeedsInput): Promise<Need[]> {
  const { projectId, projectName } = input;
  const needs: Need[] = [];

  const targets = await store.listTargets(projectId);
  const populations = await store.listPopulations(projectId);
  const simulations = (await store.listSimulations({ projectId })).filter((s) => !s.archived);
  const cohorts = await cohortsOf(store, projectId);
  const peopleCount = cohorts.reduce((sum, cohort) => sum + cohort.size, 0);

  // ---- the project as a whole ---------------------------------------------

  if (targets.length === 0) {
    needs.push({
      id: "no-target",
      blocking: true,
      sentence: "Connect a target so the people have somewhere to go.",
      scope: { kind: "project", id: projectId },
    });
  }

  if (peopleCount === 0) {
    needs.push({
      id: "no-people",
      blocking: true,
      sentence: "Pick who visits it. A persona is a kind of person; a cohort is people cut from one.",
      scope: { kind: "project", id: projectId },
    });
  }

  if (targets.length > 0 && peopleCount > 0 && simulations.length === 0) {
    needs.push({
      id: "no-simulation",
      blocking: true,
      sentence: "Make a simulation: it pairs a target with a population, and it is the thing you send.",
      scope: { kind: "project", id: projectId },
    });
  }

  if (!input.hasApiKey) {
    needs.push({
      id: "no-api-key",
      blocking: true,
      // The one need that is about the machine rather than the project, and it is worth saying
      // why: every person is a model call, so without a key nothing can go anywhere.
      sentence: "Set ANTHROPIC_API_KEY before starting an execution; the people are model calls.",
      scope: { kind: "project", id: projectId },
    });
  }

  if (input.killSwitch.engaged) {
    const why = input.killSwitch.reason === null ? "" : ` (${input.killSwitch.reason})`;
    needs.push({
      id: "kill-switch",
      blocking: true,
      sentence: `Everything in ${projectName} is stopped${why}. Release it to start an execution.`,
      scope: { kind: "project", id: projectId },
    });
  }

  // ---- one thing at a time -------------------------------------------------
  //
  // These are the ones the scope earns its place for. Each hangs off the row it names, so a
  // project with three targets says which of the three has never been checked instead of saying
  // "a target has never been checked" and leaving the reader to find it.

  for (const target of targets) {
    if (target.firstContact === null) {
      needs.push({
        blocking: false,
        id: `target-unchecked:${target.id}`,
        sentence: `Nobody has checked that ${target.name} answers. It costs nothing to find out.`,
        scope: { kind: "target", id: target.id },
      });
    }
  }

  for (const population of populations) {
    if (population.cohortIds.length === 0) {
      needs.push({
        blocking: false,
        id: `population-empty:${population.id}`,
        sentence: `${population.name} has no cohorts in it, so a simulation on it would send nobody.`,
        scope: { kind: "population", id: population.id },
      });
    }
  }

  for (const simulation of simulations) {
    if (!targets.some((target) => target.id === simulation.targetId)) {
      needs.push({
        blocking: false,
        id: `simulation-target-gone:${simulation.id}`,
        sentence: `${simulation.name} points at a target that is no longer here.`,
        scope: { kind: "simulation", id: simulation.id },
      });
    }
  }

  return needs;
}

import { dealStudy, type Store } from "@populace/core";

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
 * emitted. The web derives the link from `id` for the project-scoped ones and from `scope.kind`
 * and `scope.id` for the rest; the server says what is wrong and what it is wrong about, and
 * nothing else.
 *
 * **This reads and never writes** (ADR-0041, D3). It used to size the project's default population
 * on the way through, creating one when there was none; a setup GET now creates nothing, and a
 * project with no population is told so instead.
 */
export type NeedScope =
  | { kind: "project"; id: string }
  | { kind: "target"; id: string }
  | { kind: "population"; id: string }
  | { kind: "study"; id: string };

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
   * Blocking needs are the five project-scoped ones that have always been blockers, plus a study
   * aimed at a target nobody has finished setting up. Everything else scoped to a single target,
   * population or study is advisory.
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

  const [targets, populations, studies, cohorts] = await Promise.all([
    store.listTargets(projectId),
    store.listPopulations(projectId),
    store.listSimulations({ projectId }).then((all) => all.filter((s) => !s.archived)),
    store.listCohorts(projectId),
  ]);
  const cohortById = new Map(cohorts.map((cohort) => [cohort.id, cohort]));
  const populationById = new Map(populations.map((population) => [population.id, population]));

  // ---- the project as a whole ---------------------------------------------

  if (targets.length === 0) {
    needs.push({
      id: "no-target",
      blocking: true,
      sentence: "Connect a target so the people have somewhere to go.",
      scope: { kind: "project", id: projectId },
    });
  }

  if (populations.length === 0) {
    needs.push({
      id: "no-population",
      blocking: true,
      sentence: "Compose a population: personas are kinds of people, cohorts are people who share something, a population is which cohorts go, and a study says how many.",
      scope: { kind: "project", id: projectId },
    });
  }

  if (targets.length > 0 && populations.length > 0 && studies.length === 0) {
    needs.push({
      id: "no-study",
      blocking: true,
      sentence: "Make a study: it sends a population, at a size you give it, to a target — and it is the thing you press go on.",
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
    /*
      Connected and not finished (ADR-0040). Connecting writes the target on the first successful
      check, so this is a state a reader reaches by doing exactly what the screen told them to and
      then stopping — which is why it is a sentence about one row rather than an error.

      It is ADVISORY here and blocking below, and the split is the point. A project may hold
      several targets (ADR-0035), and a half-answered dev endpoint must not stop an execution
      against the qa one that is finished. What stops a run is a STUDY pointing at an unfinished
      target, and that is a different sentence naming both.
    */
    if (target.identity.strategy === "undecided") {
      needs.push({
        blocking: false,
        id: `target-unfinished:${target.id}`,
        sentence: `${target.name} is connected, but nobody has said how people get accounts on it yet.`,
        scope: { kind: "target", id: target.id },
      });
    }
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
    if (population.members.length === 0) {
      needs.push({
        blocking: false,
        id: `population-empty:${population.id}`,
        sentence: `${population.name} has no cohorts in it, so a study on it would send nobody.`,
        scope: { kind: "population", id: population.id },
      });
    }
  }

  for (const study of studies) {
    if (!targets.some((target) => target.id === study.targetId)) {
      needs.push({
        blocking: false,
        id: `study-target-gone:${study.id}`,
        sentence: `${study.name} points at a target that is no longer here.`,
        scope: { kind: "study", id: study.id },
      });
    }
    /*
      The deal comes to nought: a size of nought, or a population whose cohorts are gone or have
      nothing in their mix. Advisory rather than blocking because it stops only THIS study, and a
      start on it is refused with the same sentence (`SENDS_NOBODY`). Dealt here from the rows
      already read, with no persona lookup, so a missing persona is the resolve's problem to name
      and not a reason for this list to throw.
    */
    if (sendsOf(study.size, populationById.get(study.populationId), cohortById) === 0) {
      needs.push({
        blocking: false,
        id: `study-empty:${study.id}`,
        sentence: `${study.name} sends nobody yet: give it a size, or give its population cohorts with personas in them.`,
        scope: { kind: "study", id: study.id },
      });
    }
    // The blocking half of the pair above. This one really does stop an execution — nothing can be
    // provisioned through an unfinished target, so the run would die before its first visit — and
    // it is scoped to the study because that is the thing the reader is about to press go on.
    const aimedAt = targets.find((target) => target.id === study.targetId);
    if (aimedAt?.identity.strategy === "undecided") {
      needs.push({
        blocking: true,
        id: `study-target-unfinished:${study.id}`,
        sentence: `${study.name} goes to ${aimedAt.name}, and nobody has said how people get accounts there. Answer that on the target and this can run.`,
        scope: { kind: "study", id: study.id },
      });
    }
  }

  return needs;
}

/** How many people a study of `size` over `population` sends, from rows already in hand. */
function sendsOf(size: number, population: { members: readonly { cohortId: string; weight: number }[] } | undefined, cohorts: ReadonlyMap<string, { mix: readonly { personaId: string; weight: number }[] }>): number {
  if (!population) return 0;
  const present = population.members.filter((member) => cohorts.has(member.cohortId));
  return dealStudy(
    size,
    present.map((member) => ({ cohortId: member.cohortId, weight: member.weight })),
    present.map((member) => ({ cohortId: member.cohortId, entries: cohorts.get(member.cohortId)?.mix ?? [] })),
  ).sends;
}

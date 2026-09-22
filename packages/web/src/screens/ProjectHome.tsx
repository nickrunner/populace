import { useQuery } from "@tanstack/react-query";

import type { ProjectOverview, SimulationSummary } from "../api.js";
import { q } from "../queries.js";
import { useProject } from "../context.jsx";
import { people, plural } from "../format.js";
import { GetStarted } from "./GetStarted.jsx";
import {
  Badge,
  Chip,
  DocumentPage,
  Dot,
  Heading,
  Inline,
  Ledger,
  LedgerRow,
  Link,
  Measure,
  MetaLine,
  Money,
  Mono,
  OUTCOME_TONES,
  OUTCOME_WORDS,
  PageHeader,
  RelativeTime,
  Ring,
  Section,
  SeverityStack,
  SeverityTag,
  SimulationActions,
  Spacer,
  Stack,
  StateBlock,
  Text,
  type MetaFact,
} from "../design/index.js";

/**
 * Level one of three (SPEC §7.1): simulations and their headline results, and NOT ONE PERSON'S
 * NAME. The payload has nowhere to put one — `ProjectOverviewView` carries headcounts and cohort
 * slugs — so this screen cannot break the rule without asking for more than it was given.
 *
 * **Ported to the design system** — ATOMIC-INVENTORY §6.3, row 14. A document-class screen
 * (DESIGN-SYSTEM §5.3): `DocumentPage` owns the reading column, `StatGroup` the three figures
 * that used to be a `grid-cols-3`, `Section` the two bands, and `Ledger` the simulations, which
 * were a stack of cards with no column to read down. The hand-rolled statement measure
 * (`max-w-[34ch] leading-[1.25]`) is `Measure width="statement"`, which is the same 34ch as a
 * token.
 *
 * **The stub says whether anything has ever happened**, in the mark's own grammar and the same
 * spelling the projects list uses: a filled dot for a simulation that has been run, a ring for
 * one that has not. Neither is a promise about what the next execution will find.
 *
 * **The run controls come from the system too.** The screen used to render a legacy
 * `SimulationActions` that drew its primary button as `bg-accent text-white border-accent`,
 * which is white on lime at 1.22:1: "Send them in" was illegible on the project's most
 * important screen. The organism, whose every variant is written against a token, is the fix.
 *
 * ---
 *
 * **AMENDED — this screen is the project's dashboard, and a form no longer stands in front of
 * it.**
 *
 * It used to be two screens behind one address — `zero ? <GetStarted /> : <the dashboard>`, with
 *
 * ```ts
 * zero = !configured || (!everRan && project.simulations.length <= 1)
 * ```
 *
 * — so a new project opened on the three-step wizard *instead of* on itself, and kept opening on
 * it after setup was finished, because `everRan` was still false and there was exactly one
 * simulation. The project's own address was a form right up until an execution completed, which
 * is the one stretch in which a reader most needs telling where they are and what is in front of
 * them. `GetStarted`'s own docstring already promised the opposite — *"a panel on project home
 * rather than a mode the product puts you in"* — and it was a mode. Now it is a panel.
 *
 * **What the page always shows now, in whatever state the project is in:**
 *
 *  1. The setup panel, while nothing has ever run. `GetStarted` is unchanged: it already
 *     collapses a finished step to a line carrying its own answer, so as the project fills in it
 *     becomes a band of ticks with the one remaining step open — which is what it should have
 *     looked like all along.
 *  2. **The lay of the land** — the target, the people, the spend — as one ruled strip with the
 *     way into each underneath it. All three of those lived *only* in the rail: the target and
 *     the meter at its foot, the headcount as an 11px number beside a nav row. The page itself
 *     never said what the project was pointed at, who was in it, or what it was costing. A strip
 *     and not a row of cards, because §1.4's ground is ruled, not empty.
 *  3. The simulations, as a ledger, with their controls. Unchanged.
 *  4. What has shown up in more than one simulation, once there are two. Unchanged.
 *
 * **The headline sentence waits for the panel to go.** While `GetStarted` is up it is already
 * saying what is left, and the product does not say a thing twice (§7.4).
 */

/**
 * What this project is, in one sentence assembled from what is actually in it.
 *
 * **AMENDED to cover the states the panel used to stand in front of.** This sentence only ever
 * ran on a project that had already been set up, because the takeover meant a half-built project
 * never reached it — so the whole of "nothing is connected yet" collapsed into one line,
 * `Nothing has been set up in X yet.`, which was also printed at a project that had a target and
 * three people and simply had not been sent anywhere. The order below is the order a project
 * actually fills up in, and each rung says the true thing about that rung.
 *
 * Running comes first because it is the only one of these that is happening rather than pending.
 * Nothing here promises what an execution will find (§7.3).
 */
function headline(project: ProjectOverview): string {
  const running = project.runningRunIds.length;
  if (running > 0)
    return `${running === 1 ? "One simulation is" : `${running} simulations are`} running right now.`;
  if (project.counts.targets === 0) return `${project.name} is not pointed at anything yet.`;
  if (project.counts.people === 0) return `Nobody has been picked to visit ${project.name} yet.`;

  const sims = project.simulations.length;
  if (sims === 0)
    return `${people(project.counts.people)} are ready, and there is nothing to send them on yet.`;

  const ran = project.simulations.filter((s) => s.latest !== null).length;
  if (ran === 0)
    return `${sims === 1 ? "One simulation is" : `${sims} simulations are`} ready to go, and nobody has gone yet.`;

  const open = project.crossSimulation.length;
  return open === 0
    ? `Nothing has shown up in more than one simulation.`
    : `${open === 1 ? "One problem has" : `${open} problems have`} shown up in more than one simulation.`;
}

export function ProjectHome() {
  const { project, href } = useProject();
  // The panel stands until the project HAS got started, which is an execution behind it and not a
  // form filled in: step 3 is the only place it sends anybody, and gating on the headcount alone
  // took it away the moment people were picked, leaving its last step unreachable (SPEC §7.5).
  // The old `simulations.length <= 1` clause went with the takeover it was compensating for.
  const everRan = project.simulations.some((simulation) => simulation.latest !== null);

  return (
    <DocumentPage
      header={
        <PageHeader
          title={project.name}
          lede={project.description || undefined}
          /*
            What the project is made of, and what it is costing. Spend moved up here out of the
            strip below: it is a fact about the whole project rather than one of the things the
            project is made of, and a `Stat` at the 32px figure step made "$0.00" the loudest
            number on a page whose subject is what came back.
          */
          meta={[
            { key: "simulations", node: plural(project.counts.simulations, "simulation") },
            { key: "targets", node: plural(project.counts.targets, "target") },
            { key: "people", node: `${people(project.counts.people)} configured` },
            {
              key: "spend",
              node: (
                <>
                  <Money usd={project.spentTodayUsd} /> today of{" "}
                  <Money usd={project.dailyCeilingUsd} />{" "}
                  <Link size="meta" to={href("settings")}>
                    change
                  </Link>
                </>
              ),
            },
          ]}
        />
      }
    >
      <Stack gap={12}>
        {/* Where the project stands, in one line, in every state it can be in. */}
        <Measure width="statement" as="div">
          <Text size="statement" as="p">
            {headline(project)}
          </Text>
        </Measure>

        <TargetsBand />

        <WhoCanGoBand />

        {/*
          Until something has run, the panel — and it is a panel now, sitting on the page rather
          than standing in front of it. It is BELOW the strip deliberately: the reader's first
          question on opening a project is what is in it, and the panel's open step is a form
          that would push the answer under the fold. What is left to do comes after where you
          are. Once an execution is behind the project the panel has nothing to say and goes.
        */}
        {everRan ? null : <GetStarted />}

        {/*
          The simulations. With one target this is one flat ledger, exactly as before. With two it
          is one section per target, because five rows in store order tell a reader nothing about
          the thing they most want to know — "three at dev, two at qa" — and a simulation IS the
          pairing of a target and a population, so the target is the axis that groups.
        */}
        {project.simulations.length === 0 ? (
          <Section
            title="Simulations"
            trailing={plural(project.counts.simulations, "simulation")}
            actions={<Link to={href("s/new")}>New simulation</Link>}
          >
            <StateBlock kind="empty" what="this project's simulations">
              No simulations yet. One is a population, a target and a way of sending them.
            </StateBlock>
          </Section>
        ) : project.counts.targets > 1 ? (
          <Stack gap={12}>
            {groupByTarget(project.simulations).map(([targetName, rows]) => (
              <Section
                key={targetName}
                title={targetName}
                trailing={plural(rows.length, "simulation")}
                actions={<Link to={href("s/new")}>New simulation</Link>}
              >
                <Ledger>
                  {rows.map((simulation) => (
                    <SimulationRow key={simulation.id} simulation={simulation} />
                  ))}
                </Ledger>
              </Section>
            ))}
          </Stack>
        ) : (
          <Section
            title="Simulations"
            trailing={plural(project.counts.simulations, "simulation")}
            actions={<Link to={href("s/new")}>New simulation</Link>}
          >
            <Ledger>
              {project.simulations.map((simulation) => (
                <SimulationRow key={simulation.id} simulation={simulation} />
              ))}
            </Ledger>
          </Section>
        )}

        {/* The roll-up across simulations, which presupposes two of them. With one, "nothing has
            turned up in two simulations yet" is a sentence about the product's own machinery. */}
        {project.simulations.length > 1 ? (
          <Section
            id="problems"
            title="Seen in more than one simulation"
            trailing={plural(project.crossSimulation.length, "problem")}
          >
            {project.crossSimulation.length === 0 ? (
              <StateBlock kind="empty" what="problems seen in more than one simulation">
                Nothing has turned up in two simulations yet.
              </StateBlock>
            ) : (
              <Ledger>
                {project.crossSimulation.map((problem) => (
                  <LedgerRow
                    key={problem.signature}
                    stub={<SeverityStack level={problem.severity} />}
                  >
                    <Stack gap={1}>
                      <Inline gap={3} align="baseline" wrap>
                        <SeverityTag level={problem.severity} kind={problem.kind} />
                        <Text size="finding" as="span">
                          {problem.title}
                        </Text>
                      </Inline>

                      <MetaLine facts={incidenceOf(problem)} />

                      {/* One link per simulation it showed up in: the same signature, read
                          where it was reported, because the evidence for it is that
                          execution's. */}
                      <Inline gap={3} wrap>
                        {problem.simulations.map((simulation) => (
                          <Link
                            key={simulation.id}
                            size="meta"
                            to={href(
                              `s/${encodeURIComponent(simulation.id)}/f/${encodeURIComponent(problem.signature)}`,
                            )}
                          >
                            {simulation.name}
                          </Link>
                        ))}
                      </Inline>
                    </Stack>
                  </LedgerRow>
                ))}
              </Ledger>
            )}
          </Section>
        ) : null}
      </Stack>
    </DocumentPage>
  );
}

/**
 * The Targets band — what this project is pointed at, one row per target.
 *
 * **This replaces a three-cell strip whose first cell was `targets.data?.items[0]`.** That cell
 * called itself "The target", and the store has never had a one-target rule: the only uniqueness
 * constraint is `(project_id, slug)`, `POST /targets` carries a `target-2` slug de-dup loop that
 * only makes sense for N, and a simulation names its target by row id on a required field. So a
 * project with a dev and a qa endpoint had two targets and a dashboard that showed one of them —
 * and `listTargets` orders `updated_at DESC`, so *which* one was whichever you last edited. A
 * silent coin flip, not a default.
 *
 * Each row carries the stored first-contact outcome and **never dials the target**. Asking
 * whether an endpoint answers opens a connection to somebody else's server; that is a POST the
 * target's own screen makes when a reader presses Check, never a render. Same rule the rail's
 * `TargetStatus` keeps.
 *
 * "Used by" is derived from the simulations already in the payload, so it costs nothing and it is
 * the fact that makes several targets legible: a target nothing points at is a loose end, and a
 * target three simulations share is a hazard worth seeing (ADR-0022:31-40 — an ephemeral start
 * resets the world under another execution).
 */
function TargetsBand() {
  const { key, project, href } = useProject();
  const targets = useQuery(q.targets(key));
  const items = targets.data?.items ?? [];

  return (
    <Section
      title="Targets"
      trailing={plural(project.counts.targets, "target")}
      actions={<Link to={href("library/targets")}>All targets</Link>}
    >
      {items.length === 0 ? (
        <StateBlock kind="empty" what="this project's targets">
          Nothing is connected yet. A target is an address your product answers on — dev and qa are
          two targets here, not two projects.{" "}
          <Link to={href("library/targets")} size="ui">
            Connect a target
          </Link>
        </StateBlock>
      ) : (
        <Ledger>
          {items.map((target) => {
            const used = project.simulations.filter((s) => s.target.id === target.id);
            const contact = target.firstContact;
            return (
              <LedgerRow key={target.id} stub={contact === null ? <Ring size="sm" /> : <Dot size="sm" />}>
                <Stack gap={1}>
                  <Inline gap={3} align="baseline" wrap>
                    <Heading level={3} size="name">
                      <Link to={href(`library/targets/${encodeURIComponent(target.id)}`)}>
                        {target.name}
                      </Link>
                    </Heading>
                    {/* The word, never the hue alone (§4.2). Null means nobody has checked. */}
                    {contact === null ? (
                      <Text size="meta" tone="muted">
                        never checked
                      </Text>
                    ) : (
                      <Badge tone={OUTCOME_TONES[contact.outcome]}>
                        {OUTCOME_WORDS[contact.outcome]}
                      </Badge>
                    )}
                  </Inline>
                  {/* `break-all`: a URL is one word to CSS and four lines to a reader. */}
                  <Mono size="code-sm" tone="muted" className="block break-all">
                    {target.mcp[0]?.url ?? "no endpoint"}
                  </Mono>
                  <MetaLine facts={usedByFacts(used)} />
                </Stack>
              </LedgerRow>
            );
          })}
        </Ledger>
      )}
    </Section>
  );
}

/**
 * Which simulations point at a target. A target nothing points at says so in those words rather
 * than printing "0 simulations", because nought of something is a state, not a measurement.
 */
function usedByFacts(used: readonly SimulationSummary[]): readonly MetaFact[] {
  if (used.length === 0)
    return [{ key: "unused", node: "no simulation points at it yet" }];
  return [
    { key: "used", node: `run by ${used.map((s) => s.name).join(", ")}` },
    ...(used.length > 1
      ? [
          {
            key: "shared",
            // ADR-0022:31-40's named-but-unguarded gap. Stated, not refused — see the plan.
            node: "they share it, so an ephemeral start resets it under the others",
          },
        ]
      : []),
  ];
}

/**
 * The Who-can-go band — the casts this project keeps, and what each adds up to.
 *
 * A population is composition and nothing else: an ordered set of cohorts (ADR-0029). While there
 * is one it is still worth showing, because the headcount and what it is made of are the second
 * thing a reader wants after "what is it pointed at" — and both of them lived only in the rail,
 * as an 11px number beside a nav row.
 */
function WhoCanGoBand() {
  const { key, project, href } = useProject();
  const populations = useQuery(q.populations(key));
  const items = populations.data?.items ?? [];

  return (
    <Section
      title="Who can go"
      trailing={`${people(project.counts.people)} in ${plural(project.counts.cohorts, "cohort")}`}
      actions={<Link to={href("library/cohorts")}>All cohorts</Link>}
    >
      {items.length === 0 || project.counts.people === 0 ? (
        <StateBlock kind="empty" what="this project's people">
          Nobody has been picked yet. A persona is a kind of person; a cohort is N people cut from
          one persona; a population is a set of cohorts saved under a name.{" "}
          <Link to={href("library/personas")} size="ui">
            Pick who visits
          </Link>
        </StateBlock>
      ) : (
        <Ledger>
          {items.map((population) => {
            const headcount = population.members.reduce((n, m) => n + m.count, 0);
            const used = project.simulations.filter((s) => s.population.name === population.name);
            return (
              <LedgerRow key={population.id} stub={<Dot size="sm" />}>
                <Stack gap={1}>
                  <Inline gap={3} align="baseline" wrap>
                    <Heading level={3} size="name">
                      {population.name}
                    </Heading>
                    <Text size="meta" tone="muted">
                      {people(headcount)}
                    </Text>
                  </Inline>
                  <MetaLine
                    facts={[
                      {
                        key: "cohorts",
                        node:
                          population.members.length === 0
                            ? "no cohorts in it yet"
                            : population.members.map((m) => m.cohortName).join(", "),
                      },
                      {
                        key: "used",
                        node:
                          used.length === 0
                            ? "no simulation runs it yet"
                            : `run by ${used.map((s) => s.name).join(", ")}`,
                      },
                    ]}
                  />
                </Stack>
              </LedgerRow>
            );
          })}
        </Ledger>
      )}
    </Section>
  );
}

/**
 * The simulations, gathered under the target each one visits, in first-appearance order.
 *
 * Grouping by NAME rather than by id is deliberate: the heading is the target's name, two targets
 * cannot share one within a project (the slug is unique per project and the name drives it), and
 * keying by name means the group and its heading can never disagree. Order follows the first row
 * that mentions each target, so the ledger's own ordering still decides what a reader meets first.
 */
function groupByTarget(
  simulations: readonly SimulationSummary[],
): readonly (readonly [string, readonly SimulationSummary[]])[] {
  const groups = new Map<string, SimulationSummary[]>();
  for (const simulation of simulations) {
    const bucket = groups.get(simulation.target.name);
    if (bucket === undefined) groups.set(simulation.target.name, [simulation]);
    else bucket.push(simulation);
  }
  return [...groups.entries()];
}

/**
 * The short form of the triage decisions, for a line with no room for the full sentence. "fixed"
 * survives here because a human asserted it about their own product, and the line prints it as
 * *marked fixed* so the assertion keeps its author (§7.3).
 */
const TRIAGE_WORDS: Record<string, string> = {
  accepted: "accepted",
  fixed: "fixed",
  "wont-fix": "won't fix",
  duplicate: "a duplicate",
};

/** How far a problem reached, and what somebody has already decided about it. */
function incidenceOf(problem: ProjectOverview["crossSimulation"][number]): readonly MetaFact[] {
  const word = problem.triage === null ? undefined : TRIAGE_WORDS[problem.triage.state];
  return [
    { key: "people", node: `${people(problem.peopleHit)} hit it` },
    { key: "where", node: `in ${plural(problem.simulations.length, "simulation")}` },
    ...(word === undefined ? [] : [{ key: "triage", node: `marked ${word}` }]),
  ];
}

/**
 * One simulation: what it is made of, where it got to, and the one action it is asking for. The
 * row is not itself a link — it carries the controls that start and stop an execution, and a
 * button inside an anchor is a target a reader cannot aim at — so the name is the link, exactly
 * as it was before the port.
 */
function SimulationRow({ simulation }: { simulation: SimulationSummary }) {
  const { href } = useProject();
  const base = `${href()}/s/${encodeURIComponent(simulation.slug)}`;
  const running = simulation.status === "running";

  return (
    <LedgerRow
      stub={
        simulation.latest === null ? (
          <Ring size="sm" className="md:ml-auto" />
        ) : (
          <Dot size="sm" className="md:ml-auto" />
        )
      }
    >
      <Stack gap={2}>
        <Inline gap={3} align="baseline" wrap>
          <Heading level={3} size="name">
            <Link to={base}>{simulation.name}</Link>
          </Heading>
          <Badge variant="mode">{simulation.mode}</Badge>
          {running ? <Chip tone="live">running</Chip> : null}
          {simulation.status === "paused" ? <Chip>paused</Chip> : null}
          <Spacer />
          <Text size="meta" tone="muted">
            {simulation.latest === null ? (
              "never sent"
            ) : (
              <>
                execution {simulation.latest.seq},{" "}
                <RelativeTime at={simulation.latest.startedAt} mode="absolute" />
              </>
            )}
          </Text>
        </Inline>

        <MetaLine facts={shapeOf(simulation)} />
        <MetaLine facts={resultsOf(simulation)} />

        <Inline gap={3} align="center" wrap>
          <SimulationActions simulation={simulation} />
          <Spacer />
          <Link to={running ? `${base}/live` : base}>
            {running ? "Watch it live" : "Read the results"}
          </Link>
        </Inline>
      </Stack>
    </LedgerRow>
  );
}

/** Who goes, where they go, and for how long — the line that says what this simulation *is*. */
function shapeOf(simulation: SimulationSummary): readonly MetaFact[] {
  return [
    { key: "population", node: simulation.population.name },
    {
      key: "headcount",
      node: `${people(simulation.population.people)} in ${plural(simulation.population.cohorts, "cohort")}`,
    },
    { key: "target", node: `visits ${simulation.target.name}` },
    {
      key: "mode",
      node:
        simulation.mode === "ephemeral" && simulation.visitsPerPerson !== null
          ? `${plural(simulation.visitsPerPerson, "visit")} each`
          : "until you stop it",
    },
  ];
}

/**
 * What has come back. A problem missing from the newest execution is reported as an absence and
 * never as a repair (ADR-0028, DESIGN-SYSTEM §7.3) — "not reported this time" is the whole
 * claim, and the word "fixed" belongs to the person who typed it into triage.
 */
function resultsOf(simulation: SimulationSummary): readonly MetaFact[] {
  if (simulation.latest === null) {
    return [{ key: "nothing", node: "nothing has been found yet, because nobody has gone" }];
  }
  return [
    { key: "confirmed", node: `${simulation.confirmed} confirmed` },
    ...(simulation.newSinceLast > 0
      ? [{ key: "new", node: `${simulation.newSinceLast} new since the last one` }]
      : []),
    ...(simulation.fixedSinceLast > 0
      ? [{ key: "absent", node: `${simulation.fixedSinceLast} not reported this time` }]
      : []),
    { key: "cost", node: <Money usd={simulation.costUsd} /> },
  ];
}

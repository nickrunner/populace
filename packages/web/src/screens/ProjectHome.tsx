import type { ProjectOverview, SimulationSummary } from "../api.js";
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
  PageHeader,
  RelativeTime,
  Ring,
  Section,
  SeverityStack,
  SeverityTag,
  SimulationActions,
  Spacer,
  Stack,
  Stat,
  StatGroup,
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
 */

/** What this project is, in one sentence assembled from what is actually in it. */
function headline(project: ProjectOverview): string {
  const running = project.runningRunIds.length;
  const sims = project.simulations.length;
  const open = project.crossSimulation.length;
  if (sims === 0) return `Nothing has been set up in ${project.name} yet.`;
  if (running > 0) return `${running === 1 ? "One simulation is" : `${running} simulations are`} running right now.`;
  const ran = project.simulations.filter((s) => s.latest !== null).length;
  if (ran === 0) return `${sims === 1 ? "One simulation is" : `${sims} simulations are`} ready to go, and nobody has gone yet.`;
  return open === 0
    ? `Nothing has shown up in more than one simulation.`
    : `${open === 1 ? "One problem has" : `${open} problems have`} shown up in more than one simulation.`;
}

export function ProjectHome() {
  const { project, href } = useProject();
  // Get started stands until the project HAS got started, which is an execution behind it and not
  // a form filled in: step 3 is the only place the card sends anybody, and gating on the headcount
  // alone took the card away the moment people were picked, leaving its last step unreachable
  // (SPEC §7.5). A project driven far enough to hold a second simulation has plainly found its
  // way and gets the real screen whether or not anything has run.
  const configured = project.counts.targets > 0 && project.counts.people > 0;
  const everRan = project.simulations.some((simulation) => simulation.latest !== null);
  const zero = !configured || (!everRan && project.simulations.length <= 1);

  return (
    <DocumentPage
      header={
        <PageHeader
          title={project.name}
          lede={project.description || undefined}
          meta={[
            { key: "simulations", node: plural(project.counts.simulations, "simulation") },
            { key: "people", node: `${people(project.counts.people)} configured` },
            {
              key: "spend",
              node: (
                <>
                  <Money usd={project.costLast7dUsd} /> this week
                </>
              ),
            },
          ]}
        />
      }
    >
      {zero ? (
        <GetStarted />
      ) : (
        <Stack gap={12}>
          <Measure width="statement" as="div">
            <Text size="statement" as="p">
              {headline(project)}
            </Text>
          </Measure>

          <StatGroup cols={3} ruled>
            <Stat
              label="Simulations"
              value={project.counts.simulations}
              sub={`${plural(project.counts.cohorts, "cohort")} between them`}
            />
            <Stat
              label="People configured"
              value={project.counts.people}
              sub={plural(project.counts.personas, "persona")}
            />
            <Stat
              label="Spent today"
              value={<Money usd={project.spentTodayUsd} />}
              sub={
                <>
                  of the <Money usd={project.dailyCeilingUsd} /> daily ceiling
                </>
              }
            />
          </StatGroup>

          <Section
            title="Simulations"
            trailing={plural(project.counts.simulations, "simulation")}
            actions={<Link to={href("s/new")}>New simulation</Link>}
          >
            {project.simulations.length === 0 ? (
              <StateBlock kind="empty" what="this project's simulations">
                No simulations yet. One is a population, a target and a way of sending them.
              </StateBlock>
            ) : (
              <Ledger>
                {project.simulations.map((simulation) => (
                  <SimulationRow key={simulation.id} simulation={simulation} />
                ))}
              </Ledger>
            )}
          </Section>

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
      )}
    </DocumentPage>
  );
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

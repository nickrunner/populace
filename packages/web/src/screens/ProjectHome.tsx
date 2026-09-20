import { Link } from "react-router-dom";
import type { ProjectOverview, SimulationSummary } from "../api.js";
import { useProject } from "../context.jsx";
import { people, usd, when } from "../format.js";
import { Card, Chip, Empty, PageHeader, Section, Severity, Stat } from "../components/ui.jsx";
import { SimulationActions } from "../components/SimulationActions.jsx";
import { GetStarted } from "./GetStarted.jsx";

/**
 * Level one of three (SPEC §7.1): simulations and their headline results, and NOT ONE PERSON'S
 * NAME. The payload has nowhere to put one — `ProjectOverviewView` carries headcounts and cohort
 * slugs — so this screen cannot break the rule without asking for more than it was given.
 */

/** What this project is, in one sentence assembled from what is actually in it. */
function headline(project: ProjectOverview): string {
  const running = project.runningRunIds.length;
  const sims = project.simulations.length;
  const open = project.crossSimulation.length;
  if (sims === 0) return `Nothing has been set up in ${project.name} yet.`;
  if (running > 0) return `${running === 1 ? "One simulation is" : `${running} simulations are`} running right now.`;
  const ran = project.simulations.filter((s) => s.latest !== null).length;
  if (ran === 0) return `${sims === 1 ? "One simulation is" : `${sims} simulations are`} ready to go and ${sims === 1 ? "has" : "have"} never been run.`;
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
    <>
      <PageHeader
        title={project.name}
        lede={project.description || undefined}
        trail={
          <>
            {project.counts.simulations} {project.counts.simulations === 1 ? "simulation" : "simulations"} · {people(project.counts.people)} configured · {usd(project.costLast7dUsd)} this week
          </>
        }
      />

      {zero ? (
        <GetStarted />
      ) : (
        <>
          <p className="t-display mb-8 max-w-[34ch] leading-[1.25]">{headline(project)}</p>

          <div className="grid grid-cols-3 gap-6 mb-9 pb-8 border-b border-rule">
            <Stat label="Simulations" value={project.counts.simulations} sub={`${project.counts.cohorts} ${project.counts.cohorts === 1 ? "cohort" : "cohorts"} of people between them`} />
            <Stat label="People configured" value={project.counts.people} sub={`${project.counts.personas} personas`} />
            <Stat label="Spent today" value={usd(project.spentTodayUsd)} sub={`of the ${usd(project.dailyCeilingUsd)} daily ceiling`} />
          </div>

          <Section title="Simulations" sub="each one is a population, a target and a way of running them">
            <div className="flex flex-col gap-3">
              {project.simulations.map((simulation) => (
                <SimulationCard key={simulation.id} simulation={simulation} />
              ))}
              {project.simulations.length === 0 ? (
                <Card className="p-4">
                  <Empty>No simulations yet.</Empty>
                </Card>
              ) : null}
            </div>
            <Link to={href("s/new")} className="inline-block mt-3 t-body text-accent hover:underline">
              New simulation
            </Link>
          </Section>

          {/* The roll-up across simulations, which presupposes two of them. With one, "nothing has
              turned up in two simulations yet" is a sentence about the product's own machinery. */}
          {project.simulations.length > 1 ? (
            <section id="problems" className="mb-8 scroll-mt-8">
              <div className="flex items-baseline gap-3 mb-3">
                <h2 className="t-section">Seen in more than one simulation</h2>
                <span className="t-meta text-ink-muted">the same problem, wherever it has shown up</span>
              </div>
              {project.crossSimulation.length === 0 ? (
                <Card className="p-4">
                  <Empty>Nothing has turned up in two simulations yet.</Empty>
                </Card>
              ) : (
                <Card className="divide-y divide-rule">
                  {project.crossSimulation.map((problem) => (
                    <div key={problem.signature} className="p-3.5 flex items-baseline gap-3">
                      <Severity value={problem.severity} kind={problem.kind} />
                      <div className="flex-1 min-w-0">
                        <div className="t-body text-ink">{problem.title}</div>
                        <div className="t-meta text-ink-muted">
                          {problem.peopleHit} {problem.peopleHit === 1 ? "person" : "people"} hit it
                          {problem.triage === null ? "" : ` · marked ${problem.triage.state.replace("-", " ")}`}
                        </div>
                      </div>
                      {/* One link per simulation it showed up in: the same signature, read where it was
                          reported, because the evidence for it is that execution's. */}
                      <div className="t-meta shrink-0 flex gap-3">
                        {problem.simulations.map((simulation) => (
                          <Link
                            key={simulation.id}
                            to={href(`s/${encodeURIComponent(simulation.id)}/f/${encodeURIComponent(problem.signature)}`)}
                            className="text-accent hover:underline"
                          >
                            {simulation.name}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </Card>
              )}
            </section>
          ) : null}
        </>
      )}
    </>
  );
}

const MODE_WORDS: Record<string, string> = { ephemeral: "EPHEMERAL", longitudinal: "LONGITUDINAL" };

function SimulationCard({ simulation }: { simulation: SimulationSummary }) {
  const { href } = useProject();
  const base = `${href()}/s/${encodeURIComponent(simulation.slug)}`;

  return (
    <Card className="p-4">
      <div className="flex items-baseline gap-3">
        <Link to={base} className="t-section hover:text-accent">
          {simulation.name}
        </Link>
        <span className="t-label text-ink-muted">{MODE_WORDS[simulation.mode] ?? simulation.mode}</span>
        <span className="flex-1" />
        {simulation.status === "running" ? <Chip tone="live">● running</Chip> : null}
        {simulation.status === "paused" ? <Chip>paused</Chip> : null}
        <span className="t-meta text-ink-muted tabular-nums">
          {simulation.latest === null ? "never run" : `execution ${simulation.latest.seq} · ${when(simulation.latest.startedAt)}`}
        </span>
      </div>

      <p className="t-body text-ink-soft mt-1">
        {simulation.population.name} ({people(simulation.population.people)}, {simulation.population.cohorts} {simulation.population.cohorts === 1 ? "cohort" : "cohorts"}) → {simulation.target.name}
        {simulation.mode === "ephemeral" && simulation.visitsPerPerson !== null ? ` · ${simulation.visitsPerPerson} visits each` : " · until you stop it"}
      </p>

      <p className="t-meta text-ink-muted mt-1.5 tabular-nums">
        {simulation.latest === null ? (
          "nothing has been found yet, because nobody has gone"
        ) : (
          <>
            {simulation.confirmed} confirmed
            {simulation.newSinceLast > 0 ? ` · ${simulation.newSinceLast} new since the last one` : ""}
            {simulation.fixedSinceLast > 0 ? ` · ${simulation.fixedSinceLast} not reported this time` : ""} · {usd(simulation.costUsd)}
          </>
        )}
      </p>

      <div className="flex items-end gap-2 mt-3">
        <SimulationActions simulation={simulation} />
        <span className="flex-1" />
        <Link to={simulation.status === "running" ? `${base}/live` : base} className="t-body text-accent hover:underline pb-1.5">
          {simulation.status === "running" ? "Live →" : "Results →"}
        </Link>
      </div>
    </Card>
  );
}

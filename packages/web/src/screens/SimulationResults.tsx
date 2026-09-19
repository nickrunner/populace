import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { SimulationResults as Results } from "../api.js";
import { q } from "../queries.js";
import { useProject, useSimulation } from "../context.jsx";
import { people, usd, when } from "../format.js";
import { ClusterRow } from "../components/ClusterRow.jsx";
import { SimulationActions } from "../components/SimulationActions.jsx";
import { ExecutionHistory } from "./Executions.jsx";
import { Bar, Breadcrumb, Card, Chip, Empty, Failed, Loading, Section, Stat } from "../components/ui.jsx";

/**
 * The screen the user lives on (SPEC sketch 2).
 *
 * A simulation IS its latest findings. It is not a hub you pass through on the way to a run: the
 * run id is not in the URL, the execution these numbers come from is a detail of the page, and
 * what the reader came for — what keeps going wrong, to whom — is the first thing on it.
 *
 * NOBODY IS NAMED HERE. `SimulationResultsView` has nowhere to put a name, deliberately (SPEC
 * §7.1), and this screen does not go looking for one: a headcount and a cohort answer "how bad is
 * it and to whom", and a name answers "who said that", which is one click further in.
 */

/** The one sentence for someone who reads nothing else, assembled from what happened. */
function headline(results: Results): string {
  const { stats, clusters, execution, simulation } = results;
  const target = simulation.target.name;
  const people = stats.people === 1 ? "person" : "people";
  // Before anybody goes, the headcount is the CONFIGURED one: `stats` counts the execution these
  // results are of, and there is not one yet.
  if (execution === null) {
    const ready = simulation.population.people;
    return `${ready} ${ready === 1 ? "person is" : "people are"} ready to visit ${target}. Nobody has been sent yet.`;
  }
  if (stats.visits === 0) return `This execution has started and nobody has reached ${target} yet.`;

  const left =
    stats.walkedAway === 0
      ? ""
      : stats.walkedAway === 1
        ? ", and one of them left before they were finished"
        : `, and ${stats.walkedAway} of them left before they were finished`;

  if (clusters.length === 0) {
    return stats.walkedAway === 0
      ? `All ${stats.people} ${people} we sent to ${target} got their errands done without filing anything.`
      : `Nobody filed a problem with ${target}${left}.`;
  }

  const worst = clusters[0];
  const things = clusters.length === 1 ? "one problem" : `${clusters.length} problems`;
  if (worst === undefined) return `${stats.visits} visits to ${target} turned up ${things}${left}.`;
  return `${stats.visits} visits to ${target} turned up ${things}; the worst of them hit ${worst.peopleHit} of the ${worst.peopleTotal} ${people} who went${left}.`;
}

export function SimulationResults() {
  const { key, href: projectHref } = useProject();
  const { key: sim, simulation, href } = useSimulation();
  const results = useQuery(q.results(key, sim));
  const [all, setAll] = useState(false);
  const [known, setKnown] = useState(false);

  if (results.isPending) return <Loading what="this simulation" />;
  if (results.isError) return <Failed error={results.error} />;

  const data = results.data;
  const seqs = [...data.history].map((entry) => entry.seq).sort((a, b) => a - b);
  const latest = data.history.find((entry) => entry.runId === data.execution?.id);
  // An execution that has been created and has not visited yet is real, and saying "never run"
  // about it would be wrong; it just has nothing to report (SPEC §6.2).
  const started = [...data.history].sort((a, b) => a.seq - b.seq).at(-1);
  const filed = data.execution?.totals.findings ?? 0;
  const shown = all ? data.clusters : data.clusters.slice(0, 8);
  const untouched = data.coverage.neverCalledCount;

  return (
    <>
      <div className="flex items-start justify-between gap-6 mb-6">
        <div className="min-w-0">
          <Breadcrumb items={[{ label: "Simulations", to: projectHref() }, { label: simulation.name }]} />
          <h1 className="t-title mt-1">{simulation.name}</h1>
          <p className="t-meta text-ink-muted mt-1">
            <span className="t-label">{simulation.mode}</span> · {simulation.population.name} ({people(simulation.population.people)},{" "}
            {simulation.population.cohorts} {simulation.population.cohorts === 1 ? "cohort" : "cohorts"}) → {simulation.target.name}
            {latest === undefined
              ? started === undefined
                ? " · never run"
                : ` · execution ${started.seq} has not visited yet`
              : ` · execution ${latest.seq} · ${when(latest.startedAt)}`}
          </p>
        </div>
        <div className="shrink-0 flex items-start gap-3">
          {simulation.status === "running" ? <Chip tone="live">● running</Chip> : simulation.status === "paused" ? <Chip>paused</Chip> : null}
          <SimulationActions simulation={simulation} />
        </div>
      </div>

      <p className="t-display mb-8 max-w-[34ch] leading-[1.25]">{headline(data)}</p>

      <div className="grid grid-cols-5 gap-6 mb-10 pb-8 border-b border-rule">
        <Stat label="People sent" value={data.stats.people} sub={`${simulation.population.cohorts} ${simulation.population.cohorts === 1 ? "cohort" : "cohorts"}`} />
        <Stat label="Visits made" value={data.stats.visits} />
        <Stat label="Problems confirmed" value={data.stats.confirmed} sub={filed === 0 ? "nothing filed yet" : `of ${filed} filed`} />
        <Stat label="Walked away" value={data.stats.walkedAway} sub="before they were finished" />
        <Stat label="Spent" value={usd(data.stats.costUsd)} sub="on this execution" />
      </div>

      <Section
        title="What keeps happening"
        sub={
          simulation.mode === "longitudinal"
            ? "over the life of this execution"
            : seqs.length === 0
              ? "nothing has been run yet"
              : seqs.length === 1
                ? "in the one execution so far"
                : `across all ${seqs.length} executions`
        }
      >
        <div className="flex flex-col gap-3">
          {shown.map((card) => (
            <ClusterRow key={card.signature} card={card} seqs={seqs} mode={simulation.mode} />
          ))}
          {data.clusters.length === 0 ? (
            <Card className="p-4">
              <Empty>{data.execution === null ? "Nobody has gone yet, so there is nothing here." : "Nobody filed anything in this execution."}</Empty>
            </Card>
          ) : null}
        </div>

        <div className="flex items-center gap-5 mt-3">
          {data.clusters.length > 8 ? (
            <button type="button" onClick={() => setAll(!all)} className="t-body text-accent hover:underline">
              {all ? "Show the worst 8 only" : `Show the other ${data.clusters.length - 8}`}
            </button>
          ) : null}
          <span className="flex-1" />
          {untouched > 0 ? (
            <Link to={href("coverage")} className="t-meta text-accent hover:underline">
              {untouched} {untouched === 1 ? "tool" : "tools"} nobody reached for →
            </Link>
          ) : null}
        </div>
      </Section>

      {data.known.length > 0 ? (
        <section className="mb-8">
          <button type="button" onClick={() => setKnown(!known)} className="t-section text-ink-soft hover:text-accent">
            Known {" "}
            <span className="t-meta text-ink-muted font-normal">
              {data.known.length} you have already decided about {known ? "▾" : "▸"}
            </span>
          </button>
          {known ? (
            <div className="flex flex-col gap-3 mt-3">
              {data.known.map((card) => (
                <ClusterRow key={card.signature} card={card} seqs={seqs} mode={simulation.mode} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <Section title="Who we sent" sub="by cohort — how many filed something, how many left">
        {data.cohortBreakdown.length === 0 ? (
          <Card className="p-4">
            <Empty>Nobody has been sent yet.</Empty>
          </Card>
        ) : (
          <Card className="divide-y divide-rule">
            {data.cohortBreakdown.map((cohort) => (
              <div key={cohort.cohortSlug} className="p-3.5 flex items-baseline gap-4">
                <span className="t-body text-ink w-36 truncate">{cohort.name}</span>
                <span className="t-meta text-ink-muted tabular-nums w-8 text-right">{cohort.people}</span>
                <span className="w-32">
                  <Bar value={cohort.people} of={Math.max(...data.cohortBreakdown.map((c) => c.people), 1)} />
                </span>
                <span className="t-meta text-ink-soft flex-1">{cohort.headline}</span>
                <span className="t-meta text-ink-muted shrink-0">{cohort.personaName}</span>
              </div>
            ))}
          </Card>
        )}
        <div className="flex gap-5 mt-3">
          <Link to={href("population")} className="t-body text-accent hover:underline">
            Open the population
          </Link>
          {data.stats.walkedAway > 0 ? (
            <Link to={href("left")} className="t-body text-accent hover:underline">
              Who walked away
            </Link>
          ) : null}
        </div>
      </Section>

      <Section title={simulation.mode === "longitudinal" ? "This execution's life" : "Executions"}>
        <ExecutionHistory results={data} limit={4} />
      </Section>
    </>
  );
}

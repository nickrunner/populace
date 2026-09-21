import { useQuery } from "@tanstack/react-query";
import type { RunCohort } from "../api.js";
import { q } from "../queries.js";
import { useProject, useSimulation } from "../context.jsx";
import { people, plural, usd } from "../format.js";
import { ExecutionHistory } from "./Executions.jsx";
import {
  Badge,
  Button,
  Chip,
  ClusterRow,
  DataTable,
  Disclosure,
  DocumentPage,
  IncidenceBars,
  Inline,
  Ledger,
  Link,
  Measure,
  PageHeader,
  RelativeTime,
  Section,
  SimulationActions,
  Skeleton,
  Stack,
  Stat,
  StateBlock,
  Text,
  type Column,
  type Crumb,
  type MetaFact,
  type StateKind,
} from "../design/index.js";

/**
 * The screen the user lives on (SPEC sketch 2), and the direction's showcase
 * (ATOMIC-INVENTORY §6.3, row 19).
 *
 * A simulation IS its latest findings. It is not a hub you pass through on the way to a run: the
 * run id is not in the URL, the execution these numbers come from is a detail of the page, and
 * what the reader came for — what keeps going wrong, to whom — is the first thing on it.
 *
 * NOBODY IS NAMED HERE. `SimulationResultsView` has nowhere to put a name, deliberately (SPEC
 * §7.1), and this screen does not go looking for one: a headcount and a cohort answer "how bad is
 * it and to whom", and a name answers "who said that", which is one click further in.
 *
 * **The statement comes off the wire.** `SimulationResultsView.headline` has been in the payload
 * the whole time and this screen recomputed its own sentence from `stats`, `clusters` and
 * `execution` while the field sat unused — two sentences about one execution, drifting, with the
 * browser's copy winning by accident. There is one now, it is the server's, and it is set at
 * `t-statement`: 30px serif, at the statement measure, above everything. **A zero-findings
 * execution gets the same statement, not an empty state** — "nothing was filed" is an answer to
 * the question the reader asked, and demoting it to an empty box says the screen is broken
 * instead.
 *
 * **Document-class with the instrument rail** (DESIGN-SYSTEM §5.3, ATOMIC-INVENTORY §4 template
 * 2). The five figures move off the top of the reading column — where they were a literal
 * `grid-cols-5` that fitted nothing under 1100px — and into the 264px rail, which is what the
 * rail is for: the numbers beside the document, sticky at ≥1240px and a two-column block beneath
 * it below that. They are bare `Stat`s because the rail IS the grid; a `StatGroup` inside it
 * would be a second grid inside the first.
 *
 * **The screen's one marker band** (§5.4, appearance 1) is fixed by name: *the incidence peak of
 * the worst cluster*. So the worst problem's cohort breakdown is drawn — `IncidenceBars`, the
 * panel instrument a list row is forbidden to carry (§1.3 rule 10) — and the cohort it reached
 * furthest into takes the band. Nothing else on this screen is marked, including the figures in
 * the rail.
 *
 * **Both bare toggles are gone** (molecule 33). "Show the other 12" and "Known ▸" were two
 * `<button>`s with no `aria-expanded` and no `aria-controls`; they are `Disclosure`s, which is
 * Radix `Collapsible` and carries both.
 */
export function SimulationResults() {
  const { key, href: projectHref } = useProject();
  const { key: sim, simulation, href } = useSimulation();
  const results = useQuery(q.results(key, sim));

  const crumbs: Crumb[] = [{ label: "Simulations", to: projectHref() }, { label: simulation.name }];
  const data = results.data;

  if (data === undefined) {
    const state: StateKind = results.isPending ? "loading" : "failed";
    return (
      <DocumentPage
        header={<PageHeader title={simulation.name} crumbs={crumbs} />}
        state={state}
        loading={
          // A skeleton at the height of what it replaces — the statement, then the rows — so
          // the page does not collapse to a line and jump back when the results land (§6.5,
          // rule 6).
          <StateBlock
            kind="loading"
            what="this simulation"
            skeleton={
              <Stack gap={8} align="stretch">
                <Skeleton variant="block" height={96} label="Reading this simulation" />
                <Skeleton variant="row" count={5} height={72} label="Reading what keeps happening" />
              </Stack>
            }
          />
        }
        error={
          // A failed read is the one state the reader can act on, so every failed state in the
          // product offers the read again (§6.5, rule 7).
          <StateBlock kind="failed" what="this simulation" error={results.error}>
            <Button
              variant="secondary"
              onClick={() => {
                void results.refetch();
              }}
            >
              Try again
            </Button>
          </StateBlock>
        }
      >
        {null}
      </DocumentPage>
    );
  }

  // Which execution these results are OF. `execution` is a run detail and carries no sequence
  // number; `history` is where the run id and the number a reader recognises are the same row.
  const latest = data.history.find((entry) => entry.runId === data.execution?.id);
  // An execution that has been created and has not visited yet is real, and saying "never run"
  // about it would be wrong; it just has nothing to report (SPEC §6.2).
  const started = [...data.history].sort((a, b) => a.seq - b.seq).at(-1);
  const filed = data.execution?.totals.findings ?? 0;
  const worst = data.clusters[0];
  const shown = data.clusters.slice(0, 8);
  const rest = data.clusters.slice(8);
  const untouched = data.coverage.neverCalledCount;

  const facts: MetaFact[] = [
    { key: "mode", node: <Badge variant="mode">{simulation.mode}</Badge> },
    {
      key: "population",
      node: `${simulation.population.name} — ${people(simulation.population.people)} in ${plural(simulation.population.cohorts, "cohort")}`,
    },
    { key: "target", node: simulation.target.name },
    {
      key: "execution",
      node:
        latest === undefined
          ? started === undefined
            ? "never run"
            : `execution ${started.seq} has not visited yet`
          : `execution ${latest.seq}`,
    },
    {
      key: "started",
      node:
        latest === undefined ? null : <RelativeTime at={latest.startedAt} mode="absolute" />,
    },
  ];

  /**
   * What "across executions" means for this simulation, in a sentence rather than in a count the
   * reader has to interpret. A longitudinal simulation has one execution and a life inside it; an
   * ephemeral one has peers, and how many there are changes what the list below is a reading of.
   */
  const span =
    simulation.mode === "longitudinal"
      ? "over the life of this execution"
      : data.history.length === 0
        ? "nothing has been run yet"
        : data.history.length === 1
          ? "in the one execution so far"
          : `across all ${data.history.length} executions`;

  /**
   * The cohort the worst problem reached furthest into, by proportion. It carries the screen's one
   * lime marker band, which §5.4 fixes by name for this screen: *the incidence peak of the worst
   * cluster*. A cohort nobody in it hit is never the peak — a band over `0/8` would mark an
   * absence as the answer.
   */
  const peak = (worst?.cohorts ?? []).reduce<{ slug: string; share: number } | undefined>(
    (best, cohort) => {
      if (cohort.hit === 0 || cohort.total === 0) return best;
      const share = cohort.hit / cohort.total;
      return best === undefined || share > best.share ? { slug: cohort.slug, share } : best;
    },
    undefined,
  );

  const columns: Column<RunCohort>[] = [
    { key: "cohort", header: "Cohort", cell: (cohort) => <Text size="ui">{cohort.name}</Text> },
    { key: "people", header: "People", numeric: true, cell: (cohort) => cohort.people },
    { key: "filed", header: "Filed", numeric: true, cell: (cohort) => cohort.findings },
    {
      // The one serif column (§5.3): a phrase a reader scans down, not a value.
      key: "how",
      header: "How it went",
      sentence: true,
      cell: (cohort) => (
        <Text size="read-sm" tone="soft">
          {cohort.headline}
        </Text>
      ),
    },
    {
      key: "persona",
      header: "Persona",
      priority: 3,
      cell: (cohort) => (
        <Text size="ui" tone="muted">
          {cohort.personaName}
        </Text>
      ),
    },
  ];

  return (
    <DocumentPage
      header={
        <PageHeader
          title={simulation.name}
          crumbs={crumbs}
          meta={facts}
          status={
            simulation.status === "running" ? (
              <Chip tone="live">running</Chip>
            ) : simulation.status === "paused" ? (
              <Chip>paused</Chip>
            ) : undefined
          }
          actions={<SimulationActions simulation={simulation} />}
        />
      }
      rail={
        <>
          <Stat
            label="People sent"
            value={data.stats.people}
            sub={plural(simulation.population.cohorts, "cohort")}
          />
          <Stat label="Visits made" value={data.stats.visits} />
          <Stat
            label="Problems confirmed"
            value={data.stats.confirmed}
            sub={filed === 0 ? "nothing filed yet" : `of ${filed} filed`}
          />
          <Stat
            label="Walked away"
            value={data.stats.walkedAway}
            sub="before they were finished"
          />
          <Stat label="Spent" value={usd(data.stats.costUsd)} sub="on this execution" />
        </>
      }
    >
      <Stack gap={8} align="stretch">
        {/*
          The sentence for somebody who reads nothing else, in the product's own voice and at
          the one step reserved for it. It is the server's sentence: this screen no longer
          writes a second one.
        */}
        <Measure width="statement">
          <Text as="p" size="statement">
            {data.headline}
          </Text>
        </Measure>

        <Section title="What keeps happening" trailing={data.clusters.length}>
          <Stack gap={4} align="stretch">
            <Measure width="read">
              <Text as="p" size="read-sm" tone="soft">
                {`One row is one thing that is actually wrong, ${span}.`}
              </Text>
            </Measure>

            {data.clusters.length === 0 ? (
              <StateBlock kind="empty" what="the problems">
                {data.execution === null
                  ? "Nobody has gone yet, so there is nothing here."
                  : "Nobody filed anything in this execution."}
              </StateBlock>
            ) : (
              <Ledger>
                {shown.map((card) => (
                  <ClusterRow
                    key={card.signature}
                    cluster={card}
                    to={href(`f/${encodeURIComponent(card.signature)}`)}
                    currentSeq={latest?.seq}
                  />
                ))}
              </Ledger>
            )}

            {rest.length === 0 ? null : (
              <Disclosure label="The rest of them" count={rest.length}>
                <Ledger>
                  {rest.map((card) => (
                    <ClusterRow
                      key={card.signature}
                      cluster={card}
                      to={href(`f/${encodeURIComponent(card.signature)}`)}
                      currentSeq={latest?.seq}
                    />
                  ))}
                </Ledger>
              </Disclosure>
            )}

            {untouched === 0 ? null : (
              <Inline gap={4} wrap>
                <Link size="ui" to={href("coverage")}>
                  {`${plural(untouched, "tool")} nobody reached for`}
                </Link>
              </Inline>
            )}
          </Stack>
        </Section>

        {worst === undefined || worst.cohorts.length === 0 ? null : (
          /*
            The worst problem's reach, cohort by cohort — the one reading on this screen a list
            row is not allowed to carry (§1.3 rule 10), and the element §5.4 fixes as this
            screen's single marked thing.
          */
          <Section
            title="Who the worst of it reached"
            trailing={`${worst.peopleHit} of ${people(worst.peopleTotal)}`}
          >
            <Stack gap={4} align="stretch">
              <Measure width="read">
                <Text as="p" size="read-sm" tone="soft">
                  {`“${worst.title}” — how far it got into each cohort of this execution.`}
                </Text>
              </Measure>
              <IncidenceBars cohorts={worst.cohorts} theOne={peak?.slug} />
              <Inline gap={4} wrap>
                <Link size="ui" to={href(`f/${encodeURIComponent(worst.signature)}`)}>
                  Read it in full
                </Link>
              </Inline>
            </Stack>
          </Section>
        )}

        {data.known.length === 0 ? null : (
          <Disclosure
            label="Problems you have already decided about"
            count={data.known.length}
          >
            <Ledger>
              {data.known.map((card) => (
                <ClusterRow
                  key={card.signature}
                  cluster={card}
                  to={href(`f/${encodeURIComponent(card.signature)}`)}
                  currentSeq={latest?.seq}
                />
              ))}
            </Ledger>
          </Disclosure>
        )}

        <Section title="Who we sent" trailing={plural(data.cohortBreakdown.length, "cohort")}>
          <Stack gap={4} align="stretch">
            <DataTable<RunCohort>
              rows={data.cohortBreakdown}
              keyOf={(cohort) => cohort.cohortSlug}
              caption="Every cohort in this execution, how many people it sent and how it went"
              empty="Nobody has been sent yet."
              columns={columns}
            />
            <Inline gap={4} wrap>
              <Link size="ui" to={href("population")}>
                Open the population
              </Link>
              {data.stats.walkedAway === 0 ? null : (
                <Link size="ui" to={href("left")}>
                  Who walked away
                </Link>
              )}
            </Inline>
          </Stack>
        </Section>

        <Section
          title={simulation.mode === "longitudinal" ? "This execution's life" : "Executions"}
        >
          <ExecutionHistory results={data} limit={4} />
        </Section>
      </Stack>
    </DocumentPage>
  );
}

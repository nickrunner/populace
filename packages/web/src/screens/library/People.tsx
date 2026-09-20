import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { costOf, priceFor } from "@populace/core/isomorphic";
import { api, type CohortView, type Settings } from "../../api.js";
import { q } from "../../queries.js";
import { useProject } from "../../context.jsx";
import { people, usd, usd4 } from "../../format.js";
import { Bar, Button, Card, Empty, Failed, Loading, Mono, PageHeader, Problem, Section, Select, Stat, Stepper } from "../../components/ui.jsx";

/**
 * The composition screen (SPEC sketch 4): cohorts on the left, what they add up to on the right.
 *
 * It is ONE screen for two entities on purpose. A population is an ordered set of cohorts, and
 * while there is one of them it is a concept with no payoff — so it stays implicit and unnamed
 * until a second one exists, at which point the switcher appears and the word starts to mean
 * something (SPEC §7.2).
 */

/**
 * What it costs to have the model write the people who have no details yet.
 *
 * The writer makes one call per batch of `maxPeoplePerGenerate` and asks for a name and a
 * sentence each, so the arithmetic is the prompt once per batch and about seventy tokens a
 * person, at this project's own model's price. It is an estimate and the copy says so; what was
 * actually spent lands on the job row afterwards.
 */
function priceOfWriting(people: number, settings: Settings | undefined): number | null {
  if (settings === undefined || people === 0) return null;
  const batches = Math.ceil(people / Math.max(1, settings.guardrails.maxPeoplePerGenerate));
  return costOf({ inputTokens: 700 * batches, outputTokens: 70 * people, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, priceFor(settings.model.model, settings.model.prices));
}

/**
 * How many of a cohort have no sentence written about them.
 *
 * Counted as "the ones a model or a person has not written" rather than as the seeded rows,
 * because a cohort's roster is materialised on first read: a cohort created a second ago has its
 * size and no rows at all, and counting rows would call twelve people nought of anything.
 */
const withoutDetails = (cohort: CohortView): number => Math.max(0, cohort.size - cohort.generated.model - cohort.generated.authored);

export function People() {
  const { key, project, href } = useProject();
  const queries = useQueryClient();
  const cohorts = useQuery(q.cohorts(key));
  const populations = useQuery(q.populations(key));
  const personas = useQuery(q.personas(key));
  const settings = useQuery(q.settings(key));
  const [watching, setWatching] = useState<string[]>([]);
  const [told, setTold] = useState<string[]>([]);
  const [adding, setAdding] = useState("");

  // One simulation's estimate is what a visit costs on this machine; which population goes does
  // not change the price of a visit, so the composition screen can price itself from it.
  const priced = project.simulations[0];
  const estimate = useQuery({ ...q.estimate(key, priced?.slug ?? ""), enabled: priced !== undefined });

  const jobs = useQuery({
    queryKey: ["people-jobs", watching],
    queryFn: () => Promise.all(watching.map((id) => api.job(id))),
    enabled: watching.length > 0,
    refetchInterval: 1_000,
  });
  const running = (jobs.data ?? []).some((job) => job.status === "queued" || job.status === "running");

  useEffect(() => {
    // The rows the job wrote are the answer, so the moment it stops the screen re-reads them.
    if (watching.length === 0 || jobs.data === undefined || jobs.data.some((job) => job.status === "queued" || job.status === "running")) return;
    // What the writer actually managed is worth repeating: without an API key it falls back to
    // the free seeded cast and succeeds, and a button that then changes nothing is a lie.
    setTold([...new Set(jobs.data.map((job) => job.error ?? job.progress.label).filter(Boolean))]);
    setWatching([]);
    void queries.invalidateQueries();
  }, [watching, jobs.data, queries]);

  const refresh = async (): Promise<void> => {
    await queries.invalidateQueries();
  };
  const resize = useMutation({ mutationFn: ({ id, size }: { id: string; size: number }) => api.saveCohort(key, id, { size }), onSuccess: refresh });
  const drop = useMutation({ mutationFn: (id: string) => api.removeCohort(key, id), onSuccess: refresh });
  const add = useMutation({
    mutationFn: (personaId: string) => api.createCohort(key, { personaId, size: 1 }),
    onSuccess: async () => {
      setAdding("");
      await refresh();
    },
  });
  const write = useMutation({
    mutationFn: async (ids: string[]) => {
      const started: string[] = [];
      for (const id of ids) started.push((await api.writePeople(key, id)).id);
      return started;
    },
    onSuccess: setWatching,
  });

  if (cohorts.isPending || populations.isPending) return <Loading what="the people" />;
  if (cohorts.isError) return <Failed error={cohorts.error} />;
  if (populations.isError) return <Failed error={populations.error} />;

  const rows = cohorts.data.items;
  const pops = populations.data.items;
  const headcount = rows.reduce((sum, cohort) => sum + cohort.size, 0);
  const unwritten = rows.reduce((sum, cohort) => sum + withoutDetails(cohort), 0);
  const unwrittenIn = rows.filter((cohort) => withoutDetails(cohort) > 0).map((cohort) => cohort.id);
  const writingPrice = priceOfWriting(unwritten, settings.data);
  const perVisit = estimate.data?.perWakeUsd;
  const visitsEach = priced?.visitsPerPerson ?? null;
  const plannedVisits = visitsEach === null ? headcount : headcount * visitsEach;
  // Simulations that send THIS population, not every simulation in the project: one that sends a
  // different set of people is not a use of these.
  const populationId = pops[0]?.id;
  const usedBy = populationId === undefined ? 0 : project.simulations.filter((simulation) => simulation.population.id === populationId).length;
  const available = personas.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="The people"
        lede="Everyone who visits the target, grouped into cohorts. A cohort is N people on one persona; each of them has a name and a life of their own and keeps both between executions."
      />

      {resize.isError ? <Problem>{resize.error.message}</Problem> : null}
      {drop.isError ? <Problem>{drop.error.message}</Problem> : null}
      {write.isError ? <Problem>{write.error.message}</Problem> : null}

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 items-start">
        <div>
          <Section title="Cohorts" sub="click one to meet the people in it">
            {rows.length === 0 ? (
              <Card className="p-4">
                <Empty>No cohorts yet. Take a persona and say how many of them go.</Empty>
              </Card>
            ) : (
              <Card className="divide-y divide-rule">
                {rows.map((cohort) => (
                  <CohortRow
                    key={cohort.id}
                    cohort={cohort}
                    to={href(`library/people/${encodeURIComponent(cohort.slug)}`)}
                    onSize={(size) => resize.mutate({ id: cohort.id, size })}
                    onDrop={() => drop.mutate(cohort.id)}
                    busy={resize.isPending || drop.isPending}
                  />
                ))}
              </Card>
            )}
            <div className="flex items-end gap-2 mt-3">
              <div className="flex-1 max-w-[320px]">
                <Select
                  value={adding}
                  onChange={setAdding}
                  options={[{ value: "", label: "Add a cohort of…" }, ...available.map((persona) => ({ value: persona.id, label: persona.spec.name }))]}
                />
              </div>
              <Button onClick={() => add.mutate(adding)} disabled={adding === "" || add.isPending}>
                Add a cohort
              </Button>
            </div>
            {add.isError ? <Problem>{add.error.message}</Problem> : null}
          </Section>
        </div>

        <div className="sticky top-9">
          {/* "Altogether", not "This population": the bars below are every cohort in the project,
              and there is no switcher yet, so with a second population the panel would be titled
              after one set of people while describing another. */}
          <Section title="Altogether">
            <Card className="p-5">
              <Stat label="People" value={headcount} sub={`${rows.length} ${rows.length === 1 ? "cohort" : "cohorts"}`} />
              <div className="mt-5 flex flex-col gap-2.5">
                {rows.map((cohort) => (
                  <div key={cohort.id}>
                    <div className="flex items-baseline gap-2">
                      <Mono className="text-[11.5px] text-evidence flex-1 truncate">{cohort.slug}</Mono>
                      <span className="t-meta text-ink-muted tabular-nums">{cohort.size}</span>
                    </div>
                    <div className="mt-1">
                      <Bar value={cohort.size} of={Math.max(1, headcount)} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="t-meta text-ink-muted mt-4">
                {pops.length > 1
                  ? `These cohorts are shared out between ${pops.length} populations.`
                  : usedBy === 0
                    ? "No simulation sends them anywhere yet."
                    : `Used by ${usedBy} ${usedBy === 1 ? "simulation" : "simulations"}.`}
              </p>
            </Card>
          </Section>

          <Section title="About what it costs">
            <Card className="p-4">
              {perVisit === undefined ? (
                <p className="t-body text-ink-soft">Nothing has run here yet, so there is no price to work from. The first execution is what teaches this figure.</p>
              ) : (
                <p className="t-body text-ink-soft">
                  {visitsEach === null ? (
                    <>
                      <span className="tabular-nums">{headcount}</span> visits a round → about <span className="tabular-nums">{usd(perVisit * headcount)}</span> each time they all come back.
                    </>
                  ) : (
                    <>
                      {visitsEach} visits each → <span className="tabular-nums">{plannedVisits}</span> visits → about <span className="tabular-nums">{usd(perVisit * plannedVisits)}</span>
                      {estimate.data === undefined ? null : (
                        <>
                          {" "}
                          (between {usd(estimate.data.lowUsd)} and {usd(estimate.data.highUsd)} for the simulation as it stands)
                        </>
                      )}
                      .
                    </>
                  )}{" "}
                  <span className="t-meta text-ink-muted">
                    {estimate.data?.basis === "history" ? `From your last ${estimate.data.sampleSize} visits, at ${usd4(perVisit)} each.` : `From a default, at ${usd4(perVisit)} a visit.`}
                  </span>
                </p>
              )}

              {unwritten > 0 ? (
                <div className="mt-4 border-t border-rule pt-3">
                  <p className="t-body text-ink">
                    {unwritten} of {headcount} {headcount === 1 ? "person has" : "people have"} no written details yet.
                  </p>
                  <p className="t-body text-ink-soft mt-1">
                    They have names and they work exactly as they are. What the model adds is a sentence about each of them, which is what makes twelve first-timers twelve different people rather
                    than one repeated twelve times.
                  </p>
                  <div className="flex items-center gap-3 mt-2">
                    <Button tone="go" onClick={() => write.mutate(unwrittenIn)} disabled={write.isPending || running}>
                      {running ? "Writing them…" : "Have the AI write them"}
                    </Button>
                    {writingPrice === null ? null : <span className="t-meta text-ink-muted">roughly {usd4(writingPrice)}, counted against today's ceiling</span>}
                  </div>
                  {told.map((line, i) => (
                    <p key={i} className="t-meta text-ink-muted mt-2">
                      {line}
                    </p>
                  ))}
                </div>
              ) : null}
            </Card>
          </Section>

          {pops.length > 1 ? (
            <section id="populations" className="mb-8 scroll-mt-8">
              <div className="flex items-baseline gap-3 mb-3">
                <h2 className="t-section">Populations</h2>
                <span className="t-meta text-ink-muted">a simulation sends one of these</span>
              </div>
              <Card className="divide-y divide-rule">
                {pops.map((population) => (
                  <div key={population.id} className="p-3.5 flex items-baseline gap-3">
                    <span className="t-body text-ink flex-1">{population.name}</span>
                    <span className="t-meta text-ink-muted tabular-nums">{people(population.members.reduce((sum, member) => sum + member.count, 0))}</span>
                  </div>
                ))}
              </Card>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}

function CohortRow({ cohort, to, onSize, onDrop, busy }: { cohort: CohortView; to: string; onSize: (size: number) => void; onDrop: () => void; busy: boolean }) {
  return (
    <div className="p-3.5">
      <div className="flex items-baseline gap-3">
        <Link to={to} className="t-body text-ink hover:text-accent">
          {cohort.name}
        </Link>
        <Mono className="text-[11px] text-ink-muted">{cohort.slug}</Mono>
        <span className="flex-1" />
        <span className="t-meta text-ink-muted">{cohort.personaName}</span>
      </div>
      <div className="flex items-center gap-3 mt-2">
        <span className="t-meta text-ink-muted tabular-nums w-20">
          {cohort.size} {cohort.size === 1 ? "person" : "people"}
        </span>
        <Stepper value={cohort.size} onChange={onSize} max={999} />
        <span className="t-meta text-ink-muted flex-1">
          {cohort.cadence?.every === undefined ? "comes back on the simulation's cadence" : `every ${Math.round(cohort.cadence.every / 1000)}s`}
          {withoutDetails(cohort) > 0 ? ` · ${withoutDetails(cohort)} without details` : ""}
        </span>
        <Button onClick={onDrop} disabled={busy} title="Take this cohort out of the population">
          Remove
        </Button>
      </div>
    </div>
  );
}

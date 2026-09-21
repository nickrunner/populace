import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { costOf, priceFor } from "@populace/core/isomorphic";
import { api, type CohortView, type Settings } from "../../api.js";
import { q } from "../../queries.js";
import { useProject } from "../../context.jsx";
import { people, plural } from "../../format.js";
import {
  AlertDialog,
  Button,
  Card,
  CardFooter,
  CohortCapsule,
  CostEstimate,
  costBasisOf,
  Field,
  FieldGrid,
  Inline,
  JobProgress,
  Ledger,
  LedgerRow,
  Link,
  MetaLine,
  MetaSentence,
  Money,
  Mono,
  PageHeader,
  RosterLattice,
  Section,
  Select,
  Skeleton,
  Spacer,
  SplitPage,
  Stack,
  Stat,
  StateBlock,
  Stepper,
  Text,
  WhatWentWrong,
  visitPlanOf,
  type LatticeDot,
  type MetaFact,
  type StateKind,
} from "../../design/index.js";

/**
 * The composition screen (SPEC sketch 4): cohorts on the left, what they add up to on the right.
 *
 * It is ONE screen for two entities on purpose. A population is an ordered set of cohorts, and
 * while there is one of them it is a concept with no payoff — so it stays implicit and unnamed
 * until a second one exists, at which point the switcher appears and the word starts to mean
 * something (SPEC §7.2).
 *
 * **Ported to the design system** — ATOMIC-INVENTORY §6.3, row 18. `SplitPage` owns the split;
 * `grid-cols-[1fr_1fr] gap-6`, `sticky top-9` and `max-w-[320px]` are gone with it, along with
 * the template's own answer to the thing none of those had: below 1000px it stacks with the
 * total **above** the list, which is what a narrow reader wants first.
 *
 * **The bars are gone, because the bar is the people** (DESIGN-SYSTEM §1.2 M4). Each cohort is a
 * `CohortCapsule` — a stadium whose *length* is its headcount, with one dot per person inside
 * it — so the left column is the composition drawn at its own scale rather than a column of
 * proportion bars a reader has to convert back into people. "Altogether" is the same population
 * as one `RosterLattice`: every person in the project, four rows high, at the mark's ratio.
 * Everybody is `provisional`, the grammar's word for *this has not happened yet*, because a cast
 * that has not been sent anywhere has been nowhere (§8.6, and Preflight's own reading of it).
 *
 * **The writer's progress is the `JobProgress` organism** (§6.3 row 18, "two `JobProgress`
 * implementations unify"). They had not: this screen and `Cohort` each kept a local
 * `WritingProgress`, and the two had already drifted on something a reader can see — one hid the
 * meter on `total === 0` and the other on `total === null || total === 0`, one took the first
 * non-empty label across several jobs and the other read a single job's. The organism takes both
 * shapes, and this screen hands it the jobs it started at once.
 *
 * **Removing a cohort is destructive and says so first.** It goes through the same `AlertDialog`
 * that removing a persona does on `Personas`, because it is the same act from the other end: the
 * population lets go, the people are archived, and executions that have already run keep naming
 * them. A `Tooltip` is not a confirmation (§7.4).
 *
 * Nothing here promises what an execution will produce. The estimate is the `CostEstimate`
 * organism, which names its own basis and says outright that it is a range, not a bill
 * (ADR-0028, §7.3).
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

/**
 * One dot per person in a cohort, none of whom has been anywhere yet.
 *
 * Nobody is named here — this screen has the headcount and not the roster, and the cohort's own
 * page is where the names live — so a dot is labelled by the cohort it belongs to. The lattice
 * folds and then gives way to a meter past its ladder's rungs, so a cohort of nine hundred draws
 * as honestly as a cohort of nine.
 */
function castOf(cohort: CohortView): readonly LatticeDot[] {
  return Array.from({ length: cohort.size }, (_, index) => ({
    id: `${cohort.slug}#${String(index)}`,
    state: "provisional" as const,
    label: `somebody in ${cohort.name}`,
  }));
}

/**
 * What removing a cohort actually does, said before it happens.
 *
 * The same act reached from the other end — removing the persona a cohort is drawn from, on
 * `Personas` — has gone through an `AlertDialog` naming the consequence since wave 1, and this
 * end of it had a `Tooltip` and a quiet button. Destructiveness is a property of the act, not of
 * the screen it is pressed on (§7.4), so both ends now say the same thing in the same shape.
 *
 * It promises only what the server does: the population lets go of the cohort, the cohort's people
 * are archived rather than deleted, and executions that have already run keep naming them
 * (`store.deleteCohort` archives; `control.ts` detaches the population first).
 */
function consequence(cohort: CohortView): string {
  if (cohort.size === 0) {
    return `Nobody is in ${cohort.name} today, so nothing else in this project moves. Executions that have already run keep their people, their visits and their findings.`;
  }
  return `${people(cohort.size)} leave the population. They are kept on record, and executions that have already run keep their visits and their findings.`;
}

/** How often this cohort comes back, in words. Zero is the simulation's own cadence. */
function cadenceOf(cohort: CohortView): string {
  return cohort.cadence?.every === undefined
    ? "comes back on the simulation's cadence"
    : `comes back every ${String(Math.round(cohort.cadence.every / 1000))}s`;
}

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

  const rosterError = resize.error ?? drop.error;

  const addErrorId = useId();
  const writeErrorId = useId();

  const state: StateKind | undefined =
    cohorts.isError || populations.isError
      ? "failed"
      : cohorts.isPending || populations.isPending
        ? "loading"
        : undefined;

  const rows = cohorts.data?.items ?? [];
  const pops = populations.data?.items ?? [];
  const headcount = rows.reduce((sum, cohort) => sum + cohort.size, 0);
  const unwritten = rows.reduce((sum, cohort) => sum + withoutDetails(cohort), 0);
  const unwrittenIn = rows.filter((cohort) => withoutDetails(cohort) > 0).map((cohort) => cohort.id);
  const writingPrice = priceOfWriting(unwritten, settings.data);
  const visitsEach = priced?.visitsPerPerson ?? null;
  // Simulations that send THIS population, not every simulation in the project: one that sends a
  // different set of people is not a use of these.
  const populationId = pops[0]?.id;
  const usedBy = populationId === undefined ? 0 : project.simulations.filter((simulation) => simulation.population.id === populationId).length;
  const available = personas.data?.items ?? [];
  const everyone = rows.flatMap(castOf);

  return (
    <SplitPage
      header={
        <PageHeader
          title="The people"
          lede={
            <>
              Everyone who visits the target, grouped into cohorts. A cohort is N people on one
              persona; each of them has a name and a life of their own and keeps both between
              executions.{" "}
              {/*
                Three of this screen's words — cohort, persona, person — divide one job between
                them, and getting the division wrong is the most common way to misread this page.
                The sentence above already explains it in passing; this is where that explanation
                goes on, at a stable anchor, without a second paragraph of chrome on the screen.
              */}
              <Link to="/concepts#cohort">What a cohort owns, and what a persona does</Link>
            </>
          }
          meta={
            rows.length === 0
              ? undefined
              : [
                  { key: "people", node: people(headcount) },
                  { key: "cohorts", node: plural(rows.length, "cohort") },
                  { key: "unwritten", node: unwritten === 0 ? null : `${String(unwritten)} without details` },
                ]
          }
        />
      }
      state={state}
      loading={
        <StateBlock
          kind="loading"
          what="the people"
          skeleton={<Skeleton variant="row" count={4} height={96} label="Reading the people" />}
        />
      }
      error={<StateBlock kind="failed" what="the people" error={cohorts.error ?? populations.error} />}
      left={
        // `trailing` is a FACT on the far right of the rule, never an instruction: a row that
        // opens is an affordance the row itself carries, not a caption above the ledger.
        <Section title="Cohorts" trailing={rows.length === 0 ? undefined : people(headcount)}>
          <Stack gap={6}>
            {rows.length === 0 ? (
              <StateBlock kind="empty" what="the cohorts">
                No cohorts yet. Take a persona and say how many of them go.
              </StateBlock>
            ) : (
              <Ledger>
                {rows.map((cohort, index) => (
                  <CohortRow
                    key={cohort.id}
                    cohort={cohort}
                    ordinal={index + 1}
                    to={href(`library/people/${encodeURIComponent(cohort.slug)}`)}
                    onSize={(size) => {
                      resize.mutate({ id: cohort.id, size });
                    }}
                    onDrop={() => {
                      drop.mutate(cohort.id);
                    }}
                    busy={resize.isPending || drop.isPending}
                  />
                ))}
              </Ledger>
            )}

            {rosterError === null ? null : (
              <WhatWentWrong
                says="Nothing changed. The cohorts above are as they were."
                error={rosterError}
              />
            )}

            <Card>
              <Stack gap={4}>
                <FieldGrid cols={2} align="end">
                  <Field label="Add a cohort" hint="A persona, and how many of them go. They start as one.">
                    {({ id, describedBy, invalid }) => (
                      <Select
                        id={id}
                        describedBy={describedBy}
                        invalid={invalid}
                        value={adding}
                        onChange={setAdding}
                        placeholder="Choose a persona"
                        options={available.map((persona) => ({ value: persona.id, label: persona.spec.name }))}
                      />
                    )}
                  </Field>
                  <Inline gap={2} align="center">
                    <Button
                      variant="primary"
                      onClick={() => {
                        add.mutate(adding);
                      }}
                      disabled={adding === "" || add.isPending}
                      pending={add.isPending}
                      aria-describedby={add.isError ? addErrorId : undefined}
                    >
                      Add a cohort
                    </Button>
                  </Inline>
                </FieldGrid>

                {add.isError ? (
                  <WhatWentWrong id={addErrorId} says="No cohort was added." error={add.error} />
                ) : null}
              </Stack>
            </Card>
          </Stack>
        </Section>
      }
      right={
        <Stack gap={12}>
          {/* "Altogether", not "This population": the lattice below is every cohort in the
              project, and there is no switcher yet, so with a second population the panel
              would be titled after one set of people while describing another. */}
          <Section title="Altogether">
            <Card pad="roomy">
              <Stack gap={6}>
                <Stat label="People" value={headcount} sub={plural(rows.length, "cohort")} />

                {headcount === 0 ? null : (
                  <Stack gap={2} align="start">
                    <RosterLattice
                      dots={everyone}
                      sentence={`${people(headcount)} composed across ${plural(rows.length, "cohort")}, none of them sent anywhere yet.`}
                    />
                    <Text size="ui" tone="muted">
                      {`${people(headcount)} composed across ${plural(rows.length, "cohort")}, none of them sent anywhere yet.`}
                    </Text>
                  </Stack>
                )}

                <MetaSentence>
                  {pops.length > 1
                    ? `These cohorts are shared out between ${String(pops.length)} populations.`
                    : usedBy === 0
                      ? "No simulation sends them anywhere yet."
                      : `Used by ${plural(usedBy, "simulation")}.`}
                </MetaSentence>
              </Stack>
            </Card>
          </Section>

          <Section title="About what it costs">
            <Card>
              {/*
                The fourth of four hand-rolled estimates (§6.3 row 18), and the one that had a
                `basisOf()` verbatim in `Preflight`. The organism says it once. The range is
                left off deliberately: the server's ends are drawn around the population the
                priced simulation sends, and this column counts every cohort in the project — a
                range around the wrong total is worse than no range at all.
              */}
              <CostEstimate
                layout="sentence"
                people={headcount}
                cohorts={rows.length}
                plan={
                  estimate.data === undefined
                    ? visitsEach === null
                      ? { kind: "round" }
                      : { kind: "capped", each: visitsEach }
                    : visitPlanOf(estimate.data, visitsEach)
                }
                basis={costBasisOf(estimate.data)}
              />

              {unwritten === 0 ? null : (
                <CardFooter>
                  <Stack gap={3}>
                    <Text size="read" as="p">
                      {`${String(unwritten)} of ${String(headcount)} ${headcount === 1 ? "person has" : "people have"} no written details yet.`}
                    </Text>
                    <Text size="read" tone="soft" as="p">
                      They have names and they work exactly as they are. What the model adds is
                      a sentence about each of them, which is what makes twelve first-timers
                      twelve different people rather than one repeated twelve times.
                    </Text>

                    <Inline gap={3} align="center" wrap>
                      <Button
                        variant="primary"
                        onClick={() => {
                          write.mutate(unwrittenIn);
                        }}
                        disabled={write.isPending || running}
                        pending={write.isPending}
                        aria-describedby={write.isError ? writeErrorId : undefined}
                      >
                        {running ? "Writing them…" : "Have the AI write them"}
                      </Button>
                      {writingPrice === null ? null : (
                        <Text size="meta" tone="muted">
                          <>
                            roughly <Money usd={writingPrice} precision={4} />, counted against
                            today&rsquo;s ceiling
                          </>
                        </Text>
                      )}
                    </Inline>

                    {watching.length === 0 ? null : (
                      <JobProgress jobs={jobs.data ?? []} label="Writing them" />
                    )}

                    {told.map((line) => (
                      <Text key={line} size="meta" tone="muted" as="p">
                        {line}
                      </Text>
                    ))}

                    {write.isError ? (
                      <WhatWentWrong
                        id={writeErrorId}
                        says="Nobody was written. The cohorts are unchanged."
                        error={write.error}
                      />
                    ) : null}
                  </Stack>
                </CardFooter>
              )}
            </Card>
          </Section>

          {pops.length <= 1 ? null : (
            <Section id="populations" title="Populations" trailing={plural(pops.length, "population")}>
              <Ledger>
                {pops.map((population, index) => (
                  <LedgerRow
                    key={population.id}
                    density="tight"
                    stub={
                      <Text size="meta" tone="muted">
                        {index + 1}
                      </Text>
                    }
                  >
                    <Inline gap={3} align="baseline">
                      <Text size="ui">{population.name}</Text>
                      <Spacer />
                      <Text size="meta" tone="muted">
                        {people(population.members.reduce((sum, member) => sum + member.count, 0))}
                      </Text>
                    </Inline>
                  </LedgerRow>
                ))}
              </Ledger>
            </Section>
          )}
        </Stack>
      }
    />
  );
}

/**
 * One cohort: the capsule you can open, the headcount you can change, and the facts about it.
 *
 * The capsule carries the name, the drawing and the headcount, so the row adds only what the
 * capsule does not know — which persona they are drawn from, what they are called on disk, how
 * often they come back, and how many of them nobody has written yet.
 */
function CohortRow({
  cohort,
  ordinal,
  to,
  onSize,
  onDrop,
  busy,
}: {
  cohort: CohortView;
  ordinal: number;
  to: string;
  onSize: (size: number) => void;
  onDrop: () => void;
  busy: boolean;
}) {
  const unwritten = withoutDetails(cohort);
  const facts: readonly MetaFact[] = [
    { key: "persona", node: cohort.personaName },
    { key: "slug", node: <Mono size="code-sm">{cohort.slug}</Mono> },
    { key: "cadence", node: cadenceOf(cohort) },
    { key: "unwritten", node: unwritten === 0 ? null : `${String(unwritten)} without details` },
  ];

  return (
    <LedgerRow
      stub={
        <Text size="meta" tone="muted">
          {ordinal}
        </Text>
      }
    >
      <Stack gap={3}>
        <Inline gap={3} align="center" wrap>
          <CohortCapsule name={cohort.name} dots={castOf(cohort)} total={cohort.size} to={to} />
          <Spacer />
          <Stepper label={`People in ${cohort.name}`} value={cohort.size} onChange={onSize} max={999} />
          <AlertDialog
            title={`Remove ${cohort.name}?`}
            body={consequence(cohort)}
            confirmLabel="Remove this cohort"
            onConfirm={onDrop}
            trigger={
              <Button variant="quiet" size="sm" disabled={busy}>
                Remove
              </Button>
            }
          />
        </Inline>

        <MetaLine facts={facts} />
      </Stack>
    </LedgerRow>
  );
}

import { useId, useState, type SyntheticEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, type PopulationView } from "../api.js";
import { q } from "../queries.js";
import { useProject } from "../context.jsx";
import { people, plural } from "../format.js";
import {
  ActionBar,
  Card,
  CohortCapsule,
  DocumentPage,
  Field,
  FieldError,
  FieldGrid,
  Input,
  Link,
  MetaSentence,
  Money,
  Mono,
  NumberInput,
  PageHeader,
  PayloadBlock,
  Radio,
  RadioGroup,
  Section,
  Skeleton,
  Stack,
  Stat,
  StatGroup,
  StateBlock,
  Text,
  type LatticeDot,
  type StateKind,
} from "../design/index.js";

/**
 * Four decisions on one page: what it is called, how it runs, who goes, and where they go
 * (SPEC §7.6).
 *
 * **Ported to the design system** — ATOMIC-INVENTORY §6.3, row 16. The screen used to spell the
 * same act — *pick one of these* — four different ways: two button-cards at `p-4 rounded-lg` for
 * the mode, and two columns of bare `<input type="radio">` at `p-3.5` for the population and the
 * target, none of which was a group a keyboard or a screen reader could see. All four are now one
 * `RadioGroup` of `Radio`s at one size, so the choice that changes what the results mean and the
 * choice of which target to visit look like what they are: the same kind of decision.
 *
 * The mode keeps its own words, including the sentence that refuses to promise a repeatable
 * outcome (§7.3): two executions of one ephemeral simulation disagree by design, and what is
 * compared between them is which problems came back, never the numbers.
 *
 * The arithmetic at the foot stops being a run-on sentence and becomes the same three figures
 * `Preflight` shows, with the price naming its own basis underneath — including the honest case
 * where there is no basis at all because nothing has run on this machine yet.
 *
 * **It commits, so the foot is an `ActionBar` and the template is `DocumentPage`.** `FormPage`
 * mounts a `SaveBar`, and a save bar is about a record that already exists: given one, this page
 * opened saying *"Nothing changed yet"*, changed to *"Unsaved changes"* as it was filled in, and
 * offered *"Save changes"* for an act that makes a simulation which did not exist a moment ago.
 * Every one of those words was wrong. `ActionBar` names the act instead — **Make it**, the verb
 * this screen has always used — and where it cannot happen yet it says why, out loud, rather
 * than holding a button for a reason the reader has to guess at. The form itself is still a
 * form: Enter in the name field commits it, exactly as it would have through `FormPage`.
 *
 * Making a simulation spends nothing. The question that does — "Send them in" — belongs to
 * `Preflight`, which is where this page sends the reader next, and nothing here promises what an
 * execution will find (§7.3).
 */

/** A population's headcount is the sum of its cohorts; there is no second multiplier (ADR-0029). */
function headcountOf(population: PopulationView): number {
  return population.members.reduce((sum, member) => sum + member.count, 0);
}

/**
 * One dot per person in a cohort, all of them `provisional` — the mark's own word for *this has
 * not happened yet* (§8.6), which is the only honest drawing of a cast that has not been cast.
 * Nobody here has a name yet, so a dot stands for somebody in this cohort rather than a number.
 */
function castOf(member: PopulationView["members"][number]): readonly LatticeDot[] {
  return Array.from({ length: member.count }, (_, index) => ({
    id: `${member.cohortId}#${String(index)}`,
    state: "provisional" as const,
    label: `somebody in ${member.cohortName}`,
  }));
}

/** What the price is a price *of*, said out loud rather than implied by a dollar sign. */
function basisOf(
  estimate: { basis: "history" | "default"; sampleSize: number } | undefined,
  bounded: boolean,
): string {
  if (estimate === undefined) {
    return "Nothing has run on this machine yet, so there is no price to work from. The ceilings in settings are what stop an execution, whatever any arithmetic says.";
  }
  const from =
    estimate.basis === "history"
      ? `Priced from the last ${plural(estimate.sampleSize, "visit")} this machine ran.`
      : "Priced from a default, because nothing has been visited on this machine yet.";
  return bounded
    ? `${from} What each person actually does varies between executions, so treat it as a range rather than a bill.`
    : `${from} Nothing caps the visits, so this is a rate rather than a total.`;
}

export function NewSimulation() {
  const { key, project, href } = useProject();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const populations = useQuery(q.populations(key));
  const targets = useQuery(q.targets(key));

  const [name, setName] = useState("");
  const [bounded, setBounded] = useState(true);
  const [visits, setVisits] = useState(4);
  const [populationId, setPopulationId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const errorId = useId();

  // The per-visit price is history over this machine's own visits and has nothing to do with which
  // population goes, so an existing simulation's estimate is the right source for a simulation
  // that does not exist yet. Without one, the arithmetic is honest about being only a headcount.
  const priced = project.simulations[0];
  const estimate = useQuery({ ...q.estimate(key, priced?.slug ?? ""), enabled: priced !== undefined });

  const create = useMutation({
    mutationFn: () =>
      api.createSimulation(key, {
        name: name.trim(),
        visitsPerPerson: bounded ? visits : null,
        ...(populationId === null ? {} : { populationId }),
        ...(targetId === null ? {} : { targetId }),
      }),
    onSuccess: async (simulation) => {
      await queries.invalidateQueries();
      void navigate(`${href()}/s/${encodeURIComponent(simulation.slug)}/preflight`);
    },
  });

  const pops = populations.data?.items ?? [];
  const tgts = targets.data?.items ?? [];
  const chosenPopulation = populationId ?? pops[0]?.id ?? "";
  const chosenTarget = targetId ?? tgts[0]?.id ?? "";
  const population = pops.find((option) => option.id === chosenPopulation);
  const headcount = population === undefined ? 0 : headcountOf(population);
  const plannedVisits = bounded ? headcount * visits : headcount;
  const perVisit = estimate.data?.perWakeUsd;
  const billed = bounded ? plannedVisits : headcount;

  const state: StateKind | undefined =
    populations.isError || targets.isError
      ? "failed"
      : populations.isPending || targets.isPending
        ? "loading"
        : undefined;

  /**
   * Why it cannot be made yet, in a sentence, or `undefined` when nothing is stopping it. A held
   * button that gives no reason is the bug this replaces: with a population and a target chosen
   * and no name typed, the old bar simply went dead (§1.2 — a disabled control is a colour, and
   * the sentence beside it is what carries the reason).
   */
  const blockedBecause: string | undefined =
    pops.length === 0
      ? "There is no population to send yet. Compose one in the library first."
      : tgts.length === 0
        ? "There is nowhere to send them yet. Add a target in the library first."
        : name.trim() === ""
          ? "Give it a name first — it is what you will look for in the list."
          : undefined;

  const make = (): void => {
    if (blockedBecause !== undefined || create.isPending) return;
    create.mutate();
  };

  // Enter in the name field makes it, so the act has a keyboard route that does not depend on
  // reaching the bar.
  const submit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    make();
  };

  return (
    <DocumentPage
      header={
        <PageHeader
          title="New simulation"
          crumbs={[{ label: "Simulations", to: href() }, { label: "New simulation" }]}
          lede="A simulation is a population, a target, and a way of running them. Everything here can be changed afterwards; only starting it spends anything."
        />
      }
      state={state}
      loading={
        <StateBlock
          kind="loading"
          what="what you have to run"
          skeleton={
            <Skeleton
              variant="block"
              count={3}
              height={120}
              label="Reading what you have to run"
            />
          }
        />
      }
      error={
        <StateBlock
          kind="failed"
          what="what you have to run"
          error={populations.isError ? populations.error : targets.error}
        />
      }
    >
      <form onSubmit={submit} noValidate className="pb-8">
        <Stack gap={12}>
          {create.isError ? (
            <Stack gap={2}>
              <FieldError id={errorId}>
                Nothing was made, and nothing has been spent. The machine&rsquo;s own words are
                below.
              </FieldError>
              <PayloadBlock caption="What came back" value={create.error.message} error />
            </Stack>
          ) : null}

          <Section title="What to call it">
            <Card>
              <Field
                label="Name"
                hint="What you will look for in the list. “Smoke: first-timers”, “Long haul”, “Mobile only”."
              >
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    describedBy={describedBy}
                    invalid={invalid}
                    value={name}
                    onChange={setName}
                    placeholder="Smoke: first-timers"
                  />
                )}
              </Field>
            </Card>
          </Section>

          {/* "How they visit", the same words `Get started` uses for the same decision: one
              decision has one name (§7.1). The group's legend is hidden because this caption is
              immediately above it and already says it — which is the one rule `legendHidden`
              exists for, and not a second convention. */}
          <Section title="How they visit">
            <Stack gap={4}>
              <Text size="read-sm" tone="soft" as="p">
                The one choice here that changes what the results mean.{" "}
                {/*
                  The two radio hints below say what each mode does here; this goes to the page
                  that says what the pair of words means, under a stable anchor. It is the one
                  decision on this screen a reader can get wrong without finding out for a
                  fortnight, so it is the one that earns a way out to a longer answer.
                */}
                <Link to="/concepts#modes">Ephemeral and longitudinal, in full</Link>
              </Text>

              <Card>
                <RadioGroup
                  name="mode"
                  legend="How they visit"
                  legendHidden
                  value={bounded ? "ephemeral" : "longitudinal"}
                  onChange={(next) => {
                    setBounded(next === "ephemeral");
                  }}
                >
                  <Radio
                    value="ephemeral"
                    label="Ephemeral — a clean slate, and an end"
                    hint="Everyone arrives remembering nothing, makes a set number of visits, and is finished. Run it again later and the two executions are independent of each other: they will not agree exactly — different people try different things — so what is compared between them is which problems came back, not the numbers."
                  />
                  <Radio
                    value="longitudinal"
                    label="Longitudinal — they keep coming back"
                    hint="Memory accumulates: someone who was annoyed on visit two is still annoyed on visit nine. It has no end — you pause it, and it picks back up where it stopped. This is the one that finds what only shows up after a week of use."
                  />
                </RadioGroup>
              </Card>

              {bounded ? (
                <Card>
                  <FieldGrid cols={3}>
                    <Field
                      label="Visits each"
                      hint="How many times each person comes back before they are done."
                    >
                      {({ id, describedBy, invalid }) => (
                        <NumberInput
                          id={id}
                          describedBy={describedBy}
                          invalid={invalid}
                          value={visits}
                          onChange={setVisits}
                          min={1}
                        />
                      )}
                    </Field>
                  </FieldGrid>
                </Card>
              ) : null}
            </Stack>
          </Section>

          <Section title="Who goes" trailing={population === undefined ? undefined : people(headcount)}>
            <Stack gap={6}>
              <Card>
                {pops.length === 0 ? (
                  <StateBlock kind="empty" what="this project">
                    No population has been composed yet, so there is nobody to send. Compose one in
                    the library first.
                  </StateBlock>
                ) : (
                  <RadioGroup
                    name="population"
                    legend="Who goes"
                    legendHidden
                    value={chosenPopulation}
                    onChange={setPopulationId}
                  >
                    {pops.map((option) => (
                      <Radio
                        key={option.id}
                        value={option.id}
                        label={option.name}
                        hint={`${people(headcountOf(option))} · ${plural(option.members.length, "cohort")}`}
                      />
                    ))}
                  </RadioGroup>
                )}
              </Card>

              {population === undefined || population.members.length === 0 ? null : (
                <Stack gap={4}>
                  <Text size="read-sm" tone="soft" as="p">
                    By cohort — nobody has been anywhere yet, so every person in it is drawn as
                    somebody who has not arrived.
                  </Text>

                  {population.members.map((member) => (
                    <CohortCapsule
                      key={member.cohortId}
                      name={member.cohortName}
                      dots={castOf(member)}
                      total={member.count}
                    />
                  ))}
                </Stack>
              )}
            </Stack>
          </Section>

          <Section title="Where they go">
            <Stack gap={4}>
              <Card>
                {tgts.length === 0 ? (
                  <StateBlock kind="empty" what="this project">
                    No target has been added yet, so there is nowhere to send anybody. Add one in
                    the library first.
                  </StateBlock>
                ) : (
                  <RadioGroup
                    name="target"
                    legend="Where they go"
                    legendHidden
                    value={chosenTarget}
                    onChange={setTargetId}
                  >
                    {tgts.map((option) => (
                      <Radio
                        key={option.id}
                        value={option.id}
                        label={option.name}
                        hint={<Mono size="code-sm">{option.mcp[0]?.url}</Mono>}
                      />
                    ))}
                  </RadioGroup>
                )}
              </Card>

              <MetaSentence>
                Whether it answers, and whether it can be put back the way it was, is checked on
                “Before you send them” — asking costs a connection to somebody else&rsquo;s server.
              </MetaSentence>
            </Stack>
          </Section>

          <Section title="What it comes to">
            <Stack gap={4}>
              <StatGroup cols={3} ruled>
                <Stat
                  label="People going"
                  value={headcount}
                  sub={
                    population === undefined
                      ? "no population chosen"
                      : plural(population.members.length, "cohort")
                  }
                />
                <Stat
                  label="Visits planned"
                  value={plannedVisits}
                  sub={bounded ? "and then it stops" : "a round; nothing caps it but you"}
                />
                <Stat
                  label="Expected cost"
                  value={perVisit === undefined ? "—" : <Money usd={perVisit * billed} />}
                  sub={
                    perVisit === undefined ? (
                      "no price to work from yet"
                    ) : (
                      <>
                        at <Money usd={perVisit} precision={4} /> a visit
                      </>
                    )
                  }
                />
              </StatGroup>

              <MetaSentence>{basisOf(estimate.data, bounded)}</MetaSentence>
            </Stack>
          </Section>
        </Stack>
      </form>

      <ActionBar
        label="Make it"
        onAct={make}
        pending={create.isPending}
        blockedBecause={blockedBecause}
        note="Making it spends nothing. It takes you to “Before you send them”, and that is where anything is spent."
      />
    </DocumentPage>
  );
}

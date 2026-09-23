import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import { api, type CohortView, type PopulationView } from "../../api.js";
import { q } from "../../queries.js";
import { useProject } from "../../context.jsx";
import { people, plural } from "../../format.js";
import {
  Button,
  Checkbox,
  DocumentPage,
  Ledger,
  LedgerRow,
  Link,
  MetaLine,
  Mono,
  PageHeader,
  PayloadBlock,
  Section,
  Spacer,
  Stack,
  Stat,
  StateBlock,
  Stepper,
  Text,
  VisuallyHidden,
  type MetaFact,
  type StateKind,
} from "../../design/index.js";

/**
 * One population: which cohorts go, and how many of each.
 *
 * **This is where the number lives** (ADR-0039). A cohort has no size of its own — it is a shared
 * condition and a mix of personas — so the headcount is set here, per cohort, and setting it is
 * what writes the people: tick a cohort and it is sent at one person; raise the stepper and the
 * roster grows to meet it. Every tick and every step is one `PUT { members }`, which is
 * authoritative: what is not in the array is taken out, so one route is add, resize and remove
 * and there is no save bar to forget to press.
 *
 * The per-persona split under each row is the server's own apportionment — the same arithmetic
 * the next execution expands — so "at 10 people, that is 6 first-timers and 4 power users" is a
 * fact about what will be sent, not a screen's estimate of it.
 *
 * **What is deliberately NOT here.** A visit cap, a cadence and a seed used to be on this record.
 * They are gone (see `PopulationInputSchema`): the cap decides a simulation's MODE (ADR-0030) and
 * belongs on the simulation, the cadence and the seed belong to the cohort. A screen that edits a
 * cast should not be able to flip three simulations from ephemeral to longitudinal.
 *
 * **The slug is shown and never editable.** It is the FIRST segment of every agent id
 * (`populationSlug/cohortSlug.personaSlug#ordinal`), so renaming it orphans the memory of every
 * person who has ever run under it and silently empties a `--continue-from`.
 *
 * **Taking a cohort out does not delete it.** A cohort is the people; the same cohort in two
 * populations is the same individuals, up to the smaller size. Out of this cast, still in the
 * library, still in every other cast that holds it.
 */
export function PopulationEditor() {
  const { pop = "" } = useParams();
  const { key, project, href } = useProject();
  const queries = useQueryClient();

  const populations = useQuery(q.populations(key));
  const cohorts = useQuery(q.cohorts(key));

  const population = populations.data?.items.find((p) => p.id === pop || p.slug === pop);
  const all = cohorts.data?.items ?? [];
  const held = new Map(population?.members.map((m) => [m.cohortId, m]) ?? []);

  const compose = useMutation({
    mutationFn: (members: readonly { cohortId: string; size: number }[]) =>
      api.savePopulation(key, population?.id ?? "", { members: [...members] }),
    onSuccess: () => queries.invalidateQueries(),
  });

  const current = (): { cohortId: string; size: number }[] => population?.members.map((m) => ({ cohortId: m.cohortId, size: m.size })) ?? [];

  const toggle = (cohort: CohortView): void => {
    if (population === undefined) return;
    // The population's own order is kept, and a newly ticked cohort goes on the end — which is
    // the order the reader put it in rather than whatever order the library happens to list.
    const next = held.has(cohort.id) ? current().filter((m) => m.cohortId !== cohort.id) : [...current(), { cohortId: cohort.id, size: 1 }];
    compose.mutate(next);
  };

  const resize = (cohort: CohortView, size: number): void => {
    if (population === undefined) return;
    compose.mutate(current().map((m) => (m.cohortId === cohort.id ? { cohortId: cohort.id, size } : m)));
  };

  const state: StateKind | undefined =
    populations.isPending || cohorts.isPending
      ? "loading"
      : populations.isError || cohorts.isError
        ? "failed"
        : population === undefined
          ? "gone"
          : undefined;

  const headcount = population?.people ?? 0;
  const runBy = project.simulations.filter((s) => s.population.id === population?.id);

  return (
    <DocumentPage
      header={
        <PageHeader
          title={population?.name ?? "This population"}
          lede="Which cohorts go, and how many of each. Setting the number is what makes the people. A simulation pairs this cast with a target; the same cast can be sent at as many targets as you keep."
          crumbs={[
            { label: "Populations", to: href("library/populations") },
            { label: population?.name ?? pop },
          ]}
        />
      }
      state={state}
      loading={<StateBlock kind="loading" what="this population" />}
      error={
        <StateBlock
          kind="failed"
          what="this population"
          error={populations.error ?? cohorts.error}
        >
          <Button
            variant="secondary"
            onClick={() => {
              void populations.refetch();
            }}
          >
            Try again
          </Button>
        </StateBlock>
      }
      gone={
        <StateBlock kind="gone" what="this population">
          <Stack gap={6} align="start">
            <div>There is no population called {pop} in this project.</div>
            <Button asChild variant="primary">
              <Link to={href("library/populations")}>See the populations there are</Link>
            </Button>
          </Stack>
        </StateBlock>
      }
    >
      {population === undefined ? null : (
        <Stack gap={8}>
          <Section title="What it adds up to">
            <Stack gap={4}>
              <Stat
                label="People in this cast"
                value={headcount}
                sub={byPersona(population)}
                foot={
                  <Mono size="code-sm" tone="muted">
                    {population.slug}
                  </Mono>
                }
              />
              <Text size="read-sm" tone="soft" as="p">
                {runBy.length === 0
                  ? "No simulation runs this cast yet."
                  : `Run by ${runBy.map((s) => s.name).join(", ")}. A change here is what the next execution sends; one already running froze its own plan when it started.`}
              </Text>
            </Stack>
          </Section>

          <Section
            title="Who goes, and how many"
            trailing={`${people(headcount)} in ${plural(population.members.length, "cohort")}`}
            actions={<Link to={href("library/cohorts")}>Cut a new cohort</Link>}
          >
            {all.length === 0 ? (
              <StateBlock kind="empty" what="this project's cohorts">
                There are no cohorts to put in it. A cohort is people who share something, drawn
                from one or more personas.{" "}
                <Link to={href("library/cohorts")} size="ui">
                  Cut one
                </Link>
              </StateBlock>
            ) : (
              <Ledger>
                {all.map((cohort) => {
                  const member = held.get(cohort.id);
                  return (
                    <LedgerRow
                      key={cohort.id}
                      stub={
                        <Checkbox
                          checked={member !== undefined}
                          onChange={() => {
                            toggle(cohort);
                          }}
                          /*
                            The name is beside the box in the row, not in the label, so the label is
                            for a screen reader alone — and it says what the tick will DO rather
                            than repeating the cohort's name, which the row already carries.
                          */
                          label={
                            <VisuallyHidden>
                              {member === undefined ? "Send" : "Stop sending"} {cohort.name}{" "}
                              {member === undefined ? "from" : "in"} {population.name}
                            </VisuallyHidden>
                          }
                        />
                      }
                    >
                      <Stack gap={2}>
                        <Stack gap={1}>
                          <Text size="name" as="div">
                            <Link to={href(`library/cohorts/${encodeURIComponent(cohort.slug)}`)}>
                              {cohort.name}
                            </Link>
                          </Text>
                          <Text size="read-sm" tone="soft" as="p">
                            {cohort.context}
                          </Text>
                        </Stack>
                        {member === undefined ? (
                          <MetaLine facts={[{ key: "mix", node: mixSentence(cohort) }, { key: "elsewhere", node: elsewhere(cohort, population) }]} />
                        ) : (
                          <Stack gap={2}>
                            <Stepper
                              label={`How many of ${cohort.name} go in ${population.name}`}
                              value={member.size}
                              onChange={(size) => {
                                resize(cohort, size);
                              }}
                              min={1}
                              max={999}
                            />
                            <MetaLine facts={splitFacts(member, cohort, population)} />
                          </Stack>
                        )}
                        <Spacer />
                      </Stack>
                    </LedgerRow>
                  );
                })}
              </Ledger>
            )}
          </Section>

          {compose.isError ? (
            <PayloadBlock caption="It was not changed" value={compose.error.message} error />
          ) : null}
        </Stack>
      )}
    </DocumentPage>
  );
}

/** "3 First-time visitor : 2 Power user", or "on First-time visitor" for a mix of one. */
function mixSentence(cohort: CohortView): string {
  if (cohort.mix.length === 1) return `on ${cohort.mix[0]?.personaName ?? ""}`;
  return cohort.mix.map((entry) => `${String(entry.weight)} ${entry.personaName}`).join(" : ");
}

/** The whole cast by persona, summed across its cohorts: "6 first-timers, 4 power users". */
function byPersona(population: PopulationView): string {
  const totals = new Map<string, number>();
  for (const member of population.members) for (const persona of member.personas) totals.set(persona.name, (totals.get(persona.name) ?? 0) + persona.count);
  const parts = [...totals].filter(([, n]) => n > 0).map(([name, n]) => `${String(n)} ${name}`);
  return parts.length === 0 ? plural(population.members.length, "cohort") : parts.join(", ");
}

/** A cohort in two casts is the SAME people up to the smaller size — worth saying on the row that offers to take it out of one. */
function elsewhere(cohort: CohortView, population: PopulationView): string {
  const others = cohort.usedByPopulations.filter((p) => p.id !== population.id);
  return others.length === 0 ? "in no other cast" : `also in ${others.map((p) => `${p.name} (${people(p.size)})`).join(", ")}`;
}

/** What a member's size comes to, persona by persona — the server's own apportionment. */
function splitFacts(member: PopulationView["members"][number], cohort: CohortView, population: PopulationView): readonly MetaFact[] {
  const split = member.personas.map((persona) => `${String(persona.count)} ${persona.name}`).join(", ");
  const nobody = member.personas.filter((persona) => persona.count === 0).map((persona) => persona.name);
  return [
    { key: "split", node: member.personas.length > 1 ? split : null },
    { key: "nobody", node: nobody.length === 0 ? null : `${nobody.join(", ")} get nobody at this size` },
    { key: "elsewhere", node: elsewhere(cohort, population) },
  ];
}

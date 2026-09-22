import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import { api, type CohortView } from "../../api.js";
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
  Stack,
  Stat,
  StateBlock,
  Text,
  VisuallyHidden,
  type StateKind,
} from "../../design/index.js";

/**
 * One population: which cohorts are in the cast, and in what order.
 *
 * **Ticking, not a form.** A population is composition and nothing else (ADR-0029), so the only
 * thing to edit here is membership — and membership is a set, so the control is a checkbox per
 * cohort in the project. Each tick is one `PUT { cohortIds }`, which is authoritative: what is
 * not in the array is taken out. One route is both the add and the remove, and there is no save
 * bar to forget to press.
 *
 * **What is deliberately NOT here.** A visit cap, a cadence and a seed used to be on this record.
 * They are gone (see `PopulationInputSchema`): the cap decides a simulation's MODE (ADR-0030) and
 * belongs on the simulation, the cadence and the seed belong to the cohort. A screen that edits a
 * cast should not be able to flip three simulations from ephemeral to longitudinal.
 *
 * **The slug is shown and never editable.** It is the FIRST segment of every agent id
 * (`populationSlug/cohortSlug#ordinal`), so renaming it orphans the memory of every person who
 * has ever run under it and silently empties a `--continue-from`. Reading it here is useful —
 * it is what a trace will say — and changing it is not on offer.
 *
 * **Taking a cohort out does not delete it.** A cohort is the people; the same cohort in two
 * populations is the same individuals. Out of this cast, still in the library, still in every
 * other cast that holds it.
 */
export function PopulationEditor() {
  const { pop = "" } = useParams();
  const { key, project, href } = useProject();
  const queries = useQueryClient();

  const populations = useQuery(q.populations(key));
  const cohorts = useQuery(q.cohorts(key));

  const population = populations.data?.items.find((p) => p.id === pop || p.slug === pop);
  const all = cohorts.data?.items ?? [];
  const held = new Set(population?.members.map((m) => m.cohortId) ?? []);

  const compose = useMutation({
    mutationFn: (cohortIds: readonly string[]) =>
      api.savePopulation(key, population?.id ?? "", { cohortIds: [...cohortIds] }),
    onSuccess: () => queries.invalidateQueries(),
  });

  const toggle = (cohort: CohortView): void => {
    if (population === undefined) return;
    // The population's own order is kept, and a newly ticked cohort goes on the end — which is
    // the order the reader put it in rather than whatever order the library happens to list.
    const next = held.has(cohort.id)
      ? population.members.filter((m) => m.cohortId !== cohort.id).map((m) => m.cohortId)
      : [...population.members.map((m) => m.cohortId), cohort.id];
    compose.mutate(next);
  };

  const state: StateKind | undefined =
    populations.isPending || cohorts.isPending
      ? "loading"
      : populations.isError || cohorts.isError
        ? "failed"
        : population === undefined
          ? "gone"
          : undefined;

  const headcount = population?.members.reduce((n, m) => n + m.count, 0) ?? 0;
  const runBy = project.simulations.filter((s) => s.population.id === population?.id);

  return (
    <DocumentPage
      header={
        <PageHeader
          title={population?.name ?? "This population"}
          lede="Who is in the cast. A simulation pairs it with a target; the same cast can be sent at as many targets as you keep."
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
                sub={`${population.members.length} of ${plural(all.length, "cohort")} in the project`}
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
            title="Who is in it"
            trailing={`${people(headcount)} in ${plural(population.members.length, "cohort")}`}
            actions={<Link to={href("library/cohorts")}>Cut a new cohort</Link>}
          >
            {all.length === 0 ? (
              <StateBlock kind="empty" what="this project's cohorts">
                There are no cohorts to put in it. A cohort is N people cut from one persona.{" "}
                <Link to={href("library/personas")} size="ui">
                  Pick who visits
                </Link>
              </StateBlock>
            ) : (
              <Ledger>
                {all.map((cohort) => (
                  <LedgerRow
                    key={cohort.id}
                    stub={
                      <Checkbox
                        checked={held.has(cohort.id)}
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
                            {held.has(cohort.id) ? "Take" : "Put"} {cohort.name}{" "}
                            {held.has(cohort.id) ? "out of" : "in"} {population.name}
                          </VisuallyHidden>
                        }
                      />
                    }
                  >
                    <Stack gap={1}>
                      <Text size="name" as="div">
                        <Link to={href(`library/cohorts/${encodeURIComponent(cohort.slug)}`)}>
                          {cohort.name}
                        </Link>
                      </Text>
                      <MetaLine
                        facts={[
                          { key: "size", node: people(cohort.size) },
                          { key: "persona", node: `on ${cohort.personaName}` },
                          {
                            key: "elsewhere",
                            // A cohort in two casts is the SAME people, which is the whole reason
                            // a cohort is reusable and worth saying on the row that offers to
                            // take it out of one of them.
                            node:
                              cohort.usedByPopulations.length > 1
                                ? `also in ${cohort.usedByPopulations
                                    .filter((p) => p.id !== population.id)
                                    .map((p) => p.name)
                                    .join(", ")}`
                                : "only in this cast",
                          },
                        ]}
                      />
                    </Stack>
                  </LedgerRow>
                ))}
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

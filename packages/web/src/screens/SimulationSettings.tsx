import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api.js";
import { q } from "../queries.js";
import { useProject, useSimulation } from "../context.jsx";
import { people, plural } from "../format.js";
import {
  Field,
  FieldGrid,
  FieldError,
  FormPage,
  Input,
  NumberInput,
  PageHeader,
  PayloadBlock,
  Radio,
  RadioGroup,
  Section,
  Select,
  Stack,
  Text,
} from "../design/index.js";

/**
 * What one simulation is: its name, the pairing it stands for, and how the people visit.
 *
 * **Why this screen had to exist before anything else could be removed.** A simulation's mode is
 * an ADR-0030 property of the simulation — ephemeral means a clean slate and a bounded end,
 * longitudinal means it accumulates and is unbounded — and it is decided by the visit cap:
 * a number is ephemeral, null is longitudinal. Until now the only two places in the browser that
 * could set that cap were `NewSimulation`, which runs once at creation, and the **Settings**
 * screen's population block, which wrote it to the project's settings row and then fanned it onto
 * every simulation running that population.
 *
 * That fan-out is gone, for a reason recorded on `PopulationInputSchema`: a population is
 * composition and nothing else, and editing one could flip several simulations between ephemeral
 * and longitudinal from a screen that never says the word mode. But removing it without putting
 * this screen in its place would have left a wrong mode fixable only by deleting the simulation
 * and making it again. So this lands with that removal, not after it.
 *
 * **Re-pointing is allowed, and it is the point of a project holding several of each.** A
 * simulation is the pairing of one target and one population; changing either is how "run the
 * same cast at qa" happens without composing anything twice. What it does NOT do is reach a
 * running execution: a run froze its config when it started (ADR-0025), so an edit here is what
 * the NEXT execution will do, and the screen says so rather than leaving it to be discovered.
 *
 * Nothing here promises what an execution will find (§7.3).
 */
export function SimulationSettings() {
  const { key, href: projectHref } = useProject();
  const { key: sim, simulation, href } = useSimulation();
  const queries = useQueryClient();

  const targets = useQuery(q.targets(key));
  const populations = useQuery(q.populations(key));

  const [name, setName] = useState(simulation.name);
  const [targetId, setTargetId] = useState(simulation.target.id);
  const [populationId, setPopulationId] = useState(simulation.population.id);
  const [bounded, setBounded] = useState(simulation.visitsPerPerson !== null);
  const [visits, setVisits] = useState(simulation.visitsPerPerson ?? 4);

  // The row is the source of truth; a save that lands elsewhere (the daemon, another tab) should
  // move this form rather than leave it holding a stale draft it will overwrite.
  useEffect(() => {
    setName(simulation.name);
    setTargetId(simulation.target.id);
    setPopulationId(simulation.population.id);
    setBounded(simulation.visitsPerPerson !== null);
    if (simulation.visitsPerPerson !== null) setVisits(simulation.visitsPerPerson);
  }, [simulation]);

  const dirty =
    name !== simulation.name ||
    targetId !== simulation.target.id ||
    populationId !== simulation.population.id ||
    bounded !== (simulation.visitsPerPerson !== null) ||
    (bounded && visits !== simulation.visitsPerPerson);

  const save = useMutation({
    mutationFn: () =>
      api.saveSimulation(key, sim, {
        name: name.trim() || simulation.name,
        targetId,
        populationId,
        visitsPerPerson: bounded ? visits : null,
      }),
    onSuccess: async () => {
      await queries.invalidateQueries();
    },
  });

  const running = simulation.status === "running" || simulation.status === "paused";

  return (
    <FormPage
      header={
        <PageHeader
          title="This simulation"
          lede="What it is pointed at, who goes, and how they visit. It takes effect on the next execution."
          crumbs={[
            { label: "Simulations", to: projectHref() },
            { label: simulation.name, to: href() },
            { label: "Settings" },
          ]}
        />
      }
      dirty={dirty}
      saving={save.isPending}
      onSave={() => {
        save.mutate();
      }}
      savedAt={null}
    >
      <Stack gap={8}>
        {save.isError ? (
          <Stack gap={2}>
            <FieldError id="simulation-save-error">Nothing was saved.</FieldError>
            <PayloadBlock caption="What came back" value={save.error.message} error />
          </Stack>
        ) : null}

        {running ? (
          <Text size="read" tone="soft" as="p">
            An execution is going right now. It froze its configuration when it started, so nothing
            here reaches it — what you change is what the next one does.
          </Text>
        ) : null}

        <Section title="What it is">
          <FieldGrid cols={2}>
            <Field label="Call it">
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={name}
                  onChange={setName}
                />
              )}
            </Field>
          </FieldGrid>
        </Section>

        <Section
          title="The pairing"
          /* The one sentence that says why a project holds several of each. */
        >
          <Stack gap={4}>
            <Text size="read-sm" tone="soft" as="p">
              A simulation is one target and one population. Re-pointing either is how the same
              cast goes at dev and at qa without being composed twice.
            </Text>
            <FieldGrid cols={2}>
              <Field label="Where they go">
                {({ id, describedBy, invalid }) => (
                  <Select
                    id={id}
                    describedBy={describedBy}
                    invalid={invalid}
                    value={targetId}
                    onChange={setTargetId}
                    options={(targets.data?.items ?? []).map((target) => ({
                      value: target.id,
                      label: target.name,
                    }))}
                  />
                )}
              </Field>
              <Field label="Who goes">
                {({ id, describedBy, invalid }) => (
                  <Select
                    id={id}
                    describedBy={describedBy}
                    invalid={invalid}
                    value={populationId}
                    onChange={setPopulationId}
                    options={(populations.data?.items ?? []).map((population) => ({
                      value: population.id,
                      label: `${population.name} — ${people(population.members.reduce((n, m) => n + m.count, 0))} in ${plural(population.members.length, "cohort")}`,
                    }))}
                  />
                )}
              </Field>
            </FieldGrid>
          </Stack>
        </Section>

        <Section title="How they visit">
          <Stack gap={4}>
            {/*
              The two mode cards, in the same words as `NewSimulation` and the first-run panel —
              one decision, one name (§7.1). The cap IS the mode (ADR-0030): a number ends the
              simulation on its own, null lets it accumulate until somebody stops it.
            */}
            <RadioGroup
              value={bounded ? "bounded" : "unbounded"}
              onChange={(v) => {
                setBounded(v === "bounded");
              }}
              name="visiting-mode"
              legend="How they visit"
              legendHidden
            >
              <Radio
                value="bounded"
                label="A few visits each, then stop"
                hint="Everyone arrives knowing nothing, makes a set number of visits and is finished. Run it again after a fix and the two runs are independent."
              />
              <Radio
                value="unbounded"
                label="Keep coming back until I stop it"
                hint="People remember what happened last time and build on it. It runs until you pause it, and it can be picked back up."
              />
            </RadioGroup>

            {bounded ? (
              <FieldGrid cols={2}>
                <Field label="Visits each">
                  {({ id, describedBy, invalid }) => (
                    <NumberInput
                      id={id}
                      describedBy={describedBy}
                      invalid={invalid}
                      value={visits}
                      min={1}
                      onChange={setVisits}
                    />
                  )}
                </Field>
              </FieldGrid>
            ) : null}
          </Stack>
        </Section>
      </Stack>
    </FormPage>
  );
}

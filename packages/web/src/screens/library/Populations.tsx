import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { api, type PopulationView } from "../../api.js";
import { q } from "../../queries.js";
import { useProject } from "../../context.jsx";
import { people, plural } from "../../format.js";
import {
  AlertDialog,
  Button,
  Dialog,
  DocumentPage,
  Field,
  Input,
  Ledger,
  LedgerRow,
  Link,
  MetaLine,
  Mono,
  PageHeader,
  PayloadBlock,
  Section,
  Skeleton,
  Stack,
  StateBlock,
  Text,
  type MetaFact,
  type StateKind,
} from "../../design/index.js";

/**
 * Populations — the saved casts, and the first screen in this product that can make one.
 *
 * **A population is composition and nothing else** (ADR-0029): an ordered set of cohorts, saved
 * under a name. It is the "who goes" half of a simulation, and the reason it is worth naming is
 * reuse — one cast sent at dev and at qa is how you learn a problem is environmental rather than
 * real, which is the whole argument for a project holding several targets.
 *
 * **Why it did not exist until now.** The concept was in the store, the contract, the API and the
 * resolver from the beginning, and the rail even had a row for it gated on `populationCount > 1`
 * — a condition nothing in the browser could ever satisfy, because every write path resolved the
 * population called "everyone" internally and edited that one whatever it was asked for. You could
 * POST a second population and never put anything in it. That is fixed in `setCohortSize`; this is
 * the screen that makes the fix reachable.
 *
 * **"Everyone" is listed, not hidden.** It is auto-created on first use and it is where cohorts
 * land when nobody has said otherwise, and hiding it is what makes composition feel like magic
 * that happened behind your back. Listing it costs nothing and explains the model in one glance.
 * It cannot be removed — see the refusal the server gives — and neither can the last one.
 */
export function Populations() {
  const { key, project, href } = useProject();
  const queries = useQueryClient();
  const navigate = useNavigate();
  const populations = useQuery(q.populations(key));
  const [composing, setComposing] = useState(false);
  const [name, setName] = useState("");

  const items = populations.data?.items ?? [];

  const create = useMutation({
    mutationFn: () => api.createPopulation(key, { name: name.trim() }),
    onSuccess: async (made) => {
      await queries.invalidateQueries();
      setComposing(false);
      setName("");
      // Straight into the editor: a population with no cohorts in it is not yet anything, and the
      // next thing a reader wants is to put somebody in it.
      void navigate(href(`library/populations/${encodeURIComponent(made.id)}`));
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.removePopulation(key, id),
    onSuccess: () => queries.invalidateQueries(),
  });

  const state: StateKind | undefined = populations.isPending
    ? "loading"
    : populations.isError
      ? "failed"
      : items.length === 0
        ? "empty"
        : undefined;

  const what = "this project's populations";

  /** Which simulations run a population. Derived from the overview, so it costs no request. */
  const runBy = (population: PopulationView): readonly string[] =>
    project.simulations.filter((s) => s.population.id === population.id).map((s) => s.name);

  return (
    <DocumentPage
      header={
        <PageHeader
          title="Populations"
          lede="A saved cast: which cohorts go, in what order. A simulation is one population and one target, so a cast composed once can be sent anywhere."
        />
      }
      state={state}
      loading={
        <StateBlock
          kind="loading"
          what={what}
          skeleton={<Skeleton variant="row" count={2} height={72} width="wide" label={`Reading ${what}`} />}
        />
      }
      error={
        <StateBlock kind="failed" what={what} error={populations.error}>
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
      empty={
        <StateBlock kind="empty" what={what}>
          No casts yet. Pick somebody to visit and the first one is made for you, called Everyone.{" "}
          <Link to={href("library/personas")} size="ui">
            Pick who visits
          </Link>
        </StateBlock>
      }
    >
      <Stack gap={8}>
        <Section
          title="Saved casts"
          trailing={plural(items.length, "population")}
          actions={
            <Button
              variant="quiet"
              size="sm"
              onClick={() => {
                setComposing(true);
              }}
            >
              Compose a population
            </Button>
          }
        >
          <Ledger>
            {items.map((population) => {
              const headcount = population.members.reduce((n, m) => n + m.count, 0);
              const used = runBy(population);
              return (
                <LedgerRow
                  key={population.id}
                  stub={
                    /*
                      The slug, not a rank. A population slug is the FIRST segment of every agent
                      id (`populationSlug/cohortSlug#ordinal`), so it is the thing a reader will
                      meet again in a trace, and it is worth having in front of them here.
                    */
                    <Mono size="ref" tone="muted">
                      {population.slug}
                    </Mono>
                  }
                  to={href(`library/populations/${encodeURIComponent(population.id)}`)}
                  aside={
                    used.length > 0 ? (
                      // A population a simulation still names cannot go, and the server's refusal
                      // names the simulation. At a bound rather than gone (§6): it keeps its tab
                      // stop and says why.
                      <Button variant="quiet" size="sm" atBound>
                        Remove
                      </Button>
                    ) : (
                      <AlertDialog
                        title={`Remove ${population.name}?`}
                        body={`No simulation runs ${population.name}, so nothing else in this project moves. The cohorts in it are not deleted — a cohort is the people, and they stay in the library and in every other cast that holds them.`}
                        confirmLabel="Remove this population"
                        onConfirm={() => {
                          remove.mutate(population.id);
                        }}
                        trigger={
                          <Button variant="quiet" size="sm">
                            Remove
                          </Button>
                        }
                      />
                    )
                  }
                >
                  <Stack gap={1}>
                    <Text size="name" as="div">
                      {population.name}
                    </Text>
                    <MetaLine facts={shapeOf(population, headcount, used)} />
                  </Stack>
                </LedgerRow>
              );
            })}
          </Ledger>
        </Section>

        {remove.isError ? (
          <PayloadBlock caption="It was not removed" value={remove.error.message} error />
        ) : null}
      </Stack>

      <Dialog
        open={composing}
        onOpenChange={setComposing}
        title="Compose a population"
        description="A name for the cast. You choose who is in it next."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setComposing(false);
              }}
            >
              Never mind
            </Button>
            <Button
              variant="primary"
              atBound={name.trim() === ""}
              onClick={() => {
                create.mutate();
              }}
            >
              Compose it
            </Button>
          </>
        }
      >
        <Stack gap={4}>
          <Field label="Call it" hint="Soak cast, Sceptics only, Everyone on mobile.">
            {({ id, describedBy, invalid }) => (
              <Input id={id} describedBy={describedBy} invalid={invalid} value={name} onChange={setName} />
            )}
          </Field>
          {create.isError ? (
            <PayloadBlock caption="It was not composed" value={create.error.message} error />
          ) : null}
        </Stack>
      </Dialog>
    </DocumentPage>
  );
}

/** What a cast is made of, and who sends it. */
function shapeOf(
  population: PopulationView,
  headcount: number,
  used: readonly string[],
): readonly MetaFact[] {
  return [
    {
      key: "made-of",
      node:
        population.members.length === 0
          ? "nobody in it yet"
          : `${people(headcount)} in ${plural(population.members.length, "cohort")}`,
    },
    {
      key: "cohorts",
      node:
        population.members.length === 0
          ? "add a cohort to send it anywhere"
          : population.members.map((m) => m.cohortName).join(", "),
    },
    ...(used.length === 0
      ? [{ key: "unused", node: "no simulation runs it" } as MetaFact]
      : [{ key: "used", node: `run by ${used.join(", ")}` } as MetaFact]),
  ];
}

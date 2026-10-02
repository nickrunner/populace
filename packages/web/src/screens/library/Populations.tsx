import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, type PopulationView } from "../../api.js";
import { keys, q } from "../../queries.js";
import { useProject } from "../../context.jsx";
import { plural } from "../../format.js";
import {
  AlertDialog,
  Button,
  DocumentPage,
  DropdownMenu,
  IconButton,
  Ledger,
  LedgerRow,
  Link,
  MetaLine,
  PageHeader,
  Ring,
  Skeleton,
  Stack,
  StateBlock,
  Text,
  WhatWentWrong,
  type DropdownMenuItem,
  type StateKind,
} from "../../design/index.js";

/**
 * Populations — the list of saved casts, and the way to a new one (ADR-0043).
 *
 * **A population is composition and nothing else** (ADR-0029, ADR-0041): an ordered set of
 * cohorts, each at a weight, saved under a name. It has no headcount. The size lives on the study
 * that sends it, and a study of twenty deals twenty across these weights and then across each
 * cohort's mix — which is why the row here says "3 cohorts" and never "12 people". A population
 * that says how many is a population that lies to every study but one.
 *
 * **This is a list, and only a list.** It used to compose a population from a dialog on this
 * page and then hand the reader an editor with a stepper per cohort; the composing has moved into
 * one builder page that serves `new` and `:pop` alike, because a population made in two places is
 * a population half-made in each. What is left here is what every noun's list page does: every
 * item, one fact each, a menu with Edit and Delete, a "New" button in the header, and an empty
 * state that says what a population is and points at the builder.
 *
 * **"Everyone" is no longer auto-made.** There is no default population any more (ADR-0041): a
 * project with none has none, and the first is composed on purpose. So the list can be empty, and
 * the empty state is written for a reader who has never made one rather than for a reader whose
 * default went missing.
 *
 * **Delete is at a bound, not gone, while a study sends it** (§6, §7.4). The server refuses by
 * name, and the menu item says the reason before the reader reaches the refusal. A 409 that gets
 * through anyway — a study made in another tab — is shown through `WhatWentWrong`. The act itself
 * goes through a controlled `AlertDialog` that is a SIBLING of the menu in the aside, never an
 * item inside it: a Radix menu closes on select, and a dialog mounted inside the item it closes
 * closes with it.
 */
export function Populations() {
  const { key, href } = useProject();
  const queries = useQueryClient();
  const populations = useQuery(q.populations(key));

  const items = populations.data?.items ?? [];

  const remove = useMutation({
    mutationFn: (id: string) => api.removePopulation(key, id),
    onSuccess: async () => {
      // The list, and the two things that count populations: the overview's figures and the
      // setup's "compose a population" need. Never the bare `invalidateQueries()`.
      await Promise.all([
        queries.invalidateQueries({ queryKey: keys.populations(key) }),
        queries.invalidateQueries({ queryKey: keys.project(key) }),
        queries.invalidateQueries({ queryKey: keys.setup(key) }),
      ]);
    },
  });

  const state: StateKind | undefined = populations.isPending
    ? "loading"
    : populations.isError
      ? "failed"
      : items.length === 0
        ? "empty"
        : undefined;

  const what = "this project's populations";
  const builder = href("library/populations/new");

  return (
    <DocumentPage
      header={
        <PageHeader
          title="Populations"
          lede="Which cohorts go, and in what ratio. A study picks a population and says how many; the weights decide how many of each, so one population can be sent at any size and at any target."
          actions={
            <Button asChild variant="primary">
              <Link to={builder}>New population</Link>
            </Button>
          }
        />
      }
      state={state}
      loading={
        <StateBlock
          kind="loading"
          what={what}
          skeleton={<Skeleton variant="row" count={2} height={56} width="wide" label={`Reading ${what}`} />}
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
          <Stack gap={6} align="start">
            <div>
              No populations yet. A population is which cohorts go, at weights you set — a recipe
              for people, not the people. A study picks one and says how many.
            </div>
            <Button asChild variant="primary">
              <Link to={builder}>Compose the first population</Link>
            </Button>
          </Stack>
        </StateBlock>
      }
    >
      <Stack gap={6}>
        <Ledger>
          {items.map((population) => (
            <PopulationRow
              key={population.id}
              population={population}
              to={href(`library/populations/${encodeURIComponent(population.id)}`)}
              onDelete={() => {
                remove.mutate(population.id);
              }}
            />
          ))}
        </Ledger>

        {remove.isError ? (
          <WhatWentWrong says="It was not deleted. The populations above are as they were." error={remove.error} />
        ) : null}
      </Stack>
    </DocumentPage>
  );
}

/**
 * One population: its name, how many cohorts it is made of, and the menu.
 *
 * A component rather than a map body because the confirmation is state, and it is THIS row's
 * state: a list-level "which one is confirming" would have to be cleared on every route the
 * dialog can close by, and would confirm the wrong row the moment the list re-sorted under it.
 */
function PopulationRow({
  population,
  to,
  onDelete,
}: {
  population: PopulationView;
  to: string;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const held = population.usedBy > 0;
  const sentBy = `${plural(population.usedBy, "study", "studies")} send${population.usedBy === 1 ? "s" : ""} it`;

  const menu: DropdownMenuItem[] = [
    { label: "Edit", to },
    held
      ? {
          // At a bound, not gone: the item keeps its place in the menu and its label IS the
          // reason, so the control that is refusing says why (§7.4).
          label: (
            <MetaLine size="ui" facts={[{ key: "act", node: "Delete" }, { key: "why", node: sentBy }]} />
          ),
          textValue: "Delete",
          tone: "danger",
          disabled: true,
        }
      : {
          label: "Delete",
          tone: "danger",
          onSelect: () => {
            setConfirming(true);
          },
        },
  ];

  return (
    <LedgerRow
      stub={
        /*
          A mark, not a count: the ring is the grammar's empty slot (§1.2 M4), which is what a
          population is — the shape people will fill once a study gives it a size, drawn before
          anybody has. It is a locator for the column and carries no name of its own; the row does.
        */
        <Ring size="sm" />
      }
      to={to}
      aside={
        <>
          <DropdownMenu
            label={`Actions for ${population.name}`}
            trigger={<IconButton icon="chevron-down" variant="quiet" size="sm" label={`Actions for ${population.name}`} />}
            items={menu}
          />
          <AlertDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={`Delete ${population.name}?`}
            body={`No study sends ${population.name}, so nothing else in this project moves. The cohorts in it are not deleted: a cohort is its own record, and it stays in the library and in every other population that holds it.`}
            confirmLabel="Delete this population"
            onConfirm={onDelete}
          />
        </>
      }
    >
      <Stack gap={1}>
        <Text size="name" as="div">
          {population.name}
        </Text>
        <MetaLine
          facts={[
            {
              key: "cohorts",
              node: population.members.length === 0 ? "no cohorts yet" : plural(population.members.length, "cohort"),
            },
          ]}
        />
      </Stack>
    </LedgerRow>
  );
}

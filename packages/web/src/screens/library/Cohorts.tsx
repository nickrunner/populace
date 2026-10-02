import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import { api, type CohortView } from "../../api.js";
import { keys, q } from "../../queries.js";
import { useProject } from "../../context.jsx";
import { plural } from "../../format.js";
import {
  AlertDialog,
  Button,
  Capsule,
  DocumentPage,
  DropdownMenu,
  IconButton,
  Inline,
  Ledger,
  LedgerRow,
  Link,
  PageHeader,
  Skeleton,
  Stack,
  StateBlock,
  Text,
  WhatWentWrong,
  type StateKind,
} from "../../design/index.js";

/**
 * Cohorts — the list of groups this project has cut (ADR-0039, ADR-0043).
 *
 * **A cohort is a shared condition and a mix of personas, and it has no size.** So this page
 * lists cohorts and nothing else: a name, the first sentence of what its people share, and how
 * many personas it is drawn from. It shows no people, no headcounts and no populations, because
 * none of those is a fact about a cohort — how many go is a study's size dealt through a
 * population's weights (ADR-0041), and the People page of that study is where they are seen.
 *
 * **This page used to try to be three pages.** It listed cohorts on the left, the populations
 * that sent them and their headcounts on the right, and a two-field form at the bottom that made
 * a cohort out of a persona before it had a name — which was the confusion the redesign was
 * asked to end (ADR-0043 §0). Everything about MAKING a cohort lives in the builder now
 * (`library/cohorts/new`), which has room for the whole definition; everything about HOW MANY
 * lives on the study. What is left here is a list, and the list follows the rules every list
 * page in the product follows: `DocumentPage` + `PageHeader` with the one primary "New cohort" +
 * a `Ledger` whose rows open the builder.
 *
 * **The row's aside is the one sanctioned menu** (ATOMIC-INVENTORY §3, organism 4 amendment):
 * one `IconButton` opening a `DropdownMenu` with Edit and Delete, and a CONTROLLED `AlertDialog`
 * as the menu's sibling — never inside an item, because Radix unmounts the item on select and
 * would take the dialog with it. Delete copy says what the server will do, including refusal: a
 * cohort a population still holds cannot go (the server answers 409 naming the populations), so
 * its Delete item is at a bound with the reason as its label rather than gone, and a 409 that
 * arrives anyway shows through `WhatWentWrong`.
 *
 * **The stub is a mark, not a count.** A capsule is the mark grammar's word for a cohort
 * (§1.2 M4); it is a locator here, and its length says nothing, because a cohort has no headcount
 * for a length to mean.
 */

/** The first sentence of what a cohort's people share: enough to tell two cohorts apart. */
export function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = /^[^.!?]*[.!?]/.exec(trimmed);
  return match === null ? trimmed : match[0].trim();
}

/**
 * What deleting actually does, said before it happens. It promises only what the server does:
 * a cohort nothing holds leaves the library, and executions that already ran keep everything
 * they recorded. A held cohort never reaches this sentence — its Delete is at a bound.
 */
function consequence(cohort: CohortView): string {
  return `${cohort.name} leaves the library. No population holds it, so no study sends anybody from it and nothing else in this project moves. Executions that have already run keep their people, their visits and their findings.`;
}

export function Cohorts() {
  const { key, href } = useProject();
  const queries = useQueryClient();
  const cohorts = useQuery(q.cohorts(key));

  const remove = useMutation({
    mutationFn: (id: string) => api.removeCohort(key, id),
    onSuccess: async () => {
      // The list, and the counts the rail and the overview read from it. Never the whole cache.
      await Promise.all([
        queries.invalidateQueries({ queryKey: keys.cohorts(key) }),
        queries.invalidateQueries({ queryKey: keys.project(key) }),
        queries.invalidateQueries({ queryKey: keys.setup(key) }),
      ]);
    },
  });

  const state: StateKind | undefined = cohorts.isPending
    ? "loading"
    : cohorts.isError
      ? "failed"
      : cohorts.data.items.length === 0
        ? "empty"
        : undefined;

  const rows = cohorts.data?.items ?? [];
  const builder = href("library/cohorts/new");

  return (
    <DocumentPage
      header={
        <PageHeader
          title="Cohorts"
          lede={
            <>
              People who share something, drawn from one persona, or several at weights you set. A
              cohort has no size of its own: how many go is set on the study that sends them.{" "}
              <Link to="/concepts#cohort">What a cohort owns, and what a persona does</Link>
            </>
          }
          meta={rows.length === 0 ? undefined : [{ key: "cohorts", node: plural(rows.length, "cohort") }]}
          actions={
            <Button asChild variant="primary">
              <RouterLink to={builder}>New cohort</RouterLink>
            </Button>
          }
        />
      }
      state={state}
      loading={
        <StateBlock
          kind="loading"
          what="the cohorts"
          skeleton={<Skeleton variant="row" count={4} height={72} label="Reading the cohorts" />}
        />
      }
      error={<StateBlock kind="failed" what="the cohorts" error={cohorts.error} />}
      empty={
        <StateBlock kind="empty" what="this project's cohorts">
          <Stack gap={4} align="start">
            <span>
              No cohorts yet. A cohort is people who share something — mobile-only signups, the
              pilot team, everyone who arrived in launch week — drawn from the personas at weights
              you set.
            </span>
            <Button asChild variant="primary">
              <RouterLink to={builder}>Make the first cohort</RouterLink>
            </Button>
          </Stack>
        </StateBlock>
      }
    >
      <Stack gap={6}>
        <Ledger stubKind="mark">
          {rows.map((cohort) => (
            <CohortRow
              key={cohort.id}
              cohort={cohort}
              to={href(`library/cohorts/${encodeURIComponent(cohort.id)}`)}
              onDelete={() => {
                remove.mutate(cohort.id);
              }}
            />
          ))}
        </Ledger>

        {remove.isError ? (
          <WhatWentWrong says="Nothing changed. The cohorts above are as they were." error={remove.error} />
        ) : null}
      </Stack>
    </DocumentPage>
  );
}

/**
 * One cohort: its name, the first sentence of what its people share, and how many personas it
 * draws on. The whole row opens the builder; the aside carries Edit and Delete.
 */
function CohortRow({ cohort, to, onDelete }: { cohort: CohortView; to: string; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const held = cohort.usedBy > 0;

  return (
    <LedgerRow
      stub={<Capsule size="sm" label={`${cohort.name}, a cohort`} />}
      to={to}
      aside={
        <>
          <DropdownMenu
            label={`${cohort.name} actions`}
            trigger={<IconButton icon="chevron-down" label={`Actions for ${cohort.name}`} />}
            items={[
              { label: "Edit", to },
              {
                // At a bound, not gone: the item keeps its place and its label is the reason
                // (§6, §7.4). The server would refuse with the same fact, by name.
                label: held ? `Delete — in ${plural(cohort.usedBy, "population")}` : "Delete",
                tone: "danger",
                disabled: held,
                onSelect: () => {
                  setConfirming(true);
                },
              },
            ]}
          />
          <AlertDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={`Delete ${cohort.name}?`}
            body={consequence(cohort)}
            confirmLabel="Delete this cohort"
            onConfirm={onDelete}
          />
        </>
      }
    >
      <Stack gap={1}>
        <Inline gap={3} align="baseline" wrap>
          <Text size="name">{cohort.name}</Text>
          <Text size="meta" tone="muted">
            {plural(cohort.mix.length, "persona")}
          </Text>
        </Inline>
        <Text size="read-sm" tone="soft" as="p">
          {firstSentence(cohort.context)}
        </Text>
      </Stack>
    </LedgerRow>
  );
}

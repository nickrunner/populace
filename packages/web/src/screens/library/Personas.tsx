import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import { api, type Persona } from "../../api.js";
import { keys, q } from "../../queries.js";
import { useProject } from "../../context.jsx";
import { plural } from "../../format.js";
import {
  AlertDialog,
  Avatar,
  Button,
  DocumentPage,
  DropdownMenu,
  IconButton,
  Ledger,
  LedgerRow,
  MetaLine,
  NameWithRole,
  PageHeader,
  Skeleton,
  Stack,
  StateBlock,
  WhatWentWrong,
  type DropdownMenuItem,
  type StateKind,
} from "../../design/index.js";

/**
 * A persona is a KIND of person, not a person: it has no name of its own, and the people in a
 * cohort are drawn from it. This screen is the library of the kinds this project has written —
 * every one of them, with a way to edit it and a way to delete it, and one button to write
 * another (ADR-0043).
 *
 * It used to lead with six prebuilt personas and a "Take them" button, and the reader's own
 * personas came second. That order taught the wrong model: taking a starter made a persona, a
 * cohort and a population in one request, and the reader met three nouns they had not asked for.
 * The starters are a starting point INSIDE the builder now, so this page lists what is here and
 * nothing that is not. No people's names appear on it and no row carries a headcount — a persona
 * has no number to say; the size belongs to the study (ADR-0041).
 *
 * Ported to the design system — ATOMIC-INVENTORY §6.3, row 3, and the list-page rules under §5.
 * Each row's `aside` is the one sanctioned control on a row whose whole surface is a link: an
 * `IconButton` opening a `DropdownMenu` with Edit and Delete, and a controlled `AlertDialog` as
 * the menu's SIBLING — never inside an item, because a menu closes on select and would unmount the
 * question it just asked (DESIGN-SYSTEM §7.4).
 */

/**
 * What the dialog promises, and nothing more.
 *
 * A cohort mixes personas (ADR-0039), so "delete this persona" cannot cascade into "delete its
 * cohort": the cohort may draw on two others as well. The server therefore **refuses outright**
 * while any cohort still names the persona, and the mix on the cohort's page is where it is
 * taken out. That refusal is said on the menu item, at the bound, before the dialog is ever
 * reached; this sentence is for the persona nobody draws on, which is the only one that can go.
 */
function consequence(name: string): string {
  return `Nobody is drawn from ${name} today, so nothing else in this project moves. Executions that have already run keep their people, their visits and their findings.`;
}

/**
 * The delete rules, in one sentence (ADR-0043 §7): a persona is refused while a cohort's mix
 * names it, and the reason is "in N cohorts". The control stays where it is, inert, with the
 * reason beside it — a keyboard reader still meets the item and hears why (§6).
 */
function heldBecause(persona: Persona): string | null {
  return persona.cohorts === 0 ? null : `in ${plural(persona.cohorts, "cohort")}`;
}

export function Personas() {
  const { key, href } = useProject();
  const queries = useQueryClient();
  const personas = useQuery(q.personas(key));
  const errorId = useId();

  const items = personas.data?.items ?? [];
  const builder = href("library/personas/new");

  /**
   * One mutation for the whole list, blamed on the row that pressed it, so the failure can be
   * written under the ledger where a modal panel is not covering it. What a delete moves is this
   * list and the project's counts; never `invalidateQueries()` bare — that refetches every screen
   * in the product for one row leaving one list (ADR-0026). The mutation stays pending until the
   * list has refetched, which is what lets a row's dialog hold its spinner until the row is gone.
   */
  const remove = useMutation({
    mutationFn: (id: string) => api.removePersona(key, id),
    onSuccess: async () => {
      await Promise.all([
        queries.invalidateQueries({ queryKey: keys.personas(key) }),
        queries.invalidateQueries({ queryKey: keys.project(key) }),
      ]);
    },
  });
  const blamed = remove.isError ? items.find((persona) => persona.id === remove.variables) : undefined;

  /**
   * The state goes to the template's slot rather than returning early, so the header and the
   * page frame stay mounted while the body is a sentence. `empty` is a state of this screen, not
   * a different screen: the sentence and the way forward stand where the list will.
   */
  const state: StateKind | undefined = personas.isPending
    ? "loading"
    : personas.isError
      ? "failed"
      : items.length === 0
        ? "empty"
        : undefined;

  return (
    <DocumentPage
      header={
        <PageHeader
          title="Personas"
          lede="Who the people are underneath: what they came to do, what they will put up with, and what they are allowed to touch. This is the setting that decides more than any other whether what comes back is worth reading."
          actions={
            <Button asChild variant="primary">
              <RouterLink to={builder}>New persona</RouterLink>
            </Button>
          }
        />
      }
      state={state}
      loading={
        <StateBlock
          kind="loading"
          what="the personas"
          skeleton={<Skeleton variant="row" count={5} label="Reading the personas" />}
        />
      }
      error={
        <StateBlock kind="failed" what="the personas" error={personas.error}>
          <Button
            variant="secondary"
            onClick={() => {
              void personas.refetch();
            }}
          >
            Try again
          </Button>
        </StateBlock>
      }
      empty={
        <StateBlock kind="empty" what="this project's personas">
          <Stack gap={6} align="start">
            <div>
              Nobody has been written yet. A persona is a kind of person — what they came to do,
              what they will put up with, what they will not touch — and the cohorts you compose
              later are drawn from them. The builder offers six to start from.
            </div>
            <Button asChild variant="primary">
              <RouterLink to={builder}>Write the first persona</RouterLink>
            </Button>
          </Stack>
        </StateBlock>
      }
    >
      <Stack gap={4}>
        <Ledger stubKind="mark">
          {items.map((persona) => (
            <PersonaRow
              key={persona.id}
              persona={persona}
              deleting={remove.isPending && remove.variables === persona.id}
              describedBy={blamed?.id === persona.id ? errorId : undefined}
              onDelete={() =>
                // The dialog is modal, and a failure is written under the list where a panel
                // would cover it — so a refusal closes the panel and the sentence takes over.
                remove.mutateAsync(persona.id).then(
                  () => true,
                  () => false,
                )
              }
            />
          ))}
        </Ledger>

        {blamed === undefined || remove.error === null ? null : (
          <WhatWentWrong
            id={errorId}
            says={`${blamed.spec.name} was not deleted. It is still here, and so is everything drawn from it.`}
            error={remove.error}
          />
        )}
      </Stack>
    </DocumentPage>
  );
}

/**
 * One persona: its name and its role, the row a link to its builder, and beside it the menu.
 *
 * The confirm is the row's own: the question is about THIS persona, so the row holds whether it
 * is being asked. The act itself belongs to the list above, which is where its failure is read.
 */
function PersonaRow({
  persona,
  deleting,
  describedBy,
  onDelete,
}: {
  persona: Persona;
  deleting: boolean;
  describedBy: string | undefined;
  /** Resolves to whether the persona went; the panel closes either way once the answer is in. */
  onDelete: () => Promise<boolean>;
}) {
  const { href } = useProject();
  const [confirming, setConfirming] = useState(false);

  const page = href(`library/personas/${encodeURIComponent(persona.id)}`);
  const held = heldBecause(persona);

  const menu: DropdownMenuItem[] = [
    { label: "Edit", to: page },
    held === null
      ? {
          label: "Delete",
          tone: "danger",
          onSelect: () => {
            setConfirming(true);
          },
        }
      : {
          // At a bound, not gone: the item keeps its place and its name, and the reason sits
          // beside it on a hairline (§4.5) rather than being the only thing the reader is told.
          label: (
            <MetaLine
              size="ui"
              facts={[
                { key: "act", node: "Delete" },
                { key: "why", node: held },
              ]}
            />
          ),
          textValue: `Delete, refused: ${held}`,
          tone: "danger",
          disabled: true,
        },
  ];

  return (
    <LedgerRow
      stub={<Avatar name={persona.spec.name} size="sm" />}
      to={page}
      aside={
        <>
          <DropdownMenu
            label={`Actions for ${persona.spec.name}`}
            trigger={
              <IconButton
                icon="chevron-down"
                label={`Actions for ${persona.spec.name}`}
                variant="quiet"
                size="sm"
                aria-describedby={describedBy}
              />
            }
            items={menu}
          />
          {/*
            Controlled, and a sibling of the menu: the menu closes on select, so a dialog mounted
            inside the item would be unmounted with it before the reader could answer. The act
            takes time and the list holds its state, so `confirmPending` keeps the panel up until
            the row is gone or the server has said no.
          */}
          <AlertDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={`Delete ${persona.spec.name}?`}
            body={consequence(persona.spec.name)}
            confirmLabel="Delete this persona"
            confirmPending={deleting}
            onConfirm={() => {
              void onDelete().then((gone) => {
                if (!gone) setConfirming(false);
              });
            }}
          />
        </>
      }
    >
      {/* A ledger row's name is the row's heading, as it is in every other ledger in the product
          (§6, "Heading order"). The row is the link, so the name is not one too. */}
      <NameWithRole level={3} name={persona.spec.name} role={persona.spec.role} />
    </LedgerRow>
  );
}

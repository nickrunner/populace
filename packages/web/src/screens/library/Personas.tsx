import { useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api.js";
import { q } from "../../queries.js";
import { useProject } from "../../context.jsx";
import {
  AlertDialog,
  Avatar,
  Button,
  DocumentPage,
  Inline,
  Ledger,
  LedgerRow,
  Link,
  MetaLine,
  Mono,
  NameWithRole,
  PageHeader,
  Section,
  Skeleton,
  Spacer,
  Stack,
  StateBlock,
  Text,
  Tooltip,
  WhatWentWrong,
  type StateKind,
} from "../../design/index.js";

/**
 * A persona is a KIND of person, not a person: it has no name of its own, and the people in a
 * cohort are drawn from it. This screen is the library of kinds; how many of each go anywhere is
 * decided on "The people" (SPEC §7.6).
 *
 * Ported to the design system — ATOMIC-INVENTORY §6.3, row 3. It is the product's **first
 * destructive confirm**: removing a persona takes its cohort with it, so the act goes through an
 * `AlertDialog` whose body says what actually happens, with the number (DESIGN-SYSTEM §7.4).
 */

/**
 * What the dialog promises, and nothing more — read off the cohorts that actually draw on this
 * persona.
 *
 * A cohort mixes personas (ADR-0039), so "remove this persona" cannot cascade into "remove its
 * cohort": the cohort may draw on two others as well. The server therefore **refuses outright**
 * while any cohort still names the persona, and the mix on the cohort's page is where it is
 * taken out. The copy says which of the two cases the reader is in, and names the cohorts.
 */
function consequence(name: string, drawn: readonly { slug: string; name: string }[]): string {
  if (drawn.length === 0) {
    return `Nobody is drawn from ${name} today, so nothing else in this project moves. Executions that have already run keep their people, their visits and their findings.`;
  }
  return `This cannot be done yet. ${String(drawn.length)} ${drawn.length === 1 ? "cohort draws" : "cohorts draw"} on ${name} — ${drawn.map((cohort) => cohort.name).join(", ")} — and removing a persona a cohort still names is refused, so that nobody is unmade behind the cohort's back. Take ${name} out of ${drawn.length === 1 ? "that cohort's mix" : "those cohorts' mixes"} first, then remove it.`;
}

export function Personas() {
  const { key, href } = useProject();
  const queries = useQueryClient();
  const personas = useQuery(q.personas(key));
  const starters = useQuery(q.starters(key));
  // Which cohorts draw on each persona, by name: the fact the remove dialog needs.
  const cohorts = useQuery(q.cohorts(key));

  const refresh = async (): Promise<void> => {
    await queries.invalidateQueries();
  };
  const add = useMutation({ mutationFn: (slug: string) => api.addStarter(key, slug, 1), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api.removePersona(key, id), onSuccess: refresh });

  const addErrorId = useId();
  const removeErrorId = useId();

  const failure = personas.error ?? starters.error;
  const state: StateKind | undefined =
    personas.isPending || starters.isPending ? "loading" : failure === null ? undefined : "failed";

  // Read without branching the layout: the template renders the state slot instead of the body,
  // so the body is written as though the data is there and never sees a half-loaded page.
  const mine = personas.data?.items ?? [];
  const available = starters.data?.items ?? [];
  const taken = new Set(mine.map((persona) => persona.slug));
  const drawnFrom = (personaId: string): { slug: string; name: string }[] =>
    (cohorts.data?.items ?? [])
      .filter((cohort) => cohort.mix.some((entry) => entry.personaId === personaId))
      .map((cohort) => ({ slug: cohort.slug, name: cohort.name }));

  return (
    <DocumentPage
      header={
        <PageHeader
          title="Personas"
          lede="Who the people are underneath: what they came to do, what they will put up with, and what they are allowed to touch. This is the setting that decides more than any other whether what comes back is worth reading."
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
        // Two reads, both retried together: the screen is a failure while either is, so
        // offering one of them back would leave the other still broken (§6.5, rule 7).
        <StateBlock kind="failed" what="the personas" error={failure}>
          <Button
            variant="secondary"
            onClick={() => {
              void personas.refetch();
              void starters.refetch();
            }}
          >
            Try again
          </Button>
        </StateBlock>
      }
    >
      <Stack gap={12}>
        <Section
          title="In this project"
          trailing={`${mine.length} ${mine.length === 1 ? "kind of person" : "kinds of person"}`}
          actions={<Link to={href("library/personas/new")}>Write your own</Link>}
        >
          {mine.length === 0 ? (
            <StateBlock kind="empty" what="this project's personas">
              Nobody written yet. Start from one below, or write your own.
            </StateBlock>
          ) : (
            <Ledger>
              {mine.map((persona) => {
                const drawn = drawnFrom(persona.id);
                // The server refuses a persona any cohort still draws on, so the control is at
                // a bound: inert, not gone (§6). It keeps its tab stop, its name and a tooltip
                // carrying the same sentence the dialog would have carried.
                const refused = drawn.length > 0;
                const blamed = remove.isError && remove.variables === persona.id;

                return (
                <LedgerRow key={persona.id} stub={<Avatar name={persona.spec.name} size="sm" />}>
                  <Inline gap={3} align="start">
                    <Stack gap={1} className="min-w-0">
                      {/* A ledger row's name is the row's heading, as it is in every other
                          ledger in the product (§6, "Heading order"). */}
                      <NameWithRole
                        level={3}
                        name={persona.spec.name}
                        role={persona.spec.role}
                        to={href(`library/personas/${encodeURIComponent(persona.id)}`)}
                      />
                      <MetaLine
                        facts={persona.spec.goals.map((goal, index) => ({
                          key: `${persona.id}-goal-${String(index)}`,
                          node: goal,
                        }))}
                      />
                      <Mono size="code-sm">{persona.slug}</Mono>
                    </Stack>

                    <Spacer />

                    <Inline gap={3} align="center" className="shrink-0">
                      <Text size="meta" tone="muted">
                        {persona.cohorts === 0 ? "in no cohort" : `in ${String(persona.cohorts)} ${persona.cohorts === 1 ? "cohort" : "cohorts"}`}
                      </Text>
                      {refused ? (
                        <Tooltip content={consequence(persona.spec.name, drawn)}>
                          <Button variant="quiet" size="sm" atBound>
                            Remove
                          </Button>
                        </Tooltip>
                      ) : (
                        <AlertDialog
                          title={`Remove ${persona.spec.name}?`}
                          body={consequence(persona.spec.name, drawn)}
                          confirmLabel="Remove this persona"
                          onConfirm={() => remove.mutate(persona.id)}
                          trigger={
                            <Button
                              variant="quiet"
                              size="sm"
                              disabled={remove.isPending}
                              aria-describedby={blamed ? removeErrorId : undefined}
                            >
                              Remove
                            </Button>
                          }
                        />
                      )}
                    </Inline>
                  </Inline>
                </LedgerRow>
                );
              })}
            </Ledger>
          )}

          {remove.isError ? (
            <WhatWentWrong
              id={removeErrorId}
              says="Nobody was removed. The personas above are as they were."
              error={remove.error}
            />
          ) : null}
        </Section>

        <Section
          title="Start from someone"
          trailing={`${available.length} kinds of person who find different things`}
        >
          <Ledger>
            {available.map((starter) => (
              <LedgerRow key={starter.slug} stub={<Avatar name={starter.name} size="sm" />}>
                <Inline gap={3} align="center">
                  <Stack gap={1} className="min-w-0">
                    <NameWithRole name={starter.name} role={starter.role} />
                    <Text size="meta" tone="muted">
                      {starter.summary}
                    </Text>
                  </Stack>

                  <Spacer />

                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    onClick={() => add.mutate(starter.slug)}
                    disabled={add.isPending}
                    pending={add.isPending && add.variables === starter.slug}
                    // The message belongs to the press that failed, not to all of them.
                    aria-describedby={
                      add.isError && add.variables === starter.slug ? addErrorId : undefined
                    }
                  >
                    {taken.has(starter.slug) ? "Add another cohort" : "Take them"}
                  </Button>
                </Inline>
              </LedgerRow>
            ))}
          </Ledger>

          {add.isError ? (
            <WhatWentWrong
              id={addErrorId}
              says="Nothing was taken. This project's personas are unchanged."
              error={add.error}
            />
          ) : null}
        </Section>
      </Stack>
    </DocumentPage>
  );
}

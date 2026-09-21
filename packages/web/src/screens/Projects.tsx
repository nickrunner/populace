import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { q } from "../queries.js";
import { people, plural } from "../format.js";
import {
  Button,
  Chip,
  Dialog,
  Dot,
  Field,
  Heading,
  Inline,
  Input,
  Ledger,
  LedgerRow,
  Measure,
  MetaLine,
  Money,
  PageHeader,
  RelativeTime,
  Ring,
  Skeleton,
  Spacer,
  Stack,
  StateBlock,
  Text,
  TextArea,
  WhatWentWrong,
  CenteredPage,
  type MetaFact,
  type StateKind,
} from "../design/index.js";

/**
 * The only screen outside a project, and the only one without the rail: there is nothing to
 * navigate to until you are inside one. A row says what is in a project, whether anything is
 * going on in it, and what it has cost this week — the three things that decide which one you
 * open (SPEC §7.6).
 *
 * The list is a `Ledger` rather than a stack of cards, so the projects line up against one spine
 * and the stub answers the only question that is worth a glance: has anything ever happened in
 * here. A filled dot means it has; a ring means it has not, which is the same grammar the
 * population marks use everywhere else in the product.
 */
export function Projects() {
  const queries = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const projects = useQuery(q.projects());
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const writing = params.get("new") !== null;
  const createErrorId = useId();

  const create = useMutation({
    mutationFn: () => api.createProject({ name, ...(description ? { description } : {}) }),
    onSuccess: async (project) => {
      await queries.invalidateQueries({ queryKey: ["projects"] });
      void navigate(`/p/${encodeURIComponent(project.slug)}`);
    },
  });

  const items = (projects.data?.items ?? []).filter((project) => !project.archived);

  const state: StateKind | undefined = projects.isPending
    ? "loading"
    : projects.isError
      ? "failed"
      : items.length === 0
        ? "empty"
        : undefined;

  const open = () => {
    setParams({ new: "1" });
  };

  return (
    <>
      <CenteredPage
        header={
          <PageHeader
            // No eyebrow. It used to spell the product's name in text because the screen is
            // railless and carried no artwork at all; the shell now draws the lockup above this
            // heading, and the name set twice — once as artwork, once as a word under it — is one
            // locator too many.
            title="Your projects"
            lede="A project is one product you are testing: its target, the people who visit it, and everything they have found. Nothing is shared between projects — a persona written here stays here."
            actions={
              <Button variant="primary" onClick={open}>
                New project
              </Button>
            }
          />
        }
        state={state}
        loading={
          <StateBlock
            kind="loading"
            what="your projects"
            skeleton={<Skeleton variant="row" count={3} height={72} label="Reading your projects" />}
          />
        }
        error={
          <StateBlock kind="failed" what="your projects" error={projects.error}>
            <Button
              variant="secondary"
              onClick={() => {
                void projects.refetch();
              }}
            >
              Try again
            </Button>
          </StateBlock>
        }
        empty={
          // Bare, like the other sixteen ported screens: `Card tone="sunk"` is reserved for the
          // quiet aside (§3, organism 1), and the one thing on an empty Projects page is not an
          // aside beside something else.
          <StateBlock kind="empty" what="your projects">
            <Stack gap={3} align="start">
              <span>Nothing here yet. A project is the first thing to make.</span>
              <Button variant="primary" onClick={open}>
                New project
              </Button>
            </Stack>
          </StateBlock>
        }
      >
        <Ledger as="ul">
          {items.map((project) => (
            <LedgerRow
              key={project.id}
              to={`/p/${encodeURIComponent(project.slug)}`}
              stub={
                project.lastActivityAt === null ? (
                  <Ring size="sm" className="md:ml-auto" />
                ) : (
                  <Dot size="sm" className="md:ml-auto" />
                )
              }
            >
              <Stack gap={1}>
                <Inline gap={3} align="baseline">
                  <Heading level={2} size="name">
                    {project.name}
                  </Heading>
                  {project.runningRunIds.length > 0 ? <Chip tone="live">running</Chip> : null}
                  <Spacer />
                  <Text size="meta" tone="muted">
                    <Money usd={project.costLast7dUsd} /> this week
                  </Text>
                </Inline>

                {project.description === "" ? null : (
                  <Measure width="read" as="div">
                    <Text size="read" tone="soft" as="p">
                      {project.description}
                    </Text>
                  </Measure>
                )}

                <MetaLine facts={factsFor(project.counts, project.lastActivityAt)} />
              </Stack>
            </LedgerRow>
          ))}
        </Ledger>
      </CenteredPage>

      <Dialog
        open={writing}
        onOpenChange={(next) => {
          setParams(next ? { new: "1" } : {});
        }}
        title="A new project"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setParams({});
              }}
            >
              Never mind
            </Button>
            <Button
              variant="primary"
              pending={create.isPending}
              disabled={create.isPending || name.trim() === ""}
              aria-describedby={create.isError ? createErrorId : undefined}
              onClick={() => {
                create.mutate();
              }}
            >
              Make the project
            </Button>
          </>
        }
      >
        <Stack gap={4}>
          <Field label="What are you testing?">
            {(ids) => (
              <Input
                value={name}
                onChange={setName}
                placeholder="The task manager"
                id={ids.id}
                describedBy={ids.describedBy}
                invalid={ids.invalid}
              />
            )}
          </Field>

          <Field
            label="A line about it"
            optional
            hint="It is what the projects list shows under the name."
          >
            {(ids) => (
              <TextArea
                value={description}
                onChange={setDescription}
                rows={2}
                placeholder="The task manager we ship next month."
                id={ids.id}
                describedBy={ids.describedBy}
                invalid={ids.invalid}
              />
            )}
          </Field>

          {/* The product says what failed and what is still true; the machine's own words go in
              the well beneath, never paraphrased into the sentence (§7.4). */}
          {create.isError ? (
            <WhatWentWrong
              id={createErrorId}
              says="The project was not made. Nothing here has been saved."
              error={create.error}
            />
          ) : null}
        </Stack>
      </Dialog>
    </>
  );
}

/**
 * What a project is made of, and when anything last happened in it. A project that has never
 * been visited says so in words — the stub's ring says the same thing to a reader scanning the
 * column, and neither is a promise about what the next execution will do.
 */
function factsFor(
  counts: { simulations: number; people: number; personas: number },
  lastActivityAt: string | null,
): readonly MetaFact[] {
  return [
    { key: "simulations", node: plural(counts.simulations, "simulation") },
    { key: "people", node: people(counts.people) },
    { key: "personas", node: plural(counts.personas, "persona") },
    {
      key: "activity",
      node:
        lastActivityAt === null ? (
          "nothing has run yet"
        ) : (
          <>
            last active <RelativeTime at={lastActivityAt} mode="absolute" />
          </>
        ),
    },
  ];
}

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api, type PersonView } from "../../api.js";
import { q } from "../../queries.js";
import { useProject } from "../../context.jsx";
import { people as peopleWord } from "../../format.js";
import {
  AlertDialog,
  Button,
  Card,
  DocumentPage,
  DurationField,
  Field,
  FieldGrid,
  Heading,
  Inline,
  JobProgress,
  Ledger,
  LedgerRow,
  Link,
  MetaSentence,
  Mono,
  NumberInput,
  PageHeader,
  Section,
  Skeleton,
  Spacer,
  Stack,
  StateBlock,
  Stepper,
  Text,
  Input,
  WhatWentWrong,
  type StateKind,
} from "../../design/index.js";

/**
 * One cohort and the people in it.
 *
 * This is the first screen in the product that names anybody, and it does it because this is
 * where you decide who they are. A person carries a name, a handle and a sentence — nothing else.
 * Goals and tool policy belong to the persona; the moment a person could carry those, the persona
 * would stop being a template and the cohort would stop meaning anything (SPEC §9).
 *
 * **Ported to the design system** — ATOMIC-INVENTORY §6.3, row 12. Three things go:
 *
 * - the hand-rolled `<h1>` band, for `DocumentPage` + `PageHeader`, which also gives the screen
 *   the `gone` state it never had: a cohort slug that does not exist is a stale URL, not a
 *   failure, and it now says so in a sentence with a way back (§6.5);
 * - `grid-cols-2 gap-x-6`, whose per-cell bottom rules were two ragged columns of hairlines that
 *   never lined up with each other. The roster is a `Ledger`: one spine, one stub, the person's
 *   number in it, which is the same column every other list in the product reads down;
 * - the bare `<button>edit</button>` and the `title=` attribute on "Re-cast all of them";
 * - the local `WritingProgress`, for the `JobProgress` organism §6.3 row 18 asked the two screens
 *   that had one to share. They had drifted: this one hid the meter on
 *   `total === null || total === 0` and `People`'s on `total === 0`, and one read a single job's
 *   label where the other took the first non-empty one across several.
 *
 * **Re-casting is destructive and now says so before it happens.** It replaces people that
 * executions already name, so it goes through an `AlertDialog` whose body carries the sentence
 * the screen used to whisper beside the button — a re-cast person is a different person, and the
 * problem an earlier execution recorded against the old one keeps that old name (§7.3).
 */

export function Cohort() {
  const { key, href } = useProject();
  const { cohortSlug = "" } = useParams();
  const queries = useQueryClient();
  const cohorts = useQuery(q.cohorts(key));
  const cohort = cohorts.data?.items.find((row) => row.slug === cohortSlug);
  const people = useQuery({ ...q.cohortPeople(key, cohort?.id ?? ""), enabled: cohort !== undefined });

  const [size, setSize] = useState<number | null>(null);
  const [every, setEvery] = useState<number | null>(null);
  const [cap, setCap] = useState<number | null>(null);
  const [job, setJob] = useState<string | null>(null);
  const [told, setTold] = useState("");

  useEffect(() => {
    if (cohort === undefined || size !== null) return;
    setSize(cohort.size);
    setEvery(cohort.cadence?.every === undefined ? 0 : Math.round(cohort.cadence.every / 1000));
    setCap(cohort.maxWakes ?? 0);
  }, [cohort, size]);

  const watched = useQuery({ ...q.job(job ?? ""), enabled: job !== null, refetchInterval: 1_000 });
  const writing = watched.data?.status === "queued" || watched.data?.status === "running";

  useEffect(() => {
    if (job === null || watched.data === undefined || writing) return;
    // Without an API key the writer succeeds with the free seeded cast, so what it managed is
    // said out loud rather than left to be inferred from rows that did not change.
    setTold(watched.data.error ?? watched.data.progress.label);
    setJob(null);
    void queries.invalidateQueries();
  }, [job, watched.data, writing, queries]);

  const refresh = async (): Promise<void> => {
    await queries.invalidateQueries();
  };
  const save = useMutation({
    mutationFn: () =>
      api.saveCohort(key, cohort?.id ?? "", {
        size: size ?? cohort?.size ?? 0,
        cadence: every === null || every === 0 ? null : { every: every * 1000 },
        maxWakes: cap === null || cap === 0 ? null : cap,
      }),
    onSuccess: refresh,
  });
  const write = useMutation({ mutationFn: () => api.writePeople(key, cohort?.id ?? ""), onSuccess: (started) => setJob(started.id) });
  const recast = useMutation({ mutationFn: () => api.recastPeople(key, cohort?.id ?? ""), onSuccess: (started) => setJob(started.id) });

  const saveErrorId = useId();
  const writeErrorId = useId();
  // Two ways to re-write the roster, one message: whichever failed is the one quoted.
  const failedWrite = write.error ?? recast.error;

  const state: StateKind | undefined = cohorts.isPending
    ? "loading"
    : cohorts.isError
      ? "failed"
      : cohort === undefined
        ? "gone"
        : undefined;

  const roster = (people.data?.items ?? []).filter((person) => !person.archived);
  const putAside = (people.data?.items ?? []).filter((person) => person.archived);
  const unwritten = roster.filter((person) => person.details === "").length;

  const rosterState: StateKind | undefined = people.isPending
    ? "loading"
    : people.isError
      ? "failed"
      : roster.length === 0
        ? "empty"
        : undefined;

  return (
    <DocumentPage
      header={
        <PageHeader
          title={cohort?.name ?? "This cohort"}
          crumbs={[
            { label: "Cohorts", to: href("library/cohorts") },
            { label: cohort?.name ?? cohortSlug },
          ]}
          lede={
            cohort === undefined ? undefined : (
              <>
                {peopleWord(cohort.size)} on{" "}
                <Link to={href(`library/personas/${encodeURIComponent(cohort.personaId)}`)}>
                  {cohort.personaName}
                </Link>
                .{" "}
                {cohort.usedByPopulations.length === 0
                  ? "No population holds them yet."
                  : `In ${cohort.usedByPopulations.map((population) => population.name).join(", ")}.`}
              </>
            )
          }
          meta={
            cohort === undefined
              ? undefined
              : [{ key: "slug", node: <Mono size="code-sm">{cohort.slug}</Mono> }]
          }
        />
      }
      state={state}
      loading={
        <StateBlock
          kind="loading"
          what="this cohort"
          skeleton={<Skeleton variant="row" count={6} label="Reading this cohort" />}
        />
      }
      error={<StateBlock kind="failed" what="this cohort" error={cohorts.error} />}
      gone={
        <StateBlock kind="gone" what="this cohort">
          <Stack gap={3} align="start">
            <span>
              No cohort called <Mono size="code-sm">{cohortSlug}</Mono> lives in this project.
              It may have been renamed, or removed with the persona it was drawn from.
            </span>
            <Button variant="secondary" asChild>
              <Link to={href("library/cohorts")}>Back to the cohorts</Link>
            </Button>
          </Stack>
        </StateBlock>
      }
    >
      {cohort === undefined ? null : (
        <Stack gap={12}>
          <Section title="How many, and how often">
            <Card>
              <Stack gap={6}>
                <FieldGrid cols={3} align="end">
                  {/* The render prop's ids are not optional decoration: `Stepper`'s root is a
                      `role="group"`, so the caption reaches it as `aria-label` and the hint as
                      `aria-describedby`. Discarding them left `htmlFor` pointing at an id that
                      existed nowhere and the hint reaching nothing at all (§6). */}
                  <Field
                    label="People in this cohort"
                    hint="Shrinking puts people aside rather than deleting them, so growing back meets the same cast."
                  >
                    {({ id, describedBy }) => (
                      <Stepper
                        id={id}
                        describedBy={describedBy}
                        label="People in this cohort"
                        value={size ?? cohort.size}
                        onChange={setSize}
                        max={999}
                      />
                    )}
                  </Field>

                  <DurationField
                    label="A visit every"
                    hint="Zero follows the simulation's own cadence."
                    unit="s"
                    valueMs={(every ?? 0) * 1000}
                    onChange={(ms) => {
                      setEvery(Math.round(ms / 1000));
                    }}
                  />

                  <Field
                    label="Stop each of them after"
                    hint="Visits. Zero follows the simulation."
                  >
                    {({ id, describedBy, invalid }) => (
                      <NumberInput
                        id={id}
                        describedBy={describedBy}
                        invalid={invalid}
                        value={cap ?? 0}
                        onChange={setCap}
                      />
                    )}
                  </Field>
                </FieldGrid>

                <Inline gap={3} align="center">
                  <Button
                    variant="primary"
                    onClick={() => {
                      save.mutate();
                    }}
                    disabled={save.isPending}
                    pending={save.isPending}
                  >
                    Save
                  </Button>
                </Inline>

                {save.isError ? (
                  <WhatWentWrong
                    id={saveErrorId}
                    says="Nothing was written. The numbers above are still yours to send again."
                    error={save.error}
                  />
                ) : null}
              </Stack>
            </Card>
          </Section>

          <Section
            title="Who they are"
            trailing={`${peopleWord(roster.length)}${unwritten > 0 ? `, ${String(unwritten)} without details` : ""}`}
            actions={
              <Inline gap={2} align="center">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    write.mutate();
                  }}
                  disabled={writing || write.isPending || unwritten === 0}
                >
                  {writing ? "Writing them…" : "Have the AI write these people"}
                </Button>

                <AlertDialog
                  title="Re-cast all of them?"
                  body="Everybody in this cohort is replaced, including the people past executions name. Re-casting changes who these people are, so the same problem found by the same person in an earlier execution no longer has the same name against it."
                  confirmLabel="Re-cast all of them"
                  onConfirm={() => {
                    recast.mutate();
                  }}
                  trigger={
                    <Button variant="quiet" size="sm" disabled={writing || recast.isPending}>
                      Re-cast all of them
                    </Button>
                  }
                />
              </Inline>
            }
          >
            <Stack gap={4}>
              {/*
                One job, watched. `JobProgress` takes a list because `People` starts one per
                cohort at once; here the list is this cohort's single job, and it is empty for
                the moment between the POST and the first read of the row it created — which is
                a real state, and the organism draws it as the work having started without
                anything to say yet (§6.3 row 18).
              */}
              {job === null ? null : (
                <JobProgress
                  jobs={watched.data === undefined ? [] : [watched.data]}
                  label="Writing them"
                />
              )}

              {told === "" ? null : (
                <Text size="meta" tone="muted" as="p">
                  {told}
                </Text>
              )}

              {failedWrite === null ? null : (
                <WhatWentWrong
                  id={writeErrorId}
                  says="Nobody was re-written. The roster below is unchanged."
                  error={failedWrite}
                />
              )}

              {rosterState === "loading" ? (
                <StateBlock
                  kind="loading"
                  what="the roster"
                  skeleton={<Skeleton variant="row" count={4} label="Reading the roster" />}
                />
              ) : rosterState === "failed" ? (
                <StateBlock kind="failed" what="the roster" error={people.error} />
              ) : rosterState === "empty" ? (
                <StateBlock kind="empty" what="this cohort's roster">
                  Nobody in this cohort yet. Raise the headcount above and they arrive unwritten,
                  ready for a name and a sentence.
                </StateBlock>
              ) : (
                <Ledger>
                  {roster.map((person) => (
                    <PersonRow
                      key={person.id}
                      person={person}
                      cohortId={cohort.id}
                      projectKey={key}
                    />
                  ))}
                </Ledger>
              )}

              {putAside.length === 0 ? null : (
                <MetaSentence>
                  {`${peopleWord(putAside.length)} ${putAside.length === 1 ? "is" : "are"} put aside: ${putAside.map((person) => person.name).join(", ")}. Grow the cohort and they come back exactly as they were.`}
                </MetaSentence>
              )}
            </Stack>
          </Section>
        </Stack>
      )}
    </DocumentPage>
  );
}

/**
 * One person, and the product's only inline editor. A person is a name, a handle and a sentence,
 * so the editor is two fields and nothing else — anything more would be the persona leaking into
 * the individual (SPEC §9).
 *
 * The stub is the person's number in the cohort, which is the locator the ledger column exists
 * for: it is how a roster of twelve is read against a population screen that names the same
 * people in the same order.
 */
function PersonRow({
  person,
  cohortId,
  projectKey,
}: {
  person: PersonView;
  cohortId: string;
  projectKey: string;
}) {
  const queries = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(person.name);
  const [details, setDetails] = useState(person.details);
  const errorId = useId();

  /**
   * Where focus goes when the row swaps what it is. An editor that opens leaves focus on a button
   * that has just been unmounted, which drops the caret to the top of the document — so opening
   * moves focus to the first thing there is to type in, and closing puts it back on the control
   * the reader pressed to get here. Radix does this for a dialog; an editor drawn in place has to
   * do it for itself (§6, "Keyboard operation").
   */
  const firstField = useRef<HTMLInputElement>(null);
  const edit = useRef<HTMLButtonElement>(null);
  const [returning, setReturning] = useState(false);

  useEffect(() => {
    if (editing) firstField.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!returning || editing) return;
    edit.current?.focus();
    setReturning(false);
  }, [returning, editing]);

  const close = (): void => {
    setReturning(true);
    setEditing(false);
  };

  const save = useMutation({
    mutationFn: () => api.savePerson(projectKey, cohortId, person.ordinal, { name, details }),
    onSuccess: async () => {
      close();
      await queries.invalidateQueries();
    },
  });

  return (
    <LedgerRow
      stub={
        <Text size="meta" tone="muted">
          {person.ordinal + 1}
        </Text>
      }
    >
      {editing ? (
        <Stack gap={3}>
          <Field label="Their name">
            {({ id, describedBy, invalid }) => (
              <Input
                ref={firstField}
                id={id}
                describedBy={describedBy}
                invalid={invalid}
                value={name}
                onChange={setName}
              />
            )}
          </Field>

          <Field label="One sentence about them">
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                describedBy={describedBy}
                invalid={invalid}
                value={details}
                onChange={setDetails}
                placeholder="What they came to do, in one line."
              />
            )}
          </Field>

          <Inline gap={2} align="center">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                save.mutate();
              }}
              disabled={save.isPending}
              pending={save.isPending}
              aria-describedby={save.isError ? errorId : undefined}
            >
              Save
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={close}
            >
              Cancel
            </Button>
          </Inline>

          {save.isError ? (
            <WhatWentWrong
              id={errorId}
              says="They were not saved. What is in the two boxes above is still only here."
              error={save.error}
            />
          ) : null}
        </Stack>
      ) : (
        <Inline gap={3} align="start">
          <Stack gap={1} className="min-w-0">
            <Heading level={3} size="name">
              {person.name}
            </Heading>
            <Text size="read-sm" tone={person.details === "" ? "muted" : "soft"} as="p">
              {person.details === "" ? "No details yet." : person.details}
            </Text>
            <Mono size="code-sm">{person.handle}</Mono>
          </Stack>

          <Spacer />

          <Button
            ref={edit}
            variant="quiet"
            size="sm"
            className="shrink-0"
            aria-label={`Edit ${person.name}`}
            onClick={() => {
              setEditing(true);
            }}
          >
            Edit
          </Button>
        </Inline>
      )}
    </LedgerRow>
  );
}

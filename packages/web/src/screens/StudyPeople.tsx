import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TraitValue } from "@populace/core/isomorphic";

import { api, isRefused, type PersonView } from "../api.js";
import { keys, q } from "../queries.js";
import { useProject, useStudy } from "../context.jsx";
import { people as peopleWord, plural } from "../format.js";
import {
  Button,
  ConfirmButton,
  DocumentPage,
  Field,
  FieldGrid,
  FieldWarning,
  Heading,
  Inline,
  Input,
  JobProgress,
  KeyValueEditor,
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
  Text,
  Tooltip,
  WhatWentWrong,
  type StateKind,
} from "../design/index.js";

/**
 * The people one study sends (ADR-0041), and the product's only inline editor.
 *
 * **Why they are read here and nowhere else.** A person is numbered on their cohort and persona
 * — `cohortSlug.personaSlug#n` — and every study that sends the cohort meets the same person at
 * the same ordinal. But WHICH of them are in is this study's size dealt through its population's
 * weights, so the study is the only thing that can say who goes, and the cohort screen that
 * used to list them (`library/Cohort.tsx`) no longer names anybody. The rows come back in deal
 * order — member order, then mix order, then ordinal — which is why the groups below need no
 * sorting of their own.
 *
 * **A row is shared.** A line written here follows the person into every study that sends the
 * cohort. The page says so once at the top, and each row that is also sent elsewhere says how
 * many other studies that is, so a reader editing somebody knows who else will meet the change.
 *
 * **Not yet written is a state, not an error.** A study saved a moment ago has dealt its people
 * but a model has not filled them in yet; the response counts them as `missing` beside the rows
 * that exist, so `items.length + missing === sends` and this page can say "3 not yet written"
 * without a second request. "Write their details" is the job that fills them (SPEC §5.4). It is
 * refused while any execution in the project is going — the people in it are frozen — and the
 * button is at a bound with that reason rather than gone (§6.5).
 *
 * **Rewriting is destructive and says so before it happens.** It replaces people that executions
 * already name, so it goes through a confirm whose body carries the consequence: a rewritten
 * person is a different person, and the problem an earlier execution recorded against the old
 * one keeps that old name (§7.3).
 *
 * This is level four: names are allowed here, because this is where you decide who they are.
 */
export function StudyPeople() {
  const { key, project, href } = useProject();
  const { key: studyKey, study, href: studyHref } = useStudy();
  const queries = useQueryClient();
  const view = useQuery(q.studyPeople(key, studyKey));

  const [job, setJob] = useState<string | null>(null);
  const [told, setTold] = useState("");
  const watched = useQuery({ ...q.job(job ?? ""), enabled: job !== null, refetchInterval: 1_000 });
  const writing = watched.data?.status === "queued" || watched.data?.status === "running";

  /**
   * What a finished job moves: the people (their rows), the study (its counts) and the project
   * (its person count). Named keys, never `invalidateQueries()` bare, which refetched every live
   * query in the app to learn that three sentences had been written.
   */
  const refresh = async (): Promise<void> => {
    await Promise.all([
      queries.invalidateQueries({ queryKey: keys.studyPeople(key, studyKey) }),
      queries.invalidateQueries({ queryKey: keys.study(key, studyKey) }),
      queries.invalidateQueries({ queryKey: keys.project(key) }),
    ]);
  };

  useEffect(() => {
    if (job === null || watched.data === undefined || writing) return;
    // Without an API key the writer succeeds with the free seeded cast, so what it managed is
    // said out loud rather than left to be inferred from rows that did not change.
    setTold(watched.data.error ?? watched.data.progress.label);
    setJob(null);
    void refresh();
    // `refresh` is rebuilt every render; the effect is about the job landing, not about it.
  }, [job, watched.data, writing]);

  const write = useMutation({ mutationFn: () => api.writeStudyPeople(key, studyKey), onSuccess: (started) => setJob(started.id) });
  const rewrite = useMutation({ mutationFn: () => api.regenerateStudyPeople(key, studyKey), onSuccess: (started) => setJob(started.id) });
  // Two ways to write the roster, one message: whichever failed is the one quoted.
  const failedWrite = write.error ?? rewrite.error;
  const writeErrorId = useId();
  const boundId = useId();

  const items = view.data?.items ?? [];
  const missing = view.data?.missing ?? 0;
  const sends = view.data?.sends ?? study.sends;
  const unwritten = items.filter((person) => person.details === "").length;

  /**
   * Why the writer cannot be pressed, or `undefined`. The first is the server's own rule, said
   * here rather than after a round trip; the second is that there is nothing for it to do. The
   * bound is local knowledge and can trail the server — an execution that started after this
   * page loaded refuses the POST with a 409 — so a refusal that does arrive is shown below in
   * the server's own words, not folded into this sentence.
   */
  const running = project.runningRunIds.length > 0;
  const writeBound: string | undefined = running
    ? "Nobody is written while an execution is going: the people in it are frozen until it stops."
    : unwritten === 0 && missing === 0
      ? "Everybody here has their details."
      : undefined;
  const rewriteBound: string | undefined = running ? writeBound : items.length === 0 ? "There is nobody to rewrite yet." : undefined;

  const state: StateKind | undefined = view.isPending ? "loading" : view.isError ? "failed" : sends === 0 ? "empty" : undefined;

  return (
    <DocumentPage
      header={
        <PageHeader
          title="People"
          eyebrow={study.name}
          crumbs={[{ label: "Studies", to: href() }, { label: study.name, to: studyHref() }, { label: "People" }]}
          meta={[
            { key: "size", node: sends === study.size ? peopleWord(study.size) : `${peopleWord(sends)} of ${String(study.size)} asked for` },
            { key: "cohorts", node: plural(study.population.cohorts, "cohort") },
          ]}
          actions={
            <Inline gap={2} align="center" wrap>
              {writeBound === undefined ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    write.mutate();
                  }}
                  disabled={writing || write.isPending}
                  pending={write.isPending}
                >
                  {writing ? "Writing them…" : "Write their details"}
                </Button>
              ) : (
                <Tooltip content={writeBound}>
                  <Button variant="secondary" size="sm" atBound aria-describedby={boundId}>
                    Write their details
                  </Button>
                </Tooltip>
              )}
              {rewriteBound === undefined ? (
                <ConfirmButton
                  title="Rewrite all of them?"
                  body="Everybody this study sends is replaced, including the people past executions name. Rewriting changes who these people are, so the same problem found by the same person in an earlier execution no longer has the same name against it — and every other study that sends these cohorts meets the new people too."
                  confirmLabel="Rewrite all of them"
                  pending={rewrite.isPending}
                  onConfirm={() => {
                    rewrite.mutate();
                  }}
                >
                  <Button variant="quiet" size="sm" disabled={writing || rewrite.isPending}>
                    Rewrite all of them
                  </Button>
                </ConfirmButton>
              ) : (
                <Tooltip content={rewriteBound}>
                  <Button variant="quiet" size="sm" atBound aria-describedby={boundId}>
                    Rewrite all of them
                  </Button>
                </Tooltip>
              )}
            </Inline>
          }
        />
      }
      state={state}
      loading={<StateBlock kind="loading" what="the people" skeleton={<Skeleton variant="row" count={6} label="Reading the people" />} />}
      error={<StateBlock kind="failed" what="the people" error={view.error} />}
      empty={
        <StateBlock kind="empty" what="this study's people">
          <Stack gap={3} align="start">
            <span>
              {study.size === 0
                ? "This study sends nobody: its size is nought."
                : `This study asks for ${peopleWord(study.size)} and sends nobody, because no cohort in ${study.population.name} has personas to draw from.`}
            </span>
            <Link to={studyHref("edit")} size="ui">
              {study.size === 0 ? "Give it a size" : "Change the study"}
            </Link>
          </Stack>
        </StateBlock>
      }
    >
      <Stack gap={12}>
        <MetaSentence>
          {peopleWord(sends)}; this study meets the first of each cohort. A line you write here follows them into every study that sends the
          cohort.{" "}
          <Link to={studyHref("edit")} size="meta">
            Change the size
          </Link>
        </MetaSentence>

        {/* The bound, said where the controls at it can point (§6.5). */}
        {writeBound === undefined && rewriteBound === undefined ? null : (
          <div id={boundId}>
            <FieldWarning>{writeBound ?? rewriteBound}</FieldWarning>
          </div>
        )}

        {missing === 0 ? null : (
          <Text size="read-sm" tone="soft" as="p">
            {`${String(missing)} of them ${missing === 1 ? "is" : "are"} not written yet. “Write their details” writes them; so does sending them in.`}
          </Text>
        )}

        {/*
          One job, watched. `JobProgress` takes a list; here it is this study's single job, and it
          is empty for the moment between the POST and the first read of the row it created —
          which is a real state, and the organism draws it as the work having started without
          anything to say yet (§6.3 row 18).
        */}
        {job === null ? null : <JobProgress jobs={watched.data === undefined ? [] : [watched.data]} label="Writing them" />}

        {told === "" ? null : (
          <Text size="meta" tone="muted" as="p">
            {told}
          </Text>
        )}

        {/* A 409 is the server declining, and its sentence says why; anything else is a failure to reach it. Both quote the server beneath. */}
        {failedWrite === null ? null : (
          <WhatWentWrong
            id={writeErrorId}
            says={isRefused(failedWrite) ? "Nobody was written: the server declined, and says why below. The people below are unchanged." : "Nobody was written. The people below are unchanged."}
            error={failedWrite}
          />
        )}

        {items.length === 0 ? null : (
          groupOf(items).map((cohort) => (
            <Section key={cohort.cohortSlug} title={cohort.cohortName} trailing={peopleWord(cohort.kinds.reduce((n, kind) => n + kind.people.length, 0))}>
              <Stack gap={6}>
                {cohort.kinds.map((kind) => (
                  <Stack key={kind.personaSlug} gap={2}>
                    <Text size="meta" tone="muted" as="p">
                      {`${kind.personaName} in ${cohort.cohortName}`}
                    </Text>
                    <Ledger stubLabel="Person">
                      {kind.people.map((person) => (
                        <PersonRow key={person.id} person={person} projectKey={key} studyKey={studyKey} />
                      ))}
                    </Ledger>
                  </Stack>
                ))}
              </Stack>
            </Section>
          ))
        )}
      </Stack>
    </DocumentPage>
  );
}

/** A cohort's people, by the persona each is drawn from, in the order the deal listed them. */
interface CohortGroup {
  cohortSlug: string;
  cohortName: string;
  kinds: { personaSlug: string; personaName: string; people: PersonView[] }[];
}

/**
 * Cohort, then persona-in-cohort, in first-appearance order — which is deal order, because the
 * server lists them that way and nothing here re-sorts. The internal name for a cohort-and-
 * persona pair is never printed; the heading is "First-time visitors in Mobile signups".
 */
function groupOf(items: readonly PersonView[]): CohortGroup[] {
  const out: CohortGroup[] = [];
  for (const person of items) {
    let cohort = out.find((c) => c.cohortSlug === person.cohortSlug);
    if (cohort === undefined) {
      cohort = { cohortSlug: person.cohortSlug, cohortName: person.cohortName, kinds: [] };
      out.push(cohort);
    }
    let kind = cohort.kinds.find((k) => k.personaSlug === person.personaSlug);
    if (kind === undefined) {
      kind = { personaSlug: person.personaSlug, personaName: person.personaName, people: [] };
      cohort.kinds.push(kind);
    }
    kind.people.push(person);
  }
  return out;
}

/**
 * One person, and the product's only inline editor. Moved here from the cohort screen when the
 * people got a page of their own (ADR-0041); the cohort is no longer where anybody is named.
 *
 * A person is a name, a handle, a sentence — and the sampled dimensions, set by hand if wanted
 * (ADR-0031 amendment): patience, budget, traits. That is as much individuality as a person
 * carries; goals and tool policy would be the persona leaking into the individual. What was set
 * by hand is marked, and "Use the draw again" hands those dimensions back to the sample.
 *
 * The stub is the person's number among their kind in this cohort, which is the locator the
 * ledger column exists for: it is how a roster is read against an execution's cast that names
 * the same people in the same order.
 */
function PersonRow({ person, projectKey, studyKey }: { person: PersonView; projectKey: string; studyKey: string }) {
  const queries = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(person.name);
  const [details, setDetails] = useState(person.details);
  const [patience, setPatience] = useState(person.patience);
  const [budget, setBudget] = useState(person.budgetUsd);
  const [traits, setTraits] = useState<Record<string, string>>(Object.fromEntries(Object.entries(person.traits).map(([k, v]) => [k, String(v)])));
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

  /** Opening starts from the row as it is now, not as it was when this row first rendered. */
  const open = (): void => {
    setName(person.name);
    setDetails(person.details);
    setPatience(person.patience);
    setBudget(person.budgetUsd);
    setTraits(Object.fromEntries(Object.entries(person.traits).map(([k, v]) => [k, String(v)])));
    setEditing(true);
  };

  const byHand = person.overrides.patience !== undefined || person.overrides.budgetUsd !== undefined || Object.keys(person.overrides.traits).length > 0;

  /** The people of this study, and the study whose counts they are. The row is shared, and so is the refetch. */
  const refresh = async (): Promise<void> => {
    await Promise.all([
      queries.invalidateQueries({ queryKey: keys.studyPeople(projectKey, studyKey) }),
      queries.invalidateQueries({ queryKey: keys.study(projectKey, studyKey) }),
    ]);
  };

  const save = useMutation({
    /*
      Only what moved becomes an override: a dimension left at its effective value stays the
      sample's, so opening the editor and pressing Save pins nothing by accident. The traits go as
      the WHOLE override map, because the PATCH replaces that map rather than merging into it — and
      they go only when the map differs from the one the person already carries, so fixing a
      spelling in their name leaves their traits exactly as they were.
    */
    mutationFn: () => {
      const byHandTraits = handSetTraits(traits, person);
      return api.saveStudyPerson(projectKey, studyKey, person.id, {
        name,
        details,
        ...(patience === person.patience ? {} : { patience }),
        ...(budget === person.budgetUsd ? {} : { budgetUsd: budget }),
        ...(sameTraits(byHandTraits, person.overrides.traits) ? {} : { traits: byHandTraits }),
      });
    },
    onSuccess: async () => {
      close();
      await refresh();
    },
  });
  const redraw = useMutation({
    mutationFn: () => api.saveStudyPerson(projectKey, studyKey, person.id, { patience: null, budgetUsd: null, traits: null }),
    onSuccess: refresh,
  });

  return (
    <LedgerRow stub={person.ordinal + 1}>
      {editing ? (
        <Stack gap={3}>
          <Field label="Their name">
            {({ id, describedBy, invalid }) => <Input ref={firstField} id={id} describedBy={describedBy} invalid={invalid} value={name} onChange={setName} />}
          </Field>

          <Field label="One sentence about them">
            {({ id, describedBy, invalid }) => (
              <Input id={id} describedBy={describedBy} invalid={invalid} value={details} onChange={setDetails} placeholder="What they came to do, in one line." />
            )}
          </Field>

          <FieldGrid cols={2}>
            <Field label="Patience" hint="1 gives up at the first snag; 5 grinds through anything.">
              {({ id, describedBy, invalid }) => (
                <NumberInput id={id} describedBy={describedBy} invalid={invalid} value={patience} onChange={setPatience} min={1} max={5} />
              )}
            </Field>
            <Field label="Would pay, per month" hint="In dollars. Zero means free only.">
              {({ id, describedBy, invalid }) => <NumberInput id={id} describedBy={describedBy} invalid={invalid} value={budget} onChange={setBudget} min={0} />}
            </Field>
          </FieldGrid>

          {/*
            Every trait they carry is in here, whichever layer it came from, because overriding one
            is typing over it. What differs per row is what the remove control can honestly do: a
            trait set on this person goes, and a trait their persona or cohort gave them cannot go
            — there is nothing on the person to take away — so for that one the control puts the
            inherited value back rather than pretending to delete the trait, and the row says so
            under the box. The mark is the row's own value cell, which is the editor's affordance
            for exactly this: what a value IS stays the caller's.
          */}
          <KeyValueEditor
            addLabel="Add a trait of their own"
            addPlaceholder="device"
            empty="No traits. They carry whatever their persona and cohort gave them."
            onAdd={(trait) => {
              setTraits((current) => ({ ...current, [trait]: "" }));
            }}
            onRemove={(trait) => {
              setTraits((current) =>
                traitSource(person, trait) === "inherited"
                  ? { ...current, [trait]: String(person.traits[trait] ?? "") }
                  : Object.fromEntries(Object.entries(current).filter(([other]) => other !== trait)),
              );
            }}
            rows={Object.entries(traits).map(([trait, value]) => {
              const source = traitSource(person, trait);
              return {
                key: trait,
                value: (
                  <Stack gap={1}>
                    <Input
                      value={value}
                      onChange={(v) => {
                        setTraits((current) => ({ ...current, [trait]: v }));
                      }}
                    />
                    {source === "inherited" ? (
                      <Text size="meta" tone="muted" as="p">
                        From their persona or cohort. Type over it and it becomes theirs; remove puts back what they were given.
                      </Text>
                    ) : source === "by hand" ? (
                      <Text size="meta" tone="muted" as="p">
                        Set by hand. Remove clears it, and whatever their persona and cohort say applies again.
                      </Text>
                    ) : null}
                  </Stack>
                ),
              };
            })}
          />

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
            <Button variant="secondary" size="sm" onClick={close}>
              Cancel
            </Button>
          </Inline>

          {save.isError ? <WhatWentWrong id={errorId} says="They were not saved. What is in the boxes above is still only here." error={save.error} /> : null}
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
            <Text size="meta" tone="muted" as="p">
              {dimensions(person)}
            </Text>
            {person.alsoSentBy > 0 ? (
              <Text size="meta" tone="muted" as="p">
                {`also sent by ${plural(person.alsoSentBy, "other study", "other studies")}`}
              </Text>
            ) : null}
            <Mono size="code-sm">{person.handle}</Mono>
          </Stack>

          <Spacer />

          <Inline gap={2} align="center" className="shrink-0">
            {byHand ? (
              <Button
                variant="quiet"
                size="sm"
                onClick={() => {
                  redraw.mutate();
                }}
                disabled={redraw.isPending}
              >
                Use the draw again
              </Button>
            ) : null}
            <Button ref={edit} variant="quiet" size="sm" aria-label={`Edit ${person.name}`} onClick={open}>
              Edit
            </Button>
          </Inline>
        </Inline>
      )}
    </LedgerRow>
  );
}

/** "patience 2 · $0 · device=phone", with what was set by hand marked as such. */
function dimensions(person: PersonView): string {
  const hand = person.overrides;
  const parts = [
    `patience ${String(person.patience)}${hand.patience === undefined ? "" : " (by hand)"}`,
    `$${String(person.budgetUsd)}/month${hand.budgetUsd === undefined ? "" : " (by hand)"}`,
    ...Object.entries(person.traits).map(([trait, value]) => `${trait}=${String(value)}${trait in hand.traits ? " (by hand)" : ""}`),
  ];
  return parts.join(" · ");
}

/**
 * Where a trait the editor shows came from, which is the only thing that decides what may be done
 * to it. `person.traits` is the effective layering — the persona's draw, then the cohort's overlay,
 * then what was set by hand — and `person.overrides.traits` is that last layer alone, so a key
 * missing from it belongs to the persona or the cohort and cannot be taken off this person at all;
 * the most anybody can do to it here is override it. A key in neither map is one the reader has
 * just added, which is an override the moment it is saved.
 */
function traitSource(person: PersonView, trait: string): "by hand" | "inherited" | "new" {
  if (trait in person.overrides.traits) return "by hand";
  return trait in person.traits ? "inherited" : "new";
}

/**
 * The override map a save sends: what the reader actually set, and nothing the layering already
 * gave them. The PATCH replaces the map wholesale, so a key still theirs has to be in it and a key
 * no longer theirs has to be absent — which is how a row the reader deleted clears its override.
 *
 * A key stays when it was already an override (it is theirs even if they never retyped it), when
 * the person has no such trait at all (they just added it), or when its value differs from the
 * effective one (they have just overridden what they inherited). Everything else is the persona's
 * or the cohort's: sending those back would freeze a drawn value onto the person as if somebody
 * had chosen it, which is what the editor opening on the effective traits used to do to all of
 * them the moment anything else in the row was saved.
 */
function handSetTraits(edited: Record<string, string>, person: PersonView): Record<string, string> {
  return Object.fromEntries(
    Object.entries(edited).filter(([trait, value]) => traitSource(person, trait) !== "inherited" || value !== String(person.traits[trait])),
  );
}

/** Whether two trait maps say the same thing, compared as they print. */
function sameTraits(a: Record<string, string>, b: Record<string, TraitValue>): boolean {
  const left = Object.entries(a)
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  const right = Object.entries(b)
    .map(([k, v]) => `${k}=${String(v)}`)
    .sort();
  return left.length === right.length && left.every((entry, i) => entry === right[i]);
}

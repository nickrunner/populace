import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import type { ToolPolicy as ToolPolicyShape, TraitValue } from "@populace/core/isomorphic";
import { api, type CohortView, type PersonView } from "../../api.js";
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
  KeyValueEditor,
  Ledger,
  LedgerRow,
  Link,
  Measure,
  MetaSentence,
  Mono,
  NumberInput,
  PageHeader,
  Repeater,
  Section,
  Select,
  Skeleton,
  Spacer,
  Stack,
  StateBlock,
  Text,
  TextArea,
  ToolPolicyEditor,
  Input,
  WhatWentWrong,
  type StateKind,
} from "../../design/index.js";

/**
 * One cohort and the people in it.
 *
 * **What a cohort is** (ADR-0039): a shared condition — `context`, required, addressed to its
 * people and handed to every one of them under their persona's backstory — and a mix of personas
 * in a ratio. On top of that, what the cohort applies to everyone in it: fixed traits, a tool
 * policy that can only narrow, a model override, a cadence and a visit cap. What it does NOT
 * have is a size: how many go is the population's decision, and the header says which casts
 * send them and at how many.
 *
 * This is the first screen in the product that names anybody, and it does it because this is
 * where you decide who they are. A person carries a name, a handle, a sentence — and, since the
 * ADR-0031 amendment, whatever was set on them by hand out of the sampled dimensions: patience,
 * budget, traits. Goals and tool policy still belong to the persona; the moment a person could
 * carry those, the persona would stop being a template and the cohort would stop meaning anything.
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

  const personas = useQuery(q.personas(key));

  const [draft, setDraft] = useState<Draft | null>(null);
  const [job, setJob] = useState<string | null>(null);
  const [told, setTold] = useState("");

  useEffect(() => {
    if (cohort === undefined || draft !== null) return;
    setDraft(draftOf(cohort));
  }, [cohort, draft]);

  const set = <K extends keyof Draft>(field: K, value: Draft[K]): void => {
    setDraft((current) => (current === null ? current : { ...current, [field]: value }));
  };

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
    mutationFn: () => {
      const d = draft ?? draftOf(cohort as CohortView);
      return api.saveCohort(key, cohort?.id ?? "", {
        context: d.context,
        mix: d.mix.map((entry) => ({ personaId: entry.personaId, weight: entry.weight })),
        traits: d.traits,
        tools: d.tools,
        model: {
          ...(d.model.model === "" ? {} : { model: d.model.model }),
          ...(d.model.effort === "" ? {} : { effort: d.model.effort as ToolEffort }),
        },
        cadence: d.every === 0 ? null : { every: d.every * 1000 },
        maxVisits: d.cap === 0 ? null : d.cap,
      });
    },
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
                Drawn from{" "}
                {cohort.mix.map((entry, index) => (
                  <span key={entry.personaId}>
                    {index === 0 ? "" : cohort.mix.length > 1 && index === cohort.mix.length - 1 ? " and " : ", "}
                    {cohort.mix.length > 1 ? `${String(entry.weight)} ` : ""}
                    <Link to={href(`library/personas/${encodeURIComponent(entry.personaId)}`)}>{entry.personaName}</Link>
                  </span>
                ))}
                .{" "}
                {cohort.usedByPopulations.length === 0
                  ? "No population sends them yet, so there is nobody in it; the number is set on the population."
                  : `Sent as ${cohort.usedByPopulations.map((population) => `${peopleWord(population.size)} in ${population.name}`).join(", ")}.`}
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
          <Section title="What they share">
            <Stack gap={4}>
              <Measure width="read">
                <Text as="p" size="read-sm" tone="soft">
                  Addressed to them, and told to every one of them under their persona&rsquo;s
                  backstory. It is what makes this a cohort rather than a saved recipe.
                </Text>
              </Measure>
              <Card>
                <Field
                  label="What everybody in this cohort has in common"
                  error={draft !== null && draft.context.trim() === "" ? "A cohort shares something. Say what it is." : undefined}
                >
                  {({ id, describedBy, invalid }) => (
                    <TextArea
                      id={id}
                      describedBy={describedBy}
                      invalid={invalid}
                      value={draft?.context ?? ""}
                      onChange={(v) => {
                        set("context", v);
                      }}
                      rows={3}
                      placeholder="You only ever use this on your phone, usually while doing something else."
                    />
                  )}
                </Field>
              </Card>
            </Stack>
          </Section>

          <Section title="Who they are drawn from">
            <Stack gap={4}>
              <Measure width="read">
                <Text as="p" size="read-sm" tone="soft">
                  One persona, or several in a ratio. Weights are a ratio, not percentages: 3 and 2
                  is three of one for every two of the other, at whatever size a population sends.
                  Growing never takes anybody away; a persona taken out of the mix puts its people
                  aside, and putting it back restores them.
                </Text>
              </Measure>
              <Card>
                <Repeater
                  legend="The mix"
                  addLabel="Mix in another persona"
                  minReason="A cohort is drawn from at least one persona."
                  onAdd={() => {
                    const first = (personas.data?.items ?? []).find((persona) => !(draft?.mix ?? []).some((entry) => entry.personaId === persona.id));
                    if (first !== undefined) set("mix", [...(draft?.mix ?? []), { personaId: first.id, weight: 1 }]);
                  }}
                  onRemove={(index) => {
                    set("mix", (draft?.mix ?? []).filter((_, j) => j !== index));
                  }}
                  items={(draft?.mix ?? []).map((entry, i) => ({
                    id: entry.personaId,
                    label: `${String(i + 1)}. ${cohort.mix.find((known) => known.personaId === entry.personaId)?.personaName ?? (personas.data?.items ?? []).find((persona) => persona.id === entry.personaId)?.spec.name ?? "Persona"}`,
                    fields: (
                      <FieldGrid cols={2}>
                        <Field label="Persona">
                          {({ id, describedBy, invalid }) => (
                            <Select
                              id={id}
                              describedBy={describedBy}
                              invalid={invalid}
                              value={entry.personaId}
                              onChange={(personaId) => {
                                set("mix", (draft?.mix ?? []).map((other, j) => (j === i ? { ...other, personaId } : other)));
                              }}
                              options={(personas.data?.items ?? []).map((persona) => ({
                                value: persona.id,
                                label: persona.spec.name,
                                disabled: persona.id !== entry.personaId && (draft?.mix ?? []).some((other) => other.personaId === persona.id),
                              }))}
                            />
                          )}
                        </Field>
                        <Field label="Weight" hint={sizeSentence(cohort, draft, i)}>
                          {({ id, describedBy, invalid }) => (
                            <NumberInput
                              id={id}
                              describedBy={describedBy}
                              invalid={invalid}
                              value={entry.weight}
                              onChange={(weight) => {
                                set("mix", (draft?.mix ?? []).map((other, j) => (j === i ? { ...other, weight: Math.max(1, weight) } : other)));
                              }}
                              min={1}
                            />
                          )}
                        </Field>
                      </FieldGrid>
                    ),
                  }))}
                />
              </Card>
            </Stack>
          </Section>

          <Section title="What the cohort applies to all of them">
            <Stack gap={4}>
              <Measure width="read">
                <Text as="p" size="read-sm" tone="soft">
                  Over whatever their persona gave them. A trait set here wins over the persona&rsquo;s
                  draw; a tool policy here can only narrow; a model here beats the persona&rsquo;s own.
                  Left empty, nothing changes.
                </Text>
              </Measure>
              <Card>
                <Stack gap={6}>
                  <KeyValueEditor
                    addLabel="Add a shared trait"
                    addPlaceholder="device"
                    empty="No shared traits. Each person keeps whatever their persona drew for them."
                    onAdd={(name) => {
                      set("traits", { ...(draft?.traits ?? {}), [name]: "" });
                    }}
                    onRemove={(name) => {
                      set("traits", Object.fromEntries(Object.entries(draft?.traits ?? {}).filter(([other]) => other !== name)));
                    }}
                    rows={Object.entries(draft?.traits ?? {}).map(([trait, value]) => ({
                      key: trait,
                      value: (
                        <Input
                          value={String(value)}
                          onChange={(v) => {
                            set("traits", { ...(draft?.traits ?? {}), [trait]: v });
                          }}
                        />
                      ),
                    }))}
                  />

                  <FieldGrid cols={2}>
                    <Field label="Model" hint="Layered over the persona's and under the simulation's.">
                      {({ id, describedBy, invalid }) => (
                        <Select
                          id={id}
                          describedBy={describedBy}
                          invalid={invalid}
                          value={draft?.model.model ?? ""}
                          onChange={(v) => {
                            set("model", { ...(draft?.model ?? { model: "", effort: "" }), model: v });
                          }}
                          options={MODELS}
                        />
                      )}
                    </Field>
                    <Field label="Effort">
                      {({ id, describedBy, invalid }) => (
                        <Select
                          id={id}
                          describedBy={describedBy}
                          invalid={invalid}
                          value={draft?.model.effort ?? ""}
                          onChange={(v) => {
                            set("model", { ...(draft?.model ?? { model: "", effort: "" }), effort: v });
                          }}
                          options={EFFORTS}
                        />
                      )}
                    </Field>
                  </FieldGrid>

                  <ToolPolicyEditor
                    policy={draft?.tools ?? { allow: [], deny: [], destructive: "confirm" }}
                    onChange={(tools) => {
                      set("tools", tools);
                    }}
                    tools={null}
                    allowPlaceholder="list_*, search_*"
                    denyPlaceholder="export_*"
                    destructiveHint="A cohort may be stricter than its personas and the target, never looser."
                    whenUnknown="Globs, matched against the target's tool list when a simulation sends them. A cohort can only take tools away."
                  />
                </Stack>
              </Card>
            </Stack>
          </Section>

          <Section title="How often, and for how long">
            <Card>
              <Stack gap={6}>
                <FieldGrid cols={2} align="end">
                  <DurationField
                    label="A visit every"
                    hint="Zero follows the simulation's own cadence."
                    unit="s"
                    valueMs={(draft?.every ?? 0) * 1000}
                    onChange={(ms) => {
                      set("every", Math.round(ms / 1000));
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
                        value={draft?.cap ?? 0}
                        onChange={(cap) => {
                          set("cap", cap);
                        }}
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
                    disabled={save.isPending || draft === null || draft.context.trim() === "" || draft.mix.length === 0}
                    pending={save.isPending}
                  >
                    Save the cohort
                  </Button>
                  <Text size="meta" tone="muted">
                    Saving re-draws the lanes at the size every cast sends; nobody who stays is touched.
                  </Text>
                </Inline>

                {save.isError ? (
                  <WhatWentWrong
                    id={saveErrorId}
                    says="Nothing was written. What is above is still yours to send again."
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
                  Nobody in this cohort yet. Put it in a population and set how many go; they
                  arrive unwritten, ready for a name and a sentence.
                </StateBlock>
              ) : (
                <Stack gap={6}>
                  {lanesOf(roster).map((lane) => (
                    <Stack key={lane.laneSlug} gap={2}>
                      {lanesOf(roster).length > 1 ? (
                        <Text size="meta" tone="muted" as="p">
                          {`${peopleWord(lane.people.length)} drawn from ${lane.personaName}`}
                        </Text>
                      ) : null}
                      <Ledger>
                        {lane.people.map((person) => (
                          <PersonRow key={person.id} person={person} cohortId={cohort.id} projectKey={key} />
                        ))}
                      </Ledger>
                    </Stack>
                  ))}
                </Stack>
              )}

              {putAside.length === 0 ? null : (
                <MetaSentence>
                  {`${peopleWord(putAside.length)} ${putAside.length === 1 ? "is" : "are"} put aside: ${putAside.map((person) => person.name).join(", ")}. Send more of this cohort, or put their persona back in the mix, and they come back exactly as they were.`}
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
 * One person, and the product's only inline editor.
 *
 * A person is a name, a handle, a sentence — and the sampled dimensions, set by hand if wanted
 * (ADR-0031 amendment): patience, budget, traits. That is as much individuality as a person
 * carries; goals and tool policy would be the persona leaking into the individual. What was set
 * by hand is marked, and "Use the draw again" hands those dimensions back to the sample.
 *
 * The stub is the person's number in their lane, which is the locator the ledger column exists
 * for: it is how a roster is read against a population screen that names the same people in the
 * same order.
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

  const byHand = person.overrides.patience !== undefined || person.overrides.budgetUsd !== undefined || Object.keys(person.overrides.traits).length > 0;

  const save = useMutation({
    // Only what moved becomes an override: a dimension left at its effective value stays the
    // sample's, so opening the editor and pressing Save pins nothing by accident.
    mutationFn: () =>
      api.savePerson(projectKey, cohortId, person.id, {
        name,
        details,
        ...(patience === person.patience ? {} : { patience }),
        ...(budget === person.budgetUsd ? {} : { budgetUsd: budget }),
        ...(sameTraits(traits, person.traits) ? {} : { traits: { ...person.overrides.traits, ...traits } }),
      }),
    onSuccess: async () => {
      close();
      await queries.invalidateQueries();
    },
  });
  const redraw = useMutation({
    mutationFn: () => api.savePerson(projectKey, cohortId, person.id, { patience: null, budgetUsd: null, traits: null }),
    onSuccess: () => queries.invalidateQueries(),
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

          <FieldGrid cols={2}>
            <Field label="Patience" hint="1 gives up at the first snag; 5 grinds through anything.">
              {({ id, describedBy, invalid }) => (
                <NumberInput id={id} describedBy={describedBy} invalid={invalid} value={patience} onChange={setPatience} min={1} max={5} />
              )}
            </Field>
            <Field label="Would pay, per month" hint="In dollars. Zero means free only.">
              {({ id, describedBy, invalid }) => (
                <NumberInput id={id} describedBy={describedBy} invalid={invalid} value={budget} onChange={setBudget} min={0} />
              )}
            </Field>
          </FieldGrid>

          <KeyValueEditor
            addLabel="Add a trait of their own"
            addPlaceholder="device"
            empty="No traits. They carry whatever their persona and cohort gave them."
            onAdd={(key) => {
              setTraits((current) => ({ ...current, [key]: "" }));
            }}
            onRemove={(key) => {
              setTraits((current) => Object.fromEntries(Object.entries(current).filter(([other]) => other !== key)));
            }}
            rows={Object.entries(traits).map(([trait, value]) => ({
              key: trait,
              value: (
                <Input
                  value={value}
                  onChange={(v) => {
                    setTraits((current) => ({ ...current, [trait]: v }));
                  }}
                />
              ),
            }))}
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
              says="They were not saved. What is in the boxes above is still only here."
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
            <Text size="meta" tone="muted" as="p">
              {dimensions(person)}
            </Text>
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
            <Button
              ref={edit}
              variant="quiet"
              size="sm"
              aria-label={`Edit ${person.name}`}
              onClick={() => {
                setEditing(true);
              }}
            >
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

function sameTraits(edited: Record<string, string>, effective: Record<string, TraitValue>): boolean {
  const a = Object.entries(edited).map(([k, v]) => `${k}=${v}`).sort();
  const b = Object.entries(effective).map(([k, v]) => `${k}=${String(v)}`).sort();
  return a.length === b.length && a.every((entry, i) => entry === b[i]);
}

/** The roster by lane — one per persona in the mix — in the order the store lists them. */
function lanesOf(roster: readonly PersonView[]): { laneSlug: string; personaName: string; people: PersonView[] }[] {
  const out: { laneSlug: string; personaName: string; people: PersonView[] }[] = [];
  for (const person of roster) {
    const lane = out.find((l) => l.laneSlug === person.laneSlug);
    if (lane) lane.people.push(person);
    else out.push({ laneSlug: person.laneSlug, personaName: person.personaName, people: [person] });
  }
  return out;
}

// ---- the editable slice of a cohort ------------------------------------------------------------

type ToolEffort = NonNullable<CohortView["model"]["effort"]>;

interface Draft {
  context: string;
  mix: { personaId: string; weight: number }[];
  traits: Record<string, TraitValue>;
  tools: ToolPolicyShape;
  model: { model: string; effort: string };
  /** Seconds; zero follows the simulation. */
  every: number;
  /** Visits; zero follows the simulation. */
  cap: number;
}

function draftOf(cohort: CohortView): Draft {
  return {
    context: cohort.context,
    mix: cohort.mix.map((entry) => ({ personaId: entry.personaId, weight: entry.weight })),
    traits: { ...cohort.traits },
    tools: cohort.tools,
    model: { model: cohort.model.model ?? "", effort: cohort.model.effort ?? "" },
    every: cohort.cadence?.every === undefined ? 0 : Math.round(cohort.cadence.every / 1000),
    cap: cohort.maxVisits ?? 0,
  };
}

/** What this weight comes to at the size the cohort is sent, by the server's own arithmetic. */
function sizeSentence(cohort: CohortView, draft: Draft | null, index: number): string {
  if (cohort.size === 0) return "How many of them, relative to the others.";
  const saved = cohort.mix.find((entry) => entry.personaId === draft?.mix[index]?.personaId);
  return saved === undefined ? `At ${String(cohort.size)} people, decided when you save.` : `At ${String(cohort.size)} people: ${String(saved.people)} of them, as saved.`;
}

const MODELS: readonly { value: string; label: string }[] = [
  { value: "", label: "Whatever the persona or project uses" },
  { value: "claude-opus-5", label: "Opus 5 — the most capable, and the most expensive" },
  { value: "claude-sonnet-5", label: "Sonnet 5 — a good default for the people" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5 — cheapest, for wide populations" },
];

const EFFORTS: readonly { value: string; label: string }[] = [
  { value: "", label: "Whatever the persona or project uses" },
  ...["low", "medium", "high", "xhigh", "max"].map((effort) => ({ value: effort, label: effort })),
];

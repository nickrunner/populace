import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { dealStudy, slugify, type DealMix, type Dealt } from "@populace/core/isomorphic";

import { api, type CohortView, type PopulationView } from "../../api.js";
import { familyOf, keys, q } from "../../queries.js";
import { useProject } from "../../context.jsx";
import { useAfterCreate, useDraft, usePicked, useThen } from "../../builders.js";
import { people, plural } from "../../format.js";
import {
  BuilderPage,
  Button,
  Field,
  FieldWarning,
  Inline,
  Input,
  Link,
  MetaLine,
  Mono,
  NumberInput,
  PageHeader,
  Skeleton,
  Stack,
  StateBlock,
  Text,
  WeightedMixEditor,
  WhatWentWrong,
  type StateKind,
  type WeightedMixEntry,
  type WeightedMixOption,
} from "../../design/index.js";

/**
 * The population builder: one page that makes a population and one page that edits it, serving
 * `library/populations/new` and `library/populations/:pop` from the same file (ADR-0043).
 *
 * **A population is cohorts with weights, and nothing here is a headcount** (ADR-0041). The
 * number a population used to carry per cohort — the stepper that wrote the people — is gone; a
 * study picks a population and gives it a size, and the deal turns that one size into people
 * across these weights and then across each cohort's mix. So what the reader sets here is
 * PARTS, drawn by `WeightedMixEditor` as a meter and a percentage, and never people.
 *
 * **"Try a size" is a preview and only a preview.** It is a local number, twenty by default,
 * never saved and never sent: the screen runs `dealStudy` — the server's own arithmetic,
 * exported from core for exactly this — over the weights on the form and each cohort's mix from
 * the library, and hands the counts to the editor and a sentence per persona-in-cohort to the
 * rail. A reader balancing 3 : 1 gets to see that at twenty people that is fifteen and five, and
 * that a light persona in a light cohort gets nobody until the study is bigger — before any
 * study exists. The tie rule is stated beside it, because it is a rule (earlier cohort, then
 * earlier persona) and not an accident of the arithmetic.
 *
 * **Create mode persists a draft and chains** (`builders.ts`). A population with no cohorts to
 * pick from sends the reader to the cohort builder with `?then=` pointing back here; the cohort
 * builder returns with `?picked=<id>` and the new cohort is added to the mix at one part. The
 * draft rides in `sessionStorage` under this route so the hop loses nothing, and it is cleared
 * on success, on Cancel and on "Start blank". Edit mode persists nothing: the server holds the
 * truth, and `SaveBar` reports dirtiness against it.
 *
 * **Edit mode says what a weight change does.** When studies send this population, changing a
 * weight moves people in every one of them (ADR-0039 accepts this), and the mix carries that
 * sentence so it is read before the save rather than discovered on a People page.
 *
 * **The slug is set once.** In create mode it follows the name until the reader types one; in
 * edit mode it is a fact beside the name, because it is in every address that names this
 * population and renaming it would break each of them.
 *
 * The record is read from the populations list rather than by id, because the URL may carry the
 * slug (every screen that links to a population by name does) and the by-id route answers only to
 * an id. The list is one request and is already cached from the page the reader almost always
 * came from.
 */

/** One cohort on the form: which, and how many parts. The same shape the wire takes. */
const MemberDraftSchema = z.object({ cohortId: z.string().min(1), weight: z.number().positive() });

/**
 * The form, as the draft stores it. `slug` is null while it follows the name and a string once
 * the reader has typed one, so the draft remembers which of the two it was.
 */
const DraftSchema = z.object({
  name: z.string(),
  slug: z.string().nullable(),
  members: z.array(MemberDraftSchema),
});
type Draft = z.infer<typeof DraftSchema>;

const blank = (): Draft => ({ name: "", slug: null, members: [] });

/** The server's own rule for a slug, so the form refuses what the server would refuse. */
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** The size the preview opens at: big enough that a 3 : 1 mix shows two numbers, small enough to read. */
const TRY_SIZE = 20;

/** The saved record as a form, for edit mode's baseline. */
function formOf(population: PopulationView): Draft {
  return {
    name: population.name,
    slug: null,
    members: population.members.map((member) => ({ cohortId: member.cohortId, weight: member.weight })),
  };
}

/** Whether two forms would send the same PUT. Order matters: member order is the tie order. */
function same(a: Draft, b: Draft): boolean {
  if (a.name.trim() !== b.name.trim() || a.members.length !== b.members.length) return false;
  return a.members.every((member, i) => member.cohortId === b.members[i]?.cohortId && member.weight === b.members[i]?.weight);
}

/** The one fact beside a cohort's name in the mix: the first sentence of what its people share. */
function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = /^[\s\S]*?[.!?](?=\s|$)/.exec(trimmed);
  return match?.[0] ?? trimmed;
}

/** One line of the preview: a persona in a cohort, and how many of them a size would send. */
interface PreviewLine {
  key: string;
  text: string;
  /** Nobody at this size — set in the quieter ink, because it is the absence the reader is looking for. */
  nobody: boolean;
}

/**
 * The deal in product words, one line per persona in each cohort, in deal order. A cohort with no
 * personas keeps its share of the size and sends nobody, which is the line that tells a reader
 * the cohort still needs a mix.
 */
function previewLines(dealt: Dealt, entries: readonly WeightedMixEntry[], byId: ReadonlyMap<string, CohortView>): PreviewLine[] {
  return dealt.cohorts.flatMap((dealtCohort, index) => {
    const cohort = byId.get(dealtCohort.cohortId);
    const name = entries[index]?.name ?? "";
    if (cohort === undefined) return [];
    if (cohort.mix.length === 0) {
      return [{ key: dealtCohort.cohortId, text: `${name} has no personas yet, so its share sends nobody.`, nobody: true }];
    }
    return dealtCohort.lanes.map((share) => {
      const persona = cohort.mix.find((entry) => entry.personaId === share.personaId)?.personaName ?? "Someone";
      const key = `${dealtCohort.cohortId}/${share.personaId}`;
      return share.count === 0
        ? { key, text: `${persona} in ${name} would send nobody at this size`, nobody: true }
        : { key, text: `${persona} in ${name}: ${share.count}`, nobody: false };
    });
  });
}

export function PopulationBuilder() {
  const { pop } = useParams();
  const isCreate = pop === undefined;
  const { key, href } = useProject();
  const queries = useQueryClient();
  const navigate = useNavigate();
  const go = useAfterCreate();
  const { linkTo, returnTo, fromBuilder } = useThen();
  const [params] = useSearchParams();

  const cohorts = useQuery(q.cohorts(key));
  const populations = useQuery({ ...q.populations(key), enabled: !isCreate });
  const population = isCreate ? undefined : populations.data?.items.find((candidate) => candidate.id === pop || candidate.slug === pop);

  // Two sources of form state, one form. Create mode is the persisted draft; edit mode is the
  // reader's edits laid over the saved record, null while they have made none, so that "dirty"
  // is a fact about the edits and a refetch of the record never marks a form the reader has not
  // touched.
  const draft = useDraft(DraftSchema, blank, { enabled: isCreate });
  const [edited, setEdited] = useState<Draft | null>(null);
  const baseline = useMemo(() => (population === undefined ? null : formOf(population)), [population]);
  const form: Draft = isCreate ? draft.draft : (edited ?? baseline ?? blank());
  const { setDraft } = draft;
  const setForm = useCallback(
    (update: (prev: Draft) => Draft) => {
      if (isCreate) setDraft(update);
      else setEdited((prev) => update(prev ?? baseline ?? blank()));
    },
    [isCreate, setDraft, baseline],
  );

  const all = cohorts.data?.items ?? [];
  const byId = useMemo(() => new Map(all.map((cohort) => [cohort.id, cohort])), [all]);
  const cohortIds = useMemo(() => all.map((cohort) => cohort.id), [all]);

  // A cohort made in the builder this page sent the reader to comes back as `?picked=`; it joins
  // the mix at one part, once, and only if it is not already there.
  const pick = useCallback(
    (id: string) => {
      setForm((prev) => (prev.members.some((member) => member.cohortId === id) ? prev : { ...prev, members: [...prev.members, { cohortId: id, weight: 1 }] }));
    },
    [setForm],
  );
  usePicked(cohortIds, pick);

  const options: WeightedMixOption[] = all.map((cohort) => ({ id: cohort.id, name: cohort.name, detail: firstSentence(cohort.context) }));
  // A member whose cohort is gone — possible only for a draft, since a held cohort cannot be
  // deleted — is not shown, and the next change to the mix writes the list back without it.
  const entries: WeightedMixEntry[] = form.members.flatMap((member) => {
    const cohort = byId.get(member.cohortId);
    return cohort === undefined ? [] : [{ id: cohort.id, name: cohort.name, detail: firstSentence(cohort.context), weight: member.weight }];
  });

  // ---- the preview -----------------------------------------------------------------------
  const [trySize, setTrySize] = useState(TRY_SIZE);
  const size = Number.isFinite(trySize) ? Math.max(0, Math.floor(trySize)) : 0;
  const mixes: DealMix[] = all.map((cohort) => ({
    cohortId: cohort.id,
    entries: cohort.mix.map((entry) => ({ personaId: entry.personaId, weight: entry.weight })),
  }));
  const dealt = dealStudy(
    size,
    entries.map((entry) => ({ cohortId: entry.id, weight: entry.weight })),
    mixes,
  );
  const previewCounts = dealt.cohorts.map((cohort) => cohort.count);
  const previewSentence =
    entries.length === 0
      ? undefined
      : `At ${people(size)}: ${dealt.cohorts.map((cohort, index) => `${cohort.count} from ${entries[index]?.name ?? ""}`).join(", ")}.`;
  const lines = previewLines(dealt, entries, byId);

  // ---- what stops the act ----------------------------------------------------------------
  const name = form.name.trim();
  const shownSlug = form.slug ?? slugify(name);
  const slugError =
    form.slug !== null && form.slug !== "" && !SLUG.test(form.slug)
      ? "Lower-case letters, digits and hyphens, starting with a letter or a digit."
      : shownSlug === "new"
        ? "“new” is where a population is made, so one cannot be called that."
        : undefined;
  const blockedBecause =
    name === "" ? "Give it a name first." : isCreate && slugError !== undefined ? "The slug needs fixing first." : entries.length === 0 ? "Add at least one cohort first." : undefined;

  // ---- the writes ------------------------------------------------------------------------
  const members = entries.map((entry) => ({ cohortId: entry.id, weight: entry.weight }));

  /** The list, the counts on the overview, the setup's needs; on a save, every study's deal too. */
  const settle = async (alsoStudies: boolean): Promise<void> => {
    await Promise.all([
      queries.invalidateQueries({ queryKey: keys.populations(key) }),
      queries.invalidateQueries({ queryKey: keys.project(key) }),
      queries.invalidateQueries({ queryKey: keys.setup(key) }),
      ...(alsoStudies
        ? [
            queries.invalidateQueries({ queryKey: keys.studies(key) }),
            queries.invalidateQueries({ queryKey: familyOf(keys.study("", "")) }),
            queries.invalidateQueries({ queryKey: familyOf(keys.studyPeople("", "")) }),
          ]
        : []),
    ]);
  };

  const create = useMutation({
    mutationFn: () => api.createPopulation(key, { name, ...(form.slug === null ? {} : { slug: form.slug }), members }),
    onSuccess: async (made) => {
      // The list first, so a builder this page returns to finds the new population in its
      // options and can apply `picked`; then the draft goes, because it is saved now.
      await settle(false);
      draft.clear();
      go(returnTo(made.id, href(`library/populations/${encodeURIComponent(made.id)}`)));
    },
  });

  const [savedAt, setSavedAt] = useState<string | null>(null);
  const save = useMutation({
    // What was sent rides along as the mutation's variable, so what comes back is judged against
    // the form as it was at the press and not against the form as it is now.
    mutationFn: (sent: Draft) => {
      if (population === undefined) throw new Error("there is no population to save");
      const sentName = sent.name.trim();
      return api.savePopulation(key, population.id, { ...(sentName === population.name ? {} : { name: sentName }), members: sent.members });
    },
    onSuccess: async (_saved, sent) => {
      // A weight change re-deals every study that sends this population, so their summaries and
      // their people are stale along with the list.
      await settle(true);
      // Dropping the edits hands the form back to the saved record — right only when the reader
      // has not typed since the press. A form that moved while the save was in flight keeps what
      // they typed and stays dirty, because throwing away a keystroke to report a success is a
      // worse answer than asking them to save again.
      setEdited((prev) => (prev === null || same(prev, sent) ? null : prev));
      setSavedAt(new Date().toISOString());
    },
  });

  const dirty = !isCreate && edited !== null && baseline !== null && !same(edited, baseline);

  // Where Cancel goes: back to the builder that sent the reader here, when one did and it is in
  // this project, and otherwise to the list. Without `picked`, because nothing was made.
  const incoming = params.get("then");
  const back = incoming !== null && incoming.startsWith(href()) ? incoming : href("library/populations");
  const cancel = (): void => {
    if (isCreate) draft.clear();
    void navigate(back);
  };

  // ---- the states ------------------------------------------------------------------------
  const state: StateKind | undefined =
    cohorts.isPending || (!isCreate && populations.isPending)
      ? "loading"
      : cohorts.isError || (!isCreate && populations.isError)
        ? "failed"
        : !isCreate && population === undefined
          ? "gone"
          : undefined;

  const what = isCreate ? "this project's cohorts" : "this population";
  const title = isCreate ? "New population" : (population?.name ?? "This population");

  const header = (
    <PageHeader
      eyebrow="Population"
      title={title}
      crumbs={[{ label: "Populations", to: href("library/populations") }, { label: isCreate ? "New" : (population?.name ?? pop) }]}
      lede="Which cohorts go, and in what ratio. There is no headcount here: a study picks this population and says how many, and the weights decide how many of each."
    />
  );

  const slots = {
    header,
    state,
    loading: <StateBlock kind="loading" what={what} skeleton={<Skeleton variant="row" count={3} height={56} width="wide" label={`Reading ${what}`} />} />,
    error: (
      <StateBlock kind="failed" what={what} error={cohorts.error ?? populations.error}>
        <Button
          variant="secondary"
          onClick={() => {
            void cohorts.refetch();
            if (!isCreate) void populations.refetch();
          }}
        >
          Try again
        </Button>
      </StateBlock>
    ),
    gone: (
      <StateBlock kind="gone" what={what}>
        <Stack gap={6} align="start">
          <div>There is no population called {pop} in this project. It may have been renamed, or deleted.</div>
          <Button asChild variant="primary">
            <Link to={href("library/populations")}>See the populations there are</Link>
          </Button>
        </Stack>
      </StateBlock>
    ),
  };

  const rail = (
    <>
      <Field
        label="Try a size"
        hint="A preview and nothing more. The size belongs to the study that sends this population; this number is not saved."
      >
        {({ id, describedBy }) => <NumberInput id={id} describedBy={describedBy} value={trySize} min={0} step={1} onChange={setTrySize} />}
      </Field>

      <Stack gap={2}>
        <Text as="div" size="label" tone="muted">
          {`At ${people(size)}`}
        </Text>
        {entries.length === 0 ? (
          <Text as="p" size="read-sm" tone="soft">
            Add a cohort to see who would go.
          </Text>
        ) : (
          <Stack gap={1} as="ul">
            {lines.map((line) => (
              <Text key={line.key} as="li" size="meta" tone={line.nobody ? "muted" : "soft"}>
                {line.text}
              </Text>
            ))}
          </Stack>
        )}
        {entries.length === 0 || dealt.sends === size ? null : (
          <Text as="p" size="meta" tone="muted">
            {`${people(dealt.sends)} of ${size} would go; the rest fall to a cohort with no personas.`}
          </Text>
        )}
        <Text as="p" size="meta" tone="muted">
          Ties go to the cohort listed first, then to the persona listed first in its mix.
        </Text>
      </Stack>
    </>
  );

  const body = (
    <Stack gap={8}>
      {isCreate && draft.restored ? (
        <Inline gap={3} align="center">
          <Text size="meta" tone="muted">
            Draft restored.
          </Text>
          <Button variant="quiet" size="sm" onClick={draft.startBlank}>
            Start blank
          </Button>
        </Inline>
      ) : null}

      <Stack gap={4}>
        <Field label="Name" hint="Soak cast, Sceptics only, Everyone on mobile.">
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              describedBy={describedBy}
              invalid={invalid}
              value={form.name}
              onChange={(value) => {
                setForm((prev) => ({ ...prev, name: value }));
              }}
            />
          )}
        </Field>

        {isCreate ? (
          <Field
            label="Slug"
            hint="Follows the name until you set it. It goes in this population's address and never changes afterwards."
            {...(slugError === undefined ? {} : { error: slugError })}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                describedBy={describedBy}
                invalid={invalid}
                mono
                value={shownSlug}
                onChange={(value) => {
                  // Emptied, it follows the name again; anything typed is the reader's.
                  setForm((prev) => ({ ...prev, slug: value === "" ? null : value }));
                }}
              />
            )}
          </Field>
        ) : population === undefined ? null : (
          <MetaLine
            facts={[
              { key: "slug", node: <Mono size="code-sm">{population.slug}</Mono> },
              { key: "slug-note", node: "the slug, in every address that names this population; it never changes" },
            ]}
          />
        )}
      </Stack>

      <Stack gap={3}>
        <WeightedMixEditor
          legend="Cohorts"
          entries={entries}
          options={options}
          onChange={(next) => {
            setForm((prev) => ({ ...prev, members: next.map((entry) => ({ cohortId: entry.id, weight: entry.weight })) }));
          }}
          addLabel="Add a cohort"
          min={1}
          minReason="A population keeps at least one cohort. Delete the population instead."
          emptyState={
            <StateBlock kind="empty" what="this project's cohorts">
              There are no cohorts to put in it yet. A cohort is people who share something, drawn from one or more personas.{" "}
              <Link to={linkTo(href("library/cohorts/new"))} size="ui">
                Make the first cohort
              </Link>
            </StateBlock>
          }
          {...(entries.length === 0 ? {} : { previewCounts })}
          {...(previewSentence === undefined ? {} : { previewSentence })}
        />
        {all.length === 0 ? null : (
          <Link to={linkTo(href("library/cohorts/new"))} size="meta">
            Make a new cohort
          </Link>
        )}
        {!isCreate && population !== undefined && population.usedBy > 0 ? (
          <FieldWarning>
            {`Changing weights moves people in the ${plural(population.usedBy, "study", "studies")} that ${population.usedBy === 1 ? "sends" : "send"} this population.`}
          </FieldWarning>
        ) : null}
      </Stack>

      {create.isError ? <WhatWentWrong says="It was not made. Nothing was saved." error={create.error} /> : null}
      {save.isError ? <WhatWentWrong says="It was not saved. The population is as it was." error={save.error} /> : null}
    </Stack>
  );

  if (isCreate) {
    return (
      <BuilderPage
        mode="create"
        {...slots}
        rail={rail}
        actLabel={fromBuilder ? "Make this population and go back" : "Make this population"}
        pending={create.isPending}
        onAct={() => {
          create.mutate();
        }}
        {...(blockedBecause === undefined ? {} : { blockedBecause })}
        note="Nothing is sent and nothing is spent: a population is a recipe until a study picks it and gives it a size."
        onCancel={cancel}
      >
        {body}
      </BuilderPage>
    );
  }

  return (
    <BuilderPage
      mode="edit"
      {...slots}
      rail={rail}
      dirty={dirty}
      saving={save.isPending}
      onSave={() => {
        // The snapshot is the form as the press found it, members included, which is exactly what
        // the PUT carries; `onSuccess` compares the live form with it.
        save.mutate({ name: form.name, slug: form.slug, members });
      }}
      savedAt={savedAt}
      {...(dirty
        ? {
            onDiscard: () => {
              setEdited(null);
            },
          }
        : {})}
      {...(blockedBecause === undefined ? {} : { blockedBecause })}
      {...(fromBuilder ? { onCancel: cancel } : {})}
    >
      {body}
    </BuilderPage>
  );
}

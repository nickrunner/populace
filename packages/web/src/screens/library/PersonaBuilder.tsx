import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { EffortSchema, slugify, type TraitSpec, type TraitValue, type ToolPolicy as ToolPolicyShape } from "@populace/core/isomorphic";
import { PersonaSpecInputSchema, type PersonaPreviewBody } from "@populace/contract";
import { api, isMissing, type Persona, type Starter, type StoredTarget, type TargetCheck } from "../../api.js";
import { keys, q } from "../../queries.js";
import { useProject } from "../../context.jsx";
import { useAfterCreate, useDraft, useThen } from "../../builders.js";
import { plural } from "../../format.js";
import {
  AlertDialog,
  Avatar,
  BuilderPage,
  Button,
  Card,
  Disclosure,
  Field,
  FieldError,
  FieldGrid,
  Input,
  KeyValueEditor,
  Ledger,
  LedgerRow,
  Measure,
  Mono,
  NameWithRole,
  NumberInput,
  PageHeader,
  PayloadBlock,
  Radio,
  RadioGroup,
  SamplePreview,
  ScaleField,
  Section,
  Select,
  Skeleton,
  Stack,
  StateBlock,
  TagListField,
  Text,
  TextArea,
  ToolPolicyEditor,
  Tooltip,
  WhatWentWrong,
  type PolicyTool,
  type StateKind,
} from "../../design/index.js";

/**
 * The builder that decides whether any of this is worth reading.
 *
 * Nothing else in the product changes the findings as much: a persona with a real errand finds
 * real problems, and a persona told to "test the search" files a test report. So the two things
 * that are easy to get wrong are shown rather than described — the tool policy is matched against
 * the target's actual tool list as you type, and the prompt the model will be handed is rendered
 * from the draft by the runner's own code, before anything is saved (product judge gap #6).
 *
 * One screen serves `library/personas/new` and `library/personas/:x` (ADR-0043). It is a
 * `BuilderPage`: in create mode the foot is an `ActionBar` whose act is named in the product's
 * words, the draft survives a hop to another builder through `useDraft`, and the six starters are
 * offered at the top as a place to begin rather than as a list of their own. In edit mode the
 * foot is a `SaveBar`, the server holds the truth and nothing is persisted locally. What went
 * with the old editor: `SplitPage` and `FormPane` (the builder template composes `FormBody` and
 * the right bar itself), the "Save this persona and the prompt is rendered" empty state (the
 * preview reads the draft now), and the first-target guess the preview used to make — which
 * target the prompt is OF is chosen on this page when the project holds more than one, exactly
 * as the server refuses to guess (ADR-0035).
 *
 * A persona picks nothing from another builder, so there is no `usePicked` here; `useThen` is
 * what lets the cohort builder send a reader here and get them back with what they made.
 */

/**
 * The form's state, and the shape of what survives a hop. `spec` is the wire's own input schema
 * with its four `min` rules taken off: a draft is a form the reader has not finished, and a draft
 * with no errand yet is still a draft — the wire's rules are said in the bar, not applied to what
 * is stored. A stale draft whose SHAPE no longer parses is simply not a draft (ADR-0001). `slug`
 * is empty while it is derived from the name and holds the reader's spelling once they have
 * touched it; `starter` remembers which starter the draft began from, which is what
 * `origin: "starter"` is built from.
 */
const DraftSchema = z.object({
  spec: PersonaSpecInputSchema.extend({
    name: z.string(),
    role: z.string(),
    backstory: z.string(),
    goals: z.array(z.string()),
  }),
  slug: z.string(),
  starter: z.string().nullable(),
});
type Draft = z.infer<typeof DraftSchema>;
type Spec = Draft["spec"];

const blank = (): Draft => ({
  spec: {
    name: "",
    role: "",
    backstory: "",
    goals: [],
    constraints: [],
    patience: 3,
    budgetUsd: 0,
    traits: {},
    tools: { allow: [], deny: [], destructive: "allow" },
    model: {},
  },
  slug: "",
  starter: null,
});

/** One spelling of "these two drafts are the same", for dirtiness and for "has the reader typed yet". */
const serialize = (value: object): string => JSON.stringify(value);

/** A stored spec less its `id`, which is the slug's and never edited here. */
function specOf(persona: Persona): Spec {
  const { id: _id, ...spec } = persona.spec;
  return spec;
}

/** The slug rule the server applies, and the one slug it reserves for this very page. */
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/**
 * The sentence each patience value puts in the prompt, from `personaSystemPrompt`. The preview
 * below is the authority; this is here so the slider means something while you drag it.
 */
const PATIENCE: Record<number, string> = {
  1: "You have almost no patience: one confusing step and you leave.",
  2: "You have little patience: you will try twice, then move on.",
  3: "You have ordinary patience: you tolerate a snag or two if the product seems worth it.",
  4: "You are patient: you will work around problems if you can.",
  5: "You are very patient: you will grind through almost anything to get the job done.",
};

/** A goal phrased as an instruction to a tester rather than as an errand a person has. */
const TESTER_WORDS = /\b(test|verify|validate|check that|ensure|assert|confirm that|reproduce|regression|qa)\b/i;

const MODELS: readonly { value: string; label: string }[] = [
  { value: "", label: "Whatever the project uses" },
  { value: "claude-opus-5", label: "Opus 5 — the most capable, and the most expensive" },
  { value: "claude-sonnet-5", label: "Sonnet 5 — a good default for the people" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5 — cheapest, for wide populations" },
];

const EFFORTS: readonly { value: string; label: string }[] = [
  { value: "", label: "Whatever the project uses" },
  ...EffortSchema.options.map((effort) => ({ value: effort, label: effort })),
];

/** One draw from a trait spec. The real ones are drawn per person from the cohort's seed. */
function draw(spec: TraitSpec): TraitValue {
  if (typeof spec !== "object") return spec;
  if (spec.distribution === "uniform") {
    const value = spec.min + Math.random() * (spec.max - spec.min);
    return spec.integer ? Math.round(value) : Number(value.toFixed(2));
  }
  const weights = spec.weights ?? spec.values.map(() => 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let point = Math.random() * total;
  for (const [i, value] of spec.values.entries()) {
    point -= weights[i] ?? 0;
    if (point <= 0) return value;
  }
  return spec.values[spec.values.length - 1] ?? "";
}

/**
 * A value that follows `value` after it has held still for `delay`. The preview is a POST per
 * change, and a reader typing a backstory is a change per keystroke; this is what makes it a
 * request per pause instead. `value` must be referentially stable between renders that did not
 * change it (a `useMemo`), or the timer resets on every render and never fires.
 */
function useSettled<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(handle);
  }, [value, delay]);
  return settled;
}

export function PersonaBuilder() {
  const { key, href } = useProject();
  const { x } = useParams();
  const mode: "create" | "edit" = x === undefined ? "create" : "edit";
  const queries = useQueryClient();
  const navigate = useNavigate();
  const go = useAfterCreate();
  const { returnTo, fromBuilder } = useThen();
  const [params] = useSearchParams();
  const cameFrom = params.get("then");

  const list = href("library/personas");

  // Edit mode reads one row; create mode reads the starters. Neither gates the other.
  const existing = useQuery({ ...q.persona(key, x ?? ""), enabled: mode === "edit" });
  const starters = useQuery({ ...q.starters(key), enabled: mode === "create" });
  const targets = useQuery(q.targets(key));

  /**
   * One form state for both modes. Only create mode persists it (`enabled`): in edit mode the
   * server holds the truth and the draft is seeded from the row once it has loaded.
   */
  const { draft, setDraft, restored, clear, startBlank } = useDraft(DraftSchema, blank, { enabled: mode === "create" });
  const spec = draft.spec;
  const setSpec = <K extends keyof Spec>(field: K, value: Spec[K]): void => {
    setDraft((current) => ({ ...current, spec: { ...current.spec, [field]: value } }));
  };

  // What the row said when it was read, so dirtiness is a comparison and not a flag that has to
  // be cleared in the right places. Seeded exactly once; a refetch after a save never wipes an
  // edit in progress, because the save itself moved the baseline.
  const [baseline, setBaseline] = useState<Spec | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== "edit" || baseline !== null || !existing.isSuccess) return;
    const seed = specOf(existing.data);
    setDraft({ spec: seed, slug: existing.data.slug, starter: null });
    setBaseline(seed);
    setSavedAt(existing.data.updatedAt);
  }, [mode, baseline, existing.isSuccess, existing.data, setDraft]);
  const dirty = mode === "edit" && baseline !== null && serialize(spec) !== serialize(baseline);

  /**
   * Which target the prompt and the tool policy are ABOUT. One target is the only defensible
   * default; several is a choice the reader makes on this page, in the preview section, and it
   * stands for the tool policy too. None renders the preview against a stand-in and matches the
   * policy against nothing, and the page says so in both places.
   */
  const targetList = targets.data?.items ?? [];
  const [pickedTarget, setPickedTarget] = useState<string | null>(null);

  // The model override folds away until the reader opens it — or until the persona already has
  // one, which in edit mode is only known once the draft is seeded, so the fold is controlled
  // rather than read once at mount.
  const [modelOpen, setModelOpen] = useState<boolean | null>(null);
  const overridden = spec.model.model !== undefined || spec.model.effort !== undefined;
  const target: StoredTarget | null =
    targetList.find((candidate) => candidate.id === pickedTarget) ?? targetList[0] ?? null;

  /** The slug the server will be given: the reader's spelling, or the name's, exactly as the server derives it. */
  const slug = mode === "create" ? (draft.slug !== "" ? draft.slug : slugify(spec.name)) : existing.data?.slug ?? "";

  /**
   * What the server would refuse, named in the bar rather than carried by a dead button (§6).
   * The first reason in reading order is the one said; the fields say theirs beside themselves
   * once the reader has started.
   */
  const blockers = {
    name: spec.name.trim() === "",
    role: spec.role.trim() === "",
    backstory: spec.backstory.trim() === "",
    goals: spec.goals.length === 0,
    slug: mode === "create" && !SLUG.test(slug),
    reserved: mode === "create" && slug === "new",
  };
  const blockedBecause = blockers.name
    ? "Give them a name first."
    : blockers.role
      ? "Say what kind of person this is."
      : blockers.backstory
        ? "Say why they turned up. Without a backstory they are a role and nothing else."
        : blockers.goals
          ? "Give them at least one errand to come here for."
          : blockers.slug
            ? "The slug needs lowercase letters, digits and hyphens, starting with a letter or a digit."
            : blockers.reserved
              ? "“new” is the address of this page, so a persona cannot take it as a slug."
              : undefined;
  // An untouched form is not wrong yet: the bar says what is missing and the fields stay quiet
  // until the reader has begun. A saved persona is past that point, so its fields always say.
  const touched = mode === "edit" || restored || serialize(draft) !== serialize(blank());
  const complete = !blockers.name && !blockers.role && !blockers.backstory && !blockers.goals;

  const create = useMutation({
    mutationFn: () =>
      api.createPersona(key, {
        spec,
        slug,
        ...(draft.starter === null ? {} : { origin: "starter" as const }),
      }),
    onSuccess: async (saved) => {
      // The list this page's row belongs to, BEFORE navigating, so a builder waiting on `?picked`
      // finds the new persona in its options the moment it lands (ADR-0043). The project's counts
      // move with it. Never `invalidateQueries()` bare.
      await queries.invalidateQueries({ queryKey: keys.personas(key) });
      void queries.invalidateQueries({ queryKey: keys.project(key) });
      clear();
      go(returnTo(saved.id, href(`library/personas/${encodeURIComponent(saved.id)}`)));
    },
  });

  const save = useMutation({
    mutationFn: () => api.savePersona(key, x ?? "", { spec }),
    onSuccess: async (saved) => {
      setBaseline(specOf(saved));
      setSavedAt(saved.updatedAt);
      await Promise.all([
        queries.invalidateQueries({ queryKey: keys.personas(key) }),
        queries.invalidateQueries({ queryKey: keys.persona(key, x ?? "") }),
      ]);
    },
  });

  const remove = useMutation({
    mutationFn: () => api.removePersona(key, existing.data?.id ?? ""),
    onSuccess: async () => {
      await Promise.all([
        queries.invalidateQueries({ queryKey: keys.personas(key) }),
        queries.invalidateQueries({ queryKey: keys.project(key) }),
      ]);
      void navigate(list);
    },
  });

  /** The way out. In create mode it also drops the draft: leaving on purpose is not a hop. */
  const cancel = (): void => {
    if (mode === "create") clear();
    void navigate(fromBuilder && cameFrom !== null ? cameFrom : list);
  };

  // Edit mode is loading until the draft has been seeded from the row, not merely until the row
  // has arrived: the seed lands one render after the read, and a form drawn from a blank draft in
  // that render would say every field is missing for one frame.
  const state: StateKind | undefined =
    mode === "edit" && (existing.isPending || (existing.isSuccess && baseline === null))
      ? "loading"
      : mode === "edit" && existing.isError
        ? isMissing(existing.error)
          ? "gone"
          : "failed"
        : undefined;

  const what = "this persona";
  const title = mode === "create" ? spec.name || "New persona" : existing.data?.spec.name ?? "Persona";

  const header = (
    <PageHeader
      title={title}
      crumbs={[{ label: "Personas", to: list }, { label: mode === "create" ? "New persona" : existing.data?.spec.name ?? "Persona" }]}
      eyebrow="Persona"
      meta={
        mode === "create" || existing.data === undefined
          ? undefined
          : [
              { key: "slug", node: <Mono size="code-sm">{existing.data.slug}</Mono> },
              {
                key: "slug-note",
                node: "the slug every person drawn from this persona is named from. Renaming never moves it.",
              },
            ]
      }
    />
  );

  const failedState = (
    <StateBlock kind="failed" what={what} error={existing.error}>
      <Button
        variant="secondary"
        onClick={() => {
          void existing.refetch();
        }}
      >
        Try again
      </Button>
    </StateBlock>
  );

  const goneState = (
    <StateBlock kind="gone" what={what}>
      <Stack gap={6} align="start">
        <div>This project has no persona called {x}. It may have been deleted, or the address mistyped.</div>
        <Button asChild variant="primary">
          <RouterLink to={list}>Back to the personas</RouterLink>
        </Button>
      </Stack>
    </StateBlock>
  );

  const loadingState = (
    <StateBlock
      kind="loading"
      what={what}
      skeleton={<Skeleton variant="block" height={148} count={3} label={`Reading ${what}`} />}
    />
  );

  /** Everything both modes share: the form, section by section, in the order a person is described. */
  const body = (
    <Stack gap={8}>
      {create.isError ? (
        <WhatWentWrong
          says="Nothing was made. What is on this page is still yours to send again."
          error={create.error}
        />
      ) : null}
      {save.isError ? (
        <WhatWentWrong
          says="Saving failed. Nothing here was written, and what is on this page is still yours to send again."
          error={save.error}
        />
      ) : null}
      {remove.isError ? (
        <WhatWentWrong
          says="This persona was not deleted. It is still here, and so is everything drawn from it."
          error={remove.error}
        />
      ) : null}

      {mode === "create" ? (
        <StarterPicker
          starters={starters}
          picked={draft.starter}
          restored={restored}
          onPick={(starter) => {
            setDraft({ spec: { ...starter.spec }, slug: "", starter: starter.slug });
          }}
          onStartBlank={startBlank}
        />
      ) : null}

      <Section title="Who they are">
        <Card>
          <Stack gap={6}>
            <FieldGrid cols={2}>
              <Field
                label="Name"
                hint="The kind of person, not a person: “First-time visitor”, not “Dana”."
                error={touched && blockers.name ? "A persona needs a name." : undefined}
              >
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    describedBy={describedBy}
                    invalid={invalid}
                    value={spec.name}
                    onChange={(v) => {
                      setSpec("name", v);
                    }}
                    placeholder="First-time visitor"
                  />
                )}
              </Field>
              <Field
                label="Role"
                error={touched && blockers.role ? "Say what kind of person this is." : undefined}
              >
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    describedBy={describedBy}
                    invalid={invalid}
                    value={spec.role}
                    onChange={(v) => {
                      setSpec("role", v);
                    }}
                    placeholder="someone who just heard about this"
                  />
                )}
              </Field>
            </FieldGrid>

            {mode === "create" ? (
              <Field
                label="Slug"
                hint="Derived from the name until you change it; clear it to derive it again. Every person drawn from this persona carries it in their id, and it never changes after saving."
                error={
                  touched && spec.name.trim() !== "" && (blockers.slug || blockers.reserved)
                    ? blockers.reserved
                      ? "“new” is this page's own address."
                      : "Lowercase letters, digits and hyphens, starting with a letter or a digit."
                    : undefined
                }
              >
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    describedBy={describedBy}
                    invalid={invalid}
                    value={slug}
                    onChange={(v) => {
                      setDraft((current) => ({ ...current, slug: v }));
                    }}
                    placeholder="first-time-visitor"
                    mono
                  />
                )}
              </Field>
            ) : null}

            <Field
              label="Backstory"
              hint="Line two of their prompt. Why they turned up, in their own life's terms."
              error={
                touched && blockers.backstory
                  ? "Why did they turn up? Without this they are a role and nothing else."
                  : undefined
              }
            >
              {({ id, describedBy, invalid }) => (
                <TextArea
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={spec.backstory}
                  onChange={(v) => {
                    setSpec("backstory", v);
                  }}
                  rows={8}
                  placeholder="You keep your week in your head and it keeps falling out…"
                />
              )}
            </Field>
          </Stack>
        </Card>
      </Section>

      <Section title="What they came to do">
        <Stack gap={4}>
          <Measure width="read">
            <Text as="p" size="read-sm" tone="soft">
              Errands, not instructions. What they turned up to get done, in their own terms — one
              a line.
            </Text>
          </Measure>
          <Card>
            <Stack gap={4}>
              <TagListField
                label="Errands"
                separator="newline"
                value={spec.goals}
                onChange={(goals) => {
                  setSpec("goals", goals);
                }}
                placeholder={"Get this week's tasks written down somewhere you trust\nFind the one from Tuesday again"}
              />
              {touched && blockers.goals ? (
                <FieldError>Give them at least one errand to come here for.</FieldError>
              ) : null}
              {spec.goals.some((goal) => TESTER_WORDS.test(goal)) ? (
                <Measure width="read">
                  <Text as="p" size="meta" tone="medium">
                    One of these reads like an instruction to a tester. People who are told to test
                    a product find test results; people with an errand find what is actually in the
                    way.
                  </Text>
                </Measure>
              ) : null}
            </Stack>
          </Card>
        </Stack>
      </Section>

      <Section title="What they will not do">
        <Stack gap={4}>
          <Measure width="read">
            <Text as="p" size="read-sm" tone="soft">
              Constraints, in their own voice — the things this person would not do, whatever the
              product asks. One a line, and none is fine.
            </Text>
          </Measure>
          <Card>
            <TagListField
              label="Constraints"
              separator="newline"
              value={spec.constraints}
              onChange={(constraints) => {
                setSpec("constraints", constraints);
              }}
              placeholder="You will not hand over a credit card on a first visit"
            />
          </Card>
        </Stack>
      </Section>

      <Section title="How much they will put up with">
        <Card>
          <Stack gap={8}>
            <TraitSpecField
              kind="patience"
              spec={spec.patience}
              onChange={(patience) => {
                setSpec("patience", patience);
              }}
            />
            <TraitSpecField
              kind="budget"
              spec={spec.budgetUsd}
              onChange={(budgetUsd) => {
                setSpec("budgetUsd", budgetUsd);
              }}
            />
          </Stack>
        </Card>
      </Section>

      <Traits
        traits={spec.traits}
        onChange={(traits) => {
          setSpec("traits", traits);
        }}
      />

      <PersonaToolPolicy
        policy={spec.tools}
        onChange={(tools) => {
          setSpec("tools", tools);
        }}
        projectKey={key}
        target={target}
        targetCount={targetList.length}
      />

      <Section title="What they think with">
        <Stack gap={4}>
          <Measure width="read">
            <Text as="p" size="read-sm" tone="soft">
              Left unset, both fall through to the project's own model. A cheap persona and a
              strong verifier can share one study.
            </Text>
          </Measure>
          <Disclosure label="Model override" open={modelOpen ?? overridden} onOpenChange={setModelOpen}>
            <Card>
              <FieldGrid cols={2}>
                <Field label="Model">
                  {({ id, describedBy, invalid }) => (
                    <Select
                      id={id}
                      describedBy={describedBy}
                      invalid={invalid}
                      value={spec.model.model ?? ""}
                      onChange={(v) => {
                        const { model: _model, ...rest } = spec.model;
                        setSpec("model", v === "" ? rest : { ...rest, model: v });
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
                      value={spec.model.effort ?? ""}
                      onChange={(v) => {
                        // The select's value is a string; the schema says which strings are efforts.
                        const parsed = EffortSchema.safeParse(v);
                        const { effort: _effort, ...rest } = spec.model;
                        setSpec("model", parsed.success ? { ...rest, effort: parsed.data } : rest);
                      }}
                      options={EFFORTS}
                    />
                  )}
                </Field>
              </FieldGrid>
            </Card>
          </Disclosure>
        </Stack>
      </Section>

      <PromptPreview
        projectKey={key}
        spec={spec}
        complete={complete}
        targets={targetList}
        target={target}
        onPickTarget={setPickedTarget}
      />

      {mode === "edit" && existing.data !== undefined ? (
        <DeletePersona persona={existing.data} pending={remove.isPending} onDelete={() => remove.mutate()} />
      ) : null}
    </Stack>
  );

  if (mode === "create") {
    return (
      <BuilderPage
        mode="create"
        header={header}
        actLabel={fromBuilder ? "Make this persona and go back" : "Make this persona"}
        pending={create.isPending}
        onAct={() => {
          create.mutate();
        }}
        blockedBecause={blockedBecause}
        note="Saving writes nobody: people are drawn from a persona when a study sends a cohort that mixes it."
        onCancel={cancel}
      >
        {body}
      </BuilderPage>
    );
  }

  return (
    <BuilderPage
      mode="edit"
      header={header}
      state={state}
      loading={loadingState}
      error={failedState}
      gone={goneState}
      dirty={dirty}
      saving={save.isPending}
      savedAt={savedAt}
      onSave={() => {
        save.mutate();
      }}
      onDiscard={
        baseline === null
          ? undefined
          : () => {
              // The row as it was read — or as it was last saved — put back.
              setDraft((current) => ({ ...current, spec: baseline }));
            }
      }
      blockedBecause={blockedBecause}
      note="Executions already running keep this persona as it was when they started; the next one uses it as saved."
      onCancel={fromBuilder && cameFrom !== null ? cancel : undefined}
    >
      {body}
    </BuilderPage>
  );
}

/**
 * "Start from one of these": the six starters as a picker, in create mode only.
 *
 * Picking one fills the draft from the starter's whole `spec` — it creates nothing — and the
 * starter's suggested cohort context is shown as a hint, because it is the cohort builder's to
 * apply and not this page's. "Start blank" undoes the pick and, when a draft was restored from an
 * earlier visit, drops that too; it is the one control offered for both because both are the
 * same act: begin again from nothing.
 */
function StarterPicker({
  starters,
  picked,
  restored,
  onPick,
  onStartBlank,
}: {
  starters: UseQueryResult<{ items: Starter[] }>;
  picked: string | null;
  restored: boolean;
  onPick: (starter: Starter) => void;
  onStartBlank: () => void;
}) {
  const items = starters.data?.items ?? [];
  const chosen = items.find((starter) => starter.slug === picked);

  return (
    <Section
      title="Start from one of these"
      trailing={items.length === 0 ? undefined : `${plural(items.length, "kind of person", "kinds of person")} who find different things`}
      actions={
        picked !== null || restored ? (
          <Button variant="quiet" size="sm" onClick={onStartBlank}>
            Start blank
          </Button>
        ) : undefined
      }
    >
      <Stack gap={4}>
        {restored ? (
          <Text as="p" size="meta" tone="muted">
            Draft restored: what you had here before is back.
          </Text>
        ) : null}

        {starters.isPending ? (
          <StateBlock
            kind="loading"
            what="the starters"
            skeleton={<Skeleton variant="row" count={6} label="Reading the starters" />}
          />
        ) : starters.isError ? (
          <StateBlock kind="failed" what="the starters" error={starters.error}>
            <Button
              variant="secondary"
              onClick={() => {
                void starters.refetch();
              }}
            >
              Try again
            </Button>
          </StateBlock>
        ) : (
          <Ledger stubKind="mark">
            {items.map((starter) => (
              <LedgerRow
                key={starter.slug}
                stub={<Avatar name={starter.name} size="sm" />}
                selected={starter.slug === picked}
                onClick={() => {
                  onPick(starter);
                }}
              >
                <Stack gap={1} className="min-w-0">
                  <NameWithRole name={starter.name} role={starter.role} />
                  <Text size="meta" tone="muted">
                    {starter.summary}
                  </Text>
                </Stack>
              </LedgerRow>
            ))}
          </Ledger>
        )}

        {chosen === undefined ? null : (
          <Measure width="read">
            <Text as="p" size="read-sm" tone="soft">
              Started from {chosen.name}. Everything below is yours to change. When people of this
              kind go into a cohort, it suggests what they share — “{chosen.context}” — and the
              cohort builder offers that line as a first draft.
            </Text>
          </Measure>
        )}
      </Stack>
    </Section>
  );
}

/**
 * A `TraitSpec` is either one value for everybody or a draw per person, and the two are one
 * control here because a reader choosing between them should see them as two answers to one
 * question. Patience and budget are the two a persona always carries (the schema names them),
 * so the fixed control knows what it is: a five-step scale with a sentence per step, or dollars.
 *
 * A spec written in a config file as "one of these values" is shown for what it is, with the two
 * ways of changing it beside it; nothing here edits a choice distribution, because nothing in the
 * product has ever needed to.
 */
function TraitSpecField({
  kind,
  spec,
  onChange,
}: {
  kind: "patience" | "budget";
  spec: TraitSpec;
  onChange: (spec: TraitSpec) => void;
}) {
  const label = kind === "patience" ? "Patience" : "What they would pay, a month";
  const bounds = kind === "patience" ? { min: 1, max: 5, integer: true, step: 1 } : { min: 0, max: 200, integer: false, step: 5 };
  const way: "fixed" | "range" | "choice" =
    typeof spec === "number" ? "fixed" : typeof spec === "object" && spec.distribution === "uniform" ? "range" : "choice";
  const fixed = typeof spec === "number" ? spec : kind === "patience" ? 3 : 0;
  const range = typeof spec === "object" && spec.distribution === "uniform" ? spec : { distribution: "uniform" as const, min: bounds.min, max: bounds.max, integer: bounds.integer };

  return (
    <Stack gap={4}>
      <RadioGroup
        name={`${kind}-way`}
        legend={label}
        orientation="horizontal"
        value={way}
        onChange={(next) => {
          if (next === "fixed") onChange(fixed);
          else if (next === "range") onChange(range);
        }}
      >
        <Radio value="fixed" label="One value for everybody" />
        <Radio
          value="range"
          label="Drawn per person from a range"
          hint="A cohort of twelve holds twelve different answers, drawn from the cohort's seed."
        />
        {way === "choice" ? (
          <Radio value="choice" label="One of a set" hint="Written in a config file. Pick either of the others to change it here." />
        ) : null}
      </RadioGroup>

      {way === "fixed" ? (
        kind === "patience" ? (
          <ScaleField
            label="How much"
            min={bounds.min}
            max={bounds.max}
            value={fixed}
            onChange={onChange}
            describe={(v) => PATIENCE[v] ?? ""}
          />
        ) : (
          <Field label="Dollars a month" hint="Zero means they are not willing to pay for this kind of product, and the prompt says so.">
            {({ id, describedBy, invalid }) => (
              <div className="w-40">
                <NumberInput id={id} describedBy={describedBy} invalid={invalid} value={fixed} onChange={onChange} min={0} step={bounds.step} />
              </div>
            )}
          </Field>
        )
      ) : way === "range" ? (
        <FieldGrid cols={2}>
          <Field label="Lowest">
            {({ id, describedBy, invalid }) => (
              <NumberInput
                id={id}
                describedBy={describedBy}
                invalid={invalid}
                value={range.min}
                onChange={(v) => {
                  onChange({ ...range, min: v, max: Math.max(v, range.max) });
                }}
                min={bounds.min}
                max={kind === "patience" ? bounds.max : undefined}
                step={bounds.step}
              />
            )}
          </Field>
          <Field label="Highest">
            {({ id, describedBy, invalid }) => (
              <NumberInput
                id={id}
                describedBy={describedBy}
                invalid={invalid}
                value={range.max}
                onChange={(v) => {
                  onChange({ ...range, max: v, min: Math.min(v, range.min) });
                }}
                min={bounds.min}
                max={kind === "patience" ? bounds.max : undefined}
                step={bounds.step}
              />
            )}
          </Field>
        </FieldGrid>
      ) : (
        <Measure width="read">
          <Text as="p" size="read-sm" tone="soft">
            {typeof spec === "object"
              ? spec.distribution === "choice"
                ? `One of ${spec.values.map(String).join(", ")}, drawn per person.`
                : `Anything from ${String(spec.min)} to ${String(spec.max)}, drawn per person.`
              : `Fixed at ${String(spec)}.`}
          </Text>
        </Measure>
      )}
    </Stack>
  );
}

/** Traits are whatever this product needs them to be; the prompt prints them as `key=value`. */
function Traits({ traits, onChange }: { traits: Spec["traits"]; onChange: (traits: Spec["traits"]) => void }) {
  const entries = Object.entries(traits);
  const samples = useMemo(() => Array.from({ length: 5 }, () => entries.map(([trait, spec]) => `${trait}=${String(draw(spec))}`).join(", ")), [traits]);

  return (
    <Section title="What tells them apart">
      <Stack gap={4}>
        <Measure width="read">
          <Text as="p" size="read-sm" tone="soft">
            One line in the prompt, and a draw per person.
          </Text>
        </Measure>
        <Card>
          <Stack gap={6}>
            <KeyValueEditor
              addLabel="Add a trait"
              addPlaceholder="device"
              empty="No traits. Everyone drawn from this persona is alike apart from their name and their detail line."
              onAdd={(name) => {
                onChange({ ...traits, [name]: "" });
              }}
              onRemove={(name) => {
                onChange(Object.fromEntries(entries.filter(([other]) => other !== name)));
              }}
              rows={entries.map(([trait, spec]) => ({
                key: trait,
                value:
                  typeof spec === "object" ? (
                    <Text size="read-sm" tone="soft">
                      {spec.distribution === "uniform"
                        ? `anything from ${String(spec.min)} to ${String(spec.max)}`
                        : `one of ${spec.values.map(String).join(", ")}`}
                    </Text>
                  ) : (
                    <Input
                      value={String(spec)}
                      onChange={(v) => {
                        onChange({ ...traits, [trait]: v });
                      }}
                    />
                  ),
              }))}
            />

            {entries.length > 0 ? (
              <SamplePreview
                label="Five draws from this"
                samples={samples}
                note="Examples of what the spec can produce. The real draws are made per person from the cohort's seed."
              />
            ) : null}
          </Stack>
        </Card>
      </Stack>
    </Section>
  );
}

/**
 * The persona's own policy, matched against the target's tool list — and against the target's own
 * policy underneath it, which is the honest part: a glob here can only ever take more away.
 *
 * The merge and the list are `ToolPolicyEditor`, shared with the target editor (§6.3 rows 22–23).
 * What stays here is what only a screen can do: which target is the floor, and asking it for its
 * tools. With exactly one target that one is the floor without a word; with several, the one
 * chosen for the preview is; with none there is no floor and nothing to match, and the sentence
 * says so.
 */
function PersonaToolPolicy({
  policy,
  onChange,
  projectKey,
  target,
  targetCount,
}: {
  policy: ToolPolicyShape;
  onChange: (policy: ToolPolicyShape) => void;
  projectKey: string;
  target: StoredTarget | null;
  targetCount: number;
}) {
  const [checked, setChecked] = useState<{ targetId: string; result: TargetCheck } | null>(null);
  const check = useMutation({
    mutationFn: (targetId: string) => api.checkTarget(projectKey, targetId),
    onSuccess: (result, targetId) => {
      setChecked({ targetId, result });
    },
  });

  // A check is of ONE target; switching target throws the list away rather than showing the
  // other target's tools under this one's name.
  const tools: PolicyTool[] | null =
    target !== null && checked?.targetId === target.id
      ? checked.result.tools.map((tool) => ({ name: tool.name, description: tool.description, destructive: tool.destructive }))
      : null;

  return (
    <Section title="What they are allowed to touch">
      <Stack gap={4}>
        <Measure width="read">
          <Text as="p" size="read-sm" tone="soft">
            {target === null
              ? "Globs, matched against the target's own tool list once there is one."
              : targetCount === 1
                ? `Globs, matched against ${target.name}'s own tool list, with ${target.name}'s own policy applied first.`
                : `Globs, matched against ${target.name}'s own tool list — the target the preview below is of — with its own policy applied first.`}
          </Text>
        </Measure>
        <ToolPolicyEditor
          policy={policy}
          onChange={onChange}
          floor={target?.tools ?? null}
          tools={tools}
          allowPlaceholder="list_*, search_*"
          denyPlaceholder="delete_*"
          destructiveHint="A persona may be stricter than the target, never looser."
          whenUnknown={
            target === null
              ? "No target in this project yet, so there is nothing to match against. Connect one and this fills in."
              : check.isError
                ? `${target.name} could not be asked: ${check.error.message}`
                : `Ask ${target.name} for its tool list to see what this policy leaves them.`
          }
          action={
            target === null ? undefined : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  check.mutate(target.id);
                }}
                pending={check.isPending}
              >
                {tools === null ? "Ask the target" : "Ask the target again"}
              </Button>
            )
          }
        />
      </Stack>
    </Section>
  );
}

/**
 * The prompt, as the runner renders it — from the DRAFT, in both modes. Everything above is only
 * ever a way of writing this.
 *
 * **It is a preview OF A TARGET.** The system prompt carries the target's own description and its
 * tool list, so which target it is changes what comes back, and the server refuses to pick one
 * when a project holds several (ADR-0035). The target is chosen here, and it is part of the query
 * key, so switching target refetches rather than showing a cached prompt for the other one. With
 * no target at all the server renders against a stand-in, and the reader is told that is what
 * they are reading.
 *
 * The body is debounced, so a reader typing a backstory costs a request per pause and not per
 * keystroke; the previous prompt stays on screen while the next one is fetched, so the well
 * never blinks to a skeleton mid-sentence.
 */
function PromptPreview({
  projectKey,
  spec,
  complete,
  targets,
  target,
  onPickTarget,
}: {
  projectKey: string;
  spec: Spec;
  /** The four fields the server insists on are present; before that a request would be a 400. */
  complete: boolean;
  targets: readonly StoredTarget[];
  target: StoredTarget | null;
  onPickTarget: (targetId: string) => void;
}) {
  const body = useMemo<PersonaPreviewBody>(
    () => ({ spec, ...(target === null ? {} : { targetId: target.id }) }),
    [spec, target],
  );
  const settled = useSettled(body, 400);
  const preview = useQuery({
    ...q.personaDraftPreview(projectKey, settled),
    enabled: complete,
    placeholderData: keepPreviousData,
  });

  return (
    <Section title="How this reads to them">
      <Stack gap={4}>
        {targets.length > 1 ? (
          <Field label="Which target" hint="A project can hold several; the prompt describes one of them, and the tool policy above is matched against the same one.">
            {({ id, describedBy, invalid }) => (
              <Select
                id={id}
                describedBy={describedBy}
                invalid={invalid}
                value={target?.id ?? ""}
                onChange={onPickTarget}
                options={targets.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
              />
            )}
          </Field>
        ) : null}

        {targets.length === 0 ? (
          <Measure width="read">
            <Text as="p" size="meta" tone="muted">
              There is no target in this project yet, so this is rendered against a stand-in called
              “your product”. Connect one and the prompt carries its description and its tools.
            </Text>
          </Measure>
        ) : null}

        {!complete ? (
          <StateBlock kind="empty" what="the prompt">
            Give them a name, a role, a backstory and an errand, and the prompt they produce is
            rendered here by the same code that hands it to them.
          </StateBlock>
        ) : preview.isPending ? (
          <StateBlock
            kind="loading"
            what="the prompt"
            skeleton={<Skeleton variant="block" height={320} label="Rendering the prompt" />}
          />
        ) : preview.isError ? (
          <StateBlock kind="failed" what="the prompt" error={preview.error}>
            <Button
              variant="secondary"
              onClick={() => {
                void preview.refetch();
              }}
            >
              Try again
            </Button>
          </StateBlock>
        ) : (
          <Stack gap={2}>
            <PayloadBlock caption="The prompt" value={preview.data.text} maxLines={48} />
            <Measure width="read">
              <Text as="p" size="meta" tone="muted">
                A person's own name and their detail line go in at the top of this, their cohort's
                context and the study's brief after it, and their memory and account arrive in the
                first message of each visit.
              </Text>
            </Measure>
          </Stack>
        )}
      </Stack>
    </Section>
  );
}

/**
 * Deleting, from the edit page, under the same rules the list applies (ADR-0043 §7): refused
 * while a cohort's mix names it, and the control is at a bound with the reason rather than gone.
 * A persona nobody draws on goes through the `AlertDialog`, whose body says what actually
 * happens and promises nothing about executions that have already run.
 */
function DeletePersona({ persona, pending, onDelete }: { persona: Persona; pending: boolean; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const held = persona.cohorts > 0;
  const reason = `In ${plural(persona.cohorts, "cohort")}. Take ${persona.spec.name} out of ${persona.cohorts === 1 ? "that cohort's mix" : "those cohorts' mixes"} first, then it can go.`;

  return (
    <Section title="Deleting this persona">
      <Card>
        <Stack gap={4} align="start">
          <Measure width="read">
            <Text as="p" size="read-sm" tone="soft">
              {held
                ? `${reason} Removing a persona a cohort still names is refused, so that nobody is unmade behind the cohort's back.`
                : `Nobody is drawn from ${persona.spec.name} today, so nothing else in this project moves. Executions that have already run keep their people, their visits and their findings.`}
            </Text>
          </Measure>
          {held ? (
            <Tooltip content={reason}>
              <Button variant="danger" atBound>
                Delete this persona
              </Button>
            </Tooltip>
          ) : (
            <Button
              variant="danger"
              pending={pending}
              onClick={() => {
                setConfirming(true);
              }}
            >
              Delete this persona
            </Button>
          )}
          <AlertDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={`Delete ${persona.spec.name}?`}
            body={`Nobody is drawn from ${persona.spec.name} today, so nothing else in this project moves. Executions that have already run keep their people, their visits and their findings.`}
            confirmLabel="Delete this persona"
            confirmPending={pending}
            onConfirm={onDelete}
          />
        </Stack>
      </Card>
    </Section>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { apportion, parseDuration, slugify, ToolPolicySchema, type TraitValue } from "@populace/core/isomorphic";
import type { CohortInput } from "@populace/contract";
import { api, isMissing, type CohortView, type Persona } from "../../api.js";
import { familyOf, keys, q } from "../../queries.js";
import { useProject } from "../../context.jsx";
import { useAfterCreate, useDraft, usePicked, useThen } from "../../builders.js";
import { people, plural } from "../../format.js";
import {
  BuilderPage,
  Button,
  Card,
  Disclosure,
  DurationField,
  Field,
  FieldGrid,
  Inline,
  Input,
  KeyValueEditor,
  Link,
  Measure,
  Mono,
  NumberInput,
  PageHeader,
  Section,
  Select,
  Skeleton,
  Stack,
  StateBlock,
  Text,
  TextArea,
  ToolPolicyEditor,
  WeightedMixEditor,
  WhatWentWrong,
  type StateKind,
  type WeightedMixEntry,
  type WeightedMixOption,
} from "../../design/index.js";

/**
 * The cohort builder — one screen serving `library/cohorts/new` and `library/cohorts/:c`
 * (ADR-0043).
 *
 * **What a cohort is** (ADR-0039): a shared condition — `context`, required, addressed to its
 * people and handed to every one of them under their persona's backstory — and a mix of personas
 * in a ratio. On top of that, what the cohort applies to everyone in it: fixed traits, a tool
 * policy that can only narrow, a model override, a cadence and a visit cap, and the seed the next
 * person is drawn from. What it does NOT have is a size: how many go is the study's, dealt
 * through the population's weights and then this mix (ADR-0041). So nothing on this page shows a
 * person, a headcount or a population. The one number a reader can type here — "Try a size" — is
 * a preview of the deal's arithmetic and is never saved.
 *
 * **The name comes first.** The page this replaces made a cohort out of a persona before it had
 * a name, and that ordering was the confusion the redesign was asked to end (ADR-0043 §0). Here
 * the reader names the group, says what its people share, and only then picks who they are drawn
 * from — the order the sentence "mobile signups are mostly first-timers" is spoken in.
 *
 * **The mix is a `WeightedMixEditor`** (ATOMIC-INVENTORY §3, organism 36). Weights are parts,
 * not people; the editor draws the ratio and this screen adds the counts, because the count
 * depends on a size and on the deal rule, and the deal rule is core's own `apportion` — the same
 * function the server runs, so what the preview says at 20 is what a study of 20 would send. Ties
 * go to the persona listed first, which is a stated rule (ADR-0041), and the preview says so.
 *
 * **Two modes, one file.** At `new` the form is a persisted draft (`useDraft`), the bar is an
 * `ActionBar` whose act is "Make this cohort", and the whole `CohortInput` goes up in one POST.
 * At `:c` the server holds the truth: the form is seeded from the row once, the bar is a
 * `SaveBar` with dirtiness and discard, and a PUT carries only what changed. The same fields,
 * the same validation, the same copy.
 *
 * **It chains** (`useThen`). With no personas to pick from, the mix's empty state sends the
 * reader to the persona builder carrying `?then=` back here; the persona they make comes back as
 * `?picked=` and is added to the mix at one part. Opened FROM the population builder the same
 * way, the act reads "Make this cohort and go back", and the population picks it up.
 *
 * **The per-person editor that used to live on this screen** — a name, a sentence, patience,
 * budget, traits set by hand — moved to the study's People page, because which of a cohort's
 * people are IN is a study's decision and nobody is anybody until a study sends them (ADR-0041).
 *
 * Nothing here promises what an execution will produce (§7.3): a cohort is who is sent, not
 * what they will find.
 */

/**
 * The form, as it is typed. Kept as strings and milliseconds — the reader's units — and turned
 * into a `CohortInput` only at the moment it is sent, so the draft that survives a hop to the
 * persona builder is exactly what was on the screen.
 */
const DraftSchema = z.object({
  name: z.string(),
  /** Only honoured in create mode, and only once the reader has edited it; otherwise derived. */
  slug: z.string(),
  slugTouched: z.boolean(),
  context: z.string(),
  /** The context is a starter's suggestion the reader has not edited yet; the hint says so. */
  contextSuggested: z.boolean(),
  mix: z.array(z.object({ personaId: z.string(), weight: z.number() })),
  /** Every trait as typed. Coerced to a number or a boolean where it reads as one, on send. */
  traits: z.record(z.string(), z.string()),
  tools: ToolPolicySchema,
  /** Empty strings and zero mean "whatever the persona or the project uses". */
  model: z.object({ model: z.string(), effort: z.string(), maxTokens: z.number() }),
  /** Milliseconds between visits for this cohort only. Zero follows the study's own cadence. */
  everyMs: z.number(),
  /** Visits, after which each of them stops. Zero follows the study. */
  cap: z.number(),
  seed: z.string(),
  notes: z.string(),
});
type Draft = z.infer<typeof DraftSchema>;

const DEFAULT_SEED = "populace";

const blank = (): Draft => ({
  name: "",
  slug: "",
  slugTouched: false,
  context: "",
  contextSuggested: false,
  mix: [],
  traits: {},
  tools: { allow: [], deny: [], destructive: "allow" },
  model: { model: "", effort: "", maxTokens: 0 },
  everyMs: 0,
  cap: 0,
  seed: DEFAULT_SEED,
  notes: "",
});

/** The saved row, in the form's own units. */
function draftOf(cohort: CohortView): Draft {
  return {
    name: cohort.name,
    slug: cohort.slug,
    slugTouched: true,
    context: cohort.context,
    contextSuggested: false,
    mix: cohort.mix.map((entry) => ({ personaId: entry.personaId, weight: entry.weight })),
    traits: Object.fromEntries(Object.entries(cohort.traits).map(([trait, value]) => [trait, String(value)])),
    tools: cohort.tools,
    model: { model: cohort.model.model ?? "", effort: cohort.model.effort ?? "", maxTokens: cohort.model.maxTokens ?? 0 },
    everyMs: cohort.cadence?.every === undefined ? 0 : parseDuration(cohort.cadence.every),
    cap: cohort.maxVisits ?? 0,
    seed: cohort.seed,
    notes: cohort.notes,
  };
}

/** The cohort's slug in the wire's own grammar; `new` is the builder's address, not a name. */
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/**
 * A trait as typed, as the wire carries it. "true" and "false" read as booleans and a bare number
 * as a number, because that is what somebody typing `3` into a `patience`-shaped box means; a
 * saved number comes back out as the same number, so the round trip marks nothing dirty.
 */
function traitValueOf(text: string): TraitValue {
  const trimmed = text.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed !== "" && Number.isFinite(Number(trimmed))) return Number(trimmed);
  return text;
}

function traitsOf(typed: Record<string, string>): Record<string, TraitValue> {
  return Object.fromEntries(Object.entries(typed).map(([trait, value]) => [trait, traitValueOf(value)]));
}

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];
const isEffort = (value: string): value is Effort => (EFFORTS as readonly string[]).includes(value);

/** The override with its unset fields absent, which is how the schema spells "falls through". */
function modelOf(model: Draft["model"]): CohortInput["model"] {
  return {
    ...(model.model === "" ? {} : { model: model.model }),
    ...(isEffort(model.effort) ? { effort: model.effort } : {}),
    ...(model.maxTokens > 0 ? { maxTokens: Math.round(model.maxTokens) } : {}),
  };
}

/** The whole form as one `CohortInput` — what a create sends. */
function inputOf(draft: Draft, slug: string): CohortInput {
  const seed = draft.seed.trim();
  return {
    slug,
    name: draft.name.trim(),
    context: draft.context.trim(),
    mix: draft.mix.map((entry) => ({ personaId: entry.personaId, weight: entry.weight })),
    traits: traitsOf(draft.traits),
    tools: draft.tools,
    model: modelOf(draft.model),
    cadence: draft.everyMs === 0 ? null : { every: draft.everyMs },
    maxVisits: draft.cap === 0 ? null : Math.round(draft.cap),
    seed: seed === "" ? DEFAULT_SEED : seed,
    notes: draft.notes,
  };
}

const sameMix = (a: CohortInput["mix"], b: CohortView["mix"]): boolean =>
  a !== undefined && a.length === b.length && a.every((entry, i) => entry.personaId === b[i]?.personaId && entry.weight === b[i]?.weight);

const sameTraits = (a: Record<string, TraitValue>, b: Record<string, TraitValue>): boolean => {
  const left = Object.entries(a).map(([k, v]) => `${k}=${String(v)}`).sort();
  const right = Object.entries(b).map(([k, v]) => `${k}=${String(v)}`).sort();
  return left.length === right.length && left.every((entry, i) => entry === right[i]);
};

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

const samePolicy = (a: CohortView["tools"], b: CohortView["tools"]): boolean =>
  sameList(a.allow, b.allow) && sameList(a.deny, b.deny) && a.destructive === b.destructive;

const sameModel = (a: CohortView["model"], b: CohortView["model"]): boolean =>
  a.model === b.model && a.effort === b.effort && a.maxTokens === b.maxTokens;

/**
 * Only what moved, for the PUT. Editing sends a partial (the schema is all-optional for exactly
 * this), so a save never rewrites a field the reader did not touch — and the dirtiness the bar
 * reports is this object having any keys at all.
 */
function changesOf(draft: Draft, cohort: CohortView): CohortInput {
  const full = inputOf(draft, cohort.slug);
  const out: CohortInput = {};
  if (full.name !== undefined && full.name !== cohort.name) out.name = full.name;
  if (full.context !== undefined && full.context !== cohort.context) out.context = full.context;
  if (!sameMix(full.mix, cohort.mix)) out.mix = full.mix;
  if (full.traits !== undefined && !sameTraits(full.traits, cohort.traits)) out.traits = full.traits;
  if (full.tools !== undefined && !samePolicy(full.tools, cohort.tools)) out.tools = full.tools;
  if (full.model !== undefined && !sameModel(full.model, cohort.model)) out.model = full.model;
  const savedEvery = cohort.cadence?.every === undefined ? 0 : parseDuration(cohort.cadence.every);
  if (draft.everyMs !== savedEvery) {
    // The cohort's cadence override is field-wise, so a jitter it already carries rides along
    // untouched; clearing the interval clears the override as a whole.
    out.cadence =
      draft.everyMs === 0 ? null : { ...(cohort.cadence?.jitter === undefined ? {} : { jitter: cohort.cadence.jitter }), every: draft.everyMs };
  }
  if ((cohort.maxVisits ?? 0) !== Math.round(draft.cap)) out.maxVisits = full.maxVisits;
  if (full.seed !== undefined && full.seed !== cohort.seed) out.seed = full.seed;
  if (full.notes !== undefined && full.notes !== cohort.notes) out.notes = full.notes;
  return out;
}

/**
 * Whether the form still holds what a save sent. A save re-seeds the form from what came back,
 * which is right only while the reader has typed nothing since the press: this is the question
 * asked before that re-seed, so a form that moved in flight keeps the keystrokes instead of
 * losing them to a success. Every field the draft carries is compared, because any one of them
 * is what the reader might have been typing.
 */
function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.name === b.name &&
    a.slug === b.slug &&
    a.slugTouched === b.slugTouched &&
    a.context === b.context &&
    a.contextSuggested === b.contextSuggested &&
    a.mix.length === b.mix.length &&
    a.mix.every((entry, i) => entry.personaId === b.mix[i]?.personaId && entry.weight === b.mix[i]?.weight) &&
    sameTraits(a.traits, b.traits) &&
    samePolicy(a.tools, b.tools) &&
    a.model.model === b.model.model &&
    a.model.effort === b.model.effort &&
    a.model.maxTokens === b.model.maxTokens &&
    a.everyMs === b.everyMs &&
    a.cap === b.cap &&
    a.seed === b.seed &&
    a.notes === b.notes
  );
}

/** "a, b and c" — the deal preview lists personas, and a list reads as a sentence here. */
function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
}

/**
 * What the ratio comes to at a size, in product words. A persona the deal gives nobody is said
 * so outright — at small sizes a light entry gets nobody, and that is the honest answer rather
 * than a rounding error the reader has to infer (ADR-0041).
 */
function previewOf(size: number, entries: readonly WeightedMixEntry[], counts: readonly number[]): string {
  const parts = entries.map((entry, i) => {
    const count = counts[i] ?? 0;
    return count === 0 ? `${entry.name} would send nobody at this size` : `${count} from ${entry.name}`;
  });
  return `At ${people(size)}: ${joinAnd(parts)}. Ties go to the persona listed first.`;
}

const MODELS: readonly { value: string; label: string }[] = [
  { value: "", label: "Whatever the persona or project uses" },
  { value: "claude-opus-5", label: "Opus 5 — the most capable, and the most expensive" },
  { value: "claude-sonnet-5", label: "Sonnet 5 — a good default for the people" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5 — cheapest, for wide populations" },
];

const EFFORT_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "", label: "Whatever the persona or project uses" },
  ...EFFORTS.map((effort) => ({ value: effort, label: effort })),
];

/** The one size the preview is tried at until the reader changes it. Never saved. */
const TRY_SIZE = 20;

export function CohortBuilder() {
  const { key, href } = useProject();
  const { c } = useParams();
  const mode: "create" | "edit" = c === undefined ? "create" : "edit";
  const queries = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { linkTo, returnTo, fromBuilder } = useThen();
  const go = useAfterCreate();

  const personas = useQuery(q.personas(key));
  // The target's policy is the floor under this one when there is exactly one target; with
  // several the project would have to say which, and with none there is nothing to stand on.
  const targets = useQuery(q.targets(key));
  // The row is looked up in the list rather than fetched by `:c`, because the address may spell
  // the cohort by slug (the list links that way, and the old `library/people/:slug` redirect
  // does) and the server's one-row read takes an id.
  const cohorts = useQuery({ ...q.cohorts(key), enabled: mode === "edit" });
  const cohort = mode === "edit" ? cohorts.data?.items.find((row) => row.slug === c || row.id === c) : undefined;

  const { draft, setDraft, restored, clear, startBlank } = useDraft(DraftSchema, blank, { enabled: mode === "create" });

  // Edit mode seeds the form from the row exactly once per cohort. A refetch after that must not
  // overwrite what the reader is typing; a save re-seeds explicitly from what came back. Keyed by
  // id rather than a flag because the route keeps this element mounted from one `:c` to the next.
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    if (cohort === undefined || seeded.current === cohort.id) return;
    seeded.current = cohort.id;
    setDraft(draftOf(cohort));
  }, [cohort, setDraft]);

  const set = useCallback(
    <K extends keyof Draft>(field: K, value: Draft[K]): void => {
      setDraft((prev) => ({ ...prev, [field]: value }));
    },
    [setDraft],
  );

  const library: readonly Persona[] = personas.data?.items ?? [];
  const personaById = useMemo(() => new Map(library.map((persona) => [persona.id, persona])), [library]);
  const personaIds = useMemo(() => library.map((persona) => persona.id), [library]);

  // The persona made on the far side of `?then=` comes back as `?picked=`: into the mix at one
  // part, once, and only after the list holds it.
  usePicked(
    personaIds,
    useCallback(
      (id: string) => {
        setDraft((prev) => (prev.mix.some((entry) => entry.personaId === id) ? prev : { ...prev, mix: [...prev.mix, { personaId: id, weight: 1 }] }));
      },
      [setDraft],
    ),
  );

  // A starter's persona suggests what its cohort shares. While the context is empty it is
  // offered as a first draft and the hint says where it came from; the first keystroke makes it
  // the reader's own.
  const suggestion = personaById.get(draft.mix[0]?.personaId ?? "")?.suggestedContext ?? null;
  useEffect(() => {
    if (suggestion === null) return;
    setDraft((prev) => (prev.context.trim() === "" ? { ...prev, context: suggestion, contextSuggested: true } : prev));
  }, [suggestion, setDraft]);

  const entries: WeightedMixEntry[] = draft.mix.map((entry) => {
    const persona = personaById.get(entry.personaId);
    const known = cohort?.mix.find((saved) => saved.personaId === entry.personaId);
    return {
      id: entry.personaId,
      name: persona?.spec.name ?? known?.personaName ?? "A persona no longer in the library",
      detail: persona?.spec.role,
      weight: entry.weight,
    };
  });
  const options: WeightedMixOption[] = library.map((persona) => ({ id: persona.id, name: persona.spec.name, detail: persona.spec.role }));

  const [trySize, setTrySize] = useState(TRY_SIZE);
  // Timing opens itself when the cohort already overrides something, until the reader decides.
  const [timingOpen, setTimingOpen] = useState<boolean | null>(null);
  const previewCounts = apportion(trySize, entries.map((entry) => entry.weight));
  const previewSentence = previewOf(trySize, entries, previewCounts);

  const slug = mode === "create" ? (draft.slugTouched ? draft.slug : slugify(draft.name)) : (cohort?.slug ?? "");
  // The slug's own complaint, said under its field as well as in the bar. Only in create mode:
  // once saved it is immutable and never wrong.
  const slugError: string | undefined =
    mode !== "create" || slug === ""
      ? undefined
      : !SLUG.test(slug)
        ? "The slug needs lowercase letters, digits and hyphens, and starts with a letter or a digit."
        : slug === "new"
          ? "“new” is this builder's own address; give the cohort another slug."
          : undefined;
  const floor = targets.data !== undefined && targets.data.items.length === 1 ? (targets.data.items[0]?.tools ?? null) : null;

  const create = useMutation({
    mutationFn: () => api.createCohort(key, inputOf(draft, slug)),
    onSuccess: async (made) => {
      // The list this cohort now belongs to, BEFORE navigating, so a builder waiting on
      // `?picked=` finds it in the options it reads (ADR-0043). Then the counts.
      await queries.invalidateQueries({ queryKey: keys.cohorts(key) });
      await Promise.all([queries.invalidateQueries({ queryKey: keys.project(key) }), queries.invalidateQueries({ queryKey: keys.setup(key) })]);
      clear();
      go(returnTo(made.id, href(`library/cohorts/${encodeURIComponent(made.slug)}`)));
    },
  });

  const [savedAt, setSavedAt] = useState<string | null>(null);
  const save = useMutation({
    // The draft as the press found it goes up as the mutation's variable, so the re-seed below can
    // tell a form nobody touched from one the reader has carried on typing into.
    mutationFn: (sent: Draft) => {
      if (cohort === undefined) throw new Error("there is no cohort to save");
      return api.saveCohort(key, cohort.id, changesOf(sent, cohort));
    },
    onSuccess: async (saved, sent) => {
      setSavedAt(new Date().toISOString());
      // Only a form that has not moved since the press takes the saved row: typing during a save
      // stays on the screen and stays dirty, rather than being thrown away by the answer to it.
      setDraft((prev) => (sameDraft(prev, sent) ? draftOf(saved) : prev));
      // A changed mix re-deals this cohort in every study that sends it, so the studies and their
      // people are stale as well as the cohort itself.
      await Promise.all([
        queries.invalidateQueries({ queryKey: keys.cohorts(key) }),
        queries.invalidateQueries({ queryKey: keys.cohort(key, saved.id) }),
        queries.invalidateQueries({ queryKey: keys.project(key) }),
        queries.invalidateQueries({ queryKey: keys.studies(key) }),
        queries.invalidateQueries({ queryKey: familyOf(keys.studyPeople("", "")) }),
      ]);
    },
  });

  // The way out. From another builder, back to it without a pick; otherwise the list.
  const incoming = params.get("then");
  const back = incoming !== null && incoming.startsWith(href()) ? incoming : href("library/cohorts");
  const cancel = (): void => {
    if (mode === "create") clear();
    void navigate(back);
  };

  const changes = cohort === undefined ? {} : changesOf(draft, cohort);
  const dirty = Object.keys(changes).length > 0;

  // Why the act cannot happen yet, in the order the form runs. One sentence, the first that
  // applies; the bar says it and Enter is held while it is set.
  const blockedBecause: string | undefined =
    draft.name.trim() === ""
      ? "Give it a name first."
      : draft.context.trim() === ""
        ? "Say what these people share first."
        : draft.mix.length === 0
          ? "Draw it from at least one persona."
          : slugError;

  const state: StateKind | undefined =
    personas.isPending || (mode === "edit" && cohorts.isPending)
      ? "loading"
      : personas.isError
        ? "failed"
        : mode === "edit" && cohorts.isError
          ? isMissing(cohorts.error)
            ? "gone"
            : "failed"
          : mode === "edit" && cohorts.isSuccess && cohort === undefined
            ? "gone"
            : undefined;

  const title = mode === "create" ? "New cohort" : (cohort?.name ?? "This cohort");
  const header = (
    <PageHeader
      title={title}
      crumbs={[{ label: "Cohorts", to: href("library/cohorts") }, { label: mode === "create" ? "New" : (cohort?.name ?? c ?? "") }]}
      lede={
        mode === "create"
          ? "People who share something, drawn from one persona or a mix of them in a ratio. Name them, say what they have in common, then pick who they are drawn from. How many go is the study's decision, not this page's."
          : "What these people share, who they are drawn from and in what ratio, and what the cohort applies to all of them. How many go is set on the study that sends them."
      }
      meta={cohort === undefined ? undefined : [{ key: "slug", node: <Mono size="code-sm">{cohort.slug}</Mono> }]}
    />
  );

  const form = (
    <Stack gap={12}>
      {restored ? (
        <Inline gap={3} align="center" wrap>
          <Text size="meta" tone="muted">
            Draft restored.
          </Text>
          <Button variant="quiet" size="sm" onClick={startBlank}>
            Start blank
          </Button>
        </Inline>
      ) : null}

      <Section title="What to call them">
        <Card>
          <Stack gap={4}>
            <Field label="Name" hint="The group, as you would say it: “Mobile signups”, “The pilot team”.">
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={draft.name}
                  onChange={(name) => {
                    set("name", name);
                  }}
                  placeholder="Mobile signups"
                  autoComplete="off"
                />
              )}
            </Field>
            {mode === "create" ? (
              <Field
                label="Slug"
                hint="Derived from the name until you edit it. Every person in this cohort is numbered from it, so it cannot change after this."
                error={slugError}
              >
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    describedBy={describedBy}
                    invalid={invalid}
                    value={slug}
                    onChange={(next) => {
                      setDraft((prev) => ({ ...prev, slug: next, slugTouched: true }));
                    }}
                    mono
                    placeholder="mobile-signups"
                    autoComplete="off"
                  />
                )}
              </Field>
            ) : null}
          </Stack>
        </Card>
      </Section>

      <Section title="What they share">
        <Stack gap={4}>
          <Measure width="read">
            <Text as="p" size="read-sm" tone="soft">
              Addressed to them, and told to every one of them under their persona&rsquo;s backstory.
              It is what makes this a cohort rather than a saved recipe.
            </Text>
          </Measure>
          <Card>
            <Field
              label="What everybody in this cohort has in common"
              hint={
                draft.contextSuggested
                  ? "Suggested by the starter; say what these people share."
                  : "What these people have in common, said to them: “You only ever use this on your phone, usually while doing something else.”"
              }
            >
              {({ id, describedBy, invalid }) => (
                <TextArea
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={draft.context}
                  onChange={(context) => {
                    setDraft((prev) => ({ ...prev, context, contextSuggested: false }));
                  }}
                  rows={8}
                  placeholder="You signed up during the launch week promotion, on a phone, and you have not read anything about it."
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
              One persona, or several in a ratio. Weights are parts, not people: 3 and 2 is three
              of one for every two of the other, at whatever size a study sends. Growing a study
              never takes anybody away; a persona taken out of the mix puts its people aside, and
              putting it back restores them.
            </Text>
          </Measure>
          {/* `usedBy` counts the POPULATIONS holding this cohort, which is the only fact this view
              has, so the sentence is gated and worded on that one fact and says what follows from
              it, rather than counting studies nothing here can see. */}
          {cohort !== undefined && cohort.usedBy > 0 ? (
            <Measure width="read">
              <Text as="p" size="read-sm" tone="medium">
                {`Changing weights re-deals this cohort in the ${plural(cohort.usedBy, "population")} that ${cohort.usedBy === 1 ? "holds" : "hold"} it, and in every study that sends them.`}
              </Text>
            </Measure>
          ) : null}
          <Card>
            <Stack gap={6}>
              <WeightedMixEditor
                legend="Mix"
                entries={entries}
                options={options}
                onChange={(next) => {
                  set(
                    "mix",
                    next.map((entry) => ({ personaId: entry.id, weight: entry.weight })),
                  );
                }}
                addLabel="Add a persona"
                minReason="A cohort is drawn from at least one persona."
                emptyState={
                  <Measure width="read">
                    <Text as="p" size="read-sm" tone="soft">
                      There are no personas to draw from yet. A persona is a kind of person — a
                      first-time visitor, a power user — and a cohort is a ratio of them.{" "}
                      <Link to={linkTo(href("library/personas/new"))} size="read-sm">
                        Make a persona and come back here
                      </Link>
                    </Text>
                  </Measure>
                }
                previewCounts={previewCounts}
                previewSentence={previewSentence}
              />
              {entries.length === 0 ? null : (
                <FieldGrid cols={3} align="end">
                  <Field
                    label="Try a size"
                    hint="A preview only. The size is the study's, and this number is never saved."
                  >
                    {({ id, describedBy, invalid }) => (
                      <NumberInput id={id} describedBy={describedBy} invalid={invalid} value={trySize} onChange={(size) => setTrySize(Math.max(0, Math.round(size)))} min={0} />
                    )}
                  </Field>
                </FieldGrid>
              )}
            </Stack>
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
            <KeyValueEditor
              addLabel="Add a shared trait"
              addPlaceholder="device"
              empty="No shared traits. Each person keeps whatever their persona drew for them."
              onAdd={(trait) => {
                set("traits", { ...draft.traits, [trait]: "" });
              }}
              onRemove={(trait) => {
                set("traits", Object.fromEntries(Object.entries(draft.traits).filter(([other]) => other !== trait)));
              }}
              rows={Object.entries(draft.traits).map(([trait, value]) => ({
                key: trait,
                value: (
                  <Input
                    value={value}
                    onChange={(next) => {
                      set("traits", { ...draft.traits, [trait]: next });
                    }}
                  />
                ),
              }))}
            />
          </Card>

          <ToolPolicyEditor
            policy={draft.tools}
            onChange={(tools) => {
              set("tools", tools);
            }}
            floor={floor}
            tools={null}
            lede={
              floor === null
                ? "Globs over the target's tool names. A cohort may be stricter than its personas and the target, never looser."
                : "Merged onto the target's own policy, which is the floor: a cohort may be stricter than the target, never looser."
            }
            allowPlaceholder="list_*, search_*"
            denyPlaceholder="export_*"
            destructiveHint="A cohort may be stricter than its personas and the target, never looser."
            whenUnknown="Globs, matched against the target's tool list when a study sends them. A cohort can only take tools away."
          />

          <Card>
            <Stack gap={4}>
              <FieldGrid cols={3}>
                <Field label="Model" hint="Layered over the persona's and under the study's.">
                  {({ id, describedBy, invalid }) => (
                    <Select
                      id={id}
                      describedBy={describedBy}
                      invalid={invalid}
                      value={draft.model.model}
                      onChange={(model) => {
                        set("model", { ...draft.model, model });
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
                      value={draft.model.effort}
                      onChange={(effort) => {
                        set("model", { ...draft.model, effort });
                      }}
                      options={EFFORT_OPTIONS}
                    />
                  )}
                </Field>
                <Field label="Tokens per turn, at most" hint="Zero uses the persona's or the project's.">
                  {({ id, describedBy, invalid }) => (
                    <NumberInput
                      id={id}
                      describedBy={describedBy}
                      invalid={invalid}
                      value={draft.model.maxTokens}
                      onChange={(maxTokens) => {
                        set("model", { ...draft.model, maxTokens: Math.max(0, maxTokens) });
                      }}
                      min={0}
                      step={1000}
                    />
                  )}
                </Field>
              </FieldGrid>
            </Stack>
          </Card>
        </Stack>
      </Section>

      <Section title="How often, and who comes next">
        <Card>
          <Stack gap={6}>
            <Disclosure label="Timing" open={timingOpen ?? (draft.everyMs !== 0 || draft.cap !== 0)} onOpenChange={setTimingOpen}>
              <FieldGrid cols={2} align="end">
                <DurationField
                  label="A visit every"
                  hint="For this cohort only. Zero follows the study's own cadence."
                  unit="s"
                  valueMs={draft.everyMs}
                  onChange={(ms) => {
                    set("everyMs", Math.max(0, ms));
                  }}
                  min={0}
                />
                <Field label="Stop each of them after" hint="Visits. Zero follows the study.">
                  {({ id, describedBy, invalid }) => (
                    <NumberInput
                      id={id}
                      describedBy={describedBy}
                      invalid={invalid}
                      value={draft.cap}
                      onChange={(cap) => {
                        set("cap", Math.max(0, cap));
                      }}
                      min={0}
                    />
                  )}
                </Field>
              </FieldGrid>
            </Disclosure>

            <Field
              label="Seed"
              hint="The seed decides who the next person is, not who these people are: changing it renames nobody already written, and only chooses the next one drawn."
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={draft.seed}
                  onChange={(seed) => {
                    set("seed", seed);
                  }}
                  mono
                  placeholder={DEFAULT_SEED}
                  autoComplete="off"
                />
              )}
            </Field>

            <Field label="Notes" hint="For you and whoever reads this after you. Nobody in the cohort is told them." optional>
              {({ id, describedBy, invalid }) => (
                <TextArea
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={draft.notes}
                  onChange={(notes) => {
                    set("notes", notes);
                  }}
                  rows={8}
                  placeholder="Why this group exists, and what you hope to learn from it."
                />
              )}
            </Field>
          </Stack>
        </Card>
      </Section>

      {create.isError ? <WhatWentWrong says="No cohort was made. What is above is still yours to send again." error={create.error} /> : null}
      {save.isError ? <WhatWentWrong says="Nothing was written. What is above is still yours to send again." error={save.error} /> : null}
    </Stack>
  );

  const slots = {
    header,
    state,
    loading: (
      <StateBlock kind="loading" what={mode === "create" ? "the personas" : "this cohort"} skeleton={<Skeleton variant="row" count={6} label="Reading this cohort" />} />
    ),
    error: <StateBlock kind="failed" what={mode === "create" ? "the personas" : "this cohort"} error={personas.error ?? cohorts.error} />,
    gone: (
      <StateBlock kind="gone" what="this cohort">
        <Stack gap={3} align="start">
          <span>
            No cohort called <Mono size="code-sm">{c ?? ""}</Mono> lives in this project. It may have been renamed, or deleted.
          </span>
          <Button variant="secondary" asChild>
            <Link to={href("library/cohorts")}>Back to the cohorts</Link>
          </Button>
        </Stack>
      </StateBlock>
    ),
    onCancel: cancel,
  };

  if (mode === "create") {
    return (
      <BuilderPage
        {...slots}
        mode="create"
        actLabel={fromBuilder ? "Make this cohort and go back" : "Make this cohort"}
        pending={create.isPending}
        onAct={() => {
          create.mutate();
        }}
        blockedBecause={blockedBecause}
        note="Nobody is written until a study sends this cohort; making it costs nothing."
      >
        {form}
      </BuilderPage>
    );
  }

  return (
    <BuilderPage
      {...slots}
      mode="edit"
      dirty={dirty}
      saving={save.isPending}
      savedAt={savedAt}
      onSave={() => {
        save.mutate(draft);
      }}
      onDiscard={
        cohort === undefined
          ? undefined
          : () => {
              setDraft(draftOf(cohort));
            }
      }
      blockedBecause={blockedBecause}
      note={
        // Gated on the same fact as the warning above it, and so worded about it: the populations
        // holding this cohort are what `usedBy` counts, and the studies follow from them.
        cohort !== undefined && cohort.usedBy > 0 && changes.mix !== undefined
          ? `Saving re-deals this cohort in the ${plural(cohort.usedBy, "population")} that ${cohort.usedBy === 1 ? "holds" : "hold"} it, and in every study that sends them: a persona whose share shrank puts its tail aside, one that grew draws new people, and nobody who stays is touched.`
          : undefined
      }
    >
      {form}
    </BuilderPage>
  );
}

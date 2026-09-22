import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import type { PersonaSpec, ToolPolicy as ToolPolicyShape, TraitSpec, TraitValue } from "@populace/core/isomorphic";
import { api, type TargetCheck } from "../../api.js";
import { q } from "../../queries.js";
import { useProject } from "../../context.jsx";
import {
  Button,
  Card,
  ConfirmButton,
  Field,
  FieldGrid,
  FieldWarning,
  FormPane,
  Input,
  KeyValueEditor,
  Measure,
  Mono,
  NumberInput,
  PageHeader,
  PayloadBlock,
  Repeater,
  SamplePreview,
  ScaleField,
  Section,
  Select,
  Skeleton,
  SplitPage,
  Stack,
  StateBlock,
  Text,
  TextArea,
  ToolPolicyEditor,
  WhatWentWrong,
  type PolicyTool,
  type StateKind,
} from "../../design/index.js";

/**
 * The editor that decides whether any of this is worth reading.
 *
 * Nothing else in the product changes the findings as much: a persona with a real errand finds
 * real problems, and a persona told to "test the search" files a test report. So the two things
 * that are easy to get wrong are shown rather than described — the tool policy is matched against
 * the target's actual tool list as you type, and the prompt the model will be handed is rendered
 * down the right by the runner's own code (product judge gap #6).
 *
 * Ported to the design system — ATOMIC-INVENTORY §6.3 row 23. `SplitPage` owns the two columns
 * and `FormPane` — the form, the sticky `SaveBar` and the unsaved-changes guard that `FormPage`
 * is also made of — owns the left one. What went with them: the `<input type="range">` and its
 * `accent-[var(--color-accent)]` (now `ScaleField`), the second copy of `asList()` and the second
 * implementation of the tool-policy merge rule (now `ToolPolicyEditor`, shared with the target
 * editor), the `line-through opacity-50` that carried "blocked" as an opacity, the hand-rolled
 * `grid-cols-[minmax(0,1fr)_minmax(0,1fr)]` and `sticky top-9`, and the `dirty` chip in the
 * header — the flag itself is what the bar and the guard now run on.
 */

type Spec = Omit<PersonaSpec, "id">;

const EMPTY: Spec = {
  name: "",
  role: "",
  backstory: "",
  goals: [""],
  constraints: [],
  patience: 3,
  budgetUsd: 0,
  traits: {},
  tools: { allow: [], deny: [], destructive: "confirm" },
  model: {},
};

/**
 * The sentence each patience value puts in the prompt, from `personaSystemPrompt`. The preview
 * down the right is the authority; this is here so the slider means something while you drag it.
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
  ...["low", "medium", "high", "xhigh", "max"].map((effort) => ({ value: effort, label: effort })),
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

const asNumber = (spec: TraitSpec, fallback: number): number => (typeof spec === "number" ? spec : fallback);

export function PersonaEditor() {
  const { key, project, href } = useProject();
  const { x = "new" } = useParams();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const personas = useQuery(q.personas(key));
  const existing = x === "new" ? undefined : personas.data?.items.find((persona) => persona.id === x);

  /*
    Which target the prompt preview and the tool policy are ABOUT.

    Both used to read `project.simulations[0]?.target.id` — the first simulation's target, which is
    a guess twice over: it picks a simulation arbitrarily and then takes its target. A project with
    a dev and a qa endpoint previewed whichever one the first simulation happened to name, and a
    project with no simulations at all previewed nothing. The targets themselves are the right
    source, and the first of THEM is a defensible default only because the server refuses to guess
    when there are several — so the choice is visible rather than silent.
  */
  const targets = useQuery(q.targets(key));
  const target = targets.data?.items[0] ?? null;

  const [draft, setDraft] = useState<Spec>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  /** A save has been asked for at least once, which is when the blockers become messages. */
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (loaded || !personas.isSuccess) return;
    if (existing) {
      const { id: _id, ...spec } = existing.spec;
      setDraft(spec);
    }
    setLoaded(true);
  }, [loaded, personas.isSuccess, existing]);

  const set = <K extends keyof Spec>(field: K, value: Spec[K]): void => {
    setDraft((current) => ({ ...current, [field]: value }));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: () => api.savePersona(key, existing?.id ?? null, { spec: draft }),
    onSuccess: async (saved) => {
      setDirty(false);
      await queries.invalidateQueries();
      if (existing === undefined) void navigate(href(`library/personas/${encodeURIComponent(saved.id)}`), { replace: true });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.removePersona(key, existing?.id ?? ""),
    onSuccess: async () => {
      await queries.invalidateQueries();
      void navigate(href("library/personas"));
    },
  });

  /** What the server would refuse, named here rather than carried by a dead button (§6). */
  const blockers = {
    name: draft.name === "",
    role: draft.role === "",
    backstory: draft.backstory === "",
    goals: draft.goals.filter(Boolean).length === 0,
  };
  const blocked = blockers.name || blockers.role || blockers.backstory || blockers.goals;

  // Both are `TraitSpec`: either one value for everybody, or a spec drawn from per person. They
  // are read into consts because the narrowing has to survive a render prop, and `typeof` on a
  // property does not reach inside a callback.
  const patience = draft.patience;
  const budget = draft.budgetUsd;

  const state: StateKind | undefined = personas.isPending
    ? "loading"
    : personas.isError
      ? "failed"
      : undefined;

  const what = "this persona";

  const form = (
    <FormPane
      dirty={dirty}
      saving={save.isPending}
      savedAt={existing?.updatedAt ?? null}
      onSave={() => {
        setAttempted(true);
        if (blocked) return;
        save.mutate();
      }}
    >
      <Stack gap={8}>
        {save.isError ? (
          <WhatWentWrong
            says="Saving failed. Nothing here was written, and what is on this page is still yours to send again."
            error={save.error}
          />
        ) : null}
        {remove.isError ? (
          <WhatWentWrong
            says="This persona was not removed. It is still here, and so is everything drawn from it."
            error={remove.error}
          />
        ) : null}

        <Section title="Who they are">
          <Card>
            <Stack gap={6}>
              <FieldGrid cols={2}>
                <Field
                  label="Name"
                  hint="The kind of person, not a person: “First-time visitor”, not “Dana”."
                  error={attempted && blockers.name ? "A persona needs a name." : undefined}
                >
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      describedBy={describedBy}
                      invalid={invalid}
                      value={draft.name}
                      onChange={(v) => set("name", v)}
                      placeholder="First-time visitor"
                    />
                  )}
                </Field>
                <Field
                  label="Role"
                  error={attempted && blockers.role ? "Say what kind of person this is." : undefined}
                >
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      describedBy={describedBy}
                      invalid={invalid}
                      value={draft.role}
                      onChange={(v) => set("role", v)}
                      placeholder="someone who just heard about this"
                    />
                  )}
                </Field>
              </FieldGrid>
              <Field
                label="Backstory"
                hint="Line two of their prompt. Why they turned up, in their own life's terms."
                error={
                  attempted && blockers.backstory
                    ? "Why did they turn up? Without this they are a role and nothing else."
                    : undefined
                }
              >
                {({ id, describedBy, invalid }) => (
                  <TextArea
                    id={id}
                    describedBy={describedBy}
                    invalid={invalid}
                    value={draft.backstory}
                    onChange={(v) => set("backstory", v)}
                    rows={3}
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
                Errands, not instructions. What they turned up to get done, in their own terms.
              </Text>
            </Measure>
            <Card>
              <Repeater
                legend="Errands"
                addLabel="Another errand"
                minReason="A person comes here to do something, so there is always at least one."
                onAdd={() => set("goals", [...draft.goals, ""])}
                onRemove={(index) => set("goals", draft.goals.filter((_, j) => j !== index))}
                items={draft.goals.map((goal, i) => ({
                  id: String(i),
                  label: `Errand ${String(i + 1)}`,
                  fields: (
                    <Field
                      label="What they came to get done"
                      warning={
                        TESTER_WORDS.test(goal)
                          ? "This reads like an instruction to a tester. People who are told to test a product find test results; people with an errand find what is actually in the way."
                          : undefined
                      }
                      error={
                        attempted && blockers.goals
                          ? "Give them at least one errand to come here for."
                          : undefined
                      }
                    >
                      {({ id, describedBy, invalid }) => (
                        <Input
                          id={id}
                          describedBy={describedBy}
                          invalid={invalid}
                          value={goal}
                          onChange={(v) => set("goals", draft.goals.map((g, j) => (j === i ? v : g)))}
                          placeholder="Get this week's tasks written down somewhere you trust"
                        />
                      )}
                    </Field>
                  ),
                }))}
              />
            </Card>
          </Stack>
        </Section>

        <Section title="What they will not do">
          <Stack gap={4}>
            <Measure width="read">
              <Text as="p" size="read-sm" tone="soft">
                Constraints, in their own voice — the things this person would not do, whatever
                the product asks.
              </Text>
            </Measure>
            <Card>
              <Repeater
                legend="Constraints"
                addLabel="Another constraint"
                min={0}
                onAdd={() => set("constraints", [...draft.constraints, ""])}
                onRemove={(index) => set("constraints", draft.constraints.filter((_, j) => j !== index))}
                items={draft.constraints.map((constraint, i) => ({
                  id: String(i),
                  label: `Constraint ${String(i + 1)}`,
                  fields: (
                    <Field label="What they will not do">
                      {({ id, describedBy, invalid }) => (
                        <Input
                          id={id}
                          describedBy={describedBy}
                          invalid={invalid}
                          value={constraint}
                          onChange={(v) =>
                            set("constraints", draft.constraints.map((c, j) => (j === i ? v : c)))
                          }
                          placeholder="You will not hand over a credit card on a first visit"
                        />
                      )}
                    </Field>
                  ),
                }))}
              />
            </Card>
          </Stack>
        </Section>

        <Section title="How much they will put up with">
          <Card>
            <Stack gap={6}>
              {typeof patience === "number" ? (
                <ScaleField
                  label="Patience"
                  min={1}
                  max={5}
                  value={patience}
                  onChange={(v) => set("patience", v)}
                  describe={(v) => PATIENCE[v] ?? PATIENCE[asNumber(patience, 3)] ?? ""}
                />
              ) : (
                <Stack gap={2} align="start">
                  <Text size="label" tone="muted">
                    Patience
                  </Text>
                  <Measure width="read">
                    <Text as="p" size="read-sm" tone="soft">
                      Drawn per person from a distribution, so a cohort of twelve holds twelve
                      different tempers.
                    </Text>
                  </Measure>
                  <Button variant="secondary" onClick={() => set("patience", 3)}>
                    Use one value for everybody instead
                  </Button>
                </Stack>
              )}

              {typeof budget === "number" ? (
                <Field
                  label="What they would pay, a month"
                  hint="Zero means they are not willing to pay for this kind of product, and the prompt says so."
                >
                  {({ id, describedBy, invalid }) => (
                    <div className="w-40">
                      <NumberInput
                        id={id}
                        describedBy={describedBy}
                        invalid={invalid}
                        value={budget}
                        onChange={(v) => set("budgetUsd", v)}
                        step={5}
                      />
                    </div>
                  )}
                </Field>
              ) : (
                <Stack gap={2} align="start">
                  <Text size="label" tone="muted">
                    Budget
                  </Text>
                  <Text as="p" size="read-sm" tone="soft">
                    Drawn per person from a distribution.
                  </Text>
                </Stack>
              )}
            </Stack>
          </Card>
        </Section>

        <Traits traits={draft.traits} onChange={(traits) => set("traits", traits)} />

        <PersonaToolPolicy
          policy={draft.tools}
          onChange={(tools) => set("tools", tools)}
          projectKey={key}
          targetId={target?.id ?? null}
          simulationSlug={project.simulations[0]?.slug ?? null}
        />

        <Section title="What they think with">
          <Stack gap={4}>
            <Measure width="read">
              <Text as="p" size="read-sm" tone="soft">
                Left unset, both fall through to the project's own model.
              </Text>
            </Measure>
            <Card>
              <FieldGrid cols={2}>
                <Field label="Model">
                  {({ id, describedBy, invalid }) => (
                    <Select
                      id={id}
                      describedBy={describedBy}
                      invalid={invalid}
                      value={draft.model.model ?? ""}
                      onChange={(v) => set("model", { ...draft.model, ...(v === "" ? { model: undefined } : { model: v }) })}
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
                      value={draft.model.effort ?? ""}
                      onChange={(v) => set("model", { ...draft.model, ...(v === "" ? { effort: undefined } : { effort: v as NonNullable<Spec["model"]["effort"]> }) })}
                      options={EFFORTS}
                    />
                  )}
                </Field>
              </FieldGrid>
            </Card>
          </Stack>
        </Section>

        {existing ? (
          <Section title="Removing this persona">
            <Card>
              <Stack gap={4} align="start">
                <Measure width="read">
                  <Text as="p" size="read-sm" tone="soft">
                    The cohort drawn from this persona goes with it, and its people leave the
                    population. Where more than one cohort draws from it, removing it is refused —
                    take those apart first. Executions already run keep what these people found;
                    nobody new is drawn from it again.
                  </Text>
                </Measure>
                <ConfirmButton
                  title={`Remove ${draft.name || "this persona"}?`}
                  body="The cohort drawn from it goes too, and its people leave the population. Executions already run keep their people, their visits and their findings."
                  confirmLabel="Remove this persona"
                  variant="danger"
                  pending={remove.isPending}
                  onConfirm={() => remove.mutate()}
                >
                  <Button variant="danger">Remove this persona</Button>
                </ConfirmButton>
              </Stack>
            </Card>
          </Section>
        ) : null}
      </Stack>
    </FormPane>
  );

  return (
    <SplitPage
      header={
        <PageHeader
          title={draft.name || "New persona"}
          crumbs={[{ label: "Personas", to: href("library/personas") }, { label: existing?.spec.name ?? "New persona" }]}
          eyebrow="Persona"
          meta={
            existing === undefined
              ? undefined
              : [
                  { key: "slug", node: <Mono size="code-sm">{existing.slug}</Mono> },
                  {
                    key: "slug-note",
                    node: "the slug every person in this persona's cohorts is named from. Renaming never moves it.",
                  },
                ]
          }
        />
      }
      state={state}
      loading={
        <StateBlock
          kind="loading"
          what={what}
          skeleton={<Skeleton variant="block" height={148} count={3} label={`Reading ${what}`} />}
        />
      }
      error={
        <StateBlock kind="failed" what={what} error={personas.error}>
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
      left={form}
      right={<PromptPreview projectKey={key} personaId={existing?.id ?? null} dirty={dirty} targetId={target?.id ?? null} />}
    />
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
              empty="No traits. Everyone in a cohort is alike apart from their name and their detail line."
              onAdd={(name) => onChange({ ...traits, [name]: "" })}
              onRemove={(name) => onChange(Object.fromEntries(entries.filter(([other]) => other !== name)))}
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
                    <Input value={String(spec)} onChange={(v) => onChange({ ...traits, [trait]: v })} />
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
 * What stays here is what only a screen can do: the three reads it is matched against.
 */
function PersonaToolPolicy({
  policy,
  onChange,
  projectKey,
  targetId,
  simulationSlug,
}: {
  policy: ToolPolicyShape;
  onChange: (policy: ToolPolicyShape) => void;
  projectKey: string;
  targetId: string | null;
  simulationSlug: string | null;
}) {
  const [checked, setChecked] = useState<TargetCheck | null>(null);
  const preflight = useQuery({ ...q.preflight(projectKey, simulationSlug ?? ""), enabled: simulationSlug !== null });
  const targets = useQuery(q.targets(projectKey));
  const check = useMutation({ mutationFn: () => api.checkTarget(projectKey, targetId ?? ""), onSuccess: setChecked });

  // Two sources, and they are not the same list: a check is everything the target exposes, while
  // pre-flight's is what the merged policy already leaves. The check is preferred for that reason,
  // and asking for one is the control beside the list.
  const tools: PolicyTool[] =
    checked?.tools.map((tool) => ({ name: tool.name, description: tool.description, destructive: tool.destructive })) ??
    preflight.data?.target.tools.map((name) => ({ name })) ??
    [];

  // The TARGET's policy is the floor this persona stands on. Matching the globs below on their own
  // would show a tool as reachable that the target forbids — which is the one thing this panel
  // exists to be honest about.
  const targetPolicy = targets.data?.items.find((target) => target.id === targetId)?.tools ?? null;

  return (
    <Section title="What they are allowed to touch">
      <Stack gap={4}>
        <Measure width="read">
          <Text as="p" size="read-sm" tone="soft">
            Globs, matched against the target's own tool list.
          </Text>
        </Measure>
        <ToolPolicyEditor
          policy={policy}
          onChange={onChange}
          floor={targetPolicy}
          tools={tools.length === 0 ? null : tools}
          allowPlaceholder="list_*, search_*"
          denyPlaceholder="delete_*"
          destructiveHint="A persona may be stricter than the target, never looser."
          whenUnknown="No tool list to match against yet. Connect a target, and this fills in."
          action={
            targetId === null ? undefined : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => check.mutate()}
                pending={check.isPending}
              >
                Ask the target again
              </Button>
            )
          }
        />
      </Stack>
    </Section>
  );
}

/**
 * The prompt, as the runner renders it. Everything above is only ever a way of writing this.
 *
 * **It is a preview OF A TARGET.** The system prompt carries the target's own description and its
 * tool list, so which target it is changes what comes back — and the server now refuses to pick
 * one when a project holds several, because `listTargets[0]` meant "whichever you edited last".
 * The target is chosen here, from the list this screen already loads, and it is part of the query
 * key so switching target refetches rather than showing a cached prompt for the other one.
 */
function PromptPreview({
  projectKey,
  personaId,
  dirty,
  targetId,
}: {
  projectKey: string;
  personaId: string | null;
  dirty: boolean;
  targetId: string | null;
}) {
  const preview = useQuery({
    ...q.personaPreview(projectKey, personaId ?? "", targetId),
    enabled: personaId !== null,
  });

  return (
    <Section title="What the model is told">
      {personaId === null ? (
        <StateBlock kind="empty" what="the prompt">
          Save this persona and the prompt it produces is rendered here, by the same code the
          runner uses.
        </StateBlock>
      ) : preview.isPending ? (
        <StateBlock
          kind="loading"
          what="the prompt"
          skeleton={<Skeleton variant="block" height={320} label="Reading the prompt" />}
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
          {dirty ? <FieldWarning>Unsaved edits are not in this yet.</FieldWarning> : null}
          <PayloadBlock caption="The prompt" value={preview.data.text} maxLines={48} />
          <Measure width="read">
            <Text as="p" size="meta" tone="muted">
              A person's own name and their detail line go in at the top of this, and their memory
              and account arrive in the first message of each visit.
            </Text>
          </Measure>
        </Stack>
      )}
    </Section>
  );
}

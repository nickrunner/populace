import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { isToolAllowed, type PersonaSpec, type TraitSpec, type TraitValue } from "@populace/core/isomorphic";
import { api, type TargetCheck } from "../../api.js";
import { q } from "../../queries.js";
import { useProject } from "../../context.jsx";
import { Breadcrumb, Button, Card, Chip, Failed, Field, Input, Loading, Mono, NumberInput, Payload, Problem, Section, Select, TextArea, ToolName } from "../../components/ui.jsx";

/**
 * The editor that decides whether any of this is worth reading.
 *
 * Nothing else in the product changes the findings as much: a persona with a real errand finds
 * real problems, and a persona told to "test the search" files a test report. So the two things
 * that are easy to get wrong are shown rather than described — the tool policy is matched against
 * the target's actual tool list as you type, and the prompt the model will be handed is rendered
 * down the right by the runner's own code (product judge gap #6).
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

  const [draft, setDraft] = useState<Spec>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);

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

  if (personas.isPending) return <Loading what="this persona" />;
  if (personas.isError) return <Failed error={personas.error} />;

  return (
    <>
      <header className="mb-7 flex items-start justify-between gap-6">
        <div>
          <Breadcrumb items={[{ label: "Personas", to: href("library/personas") }, { label: existing?.spec.name ?? "New persona" }]} />
          <h1 className="t-title mt-1">{draft.name || "New persona"}</h1>
          {existing ? (
            <p className="t-meta text-ink-muted mt-1">
              <Mono className="text-[11px]">{existing.slug}</Mono> — the slug every person id in this persona's cohorts is built from. Renaming never moves it.
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {dirty ? <Chip>unsaved</Chip> : null}
          <Button tone="go" onClick={() => save.mutate()} disabled={save.isPending || draft.name === "" || draft.role === "" || draft.backstory === "" || draft.goals.filter(Boolean).length === 0}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </header>

      {save.isError ? <Problem>{save.error.message}</Problem> : null}
      {remove.isError ? <Problem>{remove.error.message}</Problem> : null}

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-8 items-start">
        <div>
          <Section title="Who they are">
            <Card className="p-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Name" hint="The kind of person, not a person: “First-time visitor”, not “Dana”.">
                  <Input value={draft.name} onChange={(v) => set("name", v)} placeholder="First-time visitor" />
                </Field>
                <Field label="Role">
                  <Input value={draft.role} onChange={(v) => set("role", v)} placeholder="someone who just heard about this" />
                </Field>
              </div>
              <Field label="Backstory" hint="Line two of their prompt. Why they turned up, in their own life's terms.">
                <TextArea value={draft.backstory} onChange={(v) => set("backstory", v)} rows={3} placeholder="You keep your week in your head and it keeps falling out…" />
              </Field>
            </Card>
          </Section>

          <Section title="What they came to do" sub="errands, not instructions">
            <Card className="p-4">
              {draft.goals.map((goal, i) => (
                <div key={i} className="mb-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <Input value={goal} onChange={(v) => set("goals", draft.goals.map((g, j) => (j === i ? v : g)))} placeholder="Get this week's tasks written down somewhere you trust" />
                    </div>
                    <Button onClick={() => set("goals", draft.goals.filter((_, j) => j !== i))} title="Remove this goal">
                      −
                    </Button>
                  </div>
                  {TESTER_WORDS.test(goal) ? (
                    <p className="t-meta text-medium mt-1">
                      This reads like an instruction to a tester. People who are told to test a product find test results; people with an errand find what is actually in the way.
                    </p>
                  ) : null}
                </div>
              ))}
              <Button onClick={() => set("goals", [...draft.goals, ""])}>+ Another goal</Button>
            </Card>
          </Section>

          <Section title="What they will not do" sub="constraints, in their own voice">
            <Card className="p-4">
              {draft.constraints.map((constraint, i) => (
                <div key={i} className="flex items-start gap-2 mb-3">
                  <div className="flex-1">
                    <Input value={constraint} onChange={(v) => set("constraints", draft.constraints.map((c, j) => (j === i ? v : c)))} placeholder="You will not hand over a credit card on a first visit" />
                  </div>
                  <Button onClick={() => set("constraints", draft.constraints.filter((_, j) => j !== i))} title="Remove this constraint">
                    −
                  </Button>
                </div>
              ))}
              <Button onClick={() => set("constraints", [...draft.constraints, ""])}>+ Another constraint</Button>
            </Card>
          </Section>

          <Section title="How much they will put up with">
            <Card className="p-4">
              {typeof draft.patience === "number" ? (
                <Field label="Patience">
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={1}
                    value={draft.patience}
                    onChange={(e) => set("patience", Number(e.target.value))}
                    className="w-full accent-[var(--color-accent)]"
                    aria-label="patience"
                  />
                  <p className="t-body text-ink-soft mt-1">{PATIENCE[asNumber(draft.patience, 3)]}</p>
                </Field>
              ) : (
                <div className="mb-4">
                  <div className="t-label text-ink-muted mb-1.5">Patience</div>
                  <p className="t-body text-ink-soft">Drawn per person from a distribution, so a cohort of twelve holds twelve different tempers.</p>
                  <Button onClick={() => set("patience", 3)}>Use one value for everybody instead</Button>
                </div>
              )}
              {typeof draft.budgetUsd === "number" ? (
                <Field label="What they would pay, a month" hint="Zero means they are not willing to pay for this kind of product, and the prompt says so.">
                  <div className="w-40">
                    <NumberInput value={draft.budgetUsd} onChange={(v) => set("budgetUsd", v)} step={5} />
                  </div>
                </Field>
              ) : (
                <div className="mb-4">
                  <div className="t-label text-ink-muted mb-1.5">Budget</div>
                  <p className="t-body text-ink-soft">Drawn per person from a distribution.</p>
                </div>
              )}
            </Card>
          </Section>

          <Traits traits={draft.traits} onChange={(traits) => set("traits", traits)} />

          <ToolPolicy
            policy={draft.tools}
            onChange={(tools) => set("tools", tools)}
            projectKey={key}
            targetId={project.simulations[0]?.target.id ?? null}
            simulationSlug={project.simulations[0]?.slug ?? null}
          />

          <Section title="What they think with" sub="unset falls through to the project's model">
            <Card className="p-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Model">
                  <Select
                    value={draft.model.model ?? ""}
                    onChange={(v) => set("model", { ...draft.model, ...(v === "" ? { model: undefined } : { model: v }) })}
                    options={[
                      { value: "", label: "Whatever the project uses" },
                      { value: "claude-opus-5", label: "Opus 5 — the most capable, and the most expensive" },
                      { value: "claude-sonnet-5", label: "Sonnet 5 — a good default for the people" },
                      { value: "claude-haiku-4-5", label: "Haiku 4.5 — cheapest, for wide populations" },
                    ]}
                  />
                </Field>
                <Field label="Effort">
                  <Select
                    value={draft.model.effort ?? ""}
                    onChange={(v) => set("model", { ...draft.model, ...(v === "" ? { effort: undefined } : { effort: v as NonNullable<Spec["model"]["effort"]> }) })}
                    options={[{ value: "", label: "Whatever the project uses" }, ...["low", "medium", "high", "xhigh", "max"].map((effort) => ({ value: effort, label: effort }))]}
                  />
                </Field>
              </div>
            </Card>
          </Section>

          {existing ? (
            <Card className="p-4 mb-8">
              <p className="t-body text-ink-soft mb-2">
                Removing this persona takes its cohorts apart with it. Past executions keep what these people found; nobody new is drawn from it again.
              </p>
              <Button tone="stop" onClick={() => remove.mutate()} disabled={remove.isPending}>
                Remove this persona
              </Button>
            </Card>
          ) : null}
        </div>

        <PromptPreview projectKey={key} personaId={existing?.id ?? null} dirty={dirty} />
      </div>
    </>
  );
}

/** Traits are whatever this product needs them to be; the prompt prints them as `key=value`. */
function Traits({ traits, onChange }: { traits: Spec["traits"]; onChange: (traits: Spec["traits"]) => void }) {
  const [name, setName] = useState("");
  const entries = Object.entries(traits);
  const samples = useMemo(() => Array.from({ length: 5 }, () => entries.map(([trait, spec]) => `${trait}=${String(draw(spec))}`).join(", ")), [traits]);

  return (
    <Section title="What tells them apart" sub="one line in the prompt, and a draw per person">
      <Card className="p-4">
        {entries.length === 0 ? <p className="t-body text-ink-muted italic mb-3">No traits. Everyone in a cohort is alike apart from their name and their detail line.</p> : null}
        {entries.map(([trait, spec]) => (
          <div key={trait} className="flex items-center gap-2 mb-2">
            <Mono className="text-[12.5px] text-evidence w-40 shrink-0">{trait}</Mono>
            {typeof spec === "object" ? (
              <span className="t-body text-ink-soft flex-1">
                {spec.distribution === "uniform" ? `anything from ${spec.min} to ${spec.max}` : `one of ${spec.values.map(String).join(", ")}`}
              </span>
            ) : (
              <div className="flex-1">
                <Input value={String(spec)} onChange={(v) => onChange({ ...traits, [trait]: v })} />
              </div>
            )}
            <Button onClick={() => onChange(Object.fromEntries(entries.filter(([other]) => other !== trait)))} title={`Remove ${trait}`}>
              −
            </Button>
          </div>
        ))}
        <div className="flex items-end gap-2 mt-3">
          <div className="flex-1 max-w-[240px]">
            <span className="t-label text-ink-muted block mb-1.5">Add a trait</span>
            <Input value={name} onChange={setName} placeholder="device" mono />
          </div>
          <Button
            onClick={() => {
              if (name.trim() === "") return;
              onChange({ ...traits, [name.trim()]: "" });
              setName("");
            }}
          >
            Add
          </Button>
        </div>
        {entries.length > 0 ? (
          <div className="mt-4 border-t border-rule pt-3">
            <div className="t-label text-ink-muted mb-1.5">Five draws from this</div>
            <ul>
              {samples.map((sample, i) => (
                <li key={i} className="t-meta text-ink-muted font-mono">
                  {sample}
                </li>
              ))}
            </ul>
            <p className="t-meta text-ink-muted mt-1.5">
              Examples of what the spec can produce. The real draws are made per person from the cohort's seed, so they stay the same between executions.
            </p>
          </div>
        ) : null}
      </Card>
    </Section>
  );
}

/** Allow and deny are globs, and a glob is only as good as what it matches. So: show the matches. */
function ToolPolicy({
  policy,
  onChange,
  projectKey,
  targetId,
  simulationSlug,
}: {
  policy: Spec["tools"];
  onChange: (policy: Spec["tools"]) => void;
  projectKey: string;
  targetId: string | null;
  simulationSlug: string | null;
}) {
  const [checked, setChecked] = useState<TargetCheck | null>(null);
  const preflight = useQuery({ ...q.preflight(projectKey, simulationSlug ?? ""), enabled: simulationSlug !== null });
  const check = useMutation({ mutationFn: () => api.checkTarget(projectKey, targetId ?? ""), onSuccess: setChecked });

  const tools = checked?.tools.map((tool) => tool.name) ?? preflight.data?.target.tools ?? [];
  const asList = (value: string): string[] =>
    value
      .split(/[,\n]/)
      .map((pattern) => pattern.trim())
      .filter(Boolean);

  return (
    <Section title="What they are allowed to touch" sub="globs, matched against the target's own tool list">
      <Card className="p-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Allow" hint="Empty means everything the target exposes.">
            <Input value={policy.allow.join(", ")} onChange={(v) => onChange({ ...policy, allow: asList(v) })} placeholder="list_*, search_*" mono />
          </Field>
          <Field label="Deny" hint="Always wins over allow.">
            <Input value={policy.deny.join(", ")} onChange={(v) => onChange({ ...policy, deny: asList(v) })} placeholder="delete_*" mono />
          </Field>
        </div>
        <Field label="Tools the target marks destructive">
          <Select
            value={policy.destructive}
            onChange={(v) => onChange({ ...policy, destructive: v as Spec["tools"]["destructive"] })}
            options={[
              { value: "confirm", label: "Ask them to confirm first (recommended)" },
              { value: "allow", label: "Let them do it" },
              { value: "deny", label: "Never" },
            ]}
          />
        </Field>

        <div className="border-t border-rule pt-3">
          <div className="flex items-baseline gap-3 mb-2">
            <span className="t-label text-ink-muted">What that leaves them</span>
            {targetId === null ? null : (
              <Button onClick={() => check.mutate()} disabled={check.isPending}>
                {check.isPending ? "Asking the target…" : "Ask the target again"}
              </Button>
            )}
          </div>
          {tools.length === 0 ? (
            <p className="t-body text-ink-muted italic">No tool list to match against yet. Connect a target, and this fills in.</p>
          ) : (
            <p className="flex flex-wrap gap-x-3 gap-y-1.5">
              {tools.map((tool) => {
                const allowed = isToolAllowed(tool, policy.allow, policy.deny);
                return (
                  <span key={tool} className={allowed ? "" : "line-through opacity-50"}>
                    <ToolName name={tool} />
                  </span>
                );
              })}
            </p>
          )}
        </div>
      </Card>
    </Section>
  );
}

/** The prompt, as the runner renders it. Everything above is only ever a way of writing this. */
function PromptPreview({ projectKey, personaId, dirty }: { projectKey: string; personaId: string | null; dirty: boolean }) {
  const preview = useQuery({ ...q.personaPreview(projectKey, personaId ?? ""), enabled: personaId !== null });

  return (
    <div className="sticky top-9">
      <div className="flex items-baseline gap-3 mb-3">
        <h2 className="t-section">What the model is told</h2>
        {dirty ? <span className="t-meta text-medium">unsaved edits are not in this yet</span> : null}
      </div>
      {personaId === null ? (
        <Card className="p-4">
          <p className="t-body text-ink-muted italic">Save this persona and the prompt it produces is rendered here, by the same code the runner uses.</p>
        </Card>
      ) : preview.isPending ? (
        <Loading what="the prompt" />
      ) : preview.isError ? (
        <Failed error={preview.error} />
      ) : (
        <>
          <Payload>{preview.data.text}</Payload>
          <p className="t-meta text-ink-muted mt-2">
            A person's own name and their detail line go in at the top of this, and their memory and account arrive in the first message of each visit.
          </p>
        </>
      )}
    </div>
  );
}

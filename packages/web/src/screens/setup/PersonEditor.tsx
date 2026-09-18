import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { PersonaInput } from "@populace/contract";
import type { TraitSpec, TraitValue } from "@populace/core";
import { api, type Persona } from "../../api.js";
import { Avatar, Button, Card, Disclosure, Empty, Failed, Field, Input, Lines, Loading, Mono, Payload, Problem, Saved, Section, Select, Slider, TextArea } from "../../components/ui.jsx";
import { usd } from "../../format.js";

type Spec = PersonaInput["spec"];

/**
 * Writing a person. Everything on this screen ends up in one place — the system prompt on the
 * right — and the panel is rendered by the server from the same function the runner calls, so
 * what it shows is literally what she will be told (`preview.ts`).
 *
 * The other thing this screen has to get right is that renaming is safe. A persona's slug is what
 * agent ids are built from, so a rename that moved it would break continuations, which is the
 * product's differentiated feature. The slug is shown, in monospace, and never edited.
 */
export function PersonEditor() {
  const { personaId } = useParams();
  const queries = useQueryClient();
  const navigate = useNavigate();
  const personas = useQuery({ queryKey: ["personas"], queryFn: () => api.personas() });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.settings() });
  const person = personas.data?.items.find((p) => p.id === personaId);

  const [draft, setDraft] = useState<Spec | null>(null);
  const [openedAs, setOpenedAs] = useState<string | null>(null);

  // Switching person in the rail replaces the draft; editing the same person does not.
  useEffect(() => {
    if (person && openedAs !== person.id) {
      setDraft(specOf(person));
      setOpenedAs(person.id);
    }
  }, [person, openedAs]);

  const preview = useQuery({
    queryKey: ["persona-preview", personaId, draft],
    queryFn: () => api.previewPersona(personaId ?? "", draft ?? undefined),
    enabled: personaId !== undefined && draft !== null,
  });

  const save = useMutation({
    // A blank line is a row someone added and has not filled in yet; it is fine while they type
    // and is not a person's errand, so it does not get saved as one.
    mutationFn: async () => (draft && personaId ? api.savePersona(personaId, { spec: { ...draft, goals: draft.goals.filter((g) => g.trim() !== ""), constraints: draft.constraints.filter((c) => c.trim() !== "") } }) : undefined),
    onSuccess: async () => {
      await queries.invalidateQueries();
    },
  });
  const duplicate = useMutation({
    mutationFn: () => api.duplicatePersona(personaId ?? ""),
    onSuccess: async (copy) => {
      await queries.invalidateQueries();
      void navigate(`/setup/people/${encodeURIComponent(copy.id)}`);
    },
  });

  if (personas.isPending || settings.isPending) return <Loading what="this person" />;
  if (personas.isError) return <Failed error={personas.error} />;
  if (!person || !draft) return <Empty>That person is not in this project. <Link className="text-accent" to="/setup/people">Back to the people</Link>.</Empty>;

  const edit = (patch: Partial<Spec>): void => setDraft({ ...draft, ...patch });
  const changed = JSON.stringify(draft) !== JSON.stringify(specOf(person));

  return (
    <div>
      <div className="t-meta text-ink-muted mb-1">
        <Link to="/setup/people" className="text-accent">
          The people
        </Link>
      </div>
      <header className="mb-6 flex items-start gap-3">
        <Avatar name={draft.name} />
        <div className="flex-1 min-w-0">
          <h1 className="t-title">{draft.name || "Someone new"}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Mono className="text-[11.5px] text-ink-muted">{person.slug}</Mono>
            <span className="t-meta text-ink-muted">·</span>
            <span className="t-meta text-ink-muted">{person.count === 0 ? "staying home next run" : `${person.count} going on the next run`}</span>
            {changed ? <span className="t-meta text-accent">· unsaved</span> : <Saved at={person.updatedAt} />}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button onClick={() => duplicate.mutate()} disabled={duplicate.isPending} title="Copy this person under a new id">
            Duplicate
          </Button>
          <Button tone="go" onClick={() => save.mutate()} disabled={save.isPending || !changed}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </header>

      {save.isError ? <Problem>{save.error.message}</Problem> : null}
      {duplicate.isError ? <Problem>{duplicate.error.message}</Problem> : null}

      <div className="flex gap-7 items-start">
        <div className="flex-1 min-w-0">
          <Section title="Who they are">
            <Field label="Their name">
              <Input value={draft.name} onChange={(name) => edit({ name })} placeholder="Priya Desai" />
            </Field>
            <Field label="What they do">
              <Input value={draft.role} onChange={(role) => edit({ role })} placeholder="a freelance designer who plans client projects with deadlines" />
            </Field>
            <Field label="Where they are coming from" hint="The more specific this is, the less they behave like everyone else you send.">
              <TextArea value={draft.backstory} onChange={(backstory) => edit({ backstory })} rows={4} placeholder="She runs four or five client projects at once and lives by due dates." />
            </Field>
          </Section>

          <Section title="What they came to do" sub="in the order they would try them">
            <Lines values={draft.goals} onChange={(goals) => edit({ goals })} placeholder="Track a client launch with dated tasks" addLabel="+ Add one" ordered />
            <p className="t-meta text-ink-muted mt-2">They report on whether they finished each of these, not on whether your tools returned 200.</p>
          </Section>

          <Section title="What they will not do">
            <Lines values={draft.constraints} onChange={(constraints) => edit({ constraints })} placeholder="Will not hand over a card without a trial" addLabel="+ Add one" />
          </Section>

          <Section title="How they behave">
            <Field label="How much they will put up with">
              <Slider
                value={fixedNumber(draft.patience, 3)}
                onChange={(patience) => edit({ patience })}
                low="leaves at the first snag"
                high="will grind through anything"
                reading={`${fixedNumber(draft.patience, 3)} of 5 — ${PATIENCE[fixedNumber(draft.patience, 3)] ?? ""}`}
              />
            </Field>

            <Budget value={draft.budgetUsd} onChange={(budgetUsd) => edit({ budgetUsd })} />

            <Field label="Anything else true of them" hint="One `key: value` a line. Free-form, and it reaches them word for word.">
              <TextArea value={traitsToText(draft.traits)} onChange={(text) => edit({ traits: textToTraits(text, draft.traits) })} rows={3} placeholder="device: laptop" />
            </Field>

            <div className="flex flex-col gap-2 mt-2">
              <Disclosure title="Which of your tools they may touch" summary={toolSummary(draft.tools)}>
                <Field label="Only these" hint="Glob patterns, one a line. Empty means every tool the target offers.">
                  <TextArea value={draft.tools.allow.join("\n")} onChange={(text) => edit({ tools: { ...draft.tools, allow: lines(text) } })} rows={2} placeholder="task_*" />
                </Field>
                <Field label="Never these" hint="Always wins over the list above.">
                  <TextArea value={draft.tools.deny.join("\n")} onChange={(text) => edit({ tools: { ...draft.tools, deny: lines(text) } })} rows={2} placeholder="delete_account" />
                </Field>
              </Disclosure>

              <Disclosure title="What happens with destructive tools" summary={DESTRUCTIVE[draft.tools.destructive] ?? "ask them to confirm first"}>
                <Field label="When a tool says it destroys something" hint="Driven by the tool's own `destructiveHint`, not by its name.">
                  <Select
                    value={draft.tools.destructive}
                    onChange={(value) => edit({ tools: { ...draft.tools, destructive: value === "allow" || value === "deny" ? value : "confirm" } })}
                    options={[
                      { value: "confirm", label: "ask them to confirm first" },
                      { value: "allow", label: "let them use it" },
                      { value: "deny", label: "keep them away from it" },
                    ]}
                  />
                </Field>
              </Disclosure>

              <Disclosure title="Which model they run on" summary={preview.data ? `${preview.data.model.model}${preview.data.model.inherited ? " — the run's default" : ""}` : "the run's default"}>
                <Field label="Model" hint="Empty falls through to the run's own model.">
                  <Input value={draft.model.model ?? ""} onChange={(value) => edit({ model: { ...draft.model, ...(value ? { model: value } : { model: undefined }) } })} placeholder={settings.data?.model.model ?? ""} mono />
                </Field>
                <Field label="Effort">
                  <Select
                    value={draft.model.effort ?? ""}
                    onChange={(value) => edit({ model: { ...draft.model, ...(value ? { effort: effortOf(value) } : { effort: undefined }) } })}
                    options={[{ value: "", label: `the run's default (${settings.data?.model.effort ?? "high"})` }, ...EFFORTS.map((e) => ({ value: e, label: e }))]}
                  />
                </Field>
              </Disclosure>
            </div>
          </Section>

          <div className="mb-8">
            <Card className="p-3.5">
              <div className="t-body text-ink">Renaming them is safe</div>
              <p className="t-meta text-ink-muted mt-1.5 max-w-[60ch]">
                Their id stays <Mono className="text-[11px]">{person.slug}</Mono> whatever you call them, so a re-run months from now still recognises them as the same person and hands them back
                their own memory.
              </p>
            </Card>
          </div>
        </div>

        <aside className="w-[340px] shrink-0 sticky top-0">
          <div className="t-section">What they will be told</div>
          <p className="t-meta text-ink-muted mt-1.5 leading-relaxed">Everything on the left, assembled the way they receive it at the start of every visit. Nothing else is in there.</p>
          {preview.isError ? <Failed error={preview.error} /> : null}
          {preview.data ? (
            <>
              {preview.data.target.configured ? null : <p className="t-meta text-ink-muted mt-2">No target is connected yet, so the product below has no name.</p>}
              <div className="mt-3">
                <Payload>{preview.data.systemPrompt}</Payload>
              </div>
              <p className="t-meta text-ink-muted mt-2.5">
                Read for <Mono className="text-[11px]">{preview.data.agentId}</Mono>, the first of them. Patience {preview.data.sampled.patience} of 5, {usd(preview.data.sampled.budgetUsd)} a month.
              </p>
            </>
          ) : (
            <p className="t-meta text-ink-muted mt-3">Assembling…</p>
          )}
        </aside>
      </div>
    </div>
  );
}

const PATIENCE: Record<number, string> = {
  1: "leaves the moment anything is confusing",
  2: "tries twice, then moves on",
  3: "tolerates a snag or two",
  4: "reads the docs before giving up",
  5: "will grind through almost anything",
};

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];
const effortOf = (value: string): Effort | undefined => EFFORTS.find((e) => e === value);

const DESTRUCTIVE: Record<string, string> = {
  confirm: "ask them to confirm first",
  allow: "let them use it",
  deny: "keep them away from it",
};

function toolSummary(tools: Spec["tools"]): string {
  if (tools.allow.length === 0 && tools.deny.length === 0) return "everything the target offers";
  const parts: string[] = [];
  if (tools.allow.length) parts.push(`only ${tools.allow.length} pattern(s)`);
  if (tools.deny.length) parts.push(`${tools.deny.length} kept back`);
  return parts.join(", ");
}

function specOf(person: Persona): Spec {
  const { id: _id, ...spec } = person.spec;
  return spec;
}

const lines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

/** A trait can be a fixed value or a range sampled per agent; the slider edits the fixed case. */
function fixedNumber(spec: TraitSpec, fallback: number): number {
  if (typeof spec === "number") return spec;
  if (typeof spec === "object" && spec.distribution === "uniform") return Math.round((spec.min + spec.max) / 2);
  return fallback;
}

function rangeOf(spec: TraitSpec): { min: number; max: number } | null {
  return typeof spec === "object" && spec.distribution === "uniform" ? { min: spec.min, max: spec.max } : null;
}

/**
 * What they would pay. A single figure is the common case; a range is what makes two agents grown
 * from one person different people, so the screen offers it rather than hiding it in the YAML.
 */
function Budget({ value, onChange }: { value: TraitSpec; onChange: (spec: TraitSpec) => void }) {
  const range = rangeOf(value);
  const fixed = fixedNumber(value, 0);
  return (
    <Field label="What they would pay a month" hint={range ? "Sampled in this range for each person grown from them." : "The same for every person grown from them."}>
      {range ? (
        <div className="flex items-center gap-2">
          <Input value={String(range.min)} onChange={(text) => onChange({ distribution: "uniform", min: Number(text) || 0, max: range.max, integer: false })} />
          <span className="t-meta text-ink-muted">to</span>
          <Input value={String(range.max)} onChange={(text) => onChange({ distribution: "uniform", min: range.min, max: Number(text) || 0, integer: false })} />
          <Button onClick={() => onChange(Math.round((range.min + range.max) / 2))}>One figure</Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input value={String(fixed)} onChange={(text) => onChange(Number(text) || 0)} />
          <Button onClick={() => onChange({ distribution: "uniform", min: Math.max(0, fixed - 5), max: fixed + 5, integer: false })}>A range</Button>
        </div>
      )}
    </Field>
  );
}

/**
 * Traits as `key: value` lines. A trait that is sampled from a distribution cannot be written on
 * one line, so those are kept exactly as they are and edited in the config file instead of being
 * flattened into something they are not.
 */
function traitsToText(traits: Record<string, TraitSpec>): string {
  return Object.entries(traits)
    .filter(([, spec]) => typeof spec !== "object")
    .map(([key, spec]) => `${key}: ${String(spec as TraitValue)}`)
    .join("\n");
}

function textToTraits(text: string, previous: Record<string, TraitSpec>): Record<string, TraitSpec> {
  const sampled = Object.fromEntries(Object.entries(previous).filter(([, spec]) => typeof spec === "object"));
  const written: Record<string, TraitSpec> = {};
  for (const line of lines(text)) {
    const at = line.indexOf(":");
    const key = (at === -1 ? line : line.slice(0, at)).trim();
    if (key === "") continue;
    const raw = at === -1 ? "" : line.slice(at + 1).trim();
    written[key] = raw === "true" ? true : raw === "false" ? false : raw !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
  }
  return { ...sampled, ...written };
}

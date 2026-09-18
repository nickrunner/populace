import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type PopulationView, type Settings } from "../../api.js";
import { Button, Card, Chip, Failed, Field, Loading, NumberInput, Problem, Saved, Section, Select } from "../../components/ui.jsx";
import { usd } from "../../format.js";

const seconds = (ms: number): number => Math.round(ms / 1000);
const toMs = (s: number): number => Math.max(0, Math.round(s)) * 1000;

/**
 * Limits and spending. Every field here is a guardrail the runner enforces, not a hint to the
 * model (ADR-0009): the ceilings below are what actually stop a run, whatever any estimate says.
 */
export function Limits() {
  const queries = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.settings() });
  const population = useQuery({ queryKey: ["population"], queryFn: () => api.population() });
  const spendToday = useQuery({ queryKey: ["setup"], queryFn: () => api.setup() });

  const [draft, setDraft] = useState<Settings | null>(null);
  const [pop, setPop] = useState<PopulationView | null>(null);

  useEffect(() => {
    if (draft === null && settings.data) setDraft(settings.data);
  }, [draft, settings.data]);
  useEffect(() => {
    if (pop === null && population.data) setPop(population.data);
  }, [pop, population.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft || !pop) return;
      await api.saveSettings({ model: draft.model, guardrails: draft.guardrails, verifier: draft.verifier, daemon: draft.daemon });
      await api.savePopulation({ scale: pop.scale, cadence: pop.cadence, maxWakes: pop.maxWakes, seed: pop.seed });
    },
    onSuccess: async () => {
      await queries.invalidateQueries();
    },
  });

  if (settings.isPending || population.isPending) return <Loading what="your limits" />;
  if (settings.isError) return <Failed error={settings.error} />;
  if (population.isError) return <Failed error={population.error} />;
  if (!draft || !pop) return <Loading what="your limits" />;

  const guard = draft.guardrails;
  const setGuard = (patch: Partial<Settings["guardrails"]>): void => setDraft({ ...draft, guardrails: { ...guard, ...patch } });
  const setPerWake = (patch: Partial<Settings["guardrails"]["perWake"]>): void => setGuard({ perWake: { ...guard.perWake, ...patch } });

  const models = [
    { value: "claude-opus-5", label: "Opus 5 — the most capable, and the most expensive" },
    { value: "claude-sonnet-5", label: "Sonnet 5 — a good default for the people" },
    { value: "claude-haiku-4-5", label: "Haiku 4.5 — cheapest, for wide populations" },
  ];
  const efforts = ["low", "medium", "high", "xhigh", "max"].map((e) => ({ value: e, label: e }));

  return (
    <div>
      <header className="mb-7 flex items-start justify-between gap-6">
        <div>
          <h1 className="t-title">Limits and spending</h1>
          <p className="t-body text-ink-soft mt-2 max-w-[68ch]">
            What a run is allowed to cost, how often the people come back, and which models they and the judge run on. These are enforced while a run is going, not suggested to it.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Saved at={draft.updatedAt} />
          <Button tone="go" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </header>

      {save.isError ? <Problem>{save.error.message}</Problem> : null}
      {!draft.hasApiKey ? (
        <Card className="p-4 mb-6 border-critical/30">
          <p className="t-body text-ink">This install has no <code className="font-mono text-[12.5px] text-evidence">ANTHROPIC_API_KEY</code>.</p>
          <p className="t-body text-ink-soft mt-1">The dashboard works without one, but nobody can visit anything: a person is a sequence of model calls. Set it in the environment and restart.</p>
        </Card>
      ) : null}

      <Section title="Spending">
        <Card className="p-4">
          <div className="mb-4 flex items-center gap-3">
            <Chip tone={spendToday.data && spendToday.data.killSwitch.engaged ? "bad" : "neutral"}>
              {spendToday.data?.killSwitch.engaged ? "everything is stopped" : "running normally"}
            </Chip>
            <span className="t-meta text-ink-muted">the daily ceiling is {usd(guard.dailyUsd)} across every run on this machine</span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Per visit, dollars" hint="A visit that reaches this stops where it is.">
              <NumberInput value={guard.perWake.maxUsd} onChange={(v) => setPerWake({ maxUsd: v })} step={0.5} />
            </Field>
            <Field label="Per visit, turns" hint="How many times someone may think before they have to stop.">
              <NumberInput value={guard.perWake.maxTurns} onChange={(v) => setPerWake({ maxTurns: v })} />
            </Field>
            <Field label="Daily, dollars" hint="Trailing 24 hours, across the whole population.">
              <NumberInput value={guard.dailyUsd} onChange={(v) => setGuard({ dailyUsd: v })} step={5} />
            </Field>
          </div>
        </Card>
      </Section>

      <Section title="How often they come back">
        <Card className="p-4">
          <div className="grid grid-cols-3 gap-4">
            <Field label="A visit every… (seconds)">
              <NumberInput value={seconds(pop.cadence.every)} onChange={(v) => setPop({ ...pop, cadence: { ...pop.cadence, every: toMs(v) } })} min={5} />
            </Field>
            <Field label="Give or take… (seconds)" hint="Random extra delay, so they do not all arrive at once.">
              <NumberInput value={seconds(pop.cadence.jitter)} onChange={(v) => setPop({ ...pop, cadence: { ...pop.cadence, jitter: toMs(v) } })} />
            </Field>
            <Field label="Stop each person after… (visits)" hint="Zero means they keep coming back until you stop the run.">
              <NumberInput value={pop.maxWakes ?? 0} onChange={(v) => setPop({ ...pop, maxWakes: v > 0 ? v : null })} />
            </Field>
          </div>
        </Card>
      </Section>

      <Section title="Who does the thinking" sub="the people, and the judge that checks what they file">
        <div className="grid grid-cols-2 gap-4">
          <Card className="p-4">
            <div className="t-label text-ink-muted mb-3">The people</div>
            <Field label="Model">
              <Select value={draft.model.model} onChange={(v) => setDraft({ ...draft, model: { ...draft.model, model: v } })} options={models} />
            </Field>
            <Field label="Effort">
              <Select value={draft.model.effort} onChange={(v) => setDraft({ ...draft, model: { ...draft.model, effort: v as Settings["model"]["effort"] } })} options={efforts} />
            </Field>
          </Card>
          <Card className="p-4">
            <div className="t-label text-ink-muted mb-3">The judge</div>
            <Field label="How findings are checked" hint="The judge replays a finding's tool calls against the target and rules on what came back.">
              <Select
                value={draft.verifier.judge}
                onChange={(v) => setDraft({ ...draft, verifier: { ...draft.verifier, judge: v as Settings["verifier"]["judge"] } })}
                options={[
                  { value: "model", label: "Ask a model to judge the replay" },
                  { value: "heuristic", label: "Compare the replay mechanically (free)" },
                ]}
              />
            </Field>
            <Field label="Model" hint="The judge decides what reaches the digest, so it is worth running stronger than the people it judges.">
              <Select value={draft.verifier.model.model ?? draft.model.model} onChange={(v) => setDraft({ ...draft, verifier: { ...draft.verifier, model: { ...draft.verifier.model, model: v } } })} options={models} />
            </Field>
          </Card>
        </div>
      </Section>
    </div>
  );
}

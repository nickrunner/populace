import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import type { ClusterDetail, Triage as TriageView } from "../api.js";
import { api } from "../api.js";
import { keys, q } from "../queries.js";
import { useProject, useSimulation } from "../context.jsx";
import { ago, ms, stateOfCluster, usd4, when } from "../format.js";
import { Incidence } from "../components/ClusterRow.jsx";
import { Avatar, Bar, Breadcrumb, Button, CallRef, Card, Failed, Loading, Mono, Payload, Select, Severity, TextArea, ToolName, Verdict } from "../components/ui.jsx";

/**
 * One problem, in full — and the first level of the product where a person is named (SPEC §7.1).
 *
 * The name appears as ATTRIBUTION. "Dana Whitfield" above a quote is what makes the quote a
 * person's account of something rather than an anonymous string, and it is exactly here that it
 * becomes information instead of decoration.
 *
 * The page is keyed by SIGNATURE, not by a cluster's position in one execution's digest: a
 * bookmark survives the next execution, and triage lands on the problem rather than on a row
 * (ADR-0028).
 *
 * Left is prose — their words, what they expected, what happened. Right is the instrument — the
 * calls that produced it, the replay verdict, and what has become of it across executions.
 * Neither is behind a mode.
 */

const TRIAGE_WORDS: { value: TriageView["state"]; label: string }[] = [
  { value: "untriaged", label: "Not decided yet" },
  { value: "accepted", label: "Accepted — it is real and we will fix it" },
  { value: "fixed", label: "We have fixed it" },
  { value: "wont-fix", label: "We are not going to fix it" },
  { value: "duplicate", label: "Duplicate of something we already track" },
];

/**
 * The triage control, and the only place in the product where the word "fixed" is asserted —
 * because here a human is the one asserting it. The screens that compare executions report an
 * absence as an absence (ADR-0028 amendment).
 */
function Triage({ card }: { card: ClusterDetail }) {
  const { key } = useProject();
  const { key: sim } = useSimulation();
  const queries = useQueryClient();
  const [state, setState] = useState<TriageView["state"]>(card.triage?.state ?? "untriaged");
  const [note, setNote] = useState(card.triage?.note ?? "");
  const [open, setOpen] = useState(false);

  const save = useMutation({
    mutationFn: () => api.setTriage(key, { signature: card.signature, state, note }),
    onSuccess: async () => {
      setOpen(false);
      await Promise.all([
        queries.invalidateQueries({ queryKey: keys.cluster(key, sim, card.signature) }),
        queries.invalidateQueries({ queryKey: keys.results(key, sim) }),
        queries.invalidateQueries({ queryKey: keys.triage(key) }),
        queries.invalidateQueries({ queryKey: keys.project(key) }),
      ]);
    },
  });

  const current = TRIAGE_WORDS.find((word) => word.value === (card.triage?.state ?? "untriaged"));

  return (
    <div className="shrink-0 min-w-[16rem]">
      <button type="button" onClick={() => setOpen(!open)} className="t-body text-accent hover:underline">
        {current?.label ?? "Not decided yet"} {open ? "▾" : "▸"}
      </button>
      {card.triage !== null && card.triage.drifted ? (
        <p className="t-meta text-high mt-1 max-w-[34ch]">
          This was decided under a different wording — “{card.triage.titleAtTriage}”. The problem may have been reworded, or this may be a different one wearing the same key.
        </p>
      ) : null}
      {open ? (
        <Card className="p-3.5 mt-2">
          {/* The options are the enum, so a chosen value is looked up rather than asserted. */}
          <Select value={state} onChange={(value) => setState(TRIAGE_WORDS.find((word) => word.value === value)?.value ?? "untriaged")} options={TRIAGE_WORDS} />
          <div className="mt-2">
            <TextArea value={note} onChange={setNote} rows={3} placeholder="Why, or where it is tracked. Optional." />
          </div>
          <div className="flex items-center gap-3 mt-2">
            <Button tone="go" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
            {card.triage === null ? null : <span className="t-meta text-ink-muted">last changed {ago(card.triage.updatedAt)}</span>}
          </div>
          {save.isError ? <p className="t-meta text-critical mt-2">{save.error.message}</p> : null}
          <p className="t-meta text-ink-muted mt-2 max-w-[38ch]">
            This decision is kept against the problem, not against this execution, so it is still here the next time the simulation runs.
          </p>
        </Card>
      ) : null}
    </div>
  );
}

function Steps({ card }: { card: ClusterDetail }) {
  const { href } = useSimulation();
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div className="t-label text-ink-muted">Steps that reproduce it</div>
        <Link to={href(`visits/${encodeURIComponent(card.representative.wakeId)}`)} className="t-meta text-accent hover:underline">
          open the full visit
        </Link>
      </div>
      {card.reproduction.length === 0 ? (
        <p className="t-body text-ink-muted italic">Nobody cited a call when they filed this, so there is nothing to replay.</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {card.reproduction.map((step) => (
            <li key={step.ref}>
              <div className="flex items-baseline gap-2 mb-1">
                <CallRef>{step.ref}</CallRef>
                <Mono className="text-[12px] text-ink">
                  {step.tool}({JSON.stringify(step.arguments)})
                </Mono>
                <span className="t-meta text-ink-muted ml-auto shrink-0">{ms(step.latencyMs)}</span>
              </div>
              <Payload>
                <span className={step.result.isError ? "text-critical" : "text-ink-soft"}>→ {step.result.text.slice(0, 600)}</span>
              </Payload>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function Replay({ card }: { card: ClusterDetail }) {
  if (card.replay === null)
    return (
      <Card className="p-4">
        <div className="t-label text-ink-muted mb-1.5">We have not replayed this yet</div>
        <p className="t-body text-ink-soft">
          Build the digest with verification on, and the judge runs these calls again itself and rules on what comes back.
        </p>
      </Card>
    );
  return (
    <Card className="p-4">
      <div className="flex items-baseline gap-3 mb-1.5">
        <span className="t-label text-ink-muted">We ran those calls again ourselves</span>
        <Verdict value={card.replay.verdict} />
      </div>
      <p className="t-body text-ink-soft">{card.replay.reason}</p>
      <div className="t-meta text-ink-muted mt-2.5 font-mono">
        {card.replay.judge} judge · {when(card.replay.verifiedAt)} · {usd4(card.replay.costUsd)}
      </div>
    </Card>
  );
}

/** Which executions reported it, as a strip. The dots are the evidence for the state word above. */
function AcrossExecutions({ card, mode }: { card: ClusterDetail; mode: "ephemeral" | "longitudinal" }) {
  if (mode === "longitudinal")
    return (
      <Card className="p-4">
        <div className="t-label text-ink-muted mb-1.5">Over this execution</div>
        <p className="t-body text-ink-soft">
          First reported {ago(card.firstSeenAt)}, last reported {ago(card.lastSeenAt)}.
        </p>
      </Card>
    );
  const seen = new Set(card.seenIn);
  return (
    <Card className="p-4">
      <div className="t-label text-ink-muted mb-2">Across executions</div>
      <div className="flex flex-wrap gap-2 mb-2">
        {card.history.map((entry) => (
          <span key={entry.runId} className={`t-meta tabular-nums px-1.5 rounded ${entry.reports > 0 ? "bg-accent-wash text-accent" : "text-ink-muted"}`} title={`${entry.reports} reports`}>
            {entry.seq}
            {entry.reports > 0 ? " ●" : " ○"}
          </span>
        ))}
      </div>
      <p className="t-body text-ink-soft">
        {seen.size === card.history.length
          ? "Reported in every execution this simulation has had."
          : `Reported in ${seen.size} of ${card.history.length} executions. An execution that did not report it is an absence, not a repair — the same complaint worded differently is a different key.`}
      </p>
    </Card>
  );
}

export function FindingInFull() {
  const { key } = useProject();
  const { key: sim, simulation, href } = useSimulation();
  const { signature = "" } = useParams();
  const cluster = useQuery(q.cluster(key, sim, signature));
  const results = useQuery(q.results(key, sim));

  if (cluster.isPending) return <Loading what="this problem" />;
  if (cluster.isError) return <Failed error={cluster.error} />;

  const card = cluster.data;
  const seqs = (results.data?.history ?? []).map((entry) => entry.seq).sort((a, b) => a - b);
  const state = stateOfCluster(card, simulation.mode, seqs);
  const representative = card.representative;

  return (
    <>
      <Breadcrumb items={[{ label: "Results", to: href() }, { label: card.title }]} />

      <div className="flex items-start justify-between gap-6 mt-2 mb-2">
        <h1 className="t-title max-w-[46ch]">{card.title}</h1>
        <Triage card={card} />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-2">
        <Severity value={card.severity} kind={card.kind} />
        {card.tool ? <ToolName name={card.tool} missing={card.kind === "coverage-gap"} /> : null}
        <Verdict value={card.verdict} />
        <span className={`t-label ${state.ink}`}>{state.badge}</span>
        <span className="t-meta text-ink-muted">{state.detail}</span>
      </div>

      <p className="t-body text-ink-soft mb-8 pb-6 border-b border-rule tabular-nums">
        {card.peopleHit.length} of {card.peopleTotal} {card.peopleTotal === 1 ? "person" : "people"} hit this · {card.reports} {card.reports === 1 ? "report" : "reports"} ·{" "}
        <Mono className="text-[11px] text-ink-muted">{card.signature}</Mono>
      </p>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-8 items-start">
        <div>
          <h2 className="t-section mb-3">In their own words</h2>
          <div className="flex flex-col gap-4 mb-8">
            {card.quotes.map((quote) => (
              <div key={`${quote.personId}-${quote.wakeId}`} className="flex gap-3">
                <Avatar name={quote.name} />
                <div className="min-w-0">
                  <p className="t-body text-ink italic">“{quote.text}”</p>
                  <div className="t-meta text-ink-muted mt-1">
                    {quote.name} · {quote.cohortName || quote.cohortSlug} ·{" "}
                    <Link to={href(`visits/${encodeURIComponent(quote.wakeId)}`)} className="text-accent hover:underline">
                      visit {quote.visitNumber}
                    </Link>
                  </div>
                </div>
              </div>
            ))}
            {card.quotes.length === 0 ? <p className="t-body text-ink-muted italic">Nobody wrote this one up in their own words.</p> : null}
          </div>

          <h2 className="t-section mb-2">They expected</h2>
          <p className="t-body text-ink-soft mb-5">{representative.expected}</p>
          <h2 className="t-section mb-2">What happened</h2>
          <p className="t-body text-ink-soft">{representative.observed}</p>
        </div>

        <div className="flex flex-col gap-4">
          <Steps card={card} />
          <Replay card={card} />
          <AcrossExecutions card={card} mode={simulation.mode} />
        </div>
      </div>

      <section className="mt-10 pt-8 border-t border-rule">
        <h2 className="t-section mb-3">Who hit it</h2>
        <Incidence cohorts={card.cohorts} />
        {card.peopleMissed.length > 0 ? (
          <div className="mt-5 max-w-[34rem] flex flex-col gap-2">
            {card.peopleMissed.map((missed) => (
              <div key={missed.cohortSlug} className="flex items-baseline gap-3">
                <span className="t-meta text-ink-muted w-36 truncate">{missed.name}</span>
                <span className="flex-1">
                  <Bar value={0} of={missed.count} tone="quiet" />
                </span>
                <span className="t-meta text-ink-muted tabular-nums shrink-0">
                  {missed.count} did not hit it
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <Link to={href(`f/${encodeURIComponent(card.signature)}/people`)} className="inline-block mt-5 t-body text-accent hover:underline">
          All {card.peopleHit.length} {card.peopleHit.length === 1 ? "person" : "people"} who hit this →
        </Link>
      </section>
    </>
  );
}

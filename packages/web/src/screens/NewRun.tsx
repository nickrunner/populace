import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { Button, Card, Chip, Empty, Failed, Field, Input, Loading, Problem, Section, Stat } from "../components/ui.jsx";
import { usd, usd4, when } from "../format.js";

/**
 * Before you press go. The estimate is arithmetic over what a visit actually cost on this machine
 * and it spends nothing to produce; the button under it is the only thing on this screen that
 * costs money.
 */
export function NewRun() {
  const navigate = useNavigate();
  const setup = useQuery({ queryKey: ["setup"], queryFn: () => api.setup() });
  // The estimate is arithmetic and costs nothing, so it is shown as soon as there is a target and
  // somebody to send — not only once everything is ready. Seeing what a run would cost is most of
  // the reason to open this screen, and hiding it behind an unrelated blocker (a missing API key,
  // an engaged stop) makes the screen useless exactly when it is being read.
  const canEstimate = setup.data !== undefined && setup.data.targetId !== null && setup.data.agentCount > 0;
  const estimate = useQuery({ queryKey: ["estimate"], queryFn: () => api.estimate(), enabled: canEstimate, retry: false });
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => api.runs() });
  const [label, setLabel] = useState("");
  const [carryOn, setCarryOn] = useState("");

  const start = useMutation({
    mutationFn: () => (carryOn === "" ? api.startRun({ ...(label ? { label } : {}) }) : api.continueRun(carryOn, { ...(label ? { label } : {}) })),
    onSuccess: (started) => navigate(`/runs/${encodeURIComponent(started.runId)}/live`),
  });

  if (setup.isPending) return <Loading what="what is set up" />;
  if (setup.isError) return <Failed error={setup.error} />;

  const ready = setup.data.ready;
  const finished = (runs.data?.items ?? []).filter((r) => r.status !== "running" && r.status !== "pending");

  return (
    <div>
      <header className="mb-7">
        <h1 className="t-title">Start a run</h1>
        <p className="t-body text-ink-soft mt-2 max-w-[68ch]">
          {setup.data.agentCount} {setup.data.agentCount === 1 ? "person goes" : "people go"} to the target on the cadence you set, and file what they find as they go. Nothing is spent until you press the button.
        </p>
      </header>

      {!ready ? (
        <Card className="p-4 mb-6 border-medium/40">
          <p className="t-body text-ink mb-2">Not quite ready.</p>
          <ul className="list-disc pl-5">
            {setup.data.blockers.map((blocker, i) => (
              <li key={i} className="t-body text-ink-soft">
                {blocker}
              </li>
            ))}
          </ul>
          {setup.data.killSwitch.engaged ? (
            <div className="mt-3">
              <Button onClick={() => void api.setKillSwitch(false).then(() => setup.refetch())}>Release the stop</Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Section title="Before you press go" sub={estimate.data?.basis === "history" ? `worked out from what a visit actually cost on your last ${estimate.data.sampleSize} visits` : "worked out from a default, because nothing has run here yet"}>
        <Card className="p-5">
          {estimate.isPending && canEstimate ? (
            <Loading what="what this will cost" />
          ) : estimate.isError ? (
            <Problem>{estimate.error.message}</Problem>
          ) : estimate.data ? (
            <>
              <div className="flex items-baseline gap-6 mb-5">
                <Stat label="Expected" value={usd(estimate.data.expectedUsd)} sub={`somewhere between ${usd(estimate.data.lowUsd)} and ${usd(estimate.data.highUsd)}`} />
                <div className="t-body text-ink-soft max-w-[46ch]">
                  {estimate.data.agents} {estimate.data.agents === 1 ? "person" : "people"} × {estimate.data.bounded ? `${Math.round(estimate.data.visits / Math.max(1, estimate.data.agents))} visits each` : `${estimate.data.assumedWakesPerAgent} visits each, assumed`} ={" "}
                  {estimate.data.visits} visits, at about {usd4(estimate.data.perWakeUsd)} a visit on {estimate.data.model}.
                </div>
              </div>

              {!estimate.data.bounded ? (
                <p className="t-body text-medium mb-4">
                  Nothing caps how many visits these people make, so this run does not stop on its own — the figure above is the first {estimate.data.assumedWakesPerAgent} visits each, not a total. Set “stop each person
                  after” on Limits and spending, or stop it yourself while you watch.
                </p>
              ) : null}

              <div className="border-t border-rule pt-4">
                <div className="t-label text-ink-muted mb-2">What actually stops it</div>
                <ul className="grid grid-cols-2 gap-x-6">
                  <li className="t-body text-ink-soft">A visit that reaches {usd(estimate.data.stops.perWakeUsd)} or {estimate.data.stops.perWakeTurns} turns stops where it is.</li>
                  <li className="t-body text-ink-soft">{usd(estimate.data.stops.dailyUsd)} a day across every run on this machine.</li>
                  <li className="t-body text-ink-soft">{estimate.data.stops.maxWakesPerAgent === null ? "No cap on visits per person." : `Each person retires after ${estimate.data.stops.maxWakesPerAgent} visits.`}</li>
                  <li className="t-body text-ink-soft">Stopping everything, from the run screen or the CLI.</li>
                </ul>
                <p className="t-meta text-ink-muted mt-3">
                  Every account this run signs up carries the run's tag, and sweep removes them afterwards.
                </p>
              </div>
            </>
          ) : (
            <Empty>Connect a target and add some people, and the cost of a run will be worked out here.</Empty>
          )}
        </Card>
      </Section>

      <Section title="Carry on from an earlier run" sub="the people who said they would come back, do">
        <Card className="p-4">
          {finished.length === 0 ? (
            <Empty>Nothing has finished here yet.</Empty>
          ) : (
            <>
              <p className="t-body text-ink-soft mb-3 max-w-[68ch]">
                A continuation brings the same people back with everything they remember and the accounts they already hold. Someone who walked away returns only if they said they would — which is how you find out whether a fix won
                them back.
              </p>
              <ul className="divide-y divide-rule border-t border-rule">
                {finished.slice(0, 6).map((run) => (
                  <li key={run.id} className="py-2 flex items-center gap-3">
                    <input type="radio" name="carry" checked={carryOn === run.id} onChange={() => setCarryOn(carryOn === run.id ? "" : run.id)} />
                    <span className="t-body text-ink flex-1">{run.label}</span>
                    <span className="t-meta text-ink-muted">
                      {run.totals.findings} findings · {when(run.startedAt)}
                    </span>
                  </li>
                ))}
              </ul>
              {carryOn ? (
                <div className="mt-3">
                  <Button onClick={() => setCarryOn("")}>Start fresh instead</Button>
                </div>
              ) : null}
            </>
          )}
        </Card>
      </Section>

      <Card className="p-4 flex items-center gap-4">
        <div className="flex-1">
          <Field label="Call this run">
            <Input value={label} onChange={setLabel} placeholder="after the search fix" />
          </Field>
        </div>
        <div className="shrink-0 pt-2 flex items-center gap-3">
          {carryOn ? <Chip tone="live">carrying on</Chip> : null}
          <Button tone="go" onClick={() => start.mutate()} disabled={!ready || start.isPending}>
            {start.isPending ? "Starting…" : carryOn ? "Bring them back" : "Send them in"}
          </Button>
        </div>
      </Card>
      {start.isError ? <Problem>{start.error.message}</Problem> : null}
    </div>
  );
}

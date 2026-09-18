import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { clock, usd4, wakeOutcome } from "../format.js";
import { Avatar, Card, Failed, Loading, Mono, PageHeader } from "../components/ui.jsx";

const OUTCOME_INK: Record<string, string> = {
  done: "text-confirmed",
  "gave-up": "text-critical",
  "max-turns": "text-high",
  "budget-exceeded": "text-high",
  error: "text-critical",
};

export function Wakes({ runId }: { runId: string }) {
  const [params] = useSearchParams();
  const agentFilter = params.get("agent");
  const [status, setStatus] = useState<string | null>(null);

  const wakes = useQuery({ queryKey: ["wakes", runId], queryFn: () => api.wakes(runId) });
  const participants = useQuery({ queryKey: ["participants", runId], queryFn: () => api.participants(runId) });

  if (wakes.isError) return <Failed error={wakes.error} />;
  const wakeData = wakes.data;
  const participantData = participants.data;
  if (!wakeData || !participantData) return <Loading what="the visits" />;

  // Newest first: the question is nearly always "what just happened".
  const all = [...wakeData.items].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).filter((w) => agentFilter === null || w.agentId === agentFilter);
  const shown = status === null ? all : all.filter((w) => w.status === status);
  const outcomes = [...new Set(all.map((w) => w.status))];
  const calls = all.reduce((sum, w) => sum + w.toolCalls, 0);
  const cost = all.reduce((sum, w) => sum + w.costUsd, 0);
  const agentName = agentFilter === null ? null : (participantData.items.find((a) => a.id === agentFilter)?.personaName ?? agentFilter);

  return (
    <>
      <PageHeader
        title="Wakes"
        lede={
          agentName === null
            ? "Every visit anyone made in this run, newest first. Open one to watch it happen call by call."
            : `Every visit ${agentName} made, newest first.`
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <button
          type="button"
          onClick={() => setStatus(null)}
          className={`t-meta rounded-full border px-3 py-1 ${status === null ? "bg-accent-wash border-accent/30 text-accent" : "bg-card border-rule text-ink-soft"}`}
        >
          All <span className="tabular-nums text-ink-muted">{all.length}</span>
        </button>
        {outcomes.map((outcome) => (
          <button
            key={outcome}
            type="button"
            onClick={() => setStatus(status === outcome ? null : outcome)}
            className={`t-meta rounded-full border px-3 py-1 ${status === outcome ? "bg-accent-wash border-accent/30 text-accent" : "bg-card border-rule text-ink-soft"}`}
          >
            {wakeOutcome(outcome)} <span className="tabular-nums text-ink-muted">{all.filter((w) => w.status === outcome).length}</span>
          </button>
        ))}
        <span className="t-meta text-ink-muted ml-auto">
          {all.length} visits · {calls} calls · {usd4(cost)}
        </span>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="t-label text-ink-muted border-b border-rule">
              <th className="text-left font-semibold px-4 py-2.5 w-16">Time</th>
              <th className="text-left font-semibold px-4 py-2.5">Who</th>
              <th className="text-left font-semibold px-4 py-2.5">How it ended</th>
              <th className="text-right font-semibold px-4 py-2.5 w-16">Turns</th>
              <th className="text-right font-semibold px-4 py-2.5 w-16">Calls</th>
              <th className="text-right font-semibold px-4 py-2.5 w-16">Found</th>
              <th className="text-right font-semibold px-4 py-2.5 w-20">Cost</th>
              <th className="text-right font-semibold px-4 py-2.5 w-24">Coming back</th>
              <th className="px-4 py-2.5 w-16" />
            </tr>
          </thead>
          <tbody>
            {shown.map((wake) => (
              <tr key={wake.id} className="border-b border-rule last:border-0 hover:bg-well">
                <td className="px-4 py-3 t-meta text-ink-muted tabular-nums">{clock(wake.startedAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={wake.personaName} />
                    <div className="min-w-0">
                      <div className="t-body truncate">{wake.personaName}</div>
                      <Mono className="text-[11px] text-ink-muted">
                        {wake.personaId} · visit {wake.wakeNumber}
                      </Mono>
                    </div>
                  </div>
                </td>
                <td className={`px-4 py-3 t-body ${OUTCOME_INK[wake.status] ?? "text-ink-soft"}`}>{wakeOutcome(wake.status)}</td>
                <td className="px-4 py-3 text-right t-meta tabular-nums text-ink-soft">{wake.turns}</td>
                <td className="px-4 py-3 text-right t-meta tabular-nums text-ink-soft">{wake.toolCalls}</td>
                <td className="px-4 py-3 text-right t-meta tabular-nums text-ink-soft">{wake.findingCount}</td>
                <td className="px-4 py-3 text-right t-meta tabular-nums text-ink-soft">{usd4(wake.costUsd)}</td>
                <td className="px-4 py-3 text-right t-meta text-ink-muted">
                  {wake.wouldReturn === null ? "—" : wake.wouldReturn ? "yes" : "no"}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link to={`/runs/${encodeURIComponent(runId)}/wakes/${encodeURIComponent(wake.id)}`} className="t-meta text-accent hover:underline">
                    watch
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 ? <p className="t-body text-ink-muted italic p-4">No visits ended that way.</p> : null}
      </Card>
    </>
  );
}

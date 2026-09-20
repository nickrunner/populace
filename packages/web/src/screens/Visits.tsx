import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import type { Wake } from "../api.js";
import { q } from "../queries.js";
import { useSimulation } from "../context.jsx";
import { clock, usd4, wakeOutcome } from "../format.js";
import { Avatar, DataTable, Failed, FilterChips, Loading, Mono, PageHeader } from "../components/ui.jsx";

const OUTCOME_INK: Record<string, string> = {
  done: "text-confirmed",
  "gave-up": "text-critical",
  "max-turns": "text-high",
  "budget-exceeded": "text-high",
  "auth-failed": "text-critical",
  error: "text-critical",
};

/**
 * Every visit anybody made, newest first — the question is nearly always "what just happened".
 *
 * A row is labelled by the PERSON and their cohort, not by the persona: two cohorts may share a
 * persona, and "Power user, visit 3" three times over says nothing about who it was.
 */
export function Visits({ runId }: { runId: string }) {
  const [params] = useSearchParams();
  const only = params.get("participant");
  const [status, setStatus] = useState<string | null>(null);

  const { href } = useSimulation();
  const wakes = useQuery(q.wakes(runId));
  const participants = useQuery(q.participants(runId));

  // Both, or the screen reads "Reading the visits…" for ever on the one that failed: the roster is
  // a second request and a swept or missing execution answers it with a 404.
  if (wakes.isError || participants.isError) return <Failed error={wakes.error ?? participants.error} />;
  const wakeData = wakes.data;
  const participantData = participants.data;
  if (!wakeData || !participantData) return <Loading what="the visits" />;

  const who = new Map(participantData.items.map((person) => [person.id, person]));
  const all = [...wakeData.items].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).filter((wake) => only === null || wake.agentId === only);
  const shown = status === null ? all : all.filter((wake) => wake.status === status);
  const outcomes = [...new Set(all.map((wake) => wake.status))];
  const calls = all.reduce((sum, wake) => sum + wake.toolCalls, 0);
  const cost = all.reduce((sum, wake) => sum + wake.costUsd, 0);
  const name = only === null ? null : (who.get(only)?.name ?? only);

  return (
    <>
      <PageHeader
        title="Visits"
        lede={
          name === null
            ? "Every visit anyone made in this execution, newest first. Open one to watch it happen call by call."
            : `Every visit ${name} made, newest first.`
        }
        trail={only === null ? undefined : <Link to={href("visits")} className="text-accent hover:underline">everyone's visits</Link>}
      />

      <FilterChips
        options={outcomes.map((outcome) => ({ value: outcome, label: wakeOutcome(outcome), count: all.filter((wake) => wake.status === outcome).length }))}
        value={status}
        onChange={setStatus}
        all="All"
        allCount={all.length}
        trail={`${all.length} visits · ${calls} calls · ${usd4(cost)}`}
      />

      <DataTable<Wake>
        rows={shown}
        keyOf={(wake) => wake.id}
        empty="No visits ended that way."
        columns={[
          { header: "Time", width: "w-16", cell: (wake) => <span className="t-meta text-ink-muted tabular-nums">{clock(wake.startedAt)}</span> },
          {
            header: "Who",
            cell: (wake) => {
              const person = who.get(wake.agentId);
              return (
                <div className="flex items-center gap-2.5">
                  <Avatar name={person?.name ?? wake.personaName} />
                  <div className="min-w-0">
                    <div className="t-body truncate">{person?.name ?? wake.personaName}</div>
                    <div className="t-meta text-ink-muted truncate">
                      {person?.cohortName ?? person?.cohortSlug ?? wake.personaId} · visit {wake.wakeNumber}
                    </div>
                  </div>
                </div>
              );
            },
          },
          { header: "How it ended", cell: (wake) => <span className={`t-body ${OUTCOME_INK[wake.status] ?? "text-ink-soft"}`}>{wakeOutcome(wake.status)}</span> },
          { header: "Turns", align: "right", width: "w-16", cell: (wake) => <span className="t-meta text-ink-soft">{wake.turns}</span> },
          { header: "Calls", align: "right", width: "w-16", cell: (wake) => <span className="t-meta text-ink-soft">{wake.toolCalls}</span> },
          { header: "Found", align: "right", width: "w-16", cell: (wake) => <span className="t-meta text-ink-soft">{wake.findingCount}</span> },
          { header: "Cost", align: "right", width: "w-20", cell: (wake) => <span className="t-meta text-ink-soft">{usd4(wake.costUsd)}</span> },
          {
            header: "Coming back",
            align: "right",
            width: "w-24",
            cell: (wake) => <span className="t-meta text-ink-muted">{wake.wouldReturn === null ? "—" : wake.wouldReturn ? "yes" : "no"}</span>,
          },
          {
            header: "",
            align: "right",
            width: "w-16",
            cell: (wake) => (
              <Link to={href(`visits/${encodeURIComponent(wake.id)}`)} className="t-meta text-accent hover:underline">
                watch
              </Link>
            ),
          },
        ]}
      />

      {only === null ? null : (
        <p className="t-meta text-ink-muted mt-3">
          <Mono className="text-[11px]">{only}</Mono> — one person's visits.
        </p>
      )}
    </>
  );
}

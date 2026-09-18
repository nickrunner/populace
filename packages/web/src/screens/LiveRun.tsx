import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { JsonValue } from "@populace/core/isomorphic";
import { api, openEventStream, type AgentLive, type LiveEvent } from "../api.js";
import { Avatar, Button, Card, Chip, Empty, Failed, Loading, Mono, Problem, Section } from "../components/ui.jsx";
import { clock, usd4 } from "../format.js";

/** How long it has been going, in the words a person would use rather than a duration string. */
function elapsed(startedAt: string | null, endedAt: string | null): string {
  if (startedAt === null) return "—";
  const seconds = Math.max(0, Math.round(((endedAt ? new Date(endedAt).getTime() : Date.now()) - new Date(startedAt).getTime()) / 1000));
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 90 ? `${minutes} min` : `${(minutes / 60).toFixed(1)} hours`;
}

function countdown(nextWakeAt: string | null): string {
  if (nextWakeAt === null) return "not coming back";
  const seconds = Math.round((new Date(nextWakeAt).getTime() - Date.now()) / 1000);
  if (seconds <= 0) return "due now";
  return seconds < 90 ? `back in ${seconds}s` : `back in ${Math.round(seconds / 60)} min`;
}

/**
 * Watching a run happen. The screen renders from `GET /runs/:id/live`, which is derived from rows,
 * so a reload mid-run shows the right thing with no live connection at all. The stream on top of
 * that only moves it forward: every row in the feed is an event-log row, and a dropped connection
 * resumes from its cursor rather than losing the gap (ADR-0026).
 */
export function LiveRun({ runId }: { runId: string }) {
  const queries = useQueryClient();
  const live = useQuery({ queryKey: ["live", runId], queryFn: () => api.live(runId) });
  const [feed, setFeed] = useState<LiveEvent[]>([]);
  const cursor = live.data?.cursor;

  useEffect(() => {
    if (cursor === undefined) return;
    // Seeded from the snapshot's cursor, so the feed starts where the page's own data stops.
    const close = openEventStream(runId, cursor, (event) => {
      setFeed((current) => [event, ...current].slice(0, 200));
      // The cards and totals come from the query, not from the feed, so one refetch keeps the
      // whole screen honest rather than replaying state into it by hand.
      if (event.type !== "trace.appended") void queries.invalidateQueries({ queryKey: ["live", runId] });
    });
    return close;
  }, [runId, cursor, queries]);

  // A card's countdown has to tick even when nothing arrives.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const stop = useMutation({
    mutationFn: (mode: "drain" | "now") => api.stopRun(runId, mode),
    onSuccess: async () => {
      await queries.invalidateQueries();
    },
  });
  const round = useMutation({
    mutationFn: () => api.oneMoreRound(runId),
    onSuccess: async () => {
      await queries.invalidateQueries({ queryKey: ["live", runId] });
    },
  });

  // The feed is what a person would want told to them: who arrived, what they found, what stopped.
  // Trace rows are the instrument and live on the visit screen. A job doing what it was asked to do
  // is not news either — only a job that failed is, because nothing else on this screen says so.
  const rows = useMemo(
    () => feed.filter((e) => e.type !== "trace.appended" && (e.type !== "job.updated" || payloadText(e, "status") === "failed")),
    [feed],
  );

  if (live.isPending) return <Loading what="the run" />;
  if (live.isError) return <Failed error={live.error} />;

  const run = live.data;
  const going = run.status === "running" || run.status === "pending";
  const here = run.agents.filter((a) => a.status === "here");

  return (
    <div>
      <header className="mb-7 flex items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="t-title">{going ? "Running" : run.status === "paused" ? "Paused" : run.status === "killed" ? "Stopped" : run.status === "failed" ? "Failed" : "Finished"}</h1>
            {going ? <Chip tone="live">live</Chip> : null}
          </div>
          <p className="t-body text-ink-soft">
            {elapsed(run.startedAt, run.endedAt)} · {run.visitsDone} of {run.visitsPlanned} visits done · {usd4(run.costUsd)} spent · {run.findings} filed
          </p>
        </div>
        {going ? (
          <div className="flex items-center gap-2 shrink-0">
            <Button onClick={() => round.mutate()} disabled={round.isPending}>
              Send one more round
            </Button>
            <Button onClick={() => stop.mutate("drain")} disabled={stop.isPending}>
              Let them finish, then stop
            </Button>
            <Button tone="stop" onClick={() => stop.mutate("now")} disabled={stop.isPending}>
              Stop everything now
            </Button>
          </div>
        ) : (
          <Link to={`/runs/${encodeURIComponent(runId)}`} className="t-body text-accent shrink-0">
            Read what they found →
          </Link>
        )}
      </header>

      {stop.isError ? <Problem>{stop.error.message}</Problem> : null}
      {round.isError ? <Problem>{round.error.message}</Problem> : null}
      {run.status === "killed" ? (
        <Card className="p-4 mb-6 border-critical/30">
          <p className="t-body text-ink">Everything is stopped, and it stays stopped until you release it.</p>
          <p className="t-body text-ink-soft mt-1">Nothing else can start a run on this machine in the meantime.</p>
          <div className="mt-3">
            <Button onClick={() => void api.setKillSwitch(false).then(() => queries.invalidateQueries())}>Release the stop</Button>
          </div>
        </Card>
      ) : null}

      <Section title="Where everyone is" sub={going ? `${here.length} mid-visit` : "as they finished"}>
        {run.agents.length === 0 ? (
          <Card className="p-4">
            <Empty>Nobody has arrived yet.</Empty>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {run.agents.map((agent) => (
              <AgentCard key={agent.agentId} agent={agent} runId={runId} going={going} />
            ))}
          </div>
        )}
      </Section>

      <Section title="As it happens" sub="findings, stops and visits, newest first">
        <Card className="p-0 max-h-[26rem] overflow-y-auto">
          {rows.length === 0 ? (
            <p className="t-body text-ink-muted italic p-4">{going ? "Waiting for the first thing to happen…" : "Nothing has arrived on the feed since this page opened."}</p>
          ) : (
            <ul className="divide-y divide-rule">
              {rows.map((event) => (
                <li key={event.seq} className="px-4 py-2 flex items-baseline gap-3">
                  <span className="t-meta text-ink-muted tabular-nums shrink-0">{clock(event.at)}</span>
                  <FeedLine event={event} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>
    </div>
  );
}

function AgentCard({ agent, runId, going }: { agent: AgentLive; runId: string; going: boolean }) {
  const body = (
    <Card className={`p-3.5 h-full ${agent.status === "here" ? "border-accent/40" : ""}`}>
      <div className="flex items-center gap-2.5 mb-2">
        <Avatar name={agent.personaName} />
        <div className="flex-1 min-w-0">
          <div className="t-body text-ink truncate">{agent.personaName}</div>
          <div className="t-meta text-ink-muted">
            visit {agent.wakeNumber}
            {agent.maxWakes === null ? "" : ` of ${agent.maxWakes}`}
            {agent.status === "here" ? ` · turn ${agent.turn}` : ""}
          </div>
        </div>
        <Chip tone={agent.status === "here" ? "live" : "neutral"}>{agent.status === "here" ? "here now" : agent.status === "away" ? "away" : "gone"}</Chip>
      </div>
      <div className="t-meta text-ink-muted flex items-baseline justify-between gap-2">
        <span>
          {agent.status === "here" ? (
            agent.lastCall === null ? (
              "thinking"
            ) : (
              <Mono className="text-[11.5px] text-evidence">{agent.lastCall}</Mono>
            )
          ) : going ? (
            countdown(agent.nextWakeAt)
          ) : (
            "not coming back"
          )}
        </span>
        <span className="tabular-nums">
          {usd4(agent.costUsd)}
          {agent.findingCount > 0 ? ` · ${agent.findingCount} filed` : ""}
        </span>
      </div>
    </Card>
  );
  return agent.wakeId === null ? body : <Link to={`/runs/${encodeURIComponent(runId)}/wakes/${encodeURIComponent(agent.wakeId)}`}>{body}</Link>;
}

/** An event payload is a `JsonValue` on the wire, so every field is read defensively rather than cast. */
function payloadOf(event: LiveEvent): Record<string, JsonValue> {
  return typeof event.payload === "object" && event.payload !== null && !Array.isArray(event.payload) ? event.payload : {};
}

function payloadText(event: LiveEvent, key: string): string {
  const value = payloadOf(event)[key];
  return typeof value === "string" ? value : "";
}

/**
 * One line per event, in the feed's own words. An event type this build does not know yet should
 * show as a plain line, not break the screen.
 */
function FeedLine({ event }: { event: LiveEvent }) {
  const payload = payloadOf(event);
  const text = (key: string): string => payloadText(event, key);
  const num = (key: string): number => {
    const value = payload[key];
    return typeof value === "number" ? value : 0;
  };

  switch (event.type) {
    case "run.started":
      return (
        <span className="t-body text-ink">
          The run started with {num("agents")} {num("agents") === 1 ? "person" : "people"}.
        </span>
      );
    case "run.ended":
      return <span className="t-body text-ink">The run ended: {text("status")}.</span>;
    case "run.status":
      return <span className="t-body text-ink-soft">Everyone was asked back for another round.</span>;
    case "wake.started":
      return (
        <span className="t-body text-ink-soft">
          <Mono className="text-[11.5px] text-evidence">{text("personaId")}</Mono> arrived for visit {num("wakeNumber")}.
        </span>
      );
    case "wake.ended":
      return (
        <span className="t-body text-ink-soft">
          <Mono className="text-[11.5px] text-evidence">{text("personaId")}</Mono> {text("status") === "gave-up" ? "gave up" : text("status") === "done" ? "finished" : text("status")}
          {text("summary") ? `: ${text("summary")}` : ""} <span className="text-ink-muted tabular-nums">{usd4(num("costUsd"))}</span>
        </span>
      );
    case "finding.filed":
      return (
        <span className="t-body text-ink">
          <span className="t-label text-high">{text("severity")}</span> {text("title")}
        </span>
      );
    case "guardrail.tripped":
      return (
        <span className="t-body text-critical">
          Guardrail: {text("rule")} — {text("detail")}
        </span>
      );
    case "identity.created":
      return (
        <span className="t-body text-ink-soft">
          An account was created{text("email") ? ` for ${text("email")}` : ""}.
        </span>
      );
    case "job.updated":
      return (
        <span className="t-body text-critical">
          {text("kind") === "digest" ? "The digest" : text("kind") === "sweep" ? "The clean-up" : "Starting the run"} did not finish
          {text("error") ? `: ${text("error")}` : ""}
        </span>
      );
    default:
      return <span className="t-body text-ink-muted">{event.type}</span>;
  }
}

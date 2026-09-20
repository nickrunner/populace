import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, openEventStream, type ParticipantLive, type LiveEvent } from "../api.js";
import { keys, q } from "../queries.js";
import { useSimulation } from "../context.jsx";
import { Avatar, Button, Card, Chip, Empty, Failed, Loading, Mono, Problem, Section } from "../components/ui.jsx";
import { clock, payloadNumber, payloadText, usd4 } from "../format.js";

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

/** How many cards a cohort shows before it folds. Past a dozen, a grid stops being readable. */
const FOLD_AT = 12;

/**
 * Watching an execution happen. The screen renders from `GET /runs/:id/live`, which is derived
 * from rows, so a reload mid-execution shows the right thing with no live connection at all. The
 * stream on top of that only moves it forward: every row in the feed is an event-log row, and a
 * dropped connection resumes from its cursor rather than losing the gap (ADR-0026).
 *
 * Two things here are mode-aware (SPEC §4.1). The controls: a longitudinal execution is PAUSED,
 * because it is a life and stopping it would end it; an ephemeral one is STOPPED, because it was
 * always going to end. And the resting state: a run whose process died is `paused` with reason
 * `process-ended`, which is not a failure and must not read like one.
 */
export function LiveRun({ runId }: { runId: string }) {
  const queries = useQueryClient();
  const { href } = useSimulation();
  const live = useQuery(q.live(runId));
  const cohorts = useQuery(q.runCohorts(runId));
  const [feed, setFeed] = useState<LiveEvent[]>([]);
  // The cursor SEEDS the connection and must never re-open it. It is `latestEventSeq()`, a counter
  // over every event in the store, so it moves on every refetch of this screen — and with it in
  // the effect's dependencies the stream was torn down and rebuilt each time, replaying events
  // onto a feed keyed by `seq` and duplicating React keys. `EventSource` resumes from its own
  // `Last-Event-ID` after that, so one seed is all it ever needs.
  const seed = useRef<number | null>(null);
  if (seed.current === null && live.data !== undefined) seed.current = live.data.cursor;
  const opened = seed.current;

  useEffect(() => {
    if (opened === null) return;
    const close = openEventStream(runId, opened, (event) => {
      setFeed((current) => [event, ...current].slice(0, 200));
      // The cards and totals come from the query, not from the feed, so one refetch keeps the
      // whole screen honest rather than replaying state into it by hand.
      if (event.type !== "trace.appended") void queries.invalidateQueries({ queryKey: keys.live(runId) });
    });
    return close;
  }, [runId, opened, queries]);

  // A card's countdown has to tick even when nothing arrives.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const refresh = async (): Promise<void> => {
    await queries.invalidateQueries();
  };
  const stop = useMutation({ mutationFn: (mode: "drain" | "now") => api.stopRun(runId, mode), onSuccess: refresh });
  const pause = useMutation({ mutationFn: () => api.pauseRun(runId), onSuccess: refresh });
  const resume = useMutation({ mutationFn: () => api.resumeRun(runId), onSuccess: refresh });
  const round = useMutation({ mutationFn: () => api.oneMoreRound(runId), onSuccess: refresh });

  // The feed is what a person would want told to them: who arrived, what they found, what stopped.
  // Trace rows are the instrument and live on the visit screen. A job doing what it was asked to do
  // is not news either — only a job that failed is, because nothing else on this screen says so.
  const rows = useMemo(
    () => feed.filter((e) => e.type !== "trace.appended" && (e.type !== "job.updated" || payloadText(e, "status") === "failed")),
    [feed],
  );

  if (live.isPending) return <Loading what="the execution" />;
  if (live.isError) return <Failed error={live.error} />;

  const run = live.data;
  const going = run.status === "running" || run.status === "pending";
  const here = run.participants.filter((a) => a.status === "here");
  const busy = stop.isPending || pause.isPending || resume.isPending || round.isPending;
  const abandoned = run.status === "paused" && run.pauseReason === "process-ended";
  const cohortNames = new Map((cohorts.data?.items ?? []).map((cohort) => [cohort.cohortSlug, cohort.name]));
  // The feed says who, not what kind of who. A cohort of twelve first-timers is twelve people, and
  // twelve rows all reading `first-timer` name a template where the product has a cast. The roster
  // is already on this screen and the events carry the participant id, so the join costs nothing.
  const names = new Map(run.participants.map((person) => [person.participantId, person.name]));

  const heading = going
    ? run.mode === "longitudinal"
      ? "Going"
      : "Running"
    : run.status === "paused"
      ? abandoned
        ? "Stopped when populace was closed"
        : "Paused"
      : run.status === "killed"
        ? "Stopped"
        : run.status === "failed"
          ? "Failed"
          : "Finished";

  return (
    <div>
      <header className="mb-7 flex items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="t-title">{heading}</h1>
            {going ? <Chip tone="live">live</Chip> : null}
          </div>
          <p className="t-body text-ink-soft">
            {elapsed(run.startedAt, run.endedAt)} · {run.visitsDone} of {run.mode === "longitudinal" ? "no fixed number of" : run.visitsPlanned} visits done ·{" "}
            {usd4(run.costUsd)} spent · {run.findings} filed
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {going ? (
            <>
              {run.mode === "ephemeral" ? (
                <Button onClick={() => round.mutate()} disabled={busy}>
                  Send one more round
                </Button>
              ) : null}
              {run.mode === "longitudinal" ? (
                <Button onClick={() => pause.mutate()} disabled={busy}>
                  Pause
                </Button>
              ) : (
                <Button onClick={() => stop.mutate("drain")} disabled={busy}>
                  Let them finish, then stop
                </Button>
              )}
              <Button tone="stop" onClick={() => stop.mutate("now")} disabled={busy}>
                Stop everything now
              </Button>
            </>
          ) : run.status === "paused" ? (
            <Button tone="go" onClick={() => resume.mutate()} disabled={busy}>
              Pick it back up
            </Button>
          ) : (
            <Link to={href()} className="t-body text-accent">
              Read what they found →
            </Link>
          )}
        </div>
      </header>

      {stop.isError ? <Problem>{stop.error.message}</Problem> : null}
      {pause.isError ? <Problem>{pause.error.message}</Problem> : null}
      {resume.isError ? <Problem>{resume.error.message}</Problem> : null}
      {round.isError ? <Problem>{round.error.message}</Problem> : null}

      {abandoned ? (
        <Card className="p-4 mb-6">
          <p className="t-body text-ink">This stopped when populace was last closed. Nothing failed and nothing was lost.</p>
          <p className="t-body text-ink-soft mt-1">
            Everyone still has their memory, their account and their visit number, because all three are kept against this execution. Pick it back up and they
            carry on from where they were.
          </p>
        </Card>
      ) : null}

      {run.status === "killed" ? (
        <Card className="p-4 mb-6 border-critical/30">
          <p className="t-body text-ink">Everything is stopped, and it stays stopped until you release it.</p>
          <p className="t-body text-ink-soft mt-1">Nothing else can start an execution on this machine in the meantime.</p>
          <div className="mt-3">
            <Button onClick={() => void api.setKillSwitch(false).then(() => queries.invalidateQueries())}>Release the stop</Button>
          </div>
        </Card>
      ) : null}

      <Section title="Where everyone is" sub={going ? `${here.length} mid-visit` : "as they finished"}>
        {run.participants.length === 0 ? (
          <Card className="p-4">
            <Empty>Nobody has arrived yet.</Empty>
          </Card>
        ) : (
          <CohortGrid participants={run.participants} names={cohortNames} base={href()} going={going} />
        )}
      </Section>

      <Section title="As it happens" sub="findings, stops and visits, newest first">
        <Card className="p-0 max-h-[26rem] overflow-y-auto">
          {rows.length === 0 ? (
            <p className="t-body text-ink-muted italic p-4">
              {going ? "Waiting for the first thing to happen…" : "Nothing has arrived on the feed since this page opened."}
            </p>
          ) : (
            <ul className="divide-y divide-rule">
              {rows.map((event) => (
                <li key={event.seq} className="px-4 py-2 flex items-baseline gap-3">
                  <span className="t-meta text-ink-muted tabular-nums shrink-0">{clock(event.at)}</span>
                  <FeedLine event={event} names={names} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>
    </div>
  );
}

/**
 * The grid, under cohort headers. A population is not a flat list of strangers — "the sceptics are
 * all still away and the first-timers are all here" is the thing a person watching this wants to
 * see, and it is invisible in one undifferentiated wall of cards.
 */
function CohortGrid({ participants, names, base, going }: { participants: ParticipantLive[]; names: Map<string, string>; base: string; going: boolean }) {
  const slugs = [...new Set(participants.map((person) => person.cohortSlug))];
  return (
    <div className="flex flex-col gap-6">
      {slugs.map((slug) => (
        <CohortBlock key={slug} slug={slug} name={names.get(slug) ?? slug} members={participants.filter((person) => person.cohortSlug === slug)} base={base} going={going} />
      ))}
    </div>
  );
}

function CohortBlock({ slug, name, members, base, going }: { slug: string; name: string; members: ParticipantLive[]; base: string; going: boolean }) {
  const [all, setAll] = useState(false);
  const here = members.filter((person) => person.status === "here").length;
  const shown = all ? members : members.slice(0, FOLD_AT);
  return (
    <div>
      <div className="flex items-baseline gap-3 mb-2">
        <h3 className="t-label text-ink-muted">{name}</h3>
        <Mono className="text-[11px] text-ink-muted">{slug}</Mono>
        <span className="t-meta text-ink-muted ml-auto tabular-nums">
          {members.length} {members.length === 1 ? "person" : "people"}
          {going ? ` · ${here} here now` : ""}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {shown.map((person) => (
          <PersonCard key={person.participantId} person={person} base={base} going={going} />
        ))}
      </div>
      {members.length > FOLD_AT ? (
        <button type="button" onClick={() => setAll(!all)} className="mt-2 t-meta text-accent hover:underline">
          {all ? `Fold ${name} back to ${FOLD_AT}` : `Show the other ${members.length - FOLD_AT}`}
        </button>
      ) : null}
    </div>
  );
}

function PersonCard({ person, base, going }: { person: ParticipantLive; base: string; going: boolean }) {
  const body = (
    <Card className={`p-3.5 h-full ${person.status === "here" ? "border-accent/40" : ""}`}>
      <div className="flex items-center gap-2.5 mb-2">
        <Avatar name={person.name} />
        <div className="flex-1 min-w-0">
          <div className="t-body text-ink truncate">{person.name}</div>
          <div className="t-meta text-ink-muted">
            visit {person.visitNumber}
            {person.maxVisits === null ? "" : ` of ${person.maxVisits}`}
            {person.status === "here" ? ` · turn ${person.turn}` : ""}
          </div>
        </div>
        <Chip tone={person.status === "here" ? "live" : "neutral"}>{person.status === "here" ? "here now" : person.status === "away" ? "away" : "gone"}</Chip>
      </div>
      <div className="t-meta text-ink-muted flex items-baseline justify-between gap-2">
        <span>
          {person.status === "here" ? (
            person.lastCall === null ? (
              "thinking"
            ) : (
              <Mono className="text-[11.5px] text-evidence">{person.lastCall}</Mono>
            )
          ) : going ? (
            countdown(person.nextVisitAt)
          ) : (
            "not coming back"
          )}
        </span>
        <span className="tabular-nums">
          {usd4(person.costUsd)}
          {person.findings > 0 ? ` · ${person.findings} filed` : ""}
        </span>
      </div>
    </Card>
  );
  return person.wakeId === null ? body : <Link to={`${base}/visits/${encodeURIComponent(person.wakeId)}`}>{body}</Link>;
}

/**
 * One line per event, in the feed's own words. An event type this build does not know yet should
 * show as a plain line, not break the screen.
 */
function FeedLine({ event, names }: { event: LiveEvent; names: Map<string, string> }) {
  const text = (key: string): string => payloadText(event, key);
  const num = (key: string): number => payloadNumber(event, key);
  // Their name in prose when we know it; the persona slug in the trace's own ochre monospace when
  // the join misses, because then it really is all we have.
  const who = (): React.ReactNode => {
    const name = names.get(text("agentId"));
    return name === undefined ? <Mono className="text-[11.5px] text-evidence">{text("personaId")}</Mono> : <span className="text-ink">{name}</span>;
  };

  switch (event.type) {
    case "run.started":
      return (
        <span className="t-body text-ink">
          It started with {num("agents")} {num("agents") === 1 ? "person" : "people"}.
        </span>
      );
    case "run.ended":
      return <span className="t-body text-ink">It ended: {text("status")}.</span>;
    case "run.status":
      return (
        <span className="t-body text-ink-soft">
          {text("action") === "paused"
            ? text("reason") === "process-ended"
              ? "It stopped, because populace was closed."
              : "It was paused."
            : text("action") === "resumed"
              ? "It was picked back up."
              : text("action") === "reset"
                ? "The target was put back to a clean state."
                : "Everyone was asked back for another round."}
        </span>
      );
    case "run.config":
      return <span className="t-body text-ink-soft">The configuration it runs was replaced.</span>;
    case "wake.started":
      return (
        <span className="t-body text-ink-soft">
          {who()} arrived for visit {num("wakeNumber")}.
        </span>
      );
    case "wake.ended":
      return (
        <span className="t-body text-ink-soft">
          {who()}{" "}
          {text("status") === "gave-up" ? "gave up" : text("status") === "done" ? "finished" : text("status")}
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
          {text("kind") === "digest" ? "The digest" : text("kind") === "sweep" ? "The clean-up" : "Starting the execution"} did not finish
          {text("error") ? `: ${text("error")}` : ""}
        </span>
      );
    default:
      return <span className="t-body text-ink-muted">{event.type}</span>;
  }
}

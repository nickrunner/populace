import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, openEventStream, type LiveEvent, type ParticipantLive, type RunLive } from "../api.js";
import { keys, q } from "../queries.js";
import { useSimulation } from "../context.jsx";
import { lasted, payloadNumber, payloadText, people, plural } from "../format.js";
import {
  Badge,
  Button,
  Card,
  Chip,
  Disclosure,
  Inline,
  InstrumentPage,
  Link,
  LiveActivityFeed,
  Meter,
  MetaLine,
  Money,
  Mono,
  PageHeader,
  PersonLiveCard,
  Section,
  SeverityTag,
  Skeleton,
  Stack,
  StateBlock,
  Text,
  Toast,
  type FeedEvent,
  type FeedEventKind,
  type MetaFact,
  type PersonLiveState,
  type SeverityLevel,
  type StateKind,
} from "../design/index.js";

/** How many cards a cohort shows before it folds. Past a dozen, a grid stops being readable. */
const FOLD_AT = 12;

/**
 * The store's event vocabulary, translated into the product's (ADR-0032). A wake is a visit
 * everywhere a person can read it, and `trace.appended` is the instrument rather than the news —
 * it lives on the visit screen, so it never reaches the feed at all.
 */
function feedKind(type: LiveEvent["type"]): FeedEventKind | null {
  switch (type) {
    case "wake.started":
      return "visit.started";
    case "wake.ended":
      return "visit.ended";
    case "trace.appended":
      return null;
    default:
      return type;
  }
}

const SEVERITIES = ["critical", "high", "medium", "low"] as const;

/** A severity word off the wire, narrowed without a cast: anything else is not a severity. */
function severityOf(word: string): SeverityLevel | null {
  for (const level of SEVERITIES) if (level === word) return level;
  return null;
}

/** What the screen is called, which is the execution's resting state in a word. */
function headingOf(run: RunLive, abandoned: boolean): string {
  if (run.status === "running" || run.status === "pending") return run.mode === "longitudinal" ? "Going" : "Running";
  if (run.status === "paused") return abandoned ? "Stopped when populace was closed" : "Paused";
  if (run.status === "killed") return "Stopped";
  if (run.status === "failed") return "Failed";
  return "Finished";
}

/**
 * Watching an execution happen. The screen renders from `GET /runs/:id/live`, which is derived
 * from rows, so a reload mid-execution shows the right thing with no live connection at all. The
 * stream on top of that only moves it forward: every row in the feed is an event-log row, and a
 * dropped connection resumes from its cursor rather than losing the gap (ADR-0026).
 *
 * Instrument-class (DESIGN-SYSTEM §5.3): the full page width, `t-ui` chrome, and three instruments
 * — the run-progress `Meter` in the template's toolbar band, the grid of `PersonLiveCard`s under
 * their cohorts, and the `LiveActivityFeed`. The feed owns its own scroll and its own freshness
 * mark, so the `max-h-[26rem]` box and the eleven hand-written event renderings are gone, and the
 * four mutation-error strips that never cleared are four dismissible `Toast`s in the one region
 * `AppShell` mounts.
 *
 * Three things here are mode-aware or state-aware, and all three are §6.3 row 25's own words.
 * The controls: a longitudinal execution is PAUSED, because it is a life and stopping it would
 * end it; an ephemeral one is STOPPED, because it was always going to end. The meter: an
 * ephemeral execution has a planned number of visits and a longitudinal one is unbounded by
 * definition, so it gets no progress bar rather than a bar against an invented denominator. And
 * the resting state: a run whose process died is `paused` with reason `process-ended`, which is
 * not a failure and must not read like one.
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

  const run = live.data;
  const going = run !== undefined && (run.status === "running" || run.status === "pending");
  const abandoned = run !== undefined && run.status === "paused" && run.pauseReason === "process-ended";
  const busy = stop.isPending || pause.isPending || resume.isPending || round.isPending;
  const here = (run?.participants ?? []).filter((person) => person.status === "here");
  const cohortNames = new Map((cohorts.data?.items ?? []).map((cohort) => [cohort.cohortSlug, cohort.name]));
  // The feed says who, not what kind of who. A cohort of twelve first-timers is twelve people, and
  // twelve rows all reading `first-timer` name a template where the product has a cast. The roster
  // is already on this screen and the events carry the participant id, so the join costs nothing.
  const names = new Map((run?.participants ?? []).map((person) => [person.participantId, person.name]));

  // §5.4 fixes which element earns this screen's one lime: the person who most recently filed.
  // Nothing on the roster records when somebody filed, but the feed does, so the mark is read off
  // the newest `finding.filed` row rather than invented.
  const latestFiler = rows.find((event) => event.type === "finding.filed");
  const theOne = latestFiler === undefined ? null : payloadText(latestFiler, "agentId");

  const events: FeedEvent[] = rows.flatMap((event) => {
    const kind = feedKind(event.type);
    return kind === null
      ? []
      : [
          {
            id: `${event.seq}`,
            kind,
            at: event.at,
            sentence: sentenceOf(event, names),
            // Freshness is painted by the feed and faded out over 900ms; a row is fresh while it
            // is younger than that fade. The live query re-polls, so the flag clears itself
            // without this screen owning a timer.
            fresh: Date.now() - new Date(event.at).getTime() < 900,
          },
        ];
  });

  // The four acts this screen offers, and what each one says when it does not land. The title is
  // OUR sentence about what failed; the machine's own words are quoted beneath it rather than
  // paraphrased (DESIGN-SYSTEM §4.3, §7.4).
  const failures: { key: string; title: string; error: Error | null; clear: () => void }[] = [
    { key: "stop", title: "Could not stop this execution", error: stop.error, clear: () => stop.reset() },
    { key: "pause", title: "Could not pause this execution", error: pause.error, clear: () => pause.reset() },
    { key: "resume", title: "Could not pick this execution back up", error: resume.error, clear: () => resume.reset() },
    { key: "round", title: "Could not send another round", error: round.error, clear: () => round.reset() },
  ];

  const state: StateKind | undefined = live.isError ? "failed" : run === undefined ? "loading" : undefined;
  const heading = run === undefined ? "Live" : headingOf(run, abandoned);

  const meta: MetaFact[] =
    run === undefined
      ? []
      : [
          {
            key: "lasted",
            node:
              run.startedAt === null ? (
                "not started yet"
              ) : going ? (
                `going for ${lasted(run.startedAt, null)}`
              ) : (
                `ran for ${lasted(run.startedAt, run.endedAt)}`
              ),
          },
          {
            key: "visits",
            node:
              run.mode === "longitudinal"
                ? `${plural(run.visitsDone, "visit")} so far`
                : `${String(run.visitsDone)} of ${String(run.visitsPlanned)} visits done`,
          },
          { key: "cost", node: <Money usd={run.costUsd} precision={4} /> },
          { key: "findings", node: `${plural(run.findings, "finding")} filed` },
        ];

  const controls =
    run === undefined ? null : going ? (
      <Inline gap={2} align="center">
        {run.mode === "ephemeral" ? (
          <Button
            variant="secondary"
            pending={round.isPending}
            disabled={busy}
            onClick={() => {
              round.mutate();
            }}
          >
            Send one more round
          </Button>
        ) : null}
        {run.mode === "longitudinal" ? (
          <Button
            variant="secondary"
            pending={pause.isPending}
            disabled={busy}
            onClick={() => {
              pause.mutate();
            }}
          >
            Pause
          </Button>
        ) : (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              stop.mutate("drain");
            }}
          >
            Let them finish, then stop
          </Button>
        )}
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => {
            stop.mutate("now");
          }}
        >
          Stop everything now
        </Button>
      </Inline>
    ) : run.status === "paused" ? (
      <Button
        variant="primary"
        pending={resume.isPending}
        disabled={busy}
        onClick={() => {
          resume.mutate();
        }}
      >
        Pick it back up
      </Button>
    ) : (
      <Link size="ui" to={href()}>
        Read what they found
      </Link>
    );

  return (
    <>
      <InstrumentPage
        header={
          <PageHeader
            title={heading}
            meta={meta}
            status={going ? <Chip tone="live">live</Chip> : null}
            actions={controls}
            lede="Everyone who is in this execution right now, and everything that has happened since this page opened."
          />
        }
        toolbar={
          // Suppressed for a longitudinal execution, which is unbounded by definition (§6.3 row
          // 25): there is no denominator to draw a proportion against, and inventing one would be
          // a promise about how it ends.
          run === undefined || run.mode === "longitudinal" ? undefined : (
            <Stack gap={1} className="w-full">
              <Inline gap={3} align="baseline">
                <Text size="label" tone="muted">
                  visits
                </Text>
                <Text size="meta" tone="muted">
                  {`${String(run.visitsDone)} of ${String(run.visitsPlanned)} done`}
                </Text>
              </Inline>
              <Meter
                value={run.visitsDone}
                of={run.visitsPlanned}
                label={`${String(run.visitsDone)} of ${String(run.visitsPlanned)} visits done in this execution.`}
                size="sm"
              />
            </Stack>
          )
        }
        state={state}
        loading={
          <StateBlock
            kind="loading"
            what="the execution"
            skeleton={<Skeleton variant="row" count={8} label="Reading the execution" />}
          />
        }
        error={
          <StateBlock kind="failed" what="the execution" error={live.error}>
            <Button
              variant="secondary"
              onClick={() => {
                void live.refetch();
              }}
            >
              Try again
            </Button>
          </StateBlock>
        }
      >
        {run === undefined ? null : (
          <Stack gap={8}>
            {abandoned ? (
              <Card tone="sunk" pad="default">
                <Stack gap={1}>
                  <Text size="read-sm" tone="ink" as="p">
                    This stopped when populace was last closed. Nothing failed and nothing was lost.
                  </Text>
                  <Text size="read-sm" tone="soft" as="p">
                    Everyone still has their memory, their account and their visit number, because all three are kept against this
                    execution. Pick it back up and they carry on from where they were.
                  </Text>
                </Stack>
              </Card>
            ) : null}

            {run.status === "killed" ? (
              <Card pad="default">
                <Stack gap={3}>
                  <Stack gap={1}>
                    <div>
                      <Badge variant="bad">Stopped</Badge>
                    </div>
                    <Text size="read-sm" tone="ink" as="p">
                      Everything is stopped, and it stays stopped until you release it.
                    </Text>
                    <Text size="read-sm" tone="soft" as="p">
                      Nothing else can start an execution on this machine in the meantime.
                    </Text>
                  </Stack>
                  <Inline gap={2} align="center">
                    <Button
                      variant="secondary"
                      onClick={() => void api.setKillSwitch(false).then(() => queries.invalidateQueries())}
                    >
                      Release the stop
                    </Button>
                  </Inline>
                </Stack>
              </Card>
            ) : null}

            <Section
              title="Where everyone is"
              trailing={going ? `${people(here.length)} mid-visit` : people(run.participants.length)}
            >
              {run.participants.length === 0 ? (
                <StateBlock kind="empty" what="the roster">
                  Nobody has arrived yet.
                </StateBlock>
              ) : (
                <CohortGrid
                  participants={run.participants}
                  names={cohortNames}
                  visitPath={(wakeId) => href(`visits/${encodeURIComponent(wakeId)}`)}
                  going={going}
                  theOne={theOne}
                />
              )}
            </Section>

            <Section title="As it happens" trailing={plural(events.length, "event")}>
              <LiveActivityFeed events={events} label="findings, stops and visits, newest first" />
            </Section>
          </Stack>
        )}
      </InstrumentPage>

      {/*
        One dismissible region instead of four strips that never cleared. React Query drops each
        error the moment that act is tried again, so a toast leaves on its own when the next
        attempt succeeds; `reset()` is what the reader's dismissal does.
      */}
      {failures.map((act) =>
        act.error === null ? null : (
          <Toast
            key={act.key}
            tone="bad"
            title={act.title}
            body={<Mono size="code-sm">{act.error.message}</Mono>}
            onDismiss={act.clear}
          />
        ),
      )}
    </>
  );
}

interface GridProps {
  participants: readonly ParticipantLive[];
  names: Map<string, string>;
  visitPath: (wakeId: string) => string;
  going: boolean;
  theOne: string | null;
}

/**
 * The grid, under cohort headers. A population is not a flat list of strangers — "the sceptics are
 * all still away and the first-timers are all here" is the thing a person watching this wants to
 * see, and it is invisible in one undifferentiated wall of cards.
 */
function CohortGrid({ participants, names, visitPath, going, theOne }: GridProps) {
  const slugs = [...new Set(participants.map((person) => person.cohortSlug))];
  return (
    <Stack gap={6}>
      {slugs.map((slug) => (
        <CohortBlock
          key={slug}
          name={names.get(slug) ?? slug}
          members={participants.filter((person) => person.cohortSlug === slug)}
          visitPath={visitPath}
          going={going}
          theOne={theOne}
        />
      ))}
    </Stack>
  );
}

interface BlockProps {
  name: string;
  members: readonly ParticipantLive[];
  visitPath: (wakeId: string) => string;
  going: boolean;
  theOne: string | null;
}

function CohortBlock({ name, members, visitPath, going, theOne }: BlockProps) {
  const present = members.filter((person) => person.status === "here").length;
  const shown = members.slice(0, FOLD_AT);
  const rest = members.slice(FOLD_AT);

  const facts: MetaFact[] = [
    { key: "size", node: people(members.length) },
    ...(going ? [{ key: "here", node: `${String(present)} here now` }] : []),
  ];

  return (
    <Stack gap={2}>
      <Inline gap={3} align="baseline" className="justify-between">
        <Text size="label" tone="muted">
          {name}
        </Text>
        <MetaLine facts={facts} />
      </Inline>

      <PeopleGrid people={shown} cohort={name} visitPath={visitPath} going={going} theOne={theOne} />

      {rest.length === 0 ? null : (
        <Disclosure label={`The rest of ${name}`} count={rest.length}>
          <PeopleGrid people={rest} cohort={name} visitPath={visitPath} going={going} theOne={theOne} />
        </Disclosure>
      )}
    </Stack>
  );
}

interface PeopleGridProps {
  people: readonly ParticipantLive[];
  cohort: string;
  visitPath: (wakeId: string) => string;
  going: boolean;
  theOne: string | null;
}

function PeopleGrid({ people: members, cohort, visitPath, going, theOne }: PeopleGridProps) {
  return (
    <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
      {members.map((person) => (
        <li key={person.participantId}>
          <PersonCell person={person} cohort={cohort} visitPath={visitPath} going={going} theOne={theOne} />
        </li>
      ))}
    </ul>
  );
}

/** What somebody is doing, in the four words the live card knows (§3, organism 29). */
function stateOf(person: ParticipantLive): PersonLiveState {
  if (person.status !== "here") return "away";
  return person.lastCall === null ? "thinking" : "calling";
}

interface CellProps {
  person: ParticipantLive;
  cohort: string;
  visitPath: (wakeId: string) => string;
  going: boolean;
  theOne: string | null;
}

/**
 * One person, and the figures that belong to them. `PersonLiveCard` draws who they are and what
 * they are doing; the line beneath carries what the cell has always also carried — which visit
 * this is, what it has cost, what they have filed — and the visit number is the way into the
 * transcript, exactly as the start time is on the visits log.
 */
function PersonCell({ person, cohort, visitPath, going, theOne }: CellProps) {
  const state = stateOf(person);
  // Away, and coming back: the card counts down to it. Away with nowhere to be — retired, or an
  // execution that has finished — has no countdown, so the line beneath says so in words.
  const returning = going && person.status === "away" && person.nextVisitAt !== null;
  const visit = `visit ${String(person.visitNumber)}${person.maxVisits === null ? "" : ` of ${String(person.maxVisits)}`}`;

  const facts: MetaFact[] = [
    {
      key: "visit",
      node:
        person.wakeId === null ? (
          visit
        ) : (
          <Link size="meta" to={visitPath(person.wakeId)}>
            {visit}
          </Link>
        ),
    },
    ...(person.status === "here" ? [{ key: "turn", node: `turn ${String(person.turn)}` }] : []),
    { key: "cost", node: <Money usd={person.costUsd} precision={4} /> },
    ...(person.findings === 0 ? [] : [{ key: "filed", node: `${plural(person.findings, "finding")} filed` }]),
    ...(returning || person.status === "here" ? [] : [{ key: "back", node: "not coming back" }]),
  ];

  return (
    <Stack gap={2}>
      <PersonLiveCard
        name={person.name}
        cohort={cohort}
        state={state}
        theOne={person.participantId === theOne}
        {...(state === "calling" && person.lastCall !== null ? { tool: person.lastCall } : {})}
        {...(returning && person.nextVisitAt !== null ? { nextAt: person.nextVisitAt } : {})}
      />
      <MetaLine facts={facts} />
    </Stack>
  );
}

/**
 * One event, as a sentence, in the feed's own words. The feed sets the row; this composes what
 * goes in it, which is how a person's name keeps its weight inside the line without the organism
 * knowing what a person is. An event kind this build does not know yet is a plain line, not a
 * broken screen.
 */
function sentenceOf(event: LiveEvent, names: Map<string, string>): ReactNode {
  const text = (key: string): string => payloadText(event, key);
  const num = (key: string): number => payloadNumber(event, key);
  // Their name in prose when we know it; the persona slug in the trace's own ochre monospace when
  // the join misses, because then it really is all we have.
  const who = (): ReactNode => {
    const name = names.get(text("agentId"));
    return name === undefined ? <Mono size="code-sm">{text("personaId")}</Mono> : <Text size="name">{name}</Text>;
  };

  switch (event.type) {
    case "run.started":
      return `It started with ${people(num("agents"))}.`;
    case "run.ended":
      return `It ended: ${text("status")}.`;
    case "run.status":
      return text("action") === "paused"
        ? text("reason") === "process-ended"
          ? "It stopped, because populace was closed."
          : "It was paused."
        : text("action") === "resumed"
          ? "It was picked back up."
          : text("action") === "reset"
            ? "The target was put back to a clean state."
            : "Everyone was asked back for another round.";
    case "run.config":
      return "The configuration it runs was replaced.";
    case "wake.started":
      return (
        <>
          {who()} arrived for visit {num("wakeNumber")}.
        </>
      );
    case "wake.ended":
      return (
        <>
          {who()} {text("status") === "gave-up" ? "gave up" : text("status") === "done" ? "finished" : text("status")}
          {text("summary") ? `: ${text("summary")}` : ""}{" "}
          <Text size="meta" tone="muted">
            <Money usd={num("costUsd")} precision={4} />
          </Text>
        </>
      );
    case "finding.filed": {
      const level = severityOf(text("severity"));
      return (
        <>
          {level === null ? <Text size="label" tone="muted">{text("severity")}</Text> : <SeverityTag level={level} />}{" "}
          <Text size="name">{text("title")}</Text>
        </>
      );
    }
    case "guardrail.tripped":
      return (
        <Text size="ui" tone="critical">
          Guardrail: {text("rule")} — {text("detail")}
        </Text>
      );
    case "identity.created":
      return `An account was created${text("email") ? ` for ${text("email")}` : ""}.`;
    case "job.updated":
      return (
        <Text size="ui" tone="critical">
          {text("kind") === "digest" ? "The digest" : text("kind") === "sweep" ? "The clean-up" : "Starting the execution"} did not
          finish
          {text("error") ? `: ${text("error")}` : ""}
        </Text>
      );
    default:
      return text("action") || event.type;
  }
}

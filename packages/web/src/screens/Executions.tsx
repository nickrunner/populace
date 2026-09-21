import { Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type { LiveEvent, SimulationResults } from "../api.js";
import { q } from "../queries.js";
import { useProject, useSimulation } from "../context.jsx";
import { lasted, payloadNumber, payloadText, plural } from "../format.js";
import {
  Button,
  Card,
  ExecutionPicker,
  ExecutionRow,
  Inline,
  InstrumentPage,
  Ledger,
  Link,
  LiveActivityFeed,
  MetaLine,
  MetaSentence,
  Money,
  PageHeader,
  RelativeTime,
  Skeleton,
  Stack,
  StateBlock,
  type Crumb,
  type FeedEvent,
  type MetaFact,
  type StateKind,
} from "../design/index.js";

/**
 * How a simulation's past is presented, and it is not one thing (SPEC §4.3).
 *
 * An ephemeral simulation has EXECUTIONS: independent peers, each a clean slate, each with its
 * own cast and its own numbers, and the interesting question is what moved between two of them.
 * A longitudinal simulation has ONE execution and the interesting question is what happened TO
 * it — when it was paused, when it was picked back up, when its config was replaced. Those are
 * events, and nothing else records them, which is why this screen reads the event log.
 *
 * Instrument-class (DESIGN-SYSTEM §5.3): the full page width, `t-ui` chrome, and the history as
 * a `Ledger` whose 72px stub carries the one locator a reader recognises — *execution 3*. The
 * picker is the template's toolbar strip rather than a second heading below the list, which is
 * what §4's `InstrumentPage` reserves that band for.
 */

type Execution = SimulationResults["history"][number];

/**
 * The honesty note under an ephemeral history. It is not a disclaimer in small print: two
 * executions genuinely disagree, by design (SPEC §4), and a reader comparing two numbers without
 * this sentence will read noise as a change they caused. Verbatim, and non-negotiable
 * (DESIGN-SYSTEM §7.3).
 */
export const INDEPENDENT =
  "Executions are independent. Different people do different things, so expect the numbers to move even when nothing about your product changed.";

/**
 * The four kinds of event that are moments in a longitudinal execution's life. Narrowed rather
 * than filtered by string, so the feed's `kind` is the event's own type and no cast is needed to
 * hand it over.
 */
const MOMENTS = ["run.started", "run.status", "run.config", "run.ended"] as const;
type MomentKind = (typeof MOMENTS)[number];
type Moment = LiveEvent & { type: MomentKind };

function isMoment(event: LiveEvent): event is Moment {
  const kinds: readonly string[] = MOMENTS;
  return kinds.includes(event.type);
}

/** Two executions, side by side, in the order the compare screen reads them. */
const comparePath = (earlier: string, later: string): string =>
  `executions/compare?a=${encodeURIComponent(earlier)}&b=${encodeURIComponent(later)}`;

/**
 * Where a row goes, and where it does not.
 *
 * An execution has no page of its own — the thing a reader wants when they open one is it beside
 * its neighbour, which is the affordance this list has always carried as a trailing "compare
 * with" link and which the ledger row now IS. That much the port keeps on purpose: `ExecutionRow`
 * is a `LedgerRow`, the whole row is the target, and one press does what a 90px text link at the
 * end of the row used to (§6.3 row 9 names the row as this screen's principal organism).
 *
 * **What the port must NOT do is invent destinations**, and it had. The rule here is the one this
 * screen has always had, restored: the comparison worth offering is with the execution BEFORE
 * this one, so a row is a link only when there is an older execution under it. The oldest row
 * offers nothing — comparing it forwards with the newer one is a different reading than the one
 * the reader pressed, and the rows above it already offer it — and a lone execution is not
 * clickable at all, rather than quietly navigating to the results page nobody asked for.
 */
function beside(history: readonly Execution[], index: number, href: (path?: string) => string): string | undefined {
  const entry = history[index];
  const older = history[index + 1];
  if (entry === undefined || older === undefined) return undefined;
  return href(comparePath(older.runId, entry.runId));
}

/** The band on the results screen: the last few executions, and the way to compare two. */
export function ExecutionHistory({ results, limit }: { results: SimulationResults; limit?: number }) {
  const { href, runId } = useSimulation();
  const mode = results.simulation.mode;
  const newestFirst = [...results.history].sort((a, b) => b.seq - a.seq);
  const shown = limit === undefined ? newestFirst : newestFirst.slice(0, limit);

  if (results.history.length === 0)
    return (
      <StateBlock kind="empty" what="this simulation's executions">
        This simulation has never been run.
      </StateBlock>
    );

  if (mode === "longitudinal") {
    const only = newestFirst[0];
    return only === undefined ? null : (
      <OneLife entry={only} />
    );
  }

  return (
    <Stack gap={4}>
      <Ledger as="ol" stubLabel="execution">
        {shown.map((entry, index) => {
          const to = beside(newestFirst, index, href);
          return (
            <ExecutionRow
              key={entry.runId}
              execution={entry}
              current={entry.runId === runId}
              {...(to === undefined ? {} : { to })}
            />
          );
        })}
      </Ledger>

      {/*
        The sentence is verbatim and stays verbatim (§7.3). The link after it is not a softening
        of it — it goes to the public page that says the same thing at length, under a stable
        anchor, for the reader who has just watched two numbers move and wants to know whether
        that is them or the product. No new chrome: one sentence, one link.
      */}
      <MetaSentence>
        {INDEPENDENT}{" "}
        <Link to="/concepts#what-varies">What varies, and what does not</Link>
      </MetaSentence>

      {limit !== undefined && newestFirst.length > limit ? (
        <Inline>
          <Link size="ui" to={href("executions")}>
            {`All ${newestFirst.length} executions`}
          </Link>
        </Inline>
      ) : null}
    </Stack>
  );
}

/**
 * A longitudinal execution described as a life rather than as a row in a list: how long it has
 * been going, how often it was interrupted, what it has cost — and then what actually happened
 * to it, in order.
 */
function OneLife({ entry }: { entry: Execution }) {
  const events = useQuery(q.runEvents(entry.runId));
  const moments = (events.data?.items ?? []).filter(isMoment);
  const pauses = moments.filter((event) => event.type === "run.status" && payloadText(event, "action") === "paused").length;
  const resumes = moments.filter((event) => event.type === "run.status" && payloadText(event, "action") === "resumed").length;

  // The sentence is composed rather than concatenated, so the one figure in it is a `Money` and
  // not a second spelling of what a dollar looks like.
  const parts: MetaFact[] = [
    {
      key: "lasted",
      node:
        entry.status === "running"
          ? `Running for ${lasted(entry.startedAt, null)}`
          : `Ran for ${lasted(entry.startedAt, entry.endedAt)}`,
    },
    ...(pauses === 0 ? [] : [{ key: "paused", node: pauses === 1 ? "paused once" : `paused ${pauses} times` }]),
    ...(resumes === 0
      ? []
      : [{ key: "resumed", node: resumes === 1 ? "picked back up once" : `picked back up ${resumes} times` }]),
    { key: "visits", node: plural(entry.visits, "visit") },
    { key: "cost", node: <Money usd={entry.costUsd} /> },
  ];

  const facts: MetaFact[] = [
    { key: "seq", node: `execution ${entry.seq}` },
    {
      key: "started",
      node:
        entry.startedAt === null ? (
          "never started"
        ) : (
          <>
            {"started "}
            <RelativeTime at={entry.startedAt} mode="absolute" />
          </>
        ),
    },
    { key: "status", node: entry.status },
  ];

  const feed: FeedEvent[] = [...moments].reverse().map((event) => ({
    id: `${event.seq}`,
    kind: event.type,
    at: event.at,
    sentence: momentWords(event),
    fresh: false,
  }));

  return (
    <Card pad="default">
      <Stack gap={4}>
        <Stack gap={2}>
          <MetaSentence>
            {parts.map((part, index) => (
              <Fragment key={part.key}>
                {index === 0 ? null : ", "}
                {part.node}
              </Fragment>
            ))}
            .
          </MetaSentence>
          <MetaLine facts={facts} />
        </Stack>

        {events.isPending ? (
          // A skeleton built to the height of the feed it replaces, like the other sixteen
          // screens: without one the card collapses to a line and jumps back when the feed lands.
          <StateBlock
            kind="loading"
            what="what happened to it"
            skeleton={<Skeleton variant="row" count={3} label="Reading what happened to it" />}
          />
        ) : events.isError ? (
          // Every failed state in the product offers the read again (§6.5, rule 7): a read that
          // failed is the one state a reader can do something about, and a page that says so on
          // three screens and not on the other fifteen teaches nobody anything.
          <StateBlock kind="failed" what="what happened to it" error={events.error}>
            <Button
              variant="secondary"
              onClick={() => {
                void events.refetch();
              }}
            >
              Try again
            </Button>
          </StateBlock>
        ) : moments.length === 0 ? (
          <StateBlock kind="empty" what="this execution's life">
            Nothing has interrupted it.
          </StateBlock>
        ) : (
          <LiveActivityFeed events={feed} label="what has happened to it, newest first" />
        )}
      </Stack>
    </Card>
  );
}

/** One moment in an execution's life, in the words a person would use for it. */
function momentWords(event: LiveEvent): string {
  switch (event.type) {
    case "run.started": {
      const people = payloadNumber(event, "agents");
      return `Started with ${people} ${people === 1 ? "person" : "people"}.`;
    }
    case "run.config":
      return "The configuration it runs was replaced; new cohorts start at visit one and everyone else keeps their memory.";
    case "run.ended":
      return `Ended: ${payloadText(event, "status") || "no status recorded"}.`;
    default: {
      const action = payloadText(event, "action");
      if (action === "paused") return payloadText(event, "reason") === "process-ended" ? "Stopped, because populace was closed." : "Paused.";
      if (action === "resumed") return "Picked back up on the same execution — memory, accounts and visit numbering all continue.";
      if (action === "round") return "Everyone was asked back for another round.";
      if (action === "reset") return "The target was put back to a clean state.";
      return action || event.type;
    }
  }
}

/** The whole history, on a page of its own, with a way to pick any two executions to compare. */
export function Executions() {
  const { key } = useProject();
  const { key: sim, simulation, href } = useSimulation();
  const results = useQuery(q.results(key, sim));
  const [params, setParams] = useSearchParams();

  const history = [...(results.data?.history ?? [])].sort((a, b) => b.seq - a.seq);
  const a = params.get("a") ?? history[1]?.runId ?? "";
  const b = params.get("b") ?? history[0]?.runId ?? "";

  const state: StateKind | undefined = results.isPending
    ? "loading"
    : results.isError
      ? "failed"
      : history.length === 0
        ? "empty"
        : undefined;

  const crumbs: Crumb[] = [{ label: "Results", to: href() }, { label: "Executions" }];
  const ephemeral = simulation.mode === "ephemeral";
  const meta: MetaFact[] = ephemeral && history.length > 0 ? [{ key: "count", node: plural(history.length, "execution") }] : [];

  return (
    <InstrumentPage
      header={
        <PageHeader
          title="Executions"
          crumbs={crumbs}
          meta={meta}
          lede={
            ephemeral
              ? "Every time this simulation has been run, newest first. Open one to put it beside the execution before it."
              : "A longitudinal simulation is one execution with a life: what interrupted it, when it was picked back up, and what it has cost."
          }
        />
      }
      toolbar={
        ephemeral && history.length > 1 ? (
          <ExecutionPicker
            executions={history}
            a={a}
            b={b}
            to={href(comparePath(a, b))}
            onA={(value) => {
              setParams({ a: value, b });
            }}
            onB={(value) => {
              setParams({ a, b: value });
            }}
          />
        ) : undefined
      }
      state={state}
      loading={
        <StateBlock
          kind="loading"
          what="this simulation's history"
          skeleton={<Skeleton variant="row" count={5} height={56} label="Reading this simulation's history" />}
        />
      }
      error={
        <StateBlock kind="failed" what="this simulation's history" error={results.error}>
          <Button
            variant="secondary"
            onClick={() => {
              void results.refetch();
            }}
          >
            Try again
          </Button>
        </StateBlock>
      }
      empty={
        <StateBlock kind="empty" what="this simulation's executions">
          This simulation has never been run.{" "}
          <Link to={href("preflight")}>See who would go, and what it would cost</Link>.
        </StateBlock>
      }
    >
      {results.data === undefined ? null : <ExecutionHistory results={results.data} />}
    </InstrumentPage>
  );
}

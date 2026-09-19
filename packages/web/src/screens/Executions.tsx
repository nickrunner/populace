import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import type { LiveEvent, SimulationResults } from "../api.js";
import { q } from "../queries.js";
import { useProject, useSimulation } from "../context.jsx";
import { ago, clock, lasted, payloadNumber, payloadText, usd, when } from "../format.js";
import { Card, Empty, Failed, Loading, PageHeader, Breadcrumb } from "../components/ui.jsx";

/**
 * How a simulation's past is presented, and it is not one thing (SPEC §4.3).
 *
 * An ephemeral simulation has EXECUTIONS: independent peers, each a clean slate, each with its
 * own cast and its own numbers, and the interesting question is what moved between two of them.
 * A longitudinal simulation has ONE execution and the interesting question is what happened TO
 * it — when it was paused, when it was picked back up, when its config was replaced. Those are
 * events, and nothing else records them, which is why this screen reads the event log.
 */

const STATUS_INK: Record<string, string> = {
  completed: "text-confirmed",
  running: "text-accent",
  paused: "text-ink-muted",
  killed: "text-critical",
  failed: "text-critical",
  pending: "text-ink-muted",
};

/**
 * The honesty note under an ephemeral history. It is not a disclaimer in small print: two
 * executions genuinely disagree, by design (SPEC §4), and a reader comparing two numbers without
 * this sentence will read noise as a change they caused.
 */
export const INDEPENDENT =
  "Executions are independent. Different people do different things, so expect the numbers to move even when nothing about your product changed.";

function Row({ entry, previous, compareTo }: { entry: SimulationResults["history"][number]; previous?: SimulationResults["history"][number]; compareTo: string | null }) {
  const { href } = useSimulation();
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 px-4 py-3">
      <span className="t-body font-medium tabular-nums w-8">{entry.seq}</span>
      <span className={`t-meta ${STATUS_INK[entry.status] ?? "text-ink-muted"}`}>● {entry.status}</span>
      <span className="t-meta text-ink-muted">{entry.startedAt === null ? "never started" : when(entry.startedAt)}</span>
      <span className="t-meta text-ink-soft tabular-nums">
        {entry.visits} {entry.visits === 1 ? "visit" : "visits"}
      </span>
      <span className="t-meta text-ink-soft tabular-nums">{entry.confirmed} confirmed</span>
      <span className="t-meta text-ink-soft tabular-nums">{usd(entry.costUsd)}</span>
      <span className="flex-1" />
      {compareTo === null ? null : (
        <Link to={href(`executions/compare?a=${encodeURIComponent(compareTo)}&b=${encodeURIComponent(entry.runId)}`)} className="t-meta text-accent hover:underline">
          compare with {previous?.seq ?? "the one before"}
        </Link>
      )}
    </div>
  );
}

/** The band on the results screen: the last few executions, and the way to compare two. */
export function ExecutionHistory({ results, limit }: { results: SimulationResults; limit?: number }) {
  const { href } = useSimulation();
  const mode = results.simulation.mode;
  const newestFirst = [...results.history].sort((a, b) => b.seq - a.seq);
  const shown = limit === undefined ? newestFirst : newestFirst.slice(0, limit);

  if (results.history.length === 0)
    return (
      <Card className="p-4">
        <Empty>This simulation has never been run.</Empty>
      </Card>
    );

  if (mode === "longitudinal") {
    const only = newestFirst[0];
    return only === undefined ? null : <OneLife entry={only} />;
  }

  return (
    <>
      <Card className="divide-y divide-rule">
        {shown.map((entry, index) => {
          const previous = newestFirst[index + 1];
          return <Row key={entry.runId} entry={entry} {...(previous === undefined ? {} : { previous })} compareTo={previous?.runId ?? null} />;
        })}
      </Card>
      <p className="t-meta text-ink-muted mt-2.5 max-w-[78ch]">{INDEPENDENT}</p>
      {limit !== undefined && newestFirst.length > limit ? (
        <Link to={href("executions")} className="inline-block mt-2 t-body text-accent hover:underline">
          All {newestFirst.length} executions
        </Link>
      ) : null}
    </>
  );
}

/**
 * A longitudinal execution described as a life rather than as a row in a list: how long it has
 * been going, how often it was interrupted, what it has cost — and then what actually happened
 * to it, in order.
 */
function OneLife({ entry }: { entry: SimulationResults["history"][number] }) {
  const events = useQuery(q.runEvents(entry.runId));
  const moments = (events.data?.items ?? []).filter((event) => event.type === "run.started" || event.type === "run.status" || event.type === "run.config" || event.type === "run.ended");
  const pauses = moments.filter((event) => event.type === "run.status" && payloadText(event, "action") === "paused").length;
  const resumes = moments.filter((event) => event.type === "run.status" && payloadText(event, "action") === "resumed").length;

  const sentence = [
    entry.status === "running" ? `Running for ${lasted(entry.startedAt, null)}` : `Ran for ${lasted(entry.startedAt, entry.endedAt)}`,
    pauses === 0 ? null : pauses === 1 ? "paused once" : `paused ${pauses} times`,
    resumes === 0 ? null : resumes === 1 ? "picked back up once" : `picked back up ${resumes} times`,
    `${entry.visits} ${entry.visits === 1 ? "visit" : "visits"}`,
    usd(entry.costUsd),
  ]
    .filter((part): part is string => part !== null)
    .join(", ");

  return (
    <Card className="p-4">
      <p className="t-body text-ink">{sentence}.</p>
      <p className="t-meta text-ink-muted mt-1">
        Execution {entry.seq} · started {entry.startedAt === null ? "—" : when(entry.startedAt)} · {entry.status}
      </p>

      {events.isPending ? (
        <p className="t-meta text-ink-muted mt-4">Reading what happened to it…</p>
      ) : moments.length === 0 ? (
        <p className="t-meta text-ink-muted mt-4">Nothing has interrupted it.</p>
      ) : (
        <ol className="mt-4 border-t border-rule pt-3 flex flex-col gap-1.5">
          {[...moments].reverse().map((event) => (
            <li key={event.seq} className="flex items-baseline gap-3">
              <span className="t-meta text-ink-muted tabular-nums shrink-0 w-12">{clock(event.at)}</span>
              <span className="t-body text-ink-soft">{momentWords(event)}</span>
              <span className="t-meta text-ink-muted ml-auto shrink-0">{ago(event.at)}</span>
            </li>
          ))}
        </ol>
      )}
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

  if (results.isPending) return <Loading what="this simulation's history" />;
  if (results.isError) return <Failed error={results.error} />;

  const history = [...results.data.history].sort((a, b) => b.seq - a.seq);
  const a = params.get("a") ?? history[1]?.runId ?? "";
  const b = params.get("b") ?? history[0]?.runId ?? "";

  return (
    <>
      <Breadcrumb items={[{ label: "Results", to: href() }, { label: "Executions" }]} />
      <PageHeader
        title="Executions"
        lede={
          simulation.mode === "longitudinal"
            ? "A longitudinal simulation is one execution with a life: what interrupted it, when it was picked back up, and what it has cost."
            : `Every time this simulation has been run, newest first. ${INDEPENDENT}`
        }
      />

      <ExecutionHistory results={results.data} />

      {simulation.mode === "ephemeral" && history.length > 1 ? (
        <div className="mt-8 pt-6 border-t border-rule">
          <h2 className="t-section mb-3">Compare two of them</h2>
          <div className="flex flex-wrap items-center gap-3">
            <Pick label="Earlier" value={a} history={history} onChange={(v) => setParams({ a: v, b })} />
            <Pick label="Later" value={b} history={history} onChange={(v) => setParams({ a, b: v })} />
            <Link to={href(`executions/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`)} className="t-body text-accent hover:underline">
              Put them side by side →
            </Link>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Pick({ label, value, history, onChange }: { label: string; value: string; history: SimulationResults["history"]; onChange: (value: string) => void }) {
  return (
    <label className="flex items-center gap-2">
      <span className="t-label text-ink-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="bg-card border border-rule rounded-md px-2.5 py-1.5 t-body text-ink outline-none focus:border-accent">
        {history.map((entry) => (
          <option key={entry.runId} value={entry.runId}>
            {`execution ${entry.seq} — ${entry.startedAt === null ? "never started" : when(entry.startedAt)}`}
          </option>
        ))}
      </select>
    </label>
  );
}

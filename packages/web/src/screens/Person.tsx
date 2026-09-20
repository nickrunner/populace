import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, isMissing, type ParticipantDetail } from "../api.js";
import { q } from "../queries.js";
import { useProject, useSimulation } from "../context.jsx";
import { ago, clock, usd, usd4, wakeOutcome, when } from "../format.js";
import { Avatar, Breadcrumb, Card, Empty, Failed, Gone, Loading, Mono, Section, Severity } from "../components/ui.jsx";

/**
 * One person: who they are, what they are carrying between visits, and everywhere they have been.
 *
 * It is ONE request. The screen this replaces fired a memory query per head and re-polled it
 * every five seconds; `ParticipantDetailView` exists so that a person's whole page — identity,
 * traits, memory, visits, findings and their other simulations — arrives together (SPEC §6.2).
 */

function Memory({ person }: { person: ParticipantDetail }) {
  const slices: { title: string; entries: { wake: number; text: string }[] }[] = [
    { title: "What they are waiting on", entries: person.memory.waitingOn },
    { title: "What annoyed them", entries: person.memory.annoyances },
    { title: "What they got done", entries: person.memory.done },
  ];
  const empty = slices.every((slice) => slice.entries.length === 0) && person.memory.notes.length === 0;
  return (
    <Card className="p-4">
      <div className="t-label text-ink-muted mb-2">What they carry between visits</div>
      {empty ? (
        <Empty>They have not written anything down yet.</Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {slices.map((slice) =>
            slice.entries.length === 0 ? null : (
              <div key={slice.title}>
                <div className="t-meta text-ink-muted mb-1">{slice.title}</div>
                <ul className="flex flex-col gap-1">
                  {slice.entries.map((entry, index) => (
                    <li key={`${entry.wake}-${index}`} className="t-body text-ink-soft flex gap-2">
                      <span className="flex-1">{entry.text}</span>
                      <span className="t-meta text-ink-muted shrink-0">visit {entry.wake}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )}
          {person.memory.notes.length === 0 ? null : (
            <div>
              <div className="t-meta text-ink-muted mb-1">Notes to themselves</div>
              <ul className="flex flex-col gap-1">
                {person.memory.notes.map((note, index) => (
                  <li key={index} className="t-body text-ink-soft">
                    {note.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * The page itself, given a run and a participant in it. Both entry points render this: the one
 * inside a simulation, and the project-level one that resolves a durable person to their most
 * recent participation first.
 */
export function PersonPage({ runId, pid, linkTo, trail }: { runId: string; pid: string; linkTo: (path: string) => string; trail: { label: string; to?: string }[] }) {
  const person = useQuery(q.participant(runId, pid));

  if (person.isPending) return <Loading what="this person" />;
  if (person.isError)
    return isMissing(person.error) ? (
      <Gone what="Nobody by that name went on this execution. They may have been on an earlier one, or joined a cohort after it ran." />
    ) : (
      <Failed error={person.error} />
    );

  const who = person.data;
  const traits = Object.entries(who.traits);

  return (
    <>
      <Breadcrumb items={[...trail, { label: who.name }]} />

      <div className="flex items-center gap-3 mt-2 mb-1">
        <Avatar name={who.name} />
        <h1 className="t-title">{who.name}</h1>
        <span className="t-meta text-ink-muted">
          {who.cohortName || who.cohortSlug} · {who.personaName}
        </span>
      </div>
      <p className="t-body text-ink-soft max-w-[68ch] mb-1">{who.details || who.role}</p>
      <Mono className="text-[11px] text-ink-muted block mb-7">
        {who.personId} · {who.id}
      </Mono>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,22rem)] gap-8 items-start">
        <div>
          <Section title="Their visits" sub={`${who.visits.length}${who.maxVisits === null ? "" : ` of ${who.maxVisits}`} so far`}>
            {who.visits.length === 0 ? (
              <Card className="p-4">
                <Empty>They have not been yet.</Empty>
              </Card>
            ) : (
              <Card className="divide-y divide-rule">
                {who.visits.map((visit) => (
                  <Link key={visit.id} to={linkTo(`visits/${encodeURIComponent(visit.id)}`)} className="flex items-baseline gap-4 p-3.5 hover:bg-well">
                    <span className="t-body w-20">visit {visit.visitNumber}</span>
                    <span className="t-meta text-ink-muted tabular-nums w-14">{clock(visit.startedAt)}</span>
                    <span className="t-meta text-ink-soft flex-1 truncate">{visit.summary || wakeOutcome(visit.status)}</span>
                    <span className="t-meta text-ink-muted tabular-nums shrink-0">
                      {visit.findings > 0 ? `${visit.findings} filed · ` : ""}
                      {usd4(visit.costUsd)}
                    </span>
                  </Link>
                ))}
              </Card>
            )}
          </Section>

          <Section title="What they filed" sub={`${who.findingsFiled.length} ${who.findingsFiled.length === 1 ? "report" : "reports"}`}>
            {who.findingsFiled.length === 0 ? (
              <Card className="p-4">
                <Empty>They have not filed anything.</Empty>
              </Card>
            ) : (
              <Card className="divide-y divide-rule">
                {who.findingsFiled.map((finding) => (
                  <Link key={finding.id} to={linkTo(`f/${encodeURIComponent(finding.signature)}`)} className="block p-3.5 hover:bg-well">
                    <div className="flex items-baseline gap-2.5 mb-1">
                      <Severity value={finding.severity} kind={finding.kind} />
                      <span className="t-meta text-ink-muted ml-auto">{ago(finding.createdAt)}</span>
                    </div>
                    <div className="t-body text-ink">{finding.title}</div>
                  </Link>
                ))}
              </Card>
            )}
          </Section>
        </div>

        <div className="flex flex-col gap-4">
          <Memory person={who} />

          <Card className="p-4">
            <div className="t-label text-ink-muted mb-2">How they were made</div>
            <dl className="flex flex-col gap-1.5">
              <Row label="Patience" value={`${who.patience} of 5`} />
              <Row label="Would pay" value={who.budgetUsd === 0 ? "nothing — free only" : `${usd(who.budgetUsd)} a month`} />
              {traits.map(([trait, value]) => (
                <Row key={trait} label={trait} value={String(value)} />
              ))}
              <Row label="Model" value={`${who.model} · ${who.effort}`} mono />
              {who.account === null ? null : <Row label="Account" value={who.account.email ?? who.account.userId ?? "—"} mono />}
            </dl>
          </Card>

          <Card className="p-4">
            <div className="t-label text-ink-muted mb-2">Where they have been</div>
            {who.alsoIn.length === 0 ? (
              <p className="t-body text-ink-soft">Only this one, so far.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {who.alsoIn.map((elsewhere) => (
                  <li key={elsewhere.runId} className="flex items-baseline gap-2">
                    <span className="t-body text-ink-soft flex-1 truncate">{elsewhere.simulationName}</span>
                    <span className="t-meta text-ink-muted tabular-nums shrink-0">
                      execution {elsewhere.seq} · {elsewhere.visits} visits · {elsewhere.findings} filed
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            <div className="t-label text-ink-muted mb-2">How they are getting on</div>
            <p className="t-body text-ink-soft">
              {who.retiredReason === "gave-up"
                ? `They walked away at visit ${who.visits.length}${who.wouldReturn === true ? " and said a fix would bring them back" : who.wouldReturn === false ? " and said nothing would bring them back" : ""}.`
                : who.status === "active"
                  ? who.nextVisitAt === null
                    ? "Still with us, with no next visit booked."
                    : `Still with us; back ${ago(who.nextVisitAt)}.`
                  : "Done for now — they spent every visit they had."}
            </p>
            <p className="t-meta text-ink-muted mt-1.5 tabular-nums">
              {who.confirmed} of their {who.findings} reports confirmed · {usd(who.costUsd)} spent · last seen {who.lastVisitAt === null ? "never" : when(who.lastVisitAt)}
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="t-meta text-ink-muted w-24 shrink-0 truncate">{label}</dt>
      <dd className={`t-body text-ink-soft min-w-0 break-words ${mono ? "font-mono text-[12px]" : ""}`}>{value}</dd>
    </div>
  );
}

/** Inside a simulation: the person as they were in the execution these results are of. */
export function PersonInSimulation() {
  const { pid = "" } = useParams();
  const [params] = useSearchParams();
  const { simulation, href, runId } = useSimulation();
  // The execution the LINK came from, when it said — a problem the latest execution did not report
  // is read against the one that did, and its people are that execution's people. Falling back to
  // the simulation's latest is what the common path does, where the two are the same thing.
  const execution = params.get("execution") ?? runId;
  if (execution === null) return <Failed error={new Error("this simulation has never been run")} />;
  return <PersonPage runId={execution} pid={pid} linkTo={(path) => href(path)} trail={[{ label: simulation.name, to: href() }]} />;
}

/**
 * At project level: one person across every simulation.
 *
 * A durable person (`cohort#ordinal`) is not a row in any one execution, so the page is reached
 * by finding their most recent participation and reading it — the executions are walked newest
 * first and the walk stops at the first hit, which for the common case is one extra request. The
 * "where they have been" panel then carries the rest, because the server computes it.
 */
export function PersonAcrossProject() {
  const { personId = "" } = useParams();
  const { project, href } = useProject();
  // The project's ID, never the URL segment: `GET /runs?project=` filters on `runs.project_id`
  // exactly and resolves no slugs, so asking with the slug every link in this app carries answered
  // "no runs" for every project but the one whose id and slug happen to be the same word.
  const key = project.id;
  const runs = useQuery(q.runs(key));

  const found = useQuery({
    queryKey: ["person-lookup", key, personId] as const,
    enabled: runs.data !== undefined,
    queryFn: async (): Promise<{ runId: string; pid: string; simulationId: string } | null> => {
      const newestFirst = [...(runs.data?.items ?? [])].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "")).slice(0, 12);
      for (const run of newestFirst) {
        const people = await api.participants(run.id);
        const match = people.items.find((person) => person.personId === personId || person.id === personId);
        if (match) return { runId: run.id, pid: match.id, simulationId: run.simulationId };
      }
      return null;
    },
  });

  if (runs.isError) return <Failed error={runs.error} />;
  if (found.isPending) return <Loading what="this person" />;
  if (found.isError) return <Failed error={found.error} />;
  if (found.data === null)
    return (
      <>
        <Breadcrumb items={[{ label: "The people", to: href("library/people") }, { label: personId }]} />
        <Card className="p-4 mt-3">
          <Empty>Nobody by that name has been in an execution yet. They exist on a cohort's roster and will turn up here the first time they are sent.</Empty>
        </Card>
      </>
    );

  const base = `${href()}/s/${encodeURIComponent(found.data.simulationId)}`;
  return <PersonPage runId={found.data.runId} pid={found.data.pid} linkTo={(path) => `${base}/${path}`} trail={[{ label: "The people", to: href("library/people") }]} />;
}

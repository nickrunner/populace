import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";
import { api, isMissing, type ParticipantDetail, type RunSummary } from "../api.js";
import { q } from "../queries.js";
import { useProject, useSimulation } from "../context.jsx";
import { plural, wakeOutcome, when } from "../format.js";
import {
  Avatar,
  Button,
  Card,
  CardHeader,
  DataTable,
  Fact,
  FactList,
  Inline,
  Ledger,
  LedgerRow,
  Link,
  MetaLine,
  MetaSentence,
  Money,
  Mono,
  PageHeader,
  RelativeTime,
  RosterLattice,
  Section,
  SeverityStack,
  SeverityTag,
  Skeleton,
  Spacer,
  SplitPage,
  Stack,
  StateBlock,
  Text,
  VerdictTag,
  type Column,
  type Crumb,
  type LatticeDot,
  type MetaFact,
  type StateKind,
  type VerdictValue,
} from "../design/index.js";

/**
 * One person: who they are, what they are carrying between visits, and everywhere they have been.
 *
 * It is ONE request. The screen this replaces fired a memory query per head and re-polled it
 * every five seconds; `ParticipantDetailView` exists so that a person's whole page — identity,
 * traits, memory, visits, findings and their other simulations — arrives together (SPEC §6.2).
 *
 * **Ported to the design system** — ATOMIC-INVENTORY §6.3, row 17. `SplitPage ratio="narrow-right"`
 * is the sidecar split: the long column of what they did on the left, the steady column of who
 * they are on the right, sticky beside it and stacked above it below 1000px. What goes:
 *
 * - `grid-cols-[minmax(0,1fr)_minmax(0,22rem)]`, written by hand here and nowhere else in the
 *   product, for the template that owns that 22rem;
 * - the label/value track under "How they were made", which survived the port as a live
 *   `grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)]` on this page while the list above claimed the
 *   hand-written grids were gone, for the `FactList` molecule that now owns that measurement;
 * - the hand-rolled visit list — six `<span>`s with their own widths, `tabular-nums` spelled out
 *   twice and a `hover:bg-well` link row — for a `DataTable` whose columns are declared, whose
 *   outcome column is the one serif column, and which sheds its diagnostic column before it
 *   shrinks its type (§5.3);
 * - `text-[11px]` and `text-[12px]`, the two off-scale steps this screen invented, for `Mono`'s
 *   `code-sm` and the `meta` step;
 * - the four query branches that returned instead of rendering, for the template's state slots,
 *   so the header stays mounted and the page does not collapse to a line and jump back.
 *
 * **Their visits are drawn** (DESIGN-SYSTEM §1.2 M4). `RosterLattice` is the mark's own counting
 * instrument, and on a page about one person the only thing there is more than one of is their
 * visits — so a filled dot is a visit they made, a ring is the visit they walked away on, and a
 * hollow `provisional` dot is one of the visits their cap still allows. The sentence beside it
 * says the same thing in words, because a row of circles is not a reading on its own (§6).
 *
 * Nothing here says what the next execution will do. Executions are independent (ADR-0028).
 */

/** A person who walked away did so on their last visit; the rest are visits they made. */
function walkedAway(who: ParticipantDetail): boolean {
  return who.retiredReason === "gave-up";
}

/**
 * Their visits, in the mark's grammar: what happened, then what their cap still allows.
 *
 * `provisional` is the grammar's word for *this has not happened yet*, so the visits a cap leaves
 * them are drawn as unfilled cells rather than as an absence. A person who walked away has no
 * visits ahead of them whatever the cap says, which is why the tail is dropped for them — a
 * hollow dot there would promise a return nobody promised.
 */
function visitDots(who: ParticipantDetail): readonly LatticeDot[] {
  const last = who.visits.length - 1;
  const made: LatticeDot[] = who.visits.map((visit, index) => ({
    id: visit.id,
    state: walkedAway(who) && index === last ? "left" : "present",
    label: `visit ${String(visit.visitNumber)} — ${visit.summary || wakeOutcome(visit.status)}`,
  }));

  if (walkedAway(who) || who.maxVisits === null) return made;

  const ahead = Math.max(0, who.maxVisits - who.visits.length);
  return [
    ...made,
    ...Array.from({ length: ahead }, (_, index) => ({
      id: `ahead-${String(index)}`,
      state: "provisional" as const,
      label: "a visit they have not made yet",
    })),
  ];
}

/** The same count, in words. It is the lattice's accessible name and the line beneath it. */
function visitSentence(who: ParticipantDetail): string {
  const made = plural(who.visits.length, "visit");
  if (walkedAway(who)) return `${who.name} made ${made} and then walked away.`;
  if (who.maxVisits === null) return `${who.name} has made ${made} so far.`;
  return `${who.name} has made ${String(who.visits.length)} of ${String(who.maxVisits)} visits.`;
}

/** How they are getting on, as one word for the header. Never a colour on its own (§4.2). */
function standing(who: ParticipantDetail): string {
  if (walkedAway(who)) return "walked away";
  return who.status === "active" ? "still coming back" : "done for now";
}

/**
 * The visits table. The stub is the visit number — a locator, which is the only thing a stub
 * carries — and the outcome is the one serif column, because `wakeOutcome()`'s phrases and a
 * person's own summary line are sentences a reader scans down rather than values they compare.
 *
 * `toolCalls` is fetched by `VisitSummaryView` and was never rendered. It is diagnostic rather
 * than scanning data, so it is priority 3 and is the first column cut on a narrow page (§5.3).
 *
 * The outcome leads, because `rowHref` paints its overlay over the first cell and that cell is
 * therefore the link's accessible name: "opened three tasks and could not find the fourth" is a
 * name; a timestamp is not. For the same reason no cell here carries a link of its own.
 */
const VISIT_COLUMNS: Column<ParticipantDetail["visits"][number]>[] = [
  {
    key: "outcome",
    header: "What happened",
    sentence: true,
    cell: (visit) => visit.summary || wakeOutcome(visit.status),
  },
  {
    key: "started",
    header: "Started",
    priority: 2,
    cell: (visit) => (
      <Text size="ui" tone="muted">
        <RelativeTime at={visit.startedAt} mode="absolute" />
      </Text>
    ),
  },
  { key: "tools", header: "Tool calls", numeric: true, priority: 3, cell: (visit) => visit.toolCalls },
  { key: "filed", header: "Filed", numeric: true, cell: (visit) => visit.findings },
  {
    key: "cost",
    header: "Cost",
    numeric: true,
    cell: (visit) => <Money usd={visit.costUsd} precision={4} />,
  },
];

/**
 * The page itself, given a run and a participant in it. Both entry points render this: the one
 * inside a simulation, and the project-level one that resolves a durable person to their most
 * recent participation first.
 */
export function PersonPage({
  runId,
  pid,
  linkTo,
  trail,
}: {
  runId: string;
  pid: string;
  linkTo: (path: string) => string;
  trail: readonly Crumb[];
}) {
  const person = useQuery(q.participant(runId, pid));
  const who = person.data;

  const state: StateKind | undefined = person.isPending
    ? "loading"
    : person.isError
      ? isMissing(person.error)
        ? "gone"
        : "failed"
      : undefined;

  return (
    <SplitPage
      ratio="narrow-right"
      header={
        <PageHeader
          title={who?.name ?? "This person"}
          crumbs={[...trail, { label: who?.name ?? "This person" }]}
          lede={who === undefined ? undefined : who.details || who.role}
          meta={who === undefined ? undefined : identity(who)}
        />
      }
      state={state}
      loading={
        <StateBlock
          kind="loading"
          what="this person"
          skeleton={<Skeleton variant="row" count={5} label="Reading this person" />}
        />
      }
      error={
        // A failed read is the one state a reader can act on, so every failed state in the
        // product offers the read again (§6.5, rule 7).
        <StateBlock kind="failed" what="this person" error={person.error}>
          <Button
            variant="secondary"
            onClick={() => {
              void person.refetch();
            }}
          >
            Try again
          </Button>
        </StateBlock>
      }
      gone={
        <StateBlock kind="gone" what="this person">
          Nobody by that name went on this execution. They may have been on an earlier one, or
          joined a cohort after it ran.
        </StateBlock>
      }
      left={who === undefined ? null : <WhatTheyDid who={who} linkTo={linkTo} />}
      right={who === undefined ? null : <WhoTheyAre who={who} />}
    />
  );
}

/**
 * The two ids this page carries, in the seam's own face. An id is not a name (§4.3), so both stay
 * in mono and neither is ever the thing a heading says.
 *
 * **Each one is labelled** (§7.2, "where the id must be shown, it is labelled"). They were two
 * bare hash-like strings side by side on one line with nothing to tell them apart: one is the
 * person, who is the same individual in every execution, and the other is that person on THIS
 * execution, which is the id a visit row and a finding are keyed by. A reader copying the wrong
 * one gets a silent empty result, so the label is the whole difference between them.
 */
function labelledId(label: string, id: string): ReactNode {
  return (
    <Inline gap={1} align="baseline">
      <Text size="meta" tone="muted">
        {label}
      </Text>
      <Mono size="code-sm">{id}</Mono>
    </Inline>
  );
}

function identity(who: ParticipantDetail): readonly MetaFact[] {
  return [
    { key: "standing", node: standing(who) },
    { key: "person", node: labelledId("their id", who.personId) },
    { key: "participant", node: labelledId("their id on this execution", who.id) },
  ];
}

/** The long column: every visit they made, and everything they filed on one. */
function WhatTheyDid({ who, linkTo }: { who: ParticipantDetail; linkTo: (path: string) => string }) {
  return (
    <Stack gap={12}>
      <Section
        title="Their visits"
        trailing={
          who.maxVisits === null
            ? `${plural(who.visits.length, "visit")} so far`
            : `${String(who.visits.length)} of ${String(who.maxVisits)}`
        }
      >
        <Stack gap={6}>
          {who.visits.length === 0 ? null : (
            <Stack gap={2} align="start">
              <RosterLattice dots={visitDots(who)} sentence={visitSentence(who)} />
              <Text size="ui" tone="muted">
                {visitSentence(who)}
              </Text>
            </Stack>
          )}

          <DataTable<ParticipantDetail["visits"][number]>
            rows={who.visits}
            keyOf={(visit) => visit.id}
            stub={(visit) => visit.visitNumber}
            rowHref={(visit) => linkTo(`visits/${encodeURIComponent(visit.id)}`)}
            caption={`Every visit ${who.name} made on this execution`}
            empty="They have not been yet."
            columns={VISIT_COLUMNS}
          />
        </Stack>
      </Section>

      <Section title="What they filed" trailing={plural(who.findingsFiled.length, "report")}>
        {who.findingsFiled.length === 0 ? (
          <StateBlock kind="empty" what="what they filed">
            They have not filed anything. A person files only when something got in their way, so
            this is a reading about the product and not about them.
          </StateBlock>
        ) : (
          <Ledger>
            {who.findingsFiled.map((finding) => (
              <LedgerRow
                key={finding.id}
                stub={<SeverityStack level={finding.severity} />}
                to={linkTo(`f/${encodeURIComponent(finding.signature)}`)}
              >
                <Stack gap={2}>
                  <Inline gap={2} align="baseline" wrap>
                    <SeverityTag level={finding.severity} kind={finding.kind} />
                    <VerdictTag value={verdictOf(finding.verdict)} />
                    <Spacer />
                    <Text size="meta" tone="muted">
                      <RelativeTime at={finding.createdAt} />
                    </Text>
                  </Inline>
                  {/* A finding's title is the `finding` step wherever it is drawn (§3.2). It was
                      one step smaller here than on the two other screens that print it. */}
                  <Text size="finding" as="p">
                    {finding.title}
                  </Text>
                </Stack>
              </LedgerRow>
            ))}
          </Ledger>
        )}
      </Section>
    </Stack>
  );
}

/**
 * A verdict that has not been reached is a state of its own, not a blank (§4.2). `unchecked` is
 * the token layer's word for it and `VerdictTag` prints "not checked yet".
 */
function verdictOf(verdict: "confirmed" | "not-reproduced" | "inconclusive" | null): VerdictValue {
  return verdict ?? "unchecked";
}

/** The sidecar: who they are, what they carry, where else they have been, how it is going. */
function WhoTheyAre({ who }: { who: ParticipantDetail }) {
  return (
    <Stack gap={6}>
      <Card>
        <CardHeader
          title={
            <Inline gap={3} align="center">
              <Avatar name={who.name} size="lg" />
              <Stack gap={1}>
                <span>{who.cohortName || who.cohortSlug}</span>
                <Text size="meta" tone="muted">
                  {who.personaName}
                </Text>
              </Stack>
            </Inline>
          }
          level={2}
        />
        <HowTheyWereMade who={who} />
      </Card>

      <Memory who={who} />

      <Card>
        <CardHeader title="How they are getting on" level={2} />
        <Stack gap={2}>
          <Text size="read" tone="soft" as="p">
            {gettingOn(who)}
          </Text>
          <MetaSentence>
            <>
              {`${String(who.confirmed)} of their ${plural(who.findings, "report")} confirmed, `}
              <Money usd={who.costUsd} /> {"spent, last seen "}
              <RelativeTime at={who.lastVisitAt} />.
            </>
          </MetaSentence>
        </Stack>
      </Card>

      <Card>
        <CardHeader title="Where they have been" level={2} />
        {who.alsoIn.length === 0 ? (
          <Text size="read" tone="soft" as="p">
            Only this one, so far.
          </Text>
        ) : (
          <Ledger>
            {who.alsoIn.map((elsewhere) => (
              <LedgerRow
                key={elsewhere.runId}
                density="tight"
                stub={
                  <Text size="meta" tone="muted">
                    {elsewhere.seq}
                  </Text>
                }
              >
                <Stack gap={1}>
                  <Text size="ui" truncate>
                    {elsewhere.simulationName}
                  </Text>
                  <MetaLine
                    facts={[
                      { key: "visits", node: plural(elsewhere.visits, "visit") },
                      { key: "filed", node: `${String(elsewhere.findings)} filed` },
                    ]}
                  />
                </Stack>
              </LedgerRow>
            ))}
          </Ledger>
        )}
      </Card>
    </Stack>
  );
}

/** One sentence about where they stand. Never a promise about the next execution (ADR-0028). */
function gettingOn(who: ParticipantDetail): string {
  if (walkedAway(who)) {
    const said =
      who.wouldReturn === true
        ? " and said a fix would bring them back"
        : who.wouldReturn === false
          ? " and said nothing would bring them back"
          : "";
    return `They walked away at visit ${String(who.visits.length)}${said}.`;
  }
  if (who.status !== "active") return "Done for now — they spent every visit they had.";
  return who.nextVisitAt === null ? "Still with us, with no next visit booked." : "Still with us, and booked to come back.";
}

/**
 * How they were made: the persona's dials as this person got them.
 *
 * A description list, because that is what it is — the `Text` atom publishes `dt` and `dd` for
 * exactly this. The grid is two columns of the label and the value rather than eleven copies of
 * `flex items-baseline gap-3 w-24`, and the model and the account wear the machine's face (§4.7).
 */
function HowTheyWereMade({ who }: { who: ParticipantDetail }) {
  const account = who.account === null ? null : (who.account.email ?? who.account.userId);

  return (
    <FactList>
      <Fact label="Patience">{`${String(who.patience)} of 5`}</Fact>
      <Fact label="Would pay">
        {who.budgetUsd === 0 ? (
          "nothing — free only"
        ) : (
          <>
            <Money usd={who.budgetUsd} /> a month
          </>
        )}
      </Fact>
      {Object.entries(who.traits).map(([trait, value]) => (
        <Fact key={trait} label={trait}>
          {String(value)}
        </Fact>
      ))}
      <Fact label="Model">
        <Mono size="code-sm">{`${who.model} · ${who.effort}`}</Mono>
      </Fact>
      {account === null ? null : (
        <Fact label="Account">
          <Mono size="code-sm">{account}</Mono>
        </Fact>
      )}
    </FactList>
  );
}

/**
 * What they carry between visits — the four memory slices, each entry tagged with the visit it
 * was written on. The wire's field is `wake` because the row is; the reader is told "visit"
 * (ADR-0032, §7.2).
 */
function Memory({ who }: { who: ParticipantDetail }) {
  const slices: { title: string; entries: readonly { wake: number; text: string }[] }[] = [
    { title: "What they are waiting on", entries: who.memory.waitingOn },
    { title: "What annoyed them", entries: who.memory.annoyances },
    { title: "What they got done", entries: who.memory.done },
    { title: "Notes to themselves", entries: who.memory.notes },
  ];
  const written = slices.filter((slice) => slice.entries.length > 0);

  return (
    <Card>
      <CardHeader title="What they carry between visits" level={2} />
      {written.length === 0 ? (
        <StateBlock kind="empty" what="their memory">
          They have not written anything down yet.
        </StateBlock>
      ) : (
        <Stack gap={4}>
          {written.map((slice) => (
            <Stack key={slice.title} gap={1}>
              <Text size="label" tone="muted">
                {slice.title}
              </Text>
              <Stack as="ul" gap={1}>
                {slice.entries.map((entry, index) => (
                  <Text as="li" key={`${String(entry.wake)}-${String(index)}`} size="read-sm" tone="soft">
                    <Inline gap={2} align="baseline">
                      <span className="min-w-0 flex-1">{entry.text}</span>
                      <Text size="meta" tone="muted">
                        {`visit ${String(entry.wake)}`}
                      </Text>
                    </Inline>
                  </Text>
                ))}
              </Stack>
            </Stack>
          ))}
        </Stack>
      )}
    </Card>
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

  // Not a failure: a simulation nobody has pressed go on yet has no people in it, which is the
  // common state of a new simulation and is said in a sentence with a way on (§6.5).
  if (execution === null)
    return (
      <SplitPage
        ratio="narrow-right"
        header={
          <PageHeader
            title="This person"
            crumbs={[{ label: simulation.name, to: href() }, { label: "This person" }]}
          />
        }
        state="empty"
        empty={
          <StateBlock kind="empty" what="this person">
            <Stack gap={3} align="start">
              <span>
                {simulation.name} has not been run yet, so nobody has been anywhere. Send them in
                and this page fills with what they did.
              </span>
              <Button variant="secondary" asChild>
                <Link to={href("preflight")}>Before you send them</Link>
              </Button>
            </Stack>
          </StateBlock>
        }
        left={null}
        right={null}
      />
    );

  return (
    <PersonPage
      runId={execution}
      pid={pid}
      linkTo={(path) => href(path)}
      trail={[{ label: simulation.name, to: href() }]}
    />
  );
}

/**
 * The executions the project-level walk reads, in the order it reads them: newest first, and no
 * more than twelve. It is a function so the rows on screen and the requests behind them cannot
 * drift apart — the list a reader watches IS the list being walked.
 */
function walkOrder(items: readonly RunSummary[]): readonly RunSummary[] {
  return [...items].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "")).slice(0, 12);
}

/**
 * The walk, rendered as it happens rather than as one promise.
 *
 * A durable person belongs to no single execution, so finding them means asking each one in turn.
 * That is a wait with structure in it, and structure is worth drawing: the executions already
 * asked say so, the one being read says so, and the rest are visibly still to come. Nothing here
 * predicts where they will be found — an execution that has not answered has not said anything.
 */
function TheWalk({ executions, checked }: { executions: readonly RunSummary[]; checked: number }) {
  if (executions.length === 0) return null;

  return (
    <Ledger as="ol" stubLabel="execution">
      {executions.map((run, index) => (
        <LedgerRow key={run.id} density="tight" stub={index + 1}>
          <Inline gap={3} align="baseline" wrap>
            <Text size="ui" tone={index < checked ? "muted" : "ink"} truncate>
              {run.label || (run.startedAt === null ? "never started" : when(run.startedAt))}
            </Text>
            <Spacer />
            <Text size="meta" tone="muted">
              {index < checked
                ? "they were not in this one"
                : index === checked
                  ? "reading it now"
                  : "not read yet"}
            </Text>
          </Inline>
        </LedgerRow>
      ))}
    </Ledger>
  );
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

  /**
   * How far the walk has got. §6.3 row 17 asked this screen for a skeleton AND a progressive
   * list, and the port shipped only the skeleton — so up to twelve serial requests still sat
   * behind one line that looked identical whether it was on its second execution or stuck.
   *
   * **The fetching is untouched**: the same executions, the same order, the same twelve, one at a
   * time, stopping at the first hit. `walkOrder` is that list named rather than recomputed, so
   * the rows the reader watches are the requests actually being made; the only thing added inside
   * the loop is this counter saying which of them have come back.
   */
  const [checked, setChecked] = useState(0);
  const order = walkOrder(runs.data?.items ?? []);

  const found = useQuery({
    queryKey: ["person-lookup", key, personId] as const,
    enabled: runs.data !== undefined,
    queryFn: async (): Promise<{ runId: string; pid: string; simulationId: string } | null> => {
      const newestFirst = walkOrder(runs.data?.items ?? []);
      setChecked(0);
      for (const run of newestFirst) {
        const people = await api.participants(run.id);
        const match = people.items.find((person) => person.personId === personId || person.id === personId);
        if (match) return { runId: run.id, pid: match.id, simulationId: run.simulationId };
        setChecked((done) => done + 1);
      }
      return null;
    },
  });

  const trail: readonly Crumb[] = [{ label: "The people", to: href("library/people") }];

  const state: StateKind | undefined = runs.isError || found.isError
    ? "failed"
    : found.isPending
      ? "loading"
      : found.data === null
        ? "empty"
        : undefined;

  if (state !== undefined)
    return (
      <SplitPage
        ratio="narrow-right"
        header={<PageHeader title={personId} crumbs={[...trail, { label: personId }]} />}
        state={state}
        loading={
          <StateBlock
            kind="loading"
            what="this person"
            skeleton={
              <Stack gap={6} align="stretch">
                <Skeleton variant="row" count={5} label="Looking for this person" />
                <TheWalk executions={order} checked={checked} />
              </Stack>
            }
          />
        }
        error={
          // A failed read is the one state a reader can act on (§6.5, rule 7). Both reads go
          // back: the walk depends on the list of executions, so retrying it alone would ask
          // the same twelve questions of nothing.
          <StateBlock kind="failed" what="this person" error={runs.error ?? found.error}>
            <Button
              variant="secondary"
              onClick={() => {
                void runs.refetch();
                void found.refetch();
              }}
            >
              Try again
            </Button>
          </StateBlock>
        }
        empty={
          <StateBlock kind="empty" what="this person">
            <Stack gap={3} align="start">
              <span>
                Nobody by that name has been in an execution yet. They exist on a cohort&rsquo;s
                roster and will turn up here the first time they are sent.
              </span>
              <Button variant="secondary" asChild>
                <Link to={href("library/people")}>Back to the people</Link>
              </Button>
            </Stack>
          </StateBlock>
        }
        left={null}
        right={null}
      />
    );

  const base = `${href()}/s/${encodeURIComponent(found.data?.simulationId ?? "")}`;
  return (
    <PersonPage
      runId={found.data?.runId ?? ""}
      pid={found.data?.pid ?? ""}
      linkTo={(path) => `${base}/${path}`}
      trail={trail}
    />
  );
}

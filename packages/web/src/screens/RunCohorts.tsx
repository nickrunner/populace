import { useQuery } from "@tanstack/react-query";

import type { Participant, RunCohort } from "../api.js";
import { useSimulation } from "../context.jsx";
import { people, plural } from "../format.js";
import { q } from "../queries.js";
import {
  Button,
  Card,
  CohortCapsule,
  DataTable,
  Disclosure,
  Inline,
  InstrumentPage,
  Link,
  MetaLine,
  Money,
  PageHeader,
  PersonLink,
  RelativeTime,
  RosterLattice,
  Section,
  Skeleton,
  Spacer,
  Stack,
  StateBlock,
  Text,
  type Column,
  type LatticeDot,
  type MetaFact,
  type StateKind,
} from "../design/index.js";

/**
 * Who went, by cohort.
 *
 * This screen used to be a card per participant with a memory panel inside it, and the panel
 * fired its own request — one memory read per head, re-polled every five seconds. Three requests
 * serve the whole page now, none of them per head: the cohort roll-up, the participant list, and
 * this execution's findings, which is where the worst-problem link gets a title to say instead of
 * a hash. A person's memory lives on their own page, where asking for it is one request for one
 * person (SPEC §6.2).
 *
 * Instrument-class (DESIGN-SYSTEM §5.3): full page width, 32px rows, `t-ui` chrome, and the stub
 * tabulated as each table's leading column. It is also the first screen to draw the mark grammar
 * at population scale (§1.2 M4) — the execution as one `RosterLattice`, then a column of
 * `CohortCapsule`s, each a stadium whose length IS its headcount and whose fill is the people
 * inside it. That is why there is no bar chart here: the bar is the people.
 *
 * Nothing on this page says what the next execution will do. Executions are independent
 * (ADR-0028), so a roster is a record of who went that time and of nothing else.
 */
export function RunCohorts({ runId }: { runId: string }) {
  const { href } = useSimulation();
  const cohorts = useQuery(q.runCohorts(runId));
  const participants = useQuery(q.participants(runId));
  /*
    A third request, and it buys one thing: the roll-up carries the signature of the worst problem
    a cohort ran into and nothing else, and a signature is a hash. §4.3's rule is that an id is
    never the thing a reader is asked to read, so the title is looked up here — from the findings
    this execution actually filed, which is where the signature came from — and the hash stays
    where it belongs, as the link's target. The page renders without it: an unanswered or
    unmatched lookup gives the link a phrase instead, never a hash.
  */
  const filed = useQuery(q.findings(runId));

  const cohortItems = cohorts.data?.items;
  const roster = participants.data?.items;
  const titles = new Map((filed.data?.items ?? []).map((finding) => [finding.signature, finding.title]));

  const state: StateKind | undefined =
    cohorts.isError || participants.isError
      ? "failed"
      : cohortItems === undefined || roster === undefined
        ? "loading"
        : cohortItems.length === 0
          ? "empty"
          : undefined;

  return (
    <InstrumentPage
      header={
        <PageHeader
          title="Population"
          lede="The people this execution sent, grouped by cohort. Open one to see who is in it; open a person to see what they are carrying between visits."
          meta={cohortItems === undefined ? undefined : totals(cohortItems)}
        />
      }
      state={state}
      loading={
        <StateBlock
          kind="loading"
          what="the population"
          skeleton={<Skeleton variant="row" count={4} height={96} label="Reading the population" />}
        />
      }
      error={
        <StateBlock
          kind="failed"
          what="the population"
          error={cohorts.error ?? participants.error}
        >
          <Button
            variant="secondary"
            onClick={() => {
              void cohorts.refetch();
              void participants.refetch();
            }}
          >
            Try again
          </Button>
        </StateBlock>
      }
      empty={
        // Bare, like the other sixteen ported screens: `Card tone="sunk"` is reserved for the
        // quiet aside (§3, organism 1), and a state block is the page's own subject here, not
        // an aside beside it.
        <StateBlock kind="empty" what="this execution's population">
          Nobody went on this execution.
        </StateBlock>
      }
    >
      {cohortItems === undefined || roster === undefined ? null : (
        <Stack gap={8} align="stretch">
          <Everyone roster={roster} />

          <Section
            title="By cohort"
            trailing={plural(cohortItems.length, "cohort")}
          >
            {cohortItems.map((cohort) => (
              <CohortBand
                key={cohort.cohortSlug}
                cohort={cohort}
                members={roster.filter((person) => person.cohortSlug === cohort.cohortSlug)}
                runId={runId}
                href={href}
                titles={titles}
              />
            ))}
          </Section>
        </Stack>
      )}
    </InstrumentPage>
  );
}

/**
 * The whole execution as one lattice: one circle is one person, a ring is somebody who walked
 * away. The sentence beside it is the same sentence the lattice carries as its accessible name,
 * because a picture of twelve circles is not a reading on its own (§6).
 */
function Everyone({ roster }: { roster: readonly Participant[] }) {
  const left = roster.filter(walkedAway).length;
  const sentence =
    left === 0
      ? `${people(roster.length)} went on this execution.`
      : `${people(roster.length)} went on this execution, and ${left} walked away.`;

  return (
    <Stack gap={2} align="start">
      <RosterLattice dots={roster.map(dotFor)} sentence={sentence} />
      <Text size="ui" tone="muted">
        {sentence}
      </Text>
    </Stack>
  );
}

/**
 * One cohort: the capsule that says how many of them there were, the roll-up's own phrase, the
 * facts, and — folded away until it is asked for — everyone in it by name.
 *
 * The fold is per cohort rather than one-at-a-time. Two cohorts on one persona is the thing the
 * population model exists for, and comparing them meant closing one to read the other.
 */
function CohortBand({
  cohort,
  members,
  runId,
  href,
  titles,
}: {
  cohort: RunCohort;
  members: readonly Participant[];
  runId: string;
  href: (path?: string) => string;
  /** Signature → the problem's title, for the one fact that would otherwise read as a hash. */
  titles: ReadonlyMap<string, string>;
}) {
  const execution = `?execution=${encodeURIComponent(runId)}`;
  // The stub is a locator and nothing else: where this person sits in the cohort's own list.
  const position = new Map(members.map((person, index) => [person.id, index + 1]));

  const columns: Column<Participant>[] = [
    {
      key: "person",
      header: "Person",
      cell: (person) => (
        <PersonLink
          size="sm"
          name={person.name}
          to={href(`people/${encodeURIComponent(person.id)}${execution}`)}
        />
      ),
    },
    {
      key: "visits",
      header: "Visits",
      cell: (person) => (
        <Link size="ui" to={href(`visits?participant=${encodeURIComponent(person.id)}`)}>
          {plural(person.visits, "visit")}
        </Link>
      ),
    },
    { key: "filed", header: "Filed", numeric: true, cell: (person) => person.findings },
    {
      key: "confirmed",
      header: "Confirmed",
      numeric: true,
      priority: 3,
      cell: (person) => person.confirmed,
    },
    {
      // The one serif column (§5.3): these are phrases a reader scans down, not values.
      key: "where",
      header: "Where they are",
      sentence: true,
      cell: (person) =>
        // `muted` is the system's ink for a person who walked away — the token `Dot`'s `left`
        // state is drawn in (§8.6). §4.1 keeps `critical` for severity 4, errors and destructive
        // acts; somebody deciding this app is not for them is a signal, not an error.
        walkedAway(person) ? (
          <Text size="read-sm" tone="muted">
            {`left at visit ${person.visits}`}
          </Text>
        ) : (
          <Text size="read-sm" tone="soft">
            {person.status === "active" ? "still coming back" : "done for now"}
          </Text>
        ),
    },
    {
      key: "last-visit",
      header: "Last visit",
      priority: 2,
      cell: (person) => (
        <Text size="ui" tone="muted">
          <RelativeTime at={person.lastVisitAt} />
        </Text>
      ),
    },
  ];

  return (
    <Card level="flat" pad="roomy">
      <Stack gap={3} align="stretch">
        <Inline gap={3} align="center" wrap>
          <CohortCapsule name={cohort.name} dots={members.map(dotFor)} total={cohort.people} />
          <Spacer />
          <Text size="ui" tone="soft">
            {cohort.headline}
          </Text>
        </Inline>

        <MetaLine facts={factsFor(cohort, href, titles)} />

        <Disclosure label={`Who is in ${cohort.name}`} count={members.length}>
          <DataTable<Participant>
            rows={members}
            keyOf={(person) => person.id}
            stub={(person) => position.get(person.id)}
            caption={`Everyone in ${cohort.name} on this execution`}
            empty="Nobody went from this cohort."
            columns={columns}
          />
        </Disclosure>
      </Stack>
    </Card>
  );
}

/** A person who gave up is a person who is not there any more — a ring, in the mark's grammar. */
function walkedAway(person: Participant): boolean {
  return person.retiredReason === "gave-up";
}

function dotFor(person: Participant): LatticeDot {
  return walkedAway(person)
    ? {
        id: person.id,
        state: "left",
        label: `${person.name} — walked away at visit ${person.visits}`,
      }
    : { id: person.id, state: "present", label: `${person.name} — ${plural(person.visits, "visit")}` };
}

/**
 * What one cohort did, in facts. The worst thing it ran into is the one link among them.
 *
 * **The link says what the problem is; the signature is only where it goes.** The roll-up sends a
 * signature, which is a hash, and a hash is an id — §4.3 keeps ids in mono and out of the place a
 * sentence belongs. So the title is what is rendered, and where no title has been read back yet
 * the link falls back to a phrase rather than to the hash it is addressed by.
 */
function factsFor(
  cohort: RunCohort,
  href: (path?: string) => string,
  titles: ReadonlyMap<string, string>,
): readonly MetaFact[] {
  return [
    { key: "persona", node: cohort.personaName },
    { key: "visits", node: plural(cohort.visits, "visit") },
    { key: "filed", node: `${cohort.findings} filed, ${cohort.confirmed} confirmed` },
    {
      key: "left",
      node:
        cohort.gaveUp === 0 ? null : (
          <Text size="meta" tone="muted">
            {`${cohort.gaveUp} walked away`}
          </Text>
        ),
    },
    { key: "still", node: `${cohort.stillActive} still coming back` },
    { key: "cost", node: <Money usd={cohort.costUsd} /> },
    {
      key: "worst",
      node:
        cohort.worstSignature === null ? null : (
          <>
            {"worst they hit "}
            <Link size="meta" to={href(`f/${encodeURIComponent(cohort.worstSignature)}`)}>
              {titles.get(cohort.worstSignature) ?? "the worst thing they ran into"}
            </Link>
          </>
        ),
    },
  ];
}

/** The execution's own totals, on the header's fact line. */
function totals(cohorts: readonly RunCohort[]): readonly MetaFact[] {
  const sum = (pick: (cohort: RunCohort) => number): number =>
    cohorts.reduce((total, cohort) => total + pick(cohort), 0);

  return [
    { key: "people", node: people(sum((cohort) => cohort.people)) },
    { key: "cohorts", node: plural(cohorts.length, "cohort") },
    { key: "visits", node: plural(sum((cohort) => cohort.visits), "visit") },
    { key: "filed", node: plural(sum((cohort) => cohort.findings), "finding") },
    { key: "cost", node: <Money usd={sum((cohort) => cohort.costUsd)} /> },
  ];
}

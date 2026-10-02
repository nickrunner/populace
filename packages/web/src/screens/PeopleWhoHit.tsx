import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { isMissing, type Participant } from "../api.js";
import { q } from "../queries.js";
import { useProject, useStudy } from "../context.jsx";
import { people } from "../format.js";
import {
  Button,
  DataTable,
  InstrumentPage,
  Link,
  Mono,
  PageHeader,
  PersonLink,
  RosterLattice,
  Skeleton,
  Stack,
  StateBlock,
  Text,
  type Column,
  type Crumb,
  type LatticeDot,
  type StateKind,
} from "../design/index.js";

/**
 * The first screen that is only people. It is reached by asking for it — SPEC §7.4's "you had to
 * ask" — which is why a name is informative here rather than clutter on the screen above.
 *
 * Instrument-class (DESIGN-SYSTEM §5.3): the full page width, 32px rows, `t-ui` chrome, and the
 * stub tabulated as the leading column. The roster is drawn once above the table — the lattice is
 * the n-of-N sentence as a picture, and it is forbidden inside a cell, so it sits above one.
 */
export function PeopleWhoHit() {
  const { key } = useProject();
  const { key: studyKey, href } = useStudy();
  const { signature = "" } = useParams();
  const cluster = useQuery(q.cluster(key, studyKey, signature));

  const card = cluster.data;

  // The trail is the same whether or not the problem arrived: without it, a reader waiting on a
  // slow answer has no way back up. The finding's own crumb appears once there is a title to name
  // it with.
  const crumbs: Crumb[] = [
    { label: "Results", to: href() },
    ...(card === undefined
      ? []
      : [{ label: card.title, to: href(`f/${encodeURIComponent(signature)}`) }]),
    { label: "Everyone who hit it" },
  ];

  if (card === undefined) {
    const state: StateKind = cluster.isPending
      ? "loading"
      : isMissing(cluster.error)
        ? "gone"
        : "failed";

    return (
      <InstrumentPage
        header={<PageHeader title="Everyone who hit it" crumbs={crumbs} />}
        state={state}
        loading={
          <StateBlock
            kind="loading"
            what="everyone who hit it"
            skeleton={
              <Skeleton variant="row" count={8} label="Reading everyone who hit it" />
            }
          />
        }
        gone={
          <StateBlock kind="gone" what="this problem">
            No problem in this study carries that signature. The link may be from another
            study. <Link to={href()}>Open the results</Link> to see what is there.
          </StateBlock>
        }
        error={
          // A failed read is the one state the reader can act on, so every failed state in the
          // product offers the read again (§6.5, rule 7).
          <StateBlock kind="failed" what="everyone who hit it" error={cluster.error}>
            <Button
              variant="secondary"
              onClick={() => {
                void cluster.refetch();
              }}
            >
              Try again
            </Button>
          </StateBlock>
        }
      >
        {null}
      </InstrumentPage>
    );
  }

  // Which visit each of them filed it on, from the quotes. A person who hit it twice is listed
  // once, on the visit they first said something about it.
  const filedOn = new Map(card.quotes.map((quote) => [quote.personId, quote]));
  // Everyone here is a person AS THEY WERE IN THE EXECUTION THAT REPORTED THIS, which for a problem
  // the latest execution did not report is an earlier one. Their page is told which, because the
  // ids repeat across executions and it would otherwise read somebody else's execution quite
  // happily.
  const execution = `?execution=${encodeURIComponent(card.representative.runId)}`;
  // The stub is a locator and nothing else: where this row sits in the list.
  const position = new Map(card.peopleHit.map((person, index) => [person.id, index + 1]));

  /**
   * **The denominator is this page's own two lists, and since ADR-0045 that is no longer a
   * divergence from the card — it is the same number arrived at the same way.**
   *
   * Both halves are now scoped to one REPORT WINDOW. `peopleHit` and `peopleMissed` are the people
   * of the window that reported this problem, and `ClusterCardView.peopleTotal` is that window's
   * census (its visitors, unioned with its reporters) rather than the newest execution's roster —
   * `project-read-model.ts` builds the pair from one `windowCensus`, and a test asserts
   * `peopleHit + Σ peopleMissed === card.peopleTotal`. So the sentence and the lattice beside it
   * cannot disagree, which is what the earlier version of this comment was written to explain
   * away.
   *
   * It is still summed locally rather than read off the card, because the LATTICE is drawn from
   * these two lists: a denominator taken from anywhere else could drift from the dots it counts,
   * and that drift is exactly the class of defect ADR-0045's window scoping kept producing.
   *
   * What has not changed: for a problem the newest window did not report, these rows are the
   * people of an earlier window, and the number moving is an absence rather than a repair
   * (ADR-0028). Nothing here says anything was fixed.
   */
  const missed = card.peopleMissed.reduce((total, cohort) => total + cohort.count, 0);
  const roster = card.peopleHit.length + missed;
  const sentence = `${card.peopleHit.length} of ${people(roster)} who went ran into this.`;

  const dots: LatticeDot[] = [
    ...card.peopleHit.map((person) => ({
      id: person.id,
      state: "present" as const,
      label: `${person.name} — ${person.cohortName || person.cohortSlug}`,
    })),
    ...card.peopleMissed.flatMap((cohort) =>
      Array.from({ length: cohort.count }, (_unused, index) => ({
        id: `${cohort.cohortSlug}#missed-${index}`,
        state: "absent" as const,
        label: `Someone in ${cohort.name} who did not report it`,
      })),
    ),
  ];

  const columns: Column<Participant>[] = [
    {
      key: "person",
      header: "Person",
      cell: (person) => (
        <PersonLink
          size="sm"
          name={person.name}
          cohort={person.cohortName || person.cohortSlug}
          to={href(`people/${encodeURIComponent(person.id)}${execution}`)}
        />
      ),
    },
    {
      key: "persona",
      header: "Persona",
      priority: 3,
      cell: (person) => (
        <Text size="ui" tone="muted">
          {person.personaName}
        </Text>
      ),
    },
    {
      key: "said-it-on",
      header: "Said it on",
      cell: (person) => {
        const quote = filedOn.get(person.personId);
        return quote === undefined ? (
          <Text size="ui" tone="muted">
            —
          </Text>
        ) : (
          <Link size="ui" to={href(`visits/${encodeURIComponent(quote.wakeId)}`)}>
            {`visit ${quote.visitNumber}`}
          </Link>
        );
      },
    },
    { key: "visits", header: "Visits", numeric: true, cell: (person) => person.visits },
    { key: "filed", header: "Filed", numeric: true, cell: (person) => person.findings },
    {
      // The one serif column (§5.3): these are phrases a reader scans down, not values.
      key: "since",
      header: "Since",
      sentence: true,
      cell: (person) =>
        // `muted` is the system's ink for a person who walked away — the same token `Dot`'s
        // `left` state is drawn in (§8.6). `critical` is reserved for severity 4, errors and
        // destructive acts (§4.1); a person leaving is a signal, not an error.
        person.retiredReason === "gave-up" ? (
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
      key: "person-id",
      header: "Person id",
      priority: 3,
      cell: (person) => <Mono size="code-sm">{person.personId}</Mono>,
    },
  ];

  return (
    <InstrumentPage
      header={
        <PageHeader
          title="Everyone who hit it"
          crumbs={crumbs}
          lede="Open one to see what they were carrying between visits, or open the visit to watch it happen."
        />
      }
    >
      <Stack gap={6} align="stretch">
        {/* The n-of-N text the lattice's own sentence needs beside it (§6). */}
        <Stack gap={2} align="start">
          <RosterLattice dots={dots} sentence={sentence} />
          <Text size="ui" tone="muted">
            {sentence}
          </Text>
        </Stack>

        <DataTable<Participant>
          rows={card.peopleHit}
          keyOf={(person) => person.id}
          stub={(person) => position.get(person.id)}
          caption="Everyone who hit this problem"
          empty="Nobody reported this in the window these results are of."
          columns={columns}
        />
      </Stack>
    </InstrumentPage>
  );
}

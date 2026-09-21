import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import type { Wake } from "../api.js";
import { useSimulation } from "../context.jsx";
import { clock, plural, wakeOutcome } from "../format.js";
import { q } from "../queries.js";
import {
  Button,
  DataTable,
  FilterChips,
  InstrumentPage,
  Link,
  MetaLine,
  Money,
  Mono,
  PageHeader,
  PersonLink,
  Skeleton,
  Stack,
  StateBlock,
  Text,
  VisuallyHidden,
  type Column,
  type Crumb,
  type FilterOption,
  type MetaFact,
  type StateKind,
  type TextTone,
} from "../design/index.js";

/**
 * Every visit anybody made, newest first — the question is nearly always "what just happened".
 *
 * A row is labelled by the PERSON and their cohort, not by the persona: two cohorts may share a
 * persona, and "Power user, visit 3" three times over says nothing about who it was. Where the
 * roster has no name for somebody the row falls back to their id in evidence ink, which is at
 * least the thing you can paste somewhere — never to the persona they were cast from.
 *
 * Instrument-class (DESIGN-SYSTEM §5.3), and the screen that sets the width: nine columns plus a
 * 72px stub does not fit, so the diagnostic pair — turns and tokens — leaves the table for the
 * row's own expandable detail, and seven columns remain. The outcome column is the one serif
 * column, because `wakeOutcome()`'s phrases are sentences a reader scans down rather than values.
 *
 * **The stub is the visit's number and the detail is a real disclosure** (§6.3 row 11). Both were
 * one thing before: a `Popover` hung off a `Button` in the ledger stub, which put a control where
 * §1.2 M2 allows only a locator and left the start time — the thing a log is scanned by — to a
 * press. The number is the stub, the time is a column and the link into the transcript, and the
 * figures fold out under the row at the table's full width.
 *
 * This screen gets no marked number and no "the one" dot (§5.4): a log of everything has no single
 * answer in it.
 */

/**
 * How an outcome is inked. Every value is a token through `Text`'s own tone union — there is no
 * hex and no `text-*` string here — and `satisfies` is what makes a new outcome a compile error
 * rather than a silently grey row.
 *
 * Two of these were wrong about what the colour means (§4.1), and the port review caught both.
 * `done` was `confirmed`, which is *"a judge replayed it and it reproduced"* and "may never be a
 * generic 'good', a success toast, **a done tick**" — this was precisely the forbidden done tick.
 * A visit that ran to the end is the unremarkable case, so it takes `soft` and the phrase in the
 * serif column carries it. `gave-up` was `critical`, which §4.1 allows only for severity 4,
 * errors and destructive acts: a person walking away is a signal, not an error, and the system
 * already has an ink for it — `Dot`'s `left` state is a filled `ink-muted` circle, *a person who
 * walked away* (§8.6). `muted` here is that same token, so the word in the row and the dot on
 * `Who walked away` are one reading. `killed` keeps `muted` too: both are a visit that stopped
 * early without anything being wrong with the product, and the word in the outcome column is
 * what tells them apart (§4.2).
 */
const OUTCOME_TONE = {
  running: "ink",
  done: "soft",
  "gave-up": "muted",
  "max-turns": "high",
  "budget-exceeded": "high",
  killed: "muted",
  "auth-failed": "critical",
  error: "critical",
} satisfies Record<Wake["status"], TextTone>;

/** Long ledgers are paged rather than rendered entire (§3, organism 5). */
const PAGE_SIZE = 25;

export function Visits({ runId }: { runId: string }) {
  const [params] = useSearchParams();
  const only = params.get("participant");
  const [status, setStatus] = useState<Wake["status"] | "all">("all");
  const [page, setPage] = useState(1);

  /**
   * The page number belongs to the list it was chosen on, and there are two filters narrowing
   * that list: the status chips, which reset it where they are set, and `?participant=`, which
   * is a URL parameter and changes under a mounted screen — a person link from one person's page
   * to another's. Without this, moving from page 3 of A's visits to B's leaves the reader on page
   * 3 of a list that may have one page, looking at "no visits ended that way" for a filter they
   * did not set. Adjusting state during the render is React's own answer to a prop changing;
   * the alternative — an effect — paints the wrong page first and then corrects it.
   */
  const [pagedFor, setPagedFor] = useState<string | null>(only);
  if (pagedFor !== only) {
    setPagedFor(only);
    setPage(1);
  }

  const { href } = useSimulation();
  const visitLog = useQuery(q.wakes(runId));
  const participants = useQuery(q.participants(runId));

  // Both, or the screen reads "Reading the visits…" for ever on the one that failed: the roster is
  // a second request and a swept or missing execution answers it with a 404.
  const failed = visitLog.isError || participants.isError;
  const visitData = visitLog.data;
  const participantData = participants.data;

  const who = new Map((participantData?.items ?? []).map((person) => [person.id, person]));
  const all = [...(visitData?.items ?? [])]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .filter((visit) => only === null || visit.agentId === only);
  const shown = status === "all" ? all : all.filter((visit) => visit.status === status);
  const outcomes = [...new Set(all.map((visit) => visit.status))];
  const calls = all.reduce((sum, visit) => sum + visit.toolCalls, 0);
  const cost = all.reduce((sum, visit) => sum + visit.costUsd, 0);
  // `only` is what filters the log; `name` only labels the filter. The two are not the same
  // question, and collapsing them is how this screen came to print the unfiltered lede over a
  // list of one person's visits: a person who is not on this execution's roster — swept, or
  // carried forward — has no name here, and the list is filtered all the same. So every sentence
  // branches on `only`, and `whose` is what it calls them.
  const name = only === null ? null : (who.get(only)?.name ?? null);
  const whose = name ?? "one person";

  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const state: StateKind | undefined = failed
    ? "failed"
    : visitData === undefined || participantData === undefined
      ? "loading"
      : undefined;

  // One person's visits are reached from their page or their cohort, so the way back up is the
  // whole log — the trail carries it rather than a second link under the lede.
  const crumbs: Crumb[] =
    only === null
      ? []
      : [{ label: "Visits", to: href("visits") }, { label: name ?? "One person's visits" }];

  const options: FilterOption<Wake["status"]>[] = outcomes.map((outcome) => ({
    value: outcome,
    label: wakeOutcome(outcome),
    count: all.filter((visit) => visit.status === outcome).length,
  }));

  const summary: MetaFact[] = [
    { key: "visits", node: plural(all.length, "visit") },
    { key: "calls", node: plural(calls, "call") },
    { key: "cost", node: <Money usd={cost} precision={4} /> },
  ];

  const columns: Column<Wake>[] = [
    {
      key: "person",
      header: "Person",
      cell: (visit) => {
        const person = who.get(visit.agentId);
        return person === undefined ? (
          <Mono size="code-sm">{visit.agentId}</Mono>
        ) : (
          <PersonLink
            size="sm"
            name={person.name}
            to={href(
              `people/${encodeURIComponent(person.id)}?execution=${encodeURIComponent(runId)}`,
            )}
          />
        );
      },
    },
    {
      key: "cohort",
      header: "Cohort",
      priority: 3,
      cell: (visit) => {
        const person = who.get(visit.agentId);
        return (
          <Text size="ui" tone="muted" truncate>
            {person === undefined ? "—" : person.cohortName || person.cohortSlug}
          </Text>
        );
      },
    },
    {
      /*
        The way in. The visit's number is the stub now — it is the row's locator and §1.2 M2
        gives the stub locators and nothing else — so the column it used to occupy carries the
        clock time it displaced, and the time is the link. The visible text is a time because
        that is what a reader scans a log by; the name a screen reader gets is the whole errand,
        because "14:32" is not one.
      */
      key: "started",
      header: "Started",
      cell: (visit) => (
        <Link size="ui" to={href(`visits/${encodeURIComponent(visit.id)}`)}>
          {clock(visit.startedAt)}
          <VisuallyHidden> — watch visit {visit.wakeNumber} call by call</VisuallyHidden>
        </Link>
      ),
    },
    {
      // The one serif column (§5.3): `wakeOutcome()` writes phrases, and phrases are read down.
      key: "outcome",
      header: "How it ended",
      sentence: true,
      cell: (visit) => (
        <Text size="read-sm" tone={OUTCOME_TONE[visit.status]}>
          {wakeOutcome(visit.status)}
        </Text>
      ),
    },
    {
      key: "calls",
      header: "Calls",
      numeric: true,
      priority: 3,
      cell: (visit) => visit.toolCalls,
    },
    { key: "found", header: "Found", numeric: true, cell: (visit) => visit.findingCount },
    {
      key: "cost",
      header: "Cost",
      numeric: true,
      cell: (visit) => <Money usd={visit.costUsd} precision={4} />,
    },
  ];

  return (
    <InstrumentPage
      header={
        <PageHeader
          title="Visits"
          crumbs={crumbs}
          lede={
            only === null
              ? "Every visit anyone made in this execution, newest first. Open one to watch it happen call by call."
              : `Every visit ${whose} made, newest first.`
          }
        />
      }
      toolbar={
        state !== undefined ? undefined : (
          <FilterChips<Wake["status"]>
            options={options}
            value={status}
            onChange={(next) => {
              setStatus(next);
              setPage(1);
            }}
            allLabel="All"
            allCount={all.length}
            legend="How the visit ended"
            trailing={<MetaLine facts={summary} />}
          />
        )
      }
      state={state}
      loading={
        <StateBlock
          kind="loading"
          what="the visits"
          skeleton={<Skeleton variant="row" count={10} label="Reading the visits" />}
        />
      }
      error={
        <StateBlock kind="failed" what="the visits" error={visitLog.error ?? participants.error}>
          <Button
            variant="secondary"
            onClick={() => {
              void visitLog.refetch();
              void participants.refetch();
            }}
          >
            Try again
          </Button>
        </StateBlock>
      }
    >
      <Stack gap={3} align="stretch">
        <DataTable<Wake>
          rows={rows}
          keyOf={(visit) => visit.id}
          /*
            A bare number, which is what makes it a position rather than a mark: the visit's own
            sequence, the same locator `Person` puts in the same column on the same rows.
          */
          stub={(visit) => visit.wakeNumber}
          stubLabel="Visit"
          /*
            §6.3 row 11: the diagnostic pair leaves the table for the row's own detail. It was a
            `Popover` hung off the locator, which put a control in the ledger stub — the one
            thing a stub may never hold — and gave the table an eighth column's worth of
            figures in a 32px cell. `DataTable` has a real disclosure now, so the figures fold
            out under the row they belong to, at the table's full width.
          */
          detail={(visit) => <VisitDetail visit={visit} />}
          detailLabel={(visit) => `Visit ${String(visit.wakeNumber)} in detail`}
          caption={
            only === null ? "Every visit in this execution" : `Every visit ${whose} made`
          }
          empty={
            status === "all"
              ? "Nobody has been anywhere yet in this execution."
              : "No visits ended that way."
          }
          columns={columns}
          pagination={{ page: current, pages, onChange: setPage, label: "visits" }}
        />

        {/*
          The handle the filter came in on, and only where it is the one thing the reader has:
          with a name in the lede, the breadcrumb and the caption, an id underneath says
          nothing a person can use (§0.2).
        */}
        {only === null || name !== null ? null : (
          <Text size="meta" tone="muted">
            Filtered to one person, by the handle the link carried:{" "}
            <Mono size="code-sm">{only}</Mono>. They are not on this execution&rsquo;s roster,
            so there is no name to put to them.
          </Text>
        )}
      </Stack>
    </InstrumentPage>
  );
}

/**
 * What the row folds out: the figures §5.3 moves out of the table, and the one thing the visit
 * said about itself that no column measures.
 *
 * They are laid out across the fold rather than stacked, because the fold spans the table and a
 * column of four label/value pairs in that space is a narrow list with a field of nothing beside
 * it. `Stat`'s 32px figure is deliberately not used: this is an instrument-class screen and these
 * are diagnostics under a 32px row, not the page's headline numbers.
 */
function VisitDetail({ visit }: { visit: Wake }) {
  return (
    <Stack gap={3} align="stretch">
      <div className="grid grid-cols-2 gap-x-8 gap-y-2 md:grid-cols-4">
        <Figure label="Turns" value={visit.turns.toLocaleString()} />
        <Figure label="Tokens in" value={visit.usage.inputTokens.toLocaleString()} />
        <Figure label="Tokens out" value={visit.usage.outputTokens.toLocaleString()} />
        <Figure
          label="Read from cache"
          value={visit.usage.cacheReadInputTokens.toLocaleString()}
        />
      </div>

      <Text size="read-sm" tone="soft" as="p">
        {visit.wouldReturn === null
          ? "They never said whether they would come back."
          : visit.wouldReturn
            ? "They said they would come back."
            : "They said they would not come back."}
      </Text>
    </Stack>
  );
}

/** One figure in the row's detail. Tabular by construction, so nothing here asks for it (§4.4). */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap={1} align="start">
      <Text size="label" tone="muted">
        {label}
      </Text>
      <Text size="ui" tone="ink">
        {value}
      </Text>
    </Stack>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type { ClusterCard } from "../api.js";
import { q } from "../queries.js";
import { useProject, useSimulation } from "../context.jsx";
import { plural } from "../format.js";
import {
  Button,
  ClusterRow,
  ExecutionCompare,
  ExecutionPicker,
  InstrumentPage,
  Ledger,
  Link,
  Measure,
  PageHeader,
  Section,
  Skeleton,
  Stack,
  StateBlock,
  Text,
  type Crumb,
  type SeverityLevel,
  type StateKind,
} from "../design/index.js";

/**
 * Two executions, side by side — and the one screen in the product that has to be careful about
 * what it claims.
 *
 * A problem is matched across executions by its SIGNATURE: a hash of its kind, its primary tool
 * and the sorted content words of its title (ADR-0028). Stage 5 measured how well that holds and
 * the result is a cliff, not a curve: identical wording recurs 100% of the time and survives
 * punctuation and filler, but a complaint the model rewords from scratch recurs 0% of the time,
 * because one different content word is a different key by construction
 * (`packages/reports/src/stability.test.ts`).
 *
 * So this screen reports an ABSENCE AS AN ABSENCE. It never says "you fixed this", because it
 * cannot know that: the same person may have hit the same thing and described it differently.
 * The word `fixed` belongs to the triage control, where a human types it.
 *
 * **It gains the comparison instrument it has never had** (ATOMIC-INVENTORY §6.3, row 21). The
 * screen used to be three lists of cards and a paragraph asking the reader to be careful;
 * `ExecutionCompare` draws the **paired lattice** instead — execution A's dots above execution
 * B's, per problem — so "not reported in the newer one" arrives as a row of rings under a row of
 * filled dots before a word is read. That is ADR-0028's claim drawn rather than described, and
 * the caveat beneath it ("an absence, not a repair") is verbatim and non-negotiable.
 *
 * **`Row` is gone.** The screen carried a second, thinner `ClusterRow` that dropped the verdict —
 * two spellings of one row, drifting. The ledger below the instrument is the real one at
 * `density="tight"`, and it is what makes the caveat's own instruction — *open one and read the
 * evidence* — something a reader can act on: the paired lattice does not navigate, by design.
 *
 * **The picker is `ExecutionPicker`, organism 34**, the same control `Executions` carries, with
 * the same a ≠ b guard. A second copy here would be a second guard, and the two would disagree
 * the first time either changed. The screen's own `a` and `b` still come from the query string
 * and nowhere else, so the comparison that is fetched is always the one the URL names; the picker
 * holds a choice until it is pressed.
 *
 * **Nothing here is marked** (§5.4, appearance 4, which names this screen by hand: "Visits /
 * Compare / Gaps → nothing, those screens have no single answer and get none").
 */

/** Worst first. A comparison is read for what to do next, and severity is the ordering that says. */
const SEVERITY_RANK = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
} satisfies Record<SeverityLevel, number>;

export function Compare() {
  const { key } = useProject();
  const { key: sim, href } = useSimulation();
  const [params] = useSearchParams();
  // The two executions being compared come from the query string and from nowhere else: the
  // picker below holds a choice, and pressing it navigates. That is what keeps the screen from
  // fetching a comparison of an execution with itself while somebody is halfway through choosing.
  const a = params.get("a") ?? "";
  const b = params.get("b") ?? "";
  const compare = useQuery(q.compare(key, sim, a, b));
  // Already in the cache from the results screen; it is read here to turn a run id into the
  // execution number a reader recognises, which `RunSummary` does not carry.
  const results = useQuery(q.results(key, sim));

  const history = [...(results.data?.history ?? [])].sort((x, y) => y.seq - x.seq);

  /** What the picker is showing. Seeded from the URL, and from the two newest when it is silent. */
  const [pick, setPick] = useState<{ a: string; b: string }>(() => ({ a, b }));
  const [seed, setSeed] = useState<string>(() => `${a}|${b}`);
  const current = `${a}|${b}`;
  if (current !== seed) {
    setSeed(current);
    setPick({ a, b });
  }
  const pickA = pick.a === "" ? (history[1]?.runId ?? "") : pick.a;
  const pickB = pick.b === "" ? (history[0]?.runId ?? "") : pick.b;

  const data = compare.data;
  const earlier = data === undefined ? undefined : history.find((e) => e.runId === data.a.id);
  const later = data === undefined ? undefined : history.find((e) => e.runId === data.b.id);
  const chosen = a !== "" && b !== "";

  const state: StateKind | undefined = !chosen
    ? "empty"
    : compare.isPending || results.isPending
      ? "loading"
      : compare.isError || results.isError
        ? "failed"
        : earlier === undefined || later === undefined
          ? "empty"
          : undefined;

  const crumbs: Crumb[] = [
    { label: "Results", to: href() },
    { label: "Executions", to: href("executions") },
    { label: "Side by side" },
  ];

  const title =
    earlier === undefined || later === undefined
      ? "Compare two executions"
      : `Execution ${earlier.seq} against execution ${later.seq}`;

  // Every problem either execution reported, worst first. The three readings are the instrument's
  // above; this is the index a reader opens one from.
  const clusters: ClusterCard[] =
    data === undefined
      ? []
      : [...data.persisting, ...data.fixed, ...data.appeared].sort(
          (x, y) =>
            SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] || x.title.localeCompare(y.title),
        );

  return (
    <InstrumentPage
      header={
        <PageHeader
          title={title}
          crumbs={crumbs}
          lede="What was reported in both, what the later one did not report, and what turned up in it that had not before."
        />
      }
      toolbar={
        history.length > 1 ? (
          <ExecutionPicker
            executions={history}
            a={pickA}
            b={pickB}
            to={href(`executions/compare?a=${encodeURIComponent(pickA)}&b=${encodeURIComponent(pickB)}`)}
            onA={(value) => {
              setPick({ a: value, b: pickB });
            }}
            onB={(value) => {
              setPick({ a: pickA, b: value });
            }}
          />
        ) : undefined
      }
      state={state}
      loading={
        <StateBlock
          kind="loading"
          what="both executions"
          skeleton={
            <Stack gap={6} align="stretch">
              <Skeleton variant="block" height={96} label="Reading both executions" />
              <Skeleton variant="row" count={5} height={96} label="Reading what moved" />
            </Stack>
          }
        />
      }
      error={
        // A failed read is the one state the reader can act on, so every failed state in the
        // product offers the read again (§6.5, rule 7). It retries a read and promises nothing
        // about the answer — executions are independent (§7.3).
        <StateBlock
          kind="failed"
          what="both executions"
          error={compare.error ?? results.error}
        >
          <Button
            variant="secondary"
            onClick={() => {
              void compare.refetch();
              void results.refetch();
            }}
          >
            Try again
          </Button>
        </StateBlock>
      }
      empty={
        chosen ? (
          <StateBlock kind="empty" what="this comparison">
            Those two executions are not in this simulation&rsquo;s history.{" "}
            <Link to={href("executions")}>Open the executions</Link> and pick two that are.
          </StateBlock>
        ) : (
          <StateBlock kind="empty" what="this comparison">
            {history.length > 1
              ? "Pick an earlier execution and a later one above, and they will be put side by side here."
              : "This simulation has only been run once, so there is nothing to put beside anything."}{" "}
            <Link to={href("executions")}>Open the executions</Link>.
          </StateBlock>
        )
      }
    >
      {earlier === undefined || later === undefined || data === undefined ? null : (
        <Stack gap={8} align="stretch">
          <ExecutionCompare a={earlier} b={later} clusters={clusters} />

          {data.castIdentical || data.notes.length > 0 ? (
            <Measure width="read" as="div">
              <Stack gap={2} align="stretch">
                {data.castIdentical ? (
                  <Text as="p" size="read-sm" tone="soft">
                    Both executions sent the same people, so a difference below is not a
                    difference in who went.
                  </Text>
                ) : null}
                {data.notes.map((note) => (
                  <Text key={note} as="p" size="read-sm" tone="soft">
                    {note}
                  </Text>
                ))}
              </Stack>
            </Measure>
          ) : null}

          <Section title="Open one and read the evidence" trailing={clusters.length}>
            <Stack gap={4} align="stretch">
              <Measure width="read">
                <Text as="p" size="read-sm" tone="soft">
                  {`Every problem either execution reported, worst first — ${plural(clusters.length, "problem")} in all. The lattices above do not navigate; these rows do.`}
                </Text>
              </Measure>

              {clusters.length === 0 ? (
                <StateBlock kind="empty" what="the problems">
                  Neither execution reported anything.
                </StateBlock>
              ) : (
                <Ledger>
                  {clusters.map((card) => (
                    <ClusterRow
                      key={card.signature}
                      cluster={card}
                      density="tight"
                      to={href(`f/${encodeURIComponent(card.signature)}`)}
                      currentSeq={later.seq}
                    />
                  ))}
                </Ledger>
              )}
            </Stack>
          </Section>
        </Stack>
      )}
    </InstrumentPage>
  );
}

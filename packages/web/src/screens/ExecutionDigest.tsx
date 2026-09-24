import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink, useParams } from "react-router-dom";
import { ApiError, api, isMissing, type Digest } from "../api.js";
import { keys, q } from "../queries.js";
import { useProject, useSimulation } from "../context.jsx";
import { lasted, plural, usd } from "../format.js";
import {
  Button,
  Chip,
  ClusterRow,
  ConfirmButton,
  DocumentPage,
  Ledger,
  Link,
  Measure,
  MetaSentence,
  PageHeader,
  RelativeTime,
  Section,
  Skeleton,
  Stack,
  Stat,
  StateBlock,
  Text,
  WhatWentWrong,
  type Crumb,
  type MetaFact,
  type StateKind,
} from "../design/index.js";
import {
  cardOfCluster,
  checkStateOf,
  nothingToList,
  whatDidNotReproduce,
  whatHasBeenChecked,
  whatWasFiled,
  whyRecheckFailed,
  windowNote,
} from "./digest.js";

/**
 * A digest of ONE execution, which until now could only be had from `populace digest` at a
 * terminal. The route (`GET /runs/:id/digest`), the client call and `q.digest` have all existed
 * the whole time and no screen has ever called any of them; this is the screen.
 *
 * **The window is the execution** — `startedAt` to `endedAt`, or to now while it is still going —
 * so a killed, paused or half-finished execution digests exactly like a finished one. "I stopped
 * it halfway, can I still get a report" is the ordinary case, not the error case, and
 * `windowNote` says so on the page rather than leaving a reader to guess whether a short digest
 * is a broken one.
 *
 * **The expensive half is a press, and only a press.** `?verify=true` calls the model judge on
 * every finding with no verdict and replays each finding's recorded tool calls against the live
 * target as the person who filed it. `app.ts`'s docstring calls that the single deliberate
 * exception to "no route with effects behind a GET", *"off by default and named in the query
 * string so it can never happen by accident"*, and this screen is what keeps that true:
 *
 *  - the load, the refetch and every `finding.filed` the project stream invalidates go through
 *    `q.digest`, which is `api.digest` and has no `verify` to pass;
 *  - the re-check is a MUTATION through `api.recheckAndDigest`, behind a `ConfirmButton` that
 *    states all three costs — a model call, real money, and calls to the target as the people who
 *    filed the findings — before it happens;
 *  - the fresh digest it answers with is written straight into the query's cache, so the verdicts
 *    appear without a second request, and every later read of this key is a plain one again.
 *
 * **An unverified digest reads as unverified.** A finding nobody has replayed is what one person
 * said happened, and the product's whole position is that it is not a confirmed problem until the
 * calls it cited have been run again (ADR-0015). So the rows carry `not checked yet` rather than
 * a blank, and `whatHasBeenChecked` says in words which of the two things the reader is looking
 * at. The state is stated once, at the top, with the act beside it in the header; it is not
 * repeated per row, which would be nagging rather than honest.
 *
 * **Nothing here says anything about another execution.** A digest is one window and cannot see
 * whether a problem is new, back or gone (ADR-0028) — `cardOfCluster` is where that restraint
 * lives, and the rows link to the problem's own page, which CAN say, because it reads the
 * simulation's whole history.
 */
export function ExecutionDigest() {
  const { runId = "" } = useParams();
  const { key } = useProject();
  const { key: sim, href } = useSimulation();
  const queries = useQueryClient();

  const digest = useQuery({ ...q.digest(runId), enabled: runId !== "" });
  // Already warm from the results and executions screens. It is read here for the one thing a
  // digest does not carry: the execution NUMBER a reader recognises, and the status that decides
  // what the window note says.
  const results = useQuery(q.results(key, sim));
  const entry = results.data?.history.find((row) => row.runId === runId);

  /**
   * The judge, and the replay. A mutation rather than a query with a flag, because react-query
   * re-runs a query whenever it feels like it — on a window focus, on an invalidation, on a
   * remount — and every one of those would be another round of model calls and another pass of
   * writes against somebody's product.
   */
  const recheck = useMutation({
    mutationFn: () => api.recheckAndDigest(runId),
    onSuccess: (fresh) => {
      // The answer IS the rebuilt digest, so it is put in the cache rather than thrown away and
      // re-fetched. Everything else that reads a verdict — the run's own counts, the results
      // screen, a problem's page — is only invalidated, and each of those reads is free.
      queries.setQueryData(keys.digest(runId), fresh);
      void queries.invalidateQueries({ queryKey: keys.run(runId) });
      void queries.invalidateQueries({ queryKey: ["results"] });
      void queries.invalidateQueries({ queryKey: ["cluster"] });
    },
  });

  const crumbs: Crumb[] = [
    { label: "Results", to: href() },
    { label: "Executions", to: href("executions") },
    { label: entry === undefined ? "Digest" : `Execution ${entry.seq}` },
  ];

  const state: StateKind | undefined =
    digest.isPending || results.isPending
      ? "loading"
      : digest.isError && isMissing(digest.error)
        ? "gone"
        : digest.isError || results.isError
          ? "failed"
          : entry === undefined
            ? "empty"
            : undefined;

  const data = digest.data;
  const checked = data === undefined ? undefined : checkStateOf(data);
  const note = entry === undefined ? null : windowNote(entry.status);
  const footnote = checked === undefined ? null : whatDidNotReproduce(checked);

  /**
   * What the press will actually do, before it does it. All three costs, because a reader who
   * finds out afterwards that this called their product twelve times as twelve different accounts
   * will not press it again.
   */
  const pending = checked?.unchecked ?? 0;
  const consequence = `${plural(pending, "finding")} here ${pending === 1 ? "has" : "have"} no verdict yet. Re-checking asks the model judge about each one, and runs the tool calls it recorded against ${data?.targetName ?? "the target"} again, signed in as the person who filed it — so it costs money, and your product sees those calls a second time. Findings that do not recur drop out of the list below.`;

  return (
    <DocumentPage
      header={
        <PageHeader
          title={entry === undefined ? "Digest" : `Digest of execution ${entry.seq}`}
          crumbs={crumbs}
          meta={metaOf(data, entry === undefined ? null : entry.startedAt, entry === undefined ? null : entry.endedAt)}
          status={
            entry?.status === "running" ? (
              <Chip tone="live">running</Chip>
            ) : entry?.status === "paused" ? (
              <Chip>paused</Chip>
            ) : entry?.status === "killed" ? (
              <Chip tone="bad">stopped</Chip>
            ) : undefined
          }
          // Only once there is a digest: on the `gone` state the same sentence would describe an
          // execution the page has just said is not there.
          {...(data === undefined ? {} : { lede: "Everything the people in this execution filed, grouped into the problems they add up to." })}
          actions={
            data === undefined ? undefined : (
              <ConfirmButton
                title="Re-check these findings against the target?"
                body={consequence}
                confirmLabel="Re-check them against the target"
                variant="primary"
                pending={recheck.isPending}
                onConfirm={() => {
                  recheck.mutate();
                }}
              >
                {/*
                  At a bound rather than gone when there is nothing pending (§7.4): the reader can
                  see the act exists and read, two lines up, why it has nothing left to do. A
                  disabled trigger never opens the dialog, so the expensive call cannot start.
                */}
                <Button variant="primary" disabled={pending === 0} pending={recheck.isPending}>
                  Re-check them
                </Button>
              </ConfirmButton>
            )
          }
        />
      }
      rail={
        data === undefined || checked === undefined ? undefined : (
          <>
            <Stat label="People who went" value={data.totals.agents} />
            <Stat label="Visits made" value={data.totals.wakes} />
            <Stat
              label="Findings filed"
              value={data.totals.findings}
              sub={data.totals.clusters === 0 ? undefined : `${plural(data.totals.clusters, "problem")} between them`}
            />
            <Stat
              label="Re-checked"
              value={`${checked.checked} of ${checked.listed + checked.notReproduced}`}
              sub={checked.checked === 0 ? "nothing judged yet" : `${checked.confirmed} reproduced`}
            />
            <Stat label="Spent" value={usd(data.totals.costUsd)} sub="visits and judging, in this window" />
          </>
        )
      }
      state={state}
      loading={
        <StateBlock
          kind="loading"
          what="this execution's digest"
          skeleton={
            <Stack gap={8} align="stretch">
              <Skeleton variant="block" height={96} label="Building this execution's digest" />
              <Skeleton variant="row" count={5} height={72} label="Reading what was filed" />
            </Stack>
          }
        />
      }
      error={
        <StateBlock kind="failed" what="this execution's digest" error={digest.error ?? results.error}>
          <Button
            variant="secondary"
            onClick={() => {
              void digest.refetch();
              void results.refetch();
            }}
          >
            Try again
          </Button>
        </StateBlock>
      }
      gone={
        <StateBlock kind="gone" what="that execution">
          <Stack gap={6} align="start">
            <div>There is no execution {runId} to digest. A swept execution keeps its findings and loses its rows.</div>
            <Button asChild variant="primary">
              <RouterLink to={href("executions")}>See the executions there are</RouterLink>
            </Button>
          </Stack>
        </StateBlock>
      }
      empty={
        <StateBlock kind="empty" what="that execution">
          That execution is not in this simulation&rsquo;s history. <Link to={href("executions")}>Open the executions</Link> and
          pick one that is.
        </StateBlock>
      }
    >
      {data === undefined || checked === undefined || entry === undefined ? null : (
        <Stack gap={8} align="stretch">
          {/* The sentence for somebody who reads nothing else, at the one step reserved for it. A
              zero-findings execution gets it too: "nobody filed anything" is an answer (§7.4). */}
          <Measure width="statement">
            <Text as="p" size="statement">
              {whatWasFiled(data)}
            </Text>
          </Measure>

          <Measure width="read" as="div">
            <Stack gap={2} align="stretch">
              {checked.listed === 0 ? null : (
                <Text as="p" size="read" tone="soft">
                  {whatHasBeenChecked(checked)}
                </Text>
              )}
              {note === null ? null : (
                <Text as="p" size="read-sm" tone="soft">
                  {note}
                </Text>
              )}
            </Stack>
          </Measure>

          {recheck.isError ? (
            /*
              The two refusals this route makes on purpose — 503 with no API key for the judge,
              409 when the execution's target cannot be reached with what is stored now — read as
              themselves rather than as "something went wrong", because the reader fixes them in
              two completely different places. The machine's own words go in the well beneath
              (§7.4), never inside our sentence.
            */
            <WhatWentWrong says={whyRecheckFailed(statusOf(recheck.error))} error={recheck.error} />
          ) : null}

          <Section title="What they reported" trailing={data.clusters.length}>
            <Stack gap={4} align="stretch">
              <Measure width="read">
                <Text as="p" size="read-sm" tone="soft">
                  One row is one problem, worst first. Open one to read its evidence and everything
                  this simulation knows about it.
                </Text>
              </Measure>

              {data.clusters.length === 0 ? (
                <StateBlock kind="empty" what="the problems">
                  {nothingToList(data, checked)} <Link to={href("coverage")}>Open the coverage table</Link>.
                </StateBlock>
              ) : (
                <Ledger>
                  {data.clusters.map((cluster) => (
                    <ClusterRow
                      key={cluster.signature}
                      cluster={cardOfCluster(cluster, { seq: entry.seq, peopleTotal: data.totals.agents })}
                      density="tight"
                      to={href(`f/${encodeURIComponent(cluster.signature)}`)}
                      currentSeq={entry.seq}
                    />
                  ))}
                </Ledger>
              )}

              {footnote === null ? null : <MetaSentence>{footnote}</MetaSentence>}
            </Stack>
          </Section>
        </Stack>
      )}
    </DocumentPage>
  );
}

/** The header's fact line: what was digested, over what window, and how fresh the reading is. */
function metaOf(data: Digest | undefined, startedAt: string | null, endedAt: string | null): MetaFact[] {
  if (data === undefined) return [];
  return [
    { key: "target", node: data.targetName },
    // The window is the execution, so its length IS how long people were in there. `endedAt` is
    // null while it is still going, and `lasted` reads that as "up to now" rather than as zero.
    { key: "window", node: startedAt === null ? "never started" : `${lasted(startedAt, endedAt)} of visits` },
    {
      key: "built",
      node: (
        <>
          {"built "}
          <RelativeTime at={data.generatedAt} />
        </>
      ),
    },
  ];
}

/**
 * The HTTP status behind a failed re-check, or 0 when the failure never reached the server. The
 * `ApiError` class is the only thing that carries one, and a fetch that never connected is not a
 * refusal to explain away.
 */
function statusOf(error: Error): number {
  return error instanceof ApiError ? error.status : 0;
}

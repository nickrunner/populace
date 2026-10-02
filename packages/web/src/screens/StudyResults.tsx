import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SEVERITY_RANK } from "@populace/core/isomorphic";
import type { ClusterCard, RunCohort } from "../api.js";
import { api, isRefused } from "../api.js";
import { familyOf, keys, q } from "../queries.js";
import { useProject, useStudy } from "../context.jsx";
import { people, plural, usd } from "../format.js";
import { ExecutionHistory } from "./Executions.jsx";
import {
  Badge,
  Button,
  Checkbox,
  Chip,
  ClusterRow,
  ConfirmButton,
  DataTable,
  Dialog,
  Disclosure,
  DocumentPage,
  IncidenceBars,
  Inline,
  JobProgress,
  Ledger,
  Link,
  Measure,
  Mono,
  PageHeader,
  RelativeTime,
  Section,
  SeverityTag,
  StudyActions,
  Skeleton,
  Stack,
  Stat,
  StateBlock,
  Text,
  Tooltip,
  VisuallyHidden,
  WhatWentWrong,
  type Column,
  type Crumb,
  type MetaFact,
  type StateKind,
} from "../design/index.js";

/**
 * The screen the user lives on (SPEC sketch 2), and the direction's showcase
 * (ATOMIC-INVENTORY §6.3, row 19).
 *
 * A study IS its latest findings. It is not a hub you pass through on the way to a run: the
 * run id is not in the URL, the execution these numbers come from is a detail of the page, and
 * what the reader came for — what keeps going wrong, to whom — is the first thing on it.
 *
 * NOBODY IS NAMED HERE. `StudyResultsView` has nowhere to put a name, deliberately (SPEC
 * §7.1), and this screen does not go looking for one: a headcount and a cohort answer "how bad is
 * it and to whom", and a name answers "who said that", which is one click further in.
 *
 * **The statement comes off the wire.** `StudyResultsView.headline` has been in the payload
 * the whole time and this screen recomputed its own sentence from `stats`, `clusters` and
 * `execution` while the field sat unused — two sentences about one execution, drifting, with the
 * browser's copy winning by accident. There is one now, it is the server's, and it is set at
 * `t-statement`: 30px serif, at the statement measure, above everything. **A zero-findings
 * execution gets the same statement, not an empty state** — "nothing was filed" is an answer to
 * the question the reader asked, and demoting it to an empty box says the screen is broken
 * instead.
 *
 * **Document-class with the instrument rail** (DESIGN-SYSTEM §5.3, ATOMIC-INVENTORY §4 template
 * 2). The five figures move off the top of the reading column — where they were a literal
 * `grid-cols-5` that fitted nothing under 1100px — and into the 264px rail, which is what the
 * rail is for: the numbers beside the document, sticky at ≥1240px and a two-column block beneath
 * it below that. They are bare `Stat`s because the rail IS the grid; a `StatGroup` inside it
 * would be a second grid inside the first.
 *
 * **The screen's one marker band** (§5.4, appearance 1) is fixed by name: *the incidence peak of
 * the worst cluster*. So the worst problem's cohort breakdown is drawn — `IncidenceBars`, the
 * panel instrument a list row is forbidden to carry (§1.3 rule 10) — and the cohort it reached
 * furthest into takes the band. Nothing else on this screen is marked, including the figures in
 * the rail.
 *
 * **Both bare toggles are gone** (molecule 33). "Show the other 12" and "Known ▸" were two
 * `<button>`s with no `aria-expanded` and no `aria-controls`; they are `Disclosure`s, which is
 * Radix `Collapsible` and carries both.
 *
 * **Filing what this study found, in bulk** (ADR-0044). The act belongs on this screen and not on
 * a settings page, because what is being filed is the list that is already on it. It opens a
 * `Dialog` — the non-destructive interruption, a thing you are composing — which lists what WOULD
 * go out, one row per problem, and the press itself is behind a `ConfirmButton` naming the count
 * and the repository. Two interruptions is not an accident: the first is a list to read, the
 * second is a write into somebody else's tracker.
 *
 * **The already-filed column is the load-bearing one.** The ledger matches a problem by the SET of
 * its member signatures and the marker search in the issue body catches most of the rest, but a
 * problem reworded from scratch shares neither — and then a reader seeing "#41" beside a row is
 * the only thing standing between them and a near-duplicate issue in their own repository. It is
 * read off `ClusterCardView.filedIssue`, which is on the card and not only on `triage` because
 * filing writes no triage row.
 *
 * **The dialog never matches an answer back to a row.** The bulk route answers with a `Job` and no
 * results, which is the shape that makes this safe: a named signature's RESULT can carry a
 * different signature, because the ledger matches a cluster's whole member set while the card
 * offers only its representative — and `pickRepresentative` sorts on verdict score first, so the
 * digest writing a verdict moves it with nobody having reworded anything. Anything that paired
 * results to ticked boxes by string equality would therefore pair them wrongly. Nothing here
 * pairs them at all: the job's own words are what is shown, and the rows are re-read afterwards.
 */

/**
 * A problem this screen is offering to file, and whether the project's own settings would pass it
 * over. Both halves are needed in one row because a reader may tick a narrowed problem anyway:
 * naming a signature says which problems to CONSIDER, which sets the connection's filter aside for
 * that one (`dealWith` in `publish-issues.ts` asks the filter only for an unnamed problem).
 */
interface Fileable {
  card: ClusterCard;
  /** Why this project's settings would pass it over, in a phrase. Null when they would not. */
  narrowed: string | null;
}

/**
 * The skips no filter and no tickbox can waive, mirrored from `skipOf` in `project-read-model.ts`
 * so that this screen offers only what the server would actually act on.
 *
 * **The absence is the one that matters most.** A results screen carries a card for every problem
 * an earlier report window reported and this one did not, and that card is an ABSENCE — filing it
 * would be populace announcing a repair it cannot see, which ADR-0028 forbids outright. It is read
 * off `inLatest`, the card's own fact, and never off `state`: a human's triage drives that string
 * too, and a state is copy while this is the thing underneath it.
 */
function hardSkip(card: ClusterCard): string | null {
  if (card.kind === "praise") return "somebody said the product did well here";
  if (card.triage?.state === "wont-fix" || (card.triage?.state === "fixed" && card.state !== "regressed")) return "you have already ruled on it";
  if (card.triage?.state === "duplicate") return "you said it is another problem under a different title";
  if (!card.inLatest) return "nobody reported it in the latest report cycle";
  return null;
}

/**
 * The connection's own filter, mirrored from `filterSkip` in `publish-issues.ts`. It narrows what
 * populace files when nobody named anything and it never widens it — so a row it excludes arrives
 * unticked with the reason beside it, rather than missing.
 */
function narrowedBy(card: ClusterCard, filter: { kinds: readonly string[]; minSeverity: keyof typeof SEVERITY_RANK; onlyConfirmed: boolean }): string | null {
  if (!filter.kinds.includes(card.kind)) return "not a kind your settings file";
  // Ranks ascend as severity descends, so "at least this severe" is a rank no greater than the floor's.
  if (SEVERITY_RANK[card.severity] > SEVERITY_RANK[filter.minSeverity]) return "below the severity your settings file";
  if (filter.onlyConfirmed && card.verdict !== "confirmed") return "your settings file only what the re-check confirmed";
  return null;
}
export function StudyResults() {
  const { key, href: projectHref } = useProject();
  const { key: studyKey, study, href } = useStudy();
  const results = useQuery(q.results(key, studyKey));
  /**
   * Where this project files, or `null` because nobody has connected anywhere — an answer and not a
   * failure to get one. It carries `tokenSet` and never a token (ADR-0040), which is all this
   * screen needs: whether there is somewhere to file, whether that somewhere is world-readable,
   * and which problems the project's own settings would pass over.
   */
  const connection = useQuery(q.github(key));
  const queries = useQueryClient();

  /** The dialog's own state: open, and which problems are ticked inside it. */
  const [picking, setPicking] = useState(false);
  const [ticked, setTicked] = useState<readonly string[]>([]);

  /**
   * The publish job, watched the way `StudyPeople` watches the people writer: the runner writes to
   * the row from another process, so nothing this browser does will tell it the work is finished.
   * The poll is at the call site and stops when the row goes terminal.
   */
  const [job, setJob] = useState<string | null>(null);
  const [told, setTold] = useState("");
  const watched = useQuery({ ...q.job(job ?? ""), enabled: job !== null, refetchInterval: 1_000 });
  const filing = watched.data?.status === "queued" || watched.data?.status === "running";
  const fileReasonId = useId();

  const publish = useMutation({
    mutationFn: (signatures: readonly string[]) => api.fileIssues(key, studyKey, [...signatures]),
    onSuccess: (started) => {
      setJob(started.id);
      setTold("");
      setPicking(false);
    },
  });

  useEffect(() => {
    if (job === null || watched.data === undefined || filing) return;
    /*
     * The job's own last words, which is the only account of what happened there is: a `Job` row
     * carries progress and an error and no result payload, so the per-problem outcomes are not
     * kept anywhere (`PublishIssuesSummary`'s note). What IS kept is on the rows themselves — every
     * filed problem now carries its `filedIssue` — so the answer to "what went out" is the list
     * below, re-read.
     */
    setTold(watched.data.error ?? watched.data.progress.label);
    setJob(null);
    void Promise.all([
      queries.invalidateQueries({ queryKey: keys.results(key, studyKey) }),
      queries.invalidateQueries({ queryKey: familyOf(keys.cluster("", "", "")) }),
      queries.invalidateQueries({ queryKey: keys.triage(key) }),
      queries.invalidateQueries({ queryKey: keys.project(key) }),
    ]);
    // The effect is about the job landing, not about the client or the keys it then invalidates.
  }, [job, watched.data, filing]);

  const crumbs: Crumb[] = [{ label: "Studies", to: projectHref() }, { label: study.name }];
  const data = results.data;

  if (data === undefined) {
    const state: StateKind = results.isPending ? "loading" : "failed";
    return (
      <DocumentPage
        header={<PageHeader title={study.name} crumbs={crumbs} />}
        state={state}
        loading={
          // A skeleton at the height of what it replaces — the statement, then the rows — so
          // the page does not collapse to a line and jump back when the results land (§6.5,
          // rule 6).
          <StateBlock
            kind="loading"
            what="this study"
            skeleton={
              <Stack gap={8} align="stretch">
                <Skeleton variant="block" height={96} label="Reading this study" />
                <Skeleton variant="row" count={5} height={72} label="Reading what keeps happening" />
              </Stack>
            }
          />
        }
        error={
          // A failed read is the one state the reader can act on, so every failed state in the
          // product offers the read again (§6.5, rule 7).
          <StateBlock kind="failed" what="this study" error={results.error}>
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
      >
        {null}
      </DocumentPage>
    );
  }

  // Which execution these results are OF. `execution` is a run detail and carries no sequence
  // number; `history` is where the run id and the number a reader recognises are the same row.
  const latest = data.history.find((entry) => entry.runId === data.execution?.id);
  // An execution that has been created and has not visited yet is real, and saying "never run"
  // about it would be wrong; it just has nothing to report (SPEC §6.2).
  const started = [...data.history].sort((a, b) => a.seq - b.seq).at(-1);
  const filed = data.execution?.totals.findings ?? 0;
  const worst = data.clusters[0];
  const shown = data.clusters.slice(0, 8);
  const rest = data.clusters.slice(8);
  const untouched = data.coverage.neverCalledCount;

  /**
   * Where these problems would go, and whether there is anything to go with. `undefined` is the
   * read not having landed and `null` is nothing having been connected; the two are different
   * sentences, so neither is collapsed into the other. `fileTo` is the same test written as a
   * value, so the dialog can name the repository and read its visibility without the compiler
   * being asked to take a sentence's word for it.
   */
  const where = connection.data ?? null;
  const fileTo = where !== null && where.repo !== "" && where.tokenSet ? where : null;

  /**
   * What would actually go out: every problem on this screen — above the fold and under "already
   * decided about" alike — minus the ones populace passes over whoever asks. A row the project's
   * settings would narrow stays in the list and arrives unticked with its reason, because ticking
   * it is how somebody files it anyway.
   */
  const everything = [...data.clusters, ...data.known];
  const fileable: Fileable[] = everything.flatMap((card) =>
    hardSkip(card) === null ? [{ card, narrowed: fileTo === null ? null : narrowedBy(card, fileTo.filter) }] : [],
  );
  const passedOver = everything.length - fileable.length;
  const chosen = fileable.filter((row) => ticked.includes(row.card.signature));
  const already = chosen.filter((row) => row.card.filedIssue !== null).length;

  /**
   * Why filing cannot be started, or `undefined`. The first four are the server's own refusals
   * (`notConnected` in `control.ts`) said before the round trip rather than after it; the last two
   * are this screen knowing there is nothing to send. It is local knowledge and can trail the
   * server, so a refusal that does arrive is shown below in the server's own words.
   */
  const fileBound: string | undefined = connection.isPending
    ? "populace is still reading where this project files."
    : connection.isError
      ? "populace could not read where this project files, so it will not send anything anywhere."
      : fileTo === null
        ? where === null || where.repo === ""
          ? "This project has no repository to file into."
          : `populace has ${where.repo} to file into, and no token to file with.`
        : filing
          ? "populace is filing this study's problems now."
          : everything.length === 0
            ? "Nothing has been reported here, so there is nothing to file."
            : fileable.length === 0
              ? "Every problem here is one populace passes over: praise, one you have ruled on, a duplicate, or one nobody reported in the latest report cycle."
              : undefined;

  /** The columns of the dialog's list. One row is one problem, and one problem is one issue. */
  const fileColumns: Column<Fileable>[] = [
    {
      key: "tick",
      header: "File",
      width: "3rem",
      cell: (row) => (
        <Checkbox
          checked={ticked.includes(row.card.signature)}
          onChange={(on) => {
            setTicked(
              on
                ? [...ticked, row.card.signature]
                : ticked.filter((signature) => signature !== row.card.signature),
            );
          }}
          // The box's own name, which a screen reader needs and the column head cannot give it:
          // twenty-five boxes all called "File" name nothing (§6).
          label={<VisuallyHidden>{`File “${row.card.title}”`}</VisuallyHidden>}
        />
      ),
    },
    {
      key: "severity",
      header: "Severity",
      cell: (row) => <SeverityTag level={row.card.severity} kind={row.card.kind} />,
    },
    {
      // The one serif column (§5.3): the problem in its own words, scanned down.
      key: "problem",
      header: "Problem",
      sentence: true,
      cell: (row) => (
        <Text size="read-sm" tone="soft">
          {row.card.title}
        </Text>
      ),
    },
    {
      key: "reach",
      header: "Reach",
      priority: 2,
      cell: (row) => (
        <Text size="ui" tone="muted">
          {`${String(row.card.peopleHit)} of ${people(row.card.peopleTotal)}`}
        </Text>
      ),
    },
    {
      /*
        The backstop. The ledger's own matching is by signature SET and the marker search in the
        body catches most of what that misses, but a problem somebody's report reworded from
        scratch shares neither — so this column is the last thing between a reader and a
        near-duplicate in their own repository. It is not decoration and it is never cut: no
        `priority`, so it survives every width.
      */
      key: "filed",
      header: "Already filed",
      cell: (row) =>
        row.card.filedIssue === null ? (
          <Text size="ui" tone="muted">
            no issue yet
          </Text>
        ) : (
          <Link size="meta" href={row.card.filedIssue.url}>
            {`${row.card.filedIssue.repo}#${String(row.card.filedIssue.number)}`}
          </Link>
        ),
    },
    {
      key: "narrowed",
      header: "Your settings",
      priority: 3,
      cell: (row) =>
        row.narrowed === null ? null : (
          <Badge tone="neutral">
            <VisuallyHidden>your settings would pass this over: </VisuallyHidden>
            {row.narrowed}
          </Badge>
        ),
    },
  ];

  const facts: MetaFact[] = [
    { key: "mode", node: <Badge variant="mode">{study.mode}</Badge> },
    {
      // The headcount is the study's, not the population's (ADR-0041): `sends` is what the deal
      // actually sends at this size, which is below `size` only when a cohort has nobody to deal
      // into — and then the smaller number is the true one.
      key: "population",
      node: `${study.population.name} — ${people(study.sends)} in ${plural(study.population.cohorts, "cohort")}`,
    },
    { key: "target", node: study.target.name },
    {
      key: "execution",
      node:
        latest === undefined
          ? started === undefined
            ? "never run"
            : `execution ${started.seq} has not visited yet`
          : `execution ${latest.seq}`,
    },
    {
      key: "started",
      node:
        latest === undefined ? null : <RelativeTime at={latest.startedAt} mode="absolute" />,
    },
  ];

  /**
   * What "across executions" means for this study, in a sentence rather than in a count the
   * reader has to interpret. A longitudinal study has one execution and a life inside it; an
   * ephemeral one has peers, and how many there are changes what the list below is a reading of.
   */
  const span =
    study.mode === "longitudinal"
      ? "over the life of this execution"
      : data.history.length === 0
        ? "nothing has been run yet"
        : data.history.length === 1
          ? "in the one execution so far"
          : `across all ${data.history.length} executions`;

  /**
   * The cohort the worst problem reached furthest into, by proportion. It carries the screen's one
   * lime marker band, which §5.4 fixes by name for this screen: *the incidence peak of the worst
   * cluster*. A cohort nobody in it hit is never the peak — a band over `0/8` would mark an
   * absence as the answer.
   */
  const peak = (worst?.cohorts ?? []).reduce<{ slug: string; share: number } | undefined>(
    (best, cohort) => {
      if (cohort.hit === 0 || cohort.total === 0) return best;
      const share = cohort.hit / cohort.total;
      return best === undefined || share > best.share ? { slug: cohort.slug, share } : best;
    },
    undefined,
  );

  const columns: Column<RunCohort>[] = [
    { key: "cohort", header: "Cohort", cell: (cohort) => <Text size="ui">{cohort.name}</Text> },
    { key: "people", header: "People", numeric: true, cell: (cohort) => cohort.people },
    { key: "filed", header: "Filed", numeric: true, cell: (cohort) => cohort.findings },
    {
      // The one serif column (§5.3): a phrase a reader scans down, not a value.
      key: "how",
      header: "How it went",
      sentence: true,
      cell: (cohort) => (
        <Text size="read-sm" tone="soft">
          {cohort.headline}
        </Text>
      ),
    },
    {
      key: "persona",
      header: "Personas",
      priority: 3,
      cell: (cohort) => (
        <Text size="ui" tone="muted">
          {cohort.personas.join(", ")}
        </Text>
      ),
    },
  ];

  return (
    <DocumentPage
      header={
        <PageHeader
          title={study.name}
          crumbs={crumbs}
          meta={facts}
          status={
            study.status === "running" ? (
              <Chip tone="live">running</Chip>
            ) : study.status === "paused" ? (
              <Chip>paused</Chip>
            ) : undefined
          }
        />
      }
      rail={
        <>
          <Stat
            label="People sent"
            value={data.stats.people}
            sub={plural(study.population.cohorts, "cohort")}
          />
          <Stat label="Visits made" value={data.stats.visits} />
          <Stat
            label="Problems confirmed"
            value={data.stats.confirmed}
            sub={filed === 0 ? "nothing filed yet" : `of ${filed} filed`}
          />
          <Stat
            label="Walked away"
            value={data.stats.walkedAway}
            sub="before they were finished"
          />
          <Stat label="Spent" value={usd(data.stats.costUsd)} sub="on this execution" />
        </>
      }
    >
      <Stack gap={8} align="stretch">
        {/*
          The acts this study is asking for, at the top of the reading column rather than in the
          header's `actions` slot. That slot is `shrink-0` so a row of buttons never wraps
          mid-act, which is right for buttons and wrong for everything `StudyActions` says
          underneath them: a bound or a failure in there sets the slot's width from its own
          longest line, squeezing the title on a wide window and painting over the rail. Here the
          controls sit at the head of the column and their sentences wrap to it.
        */}
        <StudyActions study={study} />

        {/*
          The sentence for somebody who reads nothing else, in the product's own voice and at
          the one step reserved for it. It is the server's sentence: this screen no longer
          writes a second one.
        */}
        <Measure width="statement">
          <Text as="p" size="statement">
            {data.headline}
          </Text>
        </Measure>

        <Section
          title="What keeps happening"
          trailing={data.clusters.length}
          actions={
            /*
              The act belongs to this list, so its control is on this list's rule. It opens the
              dialog rather than filing: a press that sent forty issues to somebody's repository
              without first showing what they were would be a press nobody could check.
            */
            fileBound === undefined ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  // Ticked to start with: everything this project's own settings would file.
                  // A narrowed row is in the list and unticked, because ticking it is how
                  // somebody files it anyway.
                  setTicked(fileable.filter((row) => row.narrowed === null).map((row) => row.card.signature));
                  setPicking(true);
                }}
              >
                File these as issues
              </Button>
            ) : (
              // At a bound, never disabled: the tab stop, the name and the tooltip stay, and the
              // reason is a line in the body below that `aria-describedby` points at (§6.5).
              <Tooltip content={fileBound}>
                <Button variant="secondary" size="sm" atBound aria-describedby={fileReasonId}>
                  File these as issues
                </Button>
              </Tooltip>
            )
          }
        >
          <Stack gap={4} align="stretch">
            <Measure width="read">
              <Text as="p" size="read-sm" tone="soft">
                {`One row is one thing that is actually wrong, ${span}.`}
              </Text>
            </Measure>

            {/*
              Everything the filing control cannot say from inside a rule: why it is at a bound and
              where to go about it, what the job is doing, what it said when it finished, and a
              refusal in the server's own words.
            */}
            {fileBound === undefined ? null : (
              <Measure width="read">
                <Text as="p" size="meta" tone="muted" id={fileReasonId}>
                  {`${fileBound} `}
                  {fileTo === null && !connection.isPending ? (
                    <Link size="meta" to={projectHref("settings")}>
                      Set one up in this project&rsquo;s settings
                    </Link>
                  ) : null}
                </Text>
              </Measure>
            )}

            {/*
              One job, watched. `JobProgress` takes a list; here it is this study's single publish
              job, and the list is empty for the moment between the POST and the first read of the
              row it created — which is a real state and not a gap. The organism's own default
              sentence counts people, and this one counts problems.
            */}
            {job === null ? null : (
              <JobProgress
                jobs={watched.data === undefined ? [] : [watched.data]}
                label="Filing this study's problems"
                sentence={(done, total) => `${String(done)} of ${plural(total, "problem")} looked at so far.`}
              />
            )}

            {told === "" ? null : (
              <Measure width="read">
                <Text as="p" size="meta" tone="muted">
                  {told}
                </Text>
              </Measure>
            )}

            {publish.error === null ? null : (
              <WhatWentWrong
                says={
                  isRefused(publish.error)
                    ? "Nothing was filed: the server declined, and says why below. Every problem below still carries whatever it carried before."
                    : "Nothing was filed. Every problem below still carries whatever it carried before."
                }
                error={publish.error}
              />
            )}

            {/*
              What WOULD be filed, before anything is. `Dialog` and not `AlertDialog`: this is a
              thing being composed — a list to read and tick — and the write itself is behind the
              `ConfirmButton` in its footer, which is the one announced as an `alertdialog`. It is
              rendered only when there is somewhere to file, which is also what narrows `fileTo`
              for the copy inside: a panel naming a repository that does not exist is worse than no
              panel at all.
            */}
            {fileTo === null ? null : (
              <Dialog
                open={picking}
                onOpenChange={setPicking}
                title="File these as issues"
                description={`One row is one issue in ${fileTo.repo}. Ticking a problem asks populace to consider it, which sets aside the kind and severity limits in this project's settings — the rules that pass over praise, a problem you have ruled on, a duplicate, and one nobody reported in the latest report cycle hold whoever asks.`}
                footer={
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setPicking(false);
                      }}
                    >
                      Not now
                    </Button>
                    {chosen.length === 0 ? (
                      <Tooltip content="Nothing is ticked, so there is nothing to file.">
                        <Button variant="primary" atBound>
                          File them
                        </Button>
                      </Tooltip>
                    ) : (
                      <ConfirmButton
                        title={chosen.length === 1 ? "File this as an issue?" : `File ${String(chosen.length)} problems?`}
                        variant="primary"
                        confirmLabel={chosen.length === 1 ? "File it" : `File ${String(chosen.length)} of them`}
                        pending={publish.isPending}
                        onConfirm={() => {
                          publish.mutate(chosen.map((row) => row.card.signature));
                        }}
                        body={
                          <Stack gap={3} align="stretch">
                            <span>
                              populace opens up to {plural(chosen.length - already, "issue")} in{" "}
                              <Mono size="ref">{fileTo.repo}</Mono>, one round trip each
                              {already === 0
                                ? "."
                                : `, and comments on ${plural(already, "issue")} it opened before rather than opening a second one for the same problem.`}
                            </span>
                            {/*
                              The queue, said as a count and a consequence rather than as a
                              duration (§7.3 — nothing here may promise how long anything takes).
                              One job runs at a time across the whole of populace, so a count is
                              the honest thing to state: forty issues is forty round trips to
                              somebody else's server, in front of whatever else is waiting.
                            */}
                            <span>
                              It files them one at a time, and it holds populace&rsquo;s one job
                              queue while it does: starting an execution, writing a study&rsquo;s
                              people or building a digest waits behind it. Nothing is spent on this
                              — filing calls no model.
                            </span>
                            {fileTo.visibility === "public" ? (
                              /*
                                The honest limit, unsoftened. `withoutAddresses` reduces every
                                absolute URL whose host is one of THIS target's own — in the
                                endpoint list and inside the quoted results alike, each one marked
                                where it was reduced. It reduces nothing else. It is not a
                                scrubber: the product's description and the cohorts' briefs are
                                what make a report actionable, and they go out as written, which is
                                exactly what naming the repository as public asks somebody to take
                                on knowingly.
                              */
                              <span>
                                That repository is public, so anybody can read what goes into it.
                                Each body carries the whole reproduction: the calls with their
                                arguments and their results, the people&rsquo;s own words, the
                                product&rsquo;s description, and what everybody in each cohort that
                                hit it had been told they were in the middle of. populace first
                                reduces every address the target is known by to its bare host, in
                                the endpoint list and inside the quoted results alike, marking each
                                reduction where it was made. Nothing else is reduced: the
                                description and the briefs go out exactly as written, and anything
                                else the product printed in its own output is left as the product
                                printed it.
                              </span>
                            ) : (
                              <span>
                                {fileTo.visibility === "private"
                                  ? "The last check found that repository private. Each body carries the whole reproduction — the calls, the people’s own words, the product’s description and each hit cohort’s brief — as written."
                                  : "Nobody has checked yet whether that repository is world-readable. Each body carries the whole reproduction — the calls, the people’s own words, the product’s description and each hit cohort’s brief — as written, so check it in this project’s settings if that matters."}
                              </span>
                            )}
                          </Stack>
                        }
                      >
                        <Button variant="primary">
                          {chosen.length === 1 ? "File it" : `File ${String(chosen.length)} of them`}
                        </Button>
                      </ConfirmButton>
                    )}
                  </>
                }
              >
                <Stack gap={4} align="stretch">
                  <Inline gap={3} align="center" wrap>
                    <Button
                      variant="quiet"
                      size="sm"
                      onClick={() => {
                        setTicked(fileable.map((row) => row.card.signature));
                      }}
                    >
                      Tick everything
                    </Button>
                    <Button
                      variant="quiet"
                      size="sm"
                      onClick={() => {
                        setTicked([]);
                      }}
                    >
                      Tick nothing
                    </Button>
                    <Text size="meta" tone="muted">
                      {`${plural(chosen.length, "problem")} ticked${already === 0 ? "" : `, ${String(already)} of them with an issue already`}`}
                    </Text>
                  </Inline>

                  <DataTable<Fileable>
                    rows={fileable}
                    keyOf={(row) => row.card.signature}
                    caption="Every problem this study found that populace would file, what it would go out as, and whether it has been filed before"
                    empty="There is nothing here populace would file."
                    columns={fileColumns}
                  />

                  {passedOver === 0 ? null : (
                    <Text size="meta" tone="muted" as="p">
                      {`${plural(passedOver, "problem")} on this screen ${passedOver === 1 ? "is" : "are"} not listed at all. populace passes over praise, a problem you have ruled on, a duplicate, and one nobody reported in the latest report cycle — an absence is not something to file.`}
                    </Text>
                  )}
                </Stack>
              </Dialog>
            )}

            {data.clusters.length === 0 ? (
              <StateBlock kind="empty" what="the problems">
                {data.execution === null
                  ? "Nobody has gone yet, so there is nothing here."
                  : "Nobody filed anything in this execution."}
              </StateBlock>
            ) : (
              <Ledger>
                {shown.map((card) => (
                  <ClusterRow
                    key={card.signature}
                    cluster={card}
                    to={href(`f/${encodeURIComponent(card.signature)}`)}
                    currentSeq={latest?.seq}
                  />
                ))}
              </Ledger>
            )}

            {rest.length === 0 ? null : (
              <Disclosure label="The rest of them" count={rest.length}>
                <Ledger>
                  {rest.map((card) => (
                    <ClusterRow
                      key={card.signature}
                      cluster={card}
                      to={href(`f/${encodeURIComponent(card.signature)}`)}
                      currentSeq={latest?.seq}
                    />
                  ))}
                </Ledger>
              </Disclosure>
            )}

            {untouched === 0 ? null : (
              <Inline gap={4} wrap>
                <Link size="ui" to={href("coverage")}>
                  {`${plural(untouched, "tool")} nobody reached for`}
                </Link>
              </Inline>
            )}
          </Stack>
        </Section>

        {worst === undefined || worst.cohorts.length === 0 ? null : (
          /*
            The worst problem's reach, cohort by cohort — the one reading on this screen a list
            row is not allowed to carry (§1.3 rule 10), and the element §5.4 fixes as this
            screen's single marked thing.
          */
          <Section
            title="Who the worst of it reached"
            trailing={`${worst.peopleHit} of ${people(worst.peopleTotal)}`}
          >
            <Stack gap={4} align="stretch">
              <Measure width="read">
                <Text as="p" size="read-sm" tone="soft">
                  {`“${worst.title}” — how far it got into each cohort.`}
                </Text>
              </Measure>
              <IncidenceBars cohorts={worst.cohorts} theOne={peak?.slug} />
              <Inline gap={4} wrap>
                <Link size="ui" to={href(`f/${encodeURIComponent(worst.signature)}`)}>
                  Read it in full
                </Link>
              </Inline>
            </Stack>
          </Section>
        )}

        {data.known.length === 0 ? null : (
          <Disclosure
            label="Problems you have already decided about"
            count={data.known.length}
          >
            <Ledger>
              {data.known.map((card) => (
                <ClusterRow
                  key={card.signature}
                  cluster={card}
                  to={href(`f/${encodeURIComponent(card.signature)}`)}
                  currentSeq={latest?.seq}
                />
              ))}
            </Ledger>
          </Disclosure>
        )}

        <Section title="Who we sent" trailing={plural(data.cohortBreakdown.length, "cohort")}>
          <Stack gap={4} align="stretch">
            <DataTable<RunCohort>
              rows={data.cohortBreakdown}
              keyOf={(cohort) => cohort.cohortSlug}
              caption="Every cohort in this execution, how many people it sent and how it went"
              empty="Nobody has been sent yet."
              columns={columns}
            />
            <Inline gap={4} wrap>
              {/*
                Two different questions, two links (ADR-0041, ADR-0043). Who went on THIS
                execution, by name, is a fact frozen in its snapshot and lives under the
                execution; who this study sends as it stands today is the study's People page,
                which is where the size is changed.
              */}
              {latest === undefined ? null : (
                <Link size="ui" to={href(`executions/${encodeURIComponent(latest.runId)}/cohorts`)}>
                  Who went, by name
                </Link>
              )}
              <Link size="ui" to={href("people")}>
                The people this study sends
              </Link>
              {data.stats.walkedAway === 0 ? null : (
                <Link size="ui" to={href("left")}>
                  Who walked away
                </Link>
              )}
            </Inline>
          </Stack>
        </Section>

        <Section
          title={study.mode === "longitudinal" ? "This execution's life" : "Executions"}
        >
          <ExecutionHistory results={data} limit={4} />
        </Section>
      </Stack>
    </DocumentPage>
  );
}

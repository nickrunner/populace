import { useId, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import type { TriageInput } from "@populace/contract";
import type { ClusterDetail } from "../api.js";
import { api, isMissing, isRefused } from "../api.js";
import { keys, q } from "../queries.js";
import { useProject, useStudy } from "../context.jsx";
import { people, plural, stateOfCluster } from "../format.js";
import { buildFixPrompt } from "@populace/fix-prompt";
import {
  Badge,
  Button,
  ConfirmButton,
  CopyButton,
  Dot,
  EvidenceSteps,
  Heading,
  IncidenceBars,
  Inline,
  Link,
  Measure,
  Mono,
  PageHeader,
  PayloadBlock,
  PersonQuoteCard,
  RelativeTime,
  ReplayVerdict,
  Section,
  Skeleton,
  SplitPage,
  Stack,
  StateBlock,
  Text,
  ToolName,
  Tooltip,
  SeverityTag,
  TriageForm,
  VerdictTag,
  VisuallyHidden,
  WhatWentWrong,
  type BadgeTone,
  type CohortIncidence,
  type Crumb,
  type MetaFact,
  type StateKind,
} from "../design/index.js";

/**
 * One problem, in full — and the first level of the product where a person is named (SPEC §7.1).
 *
 * The name appears as ATTRIBUTION. "Dana Whitfield" above a quote is what makes the quote a
 * person's account of something rather than an anonymous string, and it is exactly here that it
 * becomes information instead of decoration.
 *
 * The page is keyed by SIGNATURE, not by a cluster's position in one execution's digest: a
 * bookmark survives the next execution, and triage lands on the problem rather than on a row
 * (ADR-0028).
 *
 * Left is prose — their words, what they expected, what happened, and how far it reached. Right is
 * the instrument — the decision, the calls that produced it, what a judge got when it ran them
 * again, and what has become of it across executions. Neither is behind a mode.
 *
 * **`Verification.replay[]` is drawn here for the first time** (ATOMIC-INVENTORY §6.3, row 20).
 * The store has held the judge's fresh tool calls since the verifier existed and every screen
 * printed the verdict word and threw the receipts away — the strongest evidence this product has,
 * unrendered. `ReplayVerdict` puts them under the original steps, in the same `EvidenceSteps`
 * shape and aligned by index, so a reader can read the second list against the first line for
 * line rather than taking the verdict on trust.
 *
 * **The dot strip's count is in the DOM.** `AcrossExecutions` wrote one `●`/`○` per execution and
 * hid how many reports it stood for in a `title=` attribute — a tooltip on a hover-only surface,
 * invisible to a keyboard and to a screen reader (DESIGN-SYSTEM §6, "never colour alone"). Each
 * cell is now a sequence number, a mark and a number, all three of them real text.
 *
 * **The screen's one lime appearance** (§5.4, appearance 4) is fixed by name: *the confirmed
 * verdict's glyph*. The most recent execution whose replay came back `confirmed` takes the mark's
 * `theOne` dot — a lime fill inside a mandatory ink ring in light, a lime ring in dark. An
 * execution that did not report it stays a ring, because **an absence is an absence and never a
 * repair** (ADR-0028); the word "fixed" on this screen appears only inside `TriageForm`'s
 * decisions, where a human types it about their own product.
 *
 * **The last section on the right is the way OUT of this screen** — the evidence written as a
 * prompt for a coding assistant working on the reader's own product. It is here and nowhere else
 * because a prompt about one problem needs the whole of one problem: the reproduction call by
 * call, the reach, the intent, the verdict. `buildFixPrompt` assembles it in
 * `@populace/fix-prompt`, where the redaction and the clipping are tested; this screen draws the
 * string and says, in its own right and not only inside the string, how much of the transcript
 * was altered on the way.
 *
 * **Filing the problem as an issue lives in that same section, beside the copy control**
 * (ADR-0044). The reason is the reason the prompt is there: an issue about one problem needs the
 * whole of one problem, and this panel has already assembled it — the body github.com receives IS
 * that prompt, with the ledger's markers above it. So the two acts sit on one rule: hand it to an
 * assistant, or hand it to a tracker.
 *
 * **Once it is filed, the control is the issue.** `ClusterCardView.filedIssue` is populace's own
 * record of an outbound write it made, and it is on the CARD rather than only on `triage` because
 * filing writes no triage row — so a problem that has been filed and never ruled on has nowhere
 * else to say so. The screen never offers to file a second time: a problem reported again gets a
 * comment on the issue it already has, which is the whole point of the ledger.
 *
 * **Nothing here claims anything about the issue's own state.** populace knows it opened it; it
 * does not know whether somebody has closed it, fixed it, or read it. The copy says what populace
 * did and stops (§7.3).
 *
 * **Four sibling `<h2>`s become one `<h2>` per `Section`** with `<h3>`s beneath (§6, "Heading
 * order"), and the two divergent proportion markups become one `IncidenceBars`: a cohort nobody
 * in it hit reads `0/8` in the same column as the rest, rather than in a second list with its own
 * shape three paragraphs down.
 */

/**
 * What ink a cluster's state word takes. Read off the state rather than off `stateOfCluster`'s
 * `ink` class string: the words are the product's copy and are preserved verbatim, but a class
 * name is styling and a screen that reached for one would be reading a design decision out of a
 * string. `fixed` is deliberately quiet — an absence is not an alarm and not an achievement.
 */
const STATE_TONE = {
  new: "critical",
  regressed: "critical",
  open: "high",
  fixed: "neutral",
} satisfies Record<ClusterDetail["state"], BadgeTone>;

export function FindingInFull() {
  const { key, href: projectHref } = useProject();
  const { key: studyKey, study, href } = useStudy();
  const { signature = "" } = useParams();
  const cluster = useQuery(q.cluster(key, studyKey, signature));
  const results = useQuery(q.results(key, studyKey));
  /**
   * Where this project files, or `null` because nobody has connected anywhere yet — which is an
   * answer and not a failure to get one, so an unconnected project renders a sentence rather than
   * an error. It carries `tokenSet` and never a token (ADR-0040): all this screen needs to know is
   * whether there is something to file with, and it can be told that without being shown it.
   */
  const connection = useQuery(q.github(key));
  const queries = useQueryClient();

  /**
   * The decision, saved against the SIGNATURE. Unchanged from the panel this screen used to carry
   * its own copy of: the same endpoint, and the same four invalidations — the cluster, the
   * results it is a row of, the project's triage list and the project overview that counts it.
   */
  const save = useMutation({
    mutationFn: (triage: TriageInput) => api.setTriage(key, triage),
    onSuccess: async () => {
      await Promise.all([
        queries.invalidateQueries({ queryKey: keys.cluster(key, studyKey, signature) }),
        queries.invalidateQueries({ queryKey: keys.results(key, studyKey) }),
        queries.invalidateQueries({ queryKey: keys.triage(key) }),
        queries.invalidateQueries({ queryKey: keys.project(key) }),
      ]);
    },
  });

  /**
   * One problem, filed now. Synchronous, because one issue is one round trip and somebody who
   * pressed a button on this page wants the link rather than a job to watch.
   *
   * The same four invalidations the decision above sends, and for the same reason: the filing is
   * on the cluster's own card, on the row inside this study's results, on the project's triage
   * list — `TriageView.filedIssue` is the one project-keyed read that carries a filing — and in
   * the project overview that counts what has been dealt with.
   *
   * It is deliberately NOT thrown away on a `skipped` or a `failed` outcome. The route answers 200
   * for both, because the pass ran and its outcome is the answer; the sentence it carries is the
   * only place the reason lives, and a screen that treated a non-201 as nothing would swallow it.
   */
  const fileIssue = useMutation({
    mutationFn: () => api.fileIssue(key, studyKey, signature),
    onSuccess: async () => {
      await Promise.all([
        queries.invalidateQueries({ queryKey: keys.cluster(key, studyKey, signature) }),
        queries.invalidateQueries({ queryKey: keys.results(key, studyKey) }),
        queries.invalidateQueries({ queryKey: keys.triage(key) }),
        queries.invalidateQueries({ queryKey: keys.project(key) }),
      ]);
    },
  });

  /** The line the filing control names in `aria-describedby` when it is at a bound (§6.5). */
  const fileReasonId = useId();

  const crumbs: Crumb[] = [{ label: "Results", to: href() }];
  const card = cluster.data;

  /**
   * The prompt, assembled above the early return because hooks cannot be conditional — and
   * memoised because it walks every stored tool result through the redactor twice and would
   * otherwise do it on every keystroke in the triage note below.
   */
  const prompt = useMemo(() => (card === undefined ? null : buildFixPrompt(card)), [card]);

  if (card === undefined) {
    const state: StateKind = cluster.isPending
      ? "loading"
      : isMissing(cluster.error)
        ? "gone"
        : "failed";

    return (
      <SplitPage
        header={<PageHeader title="One problem" crumbs={crumbs} />}
        state={state}
        left={null}
        right={null}
        loading={
          <StateBlock
            kind="loading"
            what="this problem"
            skeleton={
              <Stack gap={6} align="stretch">
                <Skeleton variant="block" height={120} label="Reading this problem" />
                <Skeleton variant="row" count={4} height={96} label="Reading the evidence" />
              </Stack>
            }
          />
        }
        gone={
          // The state this screen never had. A signature that is not in this study is a
          // stale bookmark or a link from a sibling study, which is not a failure and must
          // not be dressed as one.
          <StateBlock kind="gone" what="this problem">
            No problem in this study carries that signature. The link may be from another
            study, or from an execution whose reports have been swept.{" "}
            <Link to={href()}>Open the results</Link> to see what is there.
          </StateBlock>
        }
        error={
          <StateBlock kind="failed" what="this problem" error={cluster.error}>
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
      />
    );
  }

  const seqs = (results.data?.history ?? []).map((entry) => entry.seq).sort((a, b) => a - b);
  const state = stateOfCluster(card, study.mode, seqs);
  const representative = card.representative;

  /**
   * Where this problem would go, once it is known. `undefined` is the read not having landed and
   * `null` is the project having connected nowhere, and the two are different sentences — which is
   * why neither is collapsed into the other here.
   */
  const where = connection.data ?? null;

  /**
   * Why filing cannot be pressed, or `undefined`. These are the server's own two refusals
   * (`notConnected` in `control.ts`) said before the round trip rather than after it, so the
   * reader learns there is nowhere to file from the page they are on instead of from a failure.
   *
   * It is local knowledge and can trail the server — a token forgotten in another tab is gone
   * before this read knows — so a refusal that does arrive is shown below in the server's own
   * words rather than folded into this sentence.
   */
  const fileBound: string | undefined = connection.isPending
    ? "populace is still reading where this project files."
    : connection.isError
      ? "populace could not read where this project files, so it will not send anything anywhere."
      : where === null || where.repo === ""
        ? "This project has no repository to file into."
        : !where.tokenSet
          ? `populace has ${where.repo} to file into, and no token to file with.`
          : undefined;

  /**
   * The connection this screen may actually file with, or null — the same test `fileBound` makes,
   * written as a value. It exists so the confirm body can name the repository and read its
   * visibility without the compiler being asked to take a sentence's word for it.
   */
  const fileTo = where !== null && where.repo !== "" && where.tokenSet ? where : null;

  /**
   * One column of proportions, not two. `cohorts` carries the cohorts somebody in them hit, and
   * `peopleMissed` counts everybody who did not — including, for a cohort nobody in it hit at all,
   * the whole cohort. Those are the only rows the first list cannot show, so they join it as
   * `0 of N` rather than becoming a second list with its own shape (organism 22).
   */
  const hitCohorts = new Set(card.cohorts.map((cohort) => cohort.slug));
  const incidence: CohortIncidence[] = [
    ...card.cohorts,
    ...card.peopleMissed
      .filter((missed) => !hitCohorts.has(missed.cohortSlug))
      .map((missed) => ({ slug: missed.cohortSlug, name: missed.name, hit: 0, total: missed.count })),
  ];

  const facts: MetaFact[] = [
    { key: "severity", node: <SeverityTag level={card.severity} kind={card.kind} /> },
    {
      key: "tool",
      node:
        card.tool === null ? null : (
          <ToolName name={card.tool} missing={card.kind === "coverage-gap"} />
        ),
    },
    { key: "verdict", node: <VerdictTag value={card.verdict ?? "unchecked"} /> },
    {
      key: "state",
      node: (
        <Badge variant="status" tone={STATE_TONE[card.state]}>
          <VisuallyHidden>this problem is </VisuallyHidden>
          {state.badge}
        </Badge>
      ),
    },
    { key: "detail", node: state.detail },
    { key: "reports", node: plural(card.reports, "report") },
    { key: "signature", node: <Mono size="ref">{card.signature}</Mono> },
  ];

  return (
    <SplitPage
      header={
        <PageHeader title={card.title} crumbs={[...crumbs, { label: card.title }]} meta={facts} />
      }
      left={
        <Stack gap={8} align="stretch">
          <Section title="In their own words" trailing={card.quotes.length}>
            {card.quotes.length === 0 ? (
              <StateBlock kind="empty" what="their own words">
                Nobody wrote this one up in their own words.
              </StateBlock>
            ) : (
              <Stack gap={4} align="stretch">
                {card.quotes.map((quote) => (
                  <Stack key={`${quote.personId}-${quote.wakeId}`} gap={2} align="stretch">
                    <PersonQuoteCard
                      name={quote.name}
                      words={quote.text}
                      cohort={quote.cohortName || quote.cohortSlug}
                      visit={quote.visitNumber}
                      to={href(`people/${encodeURIComponent(quote.personId)}`)}
                    />
                    <Inline gap={4} wrap>
                      <Link size="meta" to={href(`visits/${encodeURIComponent(quote.wakeId)}`)}>
                        watch the visit they said it on
                      </Link>
                    </Inline>
                  </Stack>
                ))}
              </Stack>
            )}
          </Section>

          <Section title="What they ran into">
            <Stack gap={6} align="stretch">
              <Stack gap={2} align="stretch">
                <Heading level={3} size="name">
                  They expected
                </Heading>
                <Measure width="read">
                  <Text as="p" size="read" tone="soft">
                    {representative.expected}
                  </Text>
                </Measure>
              </Stack>

              <Stack gap={2} align="stretch">
                <Heading level={3} size="name">
                  What happened
                </Heading>
                <Measure width="read">
                  <Text as="p" size="read" tone="soft">
                    {representative.observed}
                  </Text>
                </Measure>
              </Stack>
            </Stack>
          </Section>

          <Section
            title="Who hit it"
            trailing={`${card.peopleHit.length} of ${people(card.peopleTotal)}`}
          >
            <Stack gap={4} align="stretch">
              {incidence.length === 0 ? (
                <StateBlock kind="empty" what="the breakdown">
                  This execution has no cohort breakdown to draw.
                </StateBlock>
              ) : (
                <IncidenceBars cohorts={incidence} />
              )}
              <Inline gap={4} wrap>
                <Link size="ui" to={href(`f/${encodeURIComponent(card.signature)}/people`)}>
                  {`All ${people(card.peopleHit.length)} who hit this`}
                </Link>
              </Inline>
            </Stack>
          </Section>
        </Stack>
      }
      right={
        <Stack gap={8} align="stretch">
          <Section title="Your decision" level={2}>
            <Stack gap={3} align="stretch">
              <TriageForm
                signature={card.signature}
                current={card.triage}
                drifted={card.triage?.drifted ?? false}
                onSave={(triage) => {
                  save.mutate(triage);
                }}
              />
              {save.error === null ? null : (
                <WhatWentWrong
                  says="The decision was not saved, so this problem still carries whatever it carried before."
                  error={save.error}
                />
              )}
            </Stack>
          </Section>

          <Section
            title="Evidence"
            actions={
              <Link
                size="meta"
                to={href(`visits/${encodeURIComponent(card.representative.wakeId)}`)}
              >
                open the full visit
              </Link>
            }
          >
            <Stack gap={8} align="stretch">
              <EvidenceSteps steps={card.reproduction} />

              {card.replay === null ? (
                <Stack gap={2} align="stretch">
                  <Heading level={3} size="name">
                    We have not replayed this yet
                  </Heading>
                  <Measure width="read">
                    <Text as="p" size="read" tone="soft">
                      Build the digest with verification on, and the judge runs these calls again
                      itself and rules on what comes back.
                    </Text>
                  </Measure>
                </Stack>
              ) : (
                <ReplayVerdict verification={card.replay} />
              )}
            </Stack>
          </Section>

          {prompt === null ? null : (
            <Section
              title="Hand it to a coding assistant"
              actions={
                /*
                  Two acts on one rule, both of them handing this problem somewhere else: to an
                  assistant through the clipboard, or to github.com as an issue. The second is here
                  and not in the header's `actions` slot for the reason the prompt is here — an
                  issue about one problem needs the whole of one problem, and this is the panel that
                  assembled it.
                */
                <Inline gap={3} align="center" wrap>
                  <CopyButton text={prompt.text} label="Copy the prompt" />
                  {card.filedIssue !== null ? (
                    /*
                      Filed, so the control IS the issue: there is nothing left to press, and
                      offering the press again would offer a second issue for one problem. The
                      name is the publisher's own spelling, `owner/repo#41`, and the `url` comes
                      off `FiledIssueSchema` where it is a parsed `z.url()` — so this is an href
                      the contract has already vouched for.
                    */
                    <Link size="meta" href={card.filedIssue.url}>
                      {`${card.filedIssue.repo}#${String(card.filedIssue.number)}`}
                    </Link>
                  ) : fileTo === null ? (
                    /*
                      At a bound, never disabled: `atBound` keeps the tab stop, the accessible name
                      and the tooltip, and the reason is also a line in the body below that
                      `aria-describedby` points at — a dead button with the reason in a hover is
                      the failure §6.5 exists to forbid.
                    */
                    <Tooltip content={fileBound}>
                      <Button
                        variant="secondary"
                        size="sm"
                        atBound
                        aria-describedby={fileReasonId}
                      >
                        File as a GitHub issue
                      </Button>
                    </Tooltip>
                  ) : (
                    <ConfirmButton
                      title="File this as an issue?"
                      variant="primary"
                      confirmLabel="File it"
                      pending={fileIssue.isPending}
                      onConfirm={() => {
                        fileIssue.mutate();
                      }}
                      body={
                        <Stack gap={3} align="stretch">
                          <span>
                            populace opens one issue in <Mono size="ref">{fileTo.repo}</Mono>. Its
                            body is the prompt on this page: the calls in order with their arguments
                            and their results, the people&rsquo;s own words, the product&rsquo;s own
                            description, and what everybody in each cohort that hit this had been
                            told they were in the middle of.
                          </span>
                          {fileTo.visibility === "public" ? (
                            /*
                              The honest limit, and it is not softened anywhere. `withoutAddresses`
                              reduces every absolute URL whose host is one of THIS target's own —
                              in the endpoint list and inside the quoted results alike, each one
                              marked where it was reduced. It reduces nothing else, and it is not
                              a scrubber: the description and the briefs are what make the report
                              actionable and they go out as written, which is exactly what naming
                              the repository as public is asking somebody to take on knowingly.
                            */
                            <span>
                              That repository is public, so anybody can read what goes into it.
                              populace first reduces every address this target is known by to its
                              bare host — in the endpoint list and inside the quoted results alike,
                              each reduction marked where it was made. Nothing else is reduced: the
                              product&rsquo;s description and every cohort&rsquo;s brief go out
                              exactly as written, and anything else the product printed in its own
                              output is left as the product printed it.
                            </span>
                          ) : (
                            <span>
                              {fileTo.visibility === "private"
                                ? "The last check found that repository private, so the address and the briefs go out as written."
                                : "Nobody has checked yet whether that repository is world-readable. Check it in the project’s settings if it matters that the address and the briefs go out as written."}
                            </span>
                          )}
                        </Stack>
                      }
                    >
                      <Button variant="secondary" size="sm" disabled={fileIssue.isPending}>
                        File as a GitHub issue
                      </Button>
                    </ConfirmButton>
                  )}
                </Inline>
              }
            >
              <Stack gap={4} align="stretch">
                <Measure width="read">
                  <Text as="p" size="read" tone="soft">
                    Everything on this page, written for a coding assistant working on your product
                    rather than on this one: the calls in order with their arguments and their
                    results, who was trying to do what, and — before any of it — that this is a
                    simulated user&rsquo;s report and not a confirmed defect.
                  </Text>
                </Measure>

                {/*
                  In the payload well rather than in prose, because it is a payload: it is read to
                  be checked and then copied whole.

                  **The well keeps its own corner control, and the section rule keeps its button.**
                  This well used to pass `copyable={false}`, reasoning that a hover-only affordance
                  cannot be the only way to reach the one thing the section exists for
                  (DESIGN-SYSTEM §6). True, and already answered by the `CopyButton` in the rule
                  above, which is always drawn — so switching the corner off bought nothing and
                  cost the habit: this was the single `PayloadBlock` in the product without the
                  control every other well has in the same place, which reads as a bug at exactly
                  the moment somebody reaches for it. Two controls, one clipboard, and the visible
                  one is still visible. Both put the same string on it: the prompt opens `#`, so
                  the well's `prettyPrint` returns it verbatim rather than reshaping it as JSON.
                */}
                <PayloadBlock caption="The prompt" value={prompt.text} />

                {/*
                  Said on the screen as well as inside the prompt. Somebody about to paste this
                  into a chat window is owed the sentence before they press, not after — this is
                  the point where a bearer token would leave the product if the redactor had
                  missed one.
                */}
                <Measure width="read">
                  <Text as="p" size="meta" tone="muted">
                    {prompt.redactions === 0
                      ? "Nothing in it matched a credential shape, so nothing was removed."
                      : `${plural(prompt.redactions, "value")} that looked like a credential ${prompt.redactions === 1 ? "was" : "were"} replaced with a marker before it left populace.`}
                    {prompt.clips === 0
                      ? ""
                      : ` ${plural(prompt.clips, "result")} ${prompt.clips === 1 ? "was" : "were"} too long to include whole and ${prompt.clips === 1 ? "was" : "were"} cut from the middle, each marked where it was cut.`}
                  </Text>
                </Measure>

                {/*
                  Everything the filing control cannot say from inside a rule: why it is at a bound
                  and where to go about it, what populace did the last time it was pressed, and a
                  refusal in the server's own words.

                  The bound's sentence is here rather than only in the tooltip because that is what
                  `aria-describedby` on the control above points at (§6.5) — a reason a keyboard
                  reader can reach, not a reason a pointer can hover.
                */}
                <Stack gap={2} align="stretch">
                  {card.filedIssue === null ? (
                    fileBound === undefined ? null : (
                      <Measure width="read">
                        <Text as="p" size="meta" tone="muted" id={fileReasonId}>
                          {`${fileBound} `}
                          {connection.isPending ? null : (
                            <Link size="meta" to={projectHref("settings")}>
                              Set one up in this project&rsquo;s settings
                            </Link>
                          )}
                        </Text>
                      </Measure>
                    )
                  ) : (
                    <Measure width="read">
                      <Text as="p" size="meta" tone="muted">
                        populace opened that issue{" "}
                        <RelativeTime at={card.filedIssue.filedAt} mode="ago" /> and will comment on
                        it if this is reported again, rather than opening a second one. What has
                        become of it since is github.com&rsquo;s to say, not populace&rsquo;s.
                      </Text>
                    </Measure>
                  )}

                  {/*
                    What the pass actually did, in the server's sentence. A `skipped` and a `failed`
                    both answer 200 — the pass ran, and its outcome is the answer — so this is the
                    only place the reason appears, and `failed` carries github.com's own words.
                  */}
                  {fileIssue.data === undefined ? null : (
                    <Measure width="read">
                      <Text
                        as="p"
                        size="meta"
                        tone={fileIssue.data.outcome === "failed" ? "critical" : "muted"}
                      >
                        {fileIssue.data.summary}
                      </Text>
                    </Measure>
                  )}

                  {fileIssue.error === null ? null : (
                    <WhatWentWrong
                      says={
                        isRefused(fileIssue.error)
                          ? "Nothing was filed: the server declined, and says why below. This problem still carries whatever it carried before."
                          : "Nothing was filed. This problem still carries whatever it carried before."
                      }
                      error={fileIssue.error}
                    />
                  )}
                </Stack>
              </Stack>
            </Section>
          )}

          <AcrossExecutions card={card} mode={study.mode} seqs={seqs} />
        </Stack>
      }
    />
  );
}

/**
 * Which executions reported it, as a strip. The dots are the evidence for the state word in the
 * header, and every cell says in text what its mark says in shape: the execution's number, the
 * mark, and how many reports it stood for.
 *
 * **The number used to live in `title=`**, which is a tooltip on a hover-only surface: a keyboard
 * reader could not reach it and a screen reader was never offered it (§6, "never colour alone").
 * It is in the DOM now, and the mark beside it is `aria-hidden` because the two say the same
 * thing and a reader should hear it once.
 *
 * **An execution that did not report it is a ring, and that is all it is.** The sentence beneath
 * says so in words as well, because a strip of rings is exactly the picture somebody wants to read
 * as "we fixed it" and the product cannot know that (ADR-0028).
 */
function AcrossExecutions({
  card,
  mode,
  seqs,
}: {
  card: ClusterDetail;
  mode: "ephemeral" | "longitudinal";
  /**
   * The study's real execution sequence numbers. It is a PROP rather than a `[]` rebuilt here,
   * because `stateOfCluster` no longer branches on `mode` -- it asks `executionScoped` whether the
   * card's two ordinal lists describe the same stretches (format.ts), which is the one place that
   * judgement lives. A longitudinal study whose lists agree therefore reaches the execution-scoped
   * arm, and that arm divides by `seqs.length`: passing `[]` printed "reported in 2 of 0
   * executions" for a study stopped and restarted once. The denominator has to be the real one.
   */
  seqs: number[];
}) {
  if (mode === "longitudinal") {
    const words = stateOfCluster(card, mode, seqs);
    return (
      <Section title="Over this execution">
        <Measure width="read">
          <Text as="p" size="read" tone="soft">
            {words.detail}
          </Text>
        </Measure>
      </Section>
    );
  }

  const seen = new Set(card.seenIn);
  /**
   * The screen's one lime appearance (§5.4, appearance 4): *the confirmed verdict's glyph*. The
   * most recent execution whose replay came back `confirmed` — one execution, because "exactly
   * one" is what the rule says, and the most recent one because that is the reading the reader
   * came for.
   */
  const theOne = [...card.history]
    .reverse()
    .find((entry) => entry.reports > 0 && entry.verdict === "confirmed");

  return (
    <Section title="Across executions" trailing={`${seen.size} of ${card.history.length}`}>
      <Stack gap={4} align="stretch">
        <ul className="flex flex-wrap gap-4">
          {card.history.map((entry) => (
            <li key={entry.runId} className="flex flex-col items-center gap-1">
              <Text size="meta" tone="muted">
                <VisuallyHidden>execution </VisuallyHidden>
                {entry.seq}
              </Text>
              <Dot
                state={
                  entry.reports === 0
                    ? "absent"
                    : entry.runId === theOne?.runId
                      ? "theOne"
                      : "present"
                }
                size="md"
              />
              <Text size="meta" tone={entry.reports === 0 ? "muted" : "ink"}>
                {entry.reports}
                <VisuallyHidden>{entry.reports === 1 ? " report" : " reports"}</VisuallyHidden>
              </Text>
            </li>
          ))}
        </ul>

        <Measure width="read">
          <Text as="p" size="read" tone="soft">
            {seen.size === card.history.length
              ? "Reported in every execution this study has had."
              : `Reported in ${seen.size} of ${card.history.length} executions. An execution that did not report it is an absence, not a repair — the same complaint worded differently is a different key.`}
          </Text>
        </Measure>
      </Stack>
    </Section>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import type { TriageInput } from "@populace/contract";
import type { ClusterDetail } from "../api.js";
import { api, isMissing } from "../api.js";
import { keys, q } from "../queries.js";
import { useProject, useSimulation } from "../context.jsx";
import { people, plural, stateOfCluster } from "../format.js";
import {
  Badge,
  Button,
  Dot,
  EvidenceSteps,
  Heading,
  IncidenceBars,
  Inline,
  Link,
  Measure,
  Mono,
  PageHeader,
  PersonQuoteCard,
  ReplayVerdict,
  Section,
  Skeleton,
  SplitPage,
  Stack,
  StateBlock,
  Text,
  ToolName,
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
  const { key } = useProject();
  const { key: sim, simulation, href } = useSimulation();
  const { signature = "" } = useParams();
  const cluster = useQuery(q.cluster(key, sim, signature));
  const results = useQuery(q.results(key, sim));
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
        queries.invalidateQueries({ queryKey: keys.cluster(key, sim, signature) }),
        queries.invalidateQueries({ queryKey: keys.results(key, sim) }),
        queries.invalidateQueries({ queryKey: keys.triage(key) }),
        queries.invalidateQueries({ queryKey: keys.project(key) }),
      ]);
    },
  });

  const crumbs: Crumb[] = [{ label: "Results", to: href() }];
  const card = cluster.data;

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
          // The state this screen never had. A signature that is not in this simulation is a
          // stale bookmark or a link from a sibling simulation, which is not a failure and must
          // not be dressed as one.
          <StateBlock kind="gone" what="this problem">
            No problem in this simulation carries that signature. The link may be from another
            simulation, or from an execution whose reports have been swept.{" "}
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
  const state = stateOfCluster(card, simulation.mode, seqs);
  const representative = card.representative;

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

          <AcrossExecutions card={card} mode={simulation.mode} />
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
}: {
  card: ClusterDetail;
  mode: "ephemeral" | "longitudinal";
}) {
  if (mode === "longitudinal") {
    const words = stateOfCluster(card, mode, []);
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
              ? "Reported in every execution this simulation has had."
              : `Reported in ${seen.size} of ${card.history.length} executions. An execution that did not report it is an absence, not a repair — the same complaint worded differently is a different key.`}
          </Text>
        </Measure>
      </Stack>
    </Section>
  );
}

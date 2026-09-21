import { useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { q } from "../queries.js";
import { useProject, useSimulation } from "../context.jsx";
import { people, plural } from "../format.js";
import {
  Badge,
  Card,
  CardHeader,
  Chip,
  CohortCapsule,
  ConfirmButton,
  CostEstimate,
  costBasisOf,
  DocumentPage,
  Button,
  FieldError,
  Inline,
  Ledger,
  LedgerRow,
  MetaLine,
  Money,
  Mono,
  PageHeader,
  PayloadBlock,
  Section,
  Skeleton,
  Stack,
  Stat,
  StateBlock,
  Text,
  ToolName,
  Tooltip,
  visitPlanOf,
  type LatticeDot,
  type StateKind,
} from "../design/index.js";

/**
 * "I just set this up — did I set it up right?"
 *
 * Who is going, what they will meet when they get there, what it will cost, and — the part
 * nothing else in the product shows — the actual system prompt one of them will be given, word
 * for word, rendered by the runner's own code rather than by a second copy of it.
 *
 * Cohorts are named here; people are not, except as the three sample names that prove the cast is
 * real before a penny is spent (SPEC §7.6).
 *
 * **Ported to the design system** — ATOMIC-INVENTORY §6.3, row 13. This is the screen that saves
 * the reader money, so the four figures are a `CostEstimate` at the top of the reading column
 * rather than a hand-rolled `grid-cols-4` — the strip, the sub-lines and the basis sentence come
 * from the organism, and the one figure that is this screen's alone rides in as its `trailing`.
 * The act that spends the money goes through a `ConfirmButton`: "Send them in" is the one press in
 * the product that turns a configuration into a bill, and §5.4 gives this screen's single lime
 * appearance to that button and to nothing else.
 *
 * **It is in the rail** (§6.3 row 13, "promote it"). It was a footnote link inside `GetStarted`'s
 * last step, which meant the only way to read what an execution will cost was to already be
 * halfway through setting one up. It is a row in the simulation's own navigation group now, so it
 * is reachable from anywhere inside the simulation, including from the results of the last one.
 *
 * **Each cohort is drawn as the mark draws one** (DESIGN-SYSTEM §1.2 M4). The hand-sized 420px
 * proportion bar is gone: a `CohortCapsule`'s length *is* its headcount, so a column of them is a
 * population read at a glance, and every person in it is a `provisional` dot — the grammar's own
 * word for *this has not happened yet*, which is the honest drawing of a cast that has not left
 * yet (§8.6).
 *
 * Nothing here promises what will come back. The estimate names its own basis, the mode paragraph
 * says outright that the numbers move between executions, and neither is softened (§7.3).
 */

/**
 * One dot per person going, none of whom has been anywhere yet. The sample names the wire already
 * sends do the labelling for as far as they reach; past them a dot is somebody in this cohort
 * rather than a number, because a person without a name is exactly what this screen exists to
 * disprove.
 */
function castOf(cohort: {
  slug: string;
  name: string;
  people: number;
  sampleNames: readonly string[];
}): readonly LatticeDot[] {
  return Array.from({ length: cohort.people }, (_, index) => ({
    id: `${cohort.slug}#${String(index)}`,
    state: "provisional" as const,
    label: cohort.sampleNames[index] ?? `somebody in ${cohort.name}`,
  }));
}

export function Preflight() {
  const { key, href } = useProject();
  const { key: simKey, simulation, href: simHref } = useSimulation();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const preflight = useQuery(q.preflight(key, simKey));

  const start = useMutation({
    mutationFn: () => api.startRun(key, simKey, {}),
    onSuccess: async () => {
      await queries.invalidateQueries();
      void navigate(simHref("live"));
    },
  });

  const startErrorId = useId();

  const view = preflight.data;
  const blockersId = useId();
  const ready = view !== undefined && view.blockers.length === 0;
  const running = view?.simulation.status === "running";

  const state: StateKind | undefined = preflight.isPending
    ? "loading"
    : preflight.isError
      ? "failed"
      : undefined;

  return (
    <DocumentPage
      header={
        <PageHeader
          title="Before you send them"
          crumbs={[
            { label: "Simulations", to: href() },
            { label: simulation.name, to: simHref() },
            { label: "Before you send them" },
          ]}
          lede={
            view === undefined
              ? "Nothing on this page spends anything."
              : `${people(view.totalPeople)} ${view.totalPeople === 1 ? "is" : "are"} about to visit ${view.target.name}. Nothing on this page spends anything.`
          }
          status={running ? <Chip tone="live">already running</Chip> : undefined}
        />
      }
      state={state}
      loading={
        <StateBlock
          kind="loading"
          what="what is about to happen"
          skeleton={
            <Skeleton
              variant="block"
              count={3}
              height={120}
              label="Reading what is about to happen"
            />
          }
        />
      }
      error={
        <StateBlock kind="failed" what="what is about to happen" error={preflight.error} />
      }
    >
      {view === undefined ? null : (
        <Stack gap={12}>
          {view.blockers.length === 0 ? null : (
            // The id is what attaches this list to the control it stops: "Send them in" names
            // it in `aria-describedby`, so a reader who reaches the button is told why it will
            // not go, instead of meeting an unexplained dead control (§6).
            <div id={blockersId}>
              <Card tone="sunk" pad="roomy">
                <CardHeader
                  title="Not yet."
                  sub="Each of these stops the execution starting. Nothing is sent until they are all gone."
                  level={2}
                />
                <Ledger as="ol">
                  {view.blockers.map((blocker, index) => (
                    <LedgerRow
                      key={blocker}
                      stub={
                        <Text size="meta" tone="muted">
                          {index + 1}
                        </Text>
                      }
                    >
                      <Text size="read" tone="soft" as="p">
                        {blocker}
                      </Text>
                    </LedgerRow>
                  ))}
                </Ledger>
              </Card>
            </div>
          )}

          {/*
            The estimate, as the one organism that knows how to say it (§6.3 rows 6 and 13).
            This screen carried the third of four hand-rolled copies, with a `basisOf()` verbatim
            from `People`; the strip, the sub-lines and the basis sentence all live in the
            organism now. The range travels because this estimate is the server's own, drawn
            around exactly the plan below it — nothing on this screen can change the headcount.
            The fourth figure is this screen's alone, so it rides in as the strip's `trailing`.
          */}
          <CostEstimate
            people={view.totalPeople}
            cohorts={view.cohorts.length}
            plan={visitPlanOf(view.estimate, view.simulation.visitsPerPerson)}
            basis={costBasisOf(view.estimate, true)}
            trailing={
              <Stat
                label="Tools they will meet"
                value={view.target.tools.length}
                sub={
                  view.target.resets
                    ? "the target can be put back"
                    : "the target cannot be reset"
                }
              />
            }
          />

          <Section title="Who is going" trailing={people(view.totalPeople)}>
            <Stack gap={6}>
              <Text size="read-sm" tone="soft" as="p">
                By cohort — nobody is picked out until they find something.
              </Text>

              <Stack gap={4}>
                {view.cohorts.map((cohort) => (
                  <Stack key={cohort.slug} gap={1}>
                    <CohortCapsule
                      name={cohort.name}
                      dots={castOf(cohort)}
                      total={cohort.people}
                    />
                    <MetaLine
                      facts={[
                        { key: "persona", node: cohort.personaName },
                        { key: "slug", node: <Mono size="code-sm">{cohort.slug}</Mono> },
                        ...(cohort.sampleNames.length === 0
                          ? []
                          : [
                              {
                                key: "cast",
                                node: `${cohort.sampleNames.join(", ")}${cohort.people > cohort.sampleNames.length ? " and the rest" : ""}`,
                              },
                            ]),
                      ]}
                    />
                  </Stack>
                ))}
              </Stack>
            </Stack>
          </Section>

          <Section
            title="What they will find when they get there"
            trailing={view.target.name}
          >
            <Stack gap={4}>
              {/* Not `medium`: the four severity tokens mean severity and nothing else (§4.1),
                  and a target warning is not a finding with a level — it is a fact about what
                  this run will and will not be able to do. The word arrives in a `Badge`, which
                  is what §4.2 asks of any state, and the ink stays the reading ink. */}
              {view.target.warnings.map((warning) => (
                <Inline key={warning} gap={2} align="baseline">
                  <Badge variant="kind">heads up</Badge>
                  <Text size="read" as="p" className="min-w-0">
                    {warning}
                  </Text>
                </Inline>
              ))}

              {view.target.undescribed.length === 0 ? null : (
                <Text size="read-sm" tone="soft" as="p">
                  {view.target.undescribed.length === 1
                    ? "One tool has no description"
                    : `${view.target.undescribed.length} tools have no description`}
                  , so people will most likely never reach for{" "}
                  {view.target.undescribed.length === 1 ? "it" : "them"}:{" "}
                  {view.target.undescribed.join(", ")}.
                </Text>
              )}

              <Card>
                {view.target.tools.length === 0 ? (
                  <Text size="read" tone="muted" as="p">
                    The target did not answer with a tool list.
                  </Text>
                ) : (
                  <Inline gap={3} wrap>
                    {view.target.tools.map((tool) => (
                      <ToolName key={tool} name={tool} />
                    ))}
                  </Inline>
                )}
              </Card>

              {view.target.blocked.length === 0 ? null : (
                <Stack gap={3}>
                  <Text size="read-sm" tone="soft" as="p">
                    {view.target.blocked.length === 1
                      ? "One tool it exposes is off limits"
                      : `${view.target.blocked.length} tools it exposes are off limits`}
                    , so whatever they are for will go untested. This is what a tool policy does;
                    it is here so a typo&rsquo;d glob is not discovered as a silence in the digest
                    tomorrow.
                  </Text>

                  <Ledger as="ol">
                    {view.target.blocked.map((tool, index) => (
                      <LedgerRow
                        key={tool.name}
                        stub={
                          <Text size="meta" tone="muted">
                            {index + 1}
                          </Text>
                        }
                      >
                        <Stack gap={1}>
                          <ToolName name={tool.name} />
                          <MetaLine
                            facts={[
                              { key: "why", node: tool.why },
                              { key: "who", node: `blocked for ${tool.who}` },
                            ]}
                          />
                        </Stack>
                      </LedgerRow>
                    ))}
                  </Ledger>
                </Stack>
              )}

              <Text size="read-sm" tone="soft" as="p">
                {view.target.destructive === "deny"
                  ? "Nobody may use a tool the target marks destructive."
                  : view.target.destructive === "allow"
                    ? "Tools the target marks destructive go through without a second thought."
                    : "A tool the target marks destructive takes two identical calls: the first comes back asking whether they meant it."}
              </Text>

              <Text size="read-sm" tone="soft" as="p">
                {view.target.resets
                  ? "This target can be put back the way it was between executions, so an ephemeral run really is a clean slate on both sides."
                  : "This target declares no way to be put back, so a clean slate means fresh people, memory and accounts — not fresh data on the server."}
              </Text>
            </Stack>
          </Section>

          <Section
            title="What one of them will actually be told"
            trailing={
              <MetaLine
                facts={[
                  { key: "person", node: view.promptPreview.personName || "a person" },
                  {
                    key: "cohort",
                    node: <Mono size="code-sm">{view.promptPreview.cohortSlug}</Mono>,
                  },
                ]}
              />
            }
          >
            <Stack gap={2}>
              <PayloadBlock
                caption="What they will be told"
                value={view.promptPreview.text}
              />
              <Text size="meta" tone="muted" as="p">
                Rendered by the same code that builds it at run time. Their memory and their
                account arrive in the first message of each visit, after this.
              </Text>
            </Stack>
          </Section>

          {start.isError ? (
            <Stack gap={2}>
              <FieldError id={startErrorId}>
                Nobody was sent, and nothing has been spent. The machine&rsquo;s own words are
                below.
              </FieldError>
              <PayloadBlock caption="What came back" value={start.error.message} error />
            </Stack>
          ) : null}

          <Card pad="roomy">
            <Inline gap={6} align="center" wrap>
              <Text size="read" tone="soft" as="p" className="min-w-0 flex-1">
                {view.simulation.mode === "ephemeral"
                  ? "Everyone arrives remembering nothing and stops when their visits are used up. Run it again later and it starts over — different people will try different things, so expect the numbers to move even when nothing has changed."
                  : "They keep coming back, building on what they remember, until you pause it."}
              </Text>

              {ready ? (
                <ConfirmButton
                  title="Send them in?"
                  body={
                    <>
                      {people(view.totalPeople)} start visiting {view.target.name}
                      {view.estimate.bounded
                        ? `, ${plural(view.plannedVisits, "visit")} in all`
                        : ", and they keep coming back until you stop them"}. This spends real
                      money — about <Money usd={view.estimate.expectedUsd} />, and the ceilings in
                      settings are what actually stop it, whatever that arithmetic says.
                    </>
                  }
                  confirmLabel="Send them in"
                  variant="primary"
                  pending={start.isPending}
                  onConfirm={() => {
                    start.mutate();
                  }}
                >
                  <Button
                    variant="primary"
                    className="shrink-0"
                    disabled={start.isPending || running}
                  >
                    Send them in
                  </Button>
                </ConfirmButton>
              ) : (
                // At a bound, not gone: the button keeps its tab stop, its name and its tooltip
                // and swallows the press, and it points at the list of blockers far up the page
                // rather than leaving the reader to go looking for the reason (§6).
                <Tooltip
                  content={
                    view.blockers.length === 1
                      ? "One thing still stops this. It is listed at the top of the page."
                      : `${String(view.blockers.length)} things still stop this. They are listed at the top of the page.`
                  }
                >
                  <Button
                    variant="primary"
                    className="shrink-0"
                    atBound
                    aria-describedby={blockersId}
                  >
                    Send them in
                  </Button>
                </Tooltip>
              )}
            </Inline>
          </Card>
        </Stack>
      )}
    </DocumentPage>
  );
}

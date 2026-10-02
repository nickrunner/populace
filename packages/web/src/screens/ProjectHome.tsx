import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";

import { api, type Need, type ProjectOverview, type StudySummary } from "../api.js";
import { keys, q } from "../queries.js";
import { useProject } from "../context.jsx";
import { people, plural } from "../format.js";
import {
  AlertDialog,
  Badge,
  Button,
  Checkbox,
  Chip,
  DocumentPage,
  Dot,
  DropdownMenu,
  Heading,
  IconButton,
  Inline,
  Ledger,
  LedgerRow,
  Link,
  MetaLine,
  Money,
  PageHeader,
  RelativeTime,
  Ring,
  Section,
  SeverityStack,
  SeverityTag,
  Spacer,
  Stack,
  StateBlock,
  StudyActions,
  Text,
  WhatWentWrong,
  type MetaFact,
} from "../design/index.js";

/**
 * The Studies dashboard — the project's home (ADR-0043, D5).
 *
 * Level one of three (SPEC §7.1): studies and their headline results, and NOT ONE PERSON'S NAME.
 * The payload has nowhere to put one — `ProjectOverviewView` carries headcounts and cohort counts
 * — so this screen cannot break the rule without asking for more than it was given.
 *
 * **What the page shows, in every state the project is in:**
 *
 *  1. The header: what the project is made of and what it is costing, with the one primary act a
 *     dashboard of studies has — a new study.
 *  2. **What needs doing**, from `SetupStatus.needs`. Every need is a row that GOES somewhere: the
 *     web derives the link from the need's id and scope (D7), because a browser route in a server
 *     payload is a routing table maintained in two places, and this product moves its routes.
 *  3. The studies, as a ledger, each row the study's own results page. With one target this is one
 *     flat ledger; with two it is one section per target, because five rows in store order tell a
 *     reader nothing about the thing they most want to know — "three at dev, two at qa" — and a
 *     study IS the pairing of a target and a population, so the target is the axis that groups.
 *  4. What has shown up in more than one study, once there are two. Unchanged.
 *
 * ---
 *
 * **AMENDED — the Targets and Who-can-go bands, the `PairingsGrid` and the `FirstRun` panel are
 * gone** (ADR-0043). They were three more voices on a page whose subject is the studies: each
 * target and each population has a list page of its own now, and the one-request starter path
 * the first-run panel offered hid the model — persona, cohort, population, study — and produced
 * exactly the confusion it was meant to prevent. The needs panel is what says what is left, and
 * each of its rows leads to the builder that does it.
 *
 * **The headline sentence went with them.** It counted "people configured", and there is no such
 * number any more: the study is the only headcount (ADR-0041), and every study row prints its own.
 *
 * **The stub says whether anything has ever happened**, in the mark's own grammar and the same
 * spelling the projects list uses: a filled dot for a study that has been run, a ring for one that
 * has not. Neither is a promise about what the next execution will find (§7.3).
 */
export function ProjectHome() {
  const { key, project, href } = useProject();
  const setup = useQuery(q.setup(key));
  const needs = setup.data?.needs ?? [];
  const studies = project.studies;

  return (
    <DocumentPage
      header={
        <PageHeader
          title={project.name}
          lede={project.description || undefined}
          /*
            What the project is made of, and what it is costing. Spend is a fact about the whole
            project rather than one of the things the project is made of, so it is a meta fact
            here and not a `Stat` at the 32px figure step, which made "$0.00" the loudest number
            on a page whose subject is what came back.
          */
          meta={[
            { key: "studies", node: plural(project.counts.studies, "study", "studies") },
            { key: "targets", node: plural(project.counts.targets, "target") },
            {
              key: "spend",
              node: (
                <>
                  <Money usd={project.spentTodayUsd} /> today of <Money usd={project.dailyCeilingUsd} />{" "}
                  <Link size="meta" to={href("settings")}>
                    change
                  </Link>
                </>
              ),
            },
          ]}
          actions={
            <Button asChild variant="primary">
              <RouterLink to={href("studies/new")}>New study</RouterLink>
            </Button>
          }
        />
      }
    >
      <Stack gap={12}>
        {needs.length === 0 ? null : (
          <Section title="What needs doing" trailing={plural(needs.length, "thing")}>
            <Ledger>
              {needs.map((need) => (
                <LedgerRow
                  key={need.id}
                  to={linkFor(need, href)}
                  /* A ring for a need that stops an execution, a dot for one that is merely
                     left to do: the same grammar as the study rows below, where a ring is a
                     study that has not gone. */
                  stub={need.blocking ? <Ring size="sm" /> : <Dot size="sm" />}
                >
                  <Stack gap={1}>
                    <Text size="read" as="div">
                      {need.sentence}
                    </Text>
                    {need.blocking ? (
                      <Text size="meta" tone="muted" as="div">
                        Nothing can be sent until this is done.
                      </Text>
                    ) : null}
                  </Stack>
                </LedgerRow>
              ))}
            </Ledger>
          </Section>
        )}

        {studies.length === 0 ? (
          <Section title="Studies" trailing={plural(project.counts.studies, "study", "studies")}>
            <StateBlock kind="empty" what="this project's studies">
              <Stack gap={6} align="start">
                <div>
                  No studies yet. A study sends a population, at a size you give it, to a target — and
                  it is the only thing here that spends anything.
                </div>
                <Button asChild variant="primary">
                  <RouterLink to={href("studies/new")}>Make the first study</RouterLink>
                </Button>
              </Stack>
            </StateBlock>
          </Section>
        ) : project.targets.length > 1 ? (
          <Stack gap={12}>
            {groupByTarget(studies).map(([targetName, rows]) => (
              <Section key={targetName} title={targetName} trailing={plural(rows.length, "study", "studies")}>
                <Ledger>
                  {rows.map((study) => (
                    <StudyRow key={study.id} study={study} />
                  ))}
                </Ledger>
              </Section>
            ))}
          </Stack>
        ) : (
          <Section title="Studies" trailing={plural(project.counts.studies, "study", "studies")}>
            <Ledger>
              {studies.map((study) => (
                <StudyRow key={study.id} study={study} />
              ))}
            </Ledger>
          </Section>
        )}

        {/* The roll-up across studies, which presupposes two of them. With one, "nothing has
            turned up in two studies yet" is a sentence about the product's own machinery. */}
        {studies.length > 1 ? (
          <Section id="problems" title="Seen in more than one study" trailing={plural(project.crossStudy.length, "problem")}>
            {project.crossStudy.length === 0 ? (
              <StateBlock kind="empty" what="problems seen in more than one study">
                Nothing has turned up in two studies yet.
              </StateBlock>
            ) : (
              <Ledger>
                {project.crossStudy.map((problem) => (
                  <LedgerRow key={problem.signature} stub={<SeverityStack level={problem.severity} />}>
                    <Stack gap={1}>
                      <Inline gap={3} align="baseline" wrap>
                        <SeverityTag level={problem.severity} kind={problem.kind} />
                        <Text size="finding" as="span">
                          {problem.title}
                        </Text>
                      </Inline>

                      <MetaLine facts={incidenceOf(problem)} />

                      {/* One link per study it showed up in: the same signature, read where it
                          was reported, because the evidence for it is that execution's. */}
                      <Inline gap={3} wrap>
                        {problem.studies.map((study) => (
                          <Link
                            key={study.id}
                            size="meta"
                            to={href(`studies/${encodeURIComponent(study.id)}/f/${encodeURIComponent(problem.signature)}`)}
                          >
                            {study.name}
                          </Link>
                        ))}
                      </Inline>
                    </Stack>
                  </LedgerRow>
                ))}
              </Ledger>
            )}
          </Section>
        ) : null}
      </Stack>
    </DocumentPage>
  );
}

/**
 * Where a need is done (D7). A project-scoped need is known by its id — there is one builder for
 * each thing a project can lack — and everything else by what it is about: a target's page, a
 * population's builder, a study's builder. The server deliberately sends no path (`NeedSchema`),
 * so this is the ONE place the mapping lives.
 */
function linkFor(need: Need, href: (path?: string) => string): string {
  if (need.scope.kind === "project") {
    switch (need.id) {
      case "no-target":
        return href("library/targets/new");
      case "no-population":
        return href("library/populations/new");
      case "no-study":
        return href("studies/new");
      case "no-api-key":
      case "kill-switch":
        return href("settings");
      default:
        return href();
    }
  }
  const id = encodeURIComponent(need.scope.id);
  switch (need.scope.kind) {
    case "target":
      return href(`library/targets/${id}`);
    case "population":
      return href(`library/populations/${id}`);
    case "study":
      return href(`studies/${id}/edit`);
  }
}

/**
 * The studies, gathered under the target each one visits, in first-appearance order.
 *
 * Grouping by NAME rather than by id is deliberate: the heading is the target's name, two targets
 * cannot share one within a project (the slug is unique per project and the name drives it), and
 * keying by name means the group and its heading can never disagree. Order follows the first row
 * that mentions each target, so the ledger's own ordering still decides what a reader meets first.
 */
function groupByTarget(studies: readonly StudySummary[]): readonly (readonly [string, readonly StudySummary[]])[] {
  const groups = new Map<string, StudySummary[]>();
  for (const study of studies) {
    const bucket = groups.get(study.target.name);
    if (bucket === undefined) groups.set(study.target.name, [study]);
    else bucket.push(study);
  }
  return [...groups.entries()];
}

/**
 * The short form of the triage decisions, for a line with no room for the full sentence. "fixed"
 * survives here because a human asserted it about their own product, and the line prints it as
 * *marked fixed* so the assertion keeps its author (§7.3).
 */
const TRIAGE_WORDS: Record<string, string> = {
  accepted: "accepted",
  fixed: "fixed",
  "wont-fix": "won't fix",
  duplicate: "a duplicate",
};

/** How far a problem reached, and what somebody has already decided about it. */
function incidenceOf(problem: ProjectOverview["crossStudy"][number]): readonly MetaFact[] {
  const word = problem.triage === null ? undefined : TRIAGE_WORDS[problem.triage.state];
  return [
    { key: "people", node: `${people(problem.peopleHit)} hit it` },
    { key: "where", node: `in ${plural(problem.studies.length, "study", "studies")}` },
    ...(word === undefined ? [] : [{ key: "triage", node: `marked ${word}` }]),
  ];
}

/**
 * One study: what it is made of, where it got to, and the acts it is asking for.
 *
 * **The row IS the link to the study's results** — or to the live screen while it is running,
 * because that is the page the row's own last line names. Everything that is a control lives in
 * the row's `aside`, which `LedgerRow` renders as a SIBLING of the link: the study's actions, and
 * the one menu the list rules sanction for edit and archive (ATOMIC-INVENTORY §3, organism 4).
 * A button inside an anchor is a target a reader cannot aim at, and a click on it would navigate;
 * this is what keeps that from being possible rather than merely avoided.
 *
 * The archive dialog is CONTROLLED and rendered beside the menu, never inside an item, because a
 * menu closes on select and would unmount a dialog it contained. `StudyActions` can carry a
 * Delete of its own with the same dialog; here it is told the row owns the act
 * (`deletable={false}`), because the menu is the list's uniform way in and the same question
 * asked from two buttons an inch apart is a misclick, not a choice.
 */
function StudyRow({ study }: { study: StudySummary }) {
  const { key, href } = useProject();
  const queries = useQueryClient();
  const base = href(`studies/${encodeURIComponent(study.slug)}`);
  const running = study.status === "running";
  const [confirming, setConfirming] = useState(false);
  const [withRuns, setWithRuns] = useState(false);

  /**
   * Off the list. Archived by default; `withRuns` is the reader's tick. What it makes stale is
   * the studies list and the project (counts, cross-study), what is left to set up, and the runs
   * — the same set `StudyActions` refreshes — never `invalidateQueries()` bare.
   */
  const archive = useMutation({
    mutationFn: () => api.removeStudy(key, study.slug, withRuns),
    onSuccess: async () => {
      setConfirming(false);
      await Promise.all([
        queries.invalidateQueries({ queryKey: keys.studies(key) }),
        queries.invalidateQueries({ queryKey: keys.project(key) }),
        queries.invalidateQueries({ queryKey: keys.setup(key) }),
        queries.invalidateQueries({ queryKey: keys.runs(key) }),
      ]);
    },
  });

  const hasRun = study.latest !== null;

  return (
    <LedgerRow
      to={running ? `${base}/live` : base}
      stub={study.latest === null ? <Ring size="sm" className="md:ml-auto" /> : <Dot size="sm" className="md:ml-auto" />}
      aside={
        <Stack gap={2}>
          <Inline gap={2} align="center" wrap>
            <StudyActions study={study} deletable={false} />
            <DropdownMenu
              label={`More about ${study.name}`}
              trigger={<IconButton icon="chevron-down" label={`More about ${study.name}`} variant="quiet" size="sm" />}
              items={[
                { label: "Edit", to: `${base}/edit` },
                {
                  label: running ? "Archiving waits until it stops" : "Archive",
                  tone: "danger",
                  // Deleting the rows a live process is writing is not a question worth asking;
                  // the item stays, at a bound, with the reason as its label (§6.5).
                  disabled: running,
                  onSelect: () => {
                    setConfirming(true);
                  },
                },
              ]}
            />
            <AlertDialog
              open={confirming}
              onOpenChange={(open) => {
                setConfirming(open);
                if (!open) setWithRuns(false);
              }}
              title={`Archive ${study.name}?`}
              body={
                <Stack gap={3} align="start">
                  <span>
                    {hasRun
                      ? `${study.name} comes off the list. Its executions stay exactly where they are — the visits, what the people remembered and the problems they filed — and so do its population, its personas and its target, which belong to the project.`
                      : `${study.name} has never been sent, so there is nothing to lose but the settings. Its population, its personas and its target all stay — they belong to the project, not to this.`}
                  </span>
                  {hasRun ? (
                    <Checkbox
                      checked={withRuns}
                      onChange={setWithRuns}
                      label="Delete its executions too"
                      hint={`Every execution of ${study.name} goes with it. If any of them left accounts on ${study.target.name}, the only record of those goes too.`}
                    />
                  ) : null}
                  <Text size="meta" tone="muted">
                    People no other study sends are put aside, not deleted, and come back if a study
                    sends them again.
                  </Text>
                </Stack>
              }
              confirmLabel={!hasRun ? "Delete this study" : withRuns ? "Delete it and its executions" : "Archive this study"}
              confirmPending={archive.isPending}
              onConfirm={() => {
                archive.mutate();
              }}
            />
          </Inline>
          {archive.isError ? <WhatWentWrong says="Nothing was removed." error={archive.error} /> : null}
        </Stack>
      }
    >
      <Stack gap={2}>
        <Inline gap={3} align="baseline" wrap>
          <Heading level={3} size="name">
            {study.name}
          </Heading>
          <Badge variant="mode">{study.mode}</Badge>
          {running ? <Chip tone="live">running</Chip> : null}
          {study.status === "paused" ? <Chip>paused</Chip> : null}
          <Spacer />
          <Text size="meta" tone="muted">
            {study.latest === null ? (
              "never sent"
            ) : (
              <>
                execution {study.latest.seq}, <RelativeTime at={study.latest.startedAt} mode="absolute" />
              </>
            )}
          </Text>
        </Inline>

        <MetaLine facts={shapeOf(study)} />
        <MetaLine facts={resultsOf(study, running)} />
      </Stack>
    </LedgerRow>
  );
}

/** Where they go, who goes, how many, and for how long — the line that says what this study *is*. */
function shapeOf(study: StudySummary): readonly MetaFact[] {
  return [
    { key: "pairing", node: `${study.target.name} × ${study.population.name}` },
    {
      key: "size",
      // The deal can send fewer than the size when a cohort has no personas to deal into; when
      // it does, the row says both numbers, because the gap is the cue that a cohort needs some.
      node: study.sends === study.size ? people(study.size) : `${people(study.sends)} of ${String(study.size)} asked for`,
    },
    { key: "cohorts", node: plural(study.population.cohorts, "cohort") },
    {
      key: "mode",
      node: study.mode === "ephemeral" && study.visitsPerPerson !== null ? `${plural(study.visitsPerPerson, "visit")} each` : "until you stop it",
    },
  ];
}

/**
 * What has come back, and where the row goes. A problem missing from the newest execution is
 * reported as an absence and never as a repair (ADR-0028, DESIGN-SYSTEM §7.3) — "not reported
 * this time" is the whole claim, and the word "fixed" belongs to the person who typed it into
 * triage. The last fact names the page the row opens, since the row itself is the link.
 */
function resultsOf(study: StudySummary, running: boolean): readonly MetaFact[] {
  const where: MetaFact = { key: "where", node: running ? "Watch it live" : "Read the results" };
  if (study.latest === null) {
    return [{ key: "nothing", node: "nothing has been found yet, because nobody has gone" }, where];
  }
  return [
    { key: "confirmed", node: `${study.confirmed} confirmed` },
    ...(study.newSinceLast > 0 ? [{ key: "new", node: `${study.newSinceLast} new since the last one` }] : []),
    ...(study.fixedSinceLast > 0 ? [{ key: "absent", node: `${study.fixedSinceLast} not reported this time` }] : []),
    { key: "cost", node: <Money usd={study.costUsd} /> },
    where,
  ];
}

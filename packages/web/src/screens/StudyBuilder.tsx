import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { dealStudy, EffortSchema, ReportCycleSchema, type Dealt } from "@populace/core/isomorphic";
import type { ProjectEstimateBody, ReportCycleInput, StudyCreateInput, StudyOverridesInput, StudyUpdateInput } from "@populace/contract";

import { api, type Estimate, type PopulationView, type Settings, type StoredTarget, type StudySummary } from "../api.js";
import { keys, q } from "../queries.js";
import { useProject, useStudy } from "../context.jsx";
import { useAfterCreate, useDraft, usePicked, useThen } from "../builders.js";
import { people as peopleWord, plural } from "../format.js";
import {
  BuilderPage,
  Button,
  Card,
  Checkbox,
  CohortCapsule,
  ConditionalFieldset,
  CostEstimate,
  costBasisOf,
  Disclosure,
  DurationField,
  Field,
  FieldGrid,
  Heading,
  Inline,
  Input,
  Ledger,
  LedgerRow,
  Link,
  Measure,
  MetaSentence,
  Mono,
  NumberInput,
  PageHeader,
  Ring,
  ROSTER_ONE_TO_ONE_MAX,
  Section,
  Select,
  Skeleton,
  Stack,
  StateBlock,
  Stepper,
  Text,
  TextArea,
  visitPlanOf,
  WhatWentWrong,
  foldRoster,
  type LatticeDot,
  type StateKind,
  type VisitPlan,
} from "../design/index.js";

/**
 * The study builder — one screen serving `studies/new` and `studies/:study/edit` (ADR-0043).
 *
 * A study is a population at a size, sent at a target, in one of two ways of visiting
 * (ADR-0041, ADR-0030). Every one of those is on this page at creation, because a form that
 * asks for the name first and everything else later is how `NewSimulation` and the settings
 * screen it needed came to be two pages about one thing. This replaces both.
 *
 * **The size is here and nowhere else.** A population is cohorts at weights and a cohort is
 * personas at weights; the study's `size` is the only headcount, and the deal that turns it
 * into people is previewed live, by the server's own arithmetic (`dealStudy` from core's
 * browser-safe half), so what the reader sees at 10 is exactly what saving at 10 writes. Ties go
 * to the earlier cohort and the earlier persona — a stated rule the preview shows, not an
 * accident.
 *
 * **Two modes, one file, decided by the URL.** `studies/new` has no `:study` param and mounts
 * `CreateStudy`, which persists its draft under the route (`useDraft`) so a hop to the target or
 * population builder and back loses nothing, and honours `?then=`/`?picked=` so a population made
 * mid-way lands back in the Who field. `studies/:study/edit` mounts inside `StudyShell`, where
 * `useStudy()` is available, and `EditStudy` reads the saved row from there. Hooks cannot be
 * conditional, so the split is two components rather than one with a flag.
 *
 * **What a save reaches.** Saving writes the people (a 201 means the roster is dealt) and spends
 * nothing. A running longitudinal execution froze its config when it started (ADR-0025) and takes
 * a change only through "Apply to the running execution", which sits beside Save in edit mode and
 * PUTs before it POSTs; an ephemeral study's next execution simply uses what was saved. Both are
 * said in the bar rather than left to be discovered.
 *
 * **Timing and overrides are sent only when they moved.** In edit mode the form opens on the
 * saved `cadence`, `seed`, `reportCycle` and `overrides` the summary carries, and a save sends them
 * back only when they differ from that baseline — so a row's timing is never replaced by a default it never
 * had, and a block the form does not fully model is left alone until the reader changes it. In
 * create mode the baseline is the blank form: untouched, a new study takes the project's own
 * timing and overrides nothing (D1).
 *
 * Nothing here promises what an execution will find (§7.3): the deal says who goes, the estimate
 * says roughly what it costs, and outcomes vary between executions by design.
 */
export function StudyBuilder() {
  const { study } = useParams();
  return study === undefined ? <CreateStudy /> : <EditStudy />;
}

// ---- the form ----------------------------------------------------------------------------------

const ModeSchema = z.enum(["ephemeral", "longitudinal"]);
type Mode = z.infer<typeof ModeSchema>;

/**
 * The override blocks as a form holds them: a string select where "" is "whatever the project
 * uses", and a number where nought is the same. `StudyOverridesInput` is built from this at send
 * time so a field the reader never touched is never sent carrying a default.
 */
const OverridesFormSchema = z.object({
  model: z.string(),
  effort: z.string(),
  maxUsd: z.number().nonnegative(),
  maxTurns: z.number().int().nonnegative(),
  dailyUsd: z.number().nonnegative(),
  judge: z.string(),
  judgeModel: z.string(),
});
type OverridesForm = z.infer<typeof OverridesFormSchema>;

/**
 * The form state, and the draft a create builder persists (`useDraft`). Checked with zod on the
 * way back out of `sessionStorage`, so a stale shape from an older build is "no draft" rather
 * than a crash. `mode` is form-only: on the wire the visit cap IS the mode (null is longitudinal).
 */
const StudyFormSchema = z.object({
  name: z.string(),
  slug: z.string(),
  /** Whether the reader has typed in the address, after which the name stops driving it. */
  slugTouched: z.boolean(),
  description: z.string(),
  brief: z.string(),
  targetId: z.string(),
  populationId: z.string(),
  size: z.number().int().nonnegative(),
  mode: ModeSchema,
  /** Kept while the mode is longitudinal so flipping back does not lose the number. */
  visitsPerPerson: z.number().int().positive(),
  cadence: z.object({ every: z.number().nonnegative(), jitter: z.number().nonnegative(), initialDelay: z.number().nonnegative() }),
  /**
   * How often a run of this study stops to report (ADR-0045). `everyVisits` is nought here where
   * the wire has null, the same way an override box's nought is "whatever the project uses": on
   * the form it is one number that can be cleared, and nought on the way up is sent as null, which
   * is what leaves time as the only trigger.
   */
  reportCycle: z.object({
    every: z.number().nonnegative(),
    jitter: z.number().nonnegative(),
    initialDelay: z.number().nonnegative(),
    everyVisits: z.number().int().nonnegative(),
  }),
  seed: z.string(),
  autoSweep: z.boolean(),
  requireFreshTarget: z.boolean(),
  overrides: OverridesFormSchema,
});
type StudyForm = z.infer<typeof StudyFormSchema>;

const BLANK_OVERRIDES: OverridesForm = { model: "", effort: "", maxUsd: 0, maxTurns: 0, dailyUsd: 0, judge: "", judgeModel: "" };

/**
 * The timing a form opens on when the reader has chosen none of it. In create mode it is the
 * PROJECT's, read from its settings, because a builder that invents its own is a form whose Timing
 * section shows a cadence and a seed the project does not use and whose untouched save would be a
 * choice the reader never made. In edit mode it is the saved study's own.
 */
interface FormDefaults {
  cadence: StudyForm["cadence"];
  reportCycle: StudyForm["reportCycle"];
  seed: string;
  visitsPerPerson: number;
}

/**
 * The report cycle a form opens on when nothing has been saved: the STORED schema's own defaults,
 * read off it rather than typed out here.
 *
 * It does not come from the project's settings because the settings do not hold one — the cycle is
 * a property of a study, since it is that study's own history the windows are compared across. So
 * the honest blank value is what a study nobody has set this on actually runs, which is exactly
 * what `ReportCycleSchema` says.
 */
const CYCLE_DEFAULTS: StudyForm["reportCycle"] = ((): StudyForm["reportCycle"] => {
  const stored = ReportCycleSchema.parse({});
  return { every: stored.every, jitter: stored.jitter, initialDelay: stored.initialDelay, everyVisits: stored.everyVisits ?? 0 };
})();

/**
 * The project's timing, as the blank form takes it. `maxVisits` is the project's fallback cap and
 * null there means no arithmetic end — which on this form is the longitudinal mode, not a number —
 * so the box keeps a number of its own for that case: flipping the mode back must not leave an
 * empty count, and four is what a study with nothing said about it has always visited.
 */
function defaultsOf(settings: Settings): FormDefaults {
  return {
    cadence: { every: settings.cadence.every, jitter: settings.cadence.jitter, initialDelay: settings.cadence.initialDelay },
    reportCycle: { ...CYCLE_DEFAULTS },
    seed: settings.seed,
    visitsPerPerson: settings.maxVisits ?? 4,
  };
}

/** A new study, as the page opens: ten people, and the timing it was handed. */
function blankForm(seeded: { targetId: string | null; populationId: string | null }, defaults: FormDefaults): StudyForm {
  return {
    name: "",
    slug: "",
    slugTouched: false,
    description: "",
    brief: "",
    targetId: seeded.targetId ?? "",
    populationId: seeded.populationId ?? "",
    size: 10,
    mode: "ephemeral",
    visitsPerPerson: defaults.visitsPerPerson,
    // Copied, not shared: the same defaults build both the draft and the baseline it is compared
    // against, and two forms holding one cadence object is a bug waiting for the first setter that
    // patches in place.
    cadence: { ...defaults.cadence },
    reportCycle: { ...defaults.reportCycle },
    seed: defaults.seed,
    autoSweep: true,
    requireFreshTarget: false,
    overrides: BLANK_OVERRIDES,
  };
}

/**
 * The saved override blocks as the form holds them: "" and nought are "whatever the project
 * uses", which is what an absent field means on the wire. Fields the form has no box for
 * (`maxTokens`, `maxFindings`…) are not carried here; they are left alone until the reader
 * changes a block, because an untouched block is not sent back.
 */
function overridesFormOf(saved: StudySummary["overrides"]): OverridesForm {
  return {
    model: saved.model?.model ?? "",
    effort: saved.model?.effort ?? "",
    maxUsd: saved.guardrails?.perWake?.maxUsd ?? 0,
    maxTurns: saved.guardrails?.perWake?.maxTurns ?? 0,
    dailyUsd: saved.guardrails?.dailyUsd ?? 0,
    judge: saved.verifier?.judge ?? "",
    judgeModel: saved.verifier?.model?.model ?? "",
  };
}

/**
 * The saved report cycle as the form holds it, and the schema's own when a row came without one.
 *
 * The wire leaves it off a study read in a LIST — the index has no control for it — so the one
 * fallback here is the same value a blank form opens on, never an invented one: a form showing a
 * timing the study does not run is the bug the Timing section's comment above is about.
 */
export function cycleFormOf(saved: StudySummary["reportCycle"]): StudyForm["reportCycle"] {
  if (saved === undefined) return { ...CYCLE_DEFAULTS };
  return { every: saved.every, jitter: saved.jitter, initialDelay: saved.initialDelay, everyVisits: saved.everyVisits ?? 0 };
}

/** The saved row, as the form holds it: everything, timing and overrides included. */
function formOf(study: StudySummary): StudyForm {
  return {
    ...blankForm(
      { targetId: study.target.id, populationId: study.population.id },
      {
        // The three timing fields are picked one by one rather than spread, because the baseline
        // this becomes is compared by serialization: a field the wire grows later would show up as
        // a change the reader never made.
        cadence: { every: study.cadence.every, jitter: study.cadence.jitter, initialDelay: study.cadence.initialDelay },
        reportCycle: cycleFormOf(study.reportCycle),
        seed: study.seed,
        visitsPerPerson: study.visitsPerPerson ?? 4,
      },
    ),
    name: study.name,
    slug: study.slug,
    slugTouched: true,
    description: study.description,
    brief: study.brief,
    size: study.size,
    mode: study.mode,
    autoSweep: study.autoSweep,
    requireFreshTarget: study.requireFreshTarget,
    overrides: overridesFormOf(study.overrides),
  };
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** The address a name suggests: lowercase, dashes, nothing else. */
function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const JudgeSchema = z.enum(["model", "heuristic"]);

/**
 * The override blocks the form has set, and nothing it has not. A block with nothing in it is
 * left out entirely, because on the wire a block that is present overrides — even when empty.
 */
function overridesOf(form: OverridesForm): StudyOverridesInput | undefined {
  const effort = EffortSchema.safeParse(form.effort);
  const judge = JudgeSchema.safeParse(form.judge);
  const model: StudyOverridesInput["model"] = {
    ...(form.model === "" ? {} : { model: form.model }),
    ...(effort.success ? { effort: effort.data } : {}),
  };
  const perWake = {
    ...(form.maxUsd > 0 ? { maxUsd: form.maxUsd } : {}),
    ...(form.maxTurns > 0 ? { maxTurns: form.maxTurns } : {}),
  };
  const guardrails: StudyOverridesInput["guardrails"] = {
    ...(Object.keys(perWake).length === 0 ? {} : { perWake }),
    ...(form.dailyUsd > 0 ? { dailyUsd: form.dailyUsd } : {}),
  };
  const verifier: StudyOverridesInput["verifier"] = {
    ...(judge.success ? { judge: judge.data } : {}),
    ...(form.judgeModel === "" ? {} : { model: { model: form.judgeModel } }),
  };
  const out: StudyOverridesInput = {
    ...(Object.keys(model).length === 0 ? {} : { model }),
    ...(Object.keys(guardrails).length === 0 ? {} : { guardrails }),
    ...(Object.keys(verifier).length === 0 ? {} : { verifier }),
  };
  return Object.keys(out).length === 0 ? undefined : out;
}

/** How many of the three blocks the form sets, for the disclosure's count. */
function overrideBlocks(form: OverridesForm): number {
  const set = overridesOf(form);
  return set === undefined ? 0 : Object.keys(set).length;
}

/** The visit cap as the wire wants it: a number for an ephemeral study, null for a longitudinal one. */
const capOf = (form: StudyForm): number | null => (form.mode === "ephemeral" ? form.visitsPerPerson : null);

/** Whether the timing moved from the baseline — the saved row in edit mode, the blank form in create. */
const timingMoved = (form: StudyForm, baseline: StudyForm): boolean => JSON.stringify(form.cadence) !== JSON.stringify(baseline.cadence) || form.seed !== baseline.seed;

/**
 * Whether the report cycle moved from the baseline, and what to send when it did.
 *
 * Sent only when it moved, for the same reason the cadence is: this is the dial on how often
 * populace writes into somebody's issue tracker, and a save that carried the form's idea of it
 * every time would replace a rhythm somebody set in `populace.yaml` with whatever this screen
 * happened to be showing.
 */
export const cycleMoved = (cycle: StudyForm["reportCycle"], baseline: StudyForm["reportCycle"]): boolean => JSON.stringify(cycle) !== JSON.stringify(baseline);

/** The form's cycle as the wire takes it: nought visits means null, which is time alone. */
export function cycleOf(cycle: StudyForm["reportCycle"]): ReportCycleInput {
  return {
    every: cycle.every,
    jitter: cycle.jitter,
    initialDelay: cycle.initialDelay,
    everyVisits: cycle.everyVisits > 0 ? cycle.everyVisits : null,
  };
}

/** Whether any override box moved from the baseline. */
const overridesMoved = (form: StudyForm, baseline: StudyForm): boolean => JSON.stringify(form.overrides) !== JSON.stringify(baseline.overrides);

/**
 * The timing and override blocks a request carries: only what moved from `baseline`. Untouched, a
 * new study takes the project's defaults (D1) and a saved one keeps what it has — including the
 * override fields the form has no box for. When the overrides did move, the object sent IS the
 * block, so a box put back to "whatever the project uses" is sent as an absent field, and
 * clearing every box sends an empty block that overrides nothing.
 */
function movedBlocksOf(form: StudyForm, baseline: StudyForm): Pick<StudyUpdateInput, "cadence" | "seed" | "overrides"> {
  return {
    ...(timingMoved(form, baseline) ? { cadence: form.cadence, seed: form.seed } : {}),
    ...(overridesMoved(form, baseline) ? { overrides: overridesOf(form.overrides) ?? {} } : {}),
  };
}

/** What an edit sends: everything the form holds, nothing required, and the timing and overrides only when they moved. */
function updateBodyOf(form: StudyForm, baseline: StudyForm): StudyUpdateInput {
  return {
    name: form.name.trim(),
    description: form.description,
    brief: form.brief,
    populationId: form.populationId,
    targetId: form.targetId,
    size: form.size,
    visitsPerPerson: capOf(form),
    autoSweep: form.autoSweep,
    requireFreshTarget: form.requireFreshTarget,
    ...movedBlocksOf(form, baseline),
    // Deliberately not part of `movedBlocksOf`: that is also the estimate's body, and what a study
    // costs has nothing to do with how often it reports — publishing spends nothing (ADR-0044).
    ...(cycleMoved(form.reportCycle, baseline.reportCycle) ? { reportCycle: cycleOf(form.reportCycle) } : {}),
  };
}

/** What a create sends: the same, with the four the server requires stated as such, and the slug. */
function createBodyOf(form: StudyForm, baseline: StudyForm): StudyCreateInput {
  return {
    ...updateBodyOf(form, baseline),
    name: form.name.trim(),
    populationId: form.populationId,
    targetId: form.targetId,
    size: form.size,
    ...(form.slug === "" ? {} : { slug: form.slug }),
  };
}

/** The same form, priced. Read-only on the server; a deal that sends nobody is a zero, not a refusal. */
function estimateBodyOf(form: StudyForm, baseline: StudyForm): ProjectEstimateBody {
  return {
    targetId: form.targetId,
    populationId: form.populationId,
    size: form.size,
    visitsPerPerson: capOf(form),
    ...movedBlocksOf(form, baseline),
  };
}

/**
 * Why the study cannot be made or saved yet, in a sentence, or `undefined` when nothing stops it.
 * A held button that gives no reason is the bug the bar exists to prevent (§1.2): the sentence
 * beside it is what carries the reason.
 */
function blockerOf(form: StudyForm, targets: readonly StoredTarget[], populations: readonly PopulationView[]): string | undefined {
  if (targets.length === 0) return "There is nowhere to send them yet. Connect a target first.";
  if (populations.length === 0) return "There is nobody to send yet. Compose a population first.";
  if (form.targetId === "" || !targets.some((t) => t.id === form.targetId)) return "Choose where they go.";
  if (form.populationId === "" || !populations.some((p) => p.id === form.populationId)) return "Choose who goes.";
  if (form.name.trim() === "") return "Give it a name first — it is what you will look for in the list.";
  if (form.slug !== "" && !SLUG.test(form.slug)) return "The address is lowercase letters, digits and dashes, starting with a letter or a digit.";
  if (form.mode === "ephemeral" && form.visitsPerPerson < 1) return "An ephemeral study has to end: give each person at least one visit.";
  return undefined;
}

/**
 * A value that settles. The estimate is keyed by the whole body and every keystroke on the size
 * is a new body; asking the server on each one is a request per digit typed, so the body the
 * query sees trails the form by a beat.
 */
function useSettled<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  // `value` is a fresh object on every render; what matters is whether its CONTENTS changed, so
  // the timer is keyed on the serialized form and reads the latest object when it fires.
  const latest = useRef(value);
  latest.current = value;
  const serialized = JSON.stringify(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setSettled(latest.current), delay);
    return () => window.clearTimeout(handle);
  }, [serialized, delay]);
  return settled;
}

// ---- create --------------------------------------------------------------------------------------

/**
 * The header the create side shows in both of its states. Written once so the frame that waits for
 * the project's timing and the form that arrives afterwards are the same page, rather than one
 * flashing past the other.
 */
function NewStudyHeader({ href }: { href: (path?: string) => string }) {
  return (
    <PageHeader
      title="New study"
      crumbs={[{ label: "Studies", to: href() }, { label: "New study" }]}
      lede="A population, at a size, sent to a target in one of two ways of visiting. Everything here can be changed afterwards; making it writes its people and spends nothing."
    />
  );
}

/**
 * A new study, in two components, because a blank form is not blank: untouched, it rides the
 * project's own cadence, seed and visit cap (D1), and those arrive over the wire.
 *
 * A draft's initial value is computed once, at mount (`useDraft`), so a form mounted before the
 * settings landed would hold timing of the builder's own invention, SHOW it in the Timing section
 * as though it were the project's, and send it as the reader's choice the moment anything else
 * moved. So the form is mounted only once the settings are in hand and until then this is the
 * frame and its loading slot — never a blank form that a later response has to correct underneath
 * whoever is already typing in it.
 */
function CreateStudy() {
  const { key, href } = useProject();
  const settings = useQuery(q.settings(key));
  // The two lists the form itself reads, started HERE so they are in flight alongside the settings
  // rather than after them: the same keys, so this costs no second request, and the form finds them
  // in the cache when it mounts instead of making the reader wait through two loading states.
  useQuery(q.targets(key));
  useQuery(q.populations(key));
  const defaults = useMemo(() => (settings.data === undefined ? null : defaultsOf(settings.data)), [settings.data]);

  if (defaults === null)
    return (
      <BuilderPage
        mode="create"
        header={<NewStudyHeader href={href} />}
        state={settings.isError ? "failed" : "loading"}
        loading={
          <StateBlock
            kind="loading"
            what="the project's own timing"
            skeleton={<Skeleton variant="block" count={3} height={120} label="Reading the project's own timing" />}
          />
        }
        error={<StateBlock kind="failed" what="the project's own timing" error={settings.error} />}
        actLabel="Make this study"
        pending={false}
        // With `state` set the bar is not drawn, so there is nothing here to act on yet.
        onAct={() => undefined}
      >
        {null}
      </BuilderPage>
    );

  return <CreateStudyForm defaults={defaults} />;
}

function CreateStudyForm({ defaults }: { defaults: FormDefaults }) {
  const { key, href } = useProject();
  const queries = useQueryClient();
  const navigate = useNavigate();
  const after = useAfterCreate();
  const { linkTo, returnTo, fromBuilder } = useThen();
  const targets = useQuery(q.targets(key));
  const populations = useQuery(q.populations(key));

  /*
    `?target=` and `?population=` seed the two choices — the old `s/new` address carried them and
    the redirect keeps its query. They are the INITIAL value of the draft, not a controlled one,
    so a reader who arrives pre-seeded and then changes their mind is not fought by the URL.
  */
  const [params] = useSearchParams();
  const seeded = useMemo(() => ({ targetId: params.get("target"), populationId: params.get("population") }), [params]);
  const initial = useCallback(() => blankForm(seeded, defaults), [seeded, defaults]);
  const { draft: form, setDraft: setForm, restored, clear, startBlank } = useDraft(StudyFormSchema, initial);
  // What "untouched" is measured against: timing and overrides are sent only when they moved from
  // here, and here is the project's own timing — so an untouched form sends none of it and the
  // study simply inherits what the project says.
  const blank = useMemo(() => blankForm(seeded, defaults), [seeded, defaults]);

  const targetRows = targets.data?.items ?? [];
  const populationRows = populations.data?.items ?? [];

  // `?picked=<id>` from the target or population builder this page sent the reader to. Both
  // consumers watch the same parameter; only the one whose list holds the id fires, then takes
  // the parameter out of the address so a reload does not re-pick it.
  const targetIds = useMemo(() => targetRows.map((t) => t.id), [targetRows]);
  const populationIds = useMemo(() => populationRows.map((p) => p.id), [populationRows]);
  usePicked(
    targetIds,
    useCallback((id: string) => setForm((prev) => ({ ...prev, targetId: id })), [setForm]),
  );
  usePicked(
    populationIds,
    useCallback((id: string) => setForm((prev) => ({ ...prev, populationId: id })), [setForm]),
  );

  // With exactly one of something there is nothing to choose, so the form does not make the
  // reader choose it; with several the server refuses to guess (ADR-0035) and so does the form.
  useEffect(() => {
    if (form.targetId === "" && targetRows.length === 1) setForm((prev) => ({ ...prev, targetId: targetRows[0]?.id ?? "" }));
  }, [form.targetId, targetRows, setForm]);
  useEffect(() => {
    if (form.populationId === "" && populationRows.length === 1) setForm((prev) => ({ ...prev, populationId: populationRows[0]?.id ?? "" }));
  }, [form.populationId, populationRows, setForm]);

  const create = useMutation({
    mutationFn: () => api.createStudy(key, createBodyOf(form, blank)),
    onSuccess: async (study) => {
      // The list this page came from, and the project that counts it, BEFORE navigating — so the
      // dashboard the reader lands on already has the row (D5). Never `invalidateQueries()` bare.
      await Promise.all([
        queries.invalidateQueries({ queryKey: keys.studies(key) }),
        queries.invalidateQueries({ queryKey: keys.project(key) }),
        queries.invalidateQueries({ queryKey: keys.setup(key) }),
      ]);
      clear();
      after(returnTo(study.id, href(`studies/${encodeURIComponent(study.slug)}`)));
    },
  });

  const state: StateKind | undefined =
    targets.isError || populations.isError ? "failed" : targets.isPending || populations.isPending ? "loading" : undefined;

  const blockedBecause = blockerOf(form, targetRows, populationRows);
  const errorId = useId();

  return (
    <BuilderPage
      mode="create"
      header={<NewStudyHeader href={href} />}
      state={state}
      loading={
        <StateBlock
          kind="loading"
          what="what you have to send"
          skeleton={<Skeleton variant="block" count={3} height={120} label="Reading what you have to send" />}
        />
      }
      error={<StateBlock kind="failed" what="what you have to send" error={targets.isError ? targets.error : populations.error} />}
      rail={<CostRail form={form} baseline={blank} settledFrom={null} />}
      actLabel={fromBuilder ? "Make this study and go back" : "Make this study"}
      pending={create.isPending}
      onAct={() => {
        if (blockedBecause !== undefined || create.isPending) return;
        create.mutate();
      }}
      blockedBecause={blockedBecause}
      note={
        form.size === 0
          ? "It sends nobody at this size. Making it spends nothing; give it a size before sending them in."
          : "Making it writes its people and spends nothing. Sending them in is a separate press, on the study's page."
      }
      onCancel={() => {
        clear();
        void navigate(href());
      }}
    >
      <Stack gap={12}>
        {restored ? (
          <Inline gap={3} align="center" wrap>
            <Text size="meta" tone="muted">
              Draft restored.
            </Text>
            <Button variant="quiet" size="sm" onClick={startBlank}>
              Start blank
            </Button>
          </Inline>
        ) : null}

        {create.isError ? (
          <WhatWentWrong id={errorId} says="Nothing was made, and nothing has been spent. What is below is still yours to send again." error={create.error} />
        ) : null}

        <StudyFields
          form={form}
          setForm={setForm}
          mode="create"
          targets={targetRows}
          populations={populationRows}
          overriding={[]}
          emptyTargets={
            <StateBlock kind="empty" what="this project's targets">
              <Stack gap={4} align="start">
                <div>Nothing is connected yet. A target is an address your product answers on — dev and qa are two targets here, not two projects.</div>
                <Button asChild variant="secondary">
                  <RouterLink to={linkTo(href("library/targets/new"))}>Connect a target, then come back</RouterLink>
                </Button>
              </Stack>
            </StateBlock>
          }
          emptyPopulations={
            <StateBlock kind="empty" what="this project's populations">
              <Stack gap={4} align="start">
                <div>
                  Nobody can go yet. Personas are kinds of people, cohorts are people who share something, a population is which cohorts
                  go — and this study says how many.
                </div>
                <Button asChild variant="secondary">
                  <RouterLink to={linkTo(href("library/populations/new"))}>Compose a population, then come back</RouterLink>
                </Button>
              </Stack>
            </StateBlock>
          }
        />
      </Stack>
    </BuilderPage>
  );
}

// ---- edit ----------------------------------------------------------------------------------------

function EditStudy() {
  const { key, href } = useProject();
  const { key: studyKey, study, href: studyHref } = useStudy();
  const queries = useQueryClient();
  const targets = useQuery(q.targets(key));
  const populations = useQuery(q.populations(key));

  const [form, setForm] = useState<StudyForm>(() => formOf(study));
  const [baseline, setBaseline] = useState<StudyForm>(() => formOf(study));
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);

  // The row is the source of truth; a save that lands elsewhere (another tab, the daemon) moves
  // this form rather than leaving it holding a stale draft it will overwrite — but only while
  // the reader has not typed, because their typing is the one thing the row cannot know.
  useEffect(() => {
    if (dirty) return;
    const next = formOf(study);
    if (JSON.stringify(next) !== JSON.stringify(baseline)) {
      setForm(next);
      setBaseline(next);
    }
  }, [study, dirty, baseline]);

  const targetRows = targets.data?.items ?? [];
  const populationRows = populations.data?.items ?? [];

  /**
   * What a save moves: the study and everything read under it — the results headline and the
   * people, since a new size re-deals the roster — plus the list and the project that carry it.
   * Named keys, spelled as the URL spells the study (`studyKey`), never `invalidateQueries()` bare.
   */
  const refresh = async (): Promise<void> => {
    await Promise.all([
      queries.invalidateQueries({ queryKey: keys.study(key, studyKey) }),
      queries.invalidateQueries({ queryKey: keys.studies(key) }),
      queries.invalidateQueries({ queryKey: keys.project(key) }),
      queries.invalidateQueries({ queryKey: keys.setup(key) }),
      queries.invalidateQueries({ queryKey: keys.studyPeople(key, studyKey) }),
      queries.invalidateQueries({ queryKey: keys.results(key, studyKey) }),
      queries.invalidateQueries({ queryKey: keys.estimate(key, studyKey) }),
      queries.invalidateQueries({ queryKey: keys.preflight(key, studyKey) }),
    ]);
  };

  /** After a save landed: the form is the baseline again. */
  const settle = (): void => {
    setBaseline(form);
    setSavedAt(new Date().toISOString());
  };

  const save = useMutation({
    mutationFn: () => api.saveStudy(key, studyKey, updateBodyOf(form, baseline)),
    onSuccess: async () => {
      settle();
      await refresh();
    },
  });

  /**
   * Save, then re-resolve and re-snapshot the execution that is going (SPEC §4.2). Two requests
   * in one act because the second is meaningless without the first: applying what is not saved
   * would apply the row as it was. A 409 — a static pool too small for the new size, say — is
   * the server declining, and it is shown in its own words below.
   */
  const apply = useMutation({
    mutationFn: async () => {
      await api.saveStudy(key, studyKey, updateBodyOf(form, baseline));
      return api.applyStudy(key, studyKey);
    },
    onSuccess: async () => {
      settle();
      await refresh();
    },
  });

  const live = study.status === "running" || study.status === "paused";
  const longitudinalLive = live && study.mode === "longitudinal";
  const blockedBecause = blockerOf(form, targetRows, populationRows);
  const busy = save.isPending || apply.isPending;
  const errorId = useId();

  const state: StateKind | undefined =
    targets.isError || populations.isError ? "failed" : targets.isPending || populations.isPending ? "loading" : undefined;

  return (
    <BuilderPage
      mode="edit"
      header={
        <PageHeader
          title={study.name}
          eyebrow="Study"
          crumbs={[{ label: "Studies", to: href() }, { label: study.name, to: studyHref() }, { label: "Edit" }]}
          lede="What it is pointed at, who goes and how many, and how they visit."
          meta={[{ key: "slug", node: <Mono size="code-sm">{study.slug}</Mono> }]}
        />
      }
      state={state}
      loading={
        <StateBlock
          kind="loading"
          what="what you have to send"
          skeleton={<Skeleton variant="block" count={3} height={120} label="Reading what you have to send" />}
        />
      }
      error={<StateBlock kind="failed" what="what you have to send" error={targets.isError ? targets.error : populations.error} />}
      rail={<CostRail form={form} baseline={baseline} settledFrom={dirty ? null : studyKey} />}
      dirty={dirty}
      saving={busy}
      savedAt={savedAt}
      onSave={() => {
        if (blockedBecause !== undefined || busy) return;
        save.mutate();
      }}
      onDiscard={() => {
        setForm(baseline);
      }}
      blockedBecause={blockedBecause}
      note={
        !dirty
          ? undefined
          : longitudinalLive
            ? "The execution that is going froze its settings when it started. Save changes what the next one does; “Apply to the running execution” gives this one the change as well, from each person's next visit."
            : "The next execution uses it."
      }
      extra={
        longitudinalLive ? (
          <Button
            variant="primary"
            disabled={busy || blockedBecause !== undefined || !dirty}
            pending={apply.isPending}
            onClick={() => {
              apply.mutate();
            }}
          >
            Apply to the running execution
          </Button>
        ) : undefined
      }
    >
      <Stack gap={12}>
        {save.isError ? (
          <WhatWentWrong id={errorId} says="Nothing was saved. What is below is still yours to send again." error={save.error} />
        ) : null}
        {apply.isError ? (
          <WhatWentWrong
            id={errorId}
            says="The running execution was not changed. If the save went through, the study is as you left it and the people in this execution take the change only through this."
            error={apply.error}
          />
        ) : null}

        <StudyFields
          form={form}
          setForm={setForm}
          mode="edit"
          targets={targetRows}
          populations={populationRows}
          overriding={study.overriding}
          emptyTargets={
            <StateBlock kind="empty" what="this project's targets">
              Nothing is connected. <Link to={href("library/targets/new")}>Connect a target</Link> and this study can be pointed at it.
            </StateBlock>
          }
          emptyPopulations={
            <StateBlock kind="empty" what="this project's populations">
              Nobody can go. <Link to={href("library/populations/new")}>Compose a population</Link> and this study can send it.
            </StateBlock>
          }
        />
      </Stack>
    </BuilderPage>
  );
}

// ---- the fields both modes share --------------------------------------------------------------------

const MODELS: readonly { value: string; label: string }[] = [
  { value: "", label: "Whatever the project uses" },
  { value: "claude-opus-5", label: "Opus 5 — the most capable, and the most expensive" },
  { value: "claude-sonnet-5", label: "Sonnet 5 — a good default for the people" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5 — cheapest, for wide populations" },
];

const EFFORTS: readonly { value: string; label: string }[] = [
  { value: "", label: "Whatever the project uses" },
  ...EffortSchema.options.map((effort) => ({ value: effort, label: effort })),
];

const JUDGES: readonly { value: string; label: string }[] = [
  { value: "", label: "Whatever the project uses" },
  { value: "model", label: "Ask a model to judge the replay" },
  { value: "heuristic", label: "Compare the replay mechanically (free)" },
];

/** The Settings screen's words for the blocks a study may override, keyed as `overriding` names them. */
const OVERRIDING_WORDS: Record<StudySummary["overriding"][number], string> = {
  spending: "spending",
  verification: "verification",
  model: "model",
};

interface StudyFieldsProps {
  form: StudyForm;
  setForm: (next: StudyForm | ((prev: StudyForm) => StudyForm)) => void;
  mode: "create" | "edit";
  targets: readonly StoredTarget[];
  populations: readonly PopulationView[];
  /** Which blocks the saved study sets for itself; empty in create mode. */
  overriding: StudySummary["overriding"];
  emptyTargets: ReactNode;
  emptyPopulations: ReactNode;
}

/**
 * The five sections, in the order a study is decided: what it is called, where it goes, who goes
 * and how many, how they visit, and what it overrides. Shared by both modes so the two can never
 * drift into asking the same question in different words (§7.1).
 */
function StudyFields({ form, setForm, mode, targets, populations, overriding, emptyTargets, emptyPopulations }: StudyFieldsProps) {
  const { key, href } = useProject();
  const set = <K extends keyof StudyForm>(field: K, value: StudyForm[K]): void => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };
  const setTiming = (patch: Partial<StudyForm["cadence"]>): void => {
    setForm((prev) => ({ ...prev, cadence: { ...prev.cadence, ...patch } }));
  };
  const setCycle = (patch: Partial<StudyForm["reportCycle"]>): void => {
    setForm((prev) => ({ ...prev, reportCycle: { ...prev.reportCycle, ...patch } }));
  };
  const setOverride = (patch: Partial<OverridesForm>): void => {
    setForm((prev) => ({ ...prev, overrides: { ...prev.overrides, ...patch } }));
  };

  const population = useQuery({ ...q.population(key, form.populationId), enabled: form.populationId !== "" });
  const chosenPopulation = populations.find((p) => p.id === form.populationId);
  const slugError = form.slug !== "" && !SLUG.test(form.slug) ? "Lowercase letters, digits and dashes only." : undefined;

  return (
    <>
      <Section title="What">
        <Card>
          <Stack gap={6}>
            <FieldGrid cols={2}>
              <Field label="Name" hint="What you will look for in the list. “Smoke: first-timers”, “Long haul”, “Mobile only”.">
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    describedBy={describedBy}
                    invalid={invalid}
                    value={form.name}
                    onChange={(name) => {
                      setForm((prev) => ({ ...prev, name, slug: prev.slugTouched ? prev.slug : slugOf(name) }));
                    }}
                    placeholder="Smoke: first-timers"
                  />
                )}
              </Field>
              {mode === "create" ? (
                <Field label="Address" hint="Follows the name until you change it. It is in the URL, and it never changes afterwards." error={slugError}>
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      describedBy={describedBy}
                      invalid={invalid}
                      value={form.slug}
                      mono
                      onChange={(slug) => {
                        setForm((prev) => ({ ...prev, slug, slugTouched: true }));
                      }}
                      placeholder="smoke-first-timers"
                    />
                  )}
                </Field>
              ) : null}
            </FieldGrid>

            <Field label="Description" hint="For you and whoever reads the results. Nobody who visits sees it." optional>
              {({ id, describedBy, invalid }) => (
                <TextArea
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={form.description}
                  onChange={(description) => {
                    set("description", description);
                  }}
                  rows={8}
                  placeholder="What this study is for, and what you hope it turns up."
                />
              )}
            </Field>

            <Field
              label="What this study tells them"
              hint="Said to every person, after what their cohort shares and before who they are. Leave it empty to add nothing."
              optional
            >
              {({ id, describedBy, invalid }) => (
                <TextArea
                  id={id}
                  describedBy={describedBy}
                  invalid={invalid}
                  value={form.brief}
                  onChange={(brief) => {
                    set("brief", brief);
                  }}
                  rows={8}
                  placeholder="You have heard the export was rewritten last week. See whether you trust it with your own data."
                />
              )}
            </Field>
          </Stack>
        </Card>
      </Section>

      <Section title="Where">
        <Stack gap={4}>
          <Card>
            {targets.length === 0 ? (
              emptyTargets
            ) : (
              <Field label="Target" hint="An address your product answers on. Re-pointing is how the same cast goes at dev and at qa without being composed twice.">
                {({ id, describedBy, invalid }) => (
                  <Select
                    id={id}
                    describedBy={describedBy}
                    invalid={invalid}
                    value={form.targetId}
                    onChange={(targetId) => {
                      set("targetId", targetId);
                    }}
                    placeholder="Choose a target"
                    options={targets.map((target) => ({ value: target.id, label: target.name }))}
                  />
                )}
              </Field>
            )}
          </Card>
          <MetaSentence>
            Whether it answers, and whether it can be put back the way it was, is checked on “Before you send them” — asking costs a
            connection to somebody else&rsquo;s server.
          </MetaSentence>
        </Stack>
      </Section>

      <Section title="Who" trailing={chosenPopulation === undefined ? undefined : peopleWord(form.size)}>
        <Stack gap={6}>
          <Card>
            {populations.length === 0 ? (
              emptyPopulations
            ) : (
              <Stack gap={6}>
                <Field label="Population" hint="Which cohorts go, at weights. The size below decides how many of each.">
                  {({ id, describedBy, invalid }) => (
                    <Select
                      id={id}
                      describedBy={describedBy}
                      invalid={invalid}
                      value={form.populationId}
                      onChange={(populationId) => {
                        set("populationId", populationId);
                      }}
                      placeholder="Choose a population"
                      options={populations.map((p) => ({ value: p.id, label: `${p.name} — ${plural(p.members.length, "cohort")}` }))}
                    />
                  )}
                </Field>

                <FieldGrid cols={2} align="end">
                  <Field label="Size" hint="How many people go. The weights decide how many of each cohort and persona.">
                    {({ id, describedBy, invalid }) => (
                      <NumberInput
                        id={id}
                        describedBy={describedBy}
                        invalid={invalid}
                        value={form.size}
                        onChange={(size) => {
                          set("size", Math.max(0, Math.floor(size)));
                        }}
                        min={0}
                      />
                    )}
                  </Field>
                  <Stepper
                    label="How many people go"
                    value={form.size}
                    onChange={(size) => {
                      set("size", size);
                    }}
                    min={0}
                    // The size has no ceiling (D5); the stepper's own default of 99 is not one.
                    max={Number.MAX_SAFE_INTEGER}
                  />
                </FieldGrid>
              </Stack>
            )}
          </Card>

          {form.populationId === "" ? null : population.isPending ? (
            <StateBlock kind="loading" what="who would go" skeleton={<Skeleton variant="row" count={3} label="Working out who would go" />} />
          ) : population.isError ? (
            <StateBlock kind="failed" what="who would go" error={population.error} />
          ) : (
            <DealPreview population={population.data} size={form.size} href={href} />
          )}
        </Stack>
      </Section>

      <Section title="How">
        <Stack gap={6}>
          <Text size="read-sm" tone="soft" as="p">
            The one choice here that changes what the results mean.{" "}
            {/*
              The two radio hints below say what each mode does here; this goes to the page that
              says what the pair of words means, under a stable anchor. It is the one decision on
              this screen a reader can get wrong without finding out for a fortnight, so it is the
              one that earns a way out to a longer answer.
            */}
            <Link to="/concepts#modes">Ephemeral and longitudinal, in full</Link>
          </Text>

          <Card>
            <ConditionalFieldset<Mode>
              legend="How they visit"
              name="mode"
              value={form.mode}
              onChange={(next) => {
                set("mode", next);
              }}
              branches={[
                {
                  value: "ephemeral",
                  label: "Ephemeral — a clean slate, and an end",
                  hint: "Everyone arrives remembering nothing, makes a set number of visits, and is finished. Run it again later and the two executions are independent of each other: they will not agree exactly — different people try different things — so what is compared between them is which problems came back, not the numbers.",
                  fields: (
                    <Stack gap={6}>
                      <FieldGrid cols={3}>
                        <Field label="Visits each" hint="How many times each person comes back before they are done.">
                          {({ id, describedBy, invalid }) => (
                            <NumberInput
                              id={id}
                              describedBy={describedBy}
                              invalid={invalid}
                              value={form.visitsPerPerson}
                              onChange={(visitsPerPerson) => {
                                set("visitsPerPerson", Math.max(1, Math.floor(visitsPerPerson)));
                              }}
                              min={1}
                            />
                          )}
                        </Field>
                      </FieldGrid>
                      <Stack gap={3} align="start">
                        <Checkbox
                          checked={form.autoSweep}
                          onChange={(autoSweep) => {
                            set("autoSweep", autoSweep);
                          }}
                          label="Sweep up after them"
                          hint="When the execution ends, the accounts it made on the target are deleted, and the local data with them."
                        />
                        <Checkbox
                          checked={form.requireFreshTarget}
                          onChange={(requireFreshTarget) => {
                            set("requireFreshTarget", requireFreshTarget);
                          }}
                          label="Insist on a fresh target"
                          hint="Refuse to start unless the target can be put back the way it was first. A clean slate on this side is only half of one."
                        />
                      </Stack>
                    </Stack>
                  ),
                },
                {
                  value: "longitudinal",
                  label: "Longitudinal — they keep coming back",
                  hint: "Memory accumulates: someone who was annoyed on visit two is still annoyed on visit nine. It has no end — you pause it, and it picks back up where it stopped. This is the one that finds what only shows up after a week of use.",
                  fields: (
                    <MetaSentence>
                      Nothing caps the visits. The execution runs until you pause it, and a change you save reaches it only through
                      “Apply to the running execution”.
                    </MetaSentence>
                  ),
                },
              ]}
            />
          </Card>

          <Card>
            <Stack gap={6}>
              <Stack gap={1}>
                <Heading level={3} size="name">
                  Timing
                </Heading>
                <Text size="read-sm" tone="soft" as="p">
                  {mode === "edit"
                    ? "As saved. A value you change replaces it on save; untouched, it stays as it is."
                    : "As the project has it. Untouched, a new study keeps taking the project's own timing; a value you change is this study's."}
                </Text>
              </Stack>
              <FieldGrid cols={3} align="end">
                <DurationField
                  label="A visit every"
                  hint="How long each person waits between visits."
                  unit="min"
                  valueMs={form.cadence.every}
                  onChange={(every) => {
                    setTiming({ every });
                  }}
                  min={0}
                />
                <DurationField
                  label="Spread the starts by up to"
                  hint="Random extra wait before each visit, the first included, so a population arrives like people rather than a herd."
                  unit="s"
                  valueMs={form.cadence.jitter}
                  onChange={(jitter) => {
                    setTiming({ jitter });
                  }}
                  min={0}
                />
                <DurationField
                  label="Wait before the first visit"
                  hint="Nought sends them straight in."
                  unit="s"
                  valueMs={form.cadence.initialDelay}
                  onChange={(initialDelay) => {
                    setTiming({ initialDelay });
                  }}
                  min={0}
                />
              </FieldGrid>
              <Stack gap={4}>
                <Stack gap={1}>
                  <Heading level={3} size="name">
                    Reporting
                  </Heading>
                  <Text size="read-sm" tone="soft" as="p">
                    How often populace looks at what it has found and writes to your tracker. It is also what a study
                    compares itself against over time: each report closes a window, and a later one can say a problem has
                    not been reported since. That is an absence, not a repair, and it is said as one.
                  </Text>
                </Stack>
                <FieldGrid cols={3} align="end">
                  <DurationField
                    label="Report every"
                    hint="A longitudinal study never ends, so this is what gives it a history to read itself against."
                    unit="min"
                    valueMs={form.reportCycle.every}
                    onChange={(every) => {
                      setCycle({ every });
                    }}
                    min={0}
                  />
                  <DurationField
                    label="Spread the reports by up to"
                    hint="Random extra wait before each report. Keep it above nought: two executions started in the same minute would otherwise report in lockstep and queue behind each other."
                    unit="min"
                    valueMs={form.reportCycle.jitter}
                    onChange={(jitter) => {
                      setCycle({ jitter });
                    }}
                    min={0}
                  />
                  <DurationField
                    label="Wait before the first report"
                    hint="Nought reports as soon as there is anything to report on."
                    unit="min"
                    valueMs={form.reportCycle.initialDelay}
                    onChange={(initialDelay) => {
                      setCycle({ initialDelay });
                    }}
                    min={0}
                  />
                </FieldGrid>
                <FieldGrid cols={2}>
                  <Field
                    label="Or once this many visits have happened"
                    hint="Whichever comes first. Nought leaves the clock as the only trigger — useful when people come back rarely, since a report nobody visited inside is no evidence either way."
                  >
                    {({ id, describedBy, invalid }) => (
                      <NumberInput
                        id={id}
                        describedBy={describedBy}
                        invalid={invalid}
                        value={form.reportCycle.everyVisits}
                        onChange={(everyVisits) => {
                          setCycle({ everyVisits });
                        }}
                        min={0}
                      />
                    )}
                  </Field>
                </FieldGrid>
              </Stack>
              <FieldGrid cols={2}>
                <Field
                  label="Seed"
                  hint="Starts the draw of names and traits for people nobody has written yet. People already written keep what they have (ADR-0031)."
                >
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      describedBy={describedBy}
                      invalid={invalid}
                      value={form.seed}
                      mono
                      onChange={(seed) => {
                        set("seed", seed);
                      }}
                    />
                  )}
                </Field>
              </FieldGrid>
            </Stack>
          </Card>
        </Stack>
      </Section>

      <Section title="Overrides">
        <Stack gap={4}>
          <Measure width="read">
            <Text size="read-sm" tone="soft" as="p">
              Over the project&rsquo;s settings, for this study alone. Left as &ldquo;whatever the project uses&rdquo;, nothing changes.
              {overriding.length === 0
                ? ""
                : ` This study sets its own ${overriding.map((block) => OVERRIDING_WORDS[block]).join(" and ")}; what it sets is shown below, and a value you change replaces it on save.`}
            </Text>
          </Measure>
          <Card>
            <Disclosure label="Model, spending and the judge" count={overrideBlocks(form.overrides)}>
              <Stack gap={8}>
                <Stack gap={4}>
                  <Heading level={3} size="name">
                    The people
                  </Heading>
                  <FieldGrid cols={2}>
                    <Field label="Model">
                      {({ id, describedBy, invalid }) => (
                        <Select id={id} describedBy={describedBy} invalid={invalid} value={form.overrides.model} onChange={(model) => setOverride({ model })} options={MODELS} />
                      )}
                    </Field>
                    <Field label="Effort">
                      {({ id, describedBy, invalid }) => (
                        <Select id={id} describedBy={describedBy} invalid={invalid} value={form.overrides.effort} onChange={(effort) => setOverride({ effort })} options={EFFORTS} />
                      )}
                    </Field>
                  </FieldGrid>
                </Stack>

                <Stack gap={4}>
                  <Heading level={3} size="name">
                    Spending
                  </Heading>
                  <Text size="meta" tone="muted" as="p">
                    Nought leaves the project&rsquo;s ceiling in place. These stop an execution whatever the estimate says.
                  </Text>
                  <FieldGrid cols={3}>
                    <Field label="Per visit, dollars" hint="A visit that reaches this stops where it is.">
                      {({ id, describedBy, invalid }) => (
                        <NumberInput id={id} describedBy={describedBy} invalid={invalid} value={form.overrides.maxUsd} onChange={(maxUsd) => setOverride({ maxUsd: Math.max(0, maxUsd) })} min={0} step={0.5} />
                      )}
                    </Field>
                    <Field label="Per visit, turns" hint="How many times someone may think before they have to stop.">
                      {({ id, describedBy, invalid }) => (
                        <NumberInput id={id} describedBy={describedBy} invalid={invalid} value={form.overrides.maxTurns} onChange={(maxTurns) => setOverride({ maxTurns: Math.max(0, Math.floor(maxTurns)) })} min={0} />
                      )}
                    </Field>
                    <Field label="Daily, dollars" hint="Trailing 24 hours, across every execution on this machine.">
                      {({ id, describedBy, invalid }) => (
                        <NumberInput id={id} describedBy={describedBy} invalid={invalid} value={form.overrides.dailyUsd} onChange={(dailyUsd) => setOverride({ dailyUsd: Math.max(0, dailyUsd) })} min={0} step={5} />
                      )}
                    </Field>
                  </FieldGrid>
                </Stack>

                <Stack gap={4}>
                  <Heading level={3} size="name">
                    The judge
                  </Heading>
                  <FieldGrid cols={2}>
                    <Field label="How findings are checked" hint="The judge replays a finding's tool calls against the target and rules on what came back.">
                      {({ id, describedBy, invalid }) => (
                        <Select id={id} describedBy={describedBy} invalid={invalid} value={form.overrides.judge} onChange={(judge) => setOverride({ judge })} options={JUDGES} />
                      )}
                    </Field>
                    <Field label="Model" hint="The judge decides what reaches the digest, so it is worth running stronger than the people it judges.">
                      {({ id, describedBy, invalid }) => (
                        <Select id={id} describedBy={describedBy} invalid={invalid} value={form.overrides.judgeModel} onChange={(judgeModel) => setOverride({ judgeModel })} options={MODELS} />
                      )}
                    </Field>
                  </FieldGrid>
                </Stack>
              </Stack>
            </Disclosure>
          </Card>
        </Stack>
      </Section>
    </>
  );
}

// ---- the deal preview --------------------------------------------------------------------------------

/** The deal a population makes of a size, from the view's weights, by the server's own arithmetic. */
function dealOf(population: PopulationView, size: number): Dealt {
  return dealStudy(
    size,
    population.members.map((member) => ({ cohortId: member.cohortId, weight: member.weight })),
    population.members.map((member) => ({ cohortId: member.cohortId, entries: member.personas.map((persona) => ({ personaId: persona.personaId, weight: persona.weight })) })),
  );
}

/**
 * Who would go, at this size, before anybody is written: a ledger where a row IS a cohort, each
 * with its capsule of provisional dots — the mark's own word for *this has not happened yet*
 * (§8.6) — and a sentence per persona in it, in product words. Nobody here has a name, so a dot
 * stands for somebody from this cohort of this kind, not yet written.
 *
 * Above forty a cohort's dots fold five to a cell, as `RosterLattice` does, and the capsule's
 * `total` carries the real count so its sentence still says the number.
 */
function DealPreview({ population, size, href }: { population: PopulationView; size: number; href: (path?: string) => string }) {
  const dealt = dealOf(population, size);
  const nowhere = size - dealt.sends;
  const cohortName = (id: string): string => population.members.find((m) => m.cohortId === id)?.cohortName ?? id;

  if (population.members.length === 0)
    return (
      <StateBlock kind="empty" what={`${population.name}'s cohorts`}>
        {population.name} holds no cohorts yet, so it sends nobody at any size.{" "}
        <Link to={href(`library/populations/${encodeURIComponent(population.id)}`)} size="ui">
          Add cohorts to it
        </Link>
      </StateBlock>
    );

  return (
    <Stack gap={4}>
      <Text size="read-sm" tone="soft" as="p">
        {size === 0
          ? `At nought, nobody goes. Raise the size and ${population.name}'s weights say how many of each.`
          : `At ${peopleWord(size)}: ${peopleWord(dealt.sends)} go${nowhere > 0 ? `, and ${String(nowhere)} have nowhere to go because a cohort has no personas` : ""}. Ties go to the earlier cohort, then the earlier persona.`}
      </Text>
      <Ledger>
        {dealt.cohorts.map((cohort) => {
          const member = population.members.find((m) => m.cohortId === cohort.cohortId);
          const name = cohortName(cohort.cohortId);
          return (
            <LedgerRow key={cohort.cohortId} stub={<Ring size="sm" />}>
              <Stack gap={2}>
                <CohortCapsule name={name} dots={dotsOf(cohort.lanes, name, member)} total={cohort.lanes.length === 0 ? 0 : cohort.count} />
                {member === undefined || member.personas.length === 0 ? (
                  <Text size="meta" tone="muted" as="p">
                    {name} has no personas to draw from, so its {peopleWord(cohort.count)} go nowhere.{" "}
                    <Link to={href(`library/cohorts/${encodeURIComponent(cohort.cohortId)}`)} size="meta">
                      Give it some
                    </Link>
                  </Text>
                ) : (
                  <Stack gap={1}>
                    {cohort.lanes.map((kind) => {
                      const persona = member.personas.find((p) => p.personaId === kind.personaId)?.name ?? kind.personaId;
                      return (
                        <Text key={kind.personaId} size="meta" tone={kind.count === 0 ? "muted" : "soft"} as="p">
                          {kind.count === 0 ? `${persona} in ${name} would send nobody at this size` : `${persona} in ${name}: ${String(kind.count)}`}
                        </Text>
                      );
                    })}
                  </Stack>
                )}
              </Stack>
            </LedgerRow>
          );
        })}
      </Ledger>
    </Stack>
  );
}

/** One provisional dot per person the deal would send from this cohort, labelled by kind. */
function dotsOf(kinds: Dealt["cohorts"][number]["lanes"], cohortName: string, member: PopulationView["members"][number] | undefined): LatticeDot[] {
  const dots: LatticeDot[] = [];
  for (const kind of kinds) {
    const persona = member?.personas.find((p) => p.personaId === kind.personaId)?.name ?? kind.personaId;
    for (let i = 0; i < kind.count; i++) {
      dots.push({ id: `${kind.cohortId}.${kind.personaId}#${String(i)}`, state: "provisional", label: `someone from ${cohortName} (${persona}), not yet written` });
    }
  }
  return dots.length > ROSTER_ONE_TO_ONE_MAX ? foldRoster(dots) : dots;
}

// ---- the cost rail -----------------------------------------------------------------------------------

/**
 * What it would come to, beside the form. A saved study whose form has not moved is priced by
 * its own estimate route (`settledFrom` names it); anything else — a draft, or a form with
 * changes — is priced by `POST /projects/:p/estimate` over the body as it stands, which the
 * server resolves read-only. Neither spends anything, and a deal that sends nobody is a zero
 * estimate, never a refusal, so the rail always has a number to show.
 *
 * The body the query sees trails the form by a beat (`useSettled`), and while it trails, the
 * headcount shown is the client's own deal and the price is held: a stale range beside a new
 * headcount would be a lie with a dollar sign.
 */
function CostRail({ form, baseline, settledFrom }: { form: StudyForm; baseline: StudyForm; settledFrom: string | null }) {
  const { key } = useProject();
  const body = estimateBodyOf(form, baseline);
  const settled = useSettled(body, 300);
  const priced = form.targetId !== "" && form.populationId !== "";
  const current = JSON.stringify(settled) === JSON.stringify(body);

  const saved = useQuery({ ...q.estimate(key, settledFrom ?? ""), enabled: settledFrom !== null && priced });
  const draft = useQuery({ ...q.draftEstimate(key, settled), enabled: settledFrom === null && priced && settled.targetId !== "" && settled.populationId !== "" });
  const estimate: Estimate | undefined = settledFrom !== null ? saved.data : draft.data;
  const population = useQuery({ ...q.population(key, form.populationId), enabled: form.populationId !== "" });

  const dealt = population.data === undefined ? null : dealOf(population.data, form.size);
  const sends = dealt?.sends ?? estimate?.people ?? 0;
  const cap = capOf(form);
  const plan: VisitPlan = estimate !== undefined && current ? visitPlanOf(estimate, cap) : cap === null ? { kind: "round" } : { kind: "capped", each: cap };

  return (
    <Stack gap={4}>
      <Heading level={2} size="eyebrow">
        What it comes to
      </Heading>
      {!priced ? (
        <MetaSentence>Choose a target and a population, and this says roughly what sending them costs.</MetaSentence>
      ) : (
        <CostEstimate
          layout="sentence"
          people={sends}
          cohorts={population.data?.members.length}
          plan={plan}
          basis={current ? costBasisOf(estimate, true) : null}
          peopleSub={sends < form.size ? `of ${String(form.size)} asked for` : undefined}
        />
      )}
      {(settledFrom !== null ? saved.isError : draft.isError) ? (
        <WhatWentWrong says="It could not be priced. The form is unaffected; nothing has been spent." error={(settledFrom !== null ? saved.error : draft.error) ?? new Error("unknown")} />
      ) : null}
    </Stack>
  );
}

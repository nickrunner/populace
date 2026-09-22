import {
  AgentStatusSchema,
  CadenceSchema,
  ContinuedFromSchema,
  FindingKindSchema,
  FindingSchema,
  MemorySchema,
  PersonaSchema,
  RetiredReasonSchema,
  SeveritySchema,
  SimulationModeSchema,
  ToolCallRecordSchema,
  TriageStateSchema,
  VerdictSchema,
  VerificationSchema,
  WakeStatusSchema,
} from "@populace/core/isomorphic";
import { z } from "zod";
import { RunDetailSchema, RunStatusSchema, RunSummarySchema, RunTotalsSchema, ToolUsageViewSchema } from "./views.js";
import { RunEstimateSchema } from "./setup.js";

/**
 * The project, simulation and participant read models (SPEC §6.2), served by
 * `packages/server/src/project-read-model.ts`.
 *
 * Two rules shape every shape below.
 *
 * **Decision A — the wire speaks the user's words.** A `ParticipantSummaryView` is a translation
 * of an `Agent` row: `wakeCount` becomes `visits`, `maxWakes` becomes `maxVisits`, and the word
 * "agent" does not appear on the wire at all. The row, the table and every store method keep
 * their names; this is a boundary, not a rename underneath it.
 *
 * **SPEC §7.1 — the top three levels never name a person.** `ProjectOverviewView` and
 * `SimulationResultsView` carry NO person names, deliberately: a name first appears on a finding
 * page, as the author of a quote. The rule is enforced by these payload shapes rather than by
 * screen discipline, so a screen that wants to break it has to add a request to do it.
 */

// ---- projects --------------------------------------------------------------

export const ProjectViewSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  archived: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ProjectView = z.infer<typeof ProjectViewSchema>;

export const ProjectInputSchema = z.object({
  /** Only honoured on create; a slug never changes afterwards. Derived from the name if absent. */
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  name: z.string().min(1),
  description: z.string().optional(),
});
export type ProjectInput = z.infer<typeof ProjectInputSchema>;

export const ProjectCountsSchema = z.object({
  simulations: z.number().int().nonnegative(),
  targets: z.number().int().nonnegative(),
  personas: z.number().int().nonnegative(),
  cohorts: z.number().int().nonnegative(),
  people: z.number().int().nonnegative(),
});

/** A card on the projects index: what is in it, whether anything is going, what it has cost. */
export const ProjectSummaryViewSchema = ProjectViewSchema.extend({
  counts: ProjectCountsSchema,
  runningRunIds: z.array(z.string()),
  lastActivityAt: z.iso.datetime().nullable(),
  costLast7dUsd: z.number().nonnegative(),
});
export type ProjectSummaryView = z.infer<typeof ProjectSummaryViewSchema>;

// ---- simulations -----------------------------------------------------------

/**
 * `never-run` is not an error state, it is the common one: the zero state is the most important
 * screen in the product, and it is reached by a simulation that exists and has never gone.
 */
export const SimulationStatusSchema = z.enum(["never-run", "running", "paused", "idle", "failed"]);
export type SimulationStatus = z.infer<typeof SimulationStatusSchema>;

export const SimulationSummaryViewSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  mode: SimulationModeSchema,
  visitsPerPerson: z.number().int().positive().nullable(),
  autoSweep: z.boolean(),
  requireFreshTarget: z.boolean(),
  population: z.object({ id: z.string(), name: z.string(), cohorts: z.number().int().nonnegative(), people: z.number().int().nonnegative() }),
  /** `reachable` is null when nobody has asked the target yet; checking it costs a connection. */
  target: z.object({ id: z.string(), name: z.string(), reachable: z.boolean().nullable(), resets: z.boolean() }),
  status: SimulationStatusSchema,
  latest: z
    .object({
      runId: z.string(),
      seq: z.number().int().positive(),
      startedAt: z.iso.datetime().nullable(),
      endedAt: z.iso.datetime().nullable(),
      status: RunStatusSchema,
      totals: RunTotalsSchema,
    })
    .nullable(),
  confirmed: z.number().int().nonnegative(),
  newSinceLast: z.number().int().nonnegative(),
  fixedSinceLast: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  nextVisitAt: z.iso.datetime().nullable(),
  /**
   * Which blocks of the project's settings this simulation sets for itself, in the words the
   * Settings screen uses for them. A simulation that overrides nothing reports nothing, and a
   * screen that shows a limit can say whether editing Settings would move it — otherwise a
   * simulation quietly running on its own ceilings looks exactly like one running on the
   * project's.
   */
  overriding: z.array(z.enum(["spending", "verification", "model"])),
});
export type SimulationSummaryView = z.infer<typeof SimulationSummaryViewSchema>;

export const SimulationInputSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  populationId: z.string().optional(),
  targetId: z.string().optional(),
  /** Null is a longitudinal simulation; a number is an ephemeral one and its visit cap. */
  visitsPerPerson: z.number().int().positive().nullable().optional(),
  cadence: CadenceSchema.partial().optional(),
  seed: z.string().optional(),
  autoSweep: z.boolean().optional(),
  requireFreshTarget: z.boolean().optional(),
});
export type SimulationInput = z.infer<typeof SimulationInputSchema>;

// ---- triage ----------------------------------------------------------------

export const TriageViewSchema = z.object({
  signature: z.string(),
  state: TriageStateSchema,
  note: z.string(),
  externalRef: z.string(),
  titleAtTriage: z.string(),
  updatedAt: z.iso.datetime(),
  /** True when the signature's current title no longer matches the one it was triaged under. */
  drifted: z.boolean(),
});
export type TriageView = z.infer<typeof TriageViewSchema>;

export const TriageInputSchema = z.object({
  signature: z.string().min(1),
  state: TriageStateSchema,
  note: z.string().optional(),
  externalRef: z.string().optional(),
});
export type TriageInput = z.infer<typeof TriageInputSchema>;

// ---- project overview ------------------------------------------------------

/**
 * The project home screen, in one request. NO PERSON NAMES: this is level one of three, and the
 * rule that a name first appears on a finding page is enforced here by the absence of a field to
 * put one in (SPEC §7.1).
 */
export const ProjectOverviewViewSchema = ProjectSummaryViewSchema.extend({
  simulations: z.array(SimulationSummaryViewSchema),
  /** "Seen in more than one simulation" — the same signature, wherever it has shown up. */
  crossSimulation: z.array(
    z.object({
      signature: z.string(),
      title: z.string(),
      kind: FindingKindSchema,
      severity: SeveritySchema,
      tool: z.string().nullable(),
      simulations: z.array(z.object({ id: z.string(), name: z.string() })),
      /** How many distinct PEOPLE hit it, by person id. A headcount is not a name. */
      peopleHit: z.number().int().nonnegative(),
      triage: TriageViewSchema.nullable(),
    }),
  ),
  spentTodayUsd: z.number().nonnegative(),
  dailyCeilingUsd: z.number().nonnegative(),
  killSwitch: z.object({ engaged: z.boolean(), reason: z.string().nullable(), at: z.string().nullable() }),
});
export type ProjectOverviewView = z.infer<typeof ProjectOverviewViewSchema>;

// ---- cohorts and people ----------------------------------------------------

export const PersonViewSchema = z.object({
  id: z.string(),
  ordinal: z.number().int().nonnegative(),
  name: z.string(),
  details: z.string(),
  handle: z.string(),
  generatedBy: z.enum(["model", "seeded", "authored"]),
  patience: z.number().int(),
  budgetUsd: z.number().nonnegative(),
  traits: PersonaSchema.shape.traits,
  archived: z.boolean(),
});
export type PersonView = z.infer<typeof PersonViewSchema>;

export const CohortViewSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  personaId: z.string(),
  personaName: z.string(),
  size: z.number().int().nonnegative(),
  generated: z.object({ model: z.number().int().nonnegative(), seeded: z.number().int().nonnegative(), authored: z.number().int().nonnegative() }),
  cadence: CadenceSchema.partial().nullable(),
  maxWakes: z.number().int().positive().nullable(),
  notes: z.string(),
  usedByPopulations: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type CohortView = z.infer<typeof CohortViewSchema>;

export const CohortInputSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  name: z.string().min(1).optional(),
  personaId: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  cadence: CadenceSchema.partial().nullable().optional(),
  maxWakes: z.number().int().positive().nullable().optional(),
  seed: z.string().optional(),
  notes: z.string().optional(),
  /** Put this cohort into the project's population (or take it out again). */
  inPopulation: z.boolean().optional(),
});
export type CohortInput = z.infer<typeof CohortInputSchema>;

/** The escape hatch: one person, renamed or re-blurbed by hand. */
export const PersonPatchSchema = z.object({ name: z.string().min(1).optional(), details: z.string().optional() });
export type PersonPatch = z.infer<typeof PersonPatchSchema>;

export const GeneratePeopleBodySchema = z.object({
  /** Which ordinals to rewrite. Absent means every one of them. */
  ordinals: z.array(z.number().int().nonnegative()).optional(),
  /** Regeneration replaces people who already exist, so it is refused without this. */
  confirm: z.boolean().default(false),
});
export type GeneratePeopleBody = z.infer<typeof GeneratePeopleBodySchema>;

// ---- preflight -------------------------------------------------------------

/**
 * "I just set this up — did I set it up right?" Who is going, what they will find when they get
 * there, what it will cost, and the actual system prompt one of them will be given.
 *
 * Sample names are here on purpose and are the exception that proves §7.1's rule: the point of
 * this screen is to show a user that the cast is real people before any money is spent.
 */
export const PreflightViewSchema = z.object({
  simulation: SimulationSummaryViewSchema,
  target: z.object({
    id: z.string(),
    name: z.string(),
    /** The tools the people will actually be offered — what the policy leaves, not what the target exposes. */
    tools: z.array(z.string()),
    /**
     * Tools the target exposes that nobody going will be offered, and who they are shut off for.
     * "What will happen if I run this" has to include what will NOT happen: a tool blocked by a
     * typo'd glob is otherwise discovered as a silence in the digest a day later.
     */
    blocked: z.array(z.object({ name: z.string(), who: z.string(), why: z.string() })),
    /** What the merged policy does with tools the target marks destructive (ADR-0013). */
    destructive: z.enum(["allow", "confirm", "deny"]),
    undescribed: z.array(z.string()),
    resets: z.boolean(),
    warnings: z.array(z.string()),
  }),
  cohorts: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      personaName: z.string(),
      people: z.number().int().nonnegative(),
      sampleNames: z.array(z.string()),
    }),
  ),
  totalPeople: z.number().int().nonnegative(),
  plannedVisits: z.number().int().nonnegative(),
  estimate: RunEstimateSchema,
  promptPreview: z.object({ personName: z.string(), cohortSlug: z.string(), text: z.string() }),
  blockers: z.array(z.string()),
});
export type PreflightView = z.infer<typeof PreflightViewSchema>;

// ---- participants ----------------------------------------------------------

/**
 * One participant in one execution. `id` is the agent id — an id is not a name, and ids stay in
 * ochre monospace on every screen that shows one.
 */
export const ParticipantSummaryViewSchema = z.object({
  id: z.string(),
  runId: z.string(),
  /** The durable person (`cohortSlug#n`) this participant is an instance of. */
  personId: z.string(),
  name: z.string(),
  cohortSlug: z.string(),
  cohortName: z.string(),
  personaSlug: z.string(),
  personaName: z.string(),
  role: z.string(),
  status: AgentStatusSchema,
  retiredReason: RetiredReasonSchema.nullable(),
  continuedFrom: ContinuedFromSchema.nullable(),
  visits: z.number().int().nonnegative(),
  maxVisits: z.number().int().positive().nullable(),
  findings: z.number().int().nonnegative(),
  confirmed: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  /** What they said on their last `done` or `give_up` about coming back. */
  wouldReturn: z.boolean().nullable(),
  lastVisitAt: z.iso.datetime().nullable(),
  nextVisitAt: z.iso.datetime().nullable(),
  /**
   * The account they hold on the target, by its readable handle only. The bearer token the
   * credential also carries is never on the wire (`DATA-MODEL.md` §4).
   */
  account: z.object({ email: z.string().nullable(), userId: z.string().nullable() }).nullable(),
});
export type ParticipantSummaryView = z.infer<typeof ParticipantSummaryViewSchema>;

export const VisitSummaryViewSchema = z.object({
  id: z.string(),
  visitNumber: z.number().int().nonnegative(),
  status: WakeStatusSchema,
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  turns: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  findings: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  summary: z.string(),
  wouldReturn: z.boolean().nullable(),
});
export type VisitSummaryView = z.infer<typeof VisitSummaryViewSchema>;

export const FindingSummaryViewSchema = z.object({
  id: z.string(),
  signature: z.string(),
  kind: FindingKindSchema,
  title: z.string(),
  severity: SeveritySchema,
  tool: z.string().nullable(),
  wakeId: z.string(),
  verdict: VerdictSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type FindingSummaryView = z.infer<typeof FindingSummaryViewSchema>;

/**
 * One person's whole page, in ONE request — memory, visits, findings and where else they have
 * been. The screen it replaces fired a memory query per participant and re-polled it every five
 * seconds (`packages/web/src/screens/Population.tsx`), which is the N+1 this shape exists to
 * make impossible.
 */
export const ParticipantDetailViewSchema = ParticipantSummaryViewSchema.extend({
  details: z.string(),
  traits: PersonaSchema.shape.traits,
  patience: z.number().int(),
  budgetUsd: z.number().nonnegative(),
  model: z.string(),
  effort: z.string(),
  memory: MemorySchema.pick({ notes: true, waitingOn: true, annoyances: true, done: true }),
  visits: z.array(VisitSummaryViewSchema),
  findingsFiled: z.array(FindingSummaryViewSchema),
  /** The same person, in other simulations. Empty until they have been in more than one. */
  alsoIn: z.array(
    z.object({
      simulationId: z.string(),
      simulationName: z.string(),
      runId: z.string(),
      seq: z.number().int().positive(),
      visits: z.number().int().nonnegative(),
      findings: z.number().int().nonnegative(),
    }),
  ),
});
export type ParticipantDetailView = z.infer<typeof ParticipantDetailViewSchema>;

/** A row per cohort in one execution. The results screen's "who was hit" without naming anybody. */
export const RunCohortViewSchema = z.object({
  cohortSlug: z.string(),
  name: z.string(),
  personaName: z.string(),
  people: z.number().int().nonnegative(),
  stillActive: z.number().int().nonnegative(),
  gaveUp: z.number().int().nonnegative(),
  visits: z.number().int().nonnegative(),
  findings: z.number().int().nonnegative(),
  confirmed: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  worstSignature: z.string().nullable(),
  headline: z.string(),
});
export type RunCohortView = z.infer<typeof RunCohortViewSchema>;

// ---- results ---------------------------------------------------------------

export const ClusterStateSchema = z.enum(["new", "open", "fixed", "regressed"]);
export type ClusterState = z.infer<typeof ClusterStateSchema>;

export const ClusterCardViewSchema = z.object({
  signature: z.string(),
  title: z.string(),
  severity: SeveritySchema,
  kind: FindingKindSchema,
  tool: z.string().nullable(),
  verdict: VerdictSchema.nullable(),
  peopleHit: z.number().int().nonnegative(),
  peopleTotal: z.number().int().nonnegative(),
  reports: z.number().int().nonnegative(),
  cohorts: z.array(z.object({ slug: z.string(), name: z.string(), hit: z.number().int().nonnegative(), total: z.number().int().nonnegative() })),
  state: ClusterStateSchema,
  /** Execution sequence numbers this has been seen in. */
  seenIn: z.array(z.number().int().positive()),
  firstSeenAt: z.iso.datetime().nullable(),
  lastSeenAt: z.iso.datetime().nullable(),
  triage: TriageViewSchema.nullable(),
});
export type ClusterCardView = z.infer<typeof ClusterCardViewSchema>;

export const ExecutionHistoryEntrySchema = z.object({
  runId: z.string(),
  seq: z.number().int().positive(),
  label: z.string(),
  status: RunStatusSchema,
  startedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  visits: z.number().int().nonnegative(),
  findings: z.number().int().nonnegative(),
  confirmed: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export type ExecutionHistoryEntry = z.infer<typeof ExecutionHistoryEntrySchema>;

/**
 * The whole results screen in one request. NO PERSON NAMES (SPEC §7.1): `walkedAway` carries the
 * person ID and the cohort, and the name is fetched by the screen that is allowed to show one.
 */
export const SimulationResultsViewSchema = z.object({
  simulation: SimulationSummaryViewSchema,
  /**
   * The execution these results are OF: the most recent one that actually sent somebody. A run
   * that has been created and has not visited yet has nothing to report — reading its silence as
   * an absence would call every open problem fixed — so it appears in `simulation.latest` and in
   * `history`, and the numbers here stay with the execution that has something to say.
   */
  execution: RunDetailSchema.nullable(),
  headline: z.string(),
  stats: z.object({
    people: z.number().int().nonnegative(),
    visits: z.number().int().nonnegative(),
    confirmed: z.number().int().nonnegative(),
    walkedAway: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
  }),
  clusters: z.array(ClusterCardViewSchema),
  cohortBreakdown: z.array(RunCohortViewSchema),
  coverage: ToolUsageViewSchema,
  walkedAway: z.array(
    z.object({
      personId: z.string(),
      cohortSlug: z.string(),
      wakeId: z.string(),
      quote: z.string(),
      wouldReturn: z.boolean().nullable(),
    }),
  ),
  history: z.array(ExecutionHistoryEntrySchema),
  /** Triaged fixed or won't-fix: below the fold, not gone. */
  known: z.array(ClusterCardViewSchema),
});
export type SimulationResultsView = z.infer<typeof SimulationResultsViewSchema>;

/** The finding page. This is where names are allowed, as the authors of quotes. */
export const ClusterDetailViewSchema = ClusterCardViewSchema.extend({
  representative: FindingSchema,
  quotes: z.array(
    z.object({
      personId: z.string(),
      name: z.string(),
      cohortSlug: z.string(),
      cohortName: z.string(),
      wakeId: z.string(),
      visitNumber: z.number().int().nonnegative(),
      text: z.string(),
    }),
  ),
  reproduction: z.array(ToolCallRecordSchema),
  replay: VerificationSchema.nullable(),
  peopleHit: z.array(ParticipantSummaryViewSchema),
  peopleMissed: z.array(z.object({ cohortSlug: z.string(), name: z.string(), count: z.number().int().nonnegative() })),
  history: z.array(z.object({ runId: z.string(), seq: z.number().int().positive(), reports: z.number().int().nonnegative(), verdict: VerdictSchema.nullable() })),
});
export type ClusterDetailView = z.infer<typeof ClusterDetailViewSchema>;

export const ExecutionCompareViewSchema = z.object({
  a: RunSummarySchema,
  b: RunSummarySchema,
  persisting: z.array(ClusterCardViewSchema),
  fixed: z.array(ClusterCardViewSchema),
  appeared: z.array(ClusterCardViewSchema),
  /** True when both executions ran the same cast — otherwise a difference may be who went. */
  castIdentical: z.boolean(),
  notes: z.array(z.string()),
});
export type ExecutionCompareView = z.infer<typeof ExecutionCompareViewSchema>;

// ---- bodies ----------------------------------------------------------------

export const StartExecutionBodySchema = z.object({
  label: z.string().optional(),
  /** ADR-0020's child run. "Run it again" passes nothing at all, which is the clean slate. */
  carryForwardFrom: z.string().optional(),
  reason: z.string().optional(),
});
export type StartExecutionBody = z.infer<typeof StartExecutionBodySchema>;

export const CompareQuerySchema = z.object({ a: z.string(), b: z.string() });
export type CompareQuery = z.infer<typeof CompareQuerySchema>;

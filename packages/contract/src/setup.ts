import {
  CadenceSchema,
  DaemonConfigSchema,
  EventSchema,
  GuardrailsSchema,
  IdentityConfigSchema,
  JobSchema,
  ModelConfigSchema,
  PersonaSpecSchema,
  RunStatusSchema,
  VerifierConfigSchema,
} from "@populace/core/isomorphic";
import { z } from "zod";

/**
 * The M2 wire shapes: authoring config, starting and steering runs, and watching one happen
 * (`WEB-ARCHITECTURE.md` §5). Two rules from M1 apply to every one of them — a secret is never on
 * the wire in either direction except as a write, and nothing that spends money is a side effect
 * of a GET.
 */

// ---- targets --------------------------------------------------------------

/**
 * An endpoint as the browser may see it. `bearerToken` is write-only: it goes up when a user types
 * one and never comes back down, so `authenticated` is how the form knows one is already stored.
 */
export const EndpointViewSchema = z.object({
  name: z.string(),
  url: z.string(),
  authenticated: z.boolean(),
});

export const EndpointInputSchema = z.object({
  name: z.string().min(1).default("default"),
  url: z.url(),
  /** Omitted leaves a stored token alone; the empty string clears it. */
  bearerToken: z.string().optional(),
});

export const TargetInputSchema = z.object({
  name: z.string().min(1),
  mcp: z.array(EndpointInputSchema).min(1),
  webBaseUrl: z.url().optional(),
  /** "What the marketing says", handed to every person before their first visit. */
  description: z.string().optional(),
  identity: IdentityConfigSchema,
});
export type TargetInput = z.infer<typeof TargetInputSchema>;

export const StoredTargetViewSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  mcp: z.array(EndpointViewSchema),
  webBaseUrl: z.string().nullable(),
  description: z.string().nullable(),
  identity: IdentityConfigSchema,
  updatedAt: z.iso.datetime(),
});
export type StoredTargetView = z.infer<typeof StoredTargetViewSchema>;

export const CheckedToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  endpoint: z.string(),
  destructive: z.boolean(),
  readOnly: z.boolean(),
});

/**
 * What the identity section pre-fills from. These are guesses from the tool list, offered as
 * suggestions and never applied silently: choosing wrong means every agent fails to sign up.
 */
export const IdentityGuessSchema = z.object({
  signupTool: z.string().nullable(),
  tokenPath: z.string().nullable(),
  userIdPath: z.string().nullable(),
  teardownTool: z.string().nullable(),
  /** Why each guess was made, in one line per field, for a user deciding whether to trust it. */
  because: z.array(z.string()),
});
export type IdentityGuess = z.infer<typeof IdentityGuessSchema>;

export const TargetCheckSchema = z.object({
  ok: z.boolean(),
  checkedAt: z.iso.datetime(),
  latencyMs: z.number().nonnegative().nullable(),
  server: z.object({ name: z.string(), version: z.string() }).nullable(),
  tools: z.array(CheckedToolSchema),
  /**
   * Tools whose description is empty. People decide what to try from descriptions alone, so an
   * undescribed tool will most likely never be touched — this is the screen's whole point.
   */
  undescribed: z.array(z.string()),
  identity: IdentityGuessSchema,
  errors: z.array(z.string()),
});
export type TargetCheck = z.infer<typeof TargetCheckSchema>;

/**
 * The website's copy against the tool list: a promise with no tool behind it is a coverage gap
 * found before a single visit is spent.
 */
export const TargetPromisesSchema = z.object({
  fetched: z.boolean(),
  url: z.string().nullable(),
  error: z.string().nullable(),
  promises: z.array(z.object({ text: z.string(), kept: z.boolean(), matchedTool: z.string().nullable() })),
});
export type TargetPromises = z.infer<typeof TargetPromisesSchema>;

// ---- personas -------------------------------------------------------------

export const PersonaViewSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  /** Immutable, and what agent ids are built from. Renaming the display name never touches it. */
  slug: z.string(),
  spec: PersonaSpecSchema,
  origin: z.enum(["starter", "authored", "imported"]),
  updatedAt: z.iso.datetime(),
  /** How many agents this person contributes to the next run, via the population's member row. */
  count: z.number().int().nonnegative(),
});
export type PersonaView = z.infer<typeof PersonaViewSchema>;

export const PersonaInputSchema = z.object({
  /** Only honoured on create; a slug never changes afterwards. Derived from the name if absent. */
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
  spec: PersonaSpecSchema.omit({ id: true }),
});
export type PersonaInput = z.infer<typeof PersonaInputSchema>;

export const StarterPersonaViewSchema = z.object({
  slug: z.string(),
  name: z.string(),
  role: z.string(),
  /** The one line the picker shows. */
  summary: z.string(),
});
export type StarterPersonaView = z.infer<typeof StarterPersonaViewSchema>;

export const AddStarterBodySchema = z.object({ slug: z.string().min(1), count: z.number().int().nonnegative().default(1) });

// ---- population and settings ---------------------------------------------

/**
 * A population is composition now: an ordered set of cohorts, where a cohort is "N people on one
 * persona". `scale` is gone — two numbers deciding how many people exist (count × scale) is
 * exactly the ambiguity the restructure removes.
 */
export const PopulationViewSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  seed: z.string(),
  cadence: CadenceSchema,
  maxWakes: z.number().int().positive().nullable(),
  members: z.array(
    z.object({
      cohortId: z.string(),
      cohort: z.string(),
      cohortName: z.string(),
      personaId: z.string(),
      slug: z.string(),
      name: z.string(),
      count: z.number().int().nonnegative(),
      maxWakes: z.number().int().positive().nullable(),
    }),
  ),
});
export type PopulationView = z.infer<typeof PopulationViewSchema>;

export const PopulationInputSchema = z.object({
  seed: z.string().optional(),
  cadence: CadenceSchema.partial().optional(),
  maxWakes: z.number().int().positive().nullable().optional(),
  members: z.array(z.object({ personaId: z.string(), count: z.number().int().nonnegative(), maxWakes: z.number().int().positive().nullable().optional() })).optional(),
});
export type PopulationInput = z.infer<typeof PopulationInputSchema>;

/** `model.apiKey` is absent by construction: a key is configured in the environment, not a form. */
export const SettingsViewSchema = z.object({
  model: ModelConfigSchema.omit({ apiKey: true }),
  guardrails: GuardrailsSchema,
  verifier: VerifierConfigSchema,
  daemon: DaemonConfigSchema,
  /** Whether the process has a key at all. Without one, nothing that calls the model can run. */
  hasApiKey: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export type SettingsView = z.infer<typeof SettingsViewSchema>;

export const SettingsInputSchema = z.object({
  model: ModelConfigSchema.omit({ apiKey: true }).partial().optional(),
  guardrails: GuardrailsSchema.partial().optional(),
  verifier: VerifierConfigSchema.partial().optional(),
  daemon: DaemonConfigSchema.partial().optional(),
});
export type SettingsInput = z.infer<typeof SettingsInputSchema>;

/** Everything standing between this project and its first run, in the words the screen shows. */
export const SetupStatusSchema = z.object({
  ready: z.boolean(),
  blockers: z.array(z.string()),
  targetId: z.string().nullable(),
  personaCount: z.number().int().nonnegative(),
  agentCount: z.number().int().nonnegative(),
  hasApiKey: z.boolean(),
  killSwitch: z.object({ engaged: z.boolean(), reason: z.string().nullable(), at: z.string().nullable() }),
  runningRunIds: z.array(z.string()),
});
export type SetupStatus = z.infer<typeof SetupStatusSchema>;

// ---- estimating and starting ---------------------------------------------

export const RunEstimateSchema = z.object({
  /** `history` when this machine has priced wakes to learn from, `default` on a first run. */
  basis: z.enum(["history", "default"]),
  sampleSize: z.number().int().nonnegative(),
  perWakeUsd: z.number().nonnegative(),
  agents: z.number().int().nonnegative(),
  visits: z.number().int().nonnegative(),
  /** False when nothing caps the visits, in which case the total is a rate, not a ceiling. */
  bounded: z.boolean(),
  assumedWakesPerAgent: z.number().int().positive().nullable(),
  lowUsd: z.number().nonnegative(),
  expectedUsd: z.number().nonnegative(),
  highUsd: z.number().nonnegative(),
  /** One row per COHORT. Two cohorts may share a persona, so `cohort` is what tells the rows apart. */
  perPersona: z.array(z.object({ cohort: z.string(), personaId: z.string(), agents: z.number().int(), visits: z.number().int(), capped: z.boolean(), expectedUsd: z.number().nonnegative() })),
  model: z.string(),
  effort: z.string(),
  /** The guardrails that will actually stop it, whatever the arithmetic above says (ADR-0009). */
  stops: z.object({
    perWakeUsd: z.number(),
    perWakeTurns: z.number().int(),
    dailyUsd: z.number(),
    maxWakesPerAgent: z.number().int().nullable(),
  }),
});
export type RunEstimate = z.infer<typeof RunEstimateSchema>;

export const StartRunBodySchema = z.object({
  label: z.string().optional(),
  /** Carry a previous run's agents, memory and accounts forward (ADR-0020). */
  continueFrom: z.string().optional(),
  continuationReason: z.string().optional(),
});
export type StartRunBody = z.infer<typeof StartRunBodySchema>;

export const StopRunBodySchema = z.object({
  /** `drain` lets the visits in flight finish; `now` engages the kill switch mid-visit. */
  mode: z.enum(["drain", "now"]).default("drain"),
});

export const KillSwitchBodySchema = z.object({ engaged: z.boolean(), reason: z.string().optional() });

export const SweepBodySchema = z.object({ dryRun: z.boolean().default(false), keepData: z.boolean().default(true) });

export const StartedRunSchema = z.object({
  runId: z.string(),
  jobId: z.string(),
  configSnapshotId: z.string(),
  label: z.string(),
});
export type StartedRun = z.infer<typeof StartedRunSchema>;

export const JobViewSchema = JobSchema;
export type JobView = z.infer<typeof JobViewSchema>;

// ---- live -----------------------------------------------------------------

export { EventSchema };

/**
 * A card on `Where everyone is`: who is mid-visit, who is away, and when they come back. Derived
 * from agent and wake rows rather than stored, so it is correct after a reload with no live
 * connection at all.
 */
export const AgentLiveSchema = z.object({
  agentId: z.string(),
  personaId: z.string(),
  personaName: z.string(),
  status: z.enum(["here", "away", "retired"]),
  wakeId: z.string().nullable(),
  wakeNumber: z.number().int().nonnegative(),
  maxWakes: z.number().int().positive().nullable(),
  turn: z.number().int().nonnegative(),
  lastCall: z.string().nullable(),
  nextWakeAt: z.iso.datetime().nullable(),
  costUsd: z.number().nonnegative(),
  findingCount: z.number().int().nonnegative(),
});
export type AgentLive = z.infer<typeof AgentLiveSchema>;

export const RunLiveSchema = z.object({
  runId: z.string(),
  status: RunStatusSchema,
  startedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  /** The cursor a client should resume the event stream from if it renders this snapshot first. */
  cursor: z.number().int().nonnegative(),
  visitsDone: z.number().int().nonnegative(),
  visitsPlanned: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  findings: z.number().int().nonnegative(),
  agents: z.array(AgentLiveSchema),
});
export type RunLive = z.infer<typeof RunLiveSchema>;

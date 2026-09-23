import {
  DaemonConfigSchema,
  EventSchema,
  FirebaseAdminConfigSchema,
  FirstContactSchema,
  GuardrailsOverrideSchema,
  GuardrailsSchema,
  JobSchema,
  ModelConfigSchema,
  NoAccountsConfigSchema,
  PauseReasonSchema,
  PersonaSpecSchema,
  ProvisionUrlConfigSchema,
  RunStatusSchema,
  SelfSignupConfigSchema,
  SimulationModeSchema,
  StaticIdentityConfigSchema,
  ToolPolicySchema,
  VerifierConfigSchema,
  VerifierOverrideSchema,
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

/**
 * The identity block as the browser may see it. admin-mint's `apiKey` mints and renews sessions,
 * so it obeys the same rule as a bearer token: it goes up when a user types one and never comes
 * back down. `apiKeySet` is how the form knows one is already stored.
 */
export const IdentityConfigViewSchema = z.discriminatedUnion("strategy", [
  SelfSignupConfigSchema,
  StaticIdentityConfigSchema,
  FirebaseAdminConfigSchema.omit({ apiKey: true }).extend({ apiKeySet: z.boolean() }),
  // The provisioning secret obeys the same rule as every other credential: it goes up and never
  // comes back down. `secretSet` is how the form knows one is stored without being shown it.
  ProvisionUrlConfigSchema.omit({ secret: true }).extend({ secretSet: z.boolean() }),
  // Nobody needs an account here (ADR-0038). It carries no fields, so there is nothing to hide
  // on the way down and nothing to keep on the way up: it is the core schema, both directions.
  NoAccountsConfigSchema,
]);
export type IdentityConfigView = z.infer<typeof IdentityConfigViewSchema>;

/**
 * The identity block on the way up. admin-mint's `apiKey` follows `EndpointInputSchema.bearerToken`
 * exactly — absent leaves the stored key alone, the empty string clears it — which is why this is
 * the core schema with that one field relaxed rather than the core schema itself.
 */
export const IdentityConfigInputSchema = z.discriminatedUnion("strategy", [
  SelfSignupConfigSchema,
  StaticIdentityConfigSchema,
  FirebaseAdminConfigSchema.extend({ apiKey: z.string().optional() }),
  ProvisionUrlConfigSchema.extend({ secret: z.string().optional() }),
  NoAccountsConfigSchema,
]);
export type IdentityConfigInput = z.infer<typeof IdentityConfigInputSchema>;

export const TargetInputSchema = z.object({
  name: z.string().min(1),
  mcp: z.array(EndpointInputSchema).min(1),
  webBaseUrl: z.url().optional(),
  /** "What the marketing says", handed to every person before their first visit. */
  description: z.string().optional(),
  identity: IdentityConfigInputSchema,
  /**
   * What anybody sent here may touch. This is the altitude the decision belongs at: a tool that is
   * dangerous is dangerous whichever persona reaches for it, and a persona's policy is merged onto
   * this one so it can only ever narrow it. Absent leaves whatever is stored alone.
   */
  tools: ToolPolicySchema.optional(),
});
export type TargetInput = z.infer<typeof TargetInputSchema>;

export const StoredTargetViewSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  mcp: z.array(EndpointViewSchema),
  webBaseUrl: z.string().nullable(),
  description: z.string().nullable(),
  identity: IdentityConfigViewSchema,
  tools: ToolPolicySchema,
  /** The last first-contact check, or null when nobody has run one. Never holds a credential. */
  firstContact: FirstContactSchema.nullable(),
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

/**
 * YOUR sign-in to an address (ADR-0036), on the wire. Never the tokens: a credential goes up and
 * never comes back down, so this says whether one is held and when it dies, and nothing else.
 *
 * It is deliberately separate from `identity` on a target. This is the one human connecting;
 * `identity` is how the STRANGERS a simulation sends get accounts of their own. A screen that
 * blurred the two would be promising that signing in here is enough to run a population, which it
 * is not, and the copy says so.
 */
export const SignInStatusSchema = z.object({
  /** The address this is about, normalised. */
  url: z.string(),
  /** The endpoint refuses anonymous callers. */
  required: z.boolean(),
  /** It publishes OAuth metadata naming an authorization server, so populace can do this for you. */
  supported: z.boolean(),
  /** A usable grant is held. */
  connected: z.boolean(),
  /** What the resource calls itself, when it published a name. */
  resourceName: z.string().nullable(),
  authorizationServer: z.string().nullable(),
  /** What the sign-in asks for, in the server's own words. */
  scopes: z.array(z.string()),
  /** When the access token dies. Null when it does not expire or the server did not say. */
  expiresAt: z.iso.datetime().nullable(),
  /** Whether a refresh token is held — the difference between a sign-in that lasts and one that does not. */
  renewable: z.boolean(),
  /** What went wrong finding any of this out, when something did. */
  error: z.string().nullable(),
});
export type SignInStatus = z.infer<typeof SignInStatusSchema>;

/** Starting a flow: the address to sign in to. */
export const SignInStartBodySchema = z.object({ url: z.url() });
export type SignInStartBody = z.infer<typeof SignInStartBodySchema>;

/**
 * Where to send the browser. `authorizeUrl` is null when the grant already held turned out to be
 * enough — a refresh that still works — and the answer is "you are already signed in".
 */
export const SignInStartResultSchema = z.object({
  authorizeUrl: z.url().nullable(),
  status: SignInStatusSchema,
});
export type SignInStartResult = z.infer<typeof SignInStartResultSchema>;

export const SignInQuerySchema = z.object({ url: z.string() });
export type SignInQuery = z.infer<typeof SignInQuerySchema>;

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
  /**
   * Why it would not talk to us, when that is the reason it did not. Null when the address was
   * reached, and null when it failed for any other reason — "could not reach it" and "it will not
   * talk to strangers" are different sentences and the screen says the right one.
   */
  signIn: SignInStatusSchema.nullable(),
  /**
   * What is at the address, when the check did not get through. Null when it did.
   *
   * "Could not reach it" used to be the only thing the screen could say, and it covered four
   * different situations. Two of them a reader fixes in seconds once they are told which one they
   * have: nothing is listening, or something is listening that is not an MCP server — a mistyped
   * path answers the second way, with an HTML 404 that used to be printed at them in full.
   */
  reached: z
    .object({
      kind: z.enum(["nothing", "not-mcp", "gated", "mcp"]),
      /** The target's own words, stripped of markup and clipped. Null when it said nothing. */
      says: z.string().nullable(),
    })
    .nullable(),
  errors: z.array(z.string()),
});
export type TargetCheck = z.infer<typeof TargetCheckSchema>;

/**
 * The result of one first-contact check, on the wire. It is the core schema unchanged: the shape
 * is stored on the target row and rendered in the browser, and a second spelling of it would be a
 * second thing to keep honest about what it does and does not carry.
 */
export { FirstContactSchema };
export type { FirstContact } from "@populace/core/isomorphic";

/**
 * The TDK handshake as this screen asks it (ADR-0038): does the address answer, is the secret the
 * one it expects, and what has the app actually implemented behind it.
 *
 * `secret` is optional for the same reason it is optional everywhere else — a form editing a
 * saved target has never been shown the secret it is editing — and `target` is how the server
 * finds the stored one. A body with neither is checked with no secret at all, which the kit
 * answers `unauthorized` to, and that is the honest result rather than a guess.
 */
export const ProvisioningCheckBodySchema = z.object({
  url: z.url(),
  /** Absent means "use whatever `target` has stored". Present is used as typed. */
  secret: z.string().optional(),
  /** A saved target to read the stored secret from, when the form has not been shown one. */
  target: z.string().optional(),
});
export type ProvisioningCheckBody = z.infer<typeof ProvisioningCheckBodySchema>;

/**
 * What the handshake found, in the register first contact uses: one sentence a human can act on,
 * and the machine's own words underneath when there are any.
 *
 * Four outcomes and not six, because four is all that can happen to a `GET` that creates nobody:
 * it answered, nothing was there, it refused, or something answered that is not the kit.
 */
export const ProvisioningCheckSchema = z.object({
  outcome: z.enum(["answered", "unreachable", "refused", "not-a-kit"]),
  summary: z.string(),
  /** The kit's own words, or the transport's. Null when there was nothing to quote. */
  detail: z.string().nullable(),
  /** The contract version the kit implements. Null unless it answered. */
  tdk: z.number().int().nullable(),
  /** `development`, `production`, or whatever the app called it. Null when it did not say. */
  environment: z.string().nullable(),
  /** What the app implemented, as the kit reports it. Null unless it answered. */
  capabilities: z.object({ refresh: z.boolean(), teardown: z.boolean(), listByTag: z.boolean() }).nullable(),
});
export type ProvisioningCheck = z.infer<typeof ProvisioningCheckSchema>;

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
  /** How many cohorts draw on this persona. Headcount is the population's, not the persona's. */
  cohorts: z.number().int().nonnegative(),
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
 * Which cohorts go and how many of each (ADR-0039). Each member is one cohort at a size, and the
 * size is apportioned across the cohort's mix — `personas[].count` is that arithmetic, done here
 * so a screen never repeats it.
 */
export const PopulationViewSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  members: z.array(
    z.object({
      cohortId: z.string(),
      cohort: z.string(),
      cohortName: z.string(),
      context: z.string(),
      /** How many of this cohort's people this population sends. */
      size: z.number().int().positive(),
      personas: z.array(z.object({ personaId: z.string(), slug: z.string(), name: z.string(), count: z.number().int().nonnegative() })),
      /** The cohort's own visit cap. `maxWakes` on the row; the wire says visits (ADR-0032). */
      maxVisits: z.number().int().positive().nullable(),
    }),
  ),
  /** The sum of the member sizes: the only headcount there is. */
  people: z.number().int().nonnegative(),
});
export type PopulationView = z.infer<typeof PopulationViewSchema>;

/**
 * `members`, when sent, IS the composition: the whole ordered set with a size each, so one PUT is
 * add, resize and remove at once and there is no separate route for any of them. A member at
 * nought is taken out. Setting a size is what writes the people (ADR-0039).
 *
 * `seed`, `cadence` and `maxWakes` are not here: the cap decides a simulation's mode (ADR-0030)
 * and belongs to the simulation; the cadence and the seed belong to the cohort.
 */
export const PopulationInputSchema = z.object({
  name: z.string().min(1).optional(),
  members: z.array(z.object({ cohortId: z.string().min(1), size: z.number().int().nonnegative() })).optional(),
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

/**
 * A patch over the stored settings: what a form sends is merged field-wise, so a field it does not
 * mention keeps the value the project already has. The guardrail and verifier blocks are the
 * no-default override schemas rather than `.partial()` of the full ones — `.partial()` leaves each
 * field's `.default()` in place, so `{ dailyUsd: 12 }` would arrive carrying every other ceiling
 * at its schema default and overwrite them on the way through.
 */
export const SettingsInputSchema = z.object({
  model: ModelConfigSchema.omit({ apiKey: true }).partial().optional(),
  guardrails: GuardrailsOverrideSchema.optional(),
  verifier: VerifierOverrideSchema.optional(),
  daemon: DaemonConfigSchema.partial().optional(),
});
export type SettingsInput = z.infer<typeof SettingsInputSchema>;

/** Everything standing between this project and its first run, in the words the screen shows. */
/**
 * What is left to do, and what it is about.
 *
 * `scope` is what lets a screen put the sentence on the row it names instead of in a pile at the
 * top — a project with three targets says which one has never been checked. There is deliberately
 * NO path or label here: a browser route in a server payload is a routing table maintained in two
 * places, and this product moves its routes. The web derives the link from `kind` and `id`.
 */
export const NeedSchema = z.object({
  id: z.string(),
  sentence: z.string(),
  /**
   * Whether this STOPS an execution, as opposed to merely being left to do. `blockers` and
   * `ready` are derived from the blocking ones alone: "nobody has checked that Tasklet answers"
   * is worth saying and must not gate the go button.
   */
  blocking: z.boolean(),
  scope: z.object({
    kind: z.enum(["project", "target", "population", "simulation"]),
    id: z.string(),
  }),
});
export type Need = z.infer<typeof NeedSchema>;

export const SetupStatusSchema = z.object({
  ready: z.boolean(),
  /**
   * The same sentences as `needs`, flattened.
   *
   * Kept because `Preflight` and the first-run panel both read it and neither needs the scope,
   * and because a wire field with three consumers is not worth a coordinated change. It is
   * DERIVED from `needs` — one builder, so the two can never come to disagree.
   */
  blockers: z.array(z.string()),
  /** The same leftovers, each knowing what it is about. See `NeedSchema`. */
  needs: z.array(NeedSchema),
  targetId: z.string().nullable(),
  personaCount: z.number().int().nonnegative(),
  /** How many PEOPLE the population holds. The wire does not say "agent" (Decision A). */
  peopleCount: z.number().int().nonnegative(),
  hasApiKey: z.boolean(),
  killSwitch: z.object({ engaged: z.boolean(), reason: z.string().nullable(), at: z.string().nullable() }),
  runningRunIds: z.array(z.string()),
  /** The simulations this project holds, so a caller can name one without a second request. */
  simulationIds: z.array(z.object({ id: z.string(), slug: z.string(), name: z.string() })),
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
  /** One row per LANE — a cohort and one of the personas it mixes — so `lane` is what tells the rows apart. */
  perCohort: z.array(z.object({ lane: z.string(), cohort: z.string(), personaId: z.string(), agents: z.number().int(), visits: z.number().int(), capped: z.boolean(), expectedUsd: z.number().nonnegative() })),
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
 * A card on the live screen: who is mid-visit, who is away, and when they come back. Derived from
 * agent and wake rows rather than stored, so it is correct after a reload with no live connection
 * at all.
 *
 * The wire speaks the user's words (Decision A): a card is labelled by the PERSON and their
 * cohort, and the id it carries is `participantId`.
 */
export const ParticipantLiveSchema = z.object({
  participantId: z.string(),
  personId: z.string(),
  name: z.string(),
  cohortSlug: z.string(),
  personaName: z.string(),
  status: z.enum(["here", "away", "retired"]),
  wakeId: z.string().nullable(),
  visitNumber: z.number().int().nonnegative(),
  maxVisits: z.number().int().positive().nullable(),
  turn: z.number().int().nonnegative(),
  lastCall: z.string().nullable(),
  nextVisitAt: z.iso.datetime().nullable(),
  costUsd: z.number().nonnegative(),
  findings: z.number().int().nonnegative(),
});
export type ParticipantLive = z.infer<typeof ParticipantLiveSchema>;

export const RunLiveSchema = z.object({
  runId: z.string(),
  status: RunStatusSchema,
  /** Which controls the screen offers: Pause for a longitudinal execution, Stop for an ephemeral one. */
  mode: SimulationModeSchema,
  /**
   * Why it is not going, when it is not going. `process-ended` is the one a laptop produces and
   * the one the screen has to say out loud: nothing failed, populace was closed, and the run is
   * sitting where it was left (SPEC §4.2). Without it on the wire a paused run and an abandoned
   * one are the same word.
   */
  pauseReason: PauseReasonSchema.nullable(),
  startedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime().nullable(),
  /** The cursor a client should resume the event stream from if it renders this snapshot first. */
  cursor: z.number().int().nonnegative(),
  visitsDone: z.number().int().nonnegative(),
  visitsPlanned: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  findings: z.number().int().nonnegative(),
  participants: z.array(ParticipantLiveSchema),
});
export type RunLive = z.infer<typeof RunLiveSchema>;

/** Creating a population: composition starts empty and cohorts are put into it afterwards. */
export const PopulationCreateSchema = z.object({ name: z.string().min(1), slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional() });
export type PopulationCreate = z.infer<typeof PopulationCreateSchema>;

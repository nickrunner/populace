import {
  CadenceSchema,
  DaemonConfigSchema,
  EventTypeSchema,
  FirebaseAdminConfigSchema,
  FirstContactSchema,
  GuardrailsOverrideSchema,
  GuardrailsSchema,
  JobSchema,
  JsonValueSchema,
  ModelConfigSchema,
  ModelOverrideSchema,
  NoAccountsConfigSchema,
  PauseReasonSchema,
  PersonaSpecSchema,
  ProvisionUrlConfigSchema,
  RunStatusSchema,
  SelfSignupConfigSchema,
  StaticIdentityConfigSchema,
  ToolPolicySchema,
  UndecidedIdentityConfigSchema,
  VerifierConfigSchema,
  VerifierOverrideSchema,
} from "@populace/core/isomorphic";
import { z } from "zod";
import { StudyModeSchema } from "./views.js";

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
  // Nobody has said yet (ADR-0040). A connected-but-unfinished target says so on the wire rather
  // than being dressed as `none`, which is a real answer and would read as ready to run.
  UndecidedIdentityConfigSchema,
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
  UndecidedIdentityConfigSchema,
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

/**
 * Asking an address what it can do, before — or after — there is a row for it.
 *
 * `target` names a row whose stored endpoints this body is merged against, and it is what makes a
 * SECOND check work once connecting writes the target (ADR-0040): a bearer token goes up and never
 * comes back down, so a form that has been reloaded no longer holds the one it sent, and a re-check
 * without this would ask a gated address anonymously and report it dead. Absent on the first check,
 * when there is no row yet.
 */
export const TargetCheckBodySchema = TargetInputSchema.pick({ mcp: true }).extend({
  identity: TargetInputSchema.shape.identity.optional(),
  target: z.string().optional(),
});
export type TargetCheckBody = z.infer<typeof TargetCheckBodySchema>;

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
 * `identity` is how the STRANGERS a study sends get accounts of their own. A screen that blurred
 * the two would be promising that signing in here is enough to run a population, which it is not,
 * and the copy says so.
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

/**
 * A persona spec on the way up. `id` is the slug, and the slug is the row's to give — a builder
 * drafting a persona has none yet — so the wire never carries it inside the spec. A stored spec
 * parsed through this drops its `id` and nothing else.
 */
export const PersonaSpecInputSchema = PersonaSpecSchema.omit({ id: true });
export type PersonaSpecInput = z.infer<typeof PersonaSpecInputSchema>;

export const PersonaViewSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  /** Immutable, and what agent ids are built from. Renaming the display name never touches it. */
  slug: z.string(),
  spec: PersonaSpecSchema,
  origin: z.enum(["starter", "authored", "imported"]),
  updatedAt: z.iso.datetime(),
  /** How many cohorts draw on this persona. Headcount is the study's, not the persona's. */
  cohorts: z.number().int().nonnegative(),
  /**
   * The cohort context the starter this persona came from suggests, when `origin` is `starter`
   * and the starter still exists under this slug; null otherwise. The cohort builder offers it
   * as a first draft of "what these people share" and says where it came from.
   */
  suggestedContext: z.string().nullable(),
});
export type PersonaView = z.infer<typeof PersonaViewSchema>;

export const PersonaInputSchema = z.object({
  /** Only honoured on create; a slug never changes afterwards. Derived from the name if absent. */
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
  spec: PersonaSpecInputSchema,
  /**
   * Only honoured on create. A persona the builder began from a starter says so, which is what
   * lets `suggestedContext` be found later; anything else is authored, and an update never moves
   * an origin.
   */
  origin: z.literal("starter").optional(),
});
export type PersonaInput = z.infer<typeof PersonaInputSchema>;

/**
 * A prebuilt persona as the builder offers it (ADR-0043): enough to show in a picker, and the
 * whole `spec` so choosing one fills the form rather than creating a row behind the user's back.
 */
export const StarterPersonaViewSchema = z.object({
  slug: z.string(),
  name: z.string(),
  role: z.string(),
  /** The one line the picker shows. */
  summary: z.string(),
  spec: PersonaSpecInputSchema,
  /** The cohort context this starter suggests for people of its kind, offered as a hint, never applied. */
  context: z.string(),
});
export type StarterPersonaView = z.infer<typeof StarterPersonaViewSchema>;

/**
 * "How this reads to them", for a persona that may not be saved yet. `targetId` names which of the
 * project's targets to render against; absent, and with exactly one target, that one is used;
 * with none, the server renders against a placeholder product so the preview still has a shape.
 */
export const PersonaPreviewBodySchema = z.object({
  spec: PersonaSpecInputSchema,
  targetId: z.string().min(1).optional(),
});
export type PersonaPreviewBody = z.infer<typeof PersonaPreviewBodySchema>;

/**
 * What a preview answers with: the prompt one persona would produce, rendered by the runner's own
 * code, and the slug it was rendered for — the saved slug, or what the server made of a draft that
 * has none yet. Two strings, and the same shape whether the persona is saved or not.
 */
export const PersonaPreviewViewSchema = z.object({
  personaSlug: z.string(),
  text: z.string(),
});
export type PersonaPreviewView = z.infer<typeof PersonaPreviewViewSchema>;

// ---- population and settings ---------------------------------------------

/**
 * Which cohorts go, and in what ratio (ADR-0039, ADR-0041). A member is one cohort at a WEIGHT;
 * there is no headcount anywhere in this shape, because the size belongs to the study that sends
 * the population, and a study of size N deals N across these weights and then across each
 * cohort's mix. `share` at both levels is `weight / Σ weights` (0..1), done here so a screen never
 * repeats the arithmetic; the counts a given size makes are the screen's to preview with
 * `dealStudy`.
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
      /** This cohort's share of a study's size, as a ratio against the other members. */
      weight: z.number().positive(),
      /** `weight / Σ members[].weight`, 0..1. */
      share: z.number().min(0).max(1),
      personas: z.array(
        z.object({
          personaId: z.string(),
          slug: z.string(),
          name: z.string(),
          /** This persona's weight in the cohort's mix. */
          weight: z.number().positive(),
          /** `weight / Σ` over the cohort's mix, 0..1. */
          share: z.number().min(0).max(1),
        }),
      ),
      /** The cohort's own visit cap. `maxWakes` on the row; the wire says visits (ADR-0032). */
      maxVisits: z.number().int().positive().nullable(),
    }),
  ),
  /** How many studies name this population. Deleting is refused while it is above nought. */
  usedBy: z.number().int().nonnegative(),
});
export type PopulationView = z.infer<typeof PopulationViewSchema>;

/**
 * One cohort in a population on the way up. A weight of nought takes the cohort out, so a PUT of
 * the whole list is add, reweigh and remove at once and there is no separate route for any of them.
 */
export const PopulationMemberInputSchema = z.object({ cohortId: z.string().min(1), weight: z.number().nonnegative() });
export type PopulationMemberInput = z.infer<typeof PopulationMemberInputSchema>;

/**
 * `members`, when sent, IS the composition: the whole ordered set with a weight each. Changing a
 * weight can move people in every study that sends the population (ADR-0039 accepts this; the
 * builder says so), and it re-deals those studies' rosters at their sizes. Nothing here writes a
 * person on its own: without a study sending it, a population is a recipe (ADR-0041).
 *
 * `seed`, `cadence` and the visit cap are not here: the cap decides a study's mode (ADR-0030) and
 * belongs to the study; the cadence and the seed belong to the cohort.
 */
export const PopulationInputSchema = z.object({
  name: z.string().min(1).optional(),
  members: z.array(PopulationMemberInputSchema).optional(),
});
export type PopulationInput = z.infer<typeof PopulationInputSchema>;

/**
 * Creating a population, composed in one request: the builder has the whole form at once, so
 * `members` goes with the name and there is no empty population to fill in afterwards. A member
 * at nought is left out, as on a PUT.
 */
export const PopulationCreateSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  members: z.array(PopulationMemberInputSchema).optional(),
});
export type PopulationCreate = z.infer<typeof PopulationCreateSchema>;

/** `model.apiKey` is absent by construction: a key is configured in the environment, not a form. */
export const SettingsViewSchema = z.object({
  model: ModelConfigSchema.omit({ apiKey: true }),
  guardrails: GuardrailsSchema,
  verifier: VerifierConfigSchema,
  daemon: DaemonConfigSchema,
  /**
   * The project's timing, which is what a new study inherits when its form names none of it. It is
   * on this view because a builder that cannot read it has to invent defaults of its own, and an
   * invented default that disagrees with the project's is a form that lies about what saving would
   * do. `cadence` and `seed` are the full stored values rather than a partial, so a screen can show
   * every field without filling a blank itself.
   */
  cadence: CadenceSchema,
  seed: z.string(),
  /**
   * The visit cap every study falls back to: null is no arithmetic end. The row calls this
   * `maxWakes`; the wire translates the NAME and nothing underneath it (ADR-0032).
   */
  maxVisits: z.number().int().positive().nullable(),
  /** Whether the process has a key at all. Without one, nothing that calls the model can run. */
  hasApiKey: z.boolean(),
  /**
   * Whether the process can reach the TYPED judge — a second key, `TYPESAFE_API_KEY`, and a second
   * flag because the two judges fail independently.
   *
   * It is here for the same reason `hasApiKey` is, and the case for it is sharper. The typed judge
   * is the one a screen recommends for the unattended report cycle, on price; chosen without its
   * key, every automatic cycle refuses at the pre-flight (`judgeRefusal`) for as long as the study
   * runs, and the only place that refusal appears is the error on a job row nobody is watching. A
   * form that offers a choice has to be able to say that this install cannot make it.
   *
   * It is a boolean and nothing more: the key itself never comes down the wire (ADR-0036,
   * ADR-0040), and neither does a name, an expiry or a prefix.
   */
  hasTypesafeKey: z.boolean(),
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
    kind: z.enum(["project", "target", "population", "study"]),
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
  hasApiKey: z.boolean(),
  killSwitch: z.object({ engaged: z.boolean(), reason: z.string().nullable(), at: z.string().nullable() }),
  runningRunIds: z.array(z.string()),
  /**
   * The studies this project holds, so a caller can name one without a second request. There is
   * no headcount beside them any more: how many go is each study's own `size`, and this GET
   * creates nothing to count (ADR-0041).
   */
  studyIds: z.array(z.object({ id: z.string(), slug: z.string(), name: z.string() })),
});
export type SetupStatus = z.infer<typeof SetupStatusSchema>;

// ---- estimating and starting ---------------------------------------------

/**
 * What a study would cost, in the wire's words (ADR-0032, ADR-0042). The server's `estimateRun`
 * counts agents and wakes; this is its result translated exactly as `wakeCount` becomes `visits`
 * — `agents` is `people`, a wake is a visit, and the per-row guardrail is per visit — which closes
 * the part of ADR-0035's recorded debt that let those two words onto the wire here. Both estimate
 * routes return it. A study whose deal sends nobody gets a zero estimate with `people: 0`, never
 * a refusal: the number IS the answer.
 */
export const EstimateViewSchema = z.object({
  /** `history` when this machine has priced visits to learn from, `default` on a first run. */
  basis: z.enum(["history", "default"]),
  sampleSize: z.number().int().nonnegative(),
  perVisitUsd: z.number().nonnegative(),
  people: z.number().int().nonnegative(),
  visits: z.number().int().nonnegative(),
  /** False when nothing caps the visits, in which case the total is a rate, not a ceiling. */
  bounded: z.boolean(),
  /** How many visits each person was assumed to make when nothing caps them; null when bounded. */
  assumedVisitsEach: z.number().int().positive().nullable(),
  lowUsd: z.number().nonnegative(),
  expectedUsd: z.number().nonnegative(),
  highUsd: z.number().nonnegative(),
  /**
   * One row per cohort AND persona — the pair is what tells the rows apart, since a cohort mixes
   * personas and a persona is in several cohorts. `cohort` is the cohort's slug.
   */
  perCohort: z.array(
    z.object({
      cohort: z.string(),
      personaId: z.string(),
      people: z.number().int().nonnegative(),
      visits: z.number().int().nonnegative(),
      capped: z.boolean(),
      expectedUsd: z.number().nonnegative(),
    }),
  ),
  model: z.string(),
  effort: z.string(),
  /** The guardrails that will actually stop it, whatever the arithmetic above says (ADR-0009). */
  stops: z.object({
    perVisitUsd: z.number(),
    perVisitTurns: z.number().int(),
    dailyUsd: z.number(),
    maxVisitsPerPerson: z.number().int().nullable(),
  }),
});
export type EstimateView = z.infer<typeof EstimateViewSchema>;

/**
 * The blocks of the project's settings a study sets for itself, on the way up. Each is the
 * no-default override schema, for the same reason `SettingsInput` uses them: a field a form did
 * not mention must not arrive carrying a schema default that overwrites the project's value.
 * When sent, the object IS the study's overrides block — a block absent from it overrides nothing.
 */
export const StudyOverridesInputSchema = z.object({
  model: ModelOverrideSchema.optional(),
  guardrails: GuardrailsOverrideSchema.optional(),
  verifier: VerifierOverrideSchema.optional(),
});
export type StudyOverridesInput = z.infer<typeof StudyOverridesInputSchema>;

/**
 * A study that is not saved yet — or a saved one as the form now has it — asking what it would
 * cost. The server resolves this READ-ONLY (no person is written, no roster is touched) and
 * answers with an `EstimateView`. `visitsPerPerson` null is a longitudinal study; absent means the
 * same. `cadence`, `seed` and `overrides` fall through to the project's settings when absent, as
 * the saved row's would.
 */
export const ProjectEstimateBodySchema = z.object({
  targetId: z.string().min(1),
  populationId: z.string().min(1),
  size: z.number().int().nonnegative(),
  visitsPerPerson: z.number().int().positive().nullable().default(null),
  cadence: CadenceSchema.partial().optional(),
  seed: z.string().optional(),
  overrides: StudyOverridesInputSchema.optional(),
});
export type ProjectEstimateBody = z.infer<typeof ProjectEstimateBodySchema>;

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

/**
 * One line of the store's event log as the browser reads it (ADR-0026), and the one record in
 * this file that is NOT the core row verbatim: the row names the study by the row's own word, and
 * the wire speaks the user's (ADR-0032, ADR-0042), so the server translates that one field on the
 * way out and everything else crosses unchanged. `seq` is the SSE cursor and the `pageOf` cursor.
 */
export const EventViewSchema = z.object({
  seq: z.number().int().nonnegative(),
  at: z.iso.datetime(),
  projectId: z.string().nullable(),
  studyId: z.string().nullable(),
  runId: z.string().nullable(),
  wakeId: z.string().nullable(),
  type: EventTypeSchema,
  payload: JsonValueSchema,
});
export type EventView = z.infer<typeof EventViewSchema>;

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
  mode: StudyModeSchema,
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

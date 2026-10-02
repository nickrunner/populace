import { z } from "zod";
import { DurationSchema } from "../duration.js";
import { GuardrailsOverrideSchema } from "./guardrails.js";
import { ModelOverrideSchema } from "./model.js";
import { CadenceSchema } from "./population.js";
import { VerifierOverrideSchema } from "./verifier.js";

/**
 * The two ways a population is run against a target. The distinction is **history carryover and
 * termination**, not determinism: outcomes vary between executions by design (the model is
 * sampled, cadence jitter is real, target state moves) and nothing here tries to stop that.
 *
 * - `ephemeral`  — clean slate every execution (simply do not pass `continueFrom`) and bounded by
 *   `visitsPerPerson`, so the run ends when the last participant hits its cap.
 * - `longitudinal` — memory, accounts and visit counts accumulate; the run has no arithmetic end
 *   and is paused and resumed rather than re-run.
 */
export const SimulationModeSchema = z.enum(["ephemeral", "longitudinal"]);
export type SimulationMode = z.infer<typeof SimulationModeSchema>;

/**
 * How often a running study stops to report — the longitudinal analogue of an execution boundary.
 *
 * An ephemeral study gets its report windows for free: it ends, and the next execution is the next
 * window, so the `new`/`open`/`gone quiet`/`back` arithmetic over signatures has a list of windows
 * to work on. A longitudinal study has exactly ONE execution and never ends, so that same
 * arithmetic sees one window for ever and every problem is `new` for ever. A report cycle is the
 * missing boundary: it closes a window mid-run so a study left running has a history to compare
 * against itself.
 *
 * Deliberately modelled field-for-field on `CadenceSchema`, which is the same shape asking the same
 * question about a person — how often does this come round, and how much does it scatter — so it
 * layers and snapshots the way cadence already does rather than inventing a second idiom.
 *
 * Whether cycles are ARMED is not decided here. That is the mode (only a longitudinal run arms
 * them) and whether anything is configured to receive a report. This says how often, once they are.
 */
export const ReportCycleSchema = z.object({
  /** Time between report cycles. */
  every: DurationSchema.prefault("1h"),
  /**
   * Random extra delay added to each cycle, 0..jitter, including the first.
   *
   * Non-zero for exactly the reason `CadenceSchema.jitter` is (commit `f03c5f1`, "zero jitter is a
   * herd"): with zero, two longitudinal runs started in the same minute report in lockstep for
   * ever. That matters more here than it does for a person, because a cycle is two jobs on a
   * strictly serial FIFO queue — a digest and a publish — so runs reporting in lockstep do not
   * merely look synchronised, they queue behind each other and delay every sweep and target check
   * sitting behind them.
   */
  jitter: DurationSchema.prefault("5m"),
  /** Delay before the FIRST cycle. Zero: the first window should close as soon as it has content. */
  initialDelay: DurationSchema.prefault("0s"),
  /**
   * Also close a window once this many visits have happened since the last one, whichever comes
   * first. It is counted rather than timed because a cycle has nothing to say until somebody has
   * visited, and a study whose people come back every six hours would otherwise report six empty
   * windows for every full one — and an empty window is read as no evidence either way, which is
   * correct and useless.
   *
   * Null leaves time as the only trigger.
   */
  everyVisits: z.number().int().positive().nullable().default(25),
});
export type ReportCycle = z.infer<typeof ReportCycleSchema>;

/**
 * The slice of a simulation that rides in the resolved `PopulaceConfig`, so a wake, a snapshot and
 * a digest can all say which simulation they belong to — and how big it was, and what it told its
 * people — without reading the authored row. `size` and `brief` are here so a snapshot says what
 * ran: the members' counts are the deal of that size, and the brief is frozen with them.
 */
export const SimulationContextSchema = z.object({
  id: z.string().min(1).default("sim_local"),
  slug: z.string().min(1).default("simulation"),
  name: z.string().min(1).default("Simulation"),
  mode: SimulationModeSchema.default("longitudinal"),
  visitsPerPerson: z.number().int().positive().nullable().default(null),
  autoSweep: z.boolean().default(false),
  /**
   * Carried for the same reason `autoSweep` is: a report cycle fires from the run, off the resolved
   * config, so editing the study while it runs must not silently change the rhythm of a run already
   * in flight. It snapshots, and "apply changes" is what replaces it.
   */
  reportCycle: ReportCycleSchema.prefault({}),
  /** How many people the study sends, before the deal. Nought for a config built by hand from lane counts. */
  size: z.number().int().nonnegative().default(0),
  /** What the study tells every person, after their cohort's context. Empty means nothing extra is said. */
  brief: z.string().default(""),
});
export type SimulationContext = z.infer<typeof SimulationContextSchema>;

export const SimulationSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    /** Immutable: bookmarks and any future CI invocation name it. */
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    name: z.string().min(1),
    description: z.string().default(""),
    populationId: z.string().min(1),
    /** Explicit, not "the most recently updated target wins". */
    targetId: z.string().min(1),
    mode: SimulationModeSchema,

    /**
     * THE headcount (ADR-0041). A cohort is personas with weights and a population is cohorts with
     * weights; this is the one number those ratios are applied to, by `dealStudy`, and setting it is
     * what writes the people. Nought is legal and sends nobody; a start refuses until it is raised.
     * Growing it re-deals nobody (the deal is house-monotone); changing a weight may.
     */
    size: z.number().int().nonnegative().default(0),

    /**
     * What this study tells the people, handed to every one of them after their cohort's context
     * and before their own line (D3b: it is how a study configures its people without a per-study
     * person table). Frozen into the snapshot through `SimulationContext.brief`. Empty says nothing.
     */
    brief: z.string().default(""),

    /**
     * EPHEMERAL: required. Every participant makes at most this many visits, then retires; the run
     * ends when the last one does. LONGITUDINAL: must be null — the run has no arithmetic end.
     */
    visitsPerPerson: z.number().int().positive().nullable().default(null),

    /** How often participants come back. A cohort may override it field-wise. */
    cadence: CadenceSchema.prefault({}),

    /**
     * Seeds cadence jitter only. People are NOT seeded from here — they belong to their cohort, so
     * two simulations over one population meet the same people.
     */
    seed: z.string().default("populace"),

    /** EPHEMERAL only. Delete the accounts this execution created when it ends. */
    autoSweep: z.boolean().default(true),

    /**
     * How often a run of this study stops to report. LONGITUDINAL is what it is for — an execution
     * boundary is the only report window an ephemeral study needs, and it gets one by ending — but
     * it is not refused for ephemeral: a long one, twenty people at ten visits each, is worth
     * reporting from before it finishes.
     */
    reportCycle: ReportCycleSchema.prefault({}),

    /**
     * EPHEMERAL only. When true, refuse to start unless the target declares a reset. Default FALSE
     * and a visible warning instead: the reference target has no MCP reset tool, and refusing by
     * default would make ephemeral mode unavailable against most real products on day one.
     */
    requireFreshTarget: z.boolean().default(false),

    /**
     * Layered over the project's settings; unset fields fall through, as `resolveModel` already
     * does. Each block carries no defaults of its own, so a simulation nobody has overridden
     * anything on overrides nothing.
     */
    overrides: z
      .object({
        model: ModelOverrideSchema.prefault({}),
        guardrails: GuardrailsOverrideSchema.prefault({}),
        verifier: VerifierOverrideSchema.prefault({}),
      })
      .prefault({}),

    /** Read-side bookkeeping so the index screen does not touch the runs table. */
    runCount: z.number().int().nonnegative().default(0),
    lastRunId: z.string().nullable().default(null),
    archived: z.boolean().default(false),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .superRefine((s, ctx) => {
    if (s.mode === "ephemeral" && s.visitsPerPerson === null)
      ctx.addIssue({ code: "custom", path: ["visitsPerPerson"], message: "an ephemeral study has to end: give it a visit cap" });
    if (s.mode === "longitudinal" && s.visitsPerPerson !== null)
      ctx.addIssue({ code: "custom", path: ["visitsPerPerson"], message: "a longitudinal study does not end; remove the visit cap" });
  });
export type Simulation = z.infer<typeof SimulationSchema>;

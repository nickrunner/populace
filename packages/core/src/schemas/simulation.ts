import { z } from "zod";
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
 * The slice of a simulation that rides in the resolved `PopulaceConfig`, so a wake, a snapshot and
 * a digest can all say which simulation they belong to without reading the authored row.
 */
export const SimulationContextSchema = z.object({
  id: z.string().min(1).default("sim_local"),
  slug: z.string().min(1).default("simulation"),
  name: z.string().min(1).default("Simulation"),
  mode: SimulationModeSchema.default("longitudinal"),
  visitsPerPerson: z.number().int().positive().nullable().default(null),
  autoSweep: z.boolean().default(false),
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
      ctx.addIssue({ code: "custom", path: ["visitsPerPerson"], message: "an ephemeral simulation has to end: give it a visit cap" });
    if (s.mode === "longitudinal" && s.visitsPerPerson !== null)
      ctx.addIssue({ code: "custom", path: ["visitsPerPerson"], message: "a longitudinal simulation does not end; remove the visit cap" });
  });
export type Simulation = z.infer<typeof SimulationSchema>;

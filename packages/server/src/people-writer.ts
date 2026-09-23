import {
  costOf,
  handleFor,
  priceFor,
  resolveModel,
  type Cohort,
  type Job,
  type ModelConfig,
  type Person,
  type Store,
  type StoredPersona,
} from "@populace/core";
import { toStrictInputSchema, type ModelProvider } from "@populace/runner";
import { z } from "zod";
import { ensureRoster, lanesOf, sizeOfCohort } from "./cohort-store.js";
import { ensureSettings } from "./config-store.js";
import type { JobSpend } from "./jobs.js";

/**
 * Tier 2 of person generation (SPEC §5.1): a model writes a cohort's cast, once, at authoring time.
 *
 * Tier 1 — the seeded bank in `ensureRoster` — has already put a row in every slot by the time
 * anything here runs, which is why a missing API key, a refusal or a malformed reply is a
 * *fallback* rather than a failure: the cohort still has a full cast, it is just the free one.
 * That is also what keeps the test suite offline.
 *
 * Three invariants, all of them load-bearing:
 *
 * - **It never overwrites an authored row.** It claims a slot only while the row in it is still
 *   the seeded placeholder (`generatedBy: "seeded"` with no details). A row a model already wrote
 *   (`model`), or one somebody edited by hand (`authored`, which is what a rename or a re-blurb
 *   stamps on it), is left exactly where it is — so running the job twice writes nothing the second
 *   time. Re-casting people who already exist is a different, confirmed operation
 *   (`POST …/people/regenerate`).
 * - **It never runs during a run.** A live execution is reading these rows through its config
 *   snapshot and signing accounts up from their handles; rewriting the cast underneath it would
 *   make the run's own participants unexplainable.
 * - **It is the first model spend outside a wake, so it carries its own guardrails** (SPEC §5.4):
 *   the kill switch is read before the first batch and again between batches, the project's daily
 *   ceiling is read the same way through `costSince`, and every dollar lands on the `Job` row as
 *   it is spent rather than when the job finishes.
 */

/** What the model is asked to hand back, parsed at the boundary and nowhere else. */
const WrittenPersonSchema = z.object({
  ordinal: z.number().int().nonnegative(),
  name: z.string().min(1).max(80),
  details: z.string().max(400).default(""),
});
const WrittenRosterSchema = z.object({ people: z.array(WrittenPersonSchema).min(1) });

const WRITE_TOOL = "write_people";

export interface PeopleWriterDeps {
  store: Store;
  /**
   * Absent when this process has no API key. That is not an error: the seeded cast stands and the
   * result says why it was not rewritten.
   */
  provider?: () => ModelProvider;
  report?: (progress: Partial<Job["progress"]>) => Promise<void>;
  spend?: JobSpend;
  now?: () => Date;
}

export interface GenerateOptions {
  /** Restricts generation to these people, by id. Absent means every slot still holding a placeholder. */
  personIds?: string[];
}

export interface GeneratedRoster {
  /** The cohort's cast afterwards, in ordinal order. */
  people: Person[];
  /** How many rows the model wrote. */
  written: number;
  /** How many slots it was asked to write and did not — the cast is seeded for these. */
  seeded: number;
  costUsd: number;
  /** Why the model did not write them, when it did not. Null when it wrote everything asked for. */
  fellBackBecause: string | null;
  model: string;
}

/**
 * Thrown when generation is refused rather than degraded: the kill switch, the daily ceiling, or a
 * run that is reading these rows right now. A caller turns it into a failed job or a 409 — what it
 * must not do is quietly carry on, because all three mean "somebody asked for spending to stop".
 */
export class GenerationRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationRefused";
  }
}

/** Runs that would be reading a cohort's people right now. */
async function liveRunIds(store: Store, projectId: string): Promise<string[]> {
  const [running, pending] = await Promise.all([store.listRuns({ projectId, status: "running" }), store.listRuns({ projectId, status: "pending" })]);
  return [...running, ...pending].map((run) => run.id);
}

/**
 * Writes the people of one cohort.
 *
 * Returns rather than throws when the model is unavailable or unhelpful; throws `GenerationRefused`
 * when a guardrail says stop.
 */
export async function generatePeople(deps: PeopleWriterDeps, cohortId: string, options: GenerateOptions = {}): Promise<GeneratedRoster> {
  const now = deps.now ?? ((): Date => new Date());
  const cohort = await deps.store.getCohort(cohortId);
  if (!cohort) throw new Error(`no cohort ${cohortId}`);

  const live = await liveRunIds(deps.store, cohort.projectId);
  if (live.length > 0) throw new GenerationRefused(`${live.length} execution(s) are reading these people right now; stop or pause them before re-casting the ${cohort.name} cohort`);

  // Tier 1 first, always. Every slot below the cohort's size has a row before a single token is
  // spent, so every later exit — no key, a refusal, the kill switch — leaves a complete cast.
  const seededRoster = await ensureRoster(deps.store, cohortId, now());
  // A cohort mixes personas, and the model is briefed one persona at a time: each lane is its
  // own batch, so a batch is never asked to invent individuals of two kinds at once.
  const personaOfLane = new Map((await lanesOf(deps.store, cohort, await sizeOfCohort(deps.store, cohort))).map((lane) => [lane.laneSlug, lane.persona]));
  const settings = await ensureSettings(deps.store, cohort.projectId);
  const model = resolveModel(settings.model, {
    // Writing twenty-five names and a sentence each does not need a thinking budget, and on a
    // strong default model that budget is most of the bill for a job nobody watches.
    effort: "low",
  });

  const wanted = options.personIds === undefined ? undefined : new Set(options.personIds);
  const candidates = seededRoster.filter((person) => isPlaceholder(person) && (wanted === undefined || wanted.has(person.id)));
  const result: GeneratedRoster = { people: seededRoster, written: 0, seeded: candidates.length, costUsd: 0, fellBackBecause: null, model: model.model };
  await deps.report?.({ done: 0, total: candidates.length });
  if (candidates.length === 0) return result;

  const provider = deps.provider?.();
  if (!provider) {
    result.fellBackBecause = "this process has no model provider; the cast is the seeded one";
    await deps.report?.({ label: result.fellBackBecause });
    return result;
  }

  const batchSize = settings.guardrails.maxPeoplePerGenerate;
  const written = new Map<string, Person>();
  const used = new Set(seededRoster.map((person) => person.name));

  const byLane = new Map<string, Person[]>();
  for (const person of candidates) byLane.set(person.laneSlug, [...(byLane.get(person.laneSlug) ?? []), person]);

  lanes: for (const [laneSlug, group] of byLane) {
    const persona = personaOfLane.get(laneSlug);
    if (!persona) continue;
    for (let start = 0; start < group.length; start += batchSize) {
      // Between batches as well as before the first: a cohort of six hundred is six calls, and the
      // whole point of a kill switch is that it takes effect part-way through something.
      await refuseIfStopped(deps.store, cohort.projectId, settings.guardrails.dailyUsd, now());
      const batch = group.slice(start, start + batchSize);
      let reply: z.infer<typeof WrittenRosterSchema>;
      try {
        // The names this batch is replacing are not "taken": they are the placeholders being
        // written over, and listing them would tell the model to avoid the only names it is free
        // to reuse.
        const taken = new Set(used);
        for (const person of batch) taken.delete(person.name);
        const call = await writeBatch(provider, model, cohort, persona, batch, taken);
        result.costUsd = Number((result.costUsd + call.costUsd).toFixed(8));
        result.model = call.servedBy;
        await deps.spend?.(call.costUsd);
        if (!call.roster) {
          result.fellBackBecause = "the model did not return a roster; the cast is the seeded one";
          break lanes;
        }
        reply = call.roster;
      } catch (err) {
        // A provider failure is not a reason to lose a cohort. The seeded rows stand and the reason
        // rides back on the result, where the job's progress label shows it.
        result.fellBackBecause = `${err instanceof Error ? err.message : String(err)}; the cast is the seeded one`;
        break lanes;
      }

      const byOrdinal = new Map(batch.map((person) => [person.ordinal, person]));
      const at = now().toISOString();
      for (const entry of reply.people) {
        const placeholder = byOrdinal.get(entry.ordinal);
        if (!placeholder || written.has(placeholder.id)) continue;
        // Two people in one cohort never share a name. A model that repeats one keeps the seeded
        // name for that person and contributes only the details — it is the smaller lie.
        const collides = entry.name !== placeholder.name && used.has(entry.name);
        const name = collides ? placeholder.name : entry.name;
        used.delete(placeholder.name);
        used.add(name);
        const person: Person = {
          ...placeholder,
          name,
          details: entry.details,
          // The handle IS re-derived here, unlike a hand rename (`PATCH …/people/:person`), because
          // generation is refused while anything is running: nobody has signed an account up as this
          // person yet, so an email local part that does not match their name has no history to
          // protect and would just read as a bug on the roster.
          handle: handleFor(name, placeholder.laneSlug, placeholder.ordinal),
          generatedBy: "model",
          generatedByModel: result.model,
          updatedAt: at,
        };
        await deps.store.savePerson(person);
        written.set(person.id, person);
      }
      result.written = written.size;
      result.seeded = candidates.length - written.size;
      await deps.report?.({ done: written.size, total: candidates.length });
    }
  }

  result.people = seededRoster.map((person) => written.get(person.id) ?? person);
  result.seeded = candidates.length - written.size;
  if (result.fellBackBecause !== null) await deps.report?.({ label: result.fellBackBecause });
  return result;
}

/**
 * A slot still holding what the seeded bank put there, and therefore free to be written over.
 *
 * `authored` is the value that keeps a hand-typed name out of here: a rename that left no details
 * behind used to be indistinguishable from an untouched placeholder.
 */
function isPlaceholder(person: Person): boolean {
  return person.generatedBy === "seeded" && person.details === "" && person.archivedAt === null;
}

/**
 * The two guardrails that mean "stop spending", read together. Both are refusals rather than
 * fallbacks: falling back to the seeded bank would be spending nothing, which is what was asked
 * for, but it would also silently answer a request the user made with something else.
 */
async function refuseIfStopped(store: Store, projectId: string, dailyUsd: number, now: Date): Promise<void> {
  const kill = await store.getKillSwitch();
  if (kill.engaged) throw new GenerationRefused(`everything is stopped${kill.reason ? ` (${kill.reason})` : ""}; writing people would spend money`);
  const spent = await store.costSince({ projectId }, new Date(now.getTime() - 86_400_000));
  if (spent >= dailyUsd) throw new GenerationRefused(`this project spent $${spent.toFixed(2)} in the last 24h, at or over its $${dailyUsd} ceiling`);
}

interface BatchOutcome {
  roster: z.infer<typeof WrittenRosterSchema> | null;
  costUsd: number;
  servedBy: string;
}

/** One model call: one batch of people, in, and a roster out. */
async function writeBatch(provider: ModelProvider, model: ModelConfig, cohort: Cohort, persona: StoredPersona, batch: Person[], used: ReadonlySet<string>): Promise<BatchOutcome> {
  const instructions =
        "You cast the people who will try a product. You are given one persona — a KIND of person, not an individual — the condition everybody in their cohort shares, and a number of slots to fill. " +
        "Invent that many distinct individuals who all fit the persona and the shared condition, and for each one write a name and one or two sentences of specifics that tell them apart from the others: what device they are on, what they are actually here to do this month, one habit or constraint. " +
        "The specifics must be consistent with the persona's role, backstory and goals — you are making individuals within a kind, not new kinds. Do not restate the persona. Do not mention the product by name. Do not invent a company, a job title or a life story; one or two concrete sentences is the whole brief. " +
        "Draw names from a wide range of origins, as a real cross-section of users would be. Never repeat a name. Answer only by calling the tool, once, with every slot filled.";
  const spec = persona.spec;
  const lines = [
    `Persona: ${spec.name}`,
    `Role: ${spec.role}`,
    `Backstory: ${spec.backstory}`,
    `Goals: ${spec.goals.join("; ")}`,
    ...(spec.constraints.length > 0 ? [`Constraints: ${spec.constraints.join("; ")}`] : []),
    "",
    `Cohort: ${cohort.name}${cohort.notes ? ` — ${cohort.notes}` : ""}`,
    `What everybody in this cohort shares: ${cohort.context}`,
    `Fill these ${batch.length} slot(s), by ordinal: ${batch.map((person) => person.ordinal).join(", ")}`,
    ...(used.size > 0 ? [`Names already taken in this cohort, which you may not reuse: ${[...used].join(", ")}`] : []),
    "",
    `Call ${WRITE_TOOL}.`,
  ];
  const response = await provider.complete({
    model: model.model,
    effort: model.effort,
    // Roughly a name and two sentences each, with headroom, capped so one batch can never become
    // the whole daily ceiling by itself.
    maxTokens: Math.min(32_000, 1_000 + 200 * batch.length),
    system: [{ type: "text", text: instructions, cache_control: { type: "ephemeral" } }],
    tools: [
      {
        name: WRITE_TOOL,
        description: "Record the people who fill these slots. One entry per ordinal you were given, no more and no fewer.",
        input_schema: toStrictInputSchema(WrittenRosterSchema),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: lines.join("\n") }],
    fallbacks: model.fallbacks,
    // There is no wake here — that is the whole point of this module — so the metadata names the
    // cohort instead, which is what a provider's request log needs to attribute the spend.
    metadata: { wakeId: `people:${cohort.id}`, wakeNumber: 0, agentId: `cohort:${cohort.slug}`, personaId: persona.slug, runId: "" },
  });
  const costUsd = costOf(response.usage, priceFor(response.servedBy, model.prices));
  const call = response.message.content.find((block) => block.type === "tool_use" && block.name === WRITE_TOOL);
  // The model boundary: whatever came back is parsed here and is a typed roster or nothing.
  const parsed = call?.type === "tool_use" ? WrittenRosterSchema.safeParse(call.input) : undefined;
  return { roster: parsed?.success === true ? parsed.data : null, costUsd, servedBy: response.servedBy };
}

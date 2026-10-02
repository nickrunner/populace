import { z } from "zod";
import { JsonValueSchema } from "../json.js";

/**
 * The store-level event log (`DATA-MODEL.md` §9, ADR-0026). `trace_events` is ordered per wake,
 * which is right for replay and useless for "what happened next anywhere". This log has one
 * monotonic cursor across the whole store, which is what lets a reconnecting browser replay the
 * gap instead of losing it.
 *
 * It is derived from rows that already exist and may be truncated by age or count. Nothing may
 * treat it as the system of record.
 */
export const EventTypeSchema = z.enum([
  "run.started",
  "run.ended",
  "run.status",
  /** The config a running execution executes was replaced — "apply changes" (SPEC §4.2). */
  "run.config",
  "wake.started",
  "wake.ended",
  "trace.appended",
  "finding.filed",
  "guardrail.tripped",
  "identity.created",
  "job.updated",
  /**
   * populace opened, or added to, an issue in somebody's repository. Both comparable actions that
   * mutate a third party's state already append an event — `target.reset` and a sweep — and this
   * is the first one that writes somewhere the study never visited, so it is the last place that
   * should be silent.
   *
   * Not `*.filed`: `finding.filed` already means a PERSON wrote a report, and reusing the word for
   * what populace did afterwards would make the log say a thing happened twice.
   */
  "issue.opened",
  "issue.commented",
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const EventSchema = z.object({
  /** Monotonic across the store. This is the SSE cursor and the `pageOf` cursor (ADR-0026). */
  seq: z.number().int().nonnegative(),
  at: z.iso.datetime(),
  projectId: z.string().nullable().default(null),
  simulationId: z.string().nullable().default(null),
  runId: z.string().nullable().default(null),
  wakeId: z.string().nullable().default(null),
  type: EventTypeSchema,
  payload: JsonValueSchema,
});
export type Event = z.infer<typeof EventSchema>;

/**
 * An event before the store assigns it a sequence number. `projectId` and `simulationId` are
 * optional here because the recording store stamps them from the run: an emitter deep in a wake
 * knows its wake and its run and has no business knowing which project it is filed under.
 */
export type EventInput = Omit<Event, "seq" | "at" | "projectId" | "simulationId"> & {
  at?: string;
  projectId?: string | null;
  simulationId?: string | null;
};

export interface EventQuery {
  afterSeq?: number;
  projectId?: string;
  simulationId?: string;
  runId?: string;
  types?: EventType[];
  limit?: number;
}

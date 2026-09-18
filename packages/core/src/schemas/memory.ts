import { z } from "zod";

export const MemoryNoteSchema = z.object({ wake: z.number().int().nonnegative(), text: z.string() });

export const MemorySchema = z.object({
  /** Memory belongs to an agent *within a run*: a fresh run starts an agent with nothing. */
  runId: z.string().min(1),
  agentId: z.string().min(1),
  notes: z.array(MemoryNoteSchema).default([]),
  /** Things the agent is waiting for the product (or someone) to do. */
  waitingOn: z.array(MemoryNoteSchema).default([]),
  /** Things that annoyed the agent, kept so a returning user remembers them. */
  annoyances: z.array(MemoryNoteSchema).default([]),
  /** Things the agent has already done, so it does not redo onboarding every wake. */
  done: z.array(MemoryNoteSchema).default([]),
  updatedAt: z.iso.datetime(),
});
export type Memory = z.infer<typeof MemorySchema>;

export function emptyMemory(runId: string, agentId: string, now: Date = new Date()): Memory {
  return { runId, agentId, notes: [], waitingOn: [], annoyances: [], done: [], updatedAt: now.toISOString() };
}

/** "resolved" removes waitingOn entries containing the text (case-insensitive); the rest append. */
export const MemoryKindSchema = z.enum(["note", "waiting_on", "annoyance", "done", "resolved"]);
export type MemoryKind = z.infer<typeof MemoryKindSchema>;

/**
 * A flat object rather than a discriminated union on `kind`: this schema is handed to the
 * model as a strict tool schema, and a union serialises to a root-level anyOf, which is not
 * an object schema and so cannot be a tool input.
 */
export const MemoryOperationSchema = z.object({ kind: MemoryKindSchema, text: z.string().min(1) });
export type MemoryOperation = z.infer<typeof MemoryOperationSchema>;

export function applyMemoryOperation(memory: Memory, op: MemoryOperation, wake: number, maxNotes: number, now: Date = new Date()): Memory {
  const next: Memory = { ...memory, updatedAt: now.toISOString() };
  const entry = { wake, text: op.text };
  switch (op.kind) {
    case "note":
      next.notes = [...memory.notes, entry].slice(-maxNotes);
      break;
    case "waiting_on":
      next.waitingOn = [...memory.waitingOn, entry];
      break;
    case "annoyance":
      next.annoyances = [...memory.annoyances, entry];
      break;
    case "done":
      next.done = [...memory.done, entry];
      break;
    case "resolved": {
      const needle = op.text.toLowerCase();
      next.waitingOn = memory.waitingOn.filter((w) => !w.text.toLowerCase().includes(needle));
      break;
    }
  }
  return next;
}

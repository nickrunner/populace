import { z } from "zod";

export const MemoryNoteSchema = z.object({ wake: z.number().int().nonnegative(), text: z.string() });

export const MemorySchema = z.object({
  agentId: z.string().min(1),
  notes: z.array(MemoryNoteSchema).default([]),
  /** Things the agent is waiting for the product (or someone) to do. */
  waitingOn: z.array(MemoryNoteSchema).default([]),
  /** Things that annoyed the agent, kept so a returning user remembers them. */
  annoyances: z.array(MemoryNoteSchema).default([]),
  /** Things the agent has already done, so it does not redo onboarding every wake. */
  done: z.array(MemoryNoteSchema).default([]),
  updatedAt: z.string().datetime(),
});
export type Memory = z.infer<typeof MemorySchema>;

export function emptyMemory(agentId: string, now: Date = new Date()): Memory {
  return { agentId, notes: [], waitingOn: [], annoyances: [], done: [], updatedAt: now.toISOString() };
}

export const MemoryOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("note"), text: z.string().min(1) }),
  z.object({ kind: z.literal("waiting_on"), text: z.string().min(1) }),
  z.object({ kind: z.literal("annoyance"), text: z.string().min(1) }),
  z.object({ kind: z.literal("done"), text: z.string().min(1) }),
  /** Removes waitingOn entries containing the text (case-insensitive). */
  z.object({ kind: z.literal("resolved"), text: z.string().min(1) }),
]);
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
